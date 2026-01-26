//
//  RJPrivacyMask.m
//  Rejourney
//
//  Privacy masking implementation using Core Graphics drawing.
//  Draws blur overlays directly into the captured image without
//  adding any views to the window hierarchy.
//
//  Licensed under the Apache License, Version 2.0 (the "License").
//  Copyright (c) 2026 Rejourney
//

#import "RJPrivacyMask.h"
#import "../Capture/RJViewHierarchyScanner.h"
#import "../Core/RJLogger.h"
#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

static inline BOOL RJIsValidMaskFrame(CGRect frame) {
  return isfinite(frame.origin.x) && isfinite(frame.origin.y) &&
         isfinite(frame.size.width) && isfinite(frame.size.height) &&
         frame.size.width > 0 && frame.size.height > 0;
}

#pragma mark - Implementation

@interface RJPrivacyMask ()

@property(nonatomic, assign, readwrite) BOOL isInBackground;

@property(nonatomic, strong) NSMutableSet<NSValue *> *scannedViews;

@property(nonatomic, assign) BOOL lastFrameHadCamera;

@property(nonatomic, assign) BOOL lastFrameHadTextInput;
@property(nonatomic, assign) BOOL lastFrameHadWebView;

@property(nonatomic, assign) BOOL lastFrameHadVideo;

@property(nonatomic, strong) NSMutableArray<NSValue *> *textInputFrames;
@property(nonatomic, strong) NSMutableArray<NSValue *> *cameraFrames;
@property(nonatomic, strong) NSMutableArray<NSValue *> *webViewFrames;
@property(nonatomic, strong) NSMutableArray<NSValue *> *videoFrames;

@property(nonatomic, strong, readwrite)
    NSMutableSet<NSString *> *maskedNativeIDs;

@property(nonatomic, assign) CGColorSpaceRef commonColorSpace;

// Forward declarations to fix 'method not found' warnings/erros
- (void)findSensitiveViewsInWindow:(UIWindow *)window;
- (void)scanView:(UIView *)view inWindow:(UIWindow *)window;
- (void)drawBackgroundOverlayInContext:(CGContextRef)context
                                bounds:(CGRect)bounds
                                 scale:(CGFloat)scale;
- (void)drawBlurRectInContext:(CGContextRef)context
                        frame:(CGRect)frame
                     maskType:(NSInteger)maskType;
- (void)drawMasksWithScanResult:(RJViewHierarchyScanResult *)scanResult
                        context:(CGContextRef)context
                         bounds:(CGRect)bounds
                          scale:(CGFloat)scale;
- (BOOL)shouldMaskAllForScanResult:(RJViewHierarchyScanResult *)scanResult;

@end

@implementation RJPrivacyMask

#pragma mark - Initialization

- (instancetype)init {
  self = [super init];
  if (self) {
    _maskCameraViews = YES;
    _maskWebViews = YES;
    _maskVideoLayers = YES;
    _blurCornerRadius = 8.0;
    _maskPadding = 4.0;
    _isInBackground = NO;
    _scannedViews = [NSMutableSet new];
    _textInputFrames = [NSMutableArray new];
    _cameraFrames = [NSMutableArray new];
    _webViewFrames = [NSMutableArray new];
    _videoFrames = [NSMutableArray new];
    _lastFrameHadCamera = NO;
    _lastFrameHadTextInput = NO;
    _lastFrameHadWebView = NO;
    _lastFrameHadVideo = NO;
    _maskedNativeIDs = [NSMutableSet new];

    // Optimization #10: Cache color space once
    _commonColorSpace = CGColorSpaceCreateDeviceRGB();

    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(appDidEnterBackground:)
               name:UIApplicationDidEnterBackgroundNotification
             object:nil];
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(appWillEnterForeground:)
               name:UIApplicationWillEnterForegroundNotification
             object:nil];
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(appDidBecomeActive:)
               name:UIApplicationDidBecomeActiveNotification
             object:nil];
  }
  return self;
}

#pragma mark - Notification Handlers

- (void)appDidEnterBackground:(NSNotification *)notification {
  self.isInBackground = YES;
}

- (void)appWillEnterForeground:(NSNotification *)notification {
  // Optional: keep masked until active
}

