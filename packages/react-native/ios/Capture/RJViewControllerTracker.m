//
//  RJViewControllerTracker.m
//  Rejourney
//
//  Automatic ViewController lifecycle tracking via method swizzling.
//  Detects navigation changes, tab switches, and significant UI transitions.
//
//  Copyright (c) 2026 Rejourney
//

#import "RJViewControllerTracker.h"
#import "../Core/RJLogger.h"
#import <objc/runtime.h>

static IMP _originalViewDidAppear = NULL;
static IMP _originalViewWillDisappear = NULL;
static IMP _originalTabBarDidSelect = NULL;

static NSString *_lastScreenName = nil;
static NSInteger _lastTabIndex = -1;

static NSString *_authoritativeScreenName = nil;
static NSTimeInterval _authoritativeScreenNameTime = 0;

static const NSTimeInterval kAuthoritativeNameTimeout = 0.5;

#pragma mark - Swizzled Method Implementations

static void RJ_swizzled_viewDidAppear(UIViewController *self, SEL _cmd,
                                      BOOL animated) {
  
  if (_originalViewDidAppear) {
    ((void (*)(id, SEL, BOOL))_originalViewDidAppear)(self, _cmd, animated);
  }

  
  if ([self rj_shouldSkipTracking]) {
    return;
  }

  
  NSString *screenName =
      [RJViewControllerTracker screenNameForViewController:self];

  
  
  if (!screenName || screenName.length == 0) {
    return;
  }

  
  static dispatch_queue_t _screenNameQueue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    _screenNameQueue = dispatch_queue_create("com.rejourney.screenname",
                                             DISPATCH_QUEUE_SERIAL);
  });

  __block BOOL shouldNotify = NO;
  dispatch_sync(_screenNameQueue, ^{
    if (![screenName isEqualToString:_lastScreenName]) {
      _lastScreenName = [screenName copy];
      shouldNotify = YES;
    }
  });

  if (shouldNotify) {
    RJViewControllerTracker *tracker = [RJViewControllerTracker sharedInstance];
    if (tracker.isEnabled && tracker.delegate) {
      
      __weak UIViewController *weakVC = self;
      dispatch_async(dispatch_get_main_queue(), ^{
        UIViewController *strongVC = weakVC;
        if (strongVC && [tracker.delegate respondsToSelector:@selector
                                          (viewControllerDidAppear:
                                                        screenName:)]) {
          [tracker.delegate viewControllerDidAppear:strongVC
                                         screenName:screenName];
        }
      });
    }
  }
}

static void RJ_swizzled_viewWillDisappear(UIViewController *self, SEL _cmd,
                                          BOOL animated) {
  
  if (_originalViewWillDisappear) {
    ((void (*)(id, SEL, BOOL))_originalViewWillDisappear)(self, _cmd, animated);
  }

  
  if ([self rj_shouldSkipTracking]) {
    return;
  }

  NSString *screenName =
      [RJViewControllerTracker screenNameForViewController:self];

  
  if (!screenName || screenName.length == 0) {
    return;
  }

  RJViewControllerTracker *tracker = [RJViewControllerTracker sharedInstance];
  if (tracker.isEnabled && tracker.delegate) {
    
    __weak UIViewController *weakVC = self;
    dispatch_async(dispatch_get_main_queue(), ^{
      UIViewController *strongVC = weakVC;
      if (strongVC && [tracker.delegate respondsToSelector:@selector
                                        (viewControllerWillDisappear:
                                                          screenName:)]) {
        [tracker.delegate viewControllerWillDisappear:strongVC
                                           screenName:screenName];
      }
    });
  }
}

#pragma mark - UIViewController Category for Skip Logic

@implementation UIViewController (RJTracking)

- (BOOL)rj_shouldSkipTracking {
  
  
  static NSSet *_skipPrefixes;
  static NSSet *_skipContains;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    
    
    _skipPrefixes = [[NSSet alloc] initWithArray:@[ @"_", @"UI" ]];
    _skipContains = [[NSSet alloc] initWithArray:@[
      @"Navigation", @"Container", @"Keyboard", @"StatusBar", @"InputAccessory",
      @"FabricModal", @"ModalHost", @"Fabric", @"HostingView", @"SafeArea",
      @"ScrollViewContent", @"RCTRootContentView", @"ReactNative"
    ]];
  });

  NSString *className = NSStringFromClass([self class]);

  
  for (NSString *prefix in _skipPrefixes) {
    if ([className hasPrefix:prefix]) {
      return YES;
    }
  }

  
  for (NSString *substring in _skipContains) {
    if ([className containsString:substring]) {
      return YES;
    }
  }

  
  if (!self.isViewLoaded || !self.view.window) {
    return YES;
  }

  
  if (self.parentViewController &&
      ![self.parentViewController
          isKindOfClass:[UINavigationController class]] &&
      ![self.parentViewController isKindOfClass:[UITabBarController class]]) {
    return YES;
  }

  return NO;
}

