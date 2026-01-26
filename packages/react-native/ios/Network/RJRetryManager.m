//
//  RJRetryManager.m
//  Rejourney
//
//  Retry queue and circuit breaker for upload resilience implementation.
//
//  Copyright (c) 2026 Rejourney
//

#import "RJRetryManager.h"
#import "../Core/RJLogger.h"
#import "../Utils/RJTelemetry.h"

static const NSInteger kCircuitBreakerThreshold = 5; 
static const NSTimeInterval kCircuitBreakerTimeout = 60.0; 
static const NSTimeInterval kMaxRetryDelay = 60.0;         

#pragma mark - Private Interface

@interface RJRetryManager ()

@property(nonatomic, strong) dispatch_queue_t retryQueue;

@property(nonatomic, strong) NSMutableArray<NSDictionary *> *pendingRetries;

@property(nonatomic, assign) BOOL isRetryScheduled;

@property(nonatomic, assign) NSTimeInterval circuitOpenedTime;

@property(nonatomic, assign) BOOL circuitOpen;

@property(nonatomic, assign) NSInteger failureCount;

@end

#pragma mark - Implementation

@implementation RJRetryManager

#pragma mark - Initialization

- (instancetype)init {
  self = [super init];
  if (self) {
    _retryQueue =
        dispatch_queue_create("com.rejourney.retry", DISPATCH_QUEUE_SERIAL);
    _pendingRetries = [NSMutableArray new];
    _isRetryScheduled = NO;
    _circuitOpen = NO;
    _circuitOpenedTime = 0;
    _failureCount = 0;
    _isShuttingDown = NO;
  }
  return self;
}

#pragma mark - Public Properties

- (BOOL)isCircuitOpen {
  return _circuitOpen;
}

- (NSInteger)consecutiveFailureCount {
  return _failureCount;
}

#pragma mark - Circuit Breaker

- (BOOL)shouldAllowRequest {
  if (!self.circuitOpen) {
    return YES;
  }

  NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
  if (now - self.circuitOpenedTime >= kCircuitBreakerTimeout) {
    
    RJLogDebug(@"Circuit breaker entering half-open state");
    self.circuitOpen = NO;
    return YES;
  }

  RJLogDebug(@"Circuit breaker open, waiting %.0fs before retry",
             kCircuitBreakerTimeout - (now - self.circuitOpenedTime));
  return NO;
}

- (void)recordUploadSuccess {
  self.failureCount = 0;
  [[RJTelemetry sharedInstance] recordEvent:RJTelemetryEventUploadSuccess];
  if (self.circuitOpen) {
    RJLogDebug(@"Upload succeeded, closing circuit breaker");
    self.circuitOpen = NO;
    [[RJTelemetry sharedInstance]
        recordEvent:RJTelemetryEventCircuitBreakerClose];
  }
}

- (void)recordUploadFailure {
  self.failureCount++;
  [[RJTelemetry sharedInstance] recordEvent:RJTelemetryEventUploadFailure];
  if (self.failureCount >= kCircuitBreakerThreshold && !self.circuitOpen) {
    self.circuitOpen = YES;
    self.circuitOpenedTime = [[NSDate date] timeIntervalSince1970];
    [[RJTelemetry sharedInstance]
        recordEvent:RJTelemetryEventCircuitBreakerOpen];
    RJLogWarning(@"Circuit breaker opened after %ld consecutive failures",
                 (long)self.failureCount);
  }
}

#pragma mark - Retry Queue

- (void)addToRetryQueueWithEvents:(NSArray<NSDictionary *> *)events {
  if (self.isShuttingDown)
    return;

  dispatch_async(self.retryQueue, ^{
    @try {
      NSDictionary *retryItem = @{
        @"events" : events ?: @[],
        @"timestamp" : @([[NSDate date] timeIntervalSince1970]),
        @"attemptCount" : @0
      };

      [self.pendingRetries addObject:retryItem];
      RJLogDebug(@"Added batch to retry queue (queue size: %lu)",
                 (unsigned long)self.pendingRetries.count);

      [self scheduleRetryIfNeeded];
    } @catch (NSException *exception) {
      RJLogWarning(@"Add to retry queue exception: %@", exception);
    }
  });
}

- (void)scheduleRetryIfNeeded {
  
  if (self.isRetryScheduled || self.pendingRetries.count == 0 ||
      self.isShuttingDown) {
    return;
  }

  if (![self shouldAllowRequest]) {
    return;
  }

  self.isRetryScheduled = YES;

  
  NSTimeInterval delay = MIN(pow(2.0, self.failureCount), kMaxRetryDelay);

  RJLogDebug(@"Scheduling retry in %.1fs (consecutive failures: %ld)", delay,
             (long)self.failureCount);

  __weak typeof(self) weakSelf = self;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)),
      self.retryQueue, ^{
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf || strongSelf.isShuttingDown)
          return;

        strongSelf.isRetryScheduled = NO;
        [strongSelf processRetryQueue];
      });
}

