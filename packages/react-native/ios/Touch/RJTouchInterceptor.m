//
//  RJTouchInterceptor.m
//  Rejourney
//
//  Global touch event interception implementation.
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

#import "RJTouchInterceptor.h"
#import "Core/RJLogger.h"
#import "Core/RJMotionEvent.h"
#import <UIKit/UIKit.h>
// #import "RJWindowUtils.h" // Swift file
#import "Rejourney-Swift.h"
#import "Touch/RJGestureClassifier.h"
#import <objc/runtime.h>

#pragma mark - Static Variables

static void (*_originalSendEvent)(id, SEL, UIEvent *);

static BOOL _swizzlingPerformed = NO;

#pragma mark - Swizzled Method

static void RJ_swizzled_sendEvent(id self, SEL _cmd, UIEvent *event) {
  @try {
    if (_originalSendEvent) {
      _originalSendEvent(self, _cmd, event);
    }
  } @catch (NSException *exception) {
    RJLogError(@"Original sendEvent failed: %@", exception);
  }

  @
  try {
    if (event && event.type == UIEventTypeTouches) {
      RJTouchInterceptor *interceptor = [RJTouchInterceptor sharedInstance];
      if (interceptor && interceptor.isTrackingEnabled) {
        [interceptor handleTouchEvent:event];
      } else {
        // Debug: log why we're not handling touch (throttled to avoid spam)
        static int swizzleSkipCount = 0;
        if (++swizzleSkipCount % 500 == 1) {
          RJLogInfo(@"[RJ-TOUCH-SWIZZLE] Touch not handled: interceptor=%@, "
                    @"isTrackingEnabled=%d (skipCount=%d)",
                    interceptor ? @"exists" : @"nil",
                    interceptor ? interceptor.isTrackingEnabled : -1,
                    swizzleSkipCount);
        }
      }
    }
  } @catch (NSException *exception) {
    RJLogError(@"Touch handling failed: %@", exception);
  }
}

#pragma mark - Private Interface

@interface RJTouchInterceptor ()

@property(nonatomic, strong) RJGestureClassifier *classifier;

@property(nonatomic, strong)
    NSMutableDictionary<NSNumber *, NSMutableArray<NSDictionary *> *>
        *touchPaths;

@property(nonatomic, assign) NSTimeInterval touchStartTime;

@property(nonatomic, assign) CGPoint touchStartPoint;

@property(nonatomic, assign) NSInteger activeTouchCount;

@property(nonatomic, assign) BOOL isTrackingEnabled;

@property(nonatomic, assign) CGPoint lastMotionPoint;
@property(nonatomic, assign) NSTimeInterval lastMotionTimestamp;
@property(nonatomic, assign) CGFloat motionVelocityX;
@property(nonatomic, assign) CGFloat motionVelocityY;

@property(nonatomic, assign) NSTimeInterval lastProcessedTouchTime;

@property(nonatomic, strong)
    NSMutableArray<NSMutableDictionary *> *touchDictPool;
@property(nonatomic, assign) NSInteger poolSize;

@property(nonatomic, strong) NSMutableArray<NSDictionary *> *coalescedTouches;
@property(nonatomic, assign) NSTimeInterval lastCoalescedProcessTime;

@end

static const NSTimeInterval kTouchThrottleInterval = 0.016;

static const NSInteger kTouchDictPoolSize = 20;
static const NSTimeInterval kCoalesceInterval = 0.050;

#pragma mark - Implementation

@implementation RJTouchInterceptor

#pragma mark - Singleton

+ (instancetype)sharedInstance {
  static RJTouchInterceptor *instance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [[RJTouchInterceptor alloc] init];
  });
  return instance;
}

#pragma mark - Initialization

- (instancetype)init {
  self = [super init];
  if (self) {
    _classifier = [[RJGestureClassifier alloc] init];
    _touchPaths = [NSMutableDictionary new];
    _activeTouchCount = 0;
    _isTrackingEnabled = NO;
    _lastMotionPoint = CGPointZero;
    _lastMotionTimestamp = 0;
    _motionVelocityX = 0;
    _motionVelocityY = 0;
    _lastProcessedTouchTime = 0;

    _touchDictPool = [NSMutableArray arrayWithCapacity:kTouchDictPoolSize];
    _poolSize = 0;

    _coalescedTouches = [NSMutableArray arrayWithCapacity:10];
    _lastCoalescedProcessTime = 0;
  }
  return self;
}

