//
//  RJViewHierarchyScanner.m
//  Rejourney
//
//  Unified view hierarchy scanner implementation.
//  Combines layout signature generation and privacy rect detection
//  into a single traversal pass for optimal performance.
//
//  Licensed under the Apache License, Version 2.0 (the "License").
//  Copyright (c) 2026 Rejourney
//

#import "RJViewHierarchyScanner.h"
#import "../Core/RJLogger.h"
#import <AVFoundation/AVFoundation.h>
#import <CommonCrypto/CommonDigest.h>
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/message.h>

static const CGFloat kRJScrollEpsilon = 0.5;
static const CGFloat kRJZoomEpsilon = 0.01;
static const CGFloat kRJInsetEpsilon = 0.5;
static const CGFloat kRJAnimationPresentationEpsilon = 1.0;

typedef struct {
  double latitude;
  double longitude;
} RJCoordinate;

typedef struct {
  double latitudeDelta;
  double longitudeDelta;
} RJCoordinateSpan;

static inline uint64_t fnv1a_u64(uint64_t h, const void *data, size_t len) {
  const uint8_t *p = data;
  while (len--) {
    h ^= *p++;
    h *= 1099511628211ULL;
  }
  return h;
}

#pragma mark - Scan Result Implementation

@implementation RJViewHierarchyScanResult

- (instancetype)init {
  self = [super init];
  if (self) {
    _textInputFrames = @[];
    _cameraFrames = @[];
    _webViewFrames = @[];
    _videoFrames = @[];
    _mapViewFrames = @[];
    _mapViewPointers = @[];
    _scrollViewPointers = @[];
    _animatedViewPointers = @[];
    _scrollActive = NO;
    _bounceActive = NO;
    _refreshActive = NO;
    _mapActive = NO;
    _hasAnyAnimations = NO;
    _animationAreaRatio = 0.0;
    _didBailOutEarly = NO;
    _totalViewsScanned = 0;
    _scanTimestamp = [[NSDate date] timeIntervalSince1970];
  }
  return self;
}

- (BOOL)hasWebViews {
  return self.webViewFrames.count > 0;
}

- (BOOL)hasTextInputs {
  return self.textInputFrames.count > 0;
}

- (BOOL)hasCameraViews {
  return self.cameraFrames.count > 0;
}

@end

@interface RJScrollViewState : NSObject

@property(nonatomic, assign) CGPoint contentOffset;
@property(nonatomic, assign) UIEdgeInsets contentInset;
@property(nonatomic, assign) CGFloat zoomScale;

@end

@implementation RJScrollViewState
@end

#pragma mark - Scanner Configuration Implementation

@implementation RJViewHierarchyScannerConfig

+ (instancetype)defaultConfig {
  RJViewHierarchyScannerConfig *config =
      [[RJViewHierarchyScannerConfig alloc] init];
  config.detectTextInputs = YES;
  config.detectCameraViews = YES;
  config.detectWebViews = YES;
  config.detectVideoLayers = YES;
  config.maskedNativeIDs = [NSSet set];
  config.maxDepth = 8; // Aggressive optimization
  config.maxViewCount = 500;
  return config;
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _detectTextInputs = YES;
    _detectCameraViews = YES;
    _detectWebViews = YES;
    _detectVideoLayers = YES;
    _maskedNativeIDs = [NSSet set];
    _maxDepth = 25;       // Increased scan depth for better fidelity
    _maxViewCount = 2000; // Increased view count limit
  }
  return self;
}

@end

#pragma mark - Private Interface

@interface RJViewHierarchyScanner ()

@property(nonatomic, strong) NSSet<NSString *> *rnInputClasses;

@property(nonatomic, strong) NSSet<NSString *> *cameraClasses;
@property(nonatomic, strong) NSSet<NSString *> *webViewClasses;
@property(nonatomic, strong) NSSet<NSString *> *mapViewClasses;

@property(nonatomic, assign) BOOL foundMapView;

@property(nonatomic, strong) NSArray<Class> *resolvedRnInputClasses;
@property(nonatomic, strong) NSArray<Class> *resolvedCameraClasses;
@property(nonatomic, strong) NSArray<Class> *resolvedWebViewClasses;

@property(nonatomic, assign) uint64_t layoutSignatureHash;

@property(nonatomic, strong) NSMutableArray<NSValue *> *mutableTextInputFrames;
@property(nonatomic, strong) NSMutableArray<NSValue *> *mutableCameraFrames;
@property(nonatomic, strong) NSMutableArray<NSValue *> *mutableWebViewFrames;
@property(nonatomic, strong) NSMutableArray<NSValue *> *mutableVideoFrames;
@property(nonatomic, strong) NSMutableArray<NSValue *> *mutableMapViewFrames;
@property(nonatomic, strong) NSMutableArray<NSValue *> *mutableMapViewPointers;
@property(nonatomic, strong)
    NSMutableArray<NSValue *> *mutableScrollViewPointers;
@property(nonatomic, strong)
    NSMutableArray<NSValue *> *mutableAnimatedViewPointers;

@property(nonatomic, strong) NSMapTable<Class, NSString *> *classNameCache;

@property(nonatomic, assign) Class cachedUITextField;
@property(nonatomic, assign) Class cachedUITextView;
@property(nonatomic, assign) Class cachedUISearchBar;
@property(nonatomic, assign) Class cachedUIControl;
@property(nonatomic, assign) Class cachedUIImageView;
@property(nonatomic, assign) Class cachedUILabel;
@property(nonatomic, assign) Class cachedAVCapturePreviewLayer;
@property(nonatomic, assign) Class cachedAVPlayerLayer;

@property(nonatomic, assign) NSUInteger viewCount;

@property(nonatomic, assign) BOOL scanScrollActive;
@property(nonatomic, assign) BOOL scanBounceActive;
@property(nonatomic, assign) BOOL scanRefreshActive;
@property(nonatomic, assign) BOOL scanMapActive;
@property(nonatomic, assign) BOOL scanHasAnimations;
@property(nonatomic, assign) CGFloat scanAnimatedArea;

@property(nonatomic, strong)
    NSMapTable<UIScrollView *, RJScrollViewState *> *scrollStateCache;
@property(nonatomic, strong) NSMapTable<UIView *, NSString *> *mapStateCache;

/// Whether the main scan bailed out early due to depth, view count, or time
@property(nonatomic, assign) BOOL didBailOutEarly;

/// Timestamp when scan started (for time-based bailout)
@property(nonatomic, assign) CFAbsoluteTime scanStartTime;

/// Maximum scan time in seconds before bailout (default: 30ms)
@property(nonatomic, assign) CFTimeInterval maxScanTime;

/// Primary capture window (for multi-window coordinate conversion)
/// When set, all sensitive view frames are converted to this window's
/// coordinate space
@property(nonatomic, weak) UIWindow *primaryCaptureWindow;

