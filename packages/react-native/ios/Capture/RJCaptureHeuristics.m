//
//  RJCaptureHeuristics.m
//  Rejourney
//
//  Capture heuristics implementation.
//
//  Copyright (c) 2026 Rejourney
//

#import "RJCaptureHeuristics.h"
#import "../Core/RJLogger.h"
#import <QuartzCore/QuartzCore.h>

static const NSTimeInterval kRJCaptureGraceSeconds = 0.9;
static const NSTimeInterval kRJPollIntervalSeconds = 0.08;
static const NSTimeInterval kRJMaxStaleSeconds = 5.0;

static const NSTimeInterval kRJQuietTouchSeconds = 0.12;
static const NSTimeInterval kRJQuietScrollSeconds = 0.2;
static const NSTimeInterval kRJQuietBounceSeconds = 0.2;
static const NSTimeInterval kRJQuietRefreshSeconds = 0.22;
static const NSTimeInterval kRJQuietMapSeconds = 0.55;
static const NSTimeInterval kRJQuietTransitionSeconds = 0.1;
static const NSTimeInterval kRJQuietKeyboardSeconds = 0.25;
static const NSTimeInterval kRJQuietAnimationSeconds = 0.25;

static const NSTimeInterval kRJMapSettleSeconds = 0.8;

static const NSTimeInterval kRJSignatureChurnWindowSeconds = 0.25;

static const NSTimeInterval kRJBonusScrollDelaySeconds = 0.12;
static const NSTimeInterval kRJBonusMapDelaySeconds = 0.35;
static const NSTimeInterval kRJBonusRefreshDelaySeconds = 0.2;
static const NSTimeInterval kRJBonusInteractionDelaySeconds = 0.15;
static const NSTimeInterval kRJBonusTransitionDelaySeconds = 0.2;
static const NSTimeInterval kRJBonusKeyboardDelaySeconds = 0.2;
static const NSTimeInterval kRJBonusAnimationDelaySeconds = 0.2;

static const CGFloat kRJAnimationSmallAreaAllowed = 0.03;

static const NSTimeInterval kRJKeyframeSpacingSeconds = 0.25;
static const NSUInteger kRJMaxPendingKeyframes = 3;

static const CGFloat kRJScrollEpsilon = 0.5;
static const CGFloat kRJZoomEpsilon = 0.01;
static const CGFloat kRJInsetEpsilon = 0.5;

typedef struct {
  double latitude;
  double longitude;
} RJCoordinate;

typedef struct {
  double latitudeDelta;
  double longitudeDelta;
} RJCoordinateSpan;

@interface RJScrollViewSample : NSObject

@property(nonatomic, assign) CGPoint contentOffset;
@property(nonatomic, assign) UIEdgeInsets contentInset;
@property(nonatomic, assign) CGFloat zoomScale;

@end

@implementation RJScrollViewSample
@end

@interface RJCaptureHeuristics ()

@property(nonatomic, assign) NSTimeInterval lastTouchTime;
@property(nonatomic, assign) NSTimeInterval lastScrollTime;
@property(nonatomic, assign) NSTimeInterval lastBounceTime;
@property(nonatomic, assign) NSTimeInterval lastRefreshTime;
@property(nonatomic, assign) NSTimeInterval lastMapTime;
@property(nonatomic, assign) NSTimeInterval lastTransitionTime;
@property(nonatomic, assign) NSTimeInterval lastKeyboardTime;
@property(nonatomic, assign) NSTimeInterval lastAnimationTime;
@property(nonatomic, assign) NSTimeInterval mapSettleUntil;

@property(nonatomic, assign) NSTimeInterval lastRenderedTime;
@property(nonatomic, copy, nullable) NSString *lastRenderedSignature;

@property(nonatomic, assign, readwrite) BOOL keyboardAnimating;
@property(nonatomic, assign, readwrite) BOOL scrollActive;
@property(nonatomic, assign, readwrite) BOOL refreshActive;
@property(nonatomic, assign, readwrite) BOOL mapActive;
@property(nonatomic, assign, readwrite) BOOL animationBlocking;
@property(nonatomic, assign) CGFloat lastAnimationAreaRatio;

@property(nonatomic, copy, nullable) NSString *lastObservedSignature;
@property(nonatomic, assign) NSTimeInterval lastObservedSignatureTime;
@property(nonatomic, assign) NSUInteger signatureChurnCount;
@property(nonatomic, assign) NSTimeInterval lastSignatureChurnTime;
@property(nonatomic, assign) BOOL churnBlocking;

