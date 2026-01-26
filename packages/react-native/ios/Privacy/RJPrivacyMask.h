//
//  RJPrivacyMask.h
//  Rejourney
//
//  Privacy masking for sensitive UI elements during screen capture.
//  Uses Core Graphics to draw blur overlays directly into the captured image,
//  avoiding any visual flashing for the user.
//
//  Licensed under the Apache License, Version 2.0 (the "License").
//  Copyright (c) 2026 Rejourney
//

#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

@class RJViewHierarchyScanResult;

NS_ASSUME_NONNULL_BEGIN

/**
 * Privacy mask that draws blur overlays directly into captured images.
 *
 * Unlike overlay-based approaches, this class:
 * - Does NOT add any views to the window (no user-visible flashing)
 * - Draws blur rectangles directly into the graphics context
 * - Detects ONLY actual text input fields (not display text)
 * - Detects camera preview layers
 * - Handles background state with full-screen blur
 */
@interface RJPrivacyMask : NSObject

#pragma mark - Configuration

/// Whether text input masking is enabled. Default: YES
@property(nonatomic, assign) BOOL maskTextInputs;

/// Whether camera preview masking is enabled. Default: YES
@property(nonatomic, assign) BOOL maskCameraViews;

/// Whether web view masking is enabled. Default: YES
@property(nonatomic, assign) BOOL maskWebViews;

/// Whether video layer masking is enabled. Default: YES
@property(nonatomic, assign) BOOL maskVideoLayers;

/// Corner radius for blur rectangles. Default: 8.0
@property(nonatomic, assign) CGFloat blurCornerRadius;

/// Padding around masked views. Default: 4.0
@property(nonatomic, assign) CGFloat maskPadding;

#pragma mark - Background State

/// Whether the app is currently in background
@property(nonatomic, readonly) BOOL isInBackground;

#pragma mark - Core Methods

/**
 * Draws privacy masks directly into the current graphics context.
 * Call this AFTER drawing the window hierarchy but BEFORE getting the image.
 *
 * @param window The window that was drawn (to find sensitive views)
 * @param bounds The bounds of the drawing context
 * @param scale The scale factor of the drawing context
 */
- (void)drawMasksForWindow:(UIWindow *)window
                    bounds:(CGRect)bounds
                     scale:(CGFloat)scale;

/**
 * Draws privacy masks using pre-computed scan result.
 *
 * Use this when RJViewHierarchyScanner has already scanned the window
 * to avoid redundant view tree traversal.
 *
 * @param scanResult The pre-computed scan result containing sensitive frames.
 * @param bounds The bounds of the drawing context.
 * @param scale The scale factor of the drawing context.
 */
- (void)drawMasksWithScanResult:(RJViewHierarchyScanResult *)scanResult
                         bounds:(CGRect)bounds
                          scale:(CGFloat)scale;

/**
 * Applies privacy masks directly to a CVPixelBuffer using Core Graphics.
 * Thread-safe: Designed to be called from a background thread.
 *
 * @param pixelBuffer The CVPixelBufferRef to draw masks onto.
 * @param scanResult The scan result containing mask frames.
 * @param scale The total scale factor (screen scale * capture scale) to
 * transform points to pixels.
 */
- (void)applyToPixelBuffer:(CVPixelBufferRef)pixelBuffer
            withScanResult:(RJViewHierarchyScanResult *)scanResult
                     scale:(CGFloat)scale;

/**
 * Applies privacy masks to an existing image and returns a new masked image.
 * Thread-safe: Can be called from any thread (designed for background
 * processing).
 *
 * @param image The source image to apply masks to.
 * @param scanResult The pre-computed scan result containing sensitive frames.
 * @param isInBackground Whether the app is in background (full screen mask).
 * @return A new UIImage with privacy masks applied, or the original image if no
 * masking needed.
 */
- (UIImage *)applyMasksToImage:(UIImage *)image
                    scanResult:(RJViewHierarchyScanResult *)scanResult
                isInBackground:(BOOL)isInBackground;

/**
 * Finds all sensitive view frames in the window.
 * Returns array of NSValue-wrapped CGRects in window coordinates.
 */
- (NSArray<NSValue *> *)findSensitiveFramesInWindow:(UIWindow *)window;

/**
 * Returns YES if the last drawMasksForWindow call masked a camera view.
 * Use this to add metadata to frames for dashboard display.
 */
@property(nonatomic, readonly) BOOL lastFrameHadCamera;

/**
 * Returns YES if the last drawMasksForWindow call masked a text input.
 */
@property(nonatomic, readonly) BOOL lastFrameHadTextInput;

/**
 * Returns YES if the last drawMasksForWindow call masked a web view.
 */
@property(nonatomic, readonly) BOOL lastFrameHadWebView;

/**
 * Cleanup method - no-op for this implementation since we don't add overlays.
 */
- (void)forceCleanup;

#pragma mark - Manual nativeID Masking

/**
 * Set of nativeID strings that should be manually masked.
 * Views with matching accessibilityIdentifier will be masked.
 */
@property(nonatomic, strong, readonly)
    NSMutableSet<NSString *> *maskedNativeIDs;

/**
 * Add a nativeID to the manually masked set.
 * The view with this nativeID will be masked in recordings.
 */
- (void)addMaskedNativeID:(NSString *)nativeID;

/**
 * Remove a nativeID from the manually masked set.
 */
- (void)removeMaskedNativeID:(NSString *)nativeID;

@end

NS_ASSUME_NONNULL_END
