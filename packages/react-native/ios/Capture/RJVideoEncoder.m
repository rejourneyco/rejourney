//
//  RJVideoEncoder.m
//  Rejourney
//
//  H.264 video segment encoder implementation using AVAssetWriter.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
//
//  Copyright (c) 2026 Rejourney
//

#import "RJVideoEncoder.h"
#import "../Core/RJConstants.h"
#import "../Core/RJLogger.h"
#import "../Utils/RJPerfTiming.h"
#import <QuartzCore/CABase.h>
#import <UIKit/UIKit.h>

@interface RJVideoEncoder ()

@property(nonatomic, strong, nullable) AVAssetWriter *assetWriter;

@property(nonatomic, strong, nullable) AVAssetWriterInput *videoInput;

@property(nonatomic, strong, nullable)
    AVAssetWriterInputPixelBufferAdaptor *adaptor;

@property(nonatomic, strong, nullable) NSURL *currentSegmentURL;

@property(nonatomic, assign) NSInteger frameCount;

@property(nonatomic, assign) NSTimeInterval segmentStartTime;

@property(nonatomic, assign) NSTimeInterval segmentFirstFrameTimestamp;

@property(nonatomic, assign) NSTimeInterval lastFrameTimestamp;

@property(nonatomic, assign) CGSize currentFrameSize;

@property(nonatomic, strong) dispatch_queue_t encodingQueue;

@property(nonatomic, copy, nullable) NSString *internalSessionId;

@property(nonatomic, assign, nullable) CVPixelBufferPoolRef pixelBufferPool;

@end

@implementation RJVideoEncoder

#pragma mark - Initialization

- (instancetype)init {
  self = [super init];
  if (self) {
    _targetBitrate = 1500000; // 1.5 Mbps
    _framesPerSegment = 60;
    _fps = 15;
    _captureScale = RJDefaultCaptureScale; // Unified scale from RJConstants
    _frameCount = 0;
    _segmentStartTime = 0;
    _segmentFirstFrameTimestamp = 0;
    _lastFrameTimestamp = 0;

    _encodingQueue = dispatch_queue_create("com.rejourney.videoencoder",
                                           DISPATCH_QUEUE_SERIAL);
    dispatch_set_target_queue(
        _encodingQueue, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0));

    // Pre-warm pixel buffer pool to eliminate first-frame encoding spike
    [self prewarmPixelBufferPool];

    // Pre-warm AVAssetWriter to load VideoToolbox binaries
    [self prewarmEncoderAsync];
  }
  return self;
}

- (void)prewarmEncoderAsync {
  dispatch_async(_encodingQueue, ^{
    @try {
      RJLogDebug(@"VideoEncoder: Pre-warming AVAssetWriter libraries...");
      // Create a dummy writer to force load VideoToolbox and codecs
      NSError *error = nil;
      NSURL *tempURL =
          [NSURL fileURLWithPath:
                     [NSTemporaryDirectory()
                         stringByAppendingPathComponent:@"rj_prewarm.mp4"]];
      AVAssetWriter *dummyWriter =
          [AVAssetWriter assetWriterWithURL:tempURL
                                   fileType:AVFileTypeMPEG4
                                      error:&error];
      if (dummyWriter) {
        RJLogDebug(@"VideoEncoder: AVAssetWriter libraries loaded");
      }
    } @catch (NSException *e) {
      RJLogWarning(@"VideoEncoder: Failed to pre-warm libraries: %@", e);
    }
  });
}

- (void)prepareEncoderWithSize:(CGSize)size {
  // Dispatch to encoding queue to avoid main thread blocking
  dispatch_async(_encodingQueue, ^{
    if (self.isRecording) {
      RJLogDebug(@"VideoEncoder: Already recording, skipping prepare");
      return;
    }

    RJLogDebug(@"VideoEncoder: Preparing encoder with size: %@",
               NSStringFromCGSize(size));
    // Reuse startSegment logic to fully initialize writer, inputs, and file
    [self startSegmentWithSize:size];
    RJLogDebug(@"VideoEncoder: Encoder prepared and ready for first frame");
  });
}

- (void)dealloc {
  [self cleanup];
  if (_pixelBufferPool) {
    CVPixelBufferPoolRelease(_pixelBufferPool);
    _pixelBufferPool = NULL;
  }
}

#pragma mark - Public Properties

- (BOOL)isRecording {
  return self.assetWriter != nil &&
         self.assetWriter.status == AVAssetWriterStatusWriting;
}

- (NSInteger)currentFrameCount {
  return self.frameCount;
}

- (NSString *)sessionId {
  return self.internalSessionId;
}

#pragma mark - Lifecycle

- (void)setSessionId:(NSString *)sessionId {
  self.internalSessionId = sessionId;
}