@property(nonatomic, assign) BOOL hasVideoSurface;
@property(nonatomic, assign) BOOL hasWebSurface;
@property(nonatomic, assign) BOOL hasCameraSurface;

@property(nonatomic, weak) UIViewController *lastTopVC;

@property(nonatomic, assign) NSTimeInterval bonusCaptureTime;
@property(nonatomic, assign) NSUInteger pendingKeyframes;
@property(nonatomic, assign) NSTimeInterval lastKeyframeRenderTime;

@property(nonatomic, strong)
    NSMapTable<UIScrollView *, RJScrollViewSample *> *scrollSamples;
@property(nonatomic, strong) NSHashTable<UIView *> *animatedViews;
@property(nonatomic, strong) NSHashTable<UIView *> *mapViews;
@property(nonatomic, strong) NSMapTable<UIView *, NSString *> *mapStates;

@end

@implementation RJCaptureHeuristicsDecision
@end

@implementation RJCaptureHeuristics

- (instancetype)init {
  self = [super init];
  if (self) {
    _captureGraceSeconds = kRJCaptureGraceSeconds;
    _pollIntervalSeconds = kRJPollIntervalSeconds;
    _maxStaleSeconds = kRJMaxStaleSeconds;
    _scrollSamples = [NSMapTable weakToStrongObjectsMapTable];
    _animatedViews = [NSHashTable weakObjectsHashTable];
    _mapViews = [NSHashTable weakObjectsHashTable];
    _mapStates = [NSMapTable weakToStrongObjectsMapTable];

    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    [center addObserver:self
               selector:@selector(handleKeyboardWillChange:)
                   name:UIKeyboardWillShowNotification
                 object:nil];
    [center addObserver:self
               selector:@selector(handleKeyboardWillChange:)
                   name:UIKeyboardWillHideNotification
                 object:nil];
    [center addObserver:self
               selector:@selector(handleKeyboardWillChange:)
                   name:UIKeyboardWillChangeFrameNotification
                 object:nil];
    [center addObserver:self
               selector:@selector(handleKeyboardDidChange:)
                   name:UIKeyboardDidShowNotification
                 object:nil];
    [center addObserver:self
               selector:@selector(handleKeyboardDidChange:)
                   name:UIKeyboardDidHideNotification
                 object:nil];
    [center addObserver:self
               selector:@selector(handleKeyboardDidChange:)
                   name:UIKeyboardDidChangeFrameNotification
                 object:nil];
  }
  return self;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)reset {
  self.lastTouchTime = 0;
  self.lastScrollTime = 0;
  self.lastBounceTime = 0;
  self.lastRefreshTime = 0;
  self.lastMapTime = 0;
  self.lastTransitionTime = 0;
  self.lastKeyboardTime = 0;
  self.lastAnimationTime = 0;
  self.mapSettleUntil = 0;
  self.lastRenderedTime = 0;
  self.lastRenderedSignature = nil;
  self.lastObservedSignature = nil;
  self.lastObservedSignatureTime = 0;
  self.signatureChurnCount = 0;
  self.lastSignatureChurnTime = 0;
  self.churnBlocking = NO;
  self.keyboardAnimating = NO;
  self.scrollActive = NO;
  self.refreshActive = NO;
  self.mapActive = NO;
  self.animationBlocking = NO;
  self.lastAnimationAreaRatio = 0.0;
  self.hasVideoSurface = NO;
  self.hasWebSurface = NO;
  self.hasCameraSurface = NO;
  self.bonusCaptureTime = 0;
  self.pendingKeyframes = 0;
  self.lastKeyframeRenderTime = 0;
  self.lastTopVC = nil;
  [self.scrollSamples removeAllObjects];
  [self.animatedViews removeAllObjects];
  [self.mapViews removeAllObjects];
  [self.mapStates removeAllObjects];
}

- (void)invalidateSignature {
  self.lastRenderedSignature = nil;
  self.lastRenderedTime = 0;
}

- (void)recordTouchEventAtTime:(NSTimeInterval)time {
  self.lastTouchTime = time;
  [self scheduleBonusCaptureAfterDelay:kRJBonusInteractionDelaySeconds
                                   now:time];
}

- (void)recordInteractionEventAtTime:(NSTimeInterval)time {
  [self recordTouchEventAtTime:time];
}

- (void)recordMapInteractionAtTime:(NSTimeInterval)time {
  self.lastMapTime = time;
  NSTimeInterval candidate = time + kRJMapSettleSeconds;
  if (candidate > self.mapSettleUntil) {
    self.mapSettleUntil = candidate;
  }
}

