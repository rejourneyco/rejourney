//
//  RJANRHandler.h
//  Rejourney
//
//  Detects Application Not Responding (ANR) conditions using a watchdog timer.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@protocol RJANRHandlerDelegate <NSObject>
@optional
/// Called when an ANR is detected
- (void)anrDetectedWithDuration:(NSTimeInterval)duration
                    threadState:(nullable NSString *)threadState;
@end

@interface RJANRHandler : NSObject

@property(nonatomic, weak, nullable) id<RJANRHandlerDelegate> delegate;

/// ANR threshold in seconds (default: 5.0)
@property(nonatomic, assign) NSTimeInterval threshold;

+ (instancetype)sharedInstance;

/// Starts ANR monitoring
- (void)startMonitoring;

/// Stops ANR monitoring
- (void)stopMonitoring;

/// Checks if there is a pending ANR report from a previous launch
- (BOOL)hasPendingANRReport;

/// Loads the pending ANR report and clears it from disk
- (nullable NSDictionary *)loadAndPurgePendingANRReport;

@end

NS_ASSUME_NONNULL_END
