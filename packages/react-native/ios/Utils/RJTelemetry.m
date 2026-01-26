//
// RJTelemetry.m
// Rejourney SDK Telemetry
//
// Provides observability metrics for SDK health monitoring.
//

#import "RJTelemetry.h"
#import "../Core/RJLogger.h"

static void *kRJTelemetryQueueKey = &kRJTelemetryQueueKey;

#pragma mark - RJTelemetryMetrics Implementation

@interface RJTelemetryMetrics ()

@property(nonatomic, assign, readwrite) NSInteger uploadSuccessCount;
@property(nonatomic, assign, readwrite) NSInteger uploadFailureCount;
@property(nonatomic, assign, readwrite) NSInteger retryAttemptCount;
@property(nonatomic, assign, readwrite) NSInteger circuitBreakerOpenCount;
@property(nonatomic, assign, readwrite) NSInteger memoryEvictionCount;
@property(nonatomic, assign, readwrite) NSInteger offlinePersistCount;
@property(nonatomic, assign, readwrite) NSInteger sessionStartCount;
@property(nonatomic, assign, readwrite) NSInteger crashCount;
@property(nonatomic, assign, readwrite) NSInteger anrCount;
@property(nonatomic, assign, readwrite) double uploadSuccessRate;
@property(nonatomic, assign, readwrite) NSTimeInterval avgUploadDurationMs;
@property(nonatomic, assign, readwrite) NSInteger currentQueueDepth;
@property(nonatomic, strong, readwrite) NSDate *lastUploadTime;
@property(nonatomic, strong, readwrite) NSDate *lastRetryTime;

@end

@implementation RJTelemetryMetrics
@end

#pragma mark - RJTelemetry Implementation

@interface RJTelemetry ()

@property(nonatomic, strong) dispatch_queue_t metricsQueue;
@property(nonatomic, strong) RJTelemetryMetrics *metrics;
@property(nonatomic, assign) NSInteger totalUploadCount;
@property(nonatomic, assign) NSTimeInterval totalUploadDurationMs;
@property(nonatomic, assign) NSUInteger totalBytesUploaded;
@property(nonatomic, assign) NSUInteger totalBytesEvicted;

@end

@implementation RJTelemetry

+ (instancetype)sharedInstance {
  static RJTelemetry *instance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [[RJTelemetry alloc] init];
  });
  return instance;
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _metricsQueue =
        dispatch_queue_create("com.rejourney.telemetry", DISPATCH_QUEUE_SERIAL);
    dispatch_queue_set_specific(_metricsQueue, kRJTelemetryQueueKey,
                                kRJTelemetryQueueKey, NULL);
    _metrics = [[RJTelemetryMetrics alloc] init];
    [self resetMetrics];
  }
  return self;
}

- (void)recordEvent:(RJTelemetryEventType)eventType {
  [self recordEvent:eventType metadata:nil];
}

- (void)recordEvent:(RJTelemetryEventType)eventType
           metadata:(nullable NSDictionary<NSString *, id> *)metadata {
  dispatch_async(self.metricsQueue, ^{
    switch (eventType) {
    case RJTelemetryEventUploadSuccess:
      self.metrics.uploadSuccessCount++;
      self.metrics.lastUploadTime = [NSDate date];
      break;

    case RJTelemetryEventUploadFailure:
      self.metrics.uploadFailureCount++;
      break;

    case RJTelemetryEventRetryAttempt:
      self.metrics.retryAttemptCount++;
      self.metrics.lastRetryTime = [NSDate date];
      break;

    case RJTelemetryEventCircuitBreakerOpen:
      self.metrics.circuitBreakerOpenCount++;
      RJLogWarning(@"[Telemetry] Circuit breaker opened (total: %ld)",
                   (long)self.metrics.circuitBreakerOpenCount);
      break;

    case RJTelemetryEventCircuitBreakerClose:
      RJLogDebug(@"[Telemetry] Circuit breaker closed");
      break;

    case RJTelemetryEventMemoryPressureEviction:
      self.metrics.memoryEvictionCount++;
      break;

    case RJTelemetryEventOfflineQueuePersist:
      self.metrics.offlinePersistCount++;
      RJLogDebug(@"[Telemetry] Offline queue persisted (total: %ld)",
                 (long)self.metrics.offlinePersistCount);
      break;

    case RJTelemetryEventOfflineQueueRestore:
      RJLogDebug(@"[Telemetry] Offline queue restored");
      break;

    case RJTelemetryEventSessionStart:
      self.metrics.sessionStartCount++;
      break;

    case RJTelemetryEventSessionEnd:
      
      [self logCurrentMetricsInternal];
      break;

    case RJTelemetryEventCrashDetected:
      self.metrics.crashCount++;
      RJLogWarning(@"[Telemetry] Crash detected (total: %ld)",
                   (long)self.metrics.crashCount);
      break;

    case RJTelemetryEventTokenRefresh:
      RJLogDebug(@"[Telemetry] Token refresh triggered");
      break;
    }

    
    [self updateSuccessRate];
  });
}

