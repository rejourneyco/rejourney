//
//  RJSegmentUploader.m
//  Rejourney
//
//  Video segment uploader implementation.
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

#import "RJSegmentUploader.h"
#import "../Core/RJLogger.h"
#import "../Network/RJDeviceAuthManager.h"

#import <UIKit/UIKit.h>
#import <zlib.h>

@interface RJSegmentUploader () <NSURLSessionDelegate>

@property(nonatomic, strong) NSURLSession *session;

@property(nonatomic, strong) NSOperationQueue *uploadQueue;

@property(atomic, assign) NSInteger pendingUploadCount;

- (void)notifySegmentCompleteWithSegmentId:(NSString *)segmentId
                                 sessionId:(NSString *)sessionId
                                 startTime:(NSTimeInterval)startTime
                                   endTime:(NSTimeInterval)endTime
                                frameCount:(NSInteger)frameCount
                                   attempt:(NSInteger)attempt
                                completion:(void (^)(BOOL, NSError *))completion;

@end

@implementation RJSegmentUploader

#pragma mark - Initialization

- (instancetype)initWithBaseURL:(NSString *)baseURL {
  self = [super init];
  if (self) {
    _baseURL = [baseURL copy];
    _maxRetries = 3;
    _deleteAfterUpload = YES;
    _pendingUploadCount = 0;

    NSURLSessionConfiguration *config =
        [NSURLSessionConfiguration defaultSessionConfiguration];
    config.timeoutIntervalForRequest = 60;
    config.timeoutIntervalForResource = 300;
    config.waitsForConnectivity = YES;

    _uploadQueue = [[NSOperationQueue alloc] init];
    _uploadQueue.maxConcurrentOperationCount = 2;
    _uploadQueue.qualityOfService = NSQualityOfServiceBackground;

    _session = [NSURLSession sessionWithConfiguration:config
                                             delegate:self
                                        delegateQueue:_uploadQueue];

    // Clean up any orphaned segments from previous app runs
    [self cleanupOrphanedSegments];
  }
  return self;
}

- (void)dealloc {
  [self.session invalidateAndCancel];
}

#pragma mark - Properties

- (NSInteger)pendingUploads {
  return self.pendingUploadCount;
}

#pragma mark - Upload Methods