- (void)appDidBecomeActive:(NSNotification *)notification {
  self.isInBackground = NO;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  if (_commonColorSpace) {
    CGColorSpaceRelease(_commonColorSpace);
    _commonColorSpace = NULL;
  }
}

- (BOOL)shouldMaskAllForScanResult:(RJViewHierarchyScanResult *)scanResult {
  if (!scanResult) {
    return YES;
  }
  if (scanResult.didBailOutEarly && scanResult.totalViewsScanned == 0) {
    return YES;
  }
  return NO;
}

- (void)drawMasksForWindow:(UIWindow *)window
                    bounds:(CGRect)bounds
                     scale:(CGFloat)scale {
  if (!window) {
    return;
  }

  CGContextRef context = UIGraphicsGetCurrentContext();
  if (!context) {
    return;
  }

  CGFloat safeScale =
      (isfinite(scale) && scale > 0.0) ? scale : 1.0;

  [self findSensitiveViewsInWindow:window];

  RJViewHierarchyScanResult *scanResult =
      [[RJViewHierarchyScanResult alloc] init];
  scanResult.textInputFrames = [self.textInputFrames copy];
  scanResult.cameraFrames = [self.cameraFrames copy];
  scanResult.webViewFrames = [self.webViewFrames copy];
  scanResult.videoFrames = [self.videoFrames copy];

  if ([self shouldMaskAllForScanResult:scanResult] || self.isInBackground) {
    [self drawBackgroundOverlayInContext:context bounds:bounds scale:safeScale];
    return;
  }

  [self drawMasksWithScanResult:scanResult
                        context:context
                         bounds:bounds
                          scale:safeScale];
}

- (void)drawMasksWithScanResult:(RJViewHierarchyScanResult *)scanResult
                         bounds:(CGRect)bounds
                          scale:(CGFloat)scale {
  CGContextRef context = UIGraphicsGetCurrentContext();
  if (!context) {
    return;
  }

  CGFloat safeScale =
      (isfinite(scale) && scale > 0.0) ? scale : 1.0;

  if ([self shouldMaskAllForScanResult:scanResult] || self.isInBackground) {
    [self drawBackgroundOverlayInContext:context bounds:bounds scale:safeScale];
    return;
  }

  [self drawMasksWithScanResult:scanResult
                        context:context
                         bounds:bounds
                          scale:safeScale];
}

- (UIImage *)applyMasksToImage:(UIImage *)image
                    scanResult:(RJViewHierarchyScanResult *)scanResult
                isInBackground:(BOOL)isInBackground {
  if (!image) {
    return image;
  }

  BOOL shouldMaskAll = isInBackground ||
      [self shouldMaskAllForScanResult:scanResult];
  BOOL hasFrames = (scanResult.textInputFrames.count > 0 ||
                    scanResult.cameraFrames.count > 0 ||
                    scanResult.webViewFrames.count > 0 ||
                    scanResult.videoFrames.count > 0);
  if (!shouldMaskAll && !hasFrames) {
    return image;
  }

  CGSize size = image.size;
  CGFloat imageScale = image.scale;
  CGRect bounds = CGRectMake(0, 0, size.width, size.height);

  UIGraphicsBeginImageContextWithOptions(size, YES, imageScale);
  [image drawAtPoint:CGPointZero];
  CGContextRef context = UIGraphicsGetCurrentContext();

  BOOL previousBackground = self.isInBackground;
  self.isInBackground = isInBackground;

  if (context) {
    if (shouldMaskAll) {
      [self drawBackgroundOverlayInContext:context bounds:bounds scale:1.0];
    } else {
      [self drawMasksWithScanResult:scanResult
                            context:context
                             bounds:bounds
                              scale:1.0];
    }
  }

  UIImage *maskedImage = UIGraphicsGetImageFromCurrentImageContext();
  UIGraphicsEndImageContext();

  self.isInBackground = previousBackground;
  return maskedImage ?: image;
}

