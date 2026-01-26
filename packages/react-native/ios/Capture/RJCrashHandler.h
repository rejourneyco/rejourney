//
//  RJCrashHandler.h
//  Rejourney
//
//  Handles uncaught exceptions and signals to generate crash reports.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Block type for pre-crash callbacks.
 * These are called synchronously before the crash report is written.
 * Use sparingly - only for critical cleanup like flushing video segments.
 */
typedef void (^RJPreCrashCallback)(void);

@interface RJCrashHandler : NSObject

+ (instancetype)sharedInstance;

/// Starts monitoring for crashes
- (void)startMonitoring;

/// Checks if there is a pending crash report from a previous launch
- (BOOL)hasPendingCrashReport;

/// Loads the pending crash report and clears it from disk
- (nullable NSDictionary *)loadAndPurgePendingCrashReport;

/**
 * Registers a callback to be invoked immediately when a crash is detected,
 * before the crash report is written. This allows critical cleanup operations
 * like flushing video segments.
 * 
 * @warning Callbacks must be extremely fast and async-signal-safe for signal handlers.
 *          Exception handlers have more flexibility but should still be quick.
 *
 * @param callback The callback block to invoke on crash.
 */
- (void)registerPreCrashCallback:(RJPreCrashCallback)callback;

@end

NS_ASSUME_NONNULL_END
