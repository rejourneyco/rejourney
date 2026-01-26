//
//  RJTypes.h
//  Rejourney
//
//  Common type definitions used throughout the SDK.
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

#pragma mark - Capture Importance

/**
 * Represents the importance level of a capture event.
 * Higher importance events are less likely to be skipped during throttling.
 */
typedef NS_ENUM(NSInteger, RJCaptureImportance) {
    /// Low importance - can be freely skipped (e.g., heartbeat)
    RJCaptureImportanceLow = 0,
    
    /// Medium importance - skip only under heavy load (e.g., tap gestures)
    RJCaptureImportanceMedium = 1,
    
    /// High importance - rarely skip (e.g., scroll events)
    RJCaptureImportanceHigh = 2,
    
    /// Critical importance - never skip (e.g., navigation, app lifecycle)
    RJCaptureImportanceCritical = 3
};

#pragma mark - Performance Level

/**
 * Represents the current performance level of the capture engine.
 * The engine adjusts its behavior based on system conditions.
 */
typedef NS_ENUM(NSInteger, RJPerformanceLevel) {
    /// Normal operation - full capture rate
    RJPerformanceLevelNormal = 0,
    
    /// Reduced rate due to low battery or thermal throttling
    RJPerformanceLevelReduced = 1,
    
    /// Minimal captures due to memory pressure
    RJPerformanceLevelMinimal = 2,
    
    /// All non-critical captures paused
    RJPerformanceLevelPaused = 3
};

#pragma mark - Gesture Types

/**
 * Represents recognized gesture types.
 */
typedef NSString *RJGestureType NS_TYPED_EXTENSIBLE_ENUM;

/// Single tap gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypeTap;
/// Double tap gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypeDoubleTap;
/// Long press gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypeLongPress;
/// Force touch (3D Touch) gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypeForceTouch;
/// Swipe left gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypeSwipeLeft;
/// Swipe right gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypeSwipeRight;
/// Swipe up gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypeSwipeUp;
/// Swipe down gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypeSwipeDown;
/// Scroll up gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypeScrollUp;
/// Scroll down gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypeScrollDown;
/// Pinch in (zoom out) gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypePinchIn;
/// Pinch out (zoom in) gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypePinchOut;
/// Clockwise rotation gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypeRotateCW;
/// Counter-clockwise rotation gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypeRotateCCW;
/// Two-finger pan up gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypePanUp;
/// Two-finger pan down gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypePanDown;
/// Two-finger pan left gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypePanLeft;
/// Two-finger pan right gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypePanRight;
/// Two-finger tap gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypeTwoFingerTap;
/// Three-finger gesture
FOUNDATION_EXTERN RJGestureType const RJGestureTypeThreeFingerGesture;
/// Multi-touch gesture (4+ fingers)
FOUNDATION_EXTERN RJGestureType const RJGestureTypeMultiTouch;
/// Keyboard tap (privacy-preserved)
FOUNDATION_EXTERN RJGestureType const RJGestureTypeKeyboardTap;

#pragma mark - Session Event Types

/**
 * Represents session event types for logging.
 */
typedef NSString *RJEventType NS_TYPED_EXTENSIBLE_ENUM;

/// Session started
FOUNDATION_EXTERN RJEventType const RJEventTypeSessionStart;
/// Session ended
FOUNDATION_EXTERN RJEventType const RJEventTypeSessionEnd;
/// Session timed out due to background
FOUNDATION_EXTERN RJEventType const RJEventTypeSessionTimeout;
/// Navigation to new screen
FOUNDATION_EXTERN RJEventType const RJEventTypeNavigation;
/// User gesture performed
FOUNDATION_EXTERN RJEventType const RJEventTypeGesture;
/// Visual change occurred
FOUNDATION_EXTERN RJEventType const RJEventTypeVisualChange;
/// Keyboard shown
FOUNDATION_EXTERN RJEventType const RJEventTypeKeyboardShow;
/// Keyboard hidden
FOUNDATION_EXTERN RJEventType const RJEventTypeKeyboardHide;
/// Keyboard typing summary
FOUNDATION_EXTERN RJEventType const RJEventTypeKeyboardTyping;
/// App entered background
FOUNDATION_EXTERN RJEventType const RJEventTypeAppBackground;
/// App entered foreground
FOUNDATION_EXTERN RJEventType const RJEventTypeAppForeground;
/// App terminated
FOUNDATION_EXTERN RJEventType const RJEventTypeAppTerminated;
/// External URL opened
FOUNDATION_EXTERN RJEventType const RJEventTypeExternalURLOpened;
/// OAuth flow started
FOUNDATION_EXTERN RJEventType const RJEventTypeOAuthStarted;
/// OAuth flow completed
FOUNDATION_EXTERN RJEventType const RJEventTypeOAuthCompleted;
/// OAuth returned from external app
FOUNDATION_EXTERN RJEventType const RJEventTypeOAuthReturned;

#pragma mark - Completion Handlers

/**
 * Completion handler for operations that may succeed or fail.
 *
 * @param success Whether the operation succeeded.
 */
typedef void (^RJCompletionHandler)(BOOL success);

/**
 * Completion handler for session operations.
 *
 * @param success Whether the operation succeeded.
 * @param sessionId The session ID (if applicable).
 * @param error Error description (if failed).
 */
typedef void (^RJSessionCompletionHandler)(BOOL success, NSString *_Nullable sessionId, NSString *_Nullable error);

NS_ASSUME_NONNULL_END
