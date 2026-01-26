//
//  RJRetryManager.h
//  Rejourney
//
//  Retry queue and circuit breaker for upload resilience.
//
//  Copyright (c) 2026 Rejourney
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Completion handler for retry operations
typedef void (^RJRetryCompletionHandler)(BOOL success);

/// Block type for performing the actual upload
typedef BOOL (^RJUploadBlock)(NSArray<NSDictionary *> *events);

/**
 * Manages upload retry queue with exponential backoff and circuit breaker.
 */
@interface RJRetryManager : NSObject

/// Whether the circuit breaker is currently open (blocking requests)
@property(nonatomic, readonly) BOOL isCircuitOpen;

/// Number of consecutive upload failures
@property(nonatomic, readonly) NSInteger consecutiveFailureCount;

/// Whether manager is shutting down
@property(nonatomic, assign) BOOL isShuttingDown;

/// Block to perform actual upload (set by owner)
@property(nonatomic, copy, nullable) RJUploadBlock uploadBlock;

/**
 * Add a failed batch to the retry queue.
 *
 * @param events Array of event dictionaries
 */
- (void)addToRetryQueueWithEvents:(NSArray<NSDictionary *> *)events;

/**
 * Record a successful upload (resets failure count, closes circuit).
 */
- (void)recordUploadSuccess;

/**
 * Record a failed upload (increments failure count, may open circuit).
 */
- (void)recordUploadFailure;

/**
 * Persist pending uploads to disk for later retry.
 */
- (void)persistPendingUploads;

/**
 * Load persisted failed uploads and queue them for retry.
 */
- (void)loadAndRetryPersistedUploads;

/**
 * Check if circuit breaker should block requests.
 *
 * @return YES if requests should proceed, NO if blocked by circuit breaker.
 */
- (BOOL)shouldAllowRequest;

@end

NS_ASSUME_NONNULL_END