- (BOOL)startSegmentWithSize:(CGSize)size {
  if (self.isRecording) {
    [self finishSegment];
  }

  self.frameCount = 0;
  self.lastFrameTimestamp = 0;
  self.segmentFirstFrameTimestamp = 0;
  self.segmentStartTime = [[NSDate date] timeIntervalSince1970] * 1000;

  // Size is already in pixels (from actual captured frame), use directly
  CGSize scaledSize = CGSizeMake(floor(size.width), floor(size.height));

  // Ensure even dimensions (required for H.264)
  scaledSize.width = ((NSInteger)scaledSize.width / 2) * 2;
  scaledSize.height = ((NSInteger)scaledSize.height / 2) * 2;

  if (scaledSize.width < 100 || scaledSize.height < 100) {
    RJLogWarning(@"Video encoder: Frame size too small, using minimum 100x100");
    scaledSize = CGSizeMake(100, 100);
  }

  self.currentFrameSize = scaledSize;

  NSString *sessionPrefix = self.internalSessionId ?: @"unknown";
  NSString *filename =
      [NSString stringWithFormat:@"seg_%@_%lld.mp4", sessionPrefix,
                                 (long long)self.segmentStartTime];

  NSURL *tempDir = [[NSURL fileURLWithPath:NSTemporaryDirectory()]
      URLByAppendingPathComponent:@"rj_segments"
                      isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:tempDir
                           withIntermediateDirectories:YES
                                            attributes:nil
                                                 error:nil];

  self.currentSegmentURL = [tempDir URLByAppendingPathComponent:filename];

  [[NSFileManager defaultManager] removeItemAtURL:self.currentSegmentURL
                                            error:nil];

  NSError *error = nil;
  self.assetWriter = [[AVAssetWriter alloc] initWithURL:self.currentSegmentURL
                                               fileType:AVFileTypeMPEG4
                                                  error:&error];

  if (error) {
    RJLogError(@"Failed to create AVAssetWriter: %@", error);
    [self notifyError:error];
    return NO;
  }

  NSInteger effectiveBitrate = [self bitrateForSize:scaledSize];
  NSDictionary *videoSettings = @{
    AVVideoCodecKey : AVVideoCodecTypeH264,
    AVVideoWidthKey : @(scaledSize.width),
    AVVideoHeightKey : @(scaledSize.height),
    AVVideoCompressionPropertiesKey : @{
      AVVideoAverageBitRateKey : @(effectiveBitrate),
      // Baseline + CAVLC reduces CPU without changing capture scale/bitrate.
      // Tradeoff: slightly larger files, but similar visual quality at same
      // bitrate.
      AVVideoProfileLevelKey : AVVideoProfileLevelH264BaselineAutoLevel,
      AVVideoH264EntropyModeKey : AVVideoH264EntropyModeCAVLC,
      AVVideoMaxKeyFrameIntervalKey :
          @(self.fps * 10), // 10s keyframes - fewer keyframes = smaller files
      AVVideoAllowFrameReorderingKey : @NO,
      AVVideoExpectedSourceFrameRateKey : @(self.fps),
    }
  };

  self.videoInput =
      [[AVAssetWriterInput alloc] initWithMediaType:AVMediaTypeVideo
                                     outputSettings:videoSettings];
  self.videoInput.expectsMediaDataInRealTime = YES;

  NSDictionary *sourcePixelBufferAttributes = @{
    (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
    (id)kCVPixelBufferWidthKey : @(scaledSize.width),
    (id)kCVPixelBufferHeightKey : @(scaledSize.height),
  };

  self.adaptor = [[AVAssetWriterInputPixelBufferAdaptor alloc]
         initWithAssetWriterInput:self.videoInput
      sourcePixelBufferAttributes:sourcePixelBufferAttributes];

  if (![self.assetWriter canAddInput:self.videoInput]) {
    RJLogError(@"Cannot add video input to asset writer");
    [self cleanup];
    return NO;
  }

  [self.assetWriter addInput:self.videoInput];

  if (![self.assetWriter startWriting]) {
    RJLogError(@"Failed to start writing: %@", self.assetWriter.error);
    [self notifyError:self.assetWriter.error];
    [self cleanup];
    return NO;
  }

  [self.assetWriter startSessionAtSourceTime:kCMTimeZero];

  RJLogDebug(@"Video encoder: Started segment at %.0f, size=%@",
             self.segmentStartTime, NSStringFromCGSize(scaledSize));

  return YES;
}

- (BOOL)appendFrame:(UIImage *)frame timestamp:(NSTimeInterval)timestamp {
  if (!frame) {
    RJLogWarning(@"Video encoder: Cannot append nil frame");
    return NO;
  }

  // On first frame, initialize segment with actual captured frame size
  if (!self.isRecording) {
    CGSize frameSize = CGSizeMake(frame.size.width * frame.scale,
                                  frame.size.height * frame.scale);
    if (![self startSegmentWithSize:frameSize]) {
      RJLogWarning(@"Video encoder: Failed to start segment with frame size %@",
                   NSStringFromCGSize(frameSize));
      return NO;
    }
  }

  if (!self.videoInput.readyForMoreMediaData) {
    RJLogDebug(@"Video encoder: Input not ready for more data, skipping frame");
    return NO;
  }

  RJ_TIME_START_NAMED(pixelBuffer);
  CVPixelBufferRef pixelBuffer = [self createPixelBufferFromImage:frame];
  RJ_TIME_END_NAMED(pixelBuffer, RJPerfMetricPixelBuffer);
  if (!pixelBuffer) {
    RJLogWarning(@"Video encoder: Failed to create pixel buffer");
    return NO;
  }

  BOOL success = [self appendPixelBuffer:pixelBuffer timestamp:timestamp];

  CVPixelBufferRelease(pixelBuffer);

  return success;
}

- (BOOL)appendPixelBuffer:(CVPixelBufferRef)pixelBuffer
                timestamp:(NSTimeInterval)timestamp {
  if (!pixelBuffer) {
    RJLogWarning(@"Video encoder: Cannot append nil pixel buffer");
    return NO;
  }

  // On first frame, initialize segment with actual buffer size if needed
  if (!self.isRecording) {
    size_t width = CVPixelBufferGetWidth(pixelBuffer);
    size_t height = CVPixelBufferGetHeight(pixelBuffer);
    CGSize frameSize = CGSizeMake(width, height);
    if (![self startSegmentWithSize:frameSize]) {
      RJLogWarning(
          @"Video encoder: Failed to start segment with buffer size %@",
          NSStringFromCGSize(frameSize));
      return NO;
    }
  }

  if (!self.videoInput.readyForMoreMediaData) {
    RJLogDebug(
        @"Video encoder: Input not ready for more data, skipping buffer");
    return NO;
  }

  if (self.frameCount == 0) {
    self.segmentFirstFrameTimestamp = timestamp;
  }

  NSTimeInterval presentationSeconds =
      (timestamp - self.segmentFirstFrameTimestamp) / 1000.0;

  CMTime frameTime = CMTimeMakeWithSeconds(presentationSeconds, 1000);

  RJ_TIME_START_NAMED(encodeAppend);
  BOOL success = [self.adaptor appendPixelBuffer:pixelBuffer
                            withPresentationTime:frameTime];
  RJ_TIME_END_NAMED(encodeAppend, RJPerfMetricEncodeAppend);

  if (success) {
    self.frameCount++;
    self.lastFrameTimestamp = timestamp;

    RJLogDebug(@"Video encoder: Appended frame %ld at time %.3fs",
               (long)self.frameCount, CMTimeGetSeconds(frameTime));

    if (self.frameCount >= self.framesPerSegment) {
      RJLogInfo(@"Video encoder: Segment full (%ld frames), rotating",
                (long)self.frameCount);
      [self finishSegmentAndContinue];
    }
  } else {
    RJLogWarning(@"Video encoder: Failed to append frame, status=%ld",
                 (long)self.assetWriter.status);
  }

  return success;
}

- (void)finishSegment {
  [self finishSegmentWithContinuation:NO synchronous:NO];
}

- (void)finishSegmentAndContinue {
  [self finishSegmentWithContinuation:YES synchronous:NO];
}

- (void)finishSegmentSync {
  [self finishSegmentWithContinuation:NO synchronous:YES];
}

- (void)finishSegmentWithContinuation:(BOOL)shouldContinue
                          synchronous:(BOOL)synchronous {
  if (!self.assetWriter) {
    RJLogInfo(@"[RJ-ENCODER] finishSegment called but no assetWriter - nothing to "
          @"finish");
    return;
  }

  if (self.assetWriter.status != AVAssetWriterStatusWriting) {
    RJLogInfo(@"[RJ-ENCODER] finishSegment called but assetWriter status=%ld (not "
          @"writing)",
          (long)self.assetWriter.status);
    return;
  }

  RJLogInfo(
      @"[RJ-ENCODER] Finishing segment with %ld frames, sessionId=%@, sync=%d",
      (long)self.frameCount, self.internalSessionId, synchronous);

  NSTimeInterval endTime = self.lastFrameTimestamp > 0
                               ? self.lastFrameTimestamp
                               : [[NSDate date] timeIntervalSince1970] * 1000;
  NSTimeInterval startTime = self.segmentFirstFrameTimestamp > 0
                                 ? self.segmentFirstFrameTimestamp
                                 : self.segmentStartTime;
  NSInteger count = self.frameCount;
  NSURL *url = self.currentSegmentURL;
  CGSize frameSize = self.currentFrameSize;
  // Capture sessionId before async to avoid nil race condition
  NSString *sessionId = [self.internalSessionId copy];

  if (count == 0) {
    RJLogInfo(@"[RJ-ENCODER] No frames in segment, canceling");
    [self cancelSegment];
    return;
  }

  if (!sessionId) {
    RJLogInfo(@"[RJ-ENCODER] No sessionId, canceling segment");
    [self cancelSegment];
    return;
  }

  [self.videoInput markAsFinished];

  // For synchronous finishing (termination/background), use semaphore to block
  dispatch_semaphore_t semaphore =
      synchronous ? dispatch_semaphore_create(0) : nil;

  __weak typeof(self) weakSelf = self;
  [self.assetWriter finishWritingWithCompletionHandler:^{
    __strong typeof(weakSelf) strongSelf = weakSelf;

    // Completion handler runs on background queue - process immediately for
    // sync mode
    if (strongSelf.assetWriter.status == AVAssetWriterStatusFailed) {
      RJLogInfo(@"[RJ-ENCODER] Segment FAILED: %@", strongSelf.assetWriter.error);
      if (!synchronous) {
        dispatch_async(dispatch_get_main_queue(), ^{
          [strongSelf notifyError:strongSelf.assetWriter.error];
        });
      }
    } else {
      NSDictionary *attrs =
          [[NSFileManager defaultManager] attributesOfItemAtPath:url.path
                                                           error:nil];
      unsigned long long fileSize = [attrs fileSize];

      RJLogInfo(@"[RJ-ENCODER] Segment COMPLETE - %ld frames, %.1f KB, %.1fs, "
            @"sessionId=%@, sync=%d",
            (long)count, fileSize / 1024.0, (endTime - startTime) / 1000.0,
            sessionId, synchronous);
      RJLogInfo(@"[RJ-ENCODER] Calling delegate videoEncoderDidFinishSegment "
            @"with url=%@",
            url.path);

      // For synchronous mode, call delegate immediately on current thread
      // For async mode, dispatch to main queue
      if (synchronous) {
        [strongSelf.delegate videoEncoderDidFinishSegment:url
                                                sessionId:sessionId
                                                startTime:startTime
                                                  endTime:endTime
                                               frameCount:count];
      } else {
        dispatch_async(strongSelf.encodingQueue, ^{
          [strongSelf.delegate videoEncoderDidFinishSegment:url
                                                  sessionId:sessionId
                                                  startTime:startTime
                                                    endTime:endTime
                                                 frameCount:count];
        });
      }
    }

    // Clean up writer state
    strongSelf.assetWriter = nil;
    strongSelf.videoInput = nil;
    strongSelf.adaptor = nil;

    if (!synchronous && shouldContinue && strongSelf.internalSessionId) {
      dispatch_async(strongSelf.encodingQueue, ^{
        [strongSelf startSegmentWithSize:frameSize];
      });
    }

    // Signal completion for synchronous mode
    if (semaphore) {
      dispatch_semaphore_signal(semaphore);
    }
  }];

  // Wait for completion in synchronous mode (with timeout)
  if (semaphore) {
    dispatch_time_t timeout =
        dispatch_time(DISPATCH_TIME_NOW, 5.0 * NSEC_PER_SEC);
    long result = dispatch_semaphore_wait(semaphore, timeout);
    if (result != 0) {
      RJLogInfo(@"[RJ-ENCODER] WARNING: Synchronous segment finish timed out after "
            @"5s");
    } else {
      RJLogInfo(@"[RJ-ENCODER] Synchronous segment finish completed");
    }
  }
}

- (void)cancelSegment {
  if (self.assetWriter) {
    [self.assetWriter cancelWriting];
  }

  if (self.currentSegmentURL) {
    [[NSFileManager defaultManager] removeItemAtURL:self.currentSegmentURL
                                              error:nil];
  }

  self.assetWriter = nil;
  self.videoInput = nil;
  self.adaptor = nil;
  self.currentSegmentURL = nil;
  self.frameCount = 0;
  self.lastFrameTimestamp = 0;
  self.segmentFirstFrameTimestamp = 0;

  RJLogDebug(@"Video encoder: Segment canceled");
}

- (void)cleanup {
  [self cancelSegment];
}

#pragma mark - Private Methods

- (NSInteger)bitrateForSize:(CGSize)size {
  NSInteger baseBitrate = self.targetBitrate > 0 ? self.targetBitrate : 1500000;
  CGFloat pixelCount = size.width * size.height;
  CGFloat referencePixels = 1280.0 * 720.0;
  CGFloat scale = referencePixels > 0 ? pixelCount / referencePixels : 1.0;
  NSInteger scaledBitrate = (NSInteger)lrint(baseBitrate * scale);

  NSInteger minBitrate = 200000;
  NSInteger maxBitrate = 8000000;
  if (scaledBitrate < minBitrate) {
    scaledBitrate = minBitrate;
  } else if (scaledBitrate > maxBitrate) {
    scaledBitrate = maxBitrate;
  }

  return scaledBitrate;
}

- (CVPixelBufferRef)createPixelBufferFromImage:(UIImage *)image {
  CGImageRef cgImage = image.CGImage;
  if (!cgImage) {
    return NULL;
  }

  size_t width = (size_t)self.currentFrameSize.width;
  size_t height = (size_t)self.currentFrameSize.height;

  size_t imageWidth = CGImageGetWidth(cgImage);
  size_t imageHeight = CGImageGetHeight(cgImage);

  if (labs((long)imageWidth - (long)width) > 2 ||
      labs((long)imageHeight - (long)height) > 2) {
    RJLogDebug(@"Video encoder: Skipping frame - size mismatch (got %zux%zu, "
               @"expected %zux%zu)",
               imageWidth, imageHeight, width, height);
    return NULL;
  }

  if (!self.pixelBufferPool) {
    NSDictionary *poolAttributes = @{
      (id)kCVPixelBufferPoolMinimumBufferCountKey : @(3),
    };

    NSDictionary *pixelBufferAttributes = @{
      (id)kCVPixelBufferWidthKey : @(width),
      (id)kCVPixelBufferHeightKey : @(height),
      (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
      (id)kCVPixelBufferCGImageCompatibilityKey : @YES,
      (id)kCVPixelBufferCGBitmapContextCompatibilityKey : @YES,
      (id)kCVPixelBufferIOSurfacePropertiesKey : @{},
    };

    CVReturn poolStatus = CVPixelBufferPoolCreate(
        kCFAllocatorDefault, (__bridge CFDictionaryRef)poolAttributes,
        (__bridge CFDictionaryRef)pixelBufferAttributes, &_pixelBufferPool);

    if (poolStatus != kCVReturnSuccess) {
      RJLogWarning(@"Video encoder: Failed to create pixel buffer pool: %d",
                   poolStatus);

      self.pixelBufferPool = NULL;
    } else {
      RJLogDebug(@"Video encoder: Created pixel buffer pool (%zux%zu)", width,
                 height);
    }
  }

  CVPixelBufferRef pixelBuffer = NULL;
  CVReturn status;

  if (self.pixelBufferPool) {

    status = CVPixelBufferPoolCreatePixelBuffer(
        kCFAllocatorDefault, self.pixelBufferPool, &pixelBuffer);
  } else {

    NSDictionary *options = @{
      (id)kCVPixelBufferCGImageCompatibilityKey : @YES,
      (id)kCVPixelBufferCGBitmapContextCompatibilityKey : @YES,
    };
    status = CVPixelBufferCreate(
        kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
        (__bridge CFDictionaryRef)options, &pixelBuffer);
  }

  if (status != kCVReturnSuccess || !pixelBuffer) {
    RJLogWarning(@"Video encoder: Failed to get pixel buffer: %d", status);
    return NULL;
  }

  CVPixelBufferLockBaseAddress(pixelBuffer, 0);

  void *baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer);
  size_t bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer);

  static CGColorSpaceRef colorSpace = NULL;
  if (!colorSpace) {
    colorSpace = CGColorSpaceCreateDeviceRGB();
  }

  size_t requiredBytesPerRow = width * 4;
  if (bytesPerRow < requiredBytesPerRow) {
    CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);
    CVPixelBufferRelease(pixelBuffer);
    RJLogWarning(@"Video encoder: bytesPerRow mismatch (%zu < %zu required) - "
                 @"skipping frame",
                 bytesPerRow, requiredBytesPerRow);
    return NULL;
  }

  CGContextRef context = CGBitmapContextCreate(
      baseAddress, width, height, 8, bytesPerRow, colorSpace,
      kCGImageAlphaNoneSkipFirst | kCGBitmapByteOrder32Little);

  if (!context) {
    CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);
    CVPixelBufferRelease(pixelBuffer);
    RJLogWarning(@"Video encoder: Failed to create bitmap context");
    return NULL;
  }

  CGContextSetInterpolationQuality(context, kCGInterpolationNone);
  CGContextDrawImage(context, CGRectMake(0, 0, width, height), cgImage);
  CGContextRelease(context);

  CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);

  return pixelBuffer;
}