- (void)uploadVideoSegment:(NSURL *)segmentURL
                 sessionId:(NSString *)sessionId
                 startTime:(NSTimeInterval)startTime
                   endTime:(NSTimeInterval)endTime
                frameCount:(NSInteger)frameCount
                completion:(RJSegmentUploadCompletion)completion {

  // Start background task
  __block UIBackgroundTaskIdentifier bgTask = [[UIApplication sharedApplication]
      beginBackgroundTaskWithName:@"RJVideoUpload"
                expirationHandler:^{
                  RJLogWarning(@"Background task for video upload expired!");
                  [[UIApplication sharedApplication] endBackgroundTask:bgTask];
                  bgTask = UIBackgroundTaskInvalid;
                }];

  // Helper to end background task safely
  void (^endBackgroundTask)(void) = ^{
    if (bgTask != UIBackgroundTaskInvalid) {
      [[UIApplication sharedApplication] endBackgroundTask:bgTask];
      bgTask = UIBackgroundTaskInvalid;
    }
  };

  RJLogInfo(@"[RJ-UPLOAD] uploadVideoSegment called: %@, sessionId=%@, frames=%ld",
        segmentURL.lastPathComponent, sessionId, (long)frameCount);
  RJLogInfo(@"[RJ-UPLOAD] apiKey=%@, projectId=%@, baseURL=%@",
        self.apiKey ? @"<set>" : @"<nil>", self.projectId, self.baseURL);

  if (!self.apiKey || !self.projectId) {
    RJLogInfo(@"[RJ-UPLOAD] ERROR: Missing apiKey or projectId!");
    RJLogError(@"Segment uploader: Missing apiKey or projectId");
    if (completion) {
      completion(NO, [self errorWithMessage:@"Missing configuration"]);
    }
    endBackgroundTask();
    return;
  }

  if (![[NSFileManager defaultManager] fileExistsAtPath:segmentURL.path]) {
    RJLogInfo(@"[RJ-UPLOAD] ERROR: File not found at %@", segmentURL.path);
    RJLogError(@"Segment uploader: File not found at %@", segmentURL.path);
    if (completion) {
      completion(NO, [self errorWithMessage:@"File not found"]);
    }
    endBackgroundTask();
    return;
  }

  // CRITICAL: Read file data SYNCHRONOUSLY before any async operations.
  // During app termination, the file may be deleted between getting the
  // presigned URL and the actual S3 upload. By reading upfront, we ensure the
  // data is in memory.
  NSData *fileData = [NSData dataWithContentsOfURL:segmentURL];
  if (!fileData || fileData.length == 0) {
    RJLogInfo(@"[RJ-UPLOAD] ERROR: Failed to read file data from %@",
          segmentURL.path);
    RJLogError(@"Segment uploader: Failed to read file data");
    if (completion) {
      completion(NO, [self errorWithMessage:@"Failed to read file data"]);
    }
    endBackgroundTask();
    return;
  }

  RJLogInfo(@"[RJ-UPLOAD] Read %lu bytes from file into memory",
        (unsigned long)fileData.length);

  self.pendingUploadCount++;

  RJLogInfo(@"[RJ-UPLOAD] Requesting presigned URL for segment");
  RJLogInfo(@"Segment uploader: Uploading segment %@ (%ld frames)",
            segmentURL.lastPathComponent, (long)frameCount);

  [self
      requestPresignedURLForSession:sessionId
                               kind:@"video"
                          sizeBytes:fileData.length
                          startTime:startTime
                            endTime:endTime
                         frameCount:frameCount
                        compression:nil
                         completion:^(NSDictionary *presignInfo, NSError *error) {
                           if (error || !presignInfo) {
                             self.pendingUploadCount--;
                             RJLogInfo(@"[RJ-UPLOAD] ERROR: Failed to get "
                                   @"presigned URL: %@",
                                   error);
                             RJLogError(@"Segment uploader: Failed to get "
                                        @"presigned URL: %@",
                                        error);
                             if (completion) {
                               completion(NO, error);
                             }
                             endBackgroundTask();
                             return;
                           }

                           RJLogInfo(@"[RJ-UPLOAD] Got presignInfo: %@",
                                 presignInfo);

                           NSString *presignedUrl =
                               presignInfo[@"presignedUrl"];
                           NSString *segmentId = presignInfo[@"segmentId"];
                           NSString *s3Key = presignInfo[@"s3Key"];

                           if (!presignedUrl) {
                             self.pendingUploadCount--;
                             RJLogInfo(@"[RJ-UPLOAD] ERROR: No presigned URL in "
                                   @"response");
                             RJLogError(@"Segment uploader: No presigned URL "
                                        @"in response");
                             if (completion) {
                               completion(
                                   NO,
                                   [self errorWithMessage:@"No presigned URL"]);
                             }
                             endBackgroundTask();
                             return;
                           }

                           RJLogInfo(@"[RJ-UPLOAD] Uploading to S3: %@, segmentId: "
                                 @"%@",
                                 presignedUrl, segmentId);

                           // Use uploadDataToS3 with pre-read data instead of
                           // uploadFileToS3 to avoid file-not-found errors
                           // during app termination
                           [self
                               uploadDataToS3:fileData
                                 presignedURL:presignedUrl
                                  contentType:@"video/mp4"
                                      attempt:1
                                   completion:^(BOOL success, NSError *uploadError) {
                                     if (!success) {
                                       self.pendingUploadCount--;
                                       RJLogInfo(@"[RJ-UPLOAD] ERROR: S3 upload failed: %@", uploadError);
                                       RJLogError(@"Segment uploader: S3 "
                                                  @"upload failed: %@",
                                                  uploadError);
                                       if (completion) {
                                         completion(NO, uploadError);
                                       }
                                       endBackgroundTask();
                                       return;
                                     }

                                     RJLogInfo(@"[RJ-UPLOAD] S3 upload SUCCESS, "
                                           @"calling segment/complete with "
                                           @"segmentId: %@",
                                           segmentId);

                                     [self
                                         notifySegmentCompleteWithSegmentId:
                                             segmentId
                                                                  sessionId:
                                                                      sessionId
                                                                  startTime:
                                                                      startTime
                                                                    endTime:
                                                                        endTime
                                                                 frameCount:
                                                                     frameCount
                                                                 completion:^(BOOL notifySuccess, NSError *notifyError) {
                                                                   self.pendingUploadCount--;

                                                                   if (notifySuccess) {
                                                                     if (self.deleteAfterUpload) {
                                                                       [[NSFileManager defaultManager] removeItemAtURL:segmentURL error:nil];
                                                                     }
                                                                   } else {
                                                                     RJLogWarning(@"Segment uploader: Completion notification failed: %@", notifyError);
                                                                   }

                                                                   if (completion) {
                                                                     completion(
                                                                         notifySuccess,
                                                                         notifyError);
                                                                   }
                                                                   endBackgroundTask();
                                                                 }];
                                   }];
                         }];
}

