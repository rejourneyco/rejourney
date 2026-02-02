//
//  RJGestureClassifier.m
//  Rejourney
//
//  Gesture classification implementation.
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

#import "RJGestureClassifier.h"
#import "RJConstants.h"

#pragma mark - RJTouchPoint Implementation

@implementation RJTouchPoint

+ (instancetype)pointWithX:(CGFloat)x
                         y:(CGFloat)y
                 timestamp:(NSTimeInterval)timestamp
                     force:(CGFloat)force {
  RJTouchPoint *point = [[RJTouchPoint alloc] init];
  point.x = x;
  point.y = y;
  point.timestamp = timestamp;
  point.force = force;
  return point;
}

- (NSDictionary *)toDictionary {
  return @{
    @"x" : @(self.x),
    @"y" : @(self.y),
    @"timestamp" : @(self.timestamp),
    @"force" : @(self.force)
  };
}

@end

#pragma mark - RJGestureClassifier Implementation

@implementation RJGestureClassifier

#pragma mark - Initialization

- (instancetype)init {
  self = [super init];
  if (self) {
    [self resetState];
  }
  return self;
}

- (void)resetState {
  _lastTapTime = 0;
  _lastTapPoint = CGPointZero;
  _tapCount = 0;
  _maxForce = 0;
  _initialPinchDistance = 0;
  _initialRotationAngle = 0;
}

#pragma mark - Single Touch Classification

- (RJGestureType)classifySingleTouchPath:(NSArray *)touches
                                duration:(NSTimeInterval)duration {
  if (touches.count < 2) {
    return [self classifyStationaryGesture:duration];
  }

  NSDictionary *first = [self extractPointDict:touches.firstObject];
  NSDictionary *last = [self extractPointDict:touches.lastObject];

  if (!first || !last) {
    return RJGestureTypeTap;
  }

  CGFloat dx = [last[@"x"] floatValue] - [first[@"x"] floatValue];
  CGFloat dy = [last[@"y"] floatValue] - [first[@"y"] floatValue];
  CGFloat distance = sqrt(dx * dx + dy * dy);

  if (distance < 10) {
    return [self classifyStationaryGesture:duration];
  }

  return [self classifyMovementGesture:dx dy:dy distance:distance];
}

- (NSDictionary *)extractPointDict:(id)point {
  if ([point isKindOfClass:[NSDictionary class]]) {
    return point;
  } else if ([point isKindOfClass:[RJTouchPoint class]]) {
    return [(RJTouchPoint *)point toDictionary];
  }
  return nil;
}

- (RJGestureType)classifyStationaryGesture:(NSTimeInterval)duration {

  if (self.maxForce > RJForceTouchThreshold) {
    return RJGestureTypeForceTouch;
  }

  NSTimeInterval currentTime = [[NSDate date] timeIntervalSince1970] * 1000;
  if ([self checkDoubleTap:currentTime]) {
    return RJGestureTypeDoubleTap;
  }

  return duration > RJLongPressMinDuration ? RJGestureTypeLongPress
                                           : RJGestureTypeTap;
}

- (BOOL)checkDoubleTap:(NSTimeInterval)currentTime {
  if (self.lastTapTime <= 0) {

    self.tapCount = 1;
    self.lastTapTime = currentTime;
    return NO;
  }

  if (currentTime - self.lastTapTime >= RJDoubleTapMaxInterval) {

    self.tapCount = 1;
    self.lastTapTime = currentTime;
    return NO;
  }

  self.tapCount++;
  self.lastTapTime = currentTime;

  if (self.tapCount >= 2) {
    self.tapCount = 0;
    self.lastTapTime = 0;
    return YES;
  }

  return NO;
}

- (RJGestureType)classifyMovementGesture:(CGFloat)dx
                                      dy:(CGFloat)dy
                                distance:(CGFloat)distance {

  if (fabs(dy) > fabs(dx) && fabs(dy) > RJSwipeMinDistance) {
    return dy > 0 ? RJGestureTypeScrollDown : RJGestureTypeScrollUp;
  }

  if (fabs(dx) > fabs(dy)) {
    return dx > 0 ? RJGestureTypeSwipeRight : RJGestureTypeSwipeLeft;
  }

  return dy > 0 ? RJGestureTypeSwipeDown : RJGestureTypeSwipeUp;
}

#pragma mark - Multi-Touch Classification

- (RJGestureType)classifyMultiTouchPaths:
                     (NSDictionary<NSNumber *, NSArray *> *)touchPaths
                                duration:(NSTimeInterval)duration
                              touchCount:(NSInteger)touchCount {

  if (!touchPaths || touchCount <= 0) {
    return RJGestureTypeTap;
  }

  @try {

    if (touchCount == 1) {
      NSArray *path = [[touchPaths allValues] firstObject];
      return [self classifySingleTouchPath:path duration:duration];
    }

    if (touchCount == 2) {
      return [self classifyTwoFingerGesture:touchPaths];
    }

    if (touchCount == 3) {
      return RJGestureTypeThreeFingerGesture;
    }

    return RJGestureTypeMultiTouch;
  } @catch (NSException *exception) {

    return RJGestureTypeTap;
  }
}

