//
//  RJConstants.m
//  Rejourney
//
//  SDK-wide constants implementation.
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

#import "RJConstants.h"

#pragma mark - SDK Version

NSString *const RJSDKVersion = @"1.0.0";

#pragma mark - Capture Configuration Defaults (Video Model)

const CGFloat RJDefaultCaptureScale = 0.35;

#pragma mark - Motion Event Configuration

const NSTimeInterval RJDefaultMotionEventInterval = 0.016;

const CGFloat RJMotionVelocityThreshold = 10.0;

const CGFloat RJDefaultScrollThreshold = 5.0;

const NSTimeInterval RJScrollEndDelay = 0.15;

#pragma mark - Memory Thresholds

const NSUInteger RJMemoryWarningThresholdBytes = 100 * 1024 * 1024;

const NSUInteger RJMaxFrameBytesInMemory = 4 * 1024 * 1024;

const NSInteger RJDefaultMaxFramesInMemory = 20;

#pragma mark - Performance Thresholds

const float RJLowBatteryThreshold = 0.15f;

const NSInteger RJMaxConsecutiveCaptures = 5;

const NSTimeInterval RJCaptureCooldownSeconds = 1.0;

#pragma mark - Upload Configuration

const NSTimeInterval RJBatchUploadInterval = 5.0;

const NSTimeInterval RJInitialUploadDelay = 1.0;

const NSTimeInterval RJNetworkRequestTimeout = 60.0;

const NSTimeInterval RJNetworkResourceTimeout = 120.0;

#pragma mark - Session Configuration

const NSTimeInterval RJBackgroundSessionTimeout = 60.0;

#pragma mark - Gesture Detection

const NSTimeInterval RJDoubleTapMaxInterval = 300.0;

const CGFloat RJDoubleTapMaxDistance = 50.0;

const NSTimeInterval RJLongPressMinDuration = 500.0;

const CGFloat RJForceTouchThreshold = 2.0;

const CGFloat RJSwipeMinDistance = 50.0;

const CGFloat RJPinchMinDistance = 30.0;

const CGFloat RJPinchMinChangePercent = 0.20;

const CGFloat RJRotationMinAngle = 15.0;
