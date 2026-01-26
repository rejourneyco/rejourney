//
//  RJWindowUtils.h
//  Rejourney
//
//  Window and view utility functions.
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

NS_ASSUME_NONNULL_BEGIN

/**
 * Utility class for window and view operations.
 */
@interface RJWindowUtils : NSObject

/**
 * Returns the current key window.
 * Handles iOS 13+ window scene architecture.
 *
 * @return The key window, or nil if none is available.
 */
+ (nullable UIWindow *)keyWindow;

/**
 * Finds the accessibility label for a view or its ancestors.
 *
 * @param view The view to start searching from.
 * @return The first accessibility label found, or nil.
 */
+ (nullable NSString *)accessibilityLabelForView:(nullable UIView *)view;

/**
 * Generates a unique session ID.
 *
 * Format: session_{timestamp}_{random_hex}
 *
 * @return A unique session identifier.
 */
+ (NSString *)generateSessionId;

/**
 * Returns the current timestamp in milliseconds.
 *
 * @return Current time as milliseconds since Unix epoch.
 */
+ (NSTimeInterval)currentTimestampMillis;

@end

NS_ASSUME_NONNULL_END
