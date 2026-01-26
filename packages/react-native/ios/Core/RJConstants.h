//
//  RJConstants.h
//  Rejourney
//
//  SDK-wide constants and configuration defaults.
//  This file contains all magic numbers and configuration values
//  used throughout the Rejourney SDK.
//
//  Video Capture Model:
//  - H.264 video segments at 1 FPS
//  - JSON view hierarchy snapshots
//  - Motion events for gesture reconstruction
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

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

#pragma mark - SDK Version

/// Current SDK version string
FOUNDATION_EXTERN NSString *const RJSDKVersion;

#pragma mark - Capture Configuration (Video Model)

/// Default capture scale factor (0.35 = 35% of original size for video)
FOUNDATION_EXTERN const CGFloat RJDefaultCaptureScale;

#pragma mark - Motion Event Configuration

/// Minimum interval between motion events (0.016 = 60 FPS motion capture)
FOUNDATION_EXTERN const NSTimeInterval RJDefaultMotionEventInterval;

/// Minimum velocity to record scroll motion (points/second)
FOUNDATION_EXTERN const CGFloat RJMotionVelocityThreshold;

/// Scroll distance threshold for motion events (points)
FOUNDATION_EXTERN const CGFloat RJDefaultScrollThreshold;

/// Time after last scroll event to consider scroll ended (seconds)
FOUNDATION_EXTERN const NSTimeInterval RJScrollEndDelay;

#pragma mark - Memory Thresholds

/// Memory warning threshold in bytes (100MB)
FOUNDATION_EXTERN const NSUInteger RJMemoryWarningThresholdBytes;

/// Maximum frame data bytes to keep in memory (2MB)
FOUNDATION_EXTERN const NSUInteger RJMaxFrameBytesInMemory;

/// Default maximum frames to keep in memory
FOUNDATION_EXTERN const NSInteger RJDefaultMaxFramesInMemory;

#pragma mark - Performance Thresholds

/// Battery level threshold for low-power mode (15%)
FOUNDATION_EXTERN const float RJLowBatteryThreshold;

/// Maximum consecutive captures before cooldown
FOUNDATION_EXTERN const NSInteger RJMaxConsecutiveCaptures;

/// Cooldown duration after max consecutive captures (seconds)
FOUNDATION_EXTERN const NSTimeInterval RJCaptureCooldownSeconds;

#pragma mark - Upload Configuration

/// Batch upload interval in seconds
FOUNDATION_EXTERN const NSTimeInterval RJBatchUploadInterval;

/// Initial upload delay for short sessions (seconds)
FOUNDATION_EXTERN const NSTimeInterval RJInitialUploadDelay;

/// Network request timeout (seconds)
FOUNDATION_EXTERN const NSTimeInterval RJNetworkRequestTimeout;

/// Network resource timeout (seconds)
FOUNDATION_EXTERN const NSTimeInterval RJNetworkResourceTimeout;

#pragma mark - Session Configuration

/// Background duration threshold for new session (seconds)
FOUNDATION_EXTERN const NSTimeInterval RJBackgroundSessionTimeout;

#pragma mark - Gesture Detection

/// Maximum time between taps for double-tap detection (milliseconds)
FOUNDATION_EXTERN const NSTimeInterval RJDoubleTapMaxInterval;

/// Maximum distance between taps for double-tap detection (points)
FOUNDATION_EXTERN const CGFloat RJDoubleTapMaxDistance;

/// Minimum duration for long press detection (milliseconds)
FOUNDATION_EXTERN const NSTimeInterval RJLongPressMinDuration;

/// Force touch threshold (normalized force value)
FOUNDATION_EXTERN const CGFloat RJForceTouchThreshold;

/// Minimum distance for swipe gesture detection (points)
FOUNDATION_EXTERN const CGFloat RJSwipeMinDistance;

/// Minimum distance for pinch gesture detection (points)
FOUNDATION_EXTERN const CGFloat RJPinchMinDistance;

/// Minimum distance change percentage for pinch detection
FOUNDATION_EXTERN const CGFloat RJPinchMinChangePercent;

/// Minimum rotation angle for rotation gesture detection (degrees)
FOUNDATION_EXTERN const CGFloat RJRotationMinAngle;

NS_ASSUME_NONNULL_END
