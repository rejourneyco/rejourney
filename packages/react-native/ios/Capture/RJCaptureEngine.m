//
//  RJCaptureEngine.m
//  Rejourney
//
//  Video capture orchestrator with H.264 encoding.
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

#import "RJCaptureEngine.h"
#import "../Core/RJConstants.h"
#import "../Core/RJLogger.h"
#import "../Privacy/RJPrivacyMask.h"
#import "../Utils/RJPerfTiming.h"
#import "RJCaptureHeuristics.h"
#import "RJPerformanceManager.h"
#import "RJPixelBufferDownscaler.h"
#import "RJSegmentUploader.h"
#import "RJVideoEncoder.h"
#import "RJViewHierarchyScanner.h"
#import "RJViewSerializer.h"
#import <CoreFoundation/CoreFoundation.h>
#import <QuartzCore/CABase.h>
#import <UIKit/UIKit.h>
#import <mach/mach.h>

static void *kRJEncodingQueueKey = &kRJEncodingQueueKey;

static const NSTimeInterval kRJDefensiveCaptureDelayNavigation = 0.2;
static const NSTimeInterval kRJDefensiveCaptureDelayInteraction = 0.15;
static const NSTimeInterval kRJDefensiveCaptureDelayScroll = 0.2;
static const NSTimeInterval kRJDefensiveCaptureDelayMap = 0.55;
static const NSTimeInterval kRJMapPresenceWindowSeconds = 2.0;

typedef struct {
  size_t pixelWidth;
  size_t pixelHeight;
  CGFloat unifiedScale; // The effective scale (e.g. 0.5)
  NSInteger fps;
  NSInteger bitrate;
} RJCaptureLayout;

@interface RJCapturePendingCapture : NSObject

@property(nonatomic, assign) NSTimeInterval wantedAt;
@property(nonatomic, assign) NSTimeInterval deadline;
@property(nonatomic, assign) NSTimeInterval timestamp;
@property(nonatomic, assign) NSTimeInterval lastScanTime;
@property(nonatomic, assign) NSInteger generation;
@property(nonatomic, strong, nullable) RJViewHierarchyScanResult *scanResult;
@property(nonatomic, copy, nullable) NSString *layoutSignature;
@property(nonatomic, assign) RJCaptureImportance importance;

@end

@implementation RJCapturePendingCapture
@end

#pragma mark - Private Interface

@interface RJCaptureEngine () <RJPerformanceManagerDelegate>

- (RJCaptureLayout)currentCaptureLayoutForWindow:(UIWindow *)window;

- (CVPixelBufferRef)capturePixelBufferFromWindow:(UIWindow *)window
                                      withLayout:(RJCaptureLayout)layout
                                      scanResult:(RJViewHierarchyScanResult *)
                                                     scanResult;

- (void)requestDefensiveCaptureAfterDelay:(NSTimeInterval)delay
                                   reason:(NSString *)reason;

@property(nonatomic, copy) RJWindowProvider windowProvider;

@property(nonatomic, copy) NSString *internalSessionId;

@property(atomic, assign) BOOL internalIsRecording;

@property(atomic, assign) BOOL uiReadyForCapture;

@property(atomic, assign) BOOL isShuttingDown;

@property(nonatomic, strong, nullable) RJVideoEncoder *internalVideoEncoder;

@property(nonatomic, strong, nullable) RJViewSerializer *internalViewSerializer;

@property(nonatomic, strong, nullable)
    RJSegmentUploader *internalSegmentUploader;

@property(nonatomic, strong) RJViewHierarchyScanner *viewScanner;

@property(nonatomic, assign) NSInteger framesSinceHierarchy;

@property(nonatomic, strong) NSMutableArray<NSDictionary *> *hierarchySnapshots;

@property(atomic, assign) RJPerformanceLevel internalPerformanceLevel;

@property(nonatomic, strong, nullable) dispatch_source_t memoryPressureSource;

@property(nonatomic, copy, nullable) NSString *currentScreenName;

@property(atomic, assign) BOOL captureInProgress;

@property(nonatomic, copy, nullable) NSString *lastSerializedSignature;

@property(nonatomic, strong) dispatch_queue_t encodingQueue;

@property(nonatomic, assign) NSTimeInterval lastIntentTime;
@property(nonatomic, assign) NSTimeInterval lastMapPresenceTime;

@property(nonatomic, assign) BOOL didPrewarmScanner;

@property(nonatomic, assign) NSInteger framesSinceSessionStart;

@property(nonatomic, strong) RJCaptureHeuristics *captureHeuristics;

@property(nonatomic, strong, nullable) RJCapturePendingCapture *pendingCapture;

@property(nonatomic, assign) NSInteger pendingCaptureGeneration;

@property(nonatomic, assign) NSTimeInterval pendingDefensiveCaptureTime;
@property(nonatomic, assign) NSInteger pendingDefensiveCaptureGeneration;

/// Tracks whether app is in background (skip rendering while inactive)
@property(atomic, assign) BOOL isInBackground;

@property(nonatomic, strong, nullable) NSArray<UIWindow *> *cachedWindows;
@property(nonatomic, assign) NSTimeInterval lastWindowScanTime;

/// Pixel buffer pool for direct-to-buffer rendering
/// Pixel Buffer Pool for direct-to-buffer rendering (Encoding/Downscaled)
@property(nonatomic, assign) CVPixelBufferPoolRef pixelBufferPool;

/// Pixel Buffer Pool for NATIVE (Screen) dimensions
@property(nonatomic, assign) CVPixelBufferPoolRef nativePixelBufferPool;

/// Last captured pixel buffer for frame reuse
@property(nonatomic, assign) CVPixelBufferRef lastCapturedPixelBuffer;
@property(nonatomic, assign) CVPixelBufferRef lastSafePixelBuffer;

@property(nonatomic, strong, nullable)
    RJViewHierarchyScanResult *lastMaskScanResult;
@property(nonatomic, strong, nullable)
    RJViewHierarchyScanResult *lastSafeMaskScanResult;
@property(nonatomic, assign) BOOL lastCapturedHadBlockedSurface;

@property(nonatomic, assign) CGColorSpaceRef commonColorSpace;

@property(nonatomic, assign) size_t poolWidth;
@property(nonatomic, assign) size_t poolHeight;

@property(nonatomic, assign) size_t nativePoolWidth;
@property(nonatomic, assign) size_t nativePoolHeight;

@property(nonatomic, strong, nullable) CADisplayLink *displayLink;

@property(nonatomic, assign) CFRunLoopObserverRef runLoopObserver;
@property(nonatomic, assign) BOOL runLoopCapturePending;

@property(nonatomic, assign) BOOL isWarmingUp;

@end

#pragma mark - Implementation

@implementation RJCaptureEngine

#pragma mark - Initialization

- (RJCaptureLayout)currentCaptureLayoutForWindow:(UIWindow *)window {
  if (!window) {
    // Try to find a default window if nil
    if (self.windowProvider) {
      window = self.windowProvider();
    }
    if (!window) {
      window = [[UIApplication sharedApplication] windows].firstObject;
    }
  }

  CGSize screenSize = CGSizeZero;

  if (window) {
    screenSize = window.bounds.size;
  } else {
    // Fallback if no window found
    screenSize = CGSizeMake(390, 844);
  }
  if (!isfinite(screenSize.width) || !isfinite(screenSize.height) ||
      screenSize.width <= 0 || screenSize.height <= 0) {
    screenSize = CGSizeMake(390, 844);
  }

  CGFloat screenScale = [UIScreen mainScreen].scale;
  if (!isfinite(screenScale) || screenScale <= 0) {
    screenScale = 1.0;
  }

  CGFloat scaleToUse = self.captureScale;
  if (!isfinite(scaleToUse) || scaleToUse <= 0) {
    scaleToUse = RJDefaultCaptureScale;
  }

  NSInteger targetFPS = self.videoFPS;
  NSInteger targetBitrate = self.videoBitrate;

  if (self.internalPerformanceLevel >= RJPerformanceLevelReduced) {
    scaleToUse = MIN(scaleToUse, 0.25);
  }

  if (self.internalPerformanceLevel == RJPerformanceLevelMinimal) {
    scaleToUse = MIN(scaleToUse, 0.15);
  }


  scaleToUse = MIN(MAX(scaleToUse, 0.05), 1.0);

  size_t width = (size_t)(screenSize.width * screenScale * scaleToUse);
  size_t height = (size_t)(screenSize.height * screenScale * scaleToUse);

  width = (width / 2) * 2;
  height = (height / 2) * 2;

  CGFloat maxDimension = 1920.0;
  if (width > maxDimension || height > maxDimension) {
    CGFloat ratio = MIN(maxDimension / width, maxDimension / height);
    width = (size_t)(width * ratio);
    height = (size_t)(height * ratio);
    width = (width / 2) * 2;
    height = (height / 2) * 2;
  }

  // Recalculate effective scale so consumers (PrivacyMask) know the real
  // mapping This must be width / pointWidth (screenSize.width) This matches how
  // we scale the context later (CGContextScale)
  if (screenSize.width > 0) {
    scaleToUse = (CGFloat)width / screenSize.width;
  }

  RJCaptureLayout layout;
  layout.pixelWidth = width;
  layout.pixelHeight = height;
  layout.unifiedScale = scaleToUse;
  layout.fps = targetFPS;
  layout.bitrate = targetBitrate;

  return layout;
}

