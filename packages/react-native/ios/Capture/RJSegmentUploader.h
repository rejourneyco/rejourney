//
//  RJSegmentUploader.h
//  Rejourney
//
//  Uploads finished video segments to S3/R2 storage.
//  Handles presigned URL requests and direct uploads.
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

/**
 * Completion handler for segment uploads.
 *
 * @param success Whether the upload succeeded.
 * @param error Error if upload failed.
 */
typedef void (^RJSegmentUploadCompletion)(BOOL success, NSError *_Nullable error);

/**
 * Uploads video segments and hierarchy snapshots to cloud storage.
 *
 * Uses the presigned URL flow:
 * 1. Request presigned URL from backend
 * 2. Upload directly to S3/R2
 * 3. Notify backend of completion
 *
 * ## Features
 * - Background upload support
 * - Retry with exponential backoff
 * - Queue management for multiple segments
 * - Automatic cleanup of uploaded files
 *
 * ## Usage
 * ```objc
 * RJSegmentUploader *uploader = [[RJSegmentUploader alloc] initWithBaseURL:@"https://api.rejourney.co"];
 * uploader.apiKey = @"rj_...";
 * uploader.projectId = projectId;
 *
 * [uploader uploadVideoSegment:fileURL
 *                    sessionId:sessionId
 *                    startTime:startTime
 *                      endTime:endTime
 *                   frameCount:frameCount
 *                   completion:^(BOOL success, NSError *error) {
 *     if (success) {
 *         // Clean up local file
 *     }
 * }];
 * ```
 */
@interface RJSegmentUploader : NSObject

#pragma mark - Configuration

/// Base URL for the Rejourney API.
@property (nonatomic, copy) NSString *baseURL;

/// API key (public key rj_...) for authentication.
@property (nonatomic, copy, nullable) NSString *apiKey;

/// Project ID for the current recording session.
@property (nonatomic, copy, nullable) NSString *projectId;

/// Upload token from device auth for authenticated uploads.
@property (nonatomic, copy, nullable) NSString *uploadToken;

/// Maximum number of retry attempts. Default: 3.
@property (nonatomic, assign) NSInteger maxRetries;

/// Whether to delete local files after successful upload. Default: YES.
@property (nonatomic, assign) BOOL deleteAfterUpload;

/// Number of uploads currently in progress.
@property (nonatomic, readonly) NSInteger pendingUploads;

#pragma mark - Initialization

/**
 * Creates a new segment uploader with the specified base URL.
 *
 * @param baseURL The Rejourney API base URL.
 * @return A new uploader instance.
 */
- (instancetype)initWithBaseURL:(NSString *)baseURL;

#pragma mark - Upload Methods

/**
 * Uploads a video segment to cloud storage.
 *
 * @param segmentURL Local file URL of the .mp4 segment.
 * @param sessionId Session identifier.
 * @param startTime Segment start time in epoch milliseconds.
 * @param endTime Segment end time in epoch milliseconds.
 * @param frameCount Number of frames in the segment.
 * @param completion Callback when upload completes or fails.
 */
- (void)uploadVideoSegment:(NSURL *)segmentURL
                 sessionId:(NSString *)sessionId
                 startTime:(NSTimeInterval)startTime
                   endTime:(NSTimeInterval)endTime
                frameCount:(NSInteger)frameCount
                completion:(nullable RJSegmentUploadCompletion)completion;

/**
 * Uploads a view hierarchy snapshot to cloud storage.
 *
 * @param hierarchyData JSON data of the hierarchy snapshot.
 * @param sessionId Session identifier.
 * @param timestamp Snapshot timestamp in epoch milliseconds.
 * @param completion Callback when upload completes or fails.
 */
- (void)uploadHierarchy:(NSData *)hierarchyData
              sessionId:(NSString *)sessionId
              timestamp:(NSTimeInterval)timestamp
             completion:(nullable RJSegmentUploadCompletion)completion;

/**
 * Cancels all pending uploads.
 */
- (void)cancelAllUploads;

/**
 * Cleans up any leftover segment files from previous sessions.
 */
- (void)cleanupOrphanedSegments;

@end

NS_ASSUME_NONNULL_END