- (void)recordNavigationEventAtTime:(NSTimeInterval)time {
  self.lastTransitionTime = time;
  [self scheduleBonusCaptureAfterDelay:kRJBonusTransitionDelaySeconds now:time];
}

- (void)recordRenderedSignature:(nullable NSString *)signature
                         atTime:(NSTimeInterval)time {
  self.lastRenderedSignature = signature.length > 0 ? signature : nil;
  self.lastRenderedTime = time;
  if (self.pendingKeyframes > 0) {
    self.pendingKeyframes -= 1;
    self.lastKeyframeRenderTime = time;
    if (self.pendingKeyframes > 0) {
      self.bonusCaptureTime = time + kRJKeyframeSpacingSeconds;
      return;
    }
  }
  self.bonusCaptureTime = 0;
}

- (void)updateWithScanResult:(RJViewHierarchyScanResult *)scanResult
                      window:(UIWindow *)window
                         now:(NSTimeInterval)now {
  if (!scanResult) {
    return;
  }

  [self updateTouchStateAtTime:now];
  [self updateTransitionStateForWindow:window atTime:now];

  NSString *currentSignature = scanResult.layoutSignature ?: @"";
  NSString *lastSignature = self.lastObservedSignature ?: @"";
  BOOL signatureChanged = ![currentSignature isEqualToString:lastSignature];
  if (signatureChanged) {
    NSTimeInterval delta = now - self.lastObservedSignatureTime;
    if (delta < kRJSignatureChurnWindowSeconds) {
      self.signatureChurnCount += 1;
    } else {
      self.signatureChurnCount = 1;
    }
    self.lastObservedSignatureTime = now;
    self.lastSignatureChurnTime = now;
    self.lastObservedSignature =
        currentSignature.length > 0 ? currentSignature : nil;
  } else if (self.lastSignatureChurnTime > 0 &&
             (now - self.lastSignatureChurnTime) >
                 kRJSignatureChurnWindowSeconds) {
    self.signatureChurnCount = 0;
  }
  self.churnBlocking =
      (self.signatureChurnCount >= 2 &&
       (now - self.lastSignatureChurnTime) < kRJSignatureChurnWindowSeconds);

  self.hasVideoSurface = (scanResult.videoFrames.count > 0);
  self.hasWebSurface = (scanResult.webViewFrames.count > 0);
  self.hasCameraSurface = (scanResult.cameraFrames.count > 0);

  if (scanResult.scrollActive) {
    // Active scroll is a strong blocker: rendering during drag or deceleration
    // causes visible hitching.
    self.lastScrollTime = now;
  }
  if (scanResult.bounceActive) {
    // Rubber-band bounce and inset settling stutter easily, so delay capture.
    self.lastBounceTime = now;
  }
  if (scanResult.refreshActive) {
    // Pull-to-refresh animations and insets can hitch; wait for settle.
    self.lastRefreshTime = now;
  }
  if (scanResult.mapActive) {
    // Map camera or tile motion is expensive; never capture mid-motion.
    [self recordMapInteractionAtTime:now];
  }

  [self updateScrollActiveState:scanResult.scrollActive
                  refreshActive:scanResult.refreshActive
                      mapActive:scanResult.mapActive
                            now:now];

  BOOL blockingAnimation = NO;
  if (scanResult.hasAnyAnimations) {
    self.lastAnimationAreaRatio = scanResult.animationAreaRatio;
    blockingAnimation =
        (scanResult.animationAreaRatio >= kRJAnimationSmallAreaAllowed);
  } else {
    self.lastAnimationAreaRatio = 0.0;
  }

  BOOL recentSignatureChange =
      signatureChanged ||
      (self.signatureChurnCount > 0 &&
       (now - self.lastSignatureChurnTime) < kRJSignatureChurnWindowSeconds);
  BOOL bailoutBlocking = (scanResult.didBailOutEarly && recentSignatureChange);
  BOOL shouldBlock = blockingAnimation || self.churnBlocking || bailoutBlocking;
  self.animationBlocking = shouldBlock;
  if (shouldBlock) {
    self.lastAnimationTime = now;
  }

  [self updateTrackedScrollViews:scanResult.scrollViewPointers now:now];
  [self updateTrackedMapViews:scanResult.mapViewPointers now:now];
  [self updateTrackedAnimatedViews:scanResult.animatedViewPointers];
}

