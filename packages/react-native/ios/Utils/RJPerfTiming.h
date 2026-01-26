//
//  RJPerfTiming.h
//  Rejourney
//
//  Wall-clock CPU timing using mach_absolute_time() with in-memory aggregation.
//  Provides µs-level timing for internal SDK performance validation.
//
//  Usage:
//  - Enable by defining RJ_PERF=1 at compile time
//  - Accumulates metrics in-memory, dumps periodically (every 5s or 100 frames)
//  - Extremely low overhead (~20-30ns per timing call)
//  - Works in release builds
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

NS_ASSUME_NONNULL_BEGIN

// ============================================================================
// COMPILE-TIME SWITCH
// Define RJ_PERF=1 in your build settings to enable performance timing
// Ship production with RJ_PERF=0 or undefined
// ============================================================================
#ifndef RJ_PERF
// Force enable for testing - change to 0 for production
#define RJ_PERF 1
#endif

// ============================================================================
// TIMING MACROS (zero-cost when disabled)
// ============================================================================
#if RJ_PERF

/// Start timing a section. Call at the beginning of the code block to time.
#define RJ_TIME_START uint64_t __rj_t0 = rj_perf_now()

/// End timing and accumulate to the specified metric.
/// @param metric One of: RJPerfMetricFrame, RJPerfMetricScreenshot, etc.
#define RJ_TIME_END(metric) rj_perf_record(metric, __rj_t0, rj_perf_now())

/// Start timing with a custom variable name (for nested timing).
#define RJ_TIME_START_NAMED(name) uint64_t __rj_t0_##name = rj_perf_now()

/// End timing with a custom variable name.
#define RJ_TIME_END_NAMED(name, metric)                                        \
  rj_perf_record(metric, __rj_t0_##name, rj_perf_now())

/// Dump metrics if enough time has passed (call periodically from main loop).
#define RJ_PERF_DUMP_IF_NEEDED() rj_perf_dump_if_needed()

/// Force dump metrics immediately.
#define RJ_PERF_DUMP() rj_perf_dump()

/// Reset all metrics.
#define RJ_PERF_RESET() rj_perf_reset()

#else

// No-op when disabled
#define RJ_TIME_START
#define RJ_TIME_END(metric)
#define RJ_TIME_START_NAMED(name)
#define RJ_TIME_END_NAMED(name, metric)
#define RJ_PERF_DUMP_IF_NEEDED()
#define RJ_PERF_DUMP()
#define RJ_PERF_RESET()

#endif

// ============================================================================
// METRIC TYPES
// ============================================================================

/// Performance metrics that can be tracked.
typedef NS_ENUM(NSInteger, RJPerfMetric) {
  /// Total frame processing time (screenshot + encode + upload)
  RJPerfMetricFrame = 0,

  /// Screenshot capture time (UIGraphics rendering)
  RJPerfMetricScreenshot,

  /// Raw Core Animation/Graphics rendering time (layer.render or
  /// drawViewHierarchy)
  RJPerfMetricRender,

  /// Privacy mask drawing time
  RJPerfMetricPrivacyMask,

  /// View hierarchy scanning time
  RJPerfMetricViewScan,

  /// View hierarchy serialization time
  RJPerfMetricViewSerialize,

  /// Video encoding time (H.264 compression)
  RJPerfMetricEncode,

  /// Pixel buffer creation time (UIImage -> CVPixelBuffer)
  RJPerfMetricPixelBuffer,

  /// Downscaling time (vImage)
  RJPerfMetricDownscale,

  /// Buffer allocation time (CVPixelBufferPool)
  RJPerfMetricBufferAlloc,

  /// Encoder append time (pixel buffer -> H.264)
  RJPerfMetricEncodeAppend,

  /// Segment upload time (network)
  RJPerfMetricUpload,

  /// Number of metric types (keep last)
  RJPerfMetricCount
};

// ============================================================================
// C INTERFACE (for maximum performance)
// ============================================================================

#if RJ_PERF

/// Get current timestamp (mach_absolute_time).
FOUNDATION_EXPORT uint64_t rj_perf_now(void);

/// Record a timing measurement.
/// @param metric The metric to record to
/// @param start Start timestamp from rj_perf_now()
/// @param end End timestamp from rj_perf_now()
FOUNDATION_EXPORT void rj_perf_record(RJPerfMetric metric, uint64_t start,
                                      uint64_t end);

/// Dump metrics if more than 5 seconds have passed since last dump.
FOUNDATION_EXPORT void rj_perf_dump_if_needed(void);

/// Force dump metrics immediately.
FOUNDATION_EXPORT void rj_perf_dump(void);

/// Reset all accumulated metrics.
FOUNDATION_EXPORT void rj_perf_reset(void);

/// Get a snapshot of current metrics (for programmatic access).
/// Returns dictionary with avg/max/count for each metric.
FOUNDATION_EXPORT
NSDictionary<NSString *, NSDictionary<NSString *, NSNumber *> *> *
rj_perf_snapshot(void);

#endif

// ============================================================================
// OBJECTIVE-C INTERFACE (for convenience)
// ============================================================================

/**
 * RJPerfTiming provides wall-clock CPU timing with in-memory aggregation.
 *
 * This class is a thin wrapper around the C functions for ObjC convenience.
 * For hot paths, use the C macros directly for best performance.
 *
 * ## Example Usage
 *
 * ```objc
 * // In a hot loop:
 * RJ_TIME_START;
 * [self doExpensiveWork];
 * RJ_TIME_END(RJPerfMetricFrame);
 *
 * // Periodically (e.g., in capture timer):
 * RJ_PERF_DUMP_IF_NEEDED();
 *
 * // Or get metrics programmatically:
 * NSDictionary *metrics = [RJPerfTiming snapshot];
 * ```
 */
@interface RJPerfTiming : NSObject

/// Whether performance timing is enabled (compile-time).
+ (BOOL)isEnabled;

/// Get current metrics snapshot.
+ (nullable NSDictionary<NSString *, NSDictionary<NSString *, NSNumber *> *> *)
    snapshot;

/// Force dump metrics to console.
+ (void)dump;

/// Reset all metrics.
+ (void)reset;

/// Get human-readable name for a metric.
+ (NSString *)nameForMetric:(RJPerfMetric)metric;

@end

NS_ASSUME_NONNULL_END