- (void)scanView:(UIView *)view
        inWindow:(UIWindow *)window
           depth:(NSInteger)depth;
- (void)scanSensitiveViewsOnlyInWindow:(UIWindow *)window;
- (BOOL)isMapViewLoading:(UIView *)view;
- (BOOL)isMapViewGestureActive:(UIView *)view;
- (BOOL)hasPresentationDeltaForView:(UIView *)view;

@end

#pragma mark - Implementation

@implementation RJViewHierarchyScanner

#pragma mark - Initialization

- (instancetype)init {
  return [self initWithConfig:[RJViewHierarchyScannerConfig defaultConfig]];
}

- (instancetype)initWithConfig:(RJViewHierarchyScannerConfig *)config {
  self = [super init];
  if (self) {
    _config = config;
    _maxScanTime = 0.030; // 30ms soft cap for scan time

    _rnInputClasses = [NSSet setWithArray:@[
      @"RCTUITextField",
      @"RCTBaseTextInputView",
      @"RCTSinglelineTextInputView",
      @"RCTMultilineTextInputView",
    ]];

    _cameraClasses = [NSSet setWithArray:@[
      @"AVCaptureVideoPreviewView",
      @"CameraView",
      @"CKCameraView",
      @"RNCameraView",
      @"VisionCameraView",
      @"RNVisionCameraView",
      @"ExpoCameraView",
    ]];

    _webViewClasses = [NSSet setWithArray:@[
      @"WKWebView",
      @"UIWebView",
      @"RCTWebView",
      @"RNCWebView",
      @"RNCWKWebView",
      @"RCTWKWebView",
      @"RNWebView",
      @"WKContentView",
    ]];

    // MapView classes - when present, frame caching should be disabled
    // because map tiles load asynchronously and layout signature doesn't
    // capture them
    _mapViewClasses = [NSSet setWithArray:@[
      @"MKMapView",     // Apple Maps
      @"AIRMap",        // react-native-maps (iOS)
      @"AIRMapView",    // react-native-maps alternate
      @"RNMMapView",    // react-native-maps newer versions
      @"GMSMapView",    // Google Maps SDK
      @"MGLMapView",    // Mapbox GL Native (< v10)
      @"RCTMGLMapView", // React Native Mapbox wrapper
      @"MapboxMapView", // Mapbox Maps SDK (v10+)
    ]];

    _layoutSignatureHash = 14695981039346656037ULL;
    _mutableTextInputFrames = [NSMutableArray arrayWithCapacity:8];
    _mutableCameraFrames = [NSMutableArray arrayWithCapacity:2];
    _mutableWebViewFrames = [NSMutableArray arrayWithCapacity:2];
    _mutableVideoFrames = [NSMutableArray arrayWithCapacity:2];
    _mutableMapViewFrames = [NSMutableArray arrayWithCapacity:2];
    _mutableMapViewPointers = [NSMutableArray arrayWithCapacity:2];
    _mutableScrollViewPointers = [NSMutableArray arrayWithCapacity:4];
    _mutableAnimatedViewPointers = [NSMutableArray arrayWithCapacity:4];

    _classNameCache = [NSMapTable strongToStrongObjectsMapTable];
    _cachedUITextField = [UITextField class];
    _cachedUITextView = [UITextView class];
    _cachedUISearchBar = [UISearchBar class];
    _cachedUIControl = [UIControl class];
    _cachedUIImageView = [UIImageView class];
    _cachedUILabel = [UILabel class];
    _cachedAVCapturePreviewLayer = [AVCaptureVideoPreviewLayer class];
    _cachedAVPlayerLayer = [AVPlayerLayer class];
    _scrollStateCache = [NSMapTable weakToStrongObjectsMapTable];
    _mapStateCache = [NSMapTable weakToStrongObjectsMapTable];
  }
  return self;
}

#pragma mark - Public API

- (RJViewHierarchyScanResult *)scanWindow:(UIWindow *)window {
  if (!window) {
    return nil;
  }

  @try {

    self.layoutSignatureHash = 14695981039346656037ULL;
    [self.mutableTextInputFrames removeAllObjects];
    [self.mutableCameraFrames removeAllObjects];
    [self.mutableWebViewFrames removeAllObjects];
    [self.mutableVideoFrames removeAllObjects];
    [self.mutableMapViewFrames removeAllObjects];
    [self.mutableMapViewPointers removeAllObjects];
    [self.mutableScrollViewPointers removeAllObjects];
    [self.mutableAnimatedViewPointers removeAllObjects];
    self.viewCount = 0;
    self.foundMapView = NO; // Reset MapView detection
    self.scanScrollActive = NO;
    self.scanBounceActive = NO;
    self.scanRefreshActive = NO;
    self.scanMapActive = NO;
    self.scanHasAnimations = NO;
    self.scanAnimatedArea = 0.0;
    self.primaryCaptureWindow =
        nil; // Clear multi-window state for single-window scan
    self.didBailOutEarly = NO;

    // Record scan start time for time-based bailout
    self.scanStartTime = CFAbsoluteTimeGetCurrent();

    [self scanView:window inWindow:window depth:0];

    // FAIL-CLOSED PRIVACY FALLBACK:
    // On very complex screens, the main traversal may hit maxViewCount/maxDepth
    // before encountering TextInputs, resulting in 0 textInputFrames and thus
    // no masking. If that happens, run a lightweight targeted traversal that
    // ONLY looks for sensitive views (text inputs / camera / manual masks).
    //
    // This keeps the fast path fast, but prevents privacy masking from silently
    // failing on large view trees (e.g., complex RN screens with many
    // subviews).
    BOOL hitViewLimit = (self.viewCount >= self.config.maxViewCount);
    BOOL needsPrivacyFallback =
        (self.config.detectTextInputs &&
         self.mutableTextInputFrames.count == 0) ||
        (self.config.detectCameraViews &&
         self.mutableCameraFrames.count == 0) ||
        (self.config.detectWebViews && self.mutableWebViewFrames.count == 0) ||
        (self.config.detectVideoLayers && self.mutableVideoFrames.count == 0);
    if (needsPrivacyFallback && (hitViewLimit || self.didBailOutEarly)) {
      [self scanSensitiveViewsOnlyInWindow:window];
    }

    RJViewHierarchyScanResult *result =
        [[RJViewHierarchyScanResult alloc] init];
    result.totalViewsScanned = self.viewCount;
    result.textInputFrames = [self.mutableTextInputFrames copy];
    result.cameraFrames = [self.mutableCameraFrames copy];
    result.webViewFrames = [self.mutableWebViewFrames copy];
    result.videoFrames = [self.mutableVideoFrames copy];
    result.hasMapView =
        self.foundMapView; // MapView detection for cache invalidation
    result.mapViewFrames = [self.mutableMapViewFrames copy];
    result.mapViewPointers = [self.mutableMapViewPointers copy];
    result.scrollViewPointers = [self.mutableScrollViewPointers copy];
    result.animatedViewPointers = [self.mutableAnimatedViewPointers copy];
    result.scrollActive = self.scanScrollActive;
    result.bounceActive = self.scanBounceActive;
    result.refreshActive = self.scanRefreshActive;
    result.mapActive = self.scanMapActive;
    result.hasAnyAnimations = self.scanHasAnimations;
    CGFloat screenArea = window.bounds.size.width * window.bounds.size.height;
    result.animationAreaRatio =
        (screenArea > 0) ? MIN(self.scanAnimatedArea / screenArea, 1.0) : 0.0;
    result.didBailOutEarly = self.didBailOutEarly;

    if (self.layoutSignatureHash != 14695981039346656037ULL) {
      result.layoutSignature =
          [NSString stringWithFormat:@"%016llx", self.layoutSignatureHash];
    }

#ifdef DEBUG
    CFTimeInterval scanDuration =
        CFAbsoluteTimeGetCurrent() - self.scanStartTime;
    if (scanDuration > 0.005) { // Log if scan took > 5ms
      RJLogWarning(@"ViewHierarchyScanner: Slow scan - %lu views in %.1fms",
                   (unsigned long)result.totalViewsScanned,
                   scanDuration * 1000);
    }

    if (result.textInputFrames.count > 0 || result.cameraFrames.count > 0) {
      RJLogDebug(
          @"ViewHierarchyScanner: %lu views, %lu text inputs, %lu cameras",
          (unsigned long)result.totalViewsScanned,
          (unsigned long)result.textInputFrames.count,
          (unsigned long)result.cameraFrames.count);
    }
#endif

    return result;
  } @catch (NSException *exception) {
    RJLogWarning(@"ViewHierarchyScanner: Scan failed: %@", exception);
    return nil;
  }
}