- (void)updateWithStabilityProbeForWindow:(UIWindow *)window
                                      now:(NSTimeInterval)now {
  [self updateTouchStateAtTime:now];
  [self updateTransitionStateForWindow:window atTime:now];

  [self probeScrollViewsAtTime:now];
  [self probeMapViewsAtTime:now];
  [self probeAnimatedViewsAtTime:now];
}

- (RJCaptureHeuristicsDecision *)
    decisionForSignature:(nullable NSString *)signature
                     now:(NSTimeInterval)now
            hasLastFrame:(BOOL)hasLastFrame
              importance:(RJCaptureImportance)importance {
  RJCaptureHeuristicsDecision *decision =
      [[RJCaptureHeuristicsDecision alloc] init];

  NSTimeInterval earliestSafeTime = now;
  RJCaptureHeuristicsReason blockerReason = RJCaptureHeuristicsReasonRenderNow;

  // Check importance to potentially bypass heuristics
  BOOL isUrgent = (importance == RJCaptureImportanceHigh ||
                   importance == RJCaptureImportanceCritical);

  // Active touch/gesture input should be avoided to keep input latency smooth.
  // CRITICAL updates bypass this.
  if (!isUrgent) {
    [self considerBlockerSince:self.lastTouchTime
                 quietInterval:kRJQuietTouchSeconds
                           now:now
                        reason:RJCaptureHeuristicsReasonDeferTouch
                  earliestTime:&earliestSafeTime
                  chosenReason:&blockerReason];
  }

  // Scroll motion (dragging or deceleration) is a high-jank period.
  // Even urgent captures should respect scroll to avoid visible hitching,
  // unless CRITICAL
  if (importance != RJCaptureImportanceCritical) {
    [self considerBlockerSince:self.lastScrollTime
                 quietInterval:kRJQuietScrollSeconds
                           now:now
                        reason:RJCaptureHeuristicsReasonDeferScroll
                  earliestTime:&earliestSafeTime
                  chosenReason:&blockerReason];
  }

  // Rubber-band bounce and inset animations are visually sensitive.
  if (!isUrgent) {
    [self considerBlockerSince:self.lastBounceTime
                 quietInterval:kRJQuietBounceSeconds
                           now:now
                        reason:RJCaptureHeuristicsReasonDeferBounce
                  earliestTime:&earliestSafeTime
                  chosenReason:&blockerReason];
  }

  // Pull-to-refresh animations should finish before rendering.
  if (!isUrgent) {
    [self considerBlockerSince:self.lastRefreshTime
                 quietInterval:kRJQuietRefreshSeconds
                           now:now
                        reason:RJCaptureHeuristicsReasonDeferRefresh
                  earliestTime:&earliestSafeTime
                  chosenReason:&blockerReason];
  }

  // Interactive transitions (swipe back, drag-to-dismiss) are hitch-sensitive.
  // KEY FIX: Urgent captures (NAVIGATION) must bypass this!
  if (!isUrgent) {
    [self considerBlockerSince:self.lastTransitionTime
                 quietInterval:kRJQuietTransitionSeconds
                           now:now
                        reason:RJCaptureHeuristicsReasonDeferTransition
                  earliestTime:&earliestSafeTime
                  chosenReason:&blockerReason];
  }

  // Keyboard frame animations can stutter; wait for settle.
  if (self.keyboardAnimating) {
    self.lastKeyboardTime = now;
  }
  if (!isUrgent) {
    [self considerBlockerSince:self.lastKeyboardTime
                 quietInterval:kRJQuietKeyboardSeconds
                           now:now
                        reason:RJCaptureHeuristicsReasonDeferKeyboard
                  earliestTime:&earliestSafeTime
                  chosenReason:&blockerReason];
  }

  // Map camera or tile motion is visually obvious; avoid rendering mid-flight.
  // Maps are special; even CRITICAL captures might want to wait for map settle
  // if possible.
  if (importance != RJCaptureImportanceCritical) {
    [self considerBlockerSince:self.lastMapTime
                 quietInterval:kRJQuietMapSeconds
                           now:now
                        reason:RJCaptureHeuristicsReasonDeferMap
                  earliestTime:&earliestSafeTime
                  chosenReason:&blockerReason];

    if (self.mapSettleUntil > now && self.mapSettleUntil > earliestSafeTime) {
      earliestSafeTime = self.mapSettleUntil;
      blockerReason = RJCaptureHeuristicsReasonDeferMap;
    }
  }

  // Large-area animations (Lottie, shimmer, etc.) are very noticeable.
  if (self.animationBlocking && !isUrgent) {
    [self considerBlockerSince:self.lastAnimationTime
                 quietInterval:kRJQuietAnimationSeconds
                           now:now
                        reason:RJCaptureHeuristicsReasonDeferBigAnimation
                  earliestTime:&earliestSafeTime
                  chosenReason:&blockerReason];
  }

  if (earliestSafeTime > now) {
    decision.action = RJCaptureHeuristicsActionDefer;
    decision.reason = blockerReason;
    decision.deferUntil = earliestSafeTime;
    return decision;
  }

  BOOL signatureChanged =
      (signature.length == 0 ||
       ![signature isEqualToString:self.lastRenderedSignature]);
  BOOL stale = (self.lastRenderedTime <= 0 ||
                (now - self.lastRenderedTime) > self.maxStaleSeconds);
  BOOL bonusDue = (self.bonusCaptureTime > 0 && now >= self.bonusCaptureTime);
  BOOL keyframeDue =
      bonusDue && self.pendingKeyframes > 0 &&
      (now - self.lastKeyframeRenderTime) >= kRJKeyframeSpacingSeconds;
  BOOL staleOnly = stale && hasLastFrame && !signatureChanged && !keyframeDue;
  BOOL suppressStaleRender =
      staleOnly &&
      (self.hasVideoSurface || self.hasWebSurface || self.hasCameraSurface);

  if (suppressStaleRender && !isUrgent) {
    decision.action = RJCaptureHeuristicsActionReuseLast;
    decision.reason = RJCaptureHeuristicsReasonReuseSignatureUnchanged;
    return decision;
  }

  if (!hasLastFrame || signatureChanged || stale || keyframeDue || isUrgent) {
    decision.action = RJCaptureHeuristicsActionRenderNow;
    decision.reason = RJCaptureHeuristicsReasonRenderNow;
    return decision;
  }

  decision.action = RJCaptureHeuristicsActionReuseLast;
  decision.reason = RJCaptureHeuristicsReasonReuseSignatureUnchanged;
  return decision;
}