- (void)uploadHierarchy:(NSData *)hierarchyData
              sessionId:(NSString *)sessionId
              timestamp:(NSTimeInterval)timestamp
             completion:(RJSegmentUploadCompletion)completion {

  // Start background task
  __block UIBackgroundTaskIdentifier bgTask = [[UIApplication sharedApplication]
      beginBackgroundTaskWithName:@"RJHierarchyUpload"
                expirationHandler:^{
                  RJLogWarning(
                      @"Background task for hierarchy upload expired!");
                  [[UIApplication sharedApplication] endBackgroundTask:bgTask];
                  bgTask = UIBackgroundTaskInvalid;
                }];

  // Helper to end background task safely
  void (^endBackgroundTask)(void) = ^{
    if (bgTask != UIBackgroundTaskInvalid) {
      [[UIApplication sharedApplication] endBackgroundTask:bgTask];
      bgTask = UIBackgroundTaskInvalid;
    }
  };

  if (!self.apiKey || !self.projectId) {
    if (completion) {
      completion(NO, [self errorWithMessage:@"Missing configuration"]);
    }
    endBackgroundTask();
    return;
  }

  // Compress data
  NSData *compressedData = [self gzipData:hierarchyData];
  if (!compressedData) {
    if (completion) {
      completion(NO,
                 [self errorWithMessage:@"Failed to compress hierarchy data"]);
    }
    endBackgroundTask();
    return;
  }

  self.pendingUploadCount++;

  [self
      requestPresignedURLForSession:sessionId
                               kind:@"hierarchy"
                          sizeBytes:compressedData.length
                          startTime:timestamp
                            endTime:timestamp
                         frameCount:0
                        compression:@"gzip"
                         completion:^(NSDictionary *presignInfo, NSError *error) {
                           if (error || !presignInfo[@"presignedUrl"]) {
                             self.pendingUploadCount--;
                             if (completion) {
                               completion(NO, error);
                             }
                             endBackgroundTask();
                             return;
                           }

                           NSString *segmentId = presignInfo[@"segmentId"];

                           [self
                               uploadDataToS3:compressedData
                                 presignedURL:presignInfo[@"presignedUrl"]
                                  contentType:@"application/gzip"
                                      attempt:1
                                   completion:^(BOOL success, NSError *uploadError) {
                                     if (!success) {
                                       self.pendingUploadCount--;
                                       if (completion) {
                                         completion(NO, uploadError);
                                       }
                                       endBackgroundTask();
                                       return;
                                     }

                                     [self
                                         notifySegmentCompleteWithSegmentId:
                                             segmentId
                                                                  sessionId:
                                                                      sessionId
                                                                  startTime:
                                                                      timestamp
                                                                    endTime:
                                                                        timestamp
                                                                 frameCount:0
                                                                 completion:^(BOOL notifySuccess, NSError *notifyError) {
                                                                   self.pendingUploadCount--;

                                                                   if (notifySuccess) {
                                                                     RJLogDebug(@"Segment uploader: Hierarchy uploaded for timestamp %.0f", timestamp);
                                                                   }

                                                                   if (completion) {
                                                                     completion(
                                                                         notifySuccess,
                                                                         notifyError);
                                                                   }
                                                                   endBackgroundTask();
                                                                 }];
                                   }];
                         }];
}

