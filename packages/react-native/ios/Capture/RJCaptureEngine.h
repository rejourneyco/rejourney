//
//  RJCaptureEngine.h
//  Rejourney
//
//  Video capture orchestrator with H.264 encoding.
//
//  The capture engine is responsible for:
//  - Fixed 1 FPS video segment capture with H.264 encoding
//  - View hierarchy serialization for debugging and privacy
//  - Adapting to system conditions (memory, thermal, battery)
//  - Uploading video segments via presigned URLs
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

#import "../Core/RJTypes.h"
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

@class RJVideoEncoder;
@class RJViewSerializer;
@class RJSegmentUploader;
@class RJPrivacyMask;

@protocol RJVideoEncoderDelegate;

NS_ASSUME_NONNULL_BEGIN

/**
 * Block type for providing the key window.
 * The engine uses this to avoid direct UIKit coupling.
 */
typedef UIWindow *_Nullable (^RJWindowProvider)(void);

/**
 * Video capture orchestrator with H.264 segment encoding.
 *
 * Captures screenshots at 1 FPS, encodes them as H.264 video
 * segments, and uploads via presigned URLs. Also captures view hierarchy JSON
 * for debugging and element identification.
 *
 * ## Features
 * - H.264 video segment encoding (60 second segments)
 * - View hierarchy serialization for breadcrumb overlays
 * - Privacy masking for sensitive content
 * - Memory-aware capture (respects system memory pressure)
 * - Thermal throttling (reduces to 0.5 FPS when hot)
 * - Battery-aware capture scheduling
 * - Adaptive scale reduction under load
 *
 * ## Usage
 * ```objc
 * RJCaptureEngine *engine = [[RJCaptureEngine alloc] initWithWindowProvider:^{
 *     return [self getKeyWindow];
 * }];
 *
 * // Configure uploader before starting session
 * [engine configureSegmentUploaderWithBaseURL:@"https://ingest.rejourney.io"
 *                                      apiKey:@"rj_..."
 *                                   projectId:@"proj_..."];
 *
 * [engine startSessionWithId:@"session_123"];
 * // ... later ...
 * [engine stopSession];
 * ```
 *
 * @note This class is not thread-safe. Call all methods from the main thread.
 */
@interface RJCaptureEngine : NSObject <RJVideoEncoderDelegate>

#pragma mark - Video Capture Configuration

/// Capture scale factor as a fraction of device screen scale (0.0-1.0).
/// Example: on a 3x device, 0.35 -> ~1.0 px/pt. Default: 0.35
@property(nonatomic, assign) CGFloat captureScale;

/// Target FPS for video capture. Default: 1.
@property(nonatomic, assign) NSInteger videoFPS;

/// Number of frames per video segment. Default: 60 (60 seconds at 1 FPS).
@property(nonatomic, assign) NSInteger framesPerSegment;

/// Target video bitrate in bits per second. Default: 400000 (400 kbps).
@property(nonatomic, assign) NSInteger videoBitrate;

/// Capture view hierarchy every N frames. Default: 5 (every 5s at 1 FPS).
@property(nonatomic, assign) NSInteger hierarchyCaptureInterval;

/// Whether segment uploads are enabled. Default: YES.
@property(nonatomic, assign) BOOL uploadsEnabled;

#pragma mark - Adaptive Behavior

/// Whether to adjust quality based on memory pressure. Default: YES
@property(nonatomic, assign) BOOL adaptiveQualityEnabled;

/// Whether to reduce captures when device is hot. Default: YES
@property(nonatomic, assign) BOOL thermalThrottleEnabled;

/// Whether to reduce captures on low battery. Default: YES
@property(nonatomic, assign) BOOL batteryAwareEnabled;

#pragma mark - Privacy Configuration

/// Whether to mask text input fields during capture. Default: YES
@property(nonatomic, assign) BOOL privacyMaskTextInputs;

/// Whether to mask camera preview views during capture. Default: YES
@property(nonatomic, assign) BOOL privacyMaskCameraViews;

/// Whether to mask web views during capture. Default: YES
@property(nonatomic, assign) BOOL privacyMaskWebViews;

/// Whether to mask video layers during capture. Default: YES
@property(nonatomic, assign) BOOL privacyMaskVideoLayers;

/// Direct access to the privacy mask for manual nativeID masking
@property(nonatomic, readonly) RJPrivacyMask *privacyMask;