- (void)applyToPixelBuffer:(CVPixelBufferRef)pixelBuffer
            withScanResult:(RJViewHierarchyScanResult *)scanResult
                     scale:(CGFloat)scale {
  if (!pixelBuffer)
    return;

  CGFloat safeScale =
      (isfinite(scale) && scale > 0.0) ? scale : 1.0;
  BOOL shouldMaskAll = [self shouldMaskAllForScanResult:scanResult];

  CVPixelBufferLockBaseAddress(pixelBuffer, 0);

  void *baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer);
  size_t width = CVPixelBufferGetWidth(pixelBuffer);
  size_t height = CVPixelBufferGetHeight(pixelBuffer);
  size_t bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer);

  // Optimization #10: Use cached color space
  CGColorSpaceRef colorSpace = self.commonColorSpace;
  if (!colorSpace) {
    // Fallback just in case
    colorSpace = CGColorSpaceCreateDeviceRGB();
  }

  CGContextRef context = CGBitmapContextCreate(
      baseAddress, width, height, 8, bytesPerRow, colorSpace,
      kCGImageAlphaNoneSkipFirst | kCGBitmapByteOrder32Little);

  // If we created a fallback, release it. If cached, don't.
  if (colorSpace != self.commonColorSpace) {
    CGColorSpaceRelease(colorSpace);
  }

  if (context) {
    UIGraphicsPushContext(context);

    CGContextTranslateCTM(context, 0, height);
    CGContextScaleCTM(context, 1.0, -1.0);
    CGContextScaleCTM(context, safeScale, safeScale);

    if (self.isInBackground || shouldMaskAll) {
      CGRect boundsPoints =
          CGRectMake(0, 0, width / safeScale, height / safeScale);
      [self drawBackgroundOverlayInContext:context
                                    bounds:boundsPoints
                                     scale:1.0];
    } else {
      [self drawMasksWithScanResult:scanResult
                            context:context
                              bounds:CGRectMake(0, 0, width / safeScale,
                                                height / safeScale)
                              scale:1.0];
    }

    UIGraphicsPopContext();
    CGContextRelease(context);
  } else {
    // Log sparingly or once to avoid spam
  }

  CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);
}

- (void)drawMasksWithScanResult:(RJViewHierarchyScanResult *)scanResult
                        context:(CGContextRef)context
                         bounds:(CGRect)bounds
                          scale:(CGFloat)scale {
  if (!scanResult || !context) {
    return;
  }

  @try {
    self.lastFrameHadCamera = NO;
    self.lastFrameHadTextInput = NO;
    self.lastFrameHadWebView = NO;
    self.lastFrameHadVideo = NO;

    if (self.isInBackground) {
      if ([self respondsToSelector:@selector
                (drawBackgroundOverlayInContext:bounds:scale:)]) {
        [self drawBackgroundOverlayInContext:context bounds:bounds scale:scale];
      }
      return;
    }

    if (scanResult.textInputFrames.count == 0 &&
        scanResult.cameraFrames.count == 0 &&
        scanResult.webViewFrames.count == 0 &&
        scanResult.videoFrames.count == 0) {
      return;
    }

    for (NSValue *frameValue in scanResult.textInputFrames) {
      CGRect frame = [frameValue CGRectValue];

      if (!RJIsValidMaskFrame(frame)) {
        continue;
      }

      frame = CGRectInset(frame, -self.maskPadding, -self.maskPadding);
      if (!RJIsValidMaskFrame(frame)) {
        continue;
      }
      [self drawBlurRectInContext:context
                            frame:frame
                         maskType:0];
      self.lastFrameHadTextInput = YES;
    }

    for (NSValue *frameValue in scanResult.cameraFrames) {
      CGRect frame = [frameValue CGRectValue];

      if (!RJIsValidMaskFrame(frame)) {
        continue;
      }

      frame = CGRectInset(frame, -self.maskPadding, -self.maskPadding);
      if (!RJIsValidMaskFrame(frame)) {
        continue;
      }
      [self drawBlurRectInContext:context frame:frame maskType:1]; // 1 = Camera
      self.lastFrameHadCamera = YES;
    }

    if (self.maskWebViews && scanResult.webViewFrames.count > 0) {
      for (NSValue *frameValue in scanResult.webViewFrames) {
        CGRect frame = [frameValue CGRectValue];

        if (!RJIsValidMaskFrame(frame)) {
          continue;
        }

        frame = CGRectInset(frame, -self.maskPadding, -self.maskPadding);
        if (!RJIsValidMaskFrame(frame)) {
          continue;
        }
        [self drawBlurRectInContext:context
                              frame:frame
                           maskType:2];
        self.lastFrameHadWebView = YES;
      }
    }

    if (self.maskVideoLayers && scanResult.videoFrames.count > 0) {
      for (NSValue *frameValue in scanResult.videoFrames) {
        CGRect frame = [frameValue CGRectValue];

        if (!RJIsValidMaskFrame(frame)) {
          continue;
        }

        frame = CGRectInset(frame, -self.maskPadding, -self.maskPadding);
        if (!RJIsValidMaskFrame(frame)) {
          continue;
        }
        [self drawBlurRectInContext:context
                              frame:frame
                           maskType:3];
        self.lastFrameHadVideo = YES;
      }
    }
  } @catch (NSException *exception) {
    RJLogWarning(@"Privacy mask drawing failed: %@", exception);
  }
}