- (void)notifyError:(NSError *)error {
  if ([self.delegate
          respondsToSelector:@selector(videoEncoderDidFailWithError:)]) {
    [self.delegate videoEncoderDidFailWithError:error];
  }
}

- (void)prewarmPixelBufferPool {
  dispatch_async(self.encodingQueue, ^{
    @autoreleasepool {
      NSTimeInterval startTime = CACurrentMediaTime();

      CGSize warmupSize = CGSizeMake(100, 100);

      // Create temp file for dummy segment
      NSURL *tempDir = [NSURL fileURLWithPath:NSTemporaryDirectory()];
      NSURL *warmupURL =
          [tempDir URLByAppendingPathComponent:@"rj_encoder_warmup.mp4"];
      [[NSFileManager defaultManager] removeItemAtURL:warmupURL error:nil];

      NSError *error = nil;
      AVAssetWriter *warmupWriter =
          [[AVAssetWriter alloc] initWithURL:warmupURL
                                    fileType:AVFileTypeMPEG4
                                       error:&error];
      if (error || !warmupWriter) {
        RJLogWarning(@"Video encoder: Prewarm failed to create writer: %@",
                     error);
        return;
      }

      NSDictionary *videoSettings = @{
        AVVideoCodecKey : AVVideoCodecTypeH264,
        AVVideoWidthKey : @(warmupSize.width),
        AVVideoHeightKey : @(warmupSize.height),
        AVVideoCompressionPropertiesKey : @{
          AVVideoAverageBitRateKey : @(100000),
          AVVideoProfileLevelKey : AVVideoProfileLevelH264BaselineAutoLevel,
          AVVideoAllowFrameReorderingKey : @NO,
        }
      };

      AVAssetWriterInput *warmupInput =
          [[AVAssetWriterInput alloc] initWithMediaType:AVMediaTypeVideo
                                         outputSettings:videoSettings];
      warmupInput.expectsMediaDataInRealTime = YES;

      NSDictionary *bufferAttrs = @{
        (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
        (id)kCVPixelBufferWidthKey : @(warmupSize.width),
        (id)kCVPixelBufferHeightKey : @(warmupSize.height),
      };

      AVAssetWriterInputPixelBufferAdaptor *warmupAdaptor =
          [[AVAssetWriterInputPixelBufferAdaptor alloc]
                 initWithAssetWriterInput:warmupInput
              sourcePixelBufferAttributes:bufferAttrs];

      if (![warmupWriter canAddInput:warmupInput]) {
        RJLogWarning(@"Video encoder: Prewarm cannot add input");
        return;
      }

      [warmupWriter addInput:warmupInput];

      if (![warmupWriter startWriting]) {
        RJLogWarning(@"Video encoder: Prewarm failed to start writing");
        return;
      }

      [warmupWriter startSessionAtSourceTime:kCMTimeZero];

      // Create and encode a single dummy frame to trigger H.264 encoder init
      CVPixelBufferRef dummyBuffer = NULL;
      NSDictionary *pixelBufferOpts = @{
        (id)kCVPixelBufferCGImageCompatibilityKey : @YES,
        (id)kCVPixelBufferCGBitmapContextCompatibilityKey : @YES,
        (id)kCVPixelBufferIOSurfacePropertiesKey : @{},
      };

      CVReturn cvStatus = CVPixelBufferCreate(
          kCFAllocatorDefault, (size_t)warmupSize.width,
          (size_t)warmupSize.height, kCVPixelFormatType_32BGRA,
          (__bridge CFDictionaryRef)pixelBufferOpts, &dummyBuffer);

      if (cvStatus == kCVReturnSuccess && dummyBuffer) {
        // Fill with black (optional, just ensures valid data)
        CVPixelBufferLockBaseAddress(dummyBuffer, 0);
        void *baseAddr = CVPixelBufferGetBaseAddress(dummyBuffer);
        size_t dataSize = CVPixelBufferGetDataSize(dummyBuffer);
        memset(baseAddr, 0, dataSize);
        CVPixelBufferUnlockBaseAddress(dummyBuffer, 0);

        // Append the dummy frame - THIS is what triggers encoder init
        if (warmupInput.readyForMoreMediaData) {
          [warmupAdaptor appendPixelBuffer:dummyBuffer
                      withPresentationTime:kCMTimeZero];
        }

        CVPixelBufferRelease(dummyBuffer);
      }

      // Finish writing (use semaphore to wait synchronously)
      [warmupInput markAsFinished];
      dispatch_semaphore_t sem = dispatch_semaphore_create(0);
      [warmupWriter finishWritingWithCompletionHandler:^{
        dispatch_semaphore_signal(sem);
      }];
      dispatch_semaphore_wait(
          sem, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC));

      // Cleanup
      [[NSFileManager defaultManager] removeItemAtURL:warmupURL error:nil];

      NSTimeInterval elapsed = (CACurrentMediaTime() - startTime) * 1000;
      RJLogInfo(@"Video encoder: H.264 encoder pre-warmed in %.1fms", elapsed);
    }
  });
}

