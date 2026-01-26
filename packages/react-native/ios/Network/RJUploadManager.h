//
//  RJUploadManager.h
//  Rejourney
//
//  Session data upload management.
//
//  The upload manager handles batched uploads of session data to the
//  dashboard server, including automatic retry and background task
//  management.
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
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Manages session data uploads to the dashboard server.
 *
 * The upload manager provides:
 * - Batched upload scheduling
 * - Background task management for reliable uploads
 * - Automatic retry on failure
 * - Payload construction with device info
 *
 * ## Usage
 * ```objc
 * RJUploadManager *manager = [[RJUploadManager alloc]
 * initWithApiUrl:@"https://api.rejourney.co"]; manager.sessionId =
 * @"session_123"; manager.userId = @"user_456";
 *
 * [manager startBatchUploadTimer];
 * // ... later ...
 * [manager uploadBatchWithEvents:events isFinal:NO completion:^(BOOL success) {
 *     // Handle result
 * }];
 * ```
 *
 * @note This class is thread-safe for public methods.
 */
@interface RJUploadManager : NSObject

#pragma mark - Configuration

/// API URL for session uploads
@property(nonatomic, copy) NSString *apiUrl;

/// Public route key (pk_live_xxx) for SDK authentication
@property(nonatomic, copy, nullable) NSString *publicKey;

/// Backend project ID (UUID) for attestation/ingest
@property(nonatomic, copy, nullable) NSString *projectId;

/// Current session ID
@property(nonatomic, copy, nullable) NSString *sessionId;

/// Current user ID
@property(nonatomic, copy, nullable) NSString *userId;

/// Device hash for session correlation
@property(nonatomic, copy, nullable) NSString *deviceHash;

/// Session start timestamp
@property(nonatomic, assign) NSTimeInterval sessionStartTime;

/// Total background time in milliseconds (for billing exclusion)
@property(nonatomic, assign) NSTimeInterval totalBackgroundTimeMs;

/// Current batch number
@property(nonatomic, readonly) NSInteger batchNumber;

/// Whether an upload is currently in progress
@property(nonatomic, readonly) BOOL isUploading;

/// Max recording minutes allowed for this project
@property(nonatomic, assign) NSInteger maxRecordingMinutes;

/// Sample rate (0-100) for this project
@property(nonatomic, assign) NSInteger sampleRate;

#pragma mark - Retry & Resilience

/// Number of consecutive upload failures (for circuit breaker)
@property(nonatomic, readonly) NSInteger consecutiveFailureCount;

/// Whether the circuit breaker is currently open (blocking requests)
@property(nonatomic, readonly) BOOL isCircuitOpen;

/**
 * Loads and retries any persisted failed uploads from previous sessions.
 * Call this during session start to recover from server downtime scenarios.
 */
- (void)loadAndRetryPersistedUploads;

/**
 * Persists pending uploads to disk for recovery after app restart.
 * Call this during app termination or background expiration.
 */
- (void)persistPendingUploads;

/**
 * Recovers any crash-persisted pending uploads and closes prior sessions.
 * Safe to call after an upload token is available.
 */
- (void)recoverPendingSessionsWithCompletion:
    (nullable RJCompletionHandler)completion;

#pragma mark - Initialization

/**
 * Creates an upload manager for the specified API URL.
 *
 * @param apiUrl Base URL of the API server.
 * @return A new upload manager instance.
 */
- (instancetype)initWithApiUrl:(NSString *)apiUrl;

/// Unavailable. Use initWithApiUrl: instead.
- (instancetype)init NS_UNAVAILABLE;

#pragma mark - Project Configuration

/**
 * Fetches the project configuration (ID, limits, etc) from the server.
 * This resolves the publicKey to a projectId and gets the recording rules.
 *
 * @param completion Called with success status and configuration dictionary.
 */
- (void)fetchProjectConfigWithCompletion:
    (void (^)(BOOL success, NSDictionary *_Nullable config,
              NSError *_Nullable error))completion;

#pragma mark - Timer Management

/**
 * Starts the batch upload timer.
 * The timer fires every 30 seconds to upload accumulated data.
 */
- (void)startBatchUploadTimer;

/**
 * Stops the batch upload timer.
 */
- (void)stopBatchUploadTimer;

#pragma mark - Upload Methods

/**
 * Uploads a batch of events to the dashboard.
 *
 * @param events Array of event dictionaries.
 * @param isFinal Whether this is the final batch for the session.
 * @param completion Called with upload success status.
 */
- (void)uploadBatchWithEvents:(NSArray<NSDictionary *> *)events
                      isFinal:(BOOL)isFinal
                   completion:(nullable RJCompletionHandler)completion;

/**
 * Performs a synchronous upload for app termination.
 * This is a blocking call that should only be used in willTerminate.
 *
 * @param events Array of event dictionaries.
 * @return Whether the upload succeeded.
 */
- (BOOL)synchronousUploadWithEvents:(NSArray<NSDictionary *> *)events;

/**
 * Persists events to disk for termination, skipping network upload.
 * Use this in appWillTerminate to avoid watchdog kills.
 *
 * @param events Array of event dictionaries.
 */
- (void)persistTerminationEvents:(NSArray<NSDictionary *> *)events;

/**
 * Uploads a crash report to the dashboard.
 *
 * @param report The crash report dictionary.
 * @param completion Called with success status.
 */
- (void)uploadCrashReport:(NSDictionary *)report
               completion:(nullable RJCompletionHandler)completion;

/**
 * Uploads an ANR report to the dashboard.
 *
 * @param report The ANR report dictionary.
 * @param completion Called with success status.
 */
- (void)uploadANRReport:(NSDictionary *)report
             completion:(nullable RJCompletionHandler)completion;

#pragma mark - Background Task Management

/**
 * Begins a background task for upload during app backgrounding.
 *
 * @param name Task name for debugging.
 * @return Background task identifier.
 */
- (UIBackgroundTaskIdentifier)beginBackgroundTaskWithName:(NSString *)name;

/**
 * Ends a background task.
 *
 * @param taskId Task identifier from beginBackgroundTaskWithName:.
 */
- (void)endBackgroundTask:(UIBackgroundTaskIdentifier)taskId;

#pragma mark - Session End

/**
 * Sends a session end signal to the backend synchronously.
 * This updates the session duration and status on the server.
 *
 * @return Whether the request succeeded.
 */
- (BOOL)endSessionSync;

#pragma mark - State Reset

/**
 * Updates the session recovery metadata with current timestamp.
 * Call after successful uploads to ensure proper endedAt on recovery.
 */
- (void)updateSessionRecoveryMeta;

/**
 * Resets the upload manager for a new session.
 */
- (void)resetForNewSession;

/**
 * Shuts down the upload manager, cancelling any active uploads.
 * Call this during module deallocation.
 */
- (void)shutdown;

#pragma mark - Replay Promotion

/// Whether this session has been promoted for replay upload.
/// Set by evaluateReplayPromotionWithMetrics:completion:.
@property(nonatomic, readonly) BOOL isReplayPromoted;

/**
 * Evaluates whether the session should be promoted for replay upload.
 * Call this at session end.
 *
 * @param metrics Session metrics (crashCount, anrCount, errorCount, etc.)
 * @param completion Called with promotion status and reason.
 */
- (void)evaluateReplayPromotionWithMetrics:(NSDictionary *)metrics
                                completion:
                                    (void (^)(BOOL promoted,
                                              NSString *reason))completion;

@end

NS_ASSUME_NONNULL_END