- (RJGestureType)classifyTwoFingerGesture:
    (NSDictionary<NSNumber *, NSArray *> *)touchPaths {
  @try {
    NSArray *touchIds = [touchPaths allKeys];
    if (touchIds.count < 2) {
      return RJGestureTypeTap;
    }

    NSArray *path1 = touchPaths[touchIds[0]];
    NSArray *path2 = touchPaths[touchIds[1]];

    if (!path1 || !path2 || path1.count < 2 || path2.count < 2) {
      return RJGestureTypeTwoFingerTap;
    }

    NSDictionary *start1 = [self extractPointDict:path1.firstObject];
    NSDictionary *start2 = [self extractPointDict:path2.firstObject];
    NSDictionary *end1 = [self extractPointDict:path1.lastObject];
    NSDictionary *end2 = [self extractPointDict:path2.lastObject];

    if (!start1 || !start2 || !end1 || !end2) {
      return RJGestureTypeTwoFingerTap;
    }

    CGFloat startDx = [start1[@"x"] floatValue] - [start2[@"x"] floatValue];
    CGFloat startDy = [start1[@"y"] floatValue] - [start2[@"y"] floatValue];

    if (isnan(startDx) || isnan(startDy) || isinf(startDx) || isinf(startDy)) {
      return RJGestureTypeMultiTouch;
    }

    CGFloat startDistance = sqrt(startDx * startDx + startDy * startDy);

    if (startDistance < 1.0) {
      return RJGestureTypeMultiTouch;
    }

    CGFloat endDx = [end1[@"x"] floatValue] - [end2[@"x"] floatValue];
    CGFloat endDy = [end1[@"y"] floatValue] - [end2[@"y"] floatValue];
    CGFloat endDistance = sqrt(endDx * endDx + endDy * endDy);

    RJGestureType pinchGesture = [self checkPinchGesture:startDistance
                                             endDistance:endDistance];
    if (pinchGesture) {
      return pinchGesture;
    }

    RJGestureType rotationGesture = [self checkRotationGesture:startDx
                                                       startDy:startDy
                                                         endDx:endDx
                                                         endDy:endDy];
    if (rotationGesture) {
      return rotationGesture;
    }

    RJGestureType panGesture = [self checkPanGesture:start1
                                              start2:start2
                                                end1:end1
                                                end2:end2];
    if (panGesture) {
      return panGesture;
    }

    return RJGestureTypeTwoFingerTap;
  } @catch (NSException *exception) {
    return RJGestureTypeTwoFingerTap;
  }
}

- (RJGestureType)checkPinchGesture:(CGFloat)startDistance
                       endDistance:(CGFloat)endDistance {
  CGFloat distanceChange = endDistance - startDistance;
  CGFloat distanceChangePercent = fabs(distanceChange) / startDistance;

  if (distanceChangePercent > RJPinchMinChangePercent &&
      fabs(distanceChange) > RJPinchMinDistance) {
    return distanceChange > 0 ? RJGestureTypePinchOut : RJGestureTypePinchIn;
  }

  return nil;
}

- (RJGestureType)checkRotationGesture:(CGFloat)startDx
                              startDy:(CGFloat)startDy
                                endDx:(CGFloat)endDx
                                endDy:(CGFloat)endDy {
  CGFloat startAngle = atan2(startDy, startDx);
  CGFloat endAngle = atan2(endDy, endDx);
  CGFloat angleDiff = endAngle - startAngle;

  while (angleDiff > M_PI)
    angleDiff -= 2 * M_PI;
  while (angleDiff < -M_PI)
    angleDiff += 2 * M_PI;

  CGFloat rotationDegrees = angleDiff * (180.0 / M_PI);

  if (fabs(rotationDegrees) > RJRotationMinAngle) {
    return rotationDegrees > 0 ? RJGestureTypeRotateCCW : RJGestureTypeRotateCW;
  }

  return nil;
}

- (RJGestureType)checkPanGesture:(NSDictionary *)start1
                          start2:(NSDictionary *)start2
                            end1:(NSDictionary *)end1
                            end2:(NSDictionary *)end2 {

  CGFloat centerStartX =
      ([start1[@"x"] floatValue] + [start2[@"x"] floatValue]) / 2.0;
  CGFloat centerStartY =
      ([start1[@"y"] floatValue] + [start2[@"y"] floatValue]) / 2.0;
  CGFloat centerEndX =
      ([end1[@"x"] floatValue] + [end2[@"x"] floatValue]) / 2.0;
  CGFloat centerEndY =
      ([end1[@"y"] floatValue] + [end2[@"y"] floatValue]) / 2.0;

  CGFloat centerDx = centerEndX - centerStartX;
  CGFloat centerDy = centerEndY - centerStartY;
  CGFloat centerDistance = sqrt(centerDx * centerDx + centerDy * centerDy);

  if (centerDistance > RJPinchMinDistance) {
    if (fabs(centerDy) > fabs(centerDx)) {
      return centerDy > 0 ? RJGestureTypePanDown : RJGestureTypePanUp;
    } else {
      return centerDx > 0 ? RJGestureTypePanRight : RJGestureTypePanLeft;
    }
  }

  return nil;
}

@end
