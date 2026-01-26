//
//  RJViewSerializer.h
//  Rejourney
//
//  View hierarchy serializer for privacy masking and debugging.
//  Captures view structure as JSON for element identification,
//  tap target resolution, and layout debugging in session replay.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
//
//  Copyright (c) 2026 Rejourney
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

@class RJViewHierarchyScanResult;

NS_ASSUME_NONNULL_BEGIN

/**
 * View hierarchy serializer for session recording.
 *
 * Captures the complete view tree structure as a JSON-compatible dictionary,
 * including:
 * - View types and frames
 * - Accessibility identifiers and labels
 * - Interactive element detection
 * - Privacy masking indicators
 * - Visual properties (colors, alpha)
 *
 * ## Usage
 * ```objc
 * RJViewSerializer *serializer = [[RJViewSerializer alloc] init];
 * NSDictionary *hierarchy = [serializer serializeWindow:keyWindow];
 * NSData *jsonData = [NSJSONSerialization dataWithJSONObject:hierarchy
 * options:0 error:nil];
 * ```
 *
 * ## Privacy
 * Text content is automatically masked (e.g., "password" -> "p•••••d").
 * Sensitive view types (UITextField, UITextView) are flagged with `masked:
 * true`.
 *
 * @note Call from the main thread only.
 */
@interface RJViewSerializer : NSObject

#pragma mark - Configuration

/// Whether serialization is enabled. Default: YES.
@property(nonatomic, assign) BOOL enabled;

/// Maximum depth of view tree traversal. Default: 20.
@property(nonatomic, assign) NSInteger maxDepth;

/// Whether to include visual properties (colors, alpha). Default: YES.
@property(nonatomic, assign) BOOL includeVisualProperties;

/// Whether to include text content (masked). Default: YES.
@property(nonatomic, assign) BOOL includeTextContent;

#pragma mark - Serialization

/**
 * Serializes the entire window hierarchy to a JSON-compatible dictionary.
 *
 * @param window The window to serialize.
 * @return Dictionary containing:
 *         - timestamp: Epoch milliseconds
 *         - screen: { width, height, scale }
 *         - root: Recursive view tree
 */
- (NSDictionary *)serializeWindow:(UIWindow *)window;

/** * Serialize window using pre-scanned results for better performance.
 * Falls back to regular serialization if scanResult is nil.
 *
 * @param window The window to serialize
 * @param scanResult Pre-scanned view hierarchy result (optional)
 * @return Dictionary with hierarchy structure and metadata
 */
- (NSDictionary *)serializeWindow:(UIWindow *)window
                   withScanResult:
                       (nullable RJViewHierarchyScanResult *)scanResult;

/** * Serializes a single view and its subviews.
 *
 * @param view The view to serialize.
 * @return Dictionary containing view properties and children.
 */
- (NSDictionary *)serializeView:(UIView *)view;

#pragma mark - Utility

/**
 * Finds the view at a specific point in the window.
 * Useful for resolving tap coordinates to view identifiers.
 *
 * @param point The point in window coordinates.
 * @param window The window to search in.
 * @return Dictionary with view info at that point, or nil if none found.
 */
- (nullable NSDictionary *)viewInfoAtPoint:(CGPoint)point
                                  inWindow:(UIWindow *)window;

@end

NS_ASSUME_NONNULL_END
