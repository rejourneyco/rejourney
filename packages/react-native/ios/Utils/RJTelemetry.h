//
// RJTelemetry.h
// Rejourney SDK Telemetry
//
// Provides observability metrics for SDK health monitoring.
// Tracks upload success rates, retry counts, circuit breaker events, and memory
// pressure.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Telemetry event types
typedef NS_ENUM(NSInteger, RJTelemetryEventType) {
  RJTelemetryEventUploadSuccess,
  RJTelemetryEventUploadFailure,
  RJTelemetryEventRetryAttempt,
  RJTelemetryEventCircuitBreakerOpen,
  RJTelemetryEventCircuitBreakerClose,
  RJTelemetryEventMemoryPressureEviction,
  RJTelemetryEventOfflineQueuePersist,
  RJTelemetryEventOfflineQueueRestore,
  RJTelemetryEventSessionStart,
  RJTelemetryEventSessionEnd,
  RJTelemetryEventCrashDetected,
  RJTelemetryEventTokenRefresh,
};

/// SDK health metrics snapshot
@interface RJTelemetryMetrics : NSObject

@property(nonatomic, assign, readonly) NSInteger uploadSuccessCount;
@property(nonatomic, assign, readonly) NSInteger uploadFailureCount;
@property(nonatomic, assign, readonly) NSInteger retryAttemptCount;
@property(nonatomic, assign, readonly) NSInteger circuitBreakerOpenCount;
@property(nonatomic, assign, readonly) NSInteger memoryEvictionCount;
@property(nonatomic, assign, readonly) NSInteger offlinePersistCount;
@property(nonatomic, assign, readonly) NSInteger sessionStartCount;
@property(nonatomic, assign, readonly) NSInteger crashCount;
@property(nonatomic, assign, readonly) NSInteger anrCount;
@property(nonatomic, assign, readonly) double uploadSuccessRate;
@property(nonatomic, assign, readonly) NSTimeInterval avgUploadDurationMs;
@property(nonatomic, assign, readonly) NSInteger currentQueueDepth;
@property(nonatomic, strong, readonly) NSDate *lastUploadTime;
@property(nonatomic, strong, readonly) NSDate *lastRetryTime;

@end

/// Telemetry collector for SDK observability
@interface RJTelemetry : NSObject

/// Shared instance
+ (instancetype)sharedInstance;

/// Record a telemetry event
- (void)recordEvent:(RJTelemetryEventType)eventType;

/// Record an event with additional context
- (void)recordEvent:(RJTelemetryEventType)eventType
           metadata:(nullable NSDictionary<NSString *, id> *)metadata;

/// Record upload duration for latency tracking
- (void)recordUploadDuration:(NSTimeInterval)durationMs
                     success:(BOOL)success
                   byteCount:(NSUInteger)bytes;

/// Record memory pressure eviction
- (void)recordFrameEviction:(NSUInteger)bytesEvicted
                 frameCount:(NSInteger)count;

/// Record retry queue depth
- (void)recordQueueDepth:(NSInteger)depth;

/// Record an ANR event
- (void)recordANR;

/// Get current metrics snapshot
- (RJTelemetryMetrics *)currentMetrics;

/// Get metrics as dictionary for reporting
- (NSDictionary<NSString *, id> *)metricsAsDictionary;

/// Reset all metrics (typically on session end)
- (void)resetMetrics;

/// Export metrics to console for debugging (only in DEBUG builds)
- (void)logCurrentMetrics;

@end

NS_ASSUME_NONNULL_END
