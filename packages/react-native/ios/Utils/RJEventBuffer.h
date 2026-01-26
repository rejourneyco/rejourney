//
//  RJEventBuffer.h
//  Rejourney
//
//  Write-first event buffer that persists events to disk immediately.
//  Industry-standard approach: events are never lost even on force-kill.
//
//  Copyright (c) 2026 Rejourney
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Write-first event buffer for crash-safe event persistence.
 *
 * Events are written to disk immediately when logged, ensuring no data loss
 * even if the app is force-killed. Events are read back for upload on next
 * app launch if not uploaded during the session.
 *
 * File format: JSONL (one JSON object per line) for efficient append
 * operations.
 */
@interface RJEventBuffer : NSObject

/// Session ID this buffer is associated with
@property(nonatomic, copy, readonly) NSString *sessionId;

/// Base directory for pending session data
@property(nonatomic, copy, readonly) NSString *pendingRootPath;

/// Number of events currently buffered on disk
@property(nonatomic, readonly) NSInteger eventCount;

/// Timestamp of the last event written (milliseconds since epoch)
@property(nonatomic, readonly) NSTimeInterval lastEventTimestamp;

#pragma mark - Initialization

/**
 * Creates an event buffer for the specified session.
 *
 * @param sessionId The session ID to buffer events for.
 * @param pendingRootPath Base directory for pending session data.
 * @return A new event buffer instance.
 */
- (instancetype)initWithSessionId:(NSString *)sessionId
                  pendingRootPath:(NSString *)pendingRootPath;

/// Unavailable. Use initWithSessionId:pendingRootPath: instead.
- (instancetype)init NS_UNAVAILABLE;

#pragma mark - Event Operations

/**
 * Appends an event to the buffer, writing immediately to disk.
 * This operation is synchronous and thread-safe.
 *
 * @param event The event dictionary to persist.
 * @return YES if the event was successfully written, NO otherwise.
 */
- (BOOL)appendEvent:(NSDictionary *)event;

/**
 * Appends multiple events to the buffer atomically.
 *
 * @param events Array of event dictionaries to persist.
 * @return YES if all events were successfully written, NO otherwise.
 */
- (BOOL)appendEvents:(NSArray<NSDictionary *> *)events;

/**
 * Reads all buffered events from disk.
 * Used for upload or recovery.
 *
 * @return Array of event dictionaries, or empty array if no events.
 */
- (NSArray<NSDictionary *> *)readAllEvents;

/**
 * Reads events that haven't been uploaded yet (after the given batch number).
 *
 * @param afterBatchNumber Only return events logged after this batch was
 * uploaded.
 * @return Array of event dictionaries.
 */
- (NSArray<NSDictionary *> *)readEventsAfterBatchNumber:
    (NSInteger)afterBatchNumber;

/**
 * Marks events up to the given index as uploaded.
 * This allows incremental uploads without losing state.
 *
 * @param eventIndex The index of the last successfully uploaded event.
 */
- (void)markEventsUploadedUpToIndex:(NSInteger)eventIndex;

/**
 * Clears all buffered events from disk.
 * Call after session is successfully closed.
 */
- (void)clearAllEvents;

/**
 * Returns the timestamp of the last event, useful for session end time.
 */
- (NSTimeInterval)lastEventTimestampMs;

@end

NS_ASSUME_NONNULL_END