#pragma mark - Setup

- (void)enableGlobalTracking {
  RJLogInfo(@"[RJ-TOUCH-SETUP] enableGlobalTracking called, current "
            @"isTrackingEnabled=%d",
            self.isTrackingEnabled);
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RJLogInfo(@"[RJ-TOUCH-SETUP] First-time setup - performing swizzle");
    Class applicationClass = [UIApplication class];
    SEL originalSelector = @selector(sendEvent:);
    Method originalMethod =
        class_getInstanceMethod(applicationClass, originalSelector);

    if (originalMethod) {
      _originalSendEvent = (void *)method_getImplementation(originalMethod);
      method_setImplementation(originalMethod, (IMP)RJ_swizzled_sendEvent);
      _swizzlingPerformed = YES;
      self.isTrackingEnabled = YES;
      RJLogInfo(@"[RJ-TOUCH-SETUP] Swizzle complete, isTrackingEnabled=%d",
                self.isTrackingEnabled);
    } else {
      RJLogError(@"Failed to enable touch tracking - sendEvent: not found");
    }
  });
  RJLogInfo(
      @"[RJ-TOUCH-SETUP] enableGlobalTracking finished, isTrackingEnabled=%d",
      self.isTrackingEnabled);
}

#pragma mark - Touch Event Handling

- (void)handleTouchEvent:(UIEvent *)event {

  if (!event || !self.isTrackingEnabled) {
    static int skipCount = 0;
    if (++skipCount % 100 == 1) {
      RJLogInfo(@"[RJ-TOUCH] Skipping touch: event=%@, isTrackingEnabled=%d",
                event ? @"exists" : @"nil", self.isTrackingEnabled);
    }
    return;
  }

  @try {

    if (!self.delegate) {
      RJLogInfo(@"[RJ-TOUCH] No delegate set, skipping touch");
      return;
    }

    BOOL isRecording = NO;
    @try {
      isRecording = [self.delegate isCurrentlyRecording];
    } @catch (NSException *e) {
      RJLogInfo(@"[RJ-TOUCH] isCurrentlyRecording threw exception: %@", e);
      return;
    }

    if (!isRecording) {
      static int notRecordingCount = 0;
      if (++notRecordingCount % 100 == 1) {
        RJLogInfo(@"[RJ-TOUCH] Not recording, skipping touch (count=%d)",
                  notRecordingCount);
      }
      return;
    }

    UIWindow *keyWindow = [self getKeyWindow];
    if (!keyWindow) {
      RJLogInfo(@"[RJ-TOUCH] No keyWindow available, skipping touch");
      return;
    }

    BOOL keyboardVisible = NO;
    CGRect keyboardFrame = CGRectZero;
    @try {
      keyboardVisible = [self.delegate isKeyboardCurrentlyVisible];
      keyboardFrame = [self.delegate currentKeyboardFrame];
    } @catch (NSException *e) {
    }

    NSTimeInterval timestamp = [[NSDate date] timeIntervalSince1970] * 1000;

    NSSet *allTouches = [event allTouches];
    if (!allTouches)
      return;

    for (UITouch *touch in allTouches) {
      @try {
        [self processTouch:touch
                   inWindow:keyWindow
                  timestamp:timestamp
            keyboardVisible:keyboardVisible
              keyboardFrame:keyboardFrame];
      } @catch (NSException *touchException) {
        RJLogWarning(@"Individual touch processing failed: %@", touchException);
      }
    }
  } @catch (NSException *exception) {
    RJLogWarning(@"Touch event handling failed: %@", exception);
  }
}