+ (NSString *)stringForReason:(RJCaptureHeuristicsReason)reason {
  switch (reason) {
  case RJCaptureHeuristicsReasonRenderNow:
    return @"RENDER_NOW";
  case RJCaptureHeuristicsReasonDeferTouch:
    return @"DEFER_TOUCH";
  case RJCaptureHeuristicsReasonDeferScroll:
    return @"DEFER_SCROLL";
  case RJCaptureHeuristicsReasonDeferBounce:
    return @"DEFER_BOUNCE";
  case RJCaptureHeuristicsReasonDeferRefresh:
    return @"DEFER_REFRESH";
  case RJCaptureHeuristicsReasonDeferTransition:
    return @"DEFER_TRANSITION";
  case RJCaptureHeuristicsReasonDeferKeyboard:
    return @"DEFER_KEYBOARD";
  case RJCaptureHeuristicsReasonDeferMap:
    return @"DEFER_MAP";
  case RJCaptureHeuristicsReasonDeferBigAnimation:
    return @"DEFER_BIG_ANIMATION";
  case RJCaptureHeuristicsReasonReuseSignatureUnchanged:
    return @"REUSE_SIGNATURE_UNCHANGED";
  case RJCaptureHeuristicsReasonDeadlineExpired:
    return @"REUSE_DEADLINE_EXPIRED";
  case RJCaptureHeuristicsReasonRenderFailedReuse:
    return @"RENDER_FAILED_REUSE";
  }

  return @"";
}

#pragma mark - Keyboard Tracking

- (void)handleKeyboardWillChange:(NSNotification *)notification {
  self.keyboardAnimating = YES;
  self.lastKeyboardTime = CACurrentMediaTime();
}

- (void)handleKeyboardDidChange:(NSNotification *)notification {
  self.keyboardAnimating = NO;
  NSTimeInterval now = CACurrentMediaTime();
  self.lastKeyboardTime = now;
  [self scheduleBonusCaptureAfterDelay:kRJBonusKeyboardDelaySeconds now:now];
}

#pragma mark - Touch/Transition Tracking

- (void)updateTouchStateAtTime:(NSTimeInterval)now {
  NSString *mode = [[NSRunLoop mainRunLoop] currentMode];
  if ([mode isEqualToString:UITrackingRunLoopMode]) {
    self.lastTouchTime = now;
    self.lastScrollTime = now;
  }
}