- (void)drawBackgroundOverlayInContext:(CGContextRef)context
                                bounds:(CGRect)bounds
                                 scale:(CGFloat)scale {
  CGContextSetFillColorWithColor(context, [UIColor blackColor].CGColor);
  CGContextFillRect(context, bounds);
}

- (void)drawBlurRectInContext:(CGContextRef)context
                        frame:(CGRect)frame
                     maskType:(NSInteger)maskType {
  if (isnan(frame.origin.x) || isnan(frame.origin.y) ||
      isnan(frame.size.width) || isnan(frame.size.height) ||
      isinf(frame.origin.x) || isinf(frame.origin.y) ||
      isinf(frame.size.width) || isinf(frame.size.height)) {
    RJLogWarning(@"PrivacyMask: Skipping invalid frame with NaN/Inf values");
    return;
  }

  if (frame.size.width <= 0 || frame.size.height <= 0) {
    return;
  }

  CGContextSaveGState(context);

  UIBezierPath *path =
      [UIBezierPath bezierPathWithRoundedRect:frame
                                 cornerRadius:self.blurCornerRadius];

  UIColor *blurColor;
  if (maskType == 1 || maskType == 3) {
    blurColor = [UIColor colorWithRed:0.12 green:0.12 blue:0.15 alpha:1.0];
  } else if (maskType == 2) {
    blurColor = [UIColor colorWithRed:0.12 green:0.12 blue:0.15 alpha:1.0];
  } else {
    blurColor = [UIColor blackColor];
  }

  CGContextSetFillColorWithColor(context, blurColor.CGColor);
  CGContextAddPath(context, path.CGPath);
  CGContextFillPath(context);

  CGContextSetStrokeColorWithColor(
      context, [UIColor colorWithWhite:0.5 alpha:0.3].CGColor);
  CGContextSetLineWidth(context, 0.5);
  CGContextAddPath(context, path.CGPath);
  CGContextStrokePath(context);

  if (maskType == 1) {
    [self drawCameraLabelInContext:context frame:frame];
  } else if (maskType == 2) {
    [self drawWebViewLabelInContext:context frame:frame];
  } else if (maskType == 3) {
    [self drawVideoLabelInContext:context frame:frame];
  } else {
    [self drawTextInputLabelInContext:context frame:frame];
  }

  CGContextRestoreGState(context);
}

- (void)drawCameraLabelInContext:(CGContextRef)context frame:(CGRect)frame {
  if (isnan(frame.size.width) || isnan(frame.size.height) ||
      frame.size.width <= 0 || frame.size.height <= 0) {
    return;
  }

  CGFloat centerX = CGRectGetMidX(frame);
  CGFloat centerY = CGRectGetMidY(frame);

  if (isnan(centerX) || isnan(centerY)) {
    return;
  }

  NSString *label = @"📷 Camera Hidden";
  UIFont *font = [UIFont systemFontOfSize:14 weight:UIFontWeightMedium];
  NSDictionary *attrs = @{
    NSFontAttributeName : font,
    NSForegroundColorAttributeName : [UIColor colorWithWhite:0.7 alpha:1.0]
  };

  CGSize textSize = [label sizeWithAttributes:attrs];

  if (textSize.width < frame.size.width - 20 &&
      textSize.height < frame.size.height - 10) {
    CGPoint textPoint = CGPointMake(centerX - textSize.width / 2,
                                    centerY - textSize.height / 2);
    [label drawAtPoint:textPoint withAttributes:attrs];
  }
}

