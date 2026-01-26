//
//  RJTouchInterceptor.h
//  Rejourney
//
//  Global touch event interception and gesture detection.
//
//  The touch interceptor uses method swizzling to capture all touch
//  events at the UIApplication level, classify gestures, and notify
//  the Rejourney module.
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
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@class RJGestureClassifier;
@class RJMotionEvent;

/**
 * Delegate protocol for receiving gesture and motion notifications.
 */
@protocol RJTouchInterceptorDelegate <NSObject>

/**
 * Called when a gesture is recognized.
 *
 * @param gestureType The type of gesture (e.g., "tap", "swipe_left").
 * @param touches Array of touch point dictionaries.
 * @param duration Gesture duration in milliseconds.
 * @param targetLabel Accessibility label of the target view (if available).
 */
- (void)touchInterceptorDidRecognizeGesture:(NSString *)gestureType
                                    touches:(NSArray<NSDictionary *> *)touches
                                   duration:(NSTimeInterval)duration
                                targetLabel:(nullable NSString *)targetLabel;

@optional

/**
 * Called when a gesture is recognized.
 *
 * @param gestureType The type of gesture (e.g., "tap", "swipe_left").
 * @param touches Array of touch point dictionaries.
 * @param duration Gesture duration in milliseconds.
 * @param targetLabel Accessibility label of the target view (if available).
 */
- (void)touchInterceptorDidRecognizeGesture:(NSString *)gestureType
                                    touches:(NSArray<NSDictionary *> *)touches
                                   duration:(NSTimeInterval)duration
                                targetLabel:(nullable NSString *)targetLabel;

@optional

/**
 * Called when a motion event is captured (scroll, pan, swipe with velocity).
 * Used for event-driven replay reconstruction.
 *
 * @param motionEvent The motion event with type, displacement, velocity, and
 * curve.
 */
- (void)touchInterceptorDidCaptureMotionEvent:(RJMotionEvent *)motionEvent;

@optional

/**
 * Called when a touch interaction starts (TouchDown).
 * Used to trigger "active state" captures to reduce replay lag.
 */
- (void)touchInterceptorDidDetectInteractionStart;

@required

/**
 * Whether recording is currently active.
 * The interceptor will not process touches when this returns NO.
 */
- (BOOL)isCurrentlyRecording;

/**
 * Whether the keyboard is currently visible.
 * Used to detect keyboard taps (which are logged without location for privacy).
 */
- (BOOL)isKeyboardCurrentlyVisible;

/**
 * The current keyboard frame.
 * Used to determine if touches are on the keyboard.
 */
- (CGRect)currentKeyboardFrame;

@end

/**
 * Global touch interceptor that captures all touch events.
 *
 * This singleton intercepts UIApplication's sendEvent: method to capture
 * all touch events before they're processed by the view hierarchy. It
 * tracks multi-touch paths, classifies gestures, and notifies the delegate.
 *
 * ## Privacy
 * - Keyboard touches are logged as "keyboard_tap" without location
 * - No key content is captured
 *
 * ## Setup
 * ```objc
 * // In your module init
 * [RJTouchInterceptor sharedInstance].delegate = self;
 * [[RJTouchInterceptor sharedInstance] enableGlobalTracking];
 * ```
 *
 * @note This class uses method swizzling which is performed once and cannot be
 * undone.
 */
@interface RJTouchInterceptor : NSObject

#pragma mark - Singleton

/**
 * Returns the shared touch interceptor instance.
 */
+ (instancetype)sharedInstance;

#pragma mark - Configuration

/// Delegate to receive gesture notifications
@property(nonatomic, weak, nullable) id<RJTouchInterceptorDelegate> delegate;

/// Whether touch tracking is currently enabled
@property(nonatomic, readonly) BOOL isTrackingEnabled;

#pragma mark - Setup

/**
 * Enables global touch tracking via method swizzling.
 *
 * This method swizzles UIApplication's sendEvent: method to intercept
 * all touch events. This is called once and cannot be undone.
 *
 * @note Safe to call multiple times; swizzling only happens once.
 */
- (void)enableGlobalTracking;

#pragma mark - Internal (called by swizzled method)

/**
 * Handles a touch event. Called by the swizzled sendEvent: method.
 *
 * @param event The UIEvent containing touches.
 */
- (void)handleTouchEvent:(UIEvent *)event;

@end

NS_ASSUME_NONNULL_END