#pragma mark - Class-level Encoder Prewarm

static BOOL sEncoderPrewarmed = NO;
static dispatch_once_t sPrewarmOnceToken;

+ (void)prewarmEncoderAsync {
  dispatch_once(&sPrewarmOnceToken, ^{
    if (sEncoderPrewarmed)
      return;
    sEncoderPrewarmed = YES;

    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
      @autoreleasepool {
        NSTimeInterval startTime = CACurrentMediaTime();

        CGSize warmupSize = CGSizeMake(100, 100);

        NSURL *tempDir = [NSURL fileURLWithPath:NSTemporaryDirectory()];
        NSURL *warmupURL =
            [tempDir URLByAppendingPathComponent:@"rj_encoder_prewarm.mp4"];
        [[NSFileManager defaultManager] removeItemAtURL:warmupURL error:nil];

        NSError *error = nil;
        AVAssetWriter *warmupWriter =
            [[AVAssetWriter alloc] initWithURL:warmupURL
                                      fileType:AVFileTypeMPEG4
                                         error:&error];
        if (error || !warmupWriter) {
          RJLogWarning(@"Video encoder: Class prewarm failed: %@", error);
          return;
        }

        NSDictionary *videoSettings = @{
          AVVideoCodecKey : AVVideoCodecTypeH264,
          AVVideoWidthKey : @(warmupSize.width),
          AVVideoHeightKey : @(warmupSize.height),
          AVVideoCompressionPropertiesKey : @{
            AVVideoAverageBitRateKey : @(100000),
            AVVideoProfileLevelKey : AVVideoProfileLevelH264BaselineAutoLevel,
            AVVideoAllowFrameReorderingKey : @NO,
          }
        };

        AVAssetWriterInput *warmupInput =
            [[AVAssetWriterInput alloc] initWithMediaType:AVMediaTypeVideo
                                           outputSettings:videoSettings];
        warmupInput.expectsMediaDataInRealTime = YES;

        NSDictionary *bufferAttrs = @{
          (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
          (id)kCVPixelBufferWidthKey : @(warmupSize.width),
          (id)kCVPixelBufferHeightKey : @(warmupSize.height),
        };

        AVAssetWriterInputPixelBufferAdaptor *warmupAdaptor =
            [[AVAssetWriterInputPixelBufferAdaptor alloc]
                   initWithAssetWriterInput:warmupInput
                sourcePixelBufferAttributes:bufferAttrs];

        if (![warmupWriter canAddInput:warmupInput]) {
          RJLogWarning(@"Video encoder: Class prewarm cannot add input");
          return;
        }

        [warmupWriter addInput:warmupInput];

        if (![warmupWriter startWriting]) {
          RJLogWarning(@"Video encoder: Class prewarm failed to start");
          return;
        }

        [warmupWriter startSessionAtSourceTime:kCMTimeZero];

        CVPixelBufferRef dummyBuffer = NULL;
        NSDictionary *pixelBufferOpts = @{
          (id)kCVPixelBufferCGImageCompatibilityKey : @YES,
          (id)kCVPixelBufferCGBitmapContextCompatibilityKey : @YES,
          (id)kCVPixelBufferIOSurfacePropertiesKey : @{},
        };

        CVReturn cvStatus = CVPixelBufferCreate(
            kCFAllocatorDefault, (size_t)warmupSize.width,
            (size_t)warmupSize.height, kCVPixelFormatType_32BGRA,
            (__bridge CFDictionaryRef)pixelBufferOpts, &dummyBuffer);

        if (cvStatus == kCVReturnSuccess && dummyBuffer) {
          CVPixelBufferLockBaseAddress(dummyBuffer, 0);
          void *baseAddr = CVPixelBufferGetBaseAddress(dummyBuffer);
          size_t dataSize = CVPixelBufferGetDataSize(dummyBuffer);
          memset(baseAddr, 0, dataSize);
          CVPixelBufferUnlockBaseAddress(dummyBuffer, 0);

          if (warmupInput.readyForMoreMediaData) {
            [warmupAdaptor appendPixelBuffer:dummyBuffer
                        withPresentationTime:kCMTimeZero];
          }

          CVPixelBufferRelease(dummyBuffer);
        }

        [warmupInput markAsFinished];
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);
        [warmupWriter finishWritingWithCompletionHandler:^{
          dispatch_semaphore_signal(sem);
        }];
        dispatch_semaphore_wait(
            sem, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC));

        [[NSFileManager defaultManager] removeItemAtURL:warmupURL error:nil];

        NSTimeInterval elapsed = (CACurrentMediaTime() - startTime) * 1000;
        RJLogInfo(@"Video encoder: H.264 class prewarm completed in %.1fms",
                  elapsed);
      }
    });
  });
}

