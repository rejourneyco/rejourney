//
//  RJVideoEncoder.h
//  Rejourney
//
//  H.264 video segment encoder using AVFoundation/VideoToolbox.
//  Provides continuous 1 FPS video capture with predictable CPU usage.
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

#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
//

#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Delegate protocol for receiving completed video segment notifications.
 */
@protocol RJVideoEncoderDelegate <NSObject>

/**
 * Called when a video segment has been finalized and is ready for upload.
 *
 * @param segmentURL Local file URL of the completed .mp4 segment.
 * @param sessionId Session ID for this segment.
 * @param startTime Segment start time in epoch milliseconds.
 * @param endTime Segment end time in epoch milliseconds.
 * @param frameCount Number of frames encoded in this segment.
 */
- (void)videoEncoderDidFinishSegment:(NSURL *)segmentURL
                           sessionId:(NSString *)sessionId
                           startTime:(NSTimeInterval)startTime
                             endTime:(NSTimeInterval)endTime
                          frameCount:(NSInteger)frameCount;

@optional
/**
 * Called when encoding fails.
 *
 * @param error The error that occurred during encoding.
 */
- (void)videoEncoderDidFailWithError:(NSError *)error;

@end

/**
 * H.264 video segment encoder for session recording.
 *
 * Encodes UIImage frames into H.264 video segments using AVAssetWriter.
 * Each segment is a self-contained .mp4 file that can be uploaded
 * independently.
 *
 * ## Features
 * - H.264 Baseline profile for maximum compatibility
 * - Configurable bitrate (default 600 kbps for 1 FPS)
 * - Automatic segment rotation after N frames
 * - Thread-safe frame appending
 *
 * ## Usage
 * ```objc
 * RJVideoEncoder *encoder = [[RJVideoEncoder alloc] init];
 * encoder.delegate = self;
 * encoder.fps = 1;
 * encoder.framesPerSegment = 60; // 60 second segments
 *
 * [encoder startSegmentWithSize:CGSizeMake(375, 812)];
 * [encoder appendFrame:screenshotImage timestamp:currentTimeMs];
 * // ... encoder auto-rotates segments
 * [encoder finishSegment]; // On session end
 * ```
 *
 * @note This class is designed to be used from the main thread.
 */
@interface RJVideoEncoder : NSObject

#pragma mark - Configuration

/// Delegate for receiving segment completion notifications.
@property(nonatomic, weak, nullable) id<RJVideoEncoderDelegate> delegate;

/// Target video bitrate in bits per second. Default: 600000 (600 kbps).
/// Lower values = smaller files but reduced quality.
@property(nonatomic, assign) NSInteger targetBitrate;

/// Number of frames per segment before auto-rotation. Default: 60.
/// At 1 FPS, this equals 60 second segments.
@property(nonatomic, assign) NSInteger framesPerSegment;

/// Target frames per second for video timing. Default: 1.
@property(nonatomic, assign) NSInteger fps;

/// Capture scale factor as a fraction of device screen scale (0.0-1.0).
/// Default: 0.35. Example: on a 3x device, 0.35 -> ~1.0 px/pt. Lower values
/// reduce file size and CPU but also quality.
@property(nonatomic, assign) CGFloat captureScale;

#pragma mark - State

/// Whether the encoder is currently recording a segment.
@property(nonatomic, readonly) BOOL isRecording;

/// Current segment's frame count.
@property(nonatomic, readonly) NSInteger currentFrameCount;

/// Current session ID being recorded.
@property(nonatomic, copy, readonly, nullable) NSString *sessionId;

#pragma mark - Lifecycle

/**
 * Sets the session ID for the current recording session.
 * Should be called before starting segments.
 *
 * @param sessionId The unique session identifier.
 */
- (void)setSessionId:(NSString *)sessionId;

/**
 * Starts a new video segment with the specified frame size.
 * If a segment is already in progress, it will be finished first.
 *
 * @param size The frame size in points (converted to pixels using device scale,
 *             then multiplied by captureScale).
 * @return YES if segment started successfully, NO otherwise.
 */
- (BOOL)startSegmentWithSize:(CGSize)size;

/**
 * Appends a frame to the current video segment.
 * If the segment reaches framesPerSegment, it auto-rotates to a new segment.
 *
 * @param frame The UIImage screenshot to encode.
 * @param timestamp The capture timestamp in epoch milliseconds.
 * @return YES if frame was appended successfully, NO otherwise.
 */
- (BOOL)appendFrame:(UIImage *)frame timestamp:(NSTimeInterval)timestamp;

/**
 * Appends a CVPixelBuffer directly to the current video segment.
 * Best performance: avoids internal buffer creation and copying.
 *
 * @param pixelBuffer The CVPixelBufferRef containing the frame
 * (kCVPixelFormatType_32BGRA)
 * @param timestamp The capture timestamp in epoch milliseconds.
 * @return YES if frame was appended successfully, NO otherwise.
 */
- (BOOL)appendPixelBuffer:(CVPixelBufferRef)pixelBuffer
                timestamp:(NSTimeInterval)timestamp;

/**
 * Finishes the current segment and notifies the delegate.
 * Call this when the session ends or app backgrounds.
 */
- (void)finishSegment;

/**
 * Finishes the current segment SYNCHRONOUSLY.
 * Use during app termination/background when async completion may not fire.
 * Blocks until segment is written and delegate is called.
 * Has a 5 second timeout to prevent app freeze.
 */
- (void)finishSegmentSync;

/**
 * Cancels the current segment without saving.
 * Use when the session is aborted.
 */
- (void)cancelSegment;

/**
 * Cleans up encoder resources and pending segments.
 * Call when the capture engine is destroyed.
 */
- (void)cleanup;

/**
 * Emergency synchronous flush for crash handling.
 *
 * When a crash occurs, this method attempts to synchronously finalize
 * the current video segment so it can be recovered on next launch.
 *
 * This is a best-effort operation that:
 * 1. Marks the video input as finished
 * 2. Attempts to finalize the asset writer with a short timeout
 * 3. Saves segment metadata to disk for recovery
 *
 * @warning This method should ONLY be called from a crash handler.
 *          It may block for a short time and is not suitable for normal use.
 *
 * @return YES if segment was successfully finalized, NO otherwise.
 */
- (BOOL)emergencyFlushSync;

/**
 * Checks if there is a pending video segment from a crash.
 * Call this on app launch to recover any incomplete segments.
 *
 * @return Segment metadata dictionary if a pending segment exists, nil
 * otherwise.
 */
+ (nullable NSDictionary *)pendingCrashSegmentMetadata;

/**
 * Clears the pending crash segment metadata after recovery.
 */
+ (void)clearPendingCrashSegmentMetadata;

/**
 * Pre-warms the H.264 encoder asynchronously to reduce first-frame latency.
 *
 * This method initializes the VideoToolbox hardware encoder by encoding a
 * minimal dummy frame. Call this early (e.g., during CaptureEngine init)
 * to front-load the ~50-100ms encoder initialization overhead.
 *
 * @note Safe to call multiple times - subsequent calls are no-ops.
 * @note Runs on a background queue and returns immediately.
 */
- (void)prewarmEncoderAsync;

/**
 * Prepares the encoder with the expected frame size.
 * Creates the AVAssetWriter and inputs ahead of time to avoid first-frame
 * latency.
 */
- (void)prepareEncoderWithSize:(CGSize)size;

@end

NS_ASSUME_NONNULL_END
