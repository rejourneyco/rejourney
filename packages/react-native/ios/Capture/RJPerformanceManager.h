//
//  RJPerformanceManager.h
//  Rejourney
//
//  System performance monitoring and adaptive throttling.
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

#import "../Core/RJTypes.h"
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// RJPerformanceLevel is defined in RJTypes.h

/// Delegate for performance level changes
@protocol RJPerformanceManagerDelegate <NSObject>
@optional
- (void)performanceManagerDidChangeLevel:(RJPerformanceLevel)level;
- (void)performanceManagerDidReceiveMemoryWarning;
@end

/**
 * Manages system performance monitoring including thermal state,
 * battery level, and memory pressure.
 */
@interface RJPerformanceManager : NSObject

/// Current performance level based on system conditions
@property(nonatomic, readonly) RJPerformanceLevel currentLevel;

/// Delegate for performance events
@property(nonatomic, weak, nullable) id<RJPerformanceManagerDelegate> delegate;

/// Whether thermal throttling is enabled
@property(nonatomic, assign) BOOL thermalThrottleEnabled;

/// Whether battery-aware throttling is enabled
@property(nonatomic, assign) BOOL batteryAwareEnabled;

/// Shared instance
+ (instancetype)sharedManager;

/**
 * Start monitoring system performance.
 */
- (void)startMonitoring;

/**
 * Stop monitoring system performance.
 */
- (void)stopMonitoring;

/**
 * Force a performance level update check.
 */
- (void)updatePerformanceLevel;

/**
 * Get current memory usage in bytes.
 */
- (NSUInteger)currentMemoryUsage;

/**
 * Handle memory warning - clears caches and notifies delegate.
 */
- (void)handleMemoryWarning;

/**
 * Get current CPU usage as percentage (0.0-100.0).
 * Returns -1 if unavailable.
 */
/**
 * Get current CPU usage as percentage (0.0-100.0).
 * Returns -1 if unavailable.
 */
- (float)currentCPUUsage;

/**
 * Returns YES if CPU usage is considered high enough to skip expensive
 * operations.
 */
@property(nonatomic, readonly) BOOL isCPUHigh;

@end

NS_ASSUME_NONNULL_END
