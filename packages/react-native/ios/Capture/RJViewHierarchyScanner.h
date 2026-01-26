//
//  RJViewHierarchyScanner.h
//  Rejourney
//
//  Unified view hierarchy scanner that combines layout signature generation
//  and privacy rect detection into a single traversal pass for optimal
//  performance.
//
//  Licensed under the Apache License, Version 2.0 (the "License").
//  Copyright (c) 2026 Rejourney
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

#pragma mark - Scan Result

/**
 * Result of a unified view hierarchy scan.
 * Contains all data collected in a single traversal pass.
 */
@interface RJViewHierarchyScanResult : NSObject

/// Layout signature hash (MD5) for change detection
@property(nonatomic, copy, nullable) NSString *layoutSignature;

/// Frames of text input views in window coordinates
@property(nonatomic, strong) NSArray<NSValue *> *textInputFrames;

/// Frames of camera preview views in window coordinates
@property(nonatomic, strong) NSArray<NSValue *> *cameraFrames;

/// Frames of video layer views in window coordinates
@property(nonatomic, strong) NSArray<NSValue *> *videoFrames;

/// Whether any text inputs were found
@property(nonatomic, readonly) BOOL hasTextInputs;

/// Whether any camera views were found
@property(nonatomic, readonly) BOOL hasCameraViews;

/// Whether a MapView (MKMapView or react-native-maps) was found
/// When true, frame caching should be disabled since map tiles load async
@property(nonatomic, assign) BOOL hasMapView;

/// Frames of MapView instances in window coordinates (for hybrid capture)
/// These views need special handling with drawViewHierarchyInRect
@property(nonatomic, strong) NSArray<NSValue *> *mapViewFrames;

/// Pointers to MapView instances for direct snapshot capture
/// Stored as NSValue wrapping UIView pointers
@property(nonatomic, strong) NSArray<NSValue *> *mapViewPointers;

/// Total number of views scanned
@property(nonatomic, assign) NSUInteger totalViewsScanned;

/// Timestamp of when scan was performed
@property(nonatomic, assign) NSTimeInterval scanTimestamp;

/// Frames of WebView instances in window coordinates
@property(nonatomic, strong) NSArray<NSValue *> *webViewFrames;

/// Whether any WebView instances were found
@property(nonatomic, readonly) BOOL hasWebViews;

/// Whether scroll or deceleration motion is active
@property(nonatomic, assign) BOOL scrollActive;

/// Whether rubber-band bounce or inset settling is active
@property(nonatomic, assign) BOOL bounceActive;

/// Whether pull-to-refresh is active or settling
@property(nonatomic, assign) BOOL refreshActive;

/// Whether map camera/region motion is active
@property(nonatomic, assign) BOOL mapActive;

/// Whether any CA animations were detected in the hierarchy
@property(nonatomic, assign) BOOL hasAnyAnimations;

/// Approximate animated area ratio (0..1) relative to the screen
@property(nonatomic, assign) CGFloat animationAreaRatio;

/// Scroll view pointers (non-retained) for stability probes
@property(nonatomic, strong) NSArray<NSValue *> *scrollViewPointers;

/// Animated view pointers (non-retained) for stability probes
@property(nonatomic, strong) NSArray<NSValue *> *animatedViewPointers;

/// Whether the scan bailed out early (depth/view/time limits)
@property(nonatomic, assign) BOOL didBailOutEarly;

@end

#pragma mark - Scanner Configuration

/**
 * Configuration options for the view hierarchy scanner.
 */
@interface RJViewHierarchyScannerConfig : NSObject

/// Whether to detect text input views. Default: YES
@property(nonatomic, assign) BOOL detectTextInputs;

/// Whether to detect camera preview views. Default: YES
@property(nonatomic, assign) BOOL detectCameraViews;

/// Whether to detect WebView instances. Default: YES
@property(nonatomic, assign) BOOL detectWebViews;

/// Whether to detect video layer views. Default: YES
@property(nonatomic, assign) BOOL detectVideoLayers;

/// Set of nativeIDs to manually mask
@property(nonatomic, strong) NSSet<NSString *> *maskedNativeIDs;

/// Maximum traversal depth. Default: 15
@property(nonatomic, assign) NSInteger maxDepth;

/// Maximum number of views to scan before stopping. Default: 500
/// Prevents runaway scans on extremely complex view hierarchies.
@property(nonatomic, assign) NSUInteger maxViewCount;

/// Default configuration instance
+ (instancetype)defaultConfig;

@end

#pragma mark - Scanner

/**
 * Unified view hierarchy scanner that performs a single traversal to collect:
 * - Layout signature data for change detection
 * - Privacy-sensitive view locations (text inputs, cameras)
 *
 * This optimization reduces main thread blocking by 20-50% compared to
 * performing separate traversals for layout and privacy scanning.
 *
 * @note This class is not thread-safe. Call from the main thread only.
 */
@interface RJViewHierarchyScanner : NSObject

/// Scanner configuration
@property(nonatomic, strong) RJViewHierarchyScannerConfig *config;

/// Initialize with default configuration
- (instancetype)init;

/// Initialize with custom configuration
- (instancetype)initWithConfig:(RJViewHierarchyScannerConfig *)config;

/**
 * Performs a unified scan of the window's view hierarchy.
 *
 * This single traversal collects:
 * - Layout signature for change detection
 * - Text input view frames for privacy masking
 * - Camera preview frames for privacy masking
 *
 * @param window The window to scan.
 * @return Scan result containing all collected data, or nil on failure.
 */
- (nullable RJViewHierarchyScanResult *)scanWindow:(UIWindow *)window;

/**
 * Scans ALL visible windows in the app for sensitive views.
 *
 * This is critical for proper privacy masking when text inputs appear
 * in modal windows, overlay windows, or React Native navigation modals
 * which create separate UIWindow instances.
 *
 * Frames are converted to the primary capture window's coordinate space.
 *
 * @param primaryWindow The primary window being captured (for coordinate
 * conversion).
 * @return Scan result with frames from ALL windows, converted to primaryWindow
 * coordinates.
 */
- (nullable RJViewHierarchyScanResult *)scanAllWindowsRelativeTo:
    (UIWindow *)primaryWindow;

/**
 * Scans a specific list of windows relative to a primary window.
 * Use this when the caller maintains a cached list of windows to improved
 * performance.
 */
- (nullable RJViewHierarchyScanResult *)scanWindows:
                                            (NSArray<UIWindow *> *)windows
                                   relativeToWindow:(UIWindow *)primaryWindow;

/**
 * Check if a view is visible (optimization for early skip).
 *
 * @param view The view to check.
 * @return YES if view is visible and should be scanned.
 */
- (BOOL)isViewVisible:(UIView *)view;

/**
 * Pre-warm internal class caches to eliminate cold-cache penalties on first
 * scan.
 *
 * Call this during app initialization or before first recording session
 * to front-load the ~10-15ms of class lookup overhead that would otherwise
 * occur on the first frame capture.
 *
 * @note Safe to call multiple times - subsequent calls are no-ops.
 */
- (void)prewarmClassCaches;

@end

NS_ASSUME_NONNULL_END
