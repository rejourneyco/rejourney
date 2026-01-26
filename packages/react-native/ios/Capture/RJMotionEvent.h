//
//  RJMotionEvent.h
//  Rejourney
//
//  Motion event data structure for gesture replay reconstruction.
//  Motion events capture scroll/pan/swipe dynamics for timeline events.
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

#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Motion curve types for animation reconstruction.
 */
typedef NS_ENUM(NSInteger, RJMotionCurve) {
  /// Linear motion (constant velocity)
  RJMotionCurveLinear = 0,

  /// Exponential decay (iOS scroll deceleration)
  RJMotionCurveExponentialDecay = 1,

  /// Ease out (quick start, slow end)
  RJMotionCurveEaseOut = 2,

  /// Bounce (overshoots then settles)
  RJMotionCurveBounce = 3,

  /// Spring (elastic oscillation)
  RJMotionCurveSpring = 4
};

/**
 * Motion event types.
 */
typedef NS_ENUM(NSInteger, RJMotionType) {
  /// Scroll gesture motion
  RJMotionTypeScroll = 0,

  /// Pan gesture motion
  RJMotionTypePan = 1,

  /// Swipe gesture motion
  RJMotionTypeSwipe = 2,

  /// Fling (momentum) motion
  RJMotionTypeFling = 3
};

/**
 * Represents a motion event for replay reconstruction.
 *
 * Motion events capture the dynamics of scroll/pan/swipe gestures
 * so that the player can reconstruct smooth motion between sparse keyframes.
 *
 * ## Usage
 * @code
 * RJMotionEvent *event = [[RJMotionEvent alloc] init];
 * event.type = RJMotionTypeScroll;
 * event.t0 = 1234.0;  // start time in ms
 * event.t1 = 1560.0;  // end time in ms
 * event.dx = 0;       // horizontal displacement
 * event.dy = -820;    // vertical displacement
 * event.v0 = 2.1;     // initial velocity
 * event.curve = RJMotionCurveExponentialDecay;
 *
 * NSDictionary *dict = [event toDictionary];
 * @endcode
 */
@interface RJMotionEvent : NSObject

#pragma mark - Motion Properties

/// Type of motion (scroll, pan, swipe, fling)
@property(nonatomic, assign) RJMotionType type;

/// Start timestamp in milliseconds
@property(nonatomic, assign) NSTimeInterval t0;

/// End timestamp in milliseconds
@property(nonatomic, assign) NSTimeInterval t1;

/// Horizontal displacement in points
@property(nonatomic, assign) CGFloat dx;

/// Vertical displacement in points
@property(nonatomic, assign) CGFloat dy;

/// Initial velocity in points per second
@property(nonatomic, assign) CGFloat v0;

/// Final velocity in points per second (usually 0 for deceleration)
@property(nonatomic, assign) CGFloat v1;

/// Motion curve for interpolation
@property(nonatomic, assign) RJMotionCurve curve;

/// Target view identifier (optional)
@property(nonatomic, copy, nullable) NSString *targetId;

#pragma mark - Computed Properties

/// Duration in milliseconds
@property(nonatomic, readonly) NSTimeInterval duration;

/// Total distance traveled
@property(nonatomic, readonly) CGFloat distance;

/// Average velocity
@property(nonatomic, readonly) CGFloat averageVelocity;

/// Direction angle in radians
@property(nonatomic, readonly) CGFloat direction;

#pragma mark - Serialization

/**
 * Converts the motion event to a dictionary for JSON serialization.
 *
 * @return Dictionary with all motion event properties.
 */
- (NSDictionary *)toDictionary;

/**
 * Creates a motion event from a dictionary.
 *
 * @param dict Dictionary with motion event properties.
 * @return Motion event or nil if dictionary is invalid.
 */
+ (nullable instancetype)eventFromDictionary:(NSDictionary *)dict;

#pragma mark - Curve Helpers

/**
 * Returns the string name for a motion curve.
 */
+ (NSString *)curveNameForType:(RJMotionCurve)curve;

/**
 * Parses a curve name string to enum value.
 */
+ (RJMotionCurve)curveTypeFromName:(NSString *)name;

/**
 * Returns the string name for a motion type.
 */
+ (NSString *)motionTypeName:(RJMotionType)type;

/**
 * Parses a motion type name string to enum value.
 */
+ (RJMotionType)motionTypeFromName:(NSString *)name;

#pragma mark - Instance Convenience Methods

/**
 * Returns the string name for this event's motion type.
 */
- (NSString *)typeName;

/**
 * Returns the string name for this event's curve type.
 */
- (NSString *)curveName;

@end

NS_ASSUME_NONNULL_END
