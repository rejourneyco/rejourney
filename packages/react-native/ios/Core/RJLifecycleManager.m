//
//  RJLifecycleManager.m
//  Rejourney
//
//  App lifecycle and keyboard event handling implementation.
//  
//  BACKGROUND TIMEOUT LOGIC:
//  -------------------------
//  When app returns from background:
//  1. Calculate how long we were in background
//  2. If < 60s: Add to accumulated background time, resume session normally
//  3. If >= 60s: Signal timeout to delegate with the background duration
//     The delegate (Rejourney.mm) will:
//     a) End the old session with total background time (including this period)
//     b) Start a new session with fresh state
//
//  Copyright (c) 2026 Rejourney
//

#import "RJLifecycleManager.h"
#import "RJConstants.h"
#import "RJLogger.h"

#pragma mark - Private Interface

@interface RJLifecycleManager ()

@property(nonatomic, assign) BOOL keyboardVisible;
@property(nonatomic, assign) CGRect currentKeyboardFrame;
@property(nonatomic, assign) NSInteger keyPressCount;

@property(nonatomic, assign) BOOL inBackground;
@property(nonatomic, assign) NSTimeInterval backgroundEntryTime;
@property(nonatomic, assign) NSTimeInterval accumulatedBackgroundTimeMs;

@property(nonatomic, assign) BOOL didOpenExternalURL;
@property(nonatomic, copy, nullable) NSString *lastOpenedURLScheme;

@end

#pragma mark - Implementation

@implementation RJLifecycleManager

#pragma mark - Initialization

- (instancetype)init {
  self = [super init];
  if (self) {
    _keyboardVisible = NO;
    _currentKeyboardFrame = CGRectZero;
    _keyPressCount = 0;
    _inBackground = NO;
    _backgroundEntryTime = 0;
    _accumulatedBackgroundTimeMs = 0;
    _backgroundTimeoutThreshold = RJBackgroundSessionTimeout;
    _isRecording = NO;
    _didOpenExternalURL = NO;
  }
  return self;
}

- (void)dealloc {
  [self stopObserving];
}

#pragma mark - Public Properties

- (BOOL)isKeyboardVisible {
  return _keyboardVisible;
}

- (CGRect)keyboardFrame {
  return _currentKeyboardFrame;
}

- (BOOL)isInBackground {
  return _inBackground;
}

- (NSTimeInterval)backgroundEntryTime {
  return _backgroundEntryTime;
}

- (NSTimeInterval)totalBackgroundTimeMs {
  return _accumulatedBackgroundTimeMs;
}

#pragma mark - Observation Lifecycle

- (void)startObserving {
  RJLogInfo(@"[RJ-LIFECYCLE] startObserving called (isRecording=%@)",
             self.isRecording ? @"YES" : @"NO");
  NSNotificationCenter *center = [NSNotificationCenter defaultCenter];

  // Keyboard notifications
  [center addObserver:self
             selector:@selector(keyboardWillShow:)
                 name:UIKeyboardWillShowNotification
               object:nil];
  [center addObserver:self
             selector:@selector(keyboardWillHide:)
                 name:UIKeyboardWillHideNotification
               object:nil];

  // App lifecycle notifications
  [center addObserver:self
             selector:@selector(appDidEnterBackground:)
                 name:UIApplicationDidEnterBackgroundNotification
               object:nil];
  [center addObserver:self
             selector:@selector(appWillTerminate:)
                 name:UIApplicationWillTerminateNotification
               object:nil];
  [center addObserver:self
             selector:@selector(appWillResignActive:)
                 name:UIApplicationWillResignActiveNotification
               object:nil];
  [center addObserver:self
             selector:@selector(appDidBecomeActive:)
                 name:UIApplicationDidBecomeActiveNotification
               object:nil];

  [center addObserver:self
             selector:@selector(textDidChange:)
                 name:UITextFieldTextDidChangeNotification
               object:nil];
  [center addObserver:self
             selector:@selector(textDidChange:)
                 name:UITextViewTextDidChangeNotification
               object:nil];

  RJLogInfo(@"[RJ-LIFECYCLE] Lifecycle manager started observing all notifications");
}

- (void)stopObserving {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  RJLogDebug(@"Lifecycle manager stopped observing");
}

#pragma mark - State Management

- (void)resetBackgroundTime {
  RJLogInfo(@"[RJ-LIFECYCLE] resetBackgroundTime called (was %.0fms)", self.accumulatedBackgroundTimeMs);
  self.accumulatedBackgroundTimeMs = 0;
  self.inBackground = NO;
  self.backgroundEntryTime = 0;
}

- (void)markExternalURLOpened:(NSString *)urlScheme {
  self.didOpenExternalURL = YES;
  self.lastOpenedURLScheme = urlScheme;
}

- (BOOL)consumeExternalURLOpenedWithScheme:(NSString *_Nullable *_Nullable)scheme {
  if (!self.didOpenExternalURL) {
    return NO;
  }

  if (scheme) {
    *scheme = self.lastOpenedURLScheme;
  }

  self.didOpenExternalURL = NO;
  self.lastOpenedURLScheme = nil;
  return YES;
}