- (void)updateTransitionStateForWindow:(UIWindow *)window
                                atTime:(NSTimeInterval)now {
  UIViewController *topVC = [self topViewControllerForWindow:window];
  if (topVC != self.lastTopVC) {
    self.lastTransitionTime = now;
    [self scheduleBonusCaptureAfterDelay:kRJBonusTransitionDelaySeconds
                                     now:now];
    self.lastTopVC = topVC;
  }
  id<UIViewControllerTransitionCoordinator> coordinator =
      topVC.transitionCoordinator;
  if (coordinator && (coordinator.isInteractive || coordinator.isAnimated)) {
    self.lastTransitionTime = now;
  }
}

- (UIViewController *)topViewControllerForWindow:(UIWindow *)window {
  UIViewController *root = window.rootViewController;
  if (!root) {
    return nil;
  }
  return [self topViewControllerFrom:root];
}

- (UIViewController *)topViewControllerFrom:(UIViewController *)viewController {
  if (viewController.presentedViewController) {
    return [self topViewControllerFrom:viewController.presentedViewController];
  }
  if ([viewController isKindOfClass:[UINavigationController class]]) {
    UINavigationController *nav = (UINavigationController *)viewController;
    return [self topViewControllerFrom:nav.visibleViewController];
  }
  if ([viewController isKindOfClass:[UITabBarController class]]) {
    UITabBarController *tab = (UITabBarController *)viewController;
    return [self topViewControllerFrom:tab.selectedViewController];
  }
  return viewController;
}

#pragma mark - Scroll Tracking

- (void)updateTrackedScrollViews:(NSArray<NSValue *> *)scrollViewPointers
                             now:(NSTimeInterval)now {
  if (!scrollViewPointers) {
    return;
  }

  for (NSValue *pointer in scrollViewPointers) {
    UIScrollView *scrollView = [pointer nonretainedObjectValue];
    if (![scrollView isKindOfClass:[UIScrollView class]]) {
      continue;
    }
    [self evaluateScrollView:scrollView
                         now:now
                scrollActive:NULL
               refreshActive:NULL];
  }
}

- (void)probeScrollViewsAtTime:(NSTimeInterval)now {
  BOOL anyScrollActive = NO;
  BOOL anyRefreshActive = NO;

  NSArray<UIScrollView *> *scrollViews =
      [[self.scrollSamples keyEnumerator] allObjects];
  if (!scrollViews) {
    scrollViews = @[];
  }
  for (UIScrollView *scrollView in scrollViews) {
    if (![scrollView isKindOfClass:[UIScrollView class]]) {
      continue;
    }
    [self evaluateScrollView:scrollView
                         now:now
                scrollActive:&anyScrollActive
               refreshActive:&anyRefreshActive];
  }

  [self updateScrollActiveState:anyScrollActive
                  refreshActive:anyRefreshActive
                      mapActive:self.mapActive
                            now:now];
}

- (void)evaluateScrollView:(UIScrollView *)scrollView
                       now:(NSTimeInterval)now
              scrollActive:(BOOL *)scrollActive
             refreshActive:(BOOL *)refreshActive {
  RJScrollViewSample *sample = [self.scrollSamples objectForKey:scrollView];
  if (!sample) {
    sample = [[RJScrollViewSample alloc] init];
  }

  CGPoint offset = scrollView.contentOffset;
  UIEdgeInsets inset = scrollView.contentInset;
  CGFloat zoomScale = scrollView.zoomScale;

  BOOL tracking = scrollView.isTracking || scrollView.isDragging ||
                  scrollView.isDecelerating;
  BOOL offsetMoved =
      (fabs(offset.x - sample.contentOffset.x) > kRJScrollEpsilon ||
       fabs(offset.y - sample.contentOffset.y) > kRJScrollEpsilon);
  BOOL zoomMoved = fabs(zoomScale - sample.zoomScale) > kRJZoomEpsilon;
  BOOL isScrolling = tracking || offsetMoved || zoomMoved;

  if (isScrolling) {
    // Scroll movement, including momentum/deceleration.
    self.lastScrollTime = now;
    if (scrollActive) {
      *scrollActive = YES;
    }
  }

  BOOL insetChanged =
      (fabs(inset.top - sample.contentInset.top) > kRJInsetEpsilon ||
       fabs(inset.bottom - sample.contentInset.bottom) > kRJInsetEpsilon ||
       fabs(inset.left - sample.contentInset.left) > kRJInsetEpsilon ||
       fabs(inset.right - sample.contentInset.right) > kRJInsetEpsilon);

  BOOL isOverscrolled = [self isOverscrolling:scrollView offset:offset];
  if (isOverscrolled || insetChanged) {
    // Rubber-band bounce or inset settling.
    self.lastBounceTime = now;
  }

  BOOL refreshVisible = [self isRefreshActiveForScrollView:scrollView
                                                    offset:offset
                                                     inset:inset];
  if (refreshVisible) {
    // Pull-to-refresh is active or settling.
    self.lastRefreshTime = now;
    if (refreshActive) {
      *refreshActive = YES;
    }
  }

  sample.contentOffset = offset;
  sample.contentInset = inset;
  sample.zoomScale = zoomScale;
  [self.scrollSamples setObject:sample forKey:scrollView];
}