- (instancetype)initWithWindowProvider:(RJWindowProvider)windowProvider {
  self = [super init];
  if (self) {
    if (windowProvider) {
      _windowProvider = [windowProvider copy];
    } else {
      RJLogWarning(@"CaptureEngine initialized without window provider");
    }

    _privacyMask = [[RJPrivacyMask alloc] init];
    _viewScanner = [[RJViewHierarchyScanner alloc] init];
    _captureHeuristics = [[RJCaptureHeuristics alloc] init];

    dispatch_queue_attr_t encodeAttr = dispatch_queue_attr_make_with_qos_class(
        DISPATCH_QUEUE_SERIAL, QOS_CLASS_UTILITY, 0);
    _encodingQueue =
        dispatch_queue_create("com.rejourney.capture.encoding", encodeAttr);
    dispatch_queue_set_specific(_encodingQueue, kRJEncodingQueueKey,
                                kRJEncodingQueueKey, NULL);
    _captureInProgress = NO;
    _lastIntentTime = 0;
    _lastMapPresenceTime = 0;
    _pendingCaptureGeneration = 0;
    _isInBackground = NO;

    [[RJPerformanceManager sharedManager] setDelegate:self];
    [[RJPerformanceManager sharedManager] startMonitoring];
    RJLogDebug(@"CaptureEngine: Performance monitoring started");
    _hierarchySnapshots = [NSMutableArray new];
    _isShuttingDown = NO;
    _uiReadyForCapture = NO;
    _framesSinceHierarchy = 0;
    _isWarmingUp = NO;

    [self applyDefaultConfiguration];

    // Pre-warm H.264 encoder is now handled via prepareEncoderWithSize later in
    // prewarmRenderServer [RJVideoEncoder prewarmEncoderAsync]; // Removed
    // static call

    @try {
      [self setupSystemMonitoring];
    } @catch (NSException *exception) {
      RJLogWarning(@"System monitoring setup failed: %@", exception);
    }

    // Subscribe to background/foreground notifications
    [self setupBackgroundTracking];

    // Pre-warm pixel buffer pool
    [self prewarmPixelBufferPool];

    // Create common color space once
    _commonColorSpace = CGColorSpaceCreateDeviceRGB();

    // Pre-warm render server (GPU context)
    [self prewarmRenderServer];
  }
  return self;
}

- (void)applyDefaultConfiguration {

  _videoFPS = 1; // Default to 1 FPS intent clock
  _framesPerSegment = 60;
  _videoBitrate = 1500000; // 1.5 Mbps - optimized for quality capture
  _hierarchyCaptureInterval = 5;
  _captureScale = RJDefaultCaptureScale;
  _uploadsEnabled = YES;

  _adaptiveQualityEnabled = YES;
  _thermalThrottleEnabled = YES;
  _batteryAwareEnabled = YES;

  _privacyMaskTextInputs = YES;
  _privacyMaskCameraViews = YES;
  _privacyMaskWebViews = YES;
  _privacyMaskVideoLayers = YES;
  _privacyMask.maskTextInputs = YES;
  _privacyMask.maskCameraViews = YES;
  _privacyMask.maskWebViews = YES;
  _privacyMask.maskVideoLayers = YES;
  self.viewScanner.config.detectVideoLayers = YES;

  _internalPerformanceLevel = RJPerformanceLevelNormal;
}

#pragma mark - Public Property Accessors

- (RJVideoEncoder *)videoEncoder {
  return self.internalVideoEncoder;
}

- (RJViewSerializer *)viewSerializer {
  return self.internalViewSerializer;
}

- (RJSegmentUploader *)segmentUploader {
  return self.internalSegmentUploader;
}

- (RJPerformanceLevel)currentPerformanceLevel {
  return self.internalPerformanceLevel;
}

- (BOOL)isRecording {
  return self.internalIsRecording;
}

- (NSString *)sessionId {
  return self.internalSessionId;
}

- (void)setPrivacyMaskTextInputs:(BOOL)privacyMaskTextInputs {
  _privacyMaskTextInputs = privacyMaskTextInputs;
  _privacyMask.maskTextInputs = privacyMaskTextInputs;
}

- (void)setPrivacyMaskCameraViews:(BOOL)privacyMaskCameraViews {
  _privacyMaskCameraViews = privacyMaskCameraViews;
  _privacyMask.maskCameraViews = privacyMaskCameraViews;
  self.viewScanner.config.detectCameraViews = privacyMaskCameraViews;
}

- (void)setPrivacyMaskWebViews:(BOOL)privacyMaskWebViews {
  _privacyMaskWebViews = privacyMaskWebViews;
  _privacyMask.maskWebViews = privacyMaskWebViews;
  self.viewScanner.config.detectWebViews = privacyMaskWebViews;
}

- (void)setPrivacyMaskVideoLayers:(BOOL)privacyMaskVideoLayers {
  _privacyMaskVideoLayers = privacyMaskVideoLayers;
  _privacyMask.maskVideoLayers = privacyMaskVideoLayers;
  self.viewScanner.config.detectVideoLayers = privacyMaskVideoLayers;
}

#pragma mark - Deallocation

- (void)dealloc {
  _isShuttingDown = YES;
  _internalIsRecording = NO;

  [self teardownDisplayLink];

  [_internalVideoEncoder finishSegment];

  @try {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
  } @catch (NSException *e) {
  }

  if (_memoryPressureSource) {
    dispatch_source_cancel(_memoryPressureSource);
    _memoryPressureSource = nil;
  }

  @try {
    [_privacyMask forceCleanup];
  } @catch (NSException *e) {
  }

  if (_pixelBufferPool) {
    CVPixelBufferPoolRelease(_pixelBufferPool);
    _pixelBufferPool = NULL;
  }

  if (_nativePixelBufferPool) {
    CVPixelBufferPoolRelease(_nativePixelBufferPool);
    _nativePixelBufferPool = NULL;
  }

  if (_lastCapturedPixelBuffer) {
    CVPixelBufferRelease(_lastCapturedPixelBuffer);
    _lastCapturedPixelBuffer = NULL;
  }

  if (_lastSafePixelBuffer) {
    CVPixelBufferRelease(_lastSafePixelBuffer);
    _lastSafePixelBuffer = NULL;
  }

  if (_commonColorSpace) {
    CGColorSpaceRelease(_commonColorSpace);
    _commonColorSpace = NULL;
  }
}

#pragma mark - Background State Tracking

- (void)setupBackgroundTracking {
  NSNotificationCenter *center = [NSNotificationCenter defaultCenter];

  [center addObserver:self
             selector:@selector(appWillEnterBackground:)
                 name:UIApplicationWillResignActiveNotification
               object:nil];
  [center addObserver:self
             selector:@selector(appDidEnterBackground:)
                 name:UIApplicationDidEnterBackgroundNotification
               object:nil];
  [center addObserver:self
             selector:@selector(appWillEnterForeground:)
                 name:UIApplicationWillEnterForegroundNotification
               object:nil];
  [center addObserver:self
             selector:@selector(appDidBecomeActive:)
                 name:UIApplicationDidBecomeActiveNotification
               object:nil];
}

- (void)appWillEnterBackground:(NSNotification *)notification {

  self.isInBackground = YES;
  RJLogDebug(@"CaptureEngine: App will enter background - suspending capture");
}

- (void)appDidEnterBackground:(NSNotification *)notification {
  self.isInBackground = YES;
}

- (void)appWillEnterForeground:(NSNotification *)notification {
  // Keep background flag set until fully active - views haven't rendered yet
}

- (void)appDidBecomeActive:(NSNotification *)notification {
  self.isInBackground = NO;

  self.isWarmingUp = YES;

  if (self.lastCapturedPixelBuffer) {
    CVPixelBufferRelease(self.lastCapturedPixelBuffer);
    self.lastCapturedPixelBuffer = NULL;
  }
  self.lastMaskScanResult = nil;
  self.lastSafeMaskScanResult = nil;

  RJLogDebug(@"CaptureEngine: App became active - starting warmup (0.2s)");

  __weak typeof(self) weakSelf = self;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.2 * NSEC_PER_SEC)),
      dispatch_get_main_queue(), ^{
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf)
          return;

        strongSelf.isWarmingUp = NO;
        RJLogDebug(@"CaptureEngine: Warmup complete - resuming capture");

        // Trigger an immediate capture check
        [strongSelf captureVideoFrame];
      });
}

#pragma mark - System Monitoring