- (void)processRetryQueue {
  
  if (self.pendingRetries.count == 0 || self.isShuttingDown) {
    return;
  }

  if (!self.uploadBlock) {
    RJLogWarning(@"No upload block set, cannot process retry queue");
    return;
  }

  
  NSDictionary *item = self.pendingRetries.firstObject;
  NSArray *events = item[@"events"];
  NSInteger attemptCount = [item[@"attemptCount"] integerValue];

  
  [self.pendingRetries removeObjectAtIndex:0];

  RJLogDebug(@"Retrying batch (attempt %ld, remaining: %lu)",
             (long)(attemptCount + 1),
             (unsigned long)self.pendingRetries.count);

  __weak typeof(self) weakSelf = self;
  dispatch_async(self.retryQueue, ^{
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (!strongSelf)
      return;

    BOOL success = NO;
    @try {
      success = strongSelf.uploadBlock(events);
    } @catch (NSException *exception) {
      RJLogWarning(@"Retry upload exception: %@", exception);
      success = NO;
    }

    dispatch_async(dispatch_get_main_queue(), ^{
      if (success) {
        
        [strongSelf recordUploadSuccess];
        RJLogDebug(@"Retry upload succeeded");

        
        if (strongSelf.pendingRetries.count > 0) {
          dispatch_async(strongSelf.retryQueue, ^{
            [strongSelf scheduleRetryIfNeeded];
          });
        }
      } else {
        
        [strongSelf recordUploadFailure];

        
        if (attemptCount < 5) {
          NSMutableDictionary *updatedItem = [item mutableCopy];
          updatedItem[@"attemptCount"] = @(attemptCount + 1);
          dispatch_async(strongSelf.retryQueue, ^{
            [strongSelf.pendingRetries addObject:updatedItem];
            RJLogDebug(@"Re-queued failed batch (attempt %ld)",
                       (long)(attemptCount + 1));
            [strongSelf scheduleRetryIfNeeded];
          });
        } else {
          RJLogWarning(@"Batch exceeded max retries, discarding");
          dispatch_async(strongSelf.retryQueue, ^{
            [strongSelf scheduleRetryIfNeeded];
          });
        }
      }
    });
  });
}

#pragma mark - Persistence

- (NSString *)failedUploadsPath {
  NSArray *paths = NSSearchPathForDirectoriesInDomains(NSCachesDirectory,
                                                       NSUserDomainMask, YES);
  NSString *cacheDir = paths.firstObject;
  return [cacheDir stringByAppendingPathComponent:@"rj_failed_uploads.plist"];
}

- (void)persistPendingUploads {
  dispatch_async(self.retryQueue, ^{
    @try {
      if (self.pendingRetries.count == 0) {
        return;
      }

      NSString *path = [self failedUploadsPath];

      
      NSMutableArray *allPending = [NSMutableArray array];
      if ([[NSFileManager defaultManager] fileExistsAtPath:path]) {
        NSArray *existing = [NSArray arrayWithContentsOfFile:path];
        if (existing) {
          [allPending addObjectsFromArray:existing];
        }
      }

      
      [allPending addObjectsFromArray:self.pendingRetries];

      
      if (allPending.count > 100) {
        allPending = [[allPending
            subarrayWithRange:NSMakeRange(allPending.count - 100, 100)]
            mutableCopy];
      }

      
      BOOL success = [allPending writeToFile:path atomically:YES];
      if (success) {
        RJLogDebug(@"Persisted %lu failed uploads to disk",
                   (unsigned long)allPending.count);
        [self.pendingRetries removeAllObjects];
      } else {
        RJLogWarning(@"Failed to persist uploads to disk");
      }
    } @catch (NSException *exception) {
      RJLogWarning(@"Persist uploads exception: %@", exception);
    }
  });
}

- (void)loadAndRetryPersistedUploads {
  dispatch_async(self.retryQueue, ^{
    @try {
      NSString *path = [self failedUploadsPath];

      if (![[NSFileManager defaultManager] fileExistsAtPath:path]) {
        return;
      }

      NSArray *persisted = [NSArray arrayWithContentsOfFile:path];
      if (!persisted || persisted.count == 0) {
        return;
      }

      RJLogDebug(@"Found %lu persisted failed uploads, queuing for retry",
                 (unsigned long)persisted.count);

      
      [[NSFileManager defaultManager] removeItemAtPath:path error:nil];

      
      [self.pendingRetries addObjectsFromArray:persisted];

      
      [self scheduleRetryIfNeeded];
    } @catch (NSException *exception) {
      RJLogWarning(@"Load persisted uploads exception: %@", exception);
    }
  });
}

@end
