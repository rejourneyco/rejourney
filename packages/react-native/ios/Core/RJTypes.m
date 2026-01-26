//
//  RJTypes.m
//  Rejourney
//
//  Common type definitions implementation.
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

#import "RJTypes.h"

#pragma mark - Gesture Types

RJGestureType const RJGestureTypeTap = @"tap";
RJGestureType const RJGestureTypeDoubleTap = @"double_tap";
RJGestureType const RJGestureTypeLongPress = @"long_press";
RJGestureType const RJGestureTypeForceTouch = @"force_touch";
RJGestureType const RJGestureTypeSwipeLeft = @"swipe_left";
RJGestureType const RJGestureTypeSwipeRight = @"swipe_right";
RJGestureType const RJGestureTypeSwipeUp = @"swipe_up";
RJGestureType const RJGestureTypeSwipeDown = @"swipe_down";
RJGestureType const RJGestureTypeScrollUp = @"scroll_up";
RJGestureType const RJGestureTypeScrollDown = @"scroll_down";
RJGestureType const RJGestureTypePinchIn = @"pinch_in";
RJGestureType const RJGestureTypePinchOut = @"pinch_out";
RJGestureType const RJGestureTypeRotateCW = @"rotate_cw";
RJGestureType const RJGestureTypeRotateCCW = @"rotate_ccw";
RJGestureType const RJGestureTypePanUp = @"pan_up";
RJGestureType const RJGestureTypePanDown = @"pan_down";
RJGestureType const RJGestureTypePanLeft = @"pan_left";
RJGestureType const RJGestureTypePanRight = @"pan_right";
RJGestureType const RJGestureTypeTwoFingerTap = @"two_finger_tap";
RJGestureType const RJGestureTypeThreeFingerGesture = @"three_finger_gesture";
RJGestureType const RJGestureTypeMultiTouch = @"multi_touch";
RJGestureType const RJGestureTypeKeyboardTap = @"keyboard_tap";

#pragma mark - Session Event Types

RJEventType const RJEventTypeSessionStart = @"session_start";
RJEventType const RJEventTypeSessionEnd = @"session_end";
RJEventType const RJEventTypeSessionTimeout = @"session_timeout";
RJEventType const RJEventTypeNavigation = @"navigation";
RJEventType const RJEventTypeGesture = @"gesture";
RJEventType const RJEventTypeVisualChange = @"visual_change";
RJEventType const RJEventTypeKeyboardShow = @"keyboard_show";
RJEventType const RJEventTypeKeyboardHide = @"keyboard_hide";
RJEventType const RJEventTypeKeyboardTyping = @"keyboard_typing";
RJEventType const RJEventTypeAppBackground = @"app_background";
RJEventType const RJEventTypeAppForeground = @"app_foreground";
RJEventType const RJEventTypeAppTerminated = @"app_terminated";
RJEventType const RJEventTypeExternalURLOpened = @"external_url_opened";
RJEventType const RJEventTypeOAuthStarted = @"oauth_started";
RJEventType const RJEventTypeOAuthCompleted = @"oauth_completed";
RJEventType const RJEventTypeOAuthReturned = @"oauth_returned";