- (void)setupSystemMonitoring {
  [self setupMemoryPressureMonitoring];

  [[NSNotificationCenter defaultCenter]
      addObserver:self
         selector:@selector(handleMemoryWarning)
             name:UIApplicationDidReceiveMemoryWarningNotification
           object:nil];
}

- (void)setupMemoryPressureMonitoring {
  dispatch_source_t source = dispatch_source_create(
      DISPATCH_SOURCE_TYPE_MEMORYPRESSURE, 0,
      DISPATCH_MEMORYPRESSURE_WARN | DISPATCH_MEMORYPRESSURE_CRITICAL,
      dispatch_get_main_queue());

  __weak typeof(self) weakSelf = self;
  dispatch_source_set_event_handler(source, ^{
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (!strongSelf)
      return;

    dispatch_source_memorypressure_flags_t level =
        dispatch_source_get_data(source);

    if (level & DISPATCH_MEMORYPRESSURE_CRITICAL) {
      RJLogWarning(@"Critical memory pressure - reducing capture quality");
      strongSelf.internalPerformanceLevel = RJPerformanceLevelMinimal;
    } else if (level & DISPATCH_MEMORYPRESSURE_WARN) {
      RJLogInfo(@"Memory pressure warning - reducing quality");
      strongSelf.internalPerformanceLevel = RJPerformanceLevelReduced;
    }
  });

  dispatch_resume(source);
  self.memoryPressureSource = source;
}

- (void)handleMemoryWarning {
  RJLogWarning(@"Memory warning received");
  self.internalPerformanceLevel = RJPerformanceLevelMinimal;
}

#pragma mark - Configuration

- (void)configureSegmentUploaderWithBaseURL:(NSString *)baseURL
                                     apiKey:(NSString *)apiKey
                                  projectId:(NSString *)projectId {
  RJLogInfo(@"Configuring segment uploader: baseURL=%@, projectId=%@", baseURL,
            projectId);

  self.internalSegmentUploader =
      [[RJSegmentUploader alloc] initWithBaseURL:baseURL];
  self.internalSegmentUploader.apiKey = apiKey;
  self.internalSegmentUploader.projectId = projectId;
}

#pragma mark - Pixel Buffer Management

- (void)prewarmPixelBufferPool {
  RJCaptureLayout layout = [self currentCaptureLayoutForWindow:nil];
  size_t width = layout.pixelWidth;
  size_t height = layout.pixelHeight;

  [self createPixelBufferPoolWithWidth:width height:height];

  CGFloat screenScale = [UIScreen mainScreen].scale;
  size_t nativeW = (size_t)(width / layout.unifiedScale * screenScale);
  size_t nativeH = (size_t)(height / layout.unifiedScale * screenScale);
  nativeW = (nativeW / 2) * 2;
  nativeH = (nativeH / 2) * 2;

  [self createNativePixelBufferPoolWithWidth:nativeW height:nativeH];

  RJLogDebug(@"CaptureEngine: Pre-warmed pixel buffer pools (Enc: %zux%zu, "
             @"Native: %zux%zu)",
             width, height, nativeW, nativeH);
}

- (void)createPixelBufferPoolWithWidth:(size_t)width height:(size_t)height {
  if (_pixelBufferPool) {
    if (_poolWidth == width && _poolHeight == height) {
      return; 
    }
    CVPixelBufferPoolRelease(_pixelBufferPool);
    _pixelBufferPool = NULL;
  }

  NSDictionary *poolAttributes = @{
    (id)kCVPixelBufferPoolMinimumBufferCountKey : @(10), // Increased from 3
  };

  NSDictionary *pixelBufferAttributes = @{
    (id)kCVPixelBufferWidthKey : @(width),
    (id)kCVPixelBufferHeightKey : @(height),
    (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
    (id)kCVPixelBufferCGImageCompatibilityKey : @YES,
    (id)kCVPixelBufferCGBitmapContextCompatibilityKey : @YES,
    (id)kCVPixelBufferIOSurfacePropertiesKey : @{},
  };

  CVReturn ret = CVPixelBufferPoolCreate(
      kCFAllocatorDefault, (__bridge CFDictionaryRef)poolAttributes,
      (__bridge CFDictionaryRef)pixelBufferAttributes, &_pixelBufferPool);

  if (ret == kCVReturnSuccess) {
    _poolWidth = width;
    _poolHeight = height;
  }
}

- (void)prewarmRenderServer {


  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      RJLogDebug(@"CaptureEngine: Pre-warming Render Server (Direct-Buffer "
                 @"Path)...");

     
      CVPixelBufferRef pixelBuffer =
          [self createNativePixelBufferFromPoolWithWidth:100 height:100];
      if (pixelBuffer) {
        CVPixelBufferLockBaseAddress(pixelBuffer, 0);
        void *baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer);
        size_t bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer);

        CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
        CGContextRef context = CGBitmapContextCreate(
            baseAddress, 100, 100, 8, bytesPerRow, colorSpace,
            kCGImageAlphaNoneSkipFirst | kCGBitmapByteOrder32Little);
        CGColorSpaceRelease(colorSpace);

        if (context) {
         
          UIGraphicsPushContext(context);

          UIWindow *window = self.windowProvider ? self.windowProvider() : nil;
          if (!window)
            window = [[UIApplication sharedApplication] windows].firstObject;

          if (window) {
            [window drawViewHierarchyInRect:CGRectMake(0, 0, 100, 100)
                         afterScreenUpdates:NO];


            RJCaptureLayout layout =
                [self currentCaptureLayoutForWindow:window];
            CGSize expectedSize =
                CGSizeMake(layout.pixelWidth, layout.pixelHeight);

            RJLogDebug(
                @"CaptureEngine: Pre-warming Encoder with expected size: %@",
                NSStringFromCGSize(expectedSize));
            [self.internalVideoEncoder prepareEncoderWithSize:expectedSize];
          }

          UIGraphicsPopContext();
          CGContextRelease(context);
        }
        CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);
        CVPixelBufferRelease(pixelBuffer);
      }
      RJLogDebug(@"CaptureEngine: Render Server pre-warmed");
    } @catch (NSException *e) {
      RJLogWarning(@"CaptureEngine: Failed to pre-warm render server: %@", e);
    }
  });
}

- (void)createNativePixelBufferPoolWithWidth:(size_t)width
                                      height:(size_t)height {
  if (_nativePixelBufferPool) {
    if (_nativePoolWidth == width && _nativePoolHeight == height) {
      return; // Already matched
    }
    CVPixelBufferPoolRelease(_nativePixelBufferPool);
    _nativePixelBufferPool = NULL;
  }

  NSDictionary *poolAttributes = @{
    (id)kCVPixelBufferPoolMinimumBufferCountKey : @(10),
  };

  NSDictionary *pixelBufferAttributes = @{
    (id)kCVPixelBufferWidthKey : @(width),
    (id)kCVPixelBufferHeightKey : @(height),
    (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
    (id)kCVPixelBufferCGImageCompatibilityKey : @YES,
    (id)kCVPixelBufferCGBitmapContextCompatibilityKey : @YES,
    (id)kCVPixelBufferIOSurfacePropertiesKey : @{},
  };

  CVReturn ret = CVPixelBufferPoolCreate(
      kCFAllocatorDefault, (__bridge CFDictionaryRef)poolAttributes,
      (__bridge CFDictionaryRef)pixelBufferAttributes, &_nativePixelBufferPool);

  if (ret == kCVReturnSuccess) {
    _nativePoolWidth = width;
    _nativePoolHeight = height;
  }
}

- (CVPixelBufferRef)createNativePixelBufferFromPoolWithWidth:(size_t)width
                                                      height:(size_t)height {
  if (!_nativePixelBufferPool) {
    [self createNativePixelBufferPoolWithWidth:width height:height];
  }
  if (_nativePoolWidth != width || _nativePoolHeight != height) {
    [self createNativePixelBufferPoolWithWidth:width height:height];
  }

  CVPixelBufferRef pixelBuffer = NULL;
  CVReturn status = CVPixelBufferPoolCreatePixelBuffer(
      kCFAllocatorDefault, _nativePixelBufferPool, &pixelBuffer);

  if (status != kCVReturnSuccess) {
    [self createNativePixelBufferPoolWithWidth:width height:height];
    status = CVPixelBufferPoolCreatePixelBuffer(
        kCFAllocatorDefault, _nativePixelBufferPool, &pixelBuffer);
  }

  if (status != kCVReturnSuccess) {
    // Fallback
    RJLogWarning(@"CaptureEngine: Native Pool allocation failed");
    NSDictionary *options = @{
      (id)kCVPixelBufferCGImageCompatibilityKey : @YES,
      (id)kCVPixelBufferCGBitmapContextCompatibilityKey : @YES,
    };
    CVPixelBufferCreate(kCFAllocatorDefault, width, height,
                        kCVPixelFormatType_32BGRA,
                        (__bridge CFDictionaryRef)options, &pixelBuffer);
  }
  return pixelBuffer;
}

#pragma mark - Session Lifecycle

// B8: Cached Window Enumeration
- (NSArray<UIWindow *> *)cachedWindows {
  NSTimeInterval now = CACurrentMediaTime();
  if (!_cachedWindows ||
      (now - self.lastWindowScanTime > 0.1)) { // Cache for 100ms
    _cachedWindows = [self scanForWindows];
    self.lastWindowScanTime = now;
  }
  return _cachedWindows;
}

- (NSArray<UIWindow *> *)scanForWindows {
  NSMutableArray<UIWindow *> *windowsToScan =
      [NSMutableArray arrayWithCapacity:4];
  UIWindow *primaryWindow = self.windowProvider ? self.windowProvider() : nil;

  if (@available(iOS 13.0, *)) {
    for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
      if (![scene isKindOfClass:[UIWindowScene class]])
        continue;
      UIWindowScene *windowScene = (UIWindowScene *)scene;
      if (windowScene.activationState !=
          (NSInteger)0) { // Check active state if possible, or just skip
      }

      for (UIWindow *window in windowScene.windows) {
        if (!window || window.isHidden || window.alpha <= 0.01)
          continue;

        NSString *windowClass = NSStringFromClass([window class]);
        BOOL isSystemWindow = ([windowClass containsString:@"Keyboard"] ||
                               [windowClass containsString:@"TextEffects"] ||
                               [windowClass containsString:@"InputWindow"] ||
                               [windowClass containsString:@"RemoteKeyboard"] ||
                               [windowClass containsString:@"StatusBar"]);
        if (isSystemWindow)
          continue;

        [windowsToScan addObject:window];
      }
    }
  } else {
    if (primaryWindow)
      [windowsToScan addObject:primaryWindow];
  }

  if (windowsToScan.count == 0 && primaryWindow) {
    [windowsToScan addObject:primaryWindow];
  }

  return windowsToScan;
}