- (BOOL)isOverscrolling:(UIScrollView *)scrollView offset:(CGPoint)offset {
  UIEdgeInsets inset = UIEdgeInsetsZero;
  @try {
    inset = scrollView.adjustedContentInset;
  } @catch (NSException *exception) {
    inset = scrollView.contentInset;
  }
  CGFloat topLimit = -inset.top - kRJScrollEpsilon;
  CGFloat bottomLimit = scrollView.contentSize.height -
                        scrollView.bounds.size.height + inset.bottom +
                        kRJScrollEpsilon;

  if (offset.y < topLimit || offset.y > bottomLimit) {
    return YES;
  }

  CGFloat leftLimit = -inset.left - kRJScrollEpsilon;
  CGFloat rightLimit = scrollView.contentSize.width -
                       scrollView.bounds.size.width + inset.right +
                       kRJScrollEpsilon;
  if (offset.x < leftLimit || offset.x > rightLimit) {
    return YES;
  }

  return NO;
}

- (BOOL)isRefreshActiveForScrollView:(UIScrollView *)scrollView
                              offset:(CGPoint)offset
                               inset:(UIEdgeInsets)inset {
  UIRefreshControl *refreshControl = scrollView.refreshControl;
  if (!refreshControl) {
    return NO;
  }

  if (refreshControl.isRefreshing) {
    return YES;
  }

  CGFloat triggerOffset =
      -scrollView.adjustedContentInset.top - kRJScrollEpsilon;
  if (offset.y < triggerOffset) {
    return YES;
  }

  CGRect refreshFrame = refreshControl.frame;
  if (refreshControl.superview) {
    CGRect inScroll = [refreshControl.superview convertRect:refreshFrame
                                                     toView:scrollView];
    if (CGRectIntersectsRect(inScroll, scrollView.bounds)) {
      return YES;
    }
  }

  return NO;
}

- (void)updateScrollActiveState:(BOOL)scrollActive
                  refreshActive:(BOOL)refreshActive
                      mapActive:(BOOL)mapActive
                            now:(NSTimeInterval)now {
  if (self.scrollActive && !scrollActive) {
    [self scheduleBonusCaptureAfterDelay:kRJBonusScrollDelaySeconds now:now];
  }
  if (self.refreshActive && !refreshActive) {
    [self scheduleBonusCaptureAfterDelay:kRJBonusRefreshDelaySeconds now:now];
  }
  if (self.mapActive && !mapActive) {
    [self scheduleBonusCaptureAfterDelay:kRJBonusMapDelaySeconds now:now];
    NSTimeInterval candidate = now + kRJMapSettleSeconds;
    if (candidate > self.mapSettleUntil) {
      self.mapSettleUntil = candidate;
    }
  }

  self.scrollActive = scrollActive;
  self.refreshActive = refreshActive;
  self.mapActive = mapActive;
}

#pragma mark - Map Tracking

- (void)updateTrackedMapViews:(NSArray<NSValue *> *)mapViewPointers
                          now:(NSTimeInterval)now {
  if (!mapViewPointers) {
    return;
  }

  for (NSValue *pointer in mapViewPointers) {
    UIView *view = [pointer nonretainedObjectValue];
    if (![view isKindOfClass:[UIView class]]) {
      continue;
    }
    [self.mapViews addObject:view];
    [self updateMapStateForView:view atTime:now];
  }
}

- (void)probeMapViewsAtTime:(NSTimeInterval)now {
  BOOL anyMapActive = NO;
  for (UIView *view in self.mapViews) {
    if (![view isKindOfClass:[UIView class]]) {
      continue;
    }
    if ([self updateMapStateForView:view atTime:now]) {
      anyMapActive = YES;
    }
  }
  if (anyMapActive) {
    self.lastMapTime = now;
  }
  [self updateScrollActiveState:self.scrollActive
                  refreshActive:self.refreshActive
                      mapActive:anyMapActive || self.mapActive
                            now:now];
}

