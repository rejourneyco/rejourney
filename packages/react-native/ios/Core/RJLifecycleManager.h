//
//  RJLifecycleManager.h
//  Rejourney
//
//  App lifecycle and keyboard event handling.
//
//  Copyright (c) 2026 Rejourney
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// Delegate for lifecycle events
@protocol RJLifecycleManagerDelegate <NSObject>
@optional
- (void)lifecycleManagerDidEnterBackground;
- (void)lifecycleManagerWillTerminate;
- (void)lifecycleManagerDidBecomeActive;
- (void)lifecycleManagerDidResignActive;
- (void)lifecycleManagerKeyboardDidShow:(CGRect)keyboardFrame;
- (void)lifecycleManagerKeyboardWillHide:(NSInteger)keyPressCount;
- (void)lifecycleManagerTextDidChange;
- (void)lifecycleManagerSessionDidTimeout:(NSTimeInterval)backgroundDuration;
@end

/**
 * Manages app lifecycle events and keyboard notifications.
 */
@interface RJLifecycleManager : NSObject

/// Delegate for lifecycle events
@property(nonatomic, weak, nullable) id<RJLifecycleManagerDelegate> delegate;

/// Whether the keyboard is currently visible
@property(nonatomic, readonly) BOOL isKeyboardVisible;

/// Current keyboard frame
@property(nonatomic, readonly) CGRect keyboardFrame;

/// Whether recording is currently active (set by owner)
@property(nonatomic, assign) BOOL isRecording;

/// Whether the app is currently in background
@property(nonatomic, readonly) BOOL isInBackground;

/// Time when app entered background (epoch seconds), 0 if not in background
@property(nonatomic, readonly) NSTimeInterval backgroundEntryTime;

/// Total background time in milliseconds for the current session
@property(nonatomic, readonly) NSTimeInterval totalBackgroundTimeMs;

/// Background session timeout threshold in seconds
@property(nonatomic, assign) NSTimeInterval backgroundTimeoutThreshold;

/**
 * Start observing lifecycle and keyboard notifications.
 */
- (void)startObserving;

/**
 * Stop observing notifications.
 */
- (void)stopObserving;

/**
 * Reset background time tracking for a new session.
 */
- (void)resetBackgroundTime;

/**
 * Mark that an external URL was opened.
 */
- (void)markExternalURLOpened:(NSString *)urlScheme;

/**
 * Check and clear external URL opened flag.
 */
- (BOOL)consumeExternalURLOpenedWithScheme:
    (NSString *_Nullable *_Nullable)scheme;

@end

NS_ASSUME_NONNULL_END