- (nullable RJViewHierarchyScanResult *)scanAllWindowsRelativeTo:
    (UIWindow *)primaryWindow {
  if (!primaryWindow) {
    return nil;
  }

  // If no windows provided, scan all connected scenes (expensive fallback)
  NSMutableArray<UIWindow *> *windowsToScan = [NSMutableArray array];

  if (@available(iOS 13.0, *)) {
    for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
      if (![scene isKindOfClass:[UIWindowScene class]])
        continue;
      UIWindowScene *windowScene = (UIWindowScene *)scene;

      // Filter out non-active scenes if possible, but be careful with
      // modals
      if (windowScene.activationState == UISceneActivationStateBackground ||
          windowScene.activationState == UISceneActivationStateUnattached) {
        continue;
      }

      for (UIWindow *window in windowScene.windows) {
        if (!window.isHidden && window.alpha > 0.01) {
          [windowsToScan addObject:window];
        }
      }
    }
  } else {
    // Fallback for older iOS (unlikely needed but good for safety)
    if (primaryWindow) {
      [windowsToScan addObject:primaryWindow];
    }
  }

  return [self scanWindows:windowsToScan relativeToWindow:primaryWindow];
}

- (nullable RJViewHierarchyScanResult *)scanWindows:
                                            (NSArray<UIWindow *> *)windows
                                   relativeToWindow:(UIWindow *)primaryWindow {
  if (!primaryWindow || !windows) {
    return nil;
  }
  if (windows.count == 0) {
    return nil;
  }

  @try {
    // Reset state for new frame
    self.viewCount = 0;
    self.layoutSignatureHash = 14695981039346656037ULL; // FNV-1a offset basis

    // Reset other mutable properties
    [self.mutableTextInputFrames removeAllObjects];
    [self.mutableCameraFrames removeAllObjects];
    [self.mutableWebViewFrames removeAllObjects];
    [self.mutableVideoFrames removeAllObjects];
    [self.mutableMapViewFrames removeAllObjects];
    [self.mutableMapViewPointers removeAllObjects];
    [self.mutableScrollViewPointers removeAllObjects];
    [self.mutableAnimatedViewPointers removeAllObjects];
    self.foundMapView = NO;
    self.scanScrollActive = NO;
    self.scanBounceActive = NO;
    self.scanRefreshActive = NO;
    self.scanMapActive = NO;
    self.scanHasAnimations = NO;
    self.scanAnimatedArea = 0.0;
    self.didBailOutEarly = NO;
    self.primaryCaptureWindow =
        primaryWindow; // Store for coordinate conversion

    // Record scan start time for time-based bailout
    self.scanStartTime = CFAbsoluteTimeGetCurrent();

    // Sort windows by level
    NSMutableArray<UIWindow *> *windowsToScan = [windows mutableCopy];
    [windowsToScan
        sortUsingComparator:^NSComparisonResult(UIWindow *w1, UIWindow *w2) {
          if (w1.windowLevel > w2.windowLevel)
            return NSOrderedAscending;
          if (w1.windowLevel < w2.windowLevel)
            return NSOrderedDescending;
          return NSOrderedSame;
        }];

    RJLogDebug(
        @"ViewHierarchyScanner: Scanning %lu windows for sensitive views",
        (unsigned long)windowsToScan.count);

    // Scan each window
    for (UIWindow *window in windowsToScan) {
      // Scan this window's view hierarchy
      // checkSensitiveView will use primaryCaptureWindow for coordinate
      // conversion
      [self scanView:window inWindow:window depth:0];

      // If we're over limits, trigger privacy fallback for this window
      BOOL hitViewLimit = (self.viewCount >= self.config.maxViewCount);
      BOOL needsPrivacyFallback =
          (self.config.detectTextInputs &&
           self.mutableTextInputFrames.count == 0) ||
          (self.config.detectCameraViews &&
           self.mutableCameraFrames.count == 0) ||
          (self.config.detectWebViews &&
           self.mutableWebViewFrames.count == 0) ||
          (self.config.detectVideoLayers && self.mutableVideoFrames.count == 0);
      if (needsPrivacyFallback && hitViewLimit) {
        [self scanSensitiveViewsOnlyInWindow:window];
      }
    }

    // If the main scan bailed out early and found no inputs, do a targeted
    // privacy-only scan as a fail-closed fallback.
    BOOL needsPrivacyFallback =
        (self.config.detectTextInputs &&
         self.mutableTextInputFrames.count == 0) ||
        (self.config.detectCameraViews &&
         self.mutableCameraFrames.count == 0) ||
        (self.config.detectWebViews && self.mutableWebViewFrames.count == 0) ||
        (self.config.detectVideoLayers && self.mutableVideoFrames.count == 0);
    if (needsPrivacyFallback && self.didBailOutEarly) {
      for (UIWindow *window in windowsToScan) {
        [self scanSensitiveViewsOnlyInWindow:window];
      }
    }

    // Build result - frames are already converted to primaryWindow
    // coordinates by checkSensitiveView (using self.primaryCaptureWindow)
    RJViewHierarchyScanResult *result =
        [[RJViewHierarchyScanResult alloc] init];
    result.totalViewsScanned = self.viewCount;
    result.textInputFrames = [self.mutableTextInputFrames copy];
    result.cameraFrames = [self.mutableCameraFrames copy];
    result.webViewFrames = [self.mutableWebViewFrames copy];
    result.videoFrames = [self.mutableVideoFrames copy];
    result.hasMapView = self.foundMapView;
    result.mapViewFrames = [self.mutableMapViewFrames copy];
    result.mapViewPointers = [self.mutableMapViewPointers copy];
    result.scrollViewPointers = [self.mutableScrollViewPointers copy];
    result.animatedViewPointers = [self.mutableAnimatedViewPointers copy];
    result.scrollActive = self.scanScrollActive;
    result.bounceActive = self.scanBounceActive;
    result.refreshActive = self.scanRefreshActive;
    result.mapActive = self.scanMapActive;
    result.hasAnyAnimations = self.scanHasAnimations;
    CGFloat screenArea =
        primaryWindow.bounds.size.width * primaryWindow.bounds.size.height;
    result.animationAreaRatio =
        (screenArea > 0) ? MIN(self.scanAnimatedArea / screenArea, 1.0) : 0.0;
    result.didBailOutEarly = self.didBailOutEarly;

    if (self.layoutSignatureHash != 14695981039346656037ULL) {
      result.layoutSignature =
          [NSString stringWithFormat:@"%016llx", self.layoutSignatureHash];
    }

    // Clear primaryCaptureWindow after scan is complete
    self.primaryCaptureWindow = nil;

#ifdef DEBUG
    CFTimeInterval scanDuration =
        CFAbsoluteTimeGetCurrent() - self.scanStartTime;
    RJLogDebug(@"ViewHierarchyScanner: Multi-window scan complete - %lu views, "
               @"%lu text inputs, %lu cameras in %.1fms",
               (unsigned long)result.totalViewsScanned,
               (unsigned long)result.textInputFrames.count,
               (unsigned long)result.cameraFrames.count, scanDuration * 1000);
#endif

    return result;
  } @catch (NSException *exception) {
    self.primaryCaptureWindow = nil; // Clean up on error
    RJLogWarning(@"ViewHierarchyScanner: Multi-window scan failed: %@",
                 exception);
    // Fallback to single-window scan
    return [self scanWindow:primaryWindow];
  }
}

