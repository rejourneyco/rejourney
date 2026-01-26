//
//  RJCaptureHeuristics.h
//  Rejourney
//
//  Heuristic scheduler for session replay captures.
//
//  Copyright (c) 2026 Rejourney
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

#import "../Core/RJTypes.h"
#import "RJViewHierarchyScanner.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, RJCaptureHeuristicsAction) {
  RJCaptureHeuristicsActionRenderNow = 0,
  RJCaptureHeuristicsActionDefer = 1,
  RJCaptureHeuristicsActionReuseLast = 2,
};

typedef NS_ENUM(NSInteger, RJCaptureHeuristicsReason) {
  RJCaptureHeuristicsReasonRenderNow = 0,
  RJCaptureHeuristicsReasonDeferTouch,
  RJCaptureHeuristicsReasonDeferScroll,
  RJCaptureHeuristicsReasonDeferBounce,
  RJCaptureHeuristicsReasonDeferRefresh,
  RJCaptureHeuristicsReasonDeferTransition,
  RJCaptureHeuristicsReasonDeferKeyboard,
  RJCaptureHeuristicsReasonDeferMap,
  RJCaptureHeuristicsReasonDeferBigAnimation,
  RJCaptureHeuristicsReasonReuseSignatureUnchanged,
  RJCaptureHeuristicsReasonDeadlineExpired,
  RJCaptureHeuristicsReasonRenderFailedReuse,
};

@interface RJCaptureHeuristicsDecision : NSObject

@property(nonatomic, assign) RJCaptureHeuristicsAction action;
@property(nonatomic, assign) RJCaptureHeuristicsReason reason;
@property(nonatomic, assign) NSTimeInterval deferUntil;

@end

@interface RJCaptureHeuristics : NSObject

@property(nonatomic, assign, readonly) NSTimeInterval captureGraceSeconds;
@property(nonatomic, assign, readonly) NSTimeInterval pollIntervalSeconds;
@property(nonatomic, assign, readonly) NSTimeInterval maxStaleSeconds;
@property(nonatomic, assign, readonly) BOOL keyboardAnimating;
@property(nonatomic, assign, readonly) BOOL scrollActive;
@property(nonatomic, assign, readonly) BOOL animationBlocking;

- (void)reset;
- (void)invalidateSignature;
- (void)recordTouchEventAtTime:(NSTimeInterval)time;
- (void)recordInteractionEventAtTime:(NSTimeInterval)time;
- (void)recordMapInteractionAtTime:(NSTimeInterval)time;
- (void)recordNavigationEventAtTime:(NSTimeInterval)time;
- (void)recordRenderedSignature:(nullable NSString *)signature
                         atTime:(NSTimeInterval)time;

- (void)updateWithScanResult:(RJViewHierarchyScanResult *)scanResult
                      window:(UIWindow *)window
                         now:(NSTimeInterval)now;

- (void)updateWithStabilityProbeForWindow:(UIWindow *)window
                                      now:(NSTimeInterval)now;

- (RJCaptureHeuristicsDecision *)
    decisionForSignature:(nullable NSString *)signature
                     now:(NSTimeInterval)now
            hasLastFrame:(BOOL)hasLastFrame
              importance:(RJCaptureImportance)importance;

+ (NSString *)stringForReason:(RJCaptureHeuristicsReason)reason;

@end

NS_ASSUME_NONNULL_END