- (void)startSessionWithId:(NSString *)sessionId {
  if (self.isShuttingDown)
    return;

  if (!sessionId || sessionId.length == 0) {
    RJLogWarning(@"Cannot start session with empty ID");
    return;
  }

  if (self.internalIsRecording) {
    RJLogWarning(@"Session already active, stopping previous");
    [self stopSession];
  }

  RJLogInfo(@"Starting video capture session: %@", sessionId);
  self.internalSessionId = sessionId;

  @try {

    self.internalIsRecording = YES;
    self.lastMapPresenceTime = 0;

    dispatch_async(dispatch_get_main_queue(), ^{
      if (!self.isShuttingDown && self.internalIsRecording) {
        [self startVideoCapture];
      }
    });

  } @catch (NSException *exception) {
    RJLogError(@"Session start failed: %@", exception);
    self.internalIsRecording = NO;
    self.internalSessionId = nil;
  }
}

- (void)stopSession {
  [self stopSessionWithSynchronousFinish:NO];
}

- (void)stopSessionSync {
  [self stopSessionWithSynchronousFinish:YES];
}

- (void)stopSessionWithSynchronousFinish:(BOOL)synchronous {
  if (!self.internalIsRecording && !self.internalSessionId) {
    return;
  }

  RJLogInfo(@"Stopping session: %@ (sync=%d)", self.internalSessionId,
            synchronous);

  @try {
    self.internalIsRecording = NO;

    // Always invalidate display link synchronously to prevent race conditions
    if ([NSThread isMainThread]) {
      [self teardownDisplayLink];
    } else {
      dispatch_sync(dispatch_get_main_queue(), ^{
        [self teardownDisplayLink];
      });
    }

    if (self.internalVideoEncoder) {
      if (synchronous) {
        void (^finishSync)(void) = ^{
          RJLogInfo(
              @"CaptureEngine: Finishing segment synchronously (session stop)");
          [self.internalVideoEncoder finishSegmentSync];
          self.internalVideoEncoder =
              nil; 
        };
        if (dispatch_get_specific(kRJEncodingQueueKey)) {
          finishSync();
        } else {
          dispatch_sync(self.encodingQueue, finishSync);
        }
        [self waitForPendingSegmentUploadsWithTimeout:5.0];
      } else {
        dispatch_async(self.encodingQueue, ^{
          RJLogInfo(@"CaptureEngine: Finishing segment (async) (session stop)");
          [self.internalVideoEncoder finishSegment];
          self.internalVideoEncoder = nil;
        });
      }
    }

    if (self.hierarchySnapshots.count > 0) {
      [self uploadCurrentHierarchySnapshots];
    }

    self.framesSinceHierarchy = 0;
    self.lastIntentTime = 0;
    self.lastMapPresenceTime = 0;
    self.captureInProgress = NO;
    self.framesSinceSessionStart = 0;
    self.lastSerializedSignature = nil;
    self.pendingCapture = nil;
    self.pendingCaptureGeneration = 0;
    self.lastMaskScanResult = nil;
    self.lastSafeMaskScanResult = nil;
    self.lastCapturedHadBlockedSurface = NO;
    if (self.lastSafePixelBuffer) {
      CVPixelBufferRelease(self.lastSafePixelBuffer);
      self.lastSafePixelBuffer = NULL;
    }
    [self.captureHeuristics reset];

    self.internalSessionId = nil;
    self.currentScreenName = nil;

  } @catch (NSException *exception) {
    RJLogError(@"Session stop error: %@", exception);
    self.internalIsRecording = NO;
    self.internalSessionId = nil;
  }
}

#pragma mark - Video Capture

- (void)startVideoCapture {

  if (!self.internalSegmentUploader || !self.internalSegmentUploader.apiKey) {
    RJLogError(@"Segment uploader not configured!");
    self.internalIsRecording = NO;
    return;
  }

  self.framesSinceSessionStart = 0;
  [self.captureHeuristics reset];
  self.lastMaskScanResult = nil;
  self.lastSafeMaskScanResult = nil;
  self.lastCapturedHadBlockedSurface = NO;
  if (self.lastSafePixelBuffer) {
    CVPixelBufferRelease(self.lastSafePixelBuffer);
    self.lastSafePixelBuffer = NULL;
  }

  if (!self.didPrewarmScanner) {
    [self.viewScanner prewarmClassCaches];
    self.didPrewarmScanner = YES;
  }

  self.internalVideoEncoder = [[RJVideoEncoder alloc] init];
  self.internalVideoEncoder.delegate = self;
  self.internalVideoEncoder.fps = self.videoFPS;
  self.internalVideoEncoder.framesPerSegment = self.framesPerSegment;
  self.internalVideoEncoder.targetBitrate = self.videoBitrate;
  self.internalVideoEncoder.captureScale = self.captureScale;
  [self.internalVideoEncoder setSessionId:self.internalSessionId];

  self.internalViewSerializer = [[RJViewSerializer alloc] init];

  [self.hierarchySnapshots removeAllObjects];
  self.framesSinceHierarchy = 0;

  __weak typeof(self) weakSelf = self;

  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.3 * NSEC_PER_SEC)),
      dispatch_get_main_queue(), ^{
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (strongSelf && strongSelf.internalIsRecording &&
            !strongSelf.isShuttingDown) {
          strongSelf.uiReadyForCapture = YES;
          RJLogDebug(@"Capturing initial frame after session start");
          [strongSelf captureVideoFrame];
        }
      });

  [self setupDisplayLink];

  RJLogInfo(@"Video capture started: %ld FPS, %ld frames/segment "
            @"(CADisplayLink Mode)",
            (long)self.videoFPS, (long)self.framesPerSegment);
}

- (void)setupDisplayLink {
  [self teardownDisplayLink];

  __weak typeof(self) weakSelf = self;

  _displayLink =
      [CADisplayLink displayLinkWithTarget:self
                                  selector:@selector(displayLinkCallback:)];

  if (@available(iOS 15.0, *)) {
    _displayLink.preferredFrameRateRange =
        CAFrameRateRangeMake(self.videoFPS, self.videoFPS, self.videoFPS);
  } else {
    NSInteger interval = (NSInteger)(60.0 / self.videoFPS);
    _displayLink.frameInterval = MAX(1, interval);
  }

  [_displayLink addToRunLoop:[NSRunLoop mainRunLoop]
                     forMode:NSRunLoopCommonModes];

  [self setupRunLoopObserver];

  RJLogDebug(@"CADisplayLink attached (target FPS: %ld)", (long)self.videoFPS);
}

- (void)setupRunLoopObserver {
  if (self.runLoopObserver) {
    return;
  }

  __weak typeof(self) weakSelf = self;
  CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(
      kCFAllocatorDefault, kCFRunLoopBeforeWaiting, true, 0,
      ^(CFRunLoopObserverRef observer, CFRunLoopActivity activity) {
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf) {
          return;
        }
        if (!strongSelf.runLoopCapturePending) {
          return;
        }
        strongSelf.runLoopCapturePending = NO;
        if (!strongSelf.internalIsRecording || strongSelf.isShuttingDown) {
          return;
        }
        [strongSelf captureVideoFrame];
      });

  if (!observer) {
    return;
  }

  CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
  self.runLoopObserver = observer;
}