- (void)recordUploadDuration:(NSTimeInterval)durationMs
                     success:(BOOL)success
                   byteCount:(NSUInteger)bytes {
  dispatch_async(self.metricsQueue, ^{
    self.totalUploadCount++;
    self.totalUploadDurationMs += durationMs;
    self.metrics.avgUploadDurationMs =
        self.totalUploadDurationMs / (double)self.totalUploadCount;

    if (success) {
      self.totalBytesUploaded += bytes;
      self.metrics.uploadSuccessCount++;
      self.metrics.lastUploadTime = [NSDate date];
    } else {
      self.metrics.uploadFailureCount++;
    }

    [self updateSuccessRate];
  });
}

- (void)recordFrameEviction:(NSUInteger)bytesEvicted
                 frameCount:(NSInteger)count {
  dispatch_async(self.metricsQueue, ^{
    self.metrics.memoryEvictionCount += count;
    self.totalBytesEvicted += bytesEvicted;

    RJLogWarning(
        @"[Telemetry] Memory eviction: %ld frames, %.1f KB total evicted",
        (long)count, self.totalBytesEvicted / 1024.0);
  });
}

- (void)recordQueueDepth:(NSInteger)depth {
  dispatch_async(self.metricsQueue, ^{
    self.metrics.currentQueueDepth = depth;
  });
}

- (void)recordANR {
  dispatch_async(self.metricsQueue, ^{
    self.metrics.anrCount++;
    RJLogWarning(@"[Telemetry] ANR detected (total: %ld)",
                 (long)self.metrics.anrCount);
  });
}

- (void)updateSuccessRate {
  NSInteger total =
      self.metrics.uploadSuccessCount + self.metrics.uploadFailureCount;
  if (total > 0) {
    self.metrics.uploadSuccessRate =
        (double)self.metrics.uploadSuccessCount / (double)total;
  } else {
    self.metrics.uploadSuccessRate = 1.0; 
  }
}

- (RJTelemetryMetrics *)currentMetrics {
  RJTelemetryMetrics *snapshot = [[RJTelemetryMetrics alloc] init];
  void (^capture)(void) = ^{
    snapshot.uploadSuccessCount = self.metrics.uploadSuccessCount;
    snapshot.uploadFailureCount = self.metrics.uploadFailureCount;
    snapshot.retryAttemptCount = self.metrics.retryAttemptCount;
    snapshot.circuitBreakerOpenCount = self.metrics.circuitBreakerOpenCount;
    snapshot.memoryEvictionCount = self.metrics.memoryEvictionCount;
    snapshot.offlinePersistCount = self.metrics.offlinePersistCount;
    snapshot.sessionStartCount = self.metrics.sessionStartCount;
    snapshot.crashCount = self.metrics.crashCount;
    snapshot.anrCount = self.metrics.anrCount;
    snapshot.uploadSuccessRate = self.metrics.uploadSuccessRate;
    snapshot.avgUploadDurationMs = self.metrics.avgUploadDurationMs;
    snapshot.currentQueueDepth = self.metrics.currentQueueDepth;
    snapshot.lastUploadTime = self.metrics.lastUploadTime;
    snapshot.lastRetryTime = self.metrics.lastRetryTime;
  };

  if (dispatch_get_specific(kRJTelemetryQueueKey)) {
    capture();
  } else {
    dispatch_sync(self.metricsQueue, capture);
  }

  return snapshot;
}