- (NSData *)gzipData:(NSData *)inputData {
  if (inputData.length == 0)
    return inputData;

  z_stream zStream;
  bzero(&zStream, sizeof(z_stream));

  zStream.zalloc = Z_NULL;
  zStream.zfree = Z_NULL;
  zStream.opaque = Z_NULL;
  zStream.next_in = (Bytef *)inputData.bytes;
  zStream.avail_in = (uInt)inputData.length;
  zStream.total_out = 0;

  // deflateInit2(stream, level, method, windowBits, memLevel, strategy)
  // windowBits + 16 enables gzip header/trailer
  if (deflateInit2(&zStream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 15 + 16, 8,
                   Z_DEFAULT_STRATEGY) != Z_OK) {
    return nil;
  }

  // 16KB chunk size
  NSMutableData *compressedData = [NSMutableData dataWithLength:16384];

  do {
    if (zStream.total_out >= compressedData.length) {
      [compressedData increaseLengthBy:16384];
    }

    zStream.next_out = (Bytef *)compressedData.mutableBytes + zStream.total_out;
    zStream.avail_out = (uInt)(compressedData.length - zStream.total_out);

    int status = deflate(&zStream, Z_FINISH);

    if (status == Z_STREAM_END) {
      break;
    } else if (status != Z_OK) {
      deflateEnd(&zStream);
      return nil;
    }

  } while (zStream.avail_out == 0);

  deflateEnd(&zStream);
  [compressedData setLength:zStream.total_out];

  return compressedData;
}

- (void)cancelAllUploads {
  [self.session getAllTasksWithCompletionHandler:^(
                    NSArray<__kindof NSURLSessionTask *> *tasks) {
    for (NSURLSessionTask *task in tasks) {
      [task cancel];
    }
  }];
  self.pendingUploadCount = 0;
}

- (void)cleanupOrphanedSegments {
  NSURL *tempDir = [[NSURL fileURLWithPath:NSTemporaryDirectory()]
      URLByAppendingPathComponent:@"rj_segments"
                      isDirectory:YES];

  NSArray *contents = [[NSFileManager defaultManager]
        contentsOfDirectoryAtURL:tempDir
      includingPropertiesForKeys:@[ NSURLCreationDateKey ]
                         options:0
                           error:nil];

  if (!contents || contents.count == 0)
    return;

  NSDate *cutoff = [NSDate dateWithTimeIntervalSinceNow:-3600];

  for (NSURL *fileURL in contents) {
    NSDictionary *attrs =
        [[NSFileManager defaultManager] attributesOfItemAtPath:fileURL.path
                                                         error:nil];
    NSDate *creationDate = attrs[NSFileCreationDate];

    if (creationDate && [creationDate compare:cutoff] == NSOrderedAscending) {
      [[NSFileManager defaultManager] removeItemAtURL:fileURL error:nil];
      RJLogDebug(@"Segment uploader: Cleaned up orphaned segment %@",
                 fileURL.lastPathComponent);
    }
  }
}

#pragma mark - Private Methods