#pragma mark - Keyboard Handling

- (void)keyboardWillShow:(NSNotification *)notification {
  self.keyboardVisible = YES;
  self.currentKeyboardFrame =
      [notification.userInfo[UIKeyboardFrameEndUserInfoKey] CGRectValue];

  if (self.isRecording) {
    if ([self.delegate
            respondsToSelector:@selector(lifecycleManagerKeyboardDidShow:)]) {
      [self.delegate lifecycleManagerKeyboardDidShow:self.currentKeyboardFrame];
    }
  }
}

- (void)keyboardWillHide:(NSNotification *)notification {
  if (self.isRecording && self.keyPressCount > 0) {
    if ([self.delegate
            respondsToSelector:@selector(lifecycleManagerKeyboardWillHide:)]) {
      [self.delegate lifecycleManagerKeyboardWillHide:self.keyPressCount];
    }
    self.keyPressCount = 0;
  }

  self.keyboardVisible = NO;
  self.currentKeyboardFrame = CGRectZero;
}

- (void)textDidChange:(NSNotification *)notification {
  if (self.isRecording) {
    self.keyPressCount++;
    if ([self.delegate
            respondsToSelector:@selector(lifecycleManagerTextDidChange)]) {
      [self.delegate lifecycleManagerTextDidChange];
    }
  }
}

#pragma mark - App Lifecycle

- (void)appWillResignActive:(NSNotification *)notification {
  if (self.isRecording) {
    if ([self.delegate
            respondsToSelector:@selector(lifecycleManagerDidResignActive)]) {
      [self.delegate lifecycleManagerDidResignActive];
    }
  }
}

- (void)appDidEnterBackground:(NSNotification *)notification {
  RJLogInfo(@"[RJ-LIFECYCLE] appDidEnterBackground (isRecording=%@)",
             self.isRecording ? @"YES" : @"NO");

  self.inBackground = YES;
  self.backgroundEntryTime = [[NSDate date] timeIntervalSince1970];

  if (!self.isRecording) {
    RJLogInfo(@"[RJ-LIFECYCLE] Not recording - just tracking background time");
    return;
  }

  RJLogInfo(@"[RJ-LIFECYCLE] Calling lifecycleManagerDidEnterBackground delegate");
  if ([self.delegate
          respondsToSelector:@selector(lifecycleManagerDidEnterBackground)]) {
    [self.delegate lifecycleManagerDidEnterBackground];
  }
}

- (void)appWillTerminate:(NSNotification *)notification {
  if ([self.delegate
          respondsToSelector:@selector(lifecycleManagerWillTerminate)]) {
    [self.delegate lifecycleManagerWillTerminate];
  }
}

- (void)appDidBecomeActive:(NSNotification *)notification {
  NSTimeInterval currentTime = [[NSDate date] timeIntervalSince1970];
  BOOL wasInBackground = self.inBackground && self.backgroundEntryTime > 0;
  NSTimeInterval backgroundDurationSec = 0;
  
  if (wasInBackground) {
    backgroundDurationSec = currentTime - self.backgroundEntryTime;
    RJLogInfo(@"[RJ-LIFECYCLE] Returned from background after %.1fs (isRecording=%@)", 
               backgroundDurationSec, self.isRecording ? @"YES" : @"NO");
  } else {
    RJLogInfo(@"[RJ-LIFECYCLE] appDidBecomeActive - was NOT in background");
  }
  
  self.inBackground = NO;
  self.backgroundEntryTime = 0;
  
  if (!self.isRecording) {
    if (wasInBackground && backgroundDurationSec >= self.backgroundTimeoutThreshold) {
      RJLogInfo(@"[RJ-LIFECYCLE] Was not recording, background >= %.0fs - signaling for new session start",
            self.backgroundTimeoutThreshold);
      if ([self.delegate respondsToSelector:@selector(lifecycleManagerSessionDidTimeout:)]) {
        [self.delegate lifecycleManagerSessionDidTimeout:backgroundDurationSec];
      }
    }
    return;
  }

  if (wasInBackground) {
    NSTimeInterval bgDurationMs = backgroundDurationSec * 1000;
    
    if (backgroundDurationSec >= self.backgroundTimeoutThreshold) {
      self.accumulatedBackgroundTimeMs += bgDurationMs;
      RJLogInfo(@"[RJ-LIFECYCLE] TIMEOUT: Added %.0fms, total background=%.0fms - signaling session restart",
            bgDurationMs, self.accumulatedBackgroundTimeMs);
      
      if ([self.delegate respondsToSelector:@selector(lifecycleManagerSessionDidTimeout:)]) {
        [self.delegate lifecycleManagerSessionDidTimeout:backgroundDurationSec];
      }
    } else {
      self.accumulatedBackgroundTimeMs += bgDurationMs;
      RJLogInfo(@"[RJ-LIFECYCLE] Short background: Added %.0fms, total=%.0fms - resuming session",
            bgDurationMs, self.accumulatedBackgroundTimeMs);
    }
  }

  if ([self.delegate respondsToSelector:@selector(lifecycleManagerDidBecomeActive)]) {
    [self.delegate lifecycleManagerDidBecomeActive];
  }
}

@end