- (BOOL)isViewVisible:(UIView *)view {
  return !view.hidden && view.alpha > 0.01 && view.frame.size.width > 0 &&
         view.frame.size.height > 0;
}

- (void)prewarmClassCaches {
  // Pre-warm Objective-C runtime class lookups to eliminate first-scan
  // penalty. NSClassFromString and class hierarchy checks are expensive on
  // first call
  // (~10-15ms total). By doing them here we front-load the cost before
  // capture.

  // Force resolution of all React Native input classes
  NSMutableArray *rnInputs = [NSMutableArray array];
  for (NSString *className in self.rnInputClasses) {
    Class c = NSClassFromString(className);
    if (c)
      [rnInputs addObject:c];
  }
  self.resolvedRnInputClasses = rnInputs;

  // Force resolution of all camera/video classes
  NSMutableArray *cameras = [NSMutableArray array];
  for (NSString *className in self.cameraClasses) {
    Class c = NSClassFromString(className);
    if (c)
      [cameras addObject:c];
  }
  self.resolvedCameraClasses = cameras;

  // Force resolution of all WebView classes
  NSMutableArray *webViews = [NSMutableArray array];
  for (NSString *className in self.webViewClasses) {
    Class c = NSClassFromString(className);
    if (c) {
      [webViews addObject:c];
    }
  }
  self.resolvedWebViewClasses = webViews;

  // Pre-warm UIKit class hierarchy checks
  // These trigger internal class resolution and method caching
  UIView *dummyView = [[UIView alloc] init];
  (void)[dummyView isKindOfClass:self.cachedUITextField];
  (void)[dummyView isKindOfClass:self.cachedUITextView];
  (void)[dummyView isKindOfClass:self.cachedUISearchBar];
  (void)[dummyView isKindOfClass:self.cachedUIControl];
  (void)[dummyView isKindOfClass:self.cachedUIImageView];
  (void)[dummyView isKindOfClass:self.cachedUILabel];

  // Pre-warm CALayer class checks
  CALayer *dummyLayer = [[CALayer alloc] init];
  (void)[dummyLayer isKindOfClass:self.cachedAVCapturePreviewLayer];
  (void)[dummyLayer isKindOfClass:self.cachedAVPlayerLayer];

  RJLogDebug(@"ViewHierarchyScanner: Class caches pre-warmed");
}

#pragma mark - Private Traversal

- (void)scanView:(UIView *)view
        inWindow:(UIWindow *)window
           depth:(NSInteger)depth {
  if (!view || !window)
    return;

  // Early exit if we've scanned too many views (prevents runaway on complex
  // UIs)
  if (self.viewCount >= self.config.maxViewCount) {
    self.didBailOutEarly = YES;
    return;
  }

  if (depth > self.config.maxDepth) {
    self.didBailOutEarly = YES;
    return;
  }

  // TIME-BASED BAILOUT: Check every 200 views if we've exceeded max scan time
  // This is a safety net for truly runaway scans, not normal operation
  if (self.viewCount > 0 && (self.viewCount % 200) == 0) {
    CFTimeInterval elapsed = CFAbsoluteTimeGetCurrent() - self.scanStartTime;
    if (elapsed > self.maxScanTime) {
      self.didBailOutEarly = YES;
      RJLogWarning(@"ViewHierarchyScanner: Time bailout at %lu views (%.1fms > "
                   @"%.1fms limit)",
                   (unsigned long)self.viewCount, elapsed * 1000,
                   self.maxScanTime * 1000);
      return;
    }
  }

  if (![self isViewVisible:view])
    return;

  // REMOVED: [self.scannedViews containsObject:viewPtr] check
  // Trees are acyclic in UIKit (usually), so we save the set lookups.
  // If we really need cycle detection, restore it, but B2 optimization
  // advises removing.

  self.viewCount++;

  @try {
    BOOL isWebView = self.config.detectWebViews && [self isWebView:view];
    BOOL isCamera =
        self.config.detectCameraViews && [self isCameraPreview:view];
    BOOL isVideo =
        self.config.detectVideoLayers && [self isVideoLayerView:view];
    BOOL isBlockedSurface = isWebView || isCamera || isVideo;

    [self checkSensitiveView:view inWindow:window];

    if ([view isKindOfClass:[UIScrollView class]]) {
      [self trackScrollView:(UIScrollView *)view];
    } else if (isWebView && [view respondsToSelector:@selector(scrollView)]) {
      @try {
        UIScrollView *webScrollView = [view valueForKey:@"scrollView"];
        if ([webScrollView isKindOfClass:[UIScrollView class]]) {
          [self trackScrollView:webScrollView];
        }
      } @catch (NSException *exception) {
      }
    }

    if (isBlockedSurface) {
      [self appendBlockedSurfaceInfoToSignature:view depth:depth];
      return;
    }

    [self appendViewInfoToSignature:view depth:depth];
    [self trackAnimationsForView:view inWindow:window];

    NSArray *subviews = view.subviews;
    if (subviews) {
      for (UIView *subview in [subviews reverseObjectEnumerator]) {
        @try {
          [self scanView:subview inWindow:window depth:depth + 1];
        } @catch (NSException *e) {
        }
      }
    }
  } @catch (NSException *exception) {
  }
}

