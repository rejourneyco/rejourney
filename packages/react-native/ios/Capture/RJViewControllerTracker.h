//
//  RJViewControllerTracker.h
//  Rejourney
//
//  Automatic ViewController lifecycle tracking via method swizzling.
//  Detects navigation changes, tab switches, and significant UI transitions.
//
//  Copyright (c) 2026 Rejourney
//

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@protocol RJViewControllerTrackerDelegate <NSObject>
@optional
/// Called when a new screen appears
- (void)viewControllerDidAppear:(UIViewController *)viewController
                     screenName:(NSString *)screenName;
/// Called when view controller will disappear
- (void)viewControllerWillDisappear:(UIViewController *)viewController
                         screenName:(NSString *)screenName;
/// Called when a tab bar selection changes
- (void)tabBarDidSelectIndex:(NSInteger)index
                   fromIndex:(NSInteger)previousIndex;
@end

@interface RJViewControllerTracker : NSObject

/// Shared instance
+ (instancetype)sharedInstance;

/// The delegate that receives navigation events
@property(nonatomic, weak, nullable) id<RJViewControllerTrackerDelegate>
    delegate;

/// Whether tracking is currently enabled
@property(nonatomic, assign, readonly) BOOL isEnabled;

/// Enable automatic ViewController tracking (swizzles
/// viewDidAppear/viewWillDisappear)
- (void)enableTracking;

/// Disable tracking and restore original implementations
- (void)disableTracking;

/// Get a human-readable name for a view controller
+ (NSString *)screenNameForViewController:(UIViewController *)viewController;

/// Set the authoritative screen name from JavaScript
/// This takes priority over native auto-detection
+ (void)setAuthoritativeScreenName:(NSString *)screenName;

/// Get the current authoritative screen name (if any)
+ (nullable NSString *)authoritativeScreenName;

/// Clear the authoritative screen name
+ (void)clearAuthoritativeScreenName;

@end

#pragma mark - UIViewController Tracking Category

/// Category on UIViewController for tracking purposes
@interface UIViewController (RJTracking)

/// Returns whether this view controller should be skipped for tracking
/// (internal VCs, containers, system VCs, etc.)
- (BOOL)rj_shouldSkipTracking;

@end

NS_ASSUME_NONNULL_END