- (void)requestPresignedURLForSession:(NSString *)sessionId
                                 kind:(NSString *)kind
                            sizeBytes:(NSUInteger)sizeBytes
                            startTime:(NSTimeInterval)startTime
                              endTime:(NSTimeInterval)endTime
                           frameCount:(NSInteger)frameCount
                          compression:(NSString *)compression
                           completion:
                               (void (^)(NSDictionary *, NSError *))completion {

  NSString *urlString = [NSString
      stringWithFormat:@"%@/api/ingest/segment/presign", self.baseURL];
  NSURL *url = [NSURL URLWithString:urlString];

  RJLogInfo(@"[RJ-UPLOAD] Requesting presigned URL: %@", urlString);

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  request.HTTPMethod = @"POST";
  [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];

  RJDeviceAuthManager *deviceAuth = [RJDeviceAuthManager sharedManager];
  NSString *currentUploadToken = [deviceAuth currentUploadToken];

  if (currentUploadToken.length > 0 && self.apiKey.length > 0) {
    [request setValue:currentUploadToken forHTTPHeaderField:@"x-upload-token"];
    [request setValue:self.apiKey forHTTPHeaderField:@"x-rejourney-key"];
    RJLogInfo(@"[RJ-UPLOAD] Using device auth: uploadToken=<set>, publicKey=%@",
          [self.apiKey substringToIndex:MIN(12, self.apiKey.length)]);
  } else if (self.uploadToken.length > 0 && self.apiKey.length > 0) {

    [request setValue:self.uploadToken forHTTPHeaderField:@"x-upload-token"];
    [request setValue:self.apiKey forHTTPHeaderField:@"x-rejourney-key"];
    RJLogInfo(@"[RJ-UPLOAD] Using stored upload token: publicKey=%@",
          [self.apiKey substringToIndex:MIN(12, self.apiKey.length)]);
  } else {

    [request setValue:self.apiKey forHTTPHeaderField:@"x-api-key"];
    RJLogInfo(@"[RJ-UPLOAD] WARNING: No upload token, using API key (may fail): "
          @"apiKey=%@",
          [self.apiKey substringToIndex:MIN(12, self.apiKey.length)]);
  }

  NSMutableDictionary *body = [NSMutableDictionary dictionaryWithDictionary:@{
    @"sessionId" : sessionId,
    @"kind" : kind,
    @"sizeBytes" : @(sizeBytes),
    @"startTime" : @(startTime),
    @"endTime" : @(endTime),
    @"frameCount" : @(frameCount),
  }];

  if (compression) {
    body[@"compression"] = compression;
  }

  RJLogInfo(@"[RJ-UPLOAD] Request body: %@", body);

  request.HTTPBody = [NSJSONSerialization dataWithJSONObject:body
                                                     options:0
                                                       error:nil];

  NSURLSessionDataTask *task = [self.session
      dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response,
                            NSError *error) {
          if (error) {
            RJLogInfo(@"[RJ-UPLOAD] Presign request error: %@", error);
            completion(nil, error);
            return;
          }

          NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;
          RJLogInfo(@"[RJ-UPLOAD] Presign response status: %ld",
                (long)httpResponse.statusCode);

          if (httpResponse.statusCode >= 400) {
            NSString *responseBody =
                [[NSString alloc] initWithData:data
                                      encoding:NSUTF8StringEncoding];
            RJLogInfo(@"[RJ-UPLOAD] Presign error response (HTTP %ld): %@",
                  (long)httpResponse.statusCode, responseBody);

            // Log headers to see if we're missing CORS or Auth headers
            RJLogInfo(@"[RJ-UPLOAD] Response Headers: %@",
                  httpResponse.allHeaderFields);

            completion(
                nil,
                [self errorWithMessage:[NSString
                                           stringWithFormat:@"HTTP %ld: %@",
                                                            (long)httpResponse
                                                                .statusCode,
                                                            responseBody]]);
            return;
          }

          NSDictionary *json = [NSJSONSerialization JSONObjectWithData:data
                                                               options:0
                                                                 error:nil];
          RJLogInfo(@"[RJ-UPLOAD] Presign success: s3Key=%@", json[@"s3Key"]);
          completion(json, nil);
        }];

  [task resume];
}

- (void)uploadFileToS3:(NSURL *)fileURL
          presignedURL:(NSString *)presignedURL
           contentType:(NSString *)contentType
               attempt:(NSInteger)attempt
            completion:(void (^)(BOOL, NSError *))completion {

  NSData *fileData = [NSData dataWithContentsOfURL:fileURL];
  if (!fileData) {
    completion(NO, [self errorWithMessage:@"Failed to read file"]);
    return;
  }

  [self uploadDataToS3:fileData
          presignedURL:presignedURL
           contentType:contentType
               attempt:attempt
            completion:completion];
}

- (void)uploadDataToS3:(NSData *)data
          presignedURL:(NSString *)presignedURL
           contentType:(NSString *)contentType
               attempt:(NSInteger)attempt
            completion:(void (^)(BOOL, NSError *))completion {

  NSURL *url = [NSURL URLWithString:presignedURL];
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  request.HTTPMethod = @"PUT";
  request.HTTPBody = data;
  [request setValue:contentType forHTTPHeaderField:@"Content-Type"];
  [request setValue:[@(data.length) stringValue]
      forHTTPHeaderField:@"Content-Length"];

  NSURLSessionDataTask *task = [self.session
      dataTaskWithRequest:request
        completionHandler:^(NSData *responseData, NSURLResponse *response,
                            NSError *error) {
          NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;

          if (error || httpResponse.statusCode >= 400) {

            if (attempt < self.maxRetries) {
              NSTimeInterval delay = pow(2, attempt);
              dispatch_after(dispatch_time(DISPATCH_TIME_NOW,
                                           (int64_t)(delay * NSEC_PER_SEC)),
                             dispatch_get_global_queue(QOS_CLASS_BACKGROUND, 0),
                             ^{
                               [self uploadDataToS3:data
                                       presignedURL:presignedURL
                                        contentType:contentType
                                            attempt:attempt + 1
                                         completion:completion];
                             });
            } else {
              completion(
                  NO,
                  error
                      ?: [self
                             errorWithMessage:
                                 [NSString
                                     stringWithFormat:@"S3 upload failed: %ld",
                                                      (long)httpResponse
                                                          .statusCode]]);
            }
            return;
          }

          completion(YES, nil);
        }];

  [task resume];
}