- (void)processTouch:(UITouch *)touch
            inWindow:(UIWindow *)window
           timestamp:(NSTimeInterval)timestamp
     keyboardVisible:(BOOL)keyboardVisible
       keyboardFrame:(CGRect)keyboardFrame {

  if (!touch || !window)
    return;

  @try {
    CGPoint location = [touch locationInView:window];

    if (isnan(location.x) || isnan(location.y) || isinf(location.x) ||
        isinf(location.y)) {
      return;
    }

    NSNumber *touchId = @((NSUInteger)touch);
    BOOL touchOnKeyboard =
        keyboardVisible && CGRectContainsPoint(keyboardFrame, location);

    CGFloat force = touch.force;
    if (!isnan(force) && !isinf(force) && force > self.classifier.maxForce) {
      self.classifier.maxForce = force;
    }

    switch (touch.phase) {
    case UITouchPhaseBegan:
      [self handleTouchBegan:touch
                     touchId:touchId
                    location:location
                   timestamp:timestamp
             touchOnKeyboard:touchOnKeyboard];
      break;

    case UITouchPhaseMoved:
      [self handleTouchMoved:touchId
                    location:location
                   timestamp:timestamp
                       force:force
             touchOnKeyboard:touchOnKeyboard];
      break;

    case UITouchPhaseEnded:
    case UITouchPhaseCancelled:
      [self handleTouchEnded:touch
                     touchId:touchId
                    location:location
                   timestamp:timestamp
             touchOnKeyboard:touchOnKeyboard
                      window:window];
      break;

    default:
      break;
    }
  } @catch (NSException *exception) {
    RJLogWarning(@"Touch processing error: %@", exception);
  }
}

#pragma mark - Touch Phase Handlers

- (void)handleTouchBegan:(UITouch *)touch
                 touchId:(NSNumber *)touchId
                location:(CGPoint)location
               timestamp:(NSTimeInterval)timestamp
         touchOnKeyboard:(BOOL)touchOnKeyboard {

  self.activeTouchCount++;
  self.classifier.maxForce = touch.force;

  if (self.activeTouchCount == 1) {
    self.touchStartTime = timestamp;
    self.touchStartPoint = location;
    [self.touchPaths removeAllObjects];

    if (self.delegate &&
        [self.delegate respondsToSelector:@selector
                       (touchInterceptorDidDetectInteractionStart)]) {
      [self.delegate touchInterceptorDidDetectInteractionStart];
    }
  }

  NSMutableArray *path = [NSMutableArray new];
  if (!touchOnKeyboard) {
    [path addObject:[self touchPointDict:location
                               timestamp:timestamp
                                   force:touch.force]];
  }
  self.touchPaths[touchId] = path;

  if (self.activeTouchCount == 2) {
    [self calculateInitialPinchState];
  }
}

- (void)handleTouchMoved:(NSNumber *)touchId
                location:(CGPoint)location
               timestamp:(NSTimeInterval)timestamp
                   force:(CGFloat)force
         touchOnKeyboard:(BOOL)touchOnKeyboard {

  NSDictionary *touchData = @{
    @"id" : touchId,
    @"x" : @(location.x),
    @"y" : @(location.y),
    @"t" : @(timestamp),
    @"f" : @(force),
    @"kbd" : @(touchOnKeyboard)
  };

  [self.coalescedTouches addObject:touchData];

  if (timestamp - self.lastCoalescedProcessTime >= kCoalesceInterval) {
    [self processCoalescedTouches];
    self.lastCoalescedProcessTime = timestamp;
  }
}

- (void)processCoalescedTouches {
  if (self.coalescedTouches.count == 0)
    return;

  NSMutableDictionary<NSNumber *, NSDictionary *> *latestTouches =
      [NSMutableDictionary new];

  for (NSDictionary *touch in self.coalescedTouches) {
    NSNumber *touchId = touch[@"id"];
    latestTouches[touchId] = touch;
  }

  for (NSDictionary *touch in [latestTouches allValues]) {
    NSNumber *touchId = touch[@"id"];
    CGPoint location =
        CGPointMake([touch[@"x"] floatValue], [touch[@"y"] floatValue]);
    NSTimeInterval timestamp = [touch[@"t"] doubleValue];
    CGFloat force = [touch[@"f"] floatValue];
    BOOL touchOnKeyboard = [touch[@"kbd"] boolValue];

    NSMutableArray *path = self.touchPaths[touchId];
    if (path && !touchOnKeyboard) {
      [path addObject:[self touchPointDict:location
                                 timestamp:timestamp
                                     force:force]];

      if (self.lastMotionTimestamp > 0) {
        NSTimeInterval dt = (timestamp - self.lastMotionTimestamp) / 1000.0;
        if (dt > 0 && dt < 1.0) {
          self.motionVelocityX = (location.x - self.lastMotionPoint.x) / dt;
          self.motionVelocityY = (location.y - self.lastMotionPoint.y) / dt;
        }
      }
      self.lastMotionPoint = location;
      self.lastMotionTimestamp = timestamp;
    }
  }

  [self.coalescedTouches removeAllObjects];
}