@end

#pragma mark - RJViewControllerTracker Implementation

@interface RJViewControllerTracker ()
@property(nonatomic, assign, readwrite) BOOL isEnabled;
@property(nonatomic, assign) BOOL hasSwizzled;
@end

@implementation RJViewControllerTracker

+ (instancetype)sharedInstance {
  static RJViewControllerTracker *instance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [[RJViewControllerTracker alloc] init];
  });
  return instance;
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _isEnabled = NO;
    _hasSwizzled = NO;
  }
  return self;
}

- (void)enableTracking {
  if (self.isEnabled)
    return;

  @synchronized(self) {
    if (self.hasSwizzled) {
      self.isEnabled = YES;
      return;
    }

    @try {
      
      Method originalDidAppear = class_getInstanceMethod(
          [UIViewController class], @selector(viewDidAppear:));
      if (originalDidAppear) {
        _originalViewDidAppear = method_getImplementation(originalDidAppear);
        method_setImplementation(originalDidAppear,
                                 (IMP)RJ_swizzled_viewDidAppear);
      }

      
      Method originalWillDisappear = class_getInstanceMethod(
          [UIViewController class], @selector(viewWillDisappear:));
      if (originalWillDisappear) {
        _originalViewWillDisappear =
            method_getImplementation(originalWillDisappear);
        method_setImplementation(originalWillDisappear,
                                 (IMP)RJ_swizzled_viewWillDisappear);
      }

      
      [[NSNotificationCenter defaultCenter]
          addObserver:self
             selector:@selector(handleTabBarSelectionChange:)
                 name:@"UITabBarControllerDidSelectViewControllerNotification"
               object:nil];

      
      [[NSNotificationCenter defaultCenter]
          addObserver:self
             selector:@selector(handleWindowChange:)
                 name:UIWindowDidBecomeKeyNotification
               object:nil];

      self.hasSwizzled = YES;
      self.isEnabled = YES;

      RJLogDebug(@"ViewController tracking enabled");
    } @catch (NSException *exception) {
      RJLogError(@"Failed to enable VC tracking: %@", exception);
    }
  }
}

- (void)disableTracking {
  self.isEnabled = NO;
  RJLogDebug(@"ViewController tracking disabled");
}

- (void)handleTabBarSelectionChange:(NSNotification *)notification {
  if (!self.isEnabled || !self.delegate)
    return;

  UITabBarController *tabBar = notification.object;
  if ([tabBar isKindOfClass:[UITabBarController class]]) {
    NSInteger newIndex = tabBar.selectedIndex;
    NSInteger previousIndex = _lastTabIndex;

    if (newIndex != previousIndex) {
      _lastTabIndex = newIndex;

      if ([self.delegate respondsToSelector:@selector(tabBarDidSelectIndex:
                                                                 fromIndex:)]) {
        [self.delegate tabBarDidSelectIndex:newIndex fromIndex:previousIndex];
      }
    }
  }
}

- (void)handleWindowChange:(NSNotification *)notification {
  if (!self.isEnabled || !self.delegate)
    return;

  
  UIWindow *window = notification.object;
  if ([window isKindOfClass:[UIWindow class]] && window.rootViewController) {
    
    UIViewController *topVC =
        [self topViewControllerFromViewController:window.rootViewController];
    if (topVC) {
      NSString *screenName =
          [RJViewControllerTracker screenNameForViewController:topVC];
      if (![screenName isEqualToString:_lastScreenName]) {
        _lastScreenName = [screenName copy];

        if ([self.delegate respondsToSelector:@selector
                           (viewControllerDidAppear:screenName:)]) {
          [self.delegate viewControllerDidAppear:topVC screenName:screenName];
        }
      }
    }
  }
}

- (UIViewController *)topViewControllerFromViewController:
    (UIViewController *)viewController {
  if ([viewController isKindOfClass:[UINavigationController class]]) {
    UINavigationController *nav = (UINavigationController *)viewController;
    return [self topViewControllerFromViewController:nav.visibleViewController];
  }
  if ([viewController isKindOfClass:[UITabBarController class]]) {
    UITabBarController *tab = (UITabBarController *)viewController;
    return
        [self topViewControllerFromViewController:tab.selectedViewController];
  }
  if (viewController.presentedViewController) {
    return
        [self topViewControllerFromViewController:viewController
                                                      .presentedViewController];
  }
  return viewController;
}

+ (void)setAuthoritativeScreenName:(NSString *)screenName {
  @synchronized(self) {
    _authoritativeScreenName = [screenName copy];
    _authoritativeScreenNameTime = [[NSDate date] timeIntervalSince1970];
  }
}