#pragma mark - Layout Signature Generation

- (void)mixInt:(int32_t)val {
  self.layoutSignatureHash =
      fnv1a_u64(self.layoutSignatureHash, &val, sizeof(val));
}

- (void)mixPtr:(const void *)ptr {
  uintptr_t val = (uintptr_t)ptr;
  self.layoutSignatureHash =
      fnv1a_u64(self.layoutSignatureHash, &val, sizeof(val));
}

- (void)appendViewInfoToSignature:(UIView *)view depth:(NSInteger)depth {
  if (!view)
    return;

  @try {
    // 1. Mix depth
    [self mixInt:(int32_t)depth];

    // 2. Mix class pointer (faster than string name)
    [self mixPtr:(__bridge const void *)[view class]];

    // 3. Mix frame
    CGRect f = view.frame;
    int32_t x = (int32_t)lrintf(isfinite(f.origin.x) ? f.origin.x : 0);
    int32_t y = (int32_t)lrintf(isfinite(f.origin.y) ? f.origin.y : 0);
    int32_t w = (int32_t)lrintf(isfinite(f.size.width) ? f.size.width : 0);
    int32_t h = (int32_t)lrintf(isfinite(f.size.height) ? f.size.height : 0);
    [self mixInt:x];
    [self mixInt:y];
    [self mixInt:w];
    [self mixInt:h];

    // 4. Mix scroll offset
    if ([view isKindOfClass:[UIScrollView class]]) {
      CGPoint o = ((UIScrollView *)view).contentOffset;
      [self mixInt:(int32_t)lrintf(isfinite(o.x) ? o.x : 0)];
      [self mixInt:(int32_t)lrintf(isfinite(o.y) ? o.y : 0)];

      UIEdgeInsets inset = ((UIScrollView *)view).contentInset;
      [self mixInt:(int32_t)lrintf(isfinite(inset.top) ? inset.top * 100 : 0)];
      [self mixInt:(int32_t)lrintf(isfinite(inset.bottom) ? inset.bottom * 100
                                                          : 0)];
      [self
          mixInt:(int32_t)lrintf(isfinite(inset.left) ? inset.left * 100 : 0)];
      [self mixInt:(int32_t)lrintf(isfinite(inset.right) ? inset.right * 100
                                                         : 0)];
    }

    // 5. Mix Text Content (avoid input content; use length only)
    if ([view isKindOfClass:[UITextField class]]) {
      NSString *text = ((UITextField *)view).text;
      [self mixInt:(int32_t)text.length];
    } else if ([view isKindOfClass:[UITextView class]]) {
      UITextView *textView = (UITextView *)view;
      if (textView.isEditable) {
        [self mixInt:(int32_t)textView.text.length];
      } else if (textView.text.length > 0) {
        NSUInteger th = textView.text.hash;
        self.layoutSignatureHash =
            fnv1a_u64(self.layoutSignatureHash, &th, sizeof(th));
      }
    } else if ([view isKindOfClass:[UILabel class]]) {
      NSString *text = ((UILabel *)view).text;
      if (text.length > 0) {
        NSUInteger th = text.hash;
        self.layoutSignatureHash =
            fnv1a_u64(self.layoutSignatureHash, &th, sizeof(th));
      }
    }

    // 6. Mix Accessibility Label (Critical for RN view recycling)
    // React Native often recycles views or uses generic RCTViews for text
    // containers but updates the accessibility label. This is a very cheap way
    // to detect changes.
    NSString *axLabel = view.accessibilityLabel;
    if (axLabel.length > 0) {
      NSUInteger axh = axLabel.hash;
      self.layoutSignatureHash =
          fnv1a_u64(self.layoutSignatureHash, &axh, sizeof(axh));
    }

    // 7. Mix Image pointer (was 6)
    if ([view isKindOfClass:[UIImageView class]]) {
      UIImage *img = ((UIImageView *)view).image;
      if (img) {
        [self mixPtr:(__bridge const void *)img];
      }
    }

    // 7b. Mix Map camera state when available
    if ([self isMapView:view]) {
      NSString *mapSignature = [self mapSignatureForView:view];
      if (mapSignature.length > 0) {
        NSUInteger mh = mapSignature.hash;
        self.layoutSignatureHash =
            fnv1a_u64(self.layoutSignatureHash, &mh, sizeof(mh));
      }
      [self mixInt:(int32_t)([self isMapViewLoading:view] ? 1 : 0)];
    }

    // 8. Mix Background Color
    if (view.backgroundColor) {
      [self mixInt:(int32_t)[view.backgroundColor hash]];
    }

    // 8b. Mix Tint Color (captures template image/color changes)
    if (view.tintColor) {
      [self mixInt:(int32_t)[view.tintColor hash]];
    }

    // 9. Mix Alpha (to 1% precision)
    [self mixInt:(int32_t)(view.alpha * 100)];

    // 10. Mix Hidden State
    [self mixInt:(int32_t)(view.hidden ? 1 : 0)];

  } @catch (NSException *exception) {
  }
}

- (void)appendBlockedSurfaceInfoToSignature:(UIView *)view
                                      depth:(NSInteger)depth {
  if (!view) {
    return;
  }

  @try {
    [self mixInt:(int32_t)depth];
    [self mixPtr:(__bridge const void *)[view class]];

    CGRect f = view.frame;
    int32_t x = (int32_t)lrintf(isfinite(f.origin.x) ? f.origin.x : 0);
    int32_t y = (int32_t)lrintf(isfinite(f.origin.y) ? f.origin.y : 0);
    int32_t w = (int32_t)lrintf(isfinite(f.size.width) ? f.size.width : 0);
    int32_t h = (int32_t)lrintf(isfinite(f.size.height) ? f.size.height : 0);
    [self mixInt:x];
    [self mixInt:y];
    [self mixInt:w];
    [self mixInt:h];

    [self mixInt:(int32_t)(view.alpha * 100)];
    [self mixInt:(int32_t)(view.hidden ? 1 : 0)];
  } @catch (NSException *exception) {
  }
}