- (void)drawWebViewLabelInContext:(CGContextRef)context frame:(CGRect)frame {
  if (isnan(frame.size.width) || isnan(frame.size.height) ||
      frame.size.width <= 0 || frame.size.height <= 0) {
    return;
  }

  CGFloat centerX = CGRectGetMidX(frame);
  CGFloat centerY = CGRectGetMidY(frame);

  if (isnan(centerX) || isnan(centerY)) {
    return;
  }

  NSString *label = @"🌐 Web View Hidden";
  UIFont *font = [UIFont systemFontOfSize:14 weight:UIFontWeightMedium];
  NSDictionary *attrs = @{
    NSFontAttributeName : font,
    NSForegroundColorAttributeName : [UIColor colorWithWhite:0.7 alpha:1.0]
  };

  CGSize textSize = [label sizeWithAttributes:attrs];

  if (textSize.width < frame.size.width - 20 &&
      textSize.height < frame.size.height - 10) {
    CGPoint textPoint = CGPointMake(centerX - textSize.width / 2,
                                    centerY - textSize.height / 2);
    [label drawAtPoint:textPoint withAttributes:attrs];
  }
}

- (void)drawVideoLabelInContext:(CGContextRef)context frame:(CGRect)frame {
  if (isnan(frame.size.width) || isnan(frame.size.height) ||
      frame.size.width <= 0 || frame.size.height <= 0) {
    return;
  }

  CGFloat centerX = CGRectGetMidX(frame);
  CGFloat centerY = CGRectGetMidY(frame);

  if (isnan(centerX) || isnan(centerY)) {
    return;
  }

  NSString *label = @"🎥 Video Hidden";
  UIFont *font = [UIFont systemFontOfSize:14 weight:UIFontWeightMedium];
  NSDictionary *attrs = @{
    NSFontAttributeName : font,
    NSForegroundColorAttributeName : [UIColor colorWithWhite:0.7 alpha:1.0]
  };

  CGSize textSize = [label sizeWithAttributes:attrs];

  if (textSize.width < frame.size.width - 20 &&
      textSize.height < frame.size.height - 10) {
    CGPoint textPoint = CGPointMake(centerX - textSize.width / 2,
                                    centerY - textSize.height / 2);
    [label drawAtPoint:textPoint withAttributes:attrs];
  }
}

- (void)drawTextInputLabelInContext:(CGContextRef)context frame:(CGRect)frame {
  if (isnan(frame.size.width) || isnan(frame.size.height) ||
      frame.size.width <= 0 || frame.size.height <= 0) {
    return;
  }

  CGFloat centerX = CGRectGetMidX(frame);
  CGFloat centerY = CGRectGetMidY(frame);

  if (isnan(centerX) || isnan(centerY)) {
    return;
  }

  NSString *label = @"********";
  UIFont *font = [UIFont systemFontOfSize:14 weight:UIFontWeightMedium];
  NSDictionary *attrs = @{
    NSFontAttributeName : font,
    NSForegroundColorAttributeName : [UIColor whiteColor]
  };

  CGSize textSize = [label sizeWithAttributes:attrs];

  if (textSize.width < frame.size.width - 10 &&
      textSize.height < frame.size.height - 4) {
    CGPoint textPoint = CGPointMake(centerX - textSize.width / 2,
                                    centerY - textSize.height / 2);
    [label drawAtPoint:textPoint withAttributes:attrs];
  }
}

#pragma mark - Sensitive View Detection

- (void)findSensitiveViewsInWindow:(UIWindow *)window {
  if (!window) {
    return;
  }

  [self.scannedViews removeAllObjects];
  [self.textInputFrames removeAllObjects];
  [self.cameraFrames removeAllObjects];
  [self.webViewFrames removeAllObjects];
  [self.videoFrames removeAllObjects];

  [self scanView:window inWindow:window];
}

- (NSArray<NSValue *> *)findSensitiveFramesInWindow:(UIWindow *)window {

  [self findSensitiveViewsInWindow:window];

  NSMutableArray<NSValue *> *allFrames = [NSMutableArray new];
  [allFrames addObjectsFromArray:self.textInputFrames];
  [allFrames addObjectsFromArray:self.cameraFrames];
  [allFrames addObjectsFromArray:self.webViewFrames];
  [allFrames addObjectsFromArray:self.videoFrames];

  return allFrames;
}