- (void)teardownRunLoopObserver {
  if (!self.runLoopObserver) {
    return;
  }

  CFRunLoopRemoveObserver(CFRunLoopGetMain(), self.runLoopObserver,
                          kCFRunLoopCommonModes);
  CFRelease(self.runLoopObserver);
  self.runLoopObserver = NULL;
  self.runLoopCapturePending = NO;
}

- (void)teardownDisplayLink {
  if (_displayLink) {
    [_displayLink invalidate];
    _displayLink = nil;
  }
  [self teardownRunLoopObserver];
}

- (void)displayLinkCallback:(CADisplayLink *)displayLink {
  if (!self.internalIsRecording || self.isShuttingDown)
    return;

  NSTimeInterval now = CACurrentMediaTime();
  NSTimeInterval interval = 1.0 / (CGFloat)self.videoFPS;

  if (now - self.lastIntentTime < interval)
    return;

  self.lastIntentTime = now;

  self.runLoopCapturePending = YES;
  [self setupRunLoopObserver];
}

- (void)captureVideoFrame {
  [self captureVideoFrameWithImportance:RJCaptureImportanceLow reason:@"timer"];
}

- (void)captureVideoFrameWithImportance:(RJCaptureImportance)importance
                                 reason:(NSString *)reason {
  if (!self.internalIsRecording || self.isShuttingDown)
    return;

  if (self.isWarmingUp) {
    return;
  }

  // Critical events (like navigation) should bypass UI ready checks if
  // possible, but we still need a valid UI.
  if (!self.uiReadyForCapture) {
    if (self.framesSinceSessionStart % 60 == 0)
      RJLogDebug(@"Skipping capture: UI not ready");
    return;
  }

  // Critical events override paused state
  BOOL isCritical = (importance == RJCaptureImportanceCritical ||
                     importance == RJCaptureImportanceHigh);
  if (self.internalPerformanceLevel == RJPerformanceLevelPaused &&
      !isCritical) {
    static NSInteger pauseSkipCount = 0;
    if (++pauseSkipCount % 60 == 0)
      RJLogDebug(@"Skipping capture: Performance Paused");
    return;
  }
  NSTimeInterval now = CACurrentMediaTime();

  if (self.pendingCapture) {
    self.pendingCapture.deadline = now;
    [self attemptPendingCapture:self.pendingCapture fullScan:NO];
  }

  RJCapturePendingCapture *pending = [[RJCapturePendingCapture alloc] init];
  pending.wantedAt = now;
  pending.importance = importance;

  NSTimeInterval grace = self.captureHeuristics.captureGraceSeconds;
  if (self.captureHeuristics.animationBlocking ||
      self.captureHeuristics.scrollActive ||
      self.captureHeuristics.keyboardAnimating) {
    grace = MIN(grace, 0.3);
  }

  if (isCritical) {
    grace = MIN(grace, 0.1);
  }

  pending.deadline = now + grace;
  pending.timestamp = [self currentTimestamp];
  pending.generation = ++self.pendingCaptureGeneration;

  self.pendingCapture = pending;

  [self attemptPendingCapture:pending fullScan:YES];
}

- (void)attemptPendingCapture:(RJCapturePendingCapture *)pending
                     fullScan:(BOOL)fullScan {
  if (!pending || pending != self.pendingCapture)
    return;
  if (!self.internalIsRecording || self.isShuttingDown)
    return;

  NSTimeInterval now = CACurrentMediaTime();
  if (now > pending.deadline) {
    UIWindow *window = self.windowProvider ? self.windowProvider() : nil;
    if (window) {
      [self emitFrameForPendingCapture:pending
                                window:window
                          shouldRender:NO
                                reason:RJCaptureHeuristicsReasonDeadlineExpired
                                   now:now];
    } else {
      self.pendingCapture = nil;
    }
    return;
  }

  if (self.captureInProgress) {
    [self schedulePendingCaptureAttemptWithDelay:self.captureHeuristics
                                                     .pollIntervalSeconds
                                      generation:pending.generation];
    return;
  }

  UIWindow *window = self.windowProvider ? self.windowProvider() : nil;
  if (!window) {
    NSTimeInterval pollInterval = self.captureHeuristics.pollIntervalSeconds;
    if (now + pollInterval <= pending.deadline) {
      [self schedulePendingCaptureAttemptWithDelay:pollInterval
                                        generation:pending.generation];
    } else {
      self.pendingCapture = nil;
    }
    return;
  }

  if (fullScan || !pending.scanResult) {
    RJ_TIME_START_NAMED(viewScan);

    RJViewHierarchyScanResult *scanResult = nil;
    @try {
      NSArray<UIWindow *> *windows = [self cachedWindows];
      scanResult = [self.viewScanner scanWindows:windows
                                relativeToWindow:window];
    } @catch (NSException *exception) {
      RJLogWarning(@"CaptureEngine: View scan failed: %@", exception);
    }
    if (!scanResult) {
      scanResult = [[RJViewHierarchyScanResult alloc] init];
    }
    pending.scanResult = scanResult;
    pending.layoutSignature = scanResult.layoutSignature;
    pending.lastScanTime = now;

    if (scanResult.hasMapView || scanResult.mapViewFrames.count > 0) {
      self.lastMapPresenceTime = now;
    }

    RJ_TIME_END_NAMED(viewScan, RJPerfMetricViewScan);

    @try {
      [self.captureHeuristics updateWithScanResult:scanResult
                                            window:window
                                               now:now];
    } @catch (NSException *exception) {
      RJLogWarning(@"CaptureEngine: Heuristics update failed: %@", exception);
    }
  } else {
    @try {
      [self.captureHeuristics updateWithStabilityProbeForWindow:window now:now];
    } @catch (NSException *exception) {
      RJLogWarning(@"CaptureEngine: Stability probe failed: %@", exception);
    }
  }

  RJCaptureHeuristicsDecision *decision = [self.captureHeuristics
      decisionForSignature:pending.layoutSignature
                       now:now
              hasLastFrame:(self.lastCapturedPixelBuffer != NULL)
                importance:pending.importance];

  if (decision.action == RJCaptureHeuristicsActionRenderNow && !fullScan) {
    RJ_TIME_START_NAMED(viewScan);
    RJViewHierarchyScanResult *refreshResult = nil;
    @try {
      NSArray<UIWindow *> *windows = [self cachedWindows];
      refreshResult = [self.viewScanner scanWindows:windows
                                   relativeToWindow:window];
    } @catch (NSException *exception) {
      RJLogWarning(@"CaptureEngine: View refresh scan failed: %@", exception);
    }
    if (!refreshResult) {
      refreshResult = [[RJViewHierarchyScanResult alloc] init];
    }
    pending.scanResult = refreshResult;
    pending.layoutSignature = refreshResult.layoutSignature;
    pending.lastScanTime = now;

    if (refreshResult.hasMapView || refreshResult.mapViewFrames.count > 0) {
      self.lastMapPresenceTime = now;
    }
    RJ_TIME_END_NAMED(viewScan, RJPerfMetricViewScan);

    @try {
      [self.captureHeuristics updateWithScanResult:refreshResult
                                            window:window
                                               now:now];
    } @catch (NSException *exception) {
      RJLogWarning(@"CaptureEngine: Heuristics refresh failed: %@", exception);
    }
    decision = [self.captureHeuristics
        decisionForSignature:pending.layoutSignature
                         now:now
                hasLastFrame:(self.lastCapturedPixelBuffer != NULL)
                  importance:pending.importance];
  }

  if (decision.action == RJCaptureHeuristicsActionDefer && fullScan) {
    [self logCaptureDecision:decision pending:pending];
  }

  if (decision.action == RJCaptureHeuristicsActionDefer) {
    NSTimeInterval pollInterval = self.captureHeuristics.pollIntervalSeconds;
    NSTimeInterval deferUntil = MAX(decision.deferUntil, now + pollInterval);
    if (deferUntil > pending.deadline) {
      [self emitFrameForPendingCapture:pending
                                window:window
                          shouldRender:NO
                                reason:RJCaptureHeuristicsReasonDeadlineExpired
                                   now:now];
      return;
    }
    [self schedulePendingCaptureAttemptWithDelay:(deferUntil - now)
                                      generation:pending.generation];
    return;
  }

  BOOL shouldRender = (decision.action == RJCaptureHeuristicsActionRenderNow);
  [self emitFrameForPendingCapture:pending
                            window:window
                      shouldRender:shouldRender
                            reason:decision.reason
                               now:now];
}

- (void)schedulePendingCaptureAttemptWithDelay:(NSTimeInterval)delay
                                    generation:(NSInteger)generation {
  NSTimeInterval clampedDelay = MAX(0.0, delay);
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(clampedDelay * NSEC_PER_SEC)),
      dispatch_get_main_queue(), ^{
        if (!self.pendingCapture ||
            self.pendingCapture.generation != generation) {
          return;
        }
        [self attemptPendingCapture:self.pendingCapture fullScan:NO];
      });
}

