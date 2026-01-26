//
//  RJGestureClassifier.h
//  Rejourney
//
//  Gesture classification from touch data.
//
//  The classifier analyzes touch paths to determine gesture types
//  including taps, swipes, pinches, rotations, and multi-finger gestures.
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
#import "../Core/RJTypes.h"

NS_ASSUME_NONNULL_BEGIN

/**
 * Represents a single touch point in a gesture path.
 */
@interface RJTouchPoint : NSObject

/// X coordinate in window space
@property (nonatomic, assign) CGFloat x;

/// Y coordinate in window space
@property (nonatomic, assign) CGFloat y;

/// Timestamp in milliseconds
@property (nonatomic, assign) NSTimeInterval timestamp;

/// Touch force (0.0-1.0, where available)
@property (nonatomic, assign) CGFloat force;

/// Creates a touch point from coordinates
+ (instancetype)pointWithX:(CGFloat)x y:(CGFloat)y timestamp:(NSTimeInterval)timestamp force:(CGFloat)force;

/// Converts to dictionary for logging
- (NSDictionary *)toDictionary;

@end

/**
 * Classifies gestures from touch data.
 *
 * The classifier supports:
 * - Single-finger: tap, double-tap, long-press, force-touch, swipe, scroll
 * - Two-finger: pinch, rotation, pan, two-finger-tap
 * - Multi-finger: three-finger gesture, multi-touch
 *
 * ## Usage
 * ```objc
 * RJGestureClassifier *classifier = [[RJGestureClassifier alloc] init];
 *
 * // Single-finger gesture
 * NSString *gesture = [classifier classifySingleTouchPath:touches duration:500];
 *
 * // Multi-finger gesture
 * NSString *gesture = [classifier classifyMultiTouchPaths:touchPaths
 *                                                duration:300
 *                                              touchCount:2];
 * ```
 */
@interface RJGestureClassifier : NSObject

#pragma mark - Double-Tap Detection State

/// Time of last tap for double-tap detection
@property (nonatomic, assign) NSTimeInterval lastTapTime;

/// Location of last tap for double-tap detection
@property (nonatomic, assign) CGPoint lastTapPoint;

/// Current tap count for multi-tap detection
@property (nonatomic, assign) NSInteger tapCount;

/// Maximum force recorded during current gesture
@property (nonatomic, assign) CGFloat maxForce;

/// Initial pinch distance for pinch detection
@property (nonatomic, assign) CGFloat initialPinchDistance;

/// Initial rotation angle for rotation detection
@property (nonatomic, assign) CGFloat initialRotationAngle;

#pragma mark - Classification

/**
 * Classifies a single-finger gesture from its touch path.
 *
 * @param touches Array of touch point dictionaries or RJTouchPoint objects.
 * @param duration Gesture duration in milliseconds.
 * @return Gesture type string (see RJGestureType constants).
 */
- (RJGestureType)classifySingleTouchPath:(NSArray *)touches
                                duration:(NSTimeInterval)duration;

/**
 * Classifies a multi-finger gesture from touch paths.
 *
 * @param touchPaths Dictionary mapping touch IDs to arrays of touch points.
 * @param duration Gesture duration in milliseconds.
 * @param touchCount Number of fingers involved.
 * @return Gesture type string (see RJGestureType constants).
 */
- (RJGestureType)classifyMultiTouchPaths:(NSDictionary<NSNumber *, NSArray *> *)touchPaths
                                duration:(NSTimeInterval)duration
                              touchCount:(NSInteger)touchCount;

/**
 * Resets the classifier state for a new gesture.
 */
- (void)resetState;

@end

NS_ASSUME_NONNULL_END