- (void)notifySegmentCompleteWithSegmentId:(NSString *)segmentId
                                 sessionId:(NSString *)sessionId
                                 startTime:(NSTimeInterval)startTime
                                   endTime:(NSTimeInterval)endTime
                                frameCount:(NSInteger)frameCount
                                completion:
                                    (void (^)(BOOL, NSError *))completion {
  [self notifySegmentCompleteWithSegmentId:segmentId
                                 sessionId:sessionId
                                 startTime:startTime
                                   endTime:endTime
                                frameCount:frameCount
                                   attempt:1
                                completion:completion];
}

- (void)notifySegmentCompleteWithSegmentId:(NSString *)segmentId
                                 sessionId:(NSString *)sessionId
                                 startTime:(NSTimeInterval)startTime
                                   endTime:(NSTimeInterval)endTime
                                frameCount:(NSInteger)frameCount
                                   attempt:(NSInteger)attempt
                                completion:(void (^)(BOOL, NSError *))completion {
  if (segmentId.length == 0 || sessionId.length == 0) {
    NSError *error = [self errorWithMessage:@"Missing segmentId or sessionId"];
    if (completion) {
      completion(NO, error);
    }
    return;
  }

  NSString *urlString = [NSString
      stringWithFormat:@"%@/api/ingest/segment/complete", self.baseURL];
  NSURL *url = [NSURL URLWithString:urlString];

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  request.HTTPMethod = @"POST";
  [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];

  RJDeviceAuthManager *deviceAuth = [RJDeviceAuthManager sharedManager];
  NSString *currentUploadToken = [deviceAuth currentUploadToken];

  if (currentUploadToken.length > 0 && self.apiKey.length > 0) {
    [request setValue:currentUploadToken forHTTPHeaderField:@"x-upload-token"];
    [request setValue:self.apiKey forHTTPHeaderField:@"x-rejourney-key"];
  } else {
    [request setValue:self.apiKey forHTTPHeaderField:@"x-api-key"];
  }

  NSDictionary *body = @{
    @"segmentId" : segmentId ?: @"",
    @"sessionId" : sessionId,
    @"frameCount" : @(frameCount),
  };

  RJLogInfo(@"[RJ-UPLOAD] segment/complete request: %@", body);

  request.HTTPBody = [NSJSONSerialization dataWithJSONObject:body
                                                     options:0
                                                       error:nil];

  NSURLSessionDataTask *task = [self.session
      dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response,
                            NSError *error) {
           NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;
           BOOL success = !error && httpResponse.statusCode < 400;

           if (!success) {
             NSString *responseBody =
                 [[NSString alloc] initWithData:data
                                       encoding:NSUTF8StringEncoding];
             RJLogInfo(@"[RJ-UPLOAD] Segment Completion Failed (HTTP %ld): %@",
                   (long)httpResponse.statusCode, responseBody);

             if (attempt < self.maxRetries) {
               NSTimeInterval delay = MIN(pow(2.0, attempt), 8.0);
               dispatch_after(
                   dispatch_time(DISPATCH_TIME_NOW,
                                 (int64_t)(delay * NSEC_PER_SEC)),
                   dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
                     [self notifySegmentCompleteWithSegmentId:segmentId
                                                    sessionId:sessionId
                                                    startTime:startTime
                                                      endTime:endTime
                                                   frameCount:frameCount
                                                      attempt:attempt + 1
                                                   completion:completion];
                   });
               return;
             }
           } else {
             RJLogInfo(@"[RJ-UPLOAD] Segment completion succeeded: %@",
                   segmentId);
           }

           NSError *finalError = error;
           if (!success && !finalError) {
             finalError = [self errorWithMessage:
                              [NSString stringWithFormat:
                                            @"Segment completion failed (%ld)",
                                            (long)httpResponse.statusCode]];
           }

           if (completion) {
             completion(success, finalError);
           }
         }];

  [task resume];
}

- (NSUInteger)fileSizeAtURL:(NSURL *)url {
  NSDictionary *attrs =
      [[NSFileManager defaultManager] attributesOfItemAtPath:url.path
                                                       error:nil];
  return [attrs[NSFileSize] unsignedIntegerValue];
}

- (NSError *)errorWithMessage:(NSString *)message {
  return [NSError errorWithDomain:@"RJSegmentUploader"
                             code:-1
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

@end