- (NSDictionary<NSString *, id> *)metricsAsDictionary {
  RJTelemetryMetrics *m = [self currentMetrics];
  __block NSUInteger totalBytesUploaded = 0;
  __block NSUInteger totalBytesEvicted = 0;
  void (^captureTotals)(void) = ^{
    totalBytesUploaded = self.totalBytesUploaded;
    totalBytesEvicted = self.totalBytesEvicted;
  };
  if (dispatch_get_specific(kRJTelemetryQueueKey)) {
    captureTotals();
  } else {
    dispatch_sync(self.metricsQueue, captureTotals);
  }
  return @{
    @"uploadSuccessCount" : @(m.uploadSuccessCount),
    @"uploadFailureCount" : @(m.uploadFailureCount),
    @"retryAttemptCount" : @(m.retryAttemptCount),
    @"circuitBreakerOpenCount" : @(m.circuitBreakerOpenCount),
    @"memoryEvictionCount" : @(m.memoryEvictionCount),
    @"offlinePersistCount" : @(m.offlinePersistCount),
    @"sessionStartCount" : @(m.sessionStartCount),
    @"crashCount" : @(m.crashCount),
    @"anrCount" : @(m.anrCount),
    @"uploadSuccessRate" : @(m.uploadSuccessRate),
    @"avgUploadDurationMs" : @(m.avgUploadDurationMs),
    @"currentQueueDepth" : @(m.currentQueueDepth),
    @"lastUploadTime" : m.lastUploadTime
        ? @([m.lastUploadTime timeIntervalSince1970] * 1000)
        : [NSNull null],
    @"lastRetryTime" : m.lastRetryTime
        ? @([m.lastRetryTime timeIntervalSince1970] * 1000)
        : [NSNull null],
    @"totalBytesUploaded" : @(totalBytesUploaded),
    @"totalBytesEvicted" : @(totalBytesEvicted),
  };
}

- (void)resetMetrics {
  dispatch_async(self.metricsQueue, ^{
    self.metrics.uploadSuccessCount = 0;
    self.metrics.uploadFailureCount = 0;
    self.metrics.retryAttemptCount = 0;
    self.metrics.circuitBreakerOpenCount = 0;
    self.metrics.memoryEvictionCount = 0;
    self.metrics.offlinePersistCount = 0;
    self.metrics.sessionStartCount = 0;
    self.metrics.crashCount = 0;
    self.metrics.anrCount = 0;
    self.metrics.uploadSuccessRate = 1.0;
    self.metrics.avgUploadDurationMs = 0;
    self.metrics.currentQueueDepth = 0;
    self.metrics.lastUploadTime = nil;
    self.metrics.lastRetryTime = nil;
    self.totalUploadCount = 0;
    self.totalUploadDurationMs = 0;
    self.totalBytesUploaded = 0;
    self.totalBytesEvicted = 0;
  });
}

- (void)logCurrentMetrics {
#ifdef DEBUG
  dispatch_async(self.metricsQueue, ^{
    [self logCurrentMetricsInternal];
  });
#endif
}

- (void)logCurrentMetricsInternal {
  RJLogDebug(@"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  RJLogDebug(@" SDK Telemetry Summary");
  RJLogDebug(@"   Uploads: %ld success, %ld failed (%.1f%% success rate)",
             (long)self.metrics.uploadSuccessCount,
             (long)self.metrics.uploadFailureCount,
             self.metrics.uploadSuccessRate * 100);
  RJLogDebug(@"   Avg upload latency: %.1f ms",
             self.metrics.avgUploadDurationMs);
  RJLogDebug(@"   Retries: %ld attempts", (long)self.metrics.retryAttemptCount);
  RJLogDebug(@"   Circuit breaker opens: %ld",
             (long)self.metrics.circuitBreakerOpenCount);
  RJLogDebug(@"   Memory evictions: %ld frames (%.1f KB)",
             (long)self.metrics.memoryEvictionCount,
             self.totalBytesEvicted / 1024.0);
  RJLogDebug(@"   Offline persists: %ld",
             (long)self.metrics.offlinePersistCount);
  RJLogDebug(@"   Data uploaded: %.1f KB", self.totalBytesUploaded / 1024.0);
  RJLogDebug(@"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

@end