- (void)handleTouchEnded:(UITouch *)touch
                 touchId:(NSNumber *)touchId
                location:(CGPoint)location
               timestamp:(NSTimeInterval)timestamp
         touchOnKeyboard:(BOOL)touchOnKeyboard
                  window:(UIWindow *)window {

  @try {

    NSMutableArray *path = self.touchPaths[touchId];
    if (path && !touchOnKeyboard && touch) {
      @try {
        [path addObject:[self touchPointDict:location
                                   timestamp:timestamp
                                       force:touch.force]];
      } @catch (NSException *e) {
      }
    }

    self.activeTouchCount = MAX(0, self.activeTouchCount - 1);

    if (self.activeTouchCount == 0) {
      @try {
        if (touchOnKeyboard) {

          [self notifyGesture:RJGestureTypeKeyboardTap
                      touches:@[]
                     duration:0
                  targetLabel:nil];
        } else {
          [self finalizeGesture:timestamp location:location window:window];
        }
      } @catch (NSException *gestureException) {
        RJLogWarning(@"Gesture finalization failed: %@", gestureException);
      }

      @
      try {
        [self.touchPaths removeAllObjects];
      } @catch (NSException *e) {
      }
    }
  } @catch (NSException *exception) {
    RJLogWarning(@"Touch ended handling failed: %@", exception);
    self.activeTouchCount = 0;
    [self.touchPaths removeAllObjects];
  }
}

#pragma mark - Gesture Finalization

- (void)finalizeGesture:(NSTimeInterval)timestamp
               location:(CGPoint)location
                 window:(UIWindow *)window {

  @try {

    NSMutableDictionary<NSNumber *, NSArray *> *touchPathsCopy =
        [NSMutableDictionary dictionaryWithCapacity:self.touchPaths.count];
    [self.touchPaths enumerateKeysAndObjectsUsingBlock:^(
                         NSNumber *key, NSMutableArray *obj, BOOL *stop) {
      touchPathsCopy[key] = [obj copy];
    }];
    NSTimeInterval duration = MAX(0, timestamp - self.touchStartTime);
    NSInteger touchCount = self.touchPaths.count;
    CGPoint startPoint = self.touchStartPoint;
    NSTimeInterval startTime = self.touchStartTime;
    CGFloat velocityX = self.motionVelocityX;
    CGFloat velocityY = self.motionVelocityY;

    NSString *targetLabel = nil;
    @try {
      if (window) {
        UIView *targetView = [window hitTest:location withEvent:nil];
        targetLabel = [self findAccessibilityLabel:targetView];
      }
    } @catch (NSException *e) {
    }

    __weak typeof(self) weakSelf = self;
    id<RJTouchInterceptorDelegate> delegate = self.delegate;

    dispatch_async(
        dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
          @try {

            NSMutableArray<NSDictionary *> *allTouches = [NSMutableArray new];
            @try {
              for (NSArray *touchPath in [touchPathsCopy allValues]) {
                if (touchPath && [touchPath isKindOfClass:[NSArray class]]) {
                  [allTouches addObjectsFromArray:touchPath];
                }
              }
            } @catch (NSException *e) {
            }

            NSString *gestureType = RJGestureTypeTap;
            @try {
              __strong typeof(weakSelf) strongSelf = weakSelf;
              if (strongSelf && strongSelf.classifier) {
                gestureType = [strongSelf.classifier
                    classifyMultiTouchPaths:touchPathsCopy
                                   duration:duration
                                 touchCount:touchCount];
              }
            } @catch (NSException *e) {
              RJLogWarning(@"Gesture classification failed: %@", e);
            }

            dispatch_async(dispatch_get_main_queue(), ^{
              __strong typeof(weakSelf) strongSelf = weakSelf;
              if (!strongSelf || !delegate)
                return;

              [strongSelf notifyGesture:gestureType ?: RJGestureTypeTap
                                touches:allTouches
                               duration:duration
                            targetLabel:targetLabel];

              [strongSelf emitMotionEventIfNeeded:gestureType
                                         duration:duration
                                         location:location];
            });
          } @catch (NSException *exception) {
            RJLogWarning(@"Async gesture finalization error: %@", exception);
          }
        });

    self.lastMotionPoint = CGPointZero;
    self.lastMotionTimestamp = 0;
    self.motionVelocityX = 0;
    self.motionVelocityY = 0;

  } @catch (NSException *exception) {
    RJLogWarning(@"Gesture finalization error: %@", exception);
  }
}