- (void)waitForPendingSegmentUploadsWithTimeout:(NSTimeInterval)timeout {
  if (!self.internalSegmentUploader) {
    return;
  }

  NSTimeInterval deadline = CACurrentMediaTime() + MAX(0.0, timeout);
  while (self.internalSegmentUploader.pendingUploads > 0 &&
         CACurrentMediaTime() < deadline) {
    if ([NSThread isMainThread]) {
      [[NSRunLoop currentRunLoop]
             runMode:NSDefaultRunLoopMode
          beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    } else {
      [NSThread sleepForTimeInterval:0.05];
    }
  }

  if (self.internalSegmentUploader.pendingUploads > 0) {
    RJLogWarning(
        @"CaptureEngine: Pending segment uploads did not finish before timeout"
        @" (%ld remaining)",
        (long)self.internalSegmentUploader.pendingUploads);
  }
}

- (void)requestDefensiveCaptureAfterDelay:(NSTimeInterval)delay
                                   reason:(NSString *)reason {
  if (!self.internalIsRecording || self.isShuttingDown) {
    return;
  }

  NSTimeInterval now = CACurrentMediaTime();
  NSTimeInterval target = now + MAX(0.0, delay);
  if (self.pendingDefensiveCaptureTime > 0 &&
      target >= self.pendingDefensiveCaptureTime - 0.01) {
    return;
  }

  self.pendingDefensiveCaptureTime = target;
  NSInteger generation = ++self.pendingDefensiveCaptureGeneration;

  if (reason.length > 0) {
    RJLogDebug(@"CaptureEngine: scheduling defensive capture (%@)", reason);
  }

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,
                               (int64_t)((target - now) * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
                   if (!self.internalIsRecording || self.isShuttingDown) {
                     return;
                   }
                   if (self.pendingDefensiveCaptureGeneration != generation) {
                     return;
                   }
                   self.pendingDefensiveCaptureTime = 0;
                   self.lastIntentTime = CACurrentMediaTime();
                   [self captureVideoFrameWithImportance:RJCaptureImportanceHigh
                                                  reason:reason];
                 });
}

- (void)emitFrameForPendingCapture:(RJCapturePendingCapture *)pending
                            window:(UIWindow *)window
                      shouldRender:(BOOL)shouldRender
                            reason:(RJCaptureHeuristicsReason)reason
                               now:(NSTimeInterval)now {
  if (!pending || pending != self.pendingCapture)
    return;
  if (!window || CGRectIsEmpty(window.bounds) ||
      window.bounds.size.width <= 0 || window.bounds.size.height <= 0) {
    self.pendingCapture = nil;
    self.captureInProgress = NO;
    return;
  }

  NSString *reasonLabel = [RJCaptureHeuristics stringForReason:reason];
  if (reasonLabel.length > 0) {
    RJLogDebug(@"CaptureEngine: %@", reasonLabel);
  }

  RJ_TIME_START;

  self.pendingCapture = nil;

  self.framesSinceSessionStart++;
  self.captureInProgress = YES;

  RJViewHierarchyScanResult *scanForFrame =
      pending.scanResult ?: [[RJViewHierarchyScanResult alloc] init];
  RJViewHierarchyScanResult *maskScanResult = scanForFrame;
  NSString *currentSignature = pending.layoutSignature;
  BOOL hasBlockedSurface = (scanForFrame.cameraFrames.count > 0 ||
                            scanForFrame.webViewFrames.count > 0 ||
                            scanForFrame.videoFrames.count > 0);

  BOOL layoutChanged =
      (currentSignature.length == 0 ||
       ![currentSignature isEqualToString:self.lastSerializedSignature]);
  self.lastSerializedSignature = currentSignature;

  RJCaptureLayout targetLayout = [self currentCaptureLayoutForWindow:window];
  CGFloat targetScale = targetLayout.unifiedScale;

  RJCaptureLayout nativeLayout = targetLayout;
  CGFloat screenScale =
      window.screen ? window.screen.scale : [UIScreen mainScreen].scale;
  size_t nativeW = (size_t)(window.bounds.size.width * screenScale);
  size_t nativeH = (size_t)(window.bounds.size.height * screenScale);
  nativeW = (nativeW / 2) * 2;
  nativeH = (nativeH / 2) * 2;
  nativeLayout.pixelWidth = nativeW;
  nativeLayout.pixelHeight = nativeH;
  nativeLayout.unifiedScale = screenScale;

  if (!_pixelBufferPool || _poolWidth != targetLayout.pixelWidth ||
      _poolHeight != targetLayout.pixelHeight) {
    [self createPixelBufferPoolWithWidth:targetLayout.pixelWidth
                                  height:targetLayout.pixelHeight];
  }

  __weak typeof(self) weakSelf = self;

  @autoreleasepool {
    CVPixelBufferRef nativePixelBuffer = NULL;
    BOOL didRender = NO;
    BOOL usingCachedBuffer = NO;
    RJViewHierarchyScanResult *cachedMaskResult = nil;

    if (shouldRender) {
      RJ_TIME_START_NAMED(screenshot);
      nativePixelBuffer = [self capturePixelBufferFromWindow:window
                                                  withLayout:nativeLayout
                                                  scanResult:scanForFrame];
      RJ_TIME_END_NAMED(screenshot, RJPerfMetricScreenshot);
      didRender = (nativePixelBuffer != NULL);
    }

    if (!nativePixelBuffer && self.lastCapturedPixelBuffer) {
      if (!hasBlockedSurface && self.lastCapturedHadBlockedSurface &&
          self.lastSafePixelBuffer) {
        nativePixelBuffer = CVPixelBufferRetain(self.lastSafePixelBuffer);
        usingCachedBuffer = YES;
        cachedMaskResult = self.lastSafeMaskScanResult;
      } else {
        nativePixelBuffer = CVPixelBufferRetain(self.lastCapturedPixelBuffer);
        usingCachedBuffer = YES;
        cachedMaskResult = self.lastMaskScanResult;
      }
      if (shouldRender) {
        RJLogDebug(
            @"CaptureEngine: %@",
            [RJCaptureHeuristics
                stringForReason:RJCaptureHeuristicsReasonRenderFailedReuse]);
        reason = RJCaptureHeuristicsReasonRenderFailedReuse;
      }
    }

    if (usingCachedBuffer && cachedMaskResult) {
      maskScanResult = cachedMaskResult;
    }

    if (!nativePixelBuffer) {
      self.captureInProgress = NO;
      return;
    }

    if (didRender) {
      if (self.lastCapturedPixelBuffer) {
        CVPixelBufferRelease(self.lastCapturedPixelBuffer);
      }
      self.lastCapturedPixelBuffer = CVPixelBufferRetain(nativePixelBuffer);
      [self.captureHeuristics recordRenderedSignature:currentSignature
                                               atTime:now];
      self.lastMaskScanResult = scanForFrame;
      self.lastCapturedHadBlockedSurface = hasBlockedSurface;
      if (!hasBlockedSurface) {
        if (self.lastSafePixelBuffer) {
          CVPixelBufferRelease(self.lastSafePixelBuffer);
        }
        self.lastSafePixelBuffer = CVPixelBufferRetain(nativePixelBuffer);
        self.lastSafeMaskScanResult = scanForFrame;
      }
    }

    RJ_TIME_END(RJPerfMetricFrame);
    RJ_PERF_DUMP_IF_NEEDED();

    NSTimeInterval timestamp = pending.timestamp;

    dispatch_async(self.encodingQueue, ^{
      @autoreleasepool {
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf || strongSelf.isShuttingDown) {
          CVPixelBufferRelease(nativePixelBuffer);
          return;
        }

        CVPixelBufferRef scaledBuffer = NULL;
        if (nativePixelBuffer) {
          RJ_TIME_START_NAMED(downscale);
          RJDownscaleQuality quality = RJDownscaleQualityBalanced;
          if (strongSelf.internalPerformanceLevel == RJPerformanceLevelNormal &&
              strongSelf.captureScale >= 0.5) {
            quality = RJDownscaleQualityHigh;
          }
          scaledBuffer =
              [RJPixelBufferDownscaler downscale:nativePixelBuffer
                                             toW:targetLayout.pixelWidth
                                             toH:targetLayout.pixelHeight
                                       usingPool:strongSelf.pixelBufferPool
                                         quality:quality];
          RJ_TIME_END_NAMED(downscale, RJPerfMetricDownscale);
        }

        CVPixelBufferRelease(nativePixelBuffer);

        if (!scaledBuffer) {
          RJLogWarning(@"CaptureEngine: Downscale failed");
          return;
        }

        if (strongSelf.privacyMask) {
          CGFloat safeScale =
              (isfinite(targetScale) && targetScale > 0.0) ? targetScale : 1.0;
          [strongSelf.privacyMask applyToPixelBuffer:scaledBuffer
                                      withScanResult:maskScanResult
                                               scale:safeScale];
        }

        RJ_TIME_START_NAMED(encode);
        [strongSelf.internalVideoEncoder appendPixelBuffer:scaledBuffer
                                                 timestamp:timestamp];
        RJ_TIME_END_NAMED(encode, RJPerfMetricEncode);

        CVPixelBufferRelease(scaledBuffer);
      }
    });

    self.captureInProgress = NO;

    self.framesSinceHierarchy++;
    BOOL shouldSerialize = !scanForFrame.scrollActive;

    if (shouldSerialize &&
        (self.framesSinceHierarchy == 1 ||
         (layoutChanged &&
          self.framesSinceHierarchy >= self.hierarchyCaptureInterval) ||
         self.framesSinceHierarchy >= 30)) {

      NSString *screenName = self.currentScreenName;

      RJ_TIME_START_NAMED(serialize);
      NSDictionary *hierarchy = nil;
      @try {
        if (self.internalViewSerializer) {
          hierarchy =
              [self.internalViewSerializer serializeWindow:window
                                            withScanResult:scanForFrame];
        }
      } @catch (NSException *exception) {
        RJLogWarning(@"CaptureEngine: View serialization failed: %@",
                     exception);
      }
      RJ_TIME_END_NAMED(serialize, RJPerfMetricViewSerialize);

      if (hierarchy && hierarchy.count > 0) {
        if (screenName) {
          NSMutableDictionary *enriched = [hierarchy mutableCopy];
          enriched[@"screenName"] = screenName;
          [self.hierarchySnapshots addObject:enriched];
        } else {
          [self.hierarchySnapshots addObject:hierarchy];
        }
      }

      self.framesSinceHierarchy = 0;
    }
  }
}

