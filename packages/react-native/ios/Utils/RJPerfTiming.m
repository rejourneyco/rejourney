//
//  RJPerfTiming.m
//  Rejourney
//
//  Wall-clock CPU timing implementation using mach_absolute_time().
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

#import "RJPerfTiming.h"
#import "../Core/RJLogger.h"
#import <mach/mach_time.h>
#import <os/lock.h>

#if RJ_PERF

static mach_timebase_info_data_t rj_timebase;

static BOOL rj_perf_initialized = NO;

__attribute__((constructor)) static void RJPerfTimingInit(void) {
  mach_timebase_info(&rj_timebase);
  rj_perf_initialized = YES;
  RJLogInfo(@"[Rejourney PERF] ✅ Performance timing initialized (RJ_PERF=1)");
}

static inline double rj_ms(uint64_t start, uint64_t end) {
  return (double)(end - start) * rj_timebase.numer / rj_timebase.denom /
         1000000.0;
}

static const char *const rj_metric_names[] = {
    "frame_total", "screenshot_ui",  "render_draw",   "privacy_mask",
    "view_scan",   "view_serialize", "encode_h264",   "pixel_buffer",
    "downscale",   "buffer_alloc",   "encode_append", "upload_net"};

static double rj_totals[RJPerfMetricCount] = {0};

static double rj_maxes[RJPerfMetricCount] = {0};

static uint64_t rj_counts[RJPerfMetricCount] = {0};

static uint64_t rj_last_dump = 0;

static const double RJ_DUMP_INTERVAL_MS = 5000.0; // 5s

static const uint64_t RJ_MIN_SAMPLES = 5;

static os_unfair_lock rj_perf_lock = OS_UNFAIR_LOCK_INIT;

uint64_t rj_perf_now(void) { return mach_absolute_time(); }

void rj_perf_record(RJPerfMetric metric, uint64_t start, uint64_t end) {
  if (metric < 0 || metric >= RJPerfMetricCount)
    return;

  double ms = rj_ms(start, end);

  BOOL isMain = [NSThread isMainThread];
  const char *threadName = isMain ? "MAIN" : "BG";

  if (isMain && ms > 4.0) {
    RJLogInfo(@"[RJ-PERF] ⚠️ [%s] %s: %.2fms", threadName, rj_metric_names[metric],
          ms);
  } else {
    RJLogInfo(@"[RJ-PERF] [%s] %s: %.2fms", threadName, rj_metric_names[metric],
          ms);
  }

  os_unfair_lock_lock(&rj_perf_lock);
  rj_counts[metric]++;
  rj_totals[metric] += ms;
  if (ms > rj_maxes[metric]) {
    rj_maxes[metric] = ms;
  }
  os_unfair_lock_unlock(&rj_perf_lock);
}

void rj_perf_dump_if_needed(void) {
  uint64_t now = rj_perf_now();

  if (rj_last_dump != 0 && rj_ms(rj_last_dump, now) < RJ_DUMP_INTERVAL_MS) {
    return;
  }

  os_unfair_lock_lock(&rj_perf_lock);

  if (rj_last_dump != 0 && rj_ms(rj_last_dump, now) < RJ_DUMP_INTERVAL_MS) {
    os_unfair_lock_unlock(&rj_perf_lock);
    return;
  }

  uint64_t total_samples = 0;
  for (int i = 0; i < RJPerfMetricCount; i++) {
    total_samples += rj_counts[i];
  }

  if (total_samples < RJ_MIN_SAMPLES) {
    os_unfair_lock_unlock(&rj_perf_lock);
    return;
  }

  rj_last_dump = now;

  NSMutableString *log =
      [NSMutableString stringWithString:@"[Rejourney PERF SUMMARY]"];

  for (int i = 0; i < RJPerfMetricCount; i++) {
    if (rj_counts[i] > 0) {
      double avg = rj_totals[i] / rj_counts[i];
      [log appendFormat:@" %s=%llu/%.1f/%.1fms", rj_metric_names[i],
                        (unsigned long long)rj_counts[i], avg, rj_maxes[i]];
    }
  }

  os_unfair_lock_unlock(&rj_perf_lock);

  RJLogInfo(@"%@", log);
}