+ (nullable NSString *)authoritativeScreenName {
  @synchronized(self) {
    if (!_authoritativeScreenName)
      return nil;

    
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
    if (now - _authoritativeScreenNameTime > kAuthoritativeNameTimeout) {
      _authoritativeScreenName = nil;
      return nil;
    }
    return _authoritativeScreenName;
  }
}

+ (void)clearAuthoritativeScreenName {
  @synchronized(self) {
    _authoritativeScreenName = nil;
    _authoritativeScreenNameTime = 0;
  }
}

+ (NSString *)screenNameForViewController:(UIViewController *)viewController {
  if (!viewController)
    return @"Unknown";

  
  NSString *authoritativeName = [self authoritativeScreenName];
  if (authoritativeName.length > 0) {
    return authoritativeName;
  }

  

  
  if (viewController.title.length > 0) {
    return [self normalizeScreenName:viewController.title];
  }

  
  if (viewController.navigationItem.title.length > 0) {
    return [self normalizeScreenName:viewController.navigationItem.title];
  }

  
  if (viewController.tabBarItem.title.length > 0) {
    return [self normalizeScreenName:viewController.tabBarItem.title];
  }

  

  
  if (viewController.view.accessibilityIdentifier.length > 0) {
    NSString *identifier = viewController.view.accessibilityIdentifier;
    
    if (![identifier hasPrefix:@"RCT"] && ![identifier hasPrefix:@"RNS"] &&
        ![identifier containsString:@"ContentView"]) {
      return [self normalizeScreenName:identifier];
    }
  }

  
  
  if (viewController.view.accessibilityLabel.length > 0 &&
      viewController.view.accessibilityLabel.length < 40) {
    return [self normalizeScreenName:viewController.view.accessibilityLabel];
  }

  
  

  
  if (viewController.navigationController) {
    UINavigationItem *navItem =
        viewController.navigationController.navigationBar.topItem;
    if (navItem.title.length > 0) {
      return [self normalizeScreenName:navItem.title];
    }
  }

  
  return [self normalizeClassName:NSStringFromClass([viewController class])];
}

+ (NSString *)normalizeScreenName:(NSString *)name {
  if (!name || name.length == 0)
    return @"Unknown";

  NSString *result = name;

  
  NSArray *suffixes = @[ @"Screen", @"Page", @"View", @"Controller", @"VC" ];
  for (NSString *suffix in suffixes) {
    if ([result hasSuffix:suffix] && result.length > suffix.length) {
      result = [result substringToIndex:result.length - suffix.length];
      break;
    }
  }

  
  result = [result
      stringByTrimmingCharactersInSet:[NSCharacterSet
                                          whitespaceAndNewlineCharacterSet]];

  return result.length > 0 ? result : @"Unknown";
}

+ (NSString *)normalizeClassName:(NSString *)className {
  if (!className || className.length == 0)
    return nil;

  NSString *result = className;

  
  static NSSet *_noiseNames;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    _noiseNames = [[NSSet alloc] initWithArray:@[
      @"Screen", @"View", @"Controller", @"Host", @"Modal", @"Wrapper",
      @"Content", @"Root", @"Main", @"Base", @"Default", @"Generic",
      @"Fabric Modal Host", @"Fabric", @"ModalHost"
    ]];
  });

  
  NSArray *prefixesToRemove = @[ @"RNS", @"RCT", @"RN", @"UI", @"Fabric" ];
  for (NSString *prefix in prefixesToRemove) {
    if ([result hasPrefix:prefix] && result.length > prefix.length + 2) {
      result = [result substringFromIndex:prefix.length];
      break;
    }
  }

  
  NSArray *suffixes = @[
    @"ViewController", @"Controller", @"VC", @"Screen", @"View",
    @"StackHeaderConfig", @"ContentView", @"ScreenView", @"ScreenContainer",
    @"Host", @"Wrapper", @"HostingController", @"ModalHost"
  ];
  for (NSString *suffix in suffixes) {
    if ([result hasSuffix:suffix] && result.length > suffix.length) {
      result = [result substringToIndex:result.length - suffix.length];
      break;
    }
  }

  
  if (result.length < 2) {
    return nil;
  }

  
  NSMutableString *spaced = [NSMutableString string];
  for (NSUInteger i = 0; i < result.length; i++) {
    unichar c = [result characterAtIndex:i];
    if (i > 0 &&
        [[NSCharacterSet uppercaseLetterCharacterSet] characterIsMember:c]) {
      [spaced appendString:@" "];
    }
    [spaced appendFormat:@"%c", c];
  }

  
  NSString *finalName = spaced.length > 0 ? spaced : nil;
  if (finalName && [_noiseNames containsObject:finalName]) {
    return nil;
  }

  return finalName;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

@end