- (void)logCaptureDecision:(RJCaptureHeuristicsDecision *)decision
                   pending:(RJCapturePendingCapture *)pending {
  if (!decision) {
    return;
  }
  NSString *reason = [RJCaptureHeuristics stringForReason:decision.reason];
  if (reason.length == 0) {
    return;
  }
  NSTimeInterval remainingMs =
      pending ? (pending.deadline - CACurrentMediaTime()) * 1000.0 : 0;
  RJLogDebug(@"CaptureEngine: %@ (deadline=%.0fms)", reason, remainingMs);
}

- (CVPixelBufferRef)capturePixelBufferFromWindow:(UIWindow *)window
                                      withLayout:(RJCaptureLayout)layout
                                      scanResult:(RJViewHierarchyScanResult *)
                                                     scanResult {
  if (!window)
    return NULL;
  if (window.isHidden || window.alpha <= 0.01) {
    return NULL;
  }

  // Optimize window check (A2)
  CGRect winBounds = window.bounds;
  if (!isfinite(winBounds.origin.x) || !isfinite(winBounds.origin.y) ||
      !isfinite(winBounds.size.width) || !isfinite(winBounds.size.height)) {
    return NULL;
  }
  if (CGRectIsEmpty(winBounds) || winBounds.size.width <= 0 ||
      winBounds.size.height <= 0) {
    return NULL;
  }

  // CRITICAL: Skip during background
  if (self.isInBackground)
    return NULL;

  // Start Immediately - Removed Warmup Delay logic that caused missing startup
  // frames

  size_t width = layout.pixelWidth;
  size_t height = layout.pixelHeight;

  if (width < 2 || height < 2)
    return NULL;

  CGFloat contextScale = layout.unifiedScale;
  CGSize sizePoints = window.bounds.size;
  if (!isfinite(sizePoints.width) || !isfinite(sizePoints.height) ||
      sizePoints.width <= 0 || sizePoints.height <= 0) {
    return NULL;
  }

  // Re-verify context scale based on pixel dimensions to be exact
  if (sizePoints.width > 0) {
    contextScale = (CGFloat)width / sizePoints.width;
  }
  if (!isfinite(contextScale) || contextScale <= 0) {
    return NULL;
  }

  RJ_TIME_START_NAMED(buffer);
  CVPixelBufferRef pixelBuffer =
      [self createNativePixelBufferFromPoolWithWidth:width height:height];
  RJ_TIME_END_NAMED(buffer, RJPerfMetricBufferAlloc);

  if (!pixelBuffer) {
    RJLogWarning(@"CaptureEngine: Failed to obtain pixel buffer");
    return NULL;
  }

  CVPixelBufferLockBaseAddress(pixelBuffer, 0);
  void *baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer);
  size_t bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer);

  if (!self.commonColorSpace) {
    self.commonColorSpace = CGColorSpaceCreateDeviceRGB();
  }
  CGColorSpaceRef colorSpace = self.commonColorSpace;

  CGContextRef context = CGBitmapContextCreate(
      baseAddress, width, height, 8, bytesPerRow, colorSpace,
      kCGImageAlphaNoneSkipFirst | kCGBitmapByteOrder32Little);

  if (!context) {
    CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);
    CVPixelBufferRelease(pixelBuffer);
    return NULL;
  }

  if (self.internalPerformanceLevel == RJPerformanceLevelMinimal) {
    CGContextSetInterpolationQuality(context, kCGInterpolationNone);
    CGContextSetShouldAntialias(context, false);
    CGContextSetAllowsAntialiasing(context, false);
  } else {
    CGContextSetInterpolationQuality(context, kCGInterpolationDefault);
    CGContextSetShouldAntialias(context, true);
    CGContextSetAllowsAntialiasing(context, true);
  }

  CGContextScaleCTM(context, contextScale, -contextScale);
  CGContextTranslateCTM(context, 0, -sizePoints.height);

  memset(baseAddress, 0xFF, bytesPerRow * height);

  UIGraphicsPushContext(context);

  RJ_TIME_START_NAMED(render);
  BOOL didDraw = NO;
  @try {
    didDraw = [window drawViewHierarchyInRect:window.bounds
                           afterScreenUpdates:NO];
  } @catch (NSException *exception) {
    RJLogWarning(@"CaptureEngine: drawViewHierarchy failed: %@", exception);
    didDraw = NO;
  }
  RJ_TIME_END_NAMED(render, RJPerfMetricRender);

  UIGraphicsPopContext();
  CGContextRelease(context);
  CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);

  if (!didDraw) {
    CVPixelBufferRelease(pixelBuffer);
    return NULL;
  }

  return pixelBuffer;
}

- (void)uploadCurrentHierarchySnapshots {
  if (!self.internalSegmentUploader || self.hierarchySnapshots.count == 0)
    return;

  if (!self.uploadsEnabled) {
    [self.hierarchySnapshots removeAllObjects];
    return;
  }

  @try {
    NSError *error = nil;
    NSData *jsonData =
        [NSJSONSerialization dataWithJSONObject:self.hierarchySnapshots
                                        options:0
                                          error:&error];
    if (!jsonData || error) {
      if (error) {
        RJLogWarning(@"CaptureEngine: Failed to serialize hierarchy: %@",
                     error);
      }
      return;
    }

    NSTimeInterval timestamp = [self currentTimestamp];
    [self.internalSegmentUploader uploadHierarchy:jsonData
                                        sessionId:self.internalSessionId
                                        timestamp:timestamp
                                       completion:nil];

    [self.hierarchySnapshots removeAllObjects];
  } @catch (NSException *exception) {
    RJLogWarning(@"CaptureEngine: Upload hierarchy failed: %@", exception);
  }
}

- (NSTimeInterval)currentTimestamp {
  return [[NSDate date] timeIntervalSince1970] * 1000.0;
}

#pragma mark - RJVideoEncoderDelegate

- (void)videoEncoderDidFinishSegment:(NSURL *)segmentURL
                           sessionId:(NSString *)sessionId
                           startTime:(NSTimeInterval)startTime
                             endTime:(NSTimeInterval)endTime
                          frameCount:(NSInteger)frameCount {

  dispatch_async(self.encodingQueue, ^{
    RJLogDebug(@"CaptureEngine: videoEncoderDidFinishSegment: %@ (%ld frames, "
               @"%.1fs), sessionId=%@",
               segmentURL.lastPathComponent, (long)frameCount,
               (endTime - startTime) / 1000.0, sessionId);

    if (!self.uploadsEnabled) {
      if (segmentURL) {
        [[NSFileManager defaultManager] removeItemAtURL:segmentURL error:nil];
      }
      [self.hierarchySnapshots removeAllObjects];
      RJLogInfo(@"CaptureEngine: Segment upload skipped (uploads disabled)");
      return;
    }

    if (self.internalSegmentUploader && sessionId) {
      RJLogDebug(@"CaptureEngine: Calling uploadVideoSegment");
      [self.internalSegmentUploader
          uploadVideoSegment:segmentURL
                   sessionId:sessionId
                   startTime:startTime
                     endTime:endTime
                  frameCount:frameCount
                  completion:^(BOOL success, NSError *error) {
                    if (!success) {
                      RJLogWarning(@"CaptureEngine: Segment upload FAILED: %@",
                                   error);
                    } else {
                      RJLogInfo(@"CaptureEngine: Segment upload SUCCESS: %@",
                                segmentURL.lastPathComponent);
                    }
                  }];
    } else if (!sessionId) {
      RJLogWarning(@"CaptureEngine: Cannot upload segment (sessionId is nil)");
    } else {
      RJLogWarning(
          @"CaptureEngine: Cannot upload segment (segmentUploader is nil)");
    }

    [self uploadCurrentHierarchySnapshots];

    if (self.internalIsRecording && !self.isShuttingDown) {
      RJLogDebug(
          @"CaptureEngine: Segment finished, auto-start new on next frame");
    }
  });
}