- (void)scanView:(UIView *)view inWindow:(UIWindow *)window {
  if (!view || view.isHidden || view.alpha < 0.01)
    return;

  NSValue *viewPtr = [NSValue valueWithNonretainedObject:view];
  if ([self.scannedViews containsObject:viewPtr])
    return;
  [self.scannedViews addObject:viewPtr];

  BOOL isTextInput = self.maskTextInputs && [self isActualTextInput:view];
  BOOL isCamera = self.maskCameraViews && [self isCameraPreview:view];
  BOOL isWebView = self.maskWebViews && [self isWebViewSurface:view];
  BOOL isVideo = self.maskVideoLayers && [self isVideoLayerView:view];
  BOOL isManuallyMasked = [self isManuallyMaskedView:view];

  if (isTextInput || isCamera || isWebView || isVideo || isManuallyMasked) {
    CGRect frameInWindow = [view convertRect:view.bounds toView:window];

    CGFloat x = (isnan(frameInWindow.origin.x) || isinf(frameInWindow.origin.x))
                    ? 0
                    : frameInWindow.origin.x;
    CGFloat y = (isnan(frameInWindow.origin.y) || isinf(frameInWindow.origin.y))
                    ? 0
                    : frameInWindow.origin.y;
    CGFloat w =
        (isnan(frameInWindow.size.width) || isinf(frameInWindow.size.width))
            ? 0
            : frameInWindow.size.width;
    CGFloat h =
        (isnan(frameInWindow.size.height) || isinf(frameInWindow.size.height))
            ? 0
            : frameInWindow.size.height;
    CGRect sanitizedFrame = CGRectMake(x, y, w, h);

    if (!CGRectIsEmpty(sanitizedFrame) && sanitizedFrame.size.width > 10 &&
        sanitizedFrame.size.height > 10 &&
        CGRectIntersectsRect(sanitizedFrame, window.bounds)) {

      if (isCamera) {
        [self.cameraFrames addObject:[NSValue valueWithCGRect:sanitizedFrame]];
        RJLogDebug(@"PrivacyMask: Found camera %@ at %@",
                   NSStringFromClass([view class]),
                   NSStringFromCGRect(sanitizedFrame));
      } else if (isWebView) {
        [self.webViewFrames addObject:[NSValue valueWithCGRect:sanitizedFrame]];
        RJLogDebug(@"PrivacyMask: Found web view %@ at %@",
                   NSStringFromClass([view class]),
                   NSStringFromCGRect(sanitizedFrame));
      } else if (isVideo) {
        [self.videoFrames addObject:[NSValue valueWithCGRect:sanitizedFrame]];
        RJLogDebug(@"PrivacyMask: Found video view %@ at %@",
                   NSStringFromClass([view class]),
                   NSStringFromCGRect(sanitizedFrame));
      } else {

        [self.textInputFrames
            addObject:[NSValue valueWithCGRect:sanitizedFrame]];
        RJLogDebug(@"PrivacyMask: Found %@ %@ at %@",
                   isManuallyMasked ? @"masked view" : @"text input",
                   NSStringFromClass([view class]),
                   NSStringFromCGRect(sanitizedFrame));
      }
    }
  }

  for (UIView *subview in view.subviews) {
    [self scanView:subview inWindow:window];
  }
}

#pragma mark - Text Input Detection (STRICT)

- (BOOL)isActualTextInput:(UIView *)view {
  if (!view)
    return NO;

  if ([view isKindOfClass:[UITextField class]]) {
    return YES;
  }

  if ([view isKindOfClass:[UITextView class]]) {
    UITextView *tv = (UITextView *)view;
    return tv.isEditable;
  }

  if ([view isKindOfClass:[UISearchBar class]]) {
    return YES;
  }

  NSString *className = NSStringFromClass([view class]);

  static NSSet<NSString *> *rnInputClasses = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    rnInputClasses = [NSSet setWithArray:@[
      @"RCTUITextField",
      @"RCTBaseTextInputView",
      @"RCTSinglelineTextInputView",
      @"RCTMultilineTextInputView",
    ]];
  });

  if ([rnInputClasses containsObject:className]) {
    return YES;
  }

  Class currentClass = [view class];
  while (currentClass && currentClass != [UIView class]) {
    NSString *name = NSStringFromClass(currentClass);
    if ([name isEqualToString:@"RCTBaseTextInputView"]) {
      return YES;
    }
    currentClass = [currentClass superclass];
  }

  if ([view isFirstResponder] &&
      [view conformsToProtocol:@protocol(UITextInput)]) {

    NSString *className = NSStringFromClass([view class]);
    if (![className containsString:@"Keyboard"] &&
        ![className containsString:@"InputView"]) {
      return YES;
    }
  }

  return NO;
}