#pragma mark - Sensitive View Detection

- (void)checkSensitiveView:(UIView *)view inWindow:(UIWindow *)window {
  BOOL isTextInput =
      self.config.detectTextInputs && [self isActualTextInput:view];
  BOOL isCamera = self.config.detectCameraViews && [self isCameraPreview:view];
  BOOL isWebView = self.config.detectWebViews && [self isWebView:view];
  BOOL isVideo = self.config.detectVideoLayers && [self isVideoLayerView:view];
  BOOL isManuallyMasked = [self isManuallyMaskedView:view];

  // Check for MapView - capture frame and pointer for hybrid capture strategy
  BOOL isMapView = [self isMapView:view];

  // Determine the target window for coordinate conversion
  // If primaryCaptureWindow is set (multi-window scan), use it
  // Otherwise fall back to the passed window parameter
  UIWindow *targetWindow = self.primaryCaptureWindow ?: window;
  if (!targetWindow) {
    return;
  }

  if (isMapView) {
    self.foundMapView = YES;

    if ([self isMapViewLoading:view]) {
      self.scanMapActive = YES;
    }

    if ([self isMapViewGestureActive:view]) {
      self.scanMapActive = YES;
    }

    NSString *mapSignature = [self mapSignatureForView:view];
    if (mapSignature.length > 0) {
      NSString *previous = [self.mapStateCache objectForKey:view];
      if (previous && ![previous isEqualToString:mapSignature]) {
        self.scanMapActive = YES;
      }
      [self.mapStateCache setObject:mapSignature forKey:view];
    }

    // Capture the MapView frame and pointer for hybrid capture
    // Always convert through screen coordinates for consistency
    CGRect frameInScreen = CGRectZero;
    CGRect frameInTarget = CGRectZero;
    @try {
      frameInScreen = [view convertRect:view.bounds toView:nil];
      frameInTarget = [targetWindow convertRect:frameInScreen fromWindow:nil];
    } @catch (NSException *exception) {
      return;
    }

    if (!CGRectIsEmpty(frameInTarget) && frameInTarget.size.width > 10 &&
        frameInTarget.size.height > 10 &&
        CGRectIntersectsRect(frameInTarget, targetWindow.bounds)) {
      [self.mutableMapViewFrames
          addObject:[NSValue valueWithCGRect:frameInTarget]];
      [self.mutableMapViewPointers
          addObject:[NSValue valueWithNonretainedObject:view]];
    }
  }

  if (isTextInput || isCamera || isWebView || isVideo || isManuallyMasked) {
    // CRITICAL FIX: Always convert through screen coordinates
    // This ensures correct coordinate conversion even when:
    // 1. The view is in a different window (modal, overlay, React Native
    // navigation)
    // 2. Multi-window scanning is active (primaryCaptureWindow is set)
    // 3. Windows have different transforms or scales
    //
    // Step 1: Convert view bounds to screen coordinates (toView:nil)
    // Step 2: Convert screen coordinates to target window coordinates
    // (fromWindow:nil)
    CGRect frameInScreen = CGRectZero;
    CGRect frameInTarget = CGRectZero;
    @try {
      frameInScreen = [view convertRect:view.bounds toView:nil];
      frameInTarget = [targetWindow convertRect:frameInScreen fromWindow:nil];
    } @catch (NSException *exception) {
      return;
    }

    // If conversion failed (view not in window hierarchy), try direct
    // conversion
    if (CGRectIsEmpty(frameInTarget) ||
        (frameInTarget.origin.x == 0 && frameInTarget.origin.y == 0 &&
         frameInTarget.size.width == 0 && frameInTarget.size.height == 0)) {
      // Fallback: try direct conversion if view is in target window
      if (view.window == targetWindow) {
        @try {
          frameInTarget = [view convertRect:view.bounds toView:targetWindow];
        } @catch (NSException *exception) {
          return;
        }
      }
    }

    // Sanitize NaN values before storing to prevent CoreGraphics errors
    CGFloat x = isnan(frameInTarget.origin.x) ? 0 : frameInTarget.origin.x;
    CGFloat y = isnan(frameInTarget.origin.y) ? 0 : frameInTarget.origin.y;
    CGFloat w = isnan(frameInTarget.size.width) ? 0 : frameInTarget.size.width;
    CGFloat h =
        isnan(frameInTarget.size.height) ? 0 : frameInTarget.size.height;

    // Also check for infinity values
    if (isinf(x))
      x = 0;
    if (isinf(y))
      y = 0;
    if (isinf(w))
      w = 0;
    if (isinf(h))
      h = 0;

    CGRect sanitizedFrame = CGRectMake(x, y, w, h);

    if (!CGRectIsEmpty(sanitizedFrame) && sanitizedFrame.size.width > 10 &&
        sanitizedFrame.size.height > 10 &&
        CGRectIntersectsRect(sanitizedFrame, targetWindow.bounds)) {

      NSValue *frameValue = [NSValue valueWithCGRect:sanitizedFrame];

      if (isCamera) {
        [self.mutableCameraFrames addObject:frameValue];
      } else if (isWebView) {
        [self.mutableWebViewFrames addObject:frameValue];
      } else if (isVideo) {
        [self.mutableVideoFrames addObject:frameValue];
      } else {
        [self.mutableTextInputFrames addObject:frameValue];
      }

#ifdef DEBUG
      RJLogDebug(
          @"ViewHierarchyScanner: Found %@ at (%.0f,%.0f,%.0f,%.0f) - "
          @"view.window=%@ targetWindow=%@",
          isTextInput
              ? @"TextInput"
              : (isCamera ? @"Camera"
                          : (isWebView ? @"WebView"
                                       : (isVideo ? @"Video" : @"MaskedView"))),
          sanitizedFrame.origin.x, sanitizedFrame.origin.y,
          sanitizedFrame.size.width, sanitizedFrame.size.height,
          NSStringFromClass([view.window class]),
          NSStringFromClass([targetWindow class]));
#endif
    }
  }
}

#pragma mark - Privacy Fallback Traversal