- (BOOL)updateMapStateForView:(UIView *)view atTime:(NSTimeInterval)now {
  NSString *signature = [self mapSignatureForView:view];
  if (signature.length == 0) {
    return NO;
  }

  NSString *previous = [self.mapStates objectForKey:view];
  [self.mapStates setObject:signature forKey:view];
  if (!previous) {
    return NO;
  }
  if (![previous isEqualToString:signature]) {
    [self recordMapInteractionAtTime:now];
    return YES;
  }
  return NO;
}

- (NSString *)mapSignatureForView:(UIView *)view {
  @try {
    NSValue *centerValue = [view valueForKey:@"centerCoordinate"];
    NSValue *spanValue = [view valueForKeyPath:@"region.span"];

    RJCoordinate center = {0, 0};
    RJCoordinateSpan span = {0, 0};
    if ([centerValue isKindOfClass:[NSValue class]]) {
      [centerValue getValue:&center];
    }
    if ([spanValue isKindOfClass:[NSValue class]]) {
      [spanValue getValue:&span];
    }

    NSNumber *altitude = [view valueForKeyPath:@"camera.altitude"];
    NSNumber *heading = [view valueForKeyPath:@"camera.heading"];
    NSNumber *pitch = [view valueForKeyPath:@"camera.pitch"];

    double altitudeValue = altitude ? altitude.doubleValue : 0;
    double headingValue = heading ? heading.doubleValue : 0;
    double pitchValue = pitch ? pitch.doubleValue : 0;

    return [NSString stringWithFormat:@"%.5f:%.5f:%.5f:%.5f:%.1f:%.1f:%.1f",
                                      center.latitude, center.longitude,
                                      span.latitudeDelta, span.longitudeDelta,
                                      altitudeValue, headingValue, pitchValue];
  } @catch (NSException *exception) {
    return @"";
  }
}

#pragma mark - Animation Tracking

- (void)updateTrackedAnimatedViews:(NSArray<NSValue *> *)animatedViewPointers {
  if (!animatedViewPointers) {
    return;
  }

  [self.animatedViews removeAllObjects];
  for (NSValue *pointer in animatedViewPointers) {
    UIView *view = [pointer nonretainedObjectValue];
    if (![view isKindOfClass:[UIView class]]) {
      continue;
    }
    [self.animatedViews addObject:view];
  }
}

- (void)probeAnimatedViewsAtTime:(NSTimeInterval)now {
  if (self.churnBlocking) {
    if ((now - self.lastSignatureChurnTime) < kRJSignatureChurnWindowSeconds) {
      self.lastAnimationTime = now;
      return;
    }
    self.churnBlocking = NO;
  }

  if (!self.animationBlocking) {
    return;
  }

  BOOL stillAnimating = NO;
  for (UIView *view in self.animatedViews) {
    if (![view isKindOfClass:[UIView class]]) {
      continue;
    }
    if (view.layer.animationKeys.count > 0) {
      stillAnimating = YES;
      break;
    }
  }

  if (stillAnimating) {
    self.lastAnimationTime = now;
  } else {
    self.animationBlocking = NO;
    [self scheduleBonusCaptureAfterDelay:kRJBonusAnimationDelaySeconds now:now];
  }
}

#pragma mark - Bonus Capture

- (void)scheduleBonusCaptureAfterDelay:(NSTimeInterval)delay
                                   now:(NSTimeInterval)now {
  if (self.pendingKeyframes < kRJMaxPendingKeyframes) {
    self.pendingKeyframes += 1;
  }
  NSTimeInterval candidate = now + delay;
  if (self.bonusCaptureTime <= 0 || candidate < self.bonusCaptureTime) {
    self.bonusCaptureTime = candidate;
  }
}

#pragma mark - Decision Helpers

- (void)considerBlockerSince:(NSTimeInterval)timestamp
               quietInterval:(NSTimeInterval)quietInterval
                         now:(NSTimeInterval)now
                      reason:(RJCaptureHeuristicsReason)reason
                earliestTime:(NSTimeInterval *)earliestTime
                chosenReason:(RJCaptureHeuristicsReason *)chosenReason {
  if (timestamp <= 0) {
    return;
  }

  NSTimeInterval readyTime = timestamp + quietInterval;
  if (readyTime > now && readyTime > *earliestTime) {
    *earliestTime = readyTime;
    *chosenReason = reason;
  }
}

@end