void rj_perf_dump(void) {
  os_unfair_lock_lock(&rj_perf_lock);

  uint64_t total_samples = 0;
  for (int i = 0; i < RJPerfMetricCount; i++) {
    total_samples += rj_counts[i];
  }

  if (total_samples == 0) {
    os_unfair_lock_unlock(&rj_perf_lock);
    RJLogInfo(@"[Rejourney PERF] No samples collected");
    return;
  }

  NSMutableString *log = [NSMutableString stringWithString:@"\n"];
  [log appendString:@"╔════════════════════════════════════════════════════════"
                    @"══════╗\n"];
  [log appendString:@"║              REJOURNEY SDK PERFORMANCE METRICS (ms)    "
                    @"      ║\n"];
  [log appendString:@"╠════════════════════════════════════════════════════════"
                    @"══════╣\n"];
  [log appendFormat:@"║  %-16s │ %8s │ %10s │ %10s  ║\n", "METRIC", "COUNT",
                    "AVG (ms)", "MAX (ms)"];
  [log appendString:@"╠════════════════════════════════════════════════════════"
                    @"══════╣\n"];

  for (int i = 0; i < RJPerfMetricCount; i++) {
    if (rj_counts[i] > 0) {
      double avg = rj_totals[i] / rj_counts[i];
      [log appendFormat:@"║  %-16s │ %8llu │ %10.2f │ %10.2f  ║\n",
                        rj_metric_names[i], (unsigned long long)rj_counts[i],
                        avg, rj_maxes[i]];
    }
  }

  [log appendString:
           @"╚══════════════════════════════════════════════════════════════╝"];

  rj_last_dump = rj_perf_now();

  os_unfair_lock_unlock(&rj_perf_lock);

  RJLogInfo(@"%@", log);
}

void rj_perf_reset(void) {
  os_unfair_lock_lock(&rj_perf_lock);

  for (int i = 0; i < RJPerfMetricCount; i++) {
    rj_totals[i] = 0;
    rj_maxes[i] = 0;
    rj_counts[i] = 0;
  }
  rj_last_dump = 0;

  os_unfair_lock_unlock(&rj_perf_lock);

  RJLogInfo(@"[Rejourney PERF] Metrics reset");
}

NSDictionary<NSString *, NSDictionary<NSString *, NSNumber *> *> *
rj_perf_snapshot(void) {
  NSMutableDictionary *result = [NSMutableDictionary dictionary];

  os_unfair_lock_lock(&rj_perf_lock);

  for (int i = 0; i < RJPerfMetricCount; i++) {
    if (rj_counts[i] > 0) {
      NSString *name = [NSString stringWithUTF8String:rj_metric_names[i]];
      double avg = rj_totals[i] / rj_counts[i];

      result[name] = @{
        @"count" : @(rj_counts[i]),
        @"avg_us" : @(avg),
        @"max_us" : @(rj_maxes[i]),
        @"total_us" : @(rj_totals[i])
      };
    }
  }

  os_unfair_lock_unlock(&rj_perf_lock);

  return [result copy];
}

#endif

@implementation RJPerfTiming

+ (BOOL)isEnabled {
#if RJ_PERF
  return YES;
#else
  return NO;
#endif
}

+ (NSDictionary<NSString *, NSDictionary<NSString *, NSNumber *> *> *)snapshot {
#if RJ_PERF
  return rj_perf_snapshot();
#else
  return nil;
#endif
}

+ (void)dump {
#if RJ_PERF
  rj_perf_dump();
#endif
}

+ (void)reset {
#if RJ_PERF
  rj_perf_reset();
#endif
}

+ (NSString *)nameForMetric:(RJPerfMetric)metric {
#if RJ_PERF
  if (metric >= 0 && metric < RJPerfMetricCount) {
    return [NSString stringWithUTF8String:rj_metric_names[metric]];
  }
#endif
  return @"unknown";
}

@end