/// Targeted traversal that ONLY checks for sensitive views.
/// Used when the main traversal hits view limits and finds no text inputs.
- (void)scanSensitiveViewsOnlyInWindow:(UIWindow *)window {
  if (!window)
    return;

  @try {
    CFAbsoluteTime start = CFAbsoluteTimeGetCurrent();
    const CFTimeInterval maxTime = 0.010; // 10ms budget (aggressive)
    const NSUInteger maxViews = 2000;     // Reduced from 4000

    NSMutableArray<UIView *> *queue = [NSMutableArray arrayWithCapacity:256];
    [queue addObject:window];

    NSUInteger scanned = 0;
    NSUInteger headIndex = 0; // Optimization: Use index pointer (O(1) pop)

    while (headIndex < queue.count) {
      if (scanned >= maxViews) {
        break;
      }
      if ((CFAbsoluteTimeGetCurrent() - start) > maxTime) {
        break;
      }

      UIView *current = queue[headIndex++];
      if (!current)
        continue;

      if ([self isViewVisible:current]) {
        [self checkSensitiveView:current inWindow:window];
      }

      NSArray<UIView *> *subviews = current.subviews;
      if (subviews.count > 0) {
        [queue addObjectsFromArray:subviews];
      }

      scanned++;
    }

#ifdef DEBUG
    if (self.mutableTextInputFrames.count > 0) {
      RJLogWarning(@"ViewHierarchyScanner: Privacy fallback found %lu text "
                   @"inputs after main scan hit view limit",
                   (unsigned long)self.mutableTextInputFrames.count);
    } else {
      RJLogWarning(@"ViewHierarchyScanner: Privacy fallback found 0 text "
                   @"inputs (window=%@)",
                   NSStringFromClass([window class]));
    }
#endif
  } @catch (NSException *exception) {
    RJLogWarning(@"ViewHierarchyScanner: Privacy fallback failed: %@",
                 exception);
  }
}

#pragma mark - Class Name Caching

- (NSString *)cachedClassNameForClass:(Class)cls {
  NSString *cached = [self.classNameCache objectForKey:cls];
  if (cached)
    return cached;

  NSString *name = NSStringFromClass(cls);
  [self.classNameCache setObject:name forKey:cls];
  return name;
}

#pragma mark - Sensitive View Detection Helpers

- (BOOL)isActualTextInput:(UIView *)view {
  if (!view)
    return NO;

  // Start with direct class checks for common inputs
  if ([view isKindOfClass:[UITextField class]] ||
      [view isKindOfClass:[UITextView class]] ||
      [view isKindOfClass:[UISearchBar class]]) {
    if ([view isKindOfClass:[UITextView class]]) {
      return ((UITextView *)view).isEditable;
    }
    return YES;
  }

  // 2. Fast resolved-class check (RN inputs)
  for (Class cls in self.resolvedRnInputClasses) {
    if ([view isKindOfClass:cls]) {
      return YES;
    }
  }

  // 3. Fallback: String heuristics (slow, only if needed)
  NSString *className = [self cachedClassNameForClass:[view class]];
  if ([className containsString:@"TextInput"] ||
      [className containsString:@"TextField"] ||
      [className containsString:@"TextEditor"]) {
    return YES;
  }

  // NOTE: B5 Optimization recommends removing the superclass crawl if not
  // strictly needed. We'll leave the string check as the final fallback but
  // rely on resolved classes for 99% of cases.

  return NO;
}

- (BOOL)isCameraPreview:(UIView *)view {
  if (!view)
    return NO;

  // 1. Fast resolved-class check
  for (Class cls in self.resolvedCameraClasses) {
    if ([view isKindOfClass:cls]) {
      return YES;
    }
  }

  // 2. Fast layer check
  if ([view.layer isKindOfClass:self.cachedAVCapturePreviewLayer]) {
    return YES;
  }

  for (CALayer *sublayer in view.layer.sublayers) {
    if ([sublayer isKindOfClass:self.cachedAVCapturePreviewLayer]) {
      return YES;
    }
  }

  // 3. Fallback: String heuristics
  NSString *className = [self cachedClassNameForClass:[view class]];
  return [self.cameraClasses containsObject:className] ||
         [className containsString:@"Camera"] ||
         [className containsString:@"Preview"] ||
         [className containsString:@"Scanner"];
}

- (BOOL)isWebView:(UIView *)view {
  if (!view)
    return NO;

  Class wkClass = NSClassFromString(@"WKWebView");
  if (wkClass && [view isKindOfClass:wkClass]) {
    return YES;
  }

  for (Class cls in self.resolvedWebViewClasses) {
    if ([view isKindOfClass:cls]) {
      return YES;
    }
  }

  NSString *className = [self cachedClassNameForClass:[view class]];
  return [self.webViewClasses containsObject:className] ||
         [className containsString:@"WebView"] ||
         [className containsString:@"WKContentView"];
}

- (BOOL)isVideoLayerView:(UIView *)view {
  if (!view)
    return NO;

  if ([view.layer isKindOfClass:self.cachedAVPlayerLayer]) {
    return YES;
  }

  for (CALayer *sublayer in view.layer.sublayers) {
    if ([sublayer isKindOfClass:self.cachedAVPlayerLayer]) {
      return YES;
    }
  }

  NSString *className = [self cachedClassNameForClass:[view class]];
  return ([className containsString:@"Video"] &&
          [className containsString:@"View"]);
}

- (BOOL)isMapView:(UIView *)view {
  if (!view)
    return NO;

  NSString *className = [self cachedClassNameForClass:[view class]];
  return [self.mapViewClasses containsObject:className] ||
         [className containsString:@"MapView"] ||
         [className containsString:@"MKMapView"];
}

- (BOOL)isMapViewLoading:(UIView *)view {
  if (!view) {
    return NO;
  }

  @try {
    if ([view respondsToSelector:@selector(isLoading)]) {
      BOOL (*loadingMsg)(id, SEL) = (BOOL(*)(id, SEL))objc_msgSend;
      return loadingMsg(view, @selector(isLoading));
    }
    id loadingValue = [view valueForKey:@"loading"];
    if ([loadingValue respondsToSelector:@selector(boolValue)]) {
      return [loadingValue boolValue];
    }
  } @catch (NSException *exception) {
  }

  return NO;
}

- (BOOL)isMapViewGestureActive:(UIView *)view {
  if (!view) {
    return NO;
  }

  for (UIGestureRecognizer *recognizer in view.gestureRecognizers) {
    if (recognizer.state == UIGestureRecognizerStateBegan ||
        recognizer.state == UIGestureRecognizerStateChanged ||
        recognizer.state == UIGestureRecognizerStateEnded) {
      return YES;
    }
  }

  return NO;
}

