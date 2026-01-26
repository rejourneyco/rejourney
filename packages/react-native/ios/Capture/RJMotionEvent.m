//
//  RJMotionEvent.m
//  Rejourney
//
//  Motion event implementation.
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

#import "RJMotionEvent.h"
#import <math.h>

@implementation RJMotionEvent

#pragma mark - Computed Properties

- (NSTimeInterval)duration {
  return self.t1 - self.t0;
}

- (CGFloat)distance {
  return sqrt(self.dx * self.dx + self.dy * self.dy);
}

- (CGFloat)averageVelocity {
  NSTimeInterval dur = self.duration;
  if (dur <= 0)
    return 0;
  return self.distance / (dur / 1000.0); 
}

- (CGFloat)direction {
  return atan2(self.dy, self.dx);
}

#pragma mark - Serialization

- (NSDictionary *)toDictionary {
  NSMutableDictionary *dict = [NSMutableDictionary dictionary];

  dict[@"type"] = [RJMotionEvent motionTypeName:self.type];
  dict[@"t0"] = @(self.t0);
  dict[@"t1"] = @(self.t1);
  dict[@"dx"] = @(self.dx);
  dict[@"dy"] = @(self.dy);
  dict[@"v0"] = @(self.v0);
  dict[@"v1"] = @(self.v1);
  dict[@"curve"] = [RJMotionEvent curveNameForType:self.curve];
  dict[@"duration"] = @(self.duration);
  dict[@"distance"] = @(self.distance);

  if (self.targetId) {
    dict[@"targetId"] = self.targetId;
  }

  return [dict copy];
}

+ (instancetype)eventFromDictionary:(NSDictionary *)dict {
  if (!dict || ![dict isKindOfClass:[NSDictionary class]]) {
    return nil;
  }

  RJMotionEvent *event = [[RJMotionEvent alloc] init];

  NSString *typeName = dict[@"type"];
  if (typeName) {
    event.type = [RJMotionEvent motionTypeFromName:typeName];
  }

  NSNumber *t0 = dict[@"t0"];
  if (t0)
    event.t0 = t0.doubleValue;

  NSNumber *t1 = dict[@"t1"];
  if (t1)
    event.t1 = t1.doubleValue;

  NSNumber *dx = dict[@"dx"];
  if (dx)
    event.dx = dx.doubleValue;

  NSNumber *dy = dict[@"dy"];
  if (dy)
    event.dy = dy.doubleValue;

  NSNumber *v0 = dict[@"v0"];
  if (v0)
    event.v0 = v0.doubleValue;

  NSNumber *v1 = dict[@"v1"];
  if (v1)
    event.v1 = v1.doubleValue;

  NSString *curveName = dict[@"curve"];
  if (curveName) {
    event.curve = [RJMotionEvent curveTypeFromName:curveName];
  }

  event.targetId = dict[@"targetId"];

  return event;
}

#pragma mark - Curve Helpers

+ (NSString *)curveNameForType:(RJMotionCurve)curve {
  switch (curve) {
  case RJMotionCurveLinear:
    return @"linear";
  case RJMotionCurveExponentialDecay:
    return @"exponential_decay";
  case RJMotionCurveEaseOut:
    return @"ease_out";
  case RJMotionCurveBounce:
    return @"bounce";
  case RJMotionCurveSpring:
    return @"spring";
  }
  return @"linear";
}

+ (RJMotionCurve)curveTypeFromName:(NSString *)name {
  if ([name isEqualToString:@"exponential_decay"]) {
    return RJMotionCurveExponentialDecay;
  } else if ([name isEqualToString:@"ease_out"]) {
    return RJMotionCurveEaseOut;
  } else if ([name isEqualToString:@"bounce"]) {
    return RJMotionCurveBounce;
  } else if ([name isEqualToString:@"spring"]) {
    return RJMotionCurveSpring;
  }
  return RJMotionCurveLinear;
}

+ (NSString *)motionTypeName:(RJMotionType)type {
  switch (type) {
  case RJMotionTypeScroll:
    return @"scroll";
  case RJMotionTypePan:
    return @"pan";
  case RJMotionTypeSwipe:
    return @"swipe";
  case RJMotionTypeFling:
    return @"fling";
  }
  return @"scroll";
}

+ (RJMotionType)motionTypeFromName:(NSString *)name {
  if ([name isEqualToString:@"pan"]) {
    return RJMotionTypePan;
  } else if ([name isEqualToString:@"swipe"]) {
    return RJMotionTypeSwipe;
  } else if ([name isEqualToString:@"fling"]) {
    return RJMotionTypeFling;
  }
  return RJMotionTypeScroll;
}

#pragma mark - Instance Convenience Methods

- (NSString *)typeName {
  return [RJMotionEvent motionTypeName:self.type];
}

- (NSString *)curveName {
  return [RJMotionEvent curveNameForType:self.curve];
}

@end