- (void)emitMotionEventIfNeeded:(NSString *)gestureType
                       duration:(NSTimeInterval)duration
                       location:(CGPoint)location {

  if (![gestureType hasPrefix:@"scroll"] && ![gestureType hasPrefix:@"swipe"] &&
      ![gestureType hasPrefix:@"pan"]) {
    return;
  }

  id<RJTouchInterceptorDelegate> delegate = self.delegate;
  if (!delegate || ![delegate respondsToSelector:@selector
                              (touchInterceptorDidCaptureMotionEvent:)]) {
    return;
  }

  @try {
    RJMotionEvent *motionEvent = [[RJMotionEvent alloc] init];

    if ([gestureType hasPrefix:@"scroll"]) {
      motionEvent.type = RJMotionTypeScroll;
    } else if ([gestureType hasPrefix:@"swipe"]) {
      motionEvent.type = RJMotionTypeSwipe;
    } else {
      motionEvent.type = RJMotionTypePan;
    }

    motionEvent.t0 = self.touchStartTime;
    motionEvent.t1 = self.touchStartTime + duration;

    motionEvent.dx = location.x - self.touchStartPoint.x;
    motionEvent.dy = location.y - self.touchStartPoint.y;

    CGFloat velocity = sqrt(self.motionVelocityX * self.motionVelocityX +
                            self.motionVelocityY * self.motionVelocityY);
    motionEvent.v0 = velocity;
    motionEvent.v1 = 0;

    if ([gestureType hasPrefix:@"scroll"]) {
      motionEvent.curve = RJMotionCurveExponentialDecay;
    } else if ([gestureType hasPrefix:@"swipe"]) {
      motionEvent.curve = RJMotionCurveEaseOut;
    } else {
      motionEvent.curve = RJMotionCurveLinear;
    }

    [delegate touchInterceptorDidCaptureMotionEvent:motionEvent];

  } @catch (NSException *e) {
    RJLogWarning(@"Motion event emission failed: %@", e);
  }
}

#pragma mark - Helpers

- (NSDictionary *)touchPointDict:(CGPoint)location
                       timestamp:(NSTimeInterval)timestamp
                           force:(CGFloat)force {

  return @{
    @"x" : @(location.x),
    @"y" : @(location.y),
    @"timestamp" : @(timestamp),
    @"force" : @(force)
  };
}

- (NSMutableDictionary *)getDictFromPool {
  @synchronized(self.touchDictPool) {
    if (self.poolSize > 0) {
      self.poolSize--;
      NSMutableDictionary *dict = [self.touchDictPool lastObject];
      [self.touchDictPool removeLastObject];
      [dict removeAllObjects];
      return dict;
    }
  }

  return [NSMutableDictionary dictionaryWithCapacity:4];
}

- (void)returnDictToPool:(NSMutableDictionary *)dict {
  if (!dict)
    return;
  @synchronized(self.touchDictPool) {
    if (self.poolSize < kTouchDictPoolSize) {
      [dict removeAllObjects];
      [self.touchDictPool addObject:dict];
      self.poolSize++;
    }
  }
}