#pragma mark - Manual Masking Detection

- (BOOL)isManuallyMaskedView:(UIView *)view {
  if (!view)
    return NO;

  if (view.tag == 98765) {
    return YES;
  }

  if ([view.accessibilityHint isEqualToString:@"rejourney_occlude"]) {
    return YES;
  }

  NSString *nativeID = view.accessibilityIdentifier;
  if (nativeID.length > 0) {
    if ([self.maskedNativeIDs containsObject:nativeID]) {
      RJLogDebug(@"PrivacyMask: Found masked nativeID in view: %@", nativeID);
      return YES;
    }
  }

  for (UIView *subview in view.subviews) {
    NSString *childNativeID = subview.accessibilityIdentifier;
    if (childNativeID.length > 0 &&
        [self.maskedNativeIDs containsObject:childNativeID]) {
      RJLogDebug(@"PrivacyMask: Found masked nativeID in child: %@",
                 childNativeID);
      return YES;
    }
  }

  return NO;
}

#pragma mark - Manual nativeID Masking

- (void)addMaskedNativeID:(NSString *)nativeID {
  if (nativeID.length > 0) {
    [self.maskedNativeIDs addObject:nativeID];
    RJLogDebug(@"PrivacyMask: Added masked nativeID: %@", nativeID);
  }
}

- (void)removeMaskedNativeID:(NSString *)nativeID {
  if (nativeID.length > 0) {
    [self.maskedNativeIDs removeObject:nativeID];
    RJLogDebug(@"PrivacyMask: Removed masked nativeID: %@", nativeID);
  }
}

#pragma mark - Camera Detection

- (BOOL)isCameraPreview:(UIView *)view {
  if (!view)
    return NO;

  if ([view.layer isKindOfClass:[AVCaptureVideoPreviewLayer class]]) {
    return YES;
  }

  for (CALayer *sublayer in view.layer.sublayers) {
    if ([sublayer isKindOfClass:[AVCaptureVideoPreviewLayer class]]) {
      return YES;
    }
  }

  NSString *className = NSStringFromClass([view class]);

  static NSSet<NSString *> *cameraClasses = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    cameraClasses = [NSSet setWithArray:@[
      @"AVCaptureVideoPreviewView",
      @"CameraView",
      @"CKCameraView",
      @"RNCameraView",
      @"VisionCameraView",
      @"RNVisionCameraView",
      @"ExpoCameraView",
    ]];
  });

  if ([cameraClasses containsObject:className]) {
    return YES;
  }

  return NO;
}

- (BOOL)isWebViewSurface:(UIView *)view {
  if (!view)
    return NO;

  Class wkClass = NSClassFromString(@"WKWebView");
  if (wkClass && [view isKindOfClass:wkClass]) {
    return YES;
  }

  NSString *className = NSStringFromClass([view class]);
  static NSSet<NSString *> *webViewClasses = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    webViewClasses = [NSSet setWithArray:@[
      @"WKWebView",
      @"UIWebView",
      @"RCTWebView",
      @"RNCWebView",
      @"RNCWKWebView",
      @"RCTWKWebView",
      @"RNWebView",
    ]];
  });

  return [webViewClasses containsObject:className] ||
         [className containsString:@"WebView"];
}

- (BOOL)isVideoLayerView:(UIView *)view {
  if (!view)
    return NO;

  if ([view.layer isKindOfClass:[AVPlayerLayer class]]) {
    return YES;
  }

  for (CALayer *sublayer in view.layer.sublayers) {
    if ([sublayer isKindOfClass:[AVPlayerLayer class]]) {
      return YES;
    }
  }

  NSString *className = NSStringFromClass([view class]);
  return ([className containsString:@"Video"] &&
          [className containsString:@"View"]);
}

#pragma mark - Cleanup

- (void)forceCleanup {

  [self.scannedViews removeAllObjects];
}

@end