- (BOOL)hasPresentationDeltaForView:(UIView *)view {
  CALayer *presentation = view.layer.presentationLayer;
  if (!presentation) {
    return NO;
  }

  CGRect modelFrame = view.layer.frame;
  CGRect presentationFrame = presentation.frame;

  if (!isfinite(modelFrame.origin.x) || !isfinite(modelFrame.origin.y) ||
      !isfinite(modelFrame.size.width) || !isfinite(modelFrame.size.height) ||
      !isfinite(presentationFrame.origin.x) ||
      !isfinite(presentationFrame.origin.y) ||
      !isfinite(presentationFrame.size.width) ||
      !isfinite(presentationFrame.size.height)) {
    return NO;
  }

  CGFloat dx = fabs(presentationFrame.origin.x - modelFrame.origin.x);
  CGFloat dy = fabs(presentationFrame.origin.y - modelFrame.origin.y);
  CGFloat dw = fabs(presentationFrame.size.width - modelFrame.size.width);
  CGFloat dh = fabs(presentationFrame.size.height - modelFrame.size.height);

  return (dx > kRJAnimationPresentationEpsilon ||
          dy > kRJAnimationPresentationEpsilon ||
          dw > kRJAnimationPresentationEpsilon ||
          dh > kRJAnimationPresentationEpsilon);
}

- (BOOL)isManuallyMaskedView:(UIView *)view {
  if ([view.accessibilityHint isEqualToString:@"rejourney_occlude"]) {
    return YES;
  }

  NSString *nativeID = view.accessibilityIdentifier;
  if (nativeID.length > 0 &&
      [self.config.maskedNativeIDs containsObject:nativeID]) {
    return YES;
  }

  NSArray *subviews = view.subviews;
  for (UIView *subview in [subviews reverseObjectEnumerator]) {
    NSString *childNativeID = subview.accessibilityIdentifier;
    if (childNativeID.length > 0 &&
        [self.config.maskedNativeIDs containsObject:childNativeID]) {
      return YES;
    }
  }

  return NO;
}

#pragma mark - Motion & Animation Tracking

- (void)trackScrollView:(UIScrollView *)scrollView {
  if (!scrollView) {
    return;
  }

  [self.mutableScrollViewPointers
      addObject:[NSValue valueWithNonretainedObject:scrollView]];

  RJScrollViewState *state = [self.scrollStateCache objectForKey:scrollView];
  if (!state) {
    state = [[RJScrollViewState alloc] init];
  }

  CGPoint offset = scrollView.contentOffset;
  UIEdgeInsets inset = scrollView.contentInset;
  CGFloat zoomScale = scrollView.zoomScale;

  BOOL tracking = scrollView.isTracking || scrollView.isDragging ||
                  scrollView.isDecelerating;
  BOOL offsetMoved =
      (fabs(offset.x - state.contentOffset.x) > kRJScrollEpsilon ||
       fabs(offset.y - state.contentOffset.y) > kRJScrollEpsilon);
  BOOL zoomMoved = fabs(zoomScale - state.zoomScale) > kRJZoomEpsilon;
  if (tracking || offsetMoved || zoomMoved) {
    self.scanScrollActive = YES;
  }

  BOOL insetChanged =
      (fabs(inset.top - state.contentInset.top) > kRJInsetEpsilon ||
       fabs(inset.bottom - state.contentInset.bottom) > kRJInsetEpsilon ||
       fabs(inset.left - state.contentInset.left) > kRJInsetEpsilon ||
       fabs(inset.right - state.contentInset.right) > kRJInsetEpsilon);
  if ([self isOverscrolling:scrollView offset:offset] || insetChanged) {
    self.scanBounceActive = YES;
  }

  if ([self isRefreshActiveForScrollView:scrollView
                                  offset:offset
                                   inset:inset]) {
    self.scanRefreshActive = YES;
  }

  state.contentOffset = offset;
  state.contentInset = inset;
  state.zoomScale = zoomScale;
  [self.scrollStateCache setObject:state forKey:scrollView];
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
  return (offset.x < leftLimit || offset.x > rightLimit);
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

  if (refreshControl.superview) {
    CGRect inScroll = [refreshControl.superview convertRect:refreshControl.frame
                                                     toView:scrollView];
    if (CGRectIntersectsRect(inScroll, scrollView.bounds)) {
      return YES;
    }
  }

  return NO;
}

- (void)trackAnimationsForView:(UIView *)view inWindow:(UIWindow *)window {
  if (!view) {
    return;
  }

  BOOL hasAnimationKeys = (view.layer.animationKeys.count > 0);
  BOOL hasPresentationDelta = [self hasPresentationDeltaForView:view];
  if (!hasAnimationKeys && !hasPresentationDelta) {
    return;
  }

  self.scanHasAnimations = YES;
  [self.mutableAnimatedViewPointers
      addObject:[NSValue valueWithNonretainedObject:view]];

  UIWindow *targetWindow = self.primaryCaptureWindow ?: window;
  if (!targetWindow) {
    return;
  }
  CGRect frameInScreen = CGRectZero;
  CGRect frameInTarget = CGRectZero;
  @try {
    frameInScreen = [view convertRect:view.bounds toView:nil];
    frameInTarget = [targetWindow convertRect:frameInScreen fromWindow:nil];
  } @catch (NSException *exception) {
    return;
  }

  // Sanitize NaN/Inf values to prevent CoreGraphics errors
  CGFloat x = isnan(frameInTarget.origin.x) || isinf(frameInTarget.origin.x)
                  ? 0
                  : frameInTarget.origin.x;
  CGFloat y = isnan(frameInTarget.origin.y) || isinf(frameInTarget.origin.y)
                  ? 0
                  : frameInTarget.origin.y;
  CGFloat w = isnan(frameInTarget.size.width) || isinf(frameInTarget.size.width)
                  ? 0
                  : frameInTarget.size.width;
  CGFloat h =
      isnan(frameInTarget.size.height) || isinf(frameInTarget.size.height)
          ? 0
          : frameInTarget.size.height;

  frameInTarget = CGRectMake(x, y, w, h);

  if (CGRectIsEmpty(frameInTarget) ||
      !CGRectIntersectsRect(frameInTarget, targetWindow.bounds)) {
    return;
  }

  CGRect visibleFrame = CGRectIntersection(frameInTarget, targetWindow.bounds);
  self.scanAnimatedArea += visibleFrame.size.width * visibleFrame.size.height;
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

    // Mapbox uses zoomLevel instead of span
    NSNumber *zoomLevel = nil;
    @try {
      zoomLevel = [view valueForKey:@"zoomLevel"];
    } @catch (NSException *e) {
    }

    double altitudeValue = altitude ? altitude.doubleValue : 0;
    double headingValue = heading ? heading.doubleValue : 0;
    double pitchValue = pitch ? pitch.doubleValue : 0;
    double zoomValue = zoomLevel ? zoomLevel.doubleValue : 0;

    return [NSString
        stringWithFormat:@"%.5f:%.5f:%.5f:%.5f:%.1f:%.1f:%.1f:%.2f",
                         center.latitude, center.longitude, span.latitudeDelta,
                         span.longitudeDelta, altitudeValue, headingValue,
                         pitchValue, zoomValue];
  } @catch (NSException *exception) {
    return @"";
  }
}

@end