- (void)videoEncoderDidFailWithError:(NSError *)error {
  RJLogError(@"Video encoder failed: %@", error);

  if (self.internalIsRecording) {
    RJLogWarning(@"Stopping recording due to encoder failure");
    [self stopSession];
  }
}

#pragma mark - App Lifecycle

- (void)pauseVideoCapture {
  [self pauseVideoCaptureWithSynchronousFinish:NO];
}

- (void)pauseVideoCaptureSync {
  [self pauseVideoCaptureWithSynchronousFinish:YES];
}

- (void)pauseVideoCaptureWithSynchronousFinish:(BOOL)synchronous {
  RJLogDebug(@"CaptureEngine: pauseVideoCapture (isRecording=%d, sync=%d)",
             self.internalIsRecording, synchronous);

  if (!self.internalIsRecording) {
    RJLogDebug(@"CaptureEngine: pauseVideoCapture - NOT recording");
    return;
  }

  RJLogInfo(@"CaptureEngine: Pausing video capture (sync=%d)", synchronous);

  self.captureInProgress = NO;

  if (synchronous) {
    [self teardownDisplayLink];
  } else {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self teardownDisplayLink];
    });
  }

  if (self.internalVideoEncoder) {
    self.internalIsRecording = NO;

    if (synchronous) {
      void (^finishSync)(void) = ^{
        RJLogDebug(@"CaptureEngine: Calling finishSegmentSync");
        [self.internalVideoEncoder finishSegmentSync];
      };
      if (dispatch_get_specific(kRJEncodingQueueKey)) {
        finishSync();
      } else {
        dispatch_sync(self.encodingQueue, finishSync);
      }
    } else {
      dispatch_async(self.encodingQueue, ^{
        RJLogDebug(@"CaptureEngine: Calling finishSegment (async)");
        [self.internalVideoEncoder finishSegment];
      });
    }
  } else {
    RJLogWarning(@"CaptureEngine: videoEncoder is nil, cannot finish segment");
  }

  if (self.hierarchySnapshots.count > 0) {
    RJLogDebug(@"CaptureEngine: Uploading %lu pending hierarchy snapshots",
               (unsigned long)self.hierarchySnapshots.count);
    [self uploadCurrentHierarchySnapshots];
  }
}

- (void)resumeVideoCapture {
  RJLogDebug(
      @"CaptureEngine: resumeVideoCapture (isRecording=%d, sessionId=%@)",
      self.internalIsRecording, self.internalSessionId);

  if (self.internalSessionId == nil) {
    RJLogDebug(@"CaptureEngine: resumeVideoCapture - NO active session");
    return;
  }

  self.internalIsRecording = YES;

  RJLogInfo(@"CaptureEngine: Resuming video capture");

  self.captureInProgress = NO;
  self.lastIntentTime = 0;

  self.internalPerformanceLevel =
      RJPerformanceLevelNormal;

  self.pendingCapture = nil;
  self.pendingCaptureGeneration = 0;
  [self.captureHeuristics reset];
  self.lastSerializedSignature = nil;
  self.lastMaskScanResult = nil;
  self.lastSafeMaskScanResult = nil;
  self.lastCapturedHadBlockedSurface = NO;
  if (self.lastSafePixelBuffer) {
    CVPixelBufferRelease(self.lastSafePixelBuffer);
    self.lastSafePixelBuffer = NULL;
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    UIWindow *window = self.windowProvider ? self.windowProvider() : nil;
    if (window && self.internalVideoEncoder) {
      RJLogInfo(@"CaptureEngine: Resuming capture...");

      [self setupDisplayLink];

    } else {
      RJLogWarning(@"[RJ-CAPTURE] Cannot resume - window=%@ encoder=%@",
                   window ? @"exists" : @"nil",
                   self.internalVideoEncoder ? @"exists" : @"nil");
    }
  });
}

#pragma mark - Event Notifications (Metadata Enrichment)

- (void)notifyNavigationToScreen:(NSString *)screenName {
  if (!self.internalIsRecording)
    return;

  if (![screenName isEqualToString:self.currentScreenName]) {
    NSTimeInterval now = CACurrentMediaTime();
    self.currentScreenName = screenName;
    RJLogDebug(@"Navigation to screen: %@ (forcing layout refresh)",
               screenName);

    [self.captureHeuristics invalidateSignature];
    [self.captureHeuristics recordNavigationEventAtTime:now];
    self.lastSerializedSignature = nil;
    [self requestDefensiveCaptureAfterDelay:kRJDefensiveCaptureDelayNavigation
                                     reason:@"navigation"];
  }
}

- (BOOL)shouldTreatGestureAsMap:(NSString *)gestureType
                            now:(NSTimeInterval)now {
  if (gestureType.length == 0) {
    return NO;
  }
  if (self.lastMapPresenceTime <= 0 ||
      (now - self.lastMapPresenceTime) > kRJMapPresenceWindowSeconds) {
    return NO;
  }

  NSString *lower = [gestureType lowercaseString];
  return ([lower hasPrefix:@"scroll"] || [lower hasPrefix:@"pan"] ||
          [lower hasPrefix:@"pinch"] || [lower hasPrefix:@"zoom"] ||
          [lower hasPrefix:@"rotate"] || [lower hasPrefix:@"swipe"] ||
          [lower hasPrefix:@"drag"]);
}

- (void)notifyGesture:(NSString *)gestureType {
  if (!self.internalIsRecording)
    return;
  RJLogDebug(@"Gesture: %@", gestureType);
  NSTimeInterval now = CACurrentMediaTime();
  BOOL isScroll = (gestureType.length > 0 && [gestureType hasPrefix:@"scroll"]);
  BOOL mapGesture = [self shouldTreatGestureAsMap:gestureType now:now];
  if (isScroll) {
    [self.captureHeuristics recordTouchEventAtTime:now];
  } else {
    [self.captureHeuristics recordInteractionEventAtTime:now];
  }

  if (mapGesture) {
    [self.captureHeuristics recordMapInteractionAtTime:now];
    [self requestDefensiveCaptureAfterDelay:kRJDefensiveCaptureDelayMap
                                     reason:@"map"];
    return;
  }

  if (isScroll) {
    [self requestDefensiveCaptureAfterDelay:kRJDefensiveCaptureDelayScroll
                                     reason:@"scroll"];
  } else {
    [self requestDefensiveCaptureAfterDelay:kRJDefensiveCaptureDelayInteraction
                                     reason:@"interaction"];
  }
}

- (void)notifyReactNativeCommit {
  if (!self.internalIsRecording) {
    return;
  }

  [self.captureHeuristics invalidateSignature];
  [self.captureHeuristics recordInteractionEventAtTime:CACurrentMediaTime()];
  [self requestDefensiveCaptureAfterDelay:kRJDefensiveCaptureDelayInteraction
                                   reason:@"rn_commit"];
}

- (void)notifyUIReady {
  RJLogInfo(@"CaptureEngine: UI is ready for capture");
  self.uiReadyForCapture = YES;
}

#pragma mark - RJPerformanceManagerDelegate

- (void)performanceManagerDidChangeLevel:(RJPerformanceLevel)level {
  self.internalPerformanceLevel = level;

  NSString *levelName;
  switch (level) {
  case RJPerformanceLevelNormal:
    levelName = @"Normal";
    break;
  case RJPerformanceLevelReduced:
    levelName = @"Reduced (50% frames, 35% scale)";
    break;
  case RJPerformanceLevelMinimal:
    levelName = @"Minimal (25% frames, 25% scale)";
    break;
  case RJPerformanceLevelPaused:
    levelName = @"Paused (stopped)";
    break;
  }

  RJLogInfo(@"CaptureEngine: Performance level changed to %@", levelName);

  if (self.internalVideoEncoder) {
    switch (level) {
    case RJPerformanceLevelReduced:
      self.internalVideoEncoder.captureScale = MIN(self.captureScale, 0.25);
      break;
    case RJPerformanceLevelMinimal:
      self.internalVideoEncoder.captureScale = MIN(self.captureScale, 0.15);
      break;
    default:
      self.internalVideoEncoder.captureScale = self.captureScale;
      break;
    }
  }
}

@end