- (void)calculateInitialPinchState {
  NSArray *touchIds = [self.touchPaths allKeys];
  if (touchIds.count < 2)
    return;

  NSArray *path1 = self.touchPaths[touchIds[0]];
  NSArray *path2 = self.touchPaths[touchIds[1]];

  if (path1.count == 0 || path2.count == 0)
    return;

  NSDictionary *point1 = path1.lastObject;
  NSDictionary *point2 = path2.lastObject;

  CGFloat dx = [point1[@"x"] floatValue] - [point2[@"x"] floatValue];
  CGFloat dy = [point1[@"y"] floatValue] - [point2[@"y"] floatValue];

  self.classifier.initialPinchDistance = sqrt(dx * dx + dy * dy);
  self.classifier.initialRotationAngle = atan2(dy, dx);
}

- (nullable NSString *)findAccessibilityLabel:(UIView *)view {
  UIView *current = view;
  while (current) {
    if (current.accessibilityLabel.length > 0) {
      return current.accessibilityLabel;
    }
    current = current.superview;
  }
  return nil;
}

- (BOOL)isViewInteractive:(UIView *)view {
  UIView *current = view;
  while (current) {

    if ([current isKindOfClass:[UIControl class]] ||
        [current isKindOfClass:[UIButton class]] ||
        [current isKindOfClass:[UITextField class]] ||
        [current isKindOfClass:[UITextView class]] ||
        [current isKindOfClass:[UISwitch class]] ||
        [current isKindOfClass:[UISlider class]] ||
        [current isKindOfClass:[UITableViewCell class]] ||
        [current isKindOfClass:[UICollectionViewCell class]]) {
      return YES;
    }

    if (current.gestureRecognizers.count > 0) {
      for (UIGestureRecognizer *gr in current.gestureRecognizers) {
        if (gr.enabled &&
            ([gr isKindOfClass:[UITapGestureRecognizer class]] ||
             [gr isKindOfClass:[UILongPressGestureRecognizer class]])) {
          return YES;
        }
      }
    }

    if ((current.accessibilityTraits & UIAccessibilityTraitButton) ||
        (current.accessibilityTraits & UIAccessibilityTraitLink) ||
        (current.accessibilityTraits & UIAccessibilityTraitKeyboardKey)) {
      return YES;
    }

    current = current.superview;
  }
  return NO;
}

- (UIWindow *)getKeyWindow {
  // Use shared helper to avoid accidentally selecting system input windows
  // (UITextEffectsWindow / Keyboard windows) which can become "key".
  UIWindow *window = [RJWindowUtils keyWindow];
  if (window) {
    return window;
  }

  if (@available(iOS 13.0, *)) {
    // If RJWindowUtils returned nil, fall back to the first key window we can
    // find.
    for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
      if (![scene isKindOfClass:[UIWindowScene class]]) {
        continue;
      }
      UIWindowScene *windowScene = (UIWindowScene *)scene;
      if (windowScene.activationState ==
          UISceneActivationStateForegroundActive) {
        for (UIWindow *w in windowScene.windows) {
          if (w.isKeyWindow) {
            return w;
          }
        }
      }
    }
  } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    return [UIApplication sharedApplication].keyWindow;
#pragma clang diagnostic pop
  }
  return nil;
}

- (void)notifyGesture:(NSString *)gestureType
              touches:(NSArray<NSDictionary *> *)touches
             duration:(NSTimeInterval)duration
          targetLabel:(nullable NSString *)targetLabel {

  /*
  RJLogInfo(@"[RJ-TOUCH] notifyGesture called: type=%@, touchCount=%lu, "
        @"duration=%.2f",
        gestureType, (unsigned long)touches.count, duration);
  */

  @try {
    id<RJTouchInterceptorDelegate> delegate = self.delegate;
    if (delegate &&
        [delegate
            respondsToSelector:@selector
            (touchInterceptorDidRecognizeGesture:
                                         touches:duration:targetLabel:)]) {
      RJLogInfo(
          @"[RJ-TOUCH] Calling delegate touchInterceptorDidRecognizeGesture");
      [delegate
          touchInterceptorDidRecognizeGesture:gestureType ?: RJGestureTypeTap
                                      touches:touches ?: @[]
                                     duration:MAX(0, duration)
                                  targetLabel:targetLabel];
    } else {
      RJLogInfo(@"[RJ-TOUCH] Delegate missing or doesn't respond to selector: "
                @"delegate=%@",
                delegate);
    }
  } @catch (NSException *exception) {
    RJLogWarning(@"Gesture notification failed: %@", exception);
  }
}

@end