#pragma mark - Crash Recovery

static NSString *const kRJPendingSegmentMetadataFile =
    @"rj_pending_segment.json";

+ (NSString *)pendingSegmentMetadataPath {
  NSArray *paths = NSSearchPathForDirectoriesInDomains(NSCachesDirectory,
                                                       NSUserDomainMask, YES);
  NSString *cacheDir = [paths firstObject];
  return
      [cacheDir stringByAppendingPathComponent:kRJPendingSegmentMetadataFile];
}

+ (nullable NSDictionary *)pendingCrashSegmentMetadata {
  NSString *path = [self pendingSegmentMetadataPath];
  if (![[NSFileManager defaultManager] fileExistsAtPath:path]) {
    return nil;
  }

  NSData *data = [NSData dataWithContentsOfFile:path];
  if (!data)
    return nil;

  return [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
}

+ (void)clearPendingCrashSegmentMetadata {
  NSString *path = [self pendingSegmentMetadataPath];
  [[NSFileManager defaultManager] removeItemAtPath:path error:nil];
}

- (BOOL)emergencyFlushSync {
  RJLogInfo(@"[RJ-VIDEO-ENCODER] ⚠️ Emergency flush called (crash detected)");

  if (!self.assetWriter) {
    RJLogInfo(@"[RJ-VIDEO-ENCODER] No active asset writer, nothing to flush");
    return NO;
  }

  if (self.assetWriter.status != AVAssetWriterStatusWriting) {
    RJLogInfo(@"[RJ-VIDEO-ENCODER] Asset writer not in writing state (status=%ld)",
          (long)self.assetWriter.status);
    return NO;
  }

  NSURL *segmentURL = self.currentSegmentURL;
  NSTimeInterval startTime = self.segmentFirstFrameTimestamp > 0
                                 ? self.segmentFirstFrameTimestamp
                                 : self.segmentStartTime;
  NSTimeInterval endTime = self.lastFrameTimestamp > 0
                               ? self.lastFrameTimestamp
                               : [[NSDate date] timeIntervalSince1970] * 1000;
  NSInteger frameCount = self.frameCount;
  NSString *sessionId = self.internalSessionId;

  if (frameCount == 0) {
    RJLogInfo(@"[RJ-VIDEO-ENCODER] No frames in segment, skipping emergency flush");
    return NO;
  }

  RJLogInfo(@"[RJ-VIDEO-ENCODER] Emergency flush: %ld frames, url=%@",
        (long)frameCount, segmentURL.path);

  @try {
    [self.videoInput markAsFinished];
  } @catch (NSException *e) {
    RJLogInfo(@"[RJ-VIDEO-ENCODER] Exception marking input finished: %@", e);
  }

  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  __block BOOL finishSuccess = NO;

  [self.assetWriter finishWritingWithCompletionHandler:^{
    finishSuccess = (self.assetWriter.status == AVAssetWriterStatusCompleted);
    dispatch_semaphore_signal(semaphore);
  }];

  dispatch_time_t timeout =
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(500 * NSEC_PER_MSEC));
  long result = dispatch_semaphore_wait(semaphore, timeout);

  if (result != 0) {
    RJLogInfo(@"[RJ-VIDEO-ENCODER] Emergency flush timed out");
  }

  NSDictionary *metadata = @{
    @"segmentPath" : segmentURL.path ?: @"",
    @"sessionId" : sessionId ?: @"",
    @"startTime" : @(startTime),
    @"endTime" : @(endTime),
    @"frameCount" : @(frameCount),
    @"timestamp" : @([[NSDate date] timeIntervalSince1970] * 1000),
    @"finalized" : @(finishSuccess),
  };

  NSData *metadataData = [NSJSONSerialization dataWithJSONObject:metadata
                                                         options:0
                                                           error:nil];
  if (metadataData) {
    NSString *metadataPath = [RJVideoEncoder pendingSegmentMetadataPath];
    [metadataData writeToFile:metadataPath atomically:YES];
    RJLogInfo(@"[RJ-VIDEO-ENCODER] Saved pending segment metadata to %@",
          metadataPath);
  }

  self.assetWriter = nil;
  self.videoInput = nil;
  self.adaptor = nil;

  RJLogInfo(@"[RJ-VIDEO-ENCODER] Emergency flush completed (success=%d)",
        finishSuccess);
  return finishSuccess;
}

@end