#pragma mark - Read-only State

/// Current performance level based on system conditions
@property(nonatomic, readonly) RJPerformanceLevel currentPerformanceLevel;

/// Whether a capture session is currently active
@property(nonatomic, readonly) BOOL isRecording;

/// Whether the UI is ready for capture (e.g. splash screen hidden)
@property(atomic, readonly) BOOL uiReadyForCapture;

/// Current session ID
@property(nonatomic, readonly, nullable) NSString *sessionId;

/// Video encoder for segment capture
@property(nonatomic, readonly, nullable) RJVideoEncoder *videoEncoder;

/// View hierarchy serializer
@property(nonatomic, readonly, nullable) RJViewSerializer *viewSerializer;

/// Segment uploader
@property(nonatomic, readonly, nullable) RJSegmentUploader *segmentUploader;

#pragma mark - Initialization

/**
 * Creates a new capture engine with the specified window provider.
 *
 * @param windowProvider Block that returns the key window for capture.
 *                       Called on main thread during capture operations.
 * @return A new capture engine instance.
 */
- (instancetype)initWithWindowProvider:(RJWindowProvider)windowProvider;

/// Unavailable. Use initWithWindowProvider: instead.
- (instancetype)init NS_UNAVAILABLE;

#pragma mark - Configuration

/**
 * Configures the segment uploader for video capture.
 * Call this BEFORE starting a session.
 *
 * @param baseURL The API base URL (e.g., "https://ingest.rejourney.io")
 * @param apiKey The public API key (e.g., "rj_...")
 * @param projectId The project identifier
 */
- (void)configureSegmentUploaderWithBaseURL:(NSString *)baseURL
                                     apiKey:(NSString *)apiKey
                                  projectId:(NSString *)projectId;

#pragma mark - Session Lifecycle

/**
 * Starts a new video capture session.
 *
 * @param sessionId Unique identifier for the session.
 */
- (void)startSessionWithId:(NSString *)sessionId;

/**
 * Stops the current capture session.
 * Finishes any pending video segment and uploads it.
 */
- (void)stopSession;

/**
 * Stops the current capture session SYNCHRONOUSLY.
 * Use during app termination when async completion may not fire.
 * Blocks until segment is finished and upload is initiated.
 */
- (void)stopSessionSync;

/**
 * Waits for pending segment uploads to finish (best-effort).
 * Use during termination to avoid missing video on session end.
 */
- (void)waitForPendingSegmentUploadsWithTimeout:(NSTimeInterval)timeout;

#pragma mark - App Lifecycle Events

/**
 * Pauses video capture and finishes the current segment.
 * Call when app enters background to ensure the segment is uploaded.
 */
- (void)pauseVideoCapture;

/**
 * Pauses video capture SYNCHRONOUSLY.
 * Use during app termination/background when async completion may not fire.
 * Blocks until segment is written and upload is initiated.
 * Has a timeout to prevent app freeze.
 */
- (void)pauseVideoCaptureSync;

/**
 * Resumes video capture after a pause.
 * Starts a new segment from the current screen state.
 */
- (void)resumeVideoCapture;

#pragma mark - Event Notifications (Optional - for enhanced metadata)

/**
 * Notifies the engine of a navigation event.
 * This is optional - video capture continues regardless.
 * Useful for attaching screen names to hierarchy snapshots.
 *
 * @param screenName Name of the screen being navigated to.
 */
- (void)notifyNavigationToScreen:(NSString *)screenName;

/**
 * Notifies the engine of a gesture event.
 * This is optional - video captures gestures visually.
 * Useful for logging touch events alongside video.
 *
 * @param gestureType The type of gesture (e.g., "tap", "swipe_left").
 */
- (void)notifyGesture:(NSString *)gestureType;

/**
 * Notifies the engine of a React Native commit/mount boundary.
 * This is optional and can be called from RN render pipeline hooks.
 */
- (void)notifyReactNativeCommit;

/**
 * Notifies the engine that the UI is ready for capture.
 * Call this after splash screen is hidden and initial layout is complete.
 */
- (void)notifyUIReady;

#pragma mark - Memory Management

/**
 * Handles a memory warning by reducing quality temporarily.
 * Called automatically on UIApplicationDidReceiveMemoryWarningNotification.
 */
- (void)handleMemoryWarning;

@end

NS_ASSUME_NONNULL_END
