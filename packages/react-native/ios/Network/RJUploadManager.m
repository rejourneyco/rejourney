//
//  RJUploadManager.m
//  Rejourney
//
//  Session data upload management implementation.
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

#import "RJUploadManager.h"
#import "../Core/RJConstants.h"
#import "../Core/RJLogger.h"
#import "../Utils/RJGzipUtils.h"
#import "../Utils/RJKeychainManager.h"
#import "../Utils/RJTelemetry.h"
#import "RJDeviceAuthManager.h"
#import "RJNetworkMonitor.h"
#import "RJRetryManager.h"
#import <UIKit/UIKit.h>
#import <sys/utsname.h>

static NSString *RJRedactedURLForLogFromURL(NSURL *url) {
  if (!url)
    return @"<nil>";

  NSURLComponents *components = [NSURLComponents componentsWithURL:url
                                           resolvingAgainstBaseURL:NO];

  components.query = nil;
  components.fragment = nil;

  NSString *scheme = components.scheme ?: url.scheme;
  NSString *host = components.host ?: url.host;
  NSString *path = components.path ?: url.path;
  if (scheme.length > 0 && host.length > 0) {
    return [NSString stringWithFormat:@"%@://%@%@", scheme, host, path ?: @""];
  }
  if (host.length > 0) {
    return [NSString stringWithFormat:@"%@%@", host, path ?: @""];
  }

  return (components.URL.absoluteString.length > 0)
             ? components.URL.absoluteString
             : (url.absoluteString ?: @"<invalid url>");
}

static NSString *RJRedactedURLForLogFromString(NSString *urlString) {
  if (urlString.length == 0)
    return @"<empty>";
  NSURL *url = [NSURL URLWithString:urlString];
  return RJRedactedURLForLogFromURL(url);
}

#pragma mark - Private Interface

@interface RJUploadManager ()

@property(nonatomic, assign) BOOL keyboardVisible;
@property(nonatomic, strong) dispatch_queue_t uploadQueue;

@property(nonatomic, strong, nullable) NSTimer *batchUploadTimer;

@property(nonatomic, assign) NSTimeInterval lastUploadTime;

@property(nonatomic, assign) NSInteger batchNumber;

@property(nonatomic, assign) NSInteger eventBatchNumber;

@property(nonatomic, assign) BOOL isUploading;

@property(nonatomic, assign) BOOL isShuttingDown;

@property(nonatomic, strong) RJDeviceAuthManager *deviceAuthManager;

@property(nonatomic, strong, nullable) NSURLSessionDataTask *activeTask;

@property(nonatomic, strong) NSString *pendingRootPath;

#pragma mark - Retry & Resilience Properties

@property(nonatomic, assign) NSInteger consecutiveFailureCount;

@property(nonatomic, assign) BOOL isCircuitOpen;

@property(nonatomic, assign) NSTimeInterval circuitOpenedTime;

@property(nonatomic, strong) NSMutableArray<NSDictionary *> *retryQueue;

@property(nonatomic, assign) BOOL isRetryScheduled;

#pragma mark - Replay Promotion Properties

@property(nonatomic, assign) BOOL isReplayPromoted;

@end

#pragma mark - Implementation

@implementation RJUploadManager

#pragma mark - Initialization

- (instancetype)initWithApiUrl:(NSString *)apiUrl {
  self = [super init];
  if (self) {
    _apiUrl = [apiUrl copy] ?: @"https://api.rejourney.co";
    _uploadQueue =
        dispatch_queue_create("com.rejourney.upload", DISPATCH_QUEUE_SERIAL);
    _batchNumber = 0;
    _eventBatchNumber = 0;
    _isUploading = NO;
    _isShuttingDown = NO;
    _lastUploadTime = 0;
    _lastUploadTime = 0;
    _activeTask = nil;
    _deviceAuthManager = [RJDeviceAuthManager sharedManager];
    _maxRecordingMinutes = 10;
    _sampleRate = 100;

    _consecutiveFailureCount = 0;
    _isCircuitOpen = NO;
    _circuitOpenedTime = 0;
    _retryQueue = [NSMutableArray new];
    _isRetryScheduled = NO;

    NSArray<NSString *> *paths = NSSearchPathForDirectoriesInDomains(
        NSCachesDirectory, NSUserDomainMask, YES);
    NSString *caches = paths.firstObject ?: NSTemporaryDirectory();
    _pendingRootPath = [[caches stringByAppendingPathComponent:@"rejourney"]
        stringByAppendingPathComponent:@"pending_uploads"];
    [[NSFileManager defaultManager] createDirectoryAtPath:_pendingRootPath
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:nil];
  }
  return self;
}

#pragma mark - Crash-Safe Persistence Helpers

- (NSString *)pendingSessionDir:(NSString *)sessionId {
  NSString *sid = (sessionId.length > 0) ? sessionId : @"unknown";
  NSString *dir = [self.pendingRootPath stringByAppendingPathComponent:sid];
  [[NSFileManager defaultManager] createDirectoryAtPath:dir
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:nil];
  return dir;
}

- (void)markSessionActiveForRecovery {
  if (self.sessionId.length == 0)
    return;
  NSString *dir = [self pendingSessionDir:self.sessionId];
  NSString *metaPath = [dir stringByAppendingPathComponent:@"session.json"];
  NSDictionary *meta = @{
    @"sessionId" : self.sessionId ?: @"",
    @"sessionStartTime" : @(self.sessionStartTime),
    @"totalBackgroundTimeMs" : @(self.totalBackgroundTimeMs),
    @"updatedAt" : @([[NSDate date] timeIntervalSince1970] * 1000)
  };
  NSData *data = [NSJSONSerialization dataWithJSONObject:meta
                                                 options:0
                                                   error:nil];
  [data writeToFile:metaPath atomically:YES];
}

- (void)updateSessionRecoveryMeta {
  if (self.sessionId.length == 0)
    return;
  NSString *dir = [self pendingSessionDir:self.sessionId];
  NSString *metaPath = [dir stringByAppendingPathComponent:@"session.json"];
  NSData *existing = [NSData dataWithContentsOfFile:metaPath];
  NSMutableDictionary *meta = [NSMutableDictionary new];
  if (existing) {
    NSDictionary *json = [NSJSONSerialization JSONObjectWithData:existing
                                                         options:0
                                                           error:nil];
    if ([json isKindOfClass:[NSDictionary class]]) {
      [meta addEntriesFromDictionary:json];
    }
  }
  meta[@"sessionId"] = self.sessionId ?: @"";
  meta[@"sessionStartTime"] = @(self.sessionStartTime);
  meta[@"totalBackgroundTimeMs"] = @(self.totalBackgroundTimeMs);
  meta[@"updatedAt"] = @([[NSDate date] timeIntervalSince1970] * 1000);
  NSData *data = [NSJSONSerialization dataWithJSONObject:meta
                                                 options:0
                                                   error:nil];
  [data writeToFile:metaPath atomically:YES];
}

- (void)clearSessionRecovery:(NSString *)sessionId {
  if (sessionId.length == 0)
    return;
  NSString *dir =
      [self.pendingRootPath stringByAppendingPathComponent:sessionId];
  [[NSFileManager defaultManager] removeItemAtPath:dir error:nil];
}

- (NSString *)pendingFilenameForContentType:(NSString *)contentType
                                batchNumber:(NSInteger)batchNumber
                                   keyframe:(BOOL)isKeyframe {
  NSString *flag = isKeyframe ? @"k" : @"n";
  return [NSString
      stringWithFormat:@"%@_%ld_%@.gz", contentType, (long)batchNumber, flag];
}

- (void)persistPendingUploadWithContentType:(NSString *)contentType
                                batchNumber:(NSInteger)batchNumber
                                   keyframe:(BOOL)isKeyframe
                                    gzipped:(NSData *)gzipped
                                 eventCount:(NSInteger)eventCount
                                 frameCount:(NSInteger)frameCount {
  NSString *dir = [self pendingSessionDir:self.sessionId];
  NSString *name = [self pendingFilenameForContentType:contentType
                                           batchNumber:batchNumber
                                              keyframe:isKeyframe];
  NSString *path = [dir stringByAppendingPathComponent:name];
  [gzipped writeToFile:path atomically:YES];

  NSDictionary *meta = @{
    @"contentType" : contentType ?: @"",
    @"batchNumber" : @(batchNumber),
    @"isKeyframe" : @(isKeyframe),
    @"eventCount" : @(eventCount),
    @"frameCount" : @(frameCount),
    @"createdAt" : @([[NSDate date] timeIntervalSince1970] * 1000)
  };
  NSData *metaData = [NSJSONSerialization dataWithJSONObject:meta
                                                     options:0
                                                       error:nil];
  [metaData writeToFile:[path stringByAppendingString:@".meta.json"]
             atomically:YES];
}

- (NSDictionary *)parsePendingFilename:(NSString *)name {
  if (![name hasSuffix:@".gz"])
    return nil;
  NSString *base = [name stringByReplacingOccurrencesOfString:@".gz"
                                                   withString:@""];
  NSArray<NSString *> *parts = [base componentsSeparatedByString:@"_"];
  if (parts.count < 3)
    return nil;
  NSString *contentType = parts[0];
  NSInteger batch = [parts[1] integerValue];
  BOOL keyframe = [parts[2] isEqualToString:@"k"];
  return @{
    @"contentType" : contentType ?: @"",
    @"batchNumber" : @(batch),
    @"isKeyframe" : @(keyframe)
  };
}

- (BOOL)flushPendingUploadsForSessionSync:(NSString *)sessionId {
  if (sessionId.length == 0)
    return YES;

  NSString *dir =
      [self.pendingRootPath stringByAppendingPathComponent:sessionId];
  BOOL isDir = NO;
  if (![[NSFileManager defaultManager] fileExistsAtPath:dir
                                            isDirectory:&isDir] ||
      !isDir) {
    return YES;
  }

  NSArray<NSString *> *files =
      [[NSFileManager defaultManager] contentsOfDirectoryAtPath:dir error:nil]
          ?: @[];
  NSArray<NSString *> *gzFiles =
      [[files filteredArrayUsingPredicate:
                  [NSPredicate predicateWithFormat:@"SELF ENDSWITH '.gz'"]]
          sortedArrayUsingSelector:@selector(compare:)];

  if (gzFiles.count == 0)
    return YES;

  for (NSString *name in gzFiles) {
    NSDictionary *parsed = [self parsePendingFilename:name];
    if (!parsed)
      continue;

    NSString *path = [dir stringByAppendingPathComponent:name];
    NSData *gz = [NSData dataWithContentsOfFile:path];
    if (!gz) {
      return NO;
    }

    NSString *metaFile = [path stringByAppendingString:@".meta.json"];
    NSData *m = [NSData dataWithContentsOfFile:metaFile];
    NSDictionary *meta = m ? [NSJSONSerialization JSONObjectWithData:m
                                                             options:0
                                                               error:nil]
                           : @{};
    NSInteger eventCount = [meta[@"eventCount"] integerValue];
    NSInteger frameCount = [meta[@"frameCount"] integerValue];
    BOOL isKeyframe = meta[@"isKeyframe"] ? [meta[@"isKeyframe"] boolValue]
                                          : [parsed[@"isKeyframe"] boolValue];

    NSString *contentType = parsed[@"contentType"];
    NSInteger batchNumber = [parsed[@"batchNumber"] integerValue];

    NSDictionary *presign = nil;
    BOOL presignOk = [self presignForContentType:contentType
                                     batchNumber:batchNumber
                                       sizeBytes:gz.length
                                      isKeyframe:isKeyframe
                                          result:&presign];
    if (!presignOk || ![presign isKindOfClass:[NSDictionary class]]) {
      return NO;
    }

    NSString *uploadUrl = presign[@"presignedUrl"];
    NSString *batchId = presign[@"batchId"];
    if (![self uploadData:gz
            toPresignedURL:uploadUrl
               contentType:@"application/gzip"]) {
      return NO;
    }

    BOOL completeOk = [self completeBatchWithId:batchId
                                actualSizeBytes:gz.length
                                     eventCount:eventCount
                                     frameCount:frameCount];
    if (completeOk) {
      [[NSFileManager defaultManager] removeItemAtPath:path error:nil];
      [[NSFileManager defaultManager] removeItemAtPath:metaFile error:nil];
    } else {
      return NO;
    }
  }

  return YES;
}

- (NSArray<NSString *> *)listPendingSessionDirs {
  NSArray<NSString *> *dirs = [[NSFileManager defaultManager]
      contentsOfDirectoryAtPath:self.pendingRootPath
                          error:nil];
  if (![dirs isKindOfClass:[NSArray class]])
    return @[];
  NSMutableArray<NSString *> *out = [NSMutableArray new];
  for (NSString *d in dirs) {
    BOOL isDir = NO;
    NSString *full = [self.pendingRootPath stringByAppendingPathComponent:d];
    if ([[NSFileManager defaultManager] fileExistsAtPath:full
                                             isDirectory:&isDir] &&
        isDir) {
      [out addObject:d];
    }
  }
  return out;
}

- (void)recoverPendingSessionsWithCompletion:
    (nullable RJCompletionHandler)completion {
  dispatch_async(self.uploadQueue, ^{
    NSArray<NSString *> *sessionDirs = [self listPendingSessionDirs];
    if (sessionDirs.count == 0) {
      if (completion)
        completion(YES);
      return;
    }

    NSString *originalSessionId = self.sessionId;
    NSTimeInterval originalStart = self.sessionStartTime;
    NSTimeInterval originalBg = self.totalBackgroundTimeMs;

    BOOL allOk = YES;
    for (NSString *sid in sessionDirs) {

      if ([sid isEqualToString:originalSessionId]) {
        RJLogDebug(@"Skipping current session during recovery: %@", sid);
        continue;
      }

      NSString *dir = [self.pendingRootPath stringByAppendingPathComponent:sid];

      NSString *metaPath = [dir stringByAppendingPathComponent:@"session.json"];
      NSData *metaData = [NSData dataWithContentsOfFile:metaPath];
      NSTimeInterval recoveredEndedAt = 0;
      if (metaData) {
        NSDictionary *meta = [NSJSONSerialization JSONObjectWithData:metaData
                                                             options:0
                                                               error:nil];
        if ([meta isKindOfClass:[NSDictionary class]]) {
          self.sessionStartTime = [meta[@"sessionStartTime"] doubleValue];
          self.totalBackgroundTimeMs =
              [meta[@"totalBackgroundTimeMs"] doubleValue];

          if (meta[@"updatedAt"]) {
            recoveredEndedAt = [meta[@"updatedAt"] doubleValue];
          }
        }
      }

      NSInteger crashCount = 0;
      NSInteger anrCount = 0;
      NSInteger errorCount = 0;
      NSTimeInterval firstEventTs = 0;
      NSTimeInterval lastEventTs = 0;
      NSString *eventsPath =
          [dir stringByAppendingPathComponent:@"events.jsonl"];
      if ([[NSFileManager defaultManager] fileExistsAtPath:eventsPath]) {
        NSString *content =
            [NSString stringWithContentsOfFile:eventsPath
                                      encoding:NSUTF8StringEncoding
                                         error:nil];
        if (content.length > 0) {
          NSArray<NSString *> *lines =
              [content componentsSeparatedByString:@"\n"];
          for (NSString *line in lines) {
            if (line.length == 0)
              continue;
            NSData *data = [line dataUsingEncoding:NSUTF8StringEncoding];
            NSDictionary *event = [NSJSONSerialization JSONObjectWithData:data
                                                                  options:0
                                                                    error:nil];
            if (event && event[@"timestamp"]) {
              NSTimeInterval eventTs = [event[@"timestamp"] doubleValue];

              if (firstEventTs == 0 || eventTs < firstEventTs)
                firstEventTs = eventTs;
              if (eventTs > lastEventTs)
                lastEventTs = eventTs;

              NSString *eventType = event[@"type"];
              if ([eventType isEqualToString:@"crash"]) {
                crashCount++;
              } else if ([eventType isEqualToString:@"anr"]) {
                anrCount++;
              } else if ([eventType isEqualToString:@"error"]) {
                errorCount++;
              }
            }
          }

          if (lastEventTs > recoveredEndedAt) {
            recoveredEndedAt = lastEventTs;
            RJLogDebug(@"Using last event timestamp from events.jsonl: %.0f",
                       lastEventTs);
          }
        }
      }

      self.sessionId = sid;

      NSArray<NSString *> *files =
          [[NSFileManager defaultManager] contentsOfDirectoryAtPath:dir
                                                              error:nil]
              ?: @[];

      NSArray<NSString *> *gzFiles =
          [[files filteredArrayUsingPredicate:
                      [NSPredicate predicateWithFormat:@"SELF ENDSWITH '.gz'"]]
              sortedArrayUsingSelector:@selector(compare:)];

      for (NSString *name in gzFiles) {
        NSDictionary *parsed = [self parsePendingFilename:name];
        if (!parsed)
          continue;

        NSString *path = [dir stringByAppendingPathComponent:name];
        NSData *gz = [NSData dataWithContentsOfFile:path];
        if (!gz) {
          allOk = NO;
          continue;
        }

        NSString *metaFile = [path stringByAppendingString:@".meta.json"];
        NSData *m = [NSData dataWithContentsOfFile:metaFile];
        NSDictionary *meta = m ? [NSJSONSerialization JSONObjectWithData:m
                                                                 options:0
                                                                   error:nil]
                               : @{};
        NSInteger eventCount = [meta[@"eventCount"] integerValue];
        NSInteger frameCount = [meta[@"frameCount"] integerValue];
        BOOL isKeyframe = meta[@"isKeyframe"]
                              ? [meta[@"isKeyframe"] boolValue]
                              : [parsed[@"isKeyframe"] boolValue];

        NSString *contentType = parsed[@"contentType"];
        NSInteger batchNumber = [parsed[@"batchNumber"] integerValue];

        RJLogDebug(@"Recovery: uploading pending %@ batch=%ld keyframe=%@ "
                   @"bytes=%lu (events=%ld frames=%ld)",
                   contentType, (long)batchNumber, isKeyframe ? @"YES" : @"NO",
                   (unsigned long)gz.length, (long)eventCount,
                   (long)frameCount);

        NSDictionary *presign = nil;
        BOOL presignOk = [self presignForContentType:contentType
                                         batchNumber:batchNumber
                                           sizeBytes:gz.length
                                          isKeyframe:isKeyframe
                                              result:&presign];
        if (!presignOk || ![presign isKindOfClass:[NSDictionary class]]) {
          allOk = NO;
          continue;
        }

        NSString *uploadUrl = presign[@"presignedUrl"];
        NSString *batchId = presign[@"batchId"];
        if (![self uploadData:gz
                toPresignedURL:uploadUrl
                   contentType:@"application/gzip"]) {
          allOk = NO;
          continue;
        }

        BOOL completeOk = [self completeBatchWithId:batchId
                                    actualSizeBytes:gz.length
                                         eventCount:eventCount
                                         frameCount:frameCount];
        if (completeOk) {
          [[NSFileManager defaultManager] removeItemAtPath:path error:nil];
          [[NSFileManager defaultManager] removeItemAtPath:metaFile error:nil];
        } else {
          allOk = NO;
        }
      }

      NSArray<NSString *> *remaining =
          [[[NSFileManager defaultManager] contentsOfDirectoryAtPath:dir
                                                               error:nil]
                  ?: @[]
              filteredArrayUsingPredicate:
                  [NSPredicate predicateWithFormat:@"SELF ENDSWITH '.gz'"]];
      if (remaining.count == 0) {

        BOOL endOk =
            (recoveredEndedAt > 0)
                ? [self endSessionSyncWithEndedAt:recoveredEndedAt
                                          timeout:RJNetworkRequestTimeout]
                : [self endSessionSync];
        if (endOk) {
          [self clearSessionRecovery:sid];
        } else {
          allOk = NO;
        }
      } else {
        allOk = NO;
      }
    }

    self.sessionId = originalSessionId;
    self.sessionStartTime = originalStart;
    self.totalBackgroundTimeMs = originalBg;

    if (completion)
      completion(allOk);
  });
}

#pragma mark - Project Resolution

- (void)fetchProjectConfigWithCompletion:
    (void (^)(BOOL success, NSDictionary *_Nullable config,
              NSError *_Nullable error))completion {

  if (!self.publicKey || self.publicKey.length == 0) {
    RJLogWarning(@"Cannot fetch project config: no publicKey set");
    if (completion) {
      completion(NO, nil,
                 [NSError
                     errorWithDomain:@"RJUploadManager"
                                code:1001
                            userInfo:@{
                              NSLocalizedDescriptionKey : @"No public key set"
                            }]);
    }
    return;
  }

  NSString *urlString =
      [NSString stringWithFormat:@"%@/api/sdk/config", self.apiUrl];

  dispatch_async(
      dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        NSURL *url = [NSURL URLWithString:urlString];
        if (!url) {
          dispatch_async(dispatch_get_main_queue(), ^{
            if (completion) {
              completion(NO, nil,
                         [NSError
                             errorWithDomain:@"RJUploadManager"
                                        code:1002
                                    userInfo:@{
                                      NSLocalizedDescriptionKey : @"Invalid URL"
                                    }]);
            }
          });
          return;
        }

        NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
        request.HTTPMethod = @"GET";
        request.timeoutInterval = RJNetworkRequestTimeout;

        NSDictionary *headers = [self configHeaders];
        for (NSString *key in headers.allKeys) {
          [request setValue:headers[key] forHTTPHeaderField:key];
        }

        NSURLSessionConfiguration *config =
            [NSURLSessionConfiguration defaultSessionConfiguration];
        config.timeoutIntervalForRequest = RJNetworkRequestTimeout;
        config.timeoutIntervalForResource = RJNetworkRequestTimeout;
        NSURLSession *session = [NSURLSession sessionWithConfiguration:config];

        NSURLSessionDataTask *task = [session
            dataTaskWithRequest:request
              completionHandler:^(NSData *data, NSURLResponse *response,
                                  NSError *error) {
                dispatch_async(dispatch_get_main_queue(), ^{
                  if (error) {
                    RJLogError(@"Failed to fetch project configuration: %@",
                               error.localizedDescription);
                    if (completion) {
                      completion(NO, nil, error);
                    }
                    return;
                  }

                  if (![response isKindOfClass:[NSHTTPURLResponse class]]) {
                    RJLogError(@"Invalid response type");
                    if (completion) {
                      completion(NO, nil,
                                 [NSError errorWithDomain:@"RJUploadManager"
                                                     code:1002
                                                 userInfo:@{
                                                   NSLocalizedDescriptionKey :
                                                       @"Invalid response type"
                                                 }]);
                    }
                    return;
                  }

                  NSHTTPURLResponse *httpResponse =
                      (NSHTTPURLResponse *)response;
                  if (httpResponse.statusCode < 200 ||
                      httpResponse.statusCode >= 300) {
                    RJLogError(
                        @"Failed to fetch project configuration: status %ld",
                        (long)httpResponse.statusCode);
                    if (completion) {
                      completion(
                          NO, nil,
                          [NSError
                              errorWithDomain:@"RJUploadManager"
                                         code:1002
                                     userInfo:@{
                                       NSLocalizedDescriptionKey : [NSString
                                           stringWithFormat:@"HTTP %ld",
                                                            (long)httpResponse
                                                                .statusCode]
                                     }]);
                    }
                    return;
                  }

                  NSDictionary *responseDict = nil;
                  if (data) {
                    NSError *parseError = nil;
                    responseDict =
                        [NSJSONSerialization JSONObjectWithData:data
                                                        options:0
                                                          error:&parseError];
                    if (parseError ||
                        ![responseDict isKindOfClass:[NSDictionary class]]) {
                      RJLogError(
                          @"Failed to parse project configuration response");
                      if (completion) {
                        completion(NO, nil, parseError);
                      }
                      return;
                    }
                  }

                  NSDictionary *response = responseDict;
                  if (!response ||
                      ![response isKindOfClass:[NSDictionary class]]) {
                    RJLogError(@"Failed to fetch project configuration: "
                               @"invalid response");
                    if (completion) {
                      completion(NO, nil,
                                 [NSError errorWithDomain:@"RJUploadManager"
                                                     code:1002
                                                 userInfo:@{
                                                   NSLocalizedDescriptionKey :
                                                       @"Invalid response"
                                                 }]);
                    }
                    return;
                  }

                  NSString *resolvedProjectId = response[@"projectId"];
                  if (resolvedProjectId && resolvedProjectId.length > 0) {
                    self.projectId = resolvedProjectId;
                    RJLogDebug(@"Resolved projectId: %@", resolvedProjectId);
                  }

                  if (response[@"maxRecordingMinutes"]) {
                    self.maxRecordingMinutes =
                        [response[@"maxRecordingMinutes"] integerValue];
                    RJLogDebug(@"Updated maxRecordingMinutes: %ld",
                               (long)self.maxRecordingMinutes);
                  }

                  if (response[@"sampleRate"]) {
                    self.sampleRate = [response[@"sampleRate"] integerValue];
                  }

                  BOOL recordingEnabled = YES;
                  if (response[@"recordingEnabled"] &&
                      [response[@"recordingEnabled"] boolValue] == NO) {
                    recordingEnabled = NO;
                    RJLogWarning(@"Recording is disabled for this project");
                  }

                  BOOL rejourneyEnabled = YES;
                  if (response[@"rejourneyEnabled"] &&
                      [response[@"rejourneyEnabled"] boolValue] == NO) {
                    rejourneyEnabled = NO;
                    RJLogWarning(@"Rejourney is disabled for this project");
                  }

                  BOOL billingBlocked = NO;
                  if (response[@"billingBlocked"] &&
                      [response[@"billingBlocked"] boolValue] == YES) {
                    billingBlocked = YES;
                    RJLogWarning(@"Session limit reached - recording blocked "
                                 @"by billing");
                  }

                  if (completion) {
                    NSMutableDictionary *config = [response mutableCopy];
                    config[@"recordingEnabled"] = @(recordingEnabled);
                    config[@"rejourneyEnabled"] = @(rejourneyEnabled);
                    config[@"billingBlocked"] = @(billingBlocked);
                    completion(YES, config, nil);
                  }
                });
              }];

        [task resume];
        [session finishTasksAndInvalidate];
      });
}

- (BOOL)resolveProjectIdFromPublicKey {

  if (self.projectId.length > 0) {
    return YES;
  }

  dispatch_semaphore_t sema = dispatch_semaphore_create(0);
  __block BOOL success = NO;

  [self fetchProjectConfigWithCompletion:^(BOOL ok, NSDictionary *config,
                                           NSError *error) {
    success = ok;
    dispatch_semaphore_signal(sema);
  }];

  dispatch_semaphore_wait(sema,
                          dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
  return success;
}

#pragma mark - Timer Management

- (void)startBatchUploadTimer {
  [self stopBatchUploadTimer];

  __weak typeof(self) weakSelf = self;

  self.batchUploadTimer =
      [NSTimer scheduledTimerWithTimeInterval:RJBatchUploadInterval
                                      repeats:YES
                                        block:^(NSTimer *timer) {
                                          [weakSelf timerFired];
                                        }];
}

- (void)stopBatchUploadTimer {
  [self.batchUploadTimer invalidate];
  self.batchUploadTimer = nil;
}

- (void)timerFired {
}

#pragma mark - Upload Methods

- (void)uploadBatchWithEvents:(NSArray<NSDictionary *> *)events
                      isFinal:(BOOL)isFinal
                   completion:(RJCompletionHandler)completion {

  RJCompletionHandler safeCompletion = [completion copy];

  if (self.isShuttingDown) {
    if (safeCompletion)
      safeCompletion(NO);
    return;
  }

  if (self.isUploading) {
    RJLogDebug(@"Upload already in progress, queueing batch for retry");

    [self addToRetryQueueWithEvents:(events ?: @[])];
    if (safeCompletion)
      safeCompletion(NO);
    return;
  }

  NSArray *safeEvents = events ?: @[];

  if (safeEvents.count == 0) {
    if (safeCompletion)
      safeCompletion(YES);
    return;
  }

  self.isUploading = YES;
  self.batchNumber++;

  NSInteger currentBatch = self.batchNumber;
  RJLogDebug(@"Batch %ld: start upload (sessionId=%@ isFinal=%@) events=%lu "
             @"retryQueue=%lu circuitOpen=%@",
             (long)currentBatch, self.sessionId ?: @"",
             isFinal ? @"YES" : @"NO", (unsigned long)safeEvents.count,
             (unsigned long)self.retryQueue.count,
             self.isCircuitOpen ? @"YES" : @"NO");

  __weak typeof(self) weakSelf = self;
  dispatch_async(self.uploadQueue, ^{
    __strong typeof(weakSelf) strongSelf = weakSelf;
    BOOL success = NO;

    @try {
      success = [strongSelf uploadEventsSync:safeEvents isFinal:isFinal];

      // NOTE: Don't call endSessionSync here - uploadEventsSync already calls
      // it when isFinal:YES is passed. The duplicate call was causing two
      // session/end requests to be sent to the backend.
      if (success && isFinal) {
        RJLogDebug(
            @"Final batch uploaded (session end handled by uploadEventsSync)");
      }

    } @catch (NSException *exception) {
      RJLogError(@"Batch upload failed: %@", exception);
      success = NO;
    }

    dispatch_async(dispatch_get_main_queue(), ^{
      if (strongSelf) {
        strongSelf.isUploading = NO;
        if (success) {
          [strongSelf recordUploadSuccess];
          strongSelf.lastUploadTime = [[NSDate date] timeIntervalSince1970];
          RJLogDebug(@"Batch %ld uploaded successfully", (long)currentBatch);
        } else {
          [strongSelf recordUploadFailure];
          RJLogWarning(@"Batch %ld upload failed, adding to retry queue",
                       (long)currentBatch);

          [strongSelf addToRetryQueueWithEvents:safeEvents];
        }
      }
      if (safeCompletion)
        safeCompletion(success);
    });
  });
}

- (BOOL)synchronousUploadWithEvents:(NSArray<NSDictionary *> *)events {

  NSArray *safeEvents = events ?: @[];

  BOOL uploadSuccess = YES;

  if (safeEvents.count > 0) {

    if (self.isUploading) {
      RJLogDebug(@"Waiting for in-progress upload to complete...");
      NSTimeInterval waitStart = [[NSDate date] timeIntervalSince1970];
      while (self.isUploading) {
        [[NSRunLoop currentRunLoop]
               runMode:NSDefaultRunLoopMode
            beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
        NSTimeInterval elapsed =
            [[NSDate date] timeIntervalSince1970] - waitStart;
        if (elapsed > 10.0) {
          RJLogWarning(@"Upload wait timeout (10s), proceeding...");
          break;
        }
      }
      if (!self.isUploading) {
        RJLogDebug(@"In-progress upload completed during wait");
      }
    }

    if (self.isUploading) {
      RJLogWarning(
          @"Upload still in progress after wait, sending fast session-end...");

      [self endSessionSyncWithTimeout:2.0];
      return NO;
    }

    self.isUploading = YES;
    self.batchNumber++;

    @try {
      uploadSuccess = [self uploadEventsSync:safeEvents isFinal:YES];
      if (uploadSuccess) {
        self.lastUploadTime = [[NSDate date] timeIntervalSince1970];
        RJLogDebug(@"Termination upload sent");
      } else {
        RJLogWarning(@"Termination upload failed");
      }
    } @catch (NSException *exception) {
      RJLogError(@"Synchronous upload exception: %@", exception);
      uploadSuccess = NO;
    }

    self.isUploading = NO;
  }

  // NOTE: Don't call endSessionSync here - uploadEventsSync already calls it
  // when isFinal:YES is passed. The duplicate call was causing two session/end
  // requests to be sent to the backend.
  //
  // Previously this had:
  //   RJLogDebug(@"Sending session end signal...");
  //   BOOL endSessionSuccess = [self endSessionSync];
  //   return uploadSuccess && endSessionSuccess;

  return uploadSuccess;
}

- (void)uploadCrashReport:(NSDictionary *)report
               completion:(nullable RJCompletionHandler)completion {
  if (!report) {
    if (completion)
      completion(NO);
    return;
  }

  dispatch_async(self.uploadQueue, ^{
    NSString *originalSessionId = self.sessionId;
    BOOL didTemporarilyChangeSessionId = NO;

    @try {

      NSString *crashSessionId = report[@"sessionId"];
      if (crashSessionId && crashSessionId.length > 0) {

        self.sessionId = crashSessionId;
        didTemporarilyChangeSessionId = YES;
        RJLogDebug(@"Using sessionId from crash report: %@", crashSessionId);
      }

      NSDictionary *payload = @{
        @"crashes" : @[ report ],
        @"sessionId" : crashSessionId ?: @"",
        @"timestamp" : report[@"timestamp"]
            ?: @([[NSDate date] timeIntervalSince1970] * 1000)
      };

      NSError *error = nil;
      NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload
                                                         options:0
                                                           error:&error];
      if (error || !jsonData) {
        RJLogError(@"Failed to serialize crash report: %@", error);

        if (didTemporarilyChangeSessionId) {
          self.sessionId = originalSessionId;
        }
        if (completion)
          completion(NO);
        return;
      }

      NSData *gzipped = RJGzipData(jsonData, &error);
      if (!gzipped) {
        RJLogError(@"Failed to gzip crash report: %@", error);

        if (didTemporarilyChangeSessionId) {
          self.sessionId = originalSessionId;
        }
        if (completion)
          completion(NO);
        return;
      }

      NSDictionary *presignResult = nil;
      BOOL presigned = [self presignForContentType:@"crashes"
                                       batchNumber:0
                                         sizeBytes:gzipped.length
                                        isKeyframe:NO
                                            result:&presignResult];

      if (!presigned || !presignResult) {
        RJLogError(@"Failed to presign crash report");

        if (didTemporarilyChangeSessionId) {
          self.sessionId = originalSessionId;
        }
        if (completion)
          completion(NO);
        return;
      }

      NSString *uploadUrl = presignResult[@"presignedUrl"];
      NSString *batchId = presignResult[@"batchId"];

      if (!uploadUrl || uploadUrl.length == 0) {
        RJLogError(@"Invalid presigned URL - received: %@", presignResult);

        if (didTemporarilyChangeSessionId) {
          self.sessionId = originalSessionId;
        }
        if (completion)
          completion(NO);
        return;
      }

      if (![self uploadData:gzipped
              toPresignedURL:uploadUrl
                 contentType:@"application/gzip"]) {
        RJLogError(@"Failed to upload crash report to S3");

        if (didTemporarilyChangeSessionId) {
          self.sessionId = originalSessionId;
        }
        if (completion)
          completion(NO);
        return;
      }

      if (![self completeBatchWithId:batchId
                     actualSizeBytes:gzipped.length
                          eventCount:0
                          frameCount:0]) {
        RJLogWarning(@"Failed to complete crash report batch");
      }

      RJLogDebug(@"Crash report uploaded successfully");

      if (didTemporarilyChangeSessionId) {
        self.sessionId = originalSessionId;
      }

      if (completion)
        completion(YES);

    } @catch (NSException *exception) {
      RJLogError(@"Crash upload exception: %@", exception);

      if (didTemporarilyChangeSessionId) {
        self.sessionId = originalSessionId;
      }
      if (completion)
        completion(NO);
    }
  });
}

- (void)uploadANRReport:(NSDictionary *)report
             completion:(nullable RJCompletionHandler)completion {
  if (!report) {
    if (completion)
      completion(NO);
    return;
  }

  dispatch_async(self.uploadQueue, ^{
    NSString *originalSessionId = self.sessionId;
    BOOL didTemporarilyChangeSessionId = NO;

    @try {
      NSString *anrSessionId = report[@"sessionId"];
      if (anrSessionId && anrSessionId.length > 0) {
        self.sessionId = anrSessionId;
        didTemporarilyChangeSessionId = YES;
        RJLogDebug(@"Using sessionId from ANR report: %@", anrSessionId);
      }

      NSDictionary *payload = @{
        @"anrs" : @[ report ],
        @"sessionId" : anrSessionId ?: @"",
        @"timestamp" : report[@"timestamp"]
            ?: @([[NSDate date] timeIntervalSince1970] * 1000)
      };

      NSError *error = nil;
      NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload
                                                         options:0
                                                           error:&error];
      if (error || !jsonData) {
        RJLogError(@"Failed to serialize ANR report: %@", error);
        if (didTemporarilyChangeSessionId)
          self.sessionId = originalSessionId;
        if (completion)
          completion(NO);
        return;
      }

      NSData *gzipped = RJGzipData(jsonData, &error);
      if (!gzipped) {
        RJLogError(@"Failed to gzip ANR report: %@", error);
        if (didTemporarilyChangeSessionId)
          self.sessionId = originalSessionId;
        if (completion)
          completion(NO);
        return;
      }

      NSDictionary *presignResult = nil;
      BOOL presigned = [self presignForContentType:@"anrs"
                                       batchNumber:0
                                         sizeBytes:gzipped.length
                                        isKeyframe:NO
                                            result:&presignResult];

      if (!presigned || !presignResult) {
        RJLogError(@"Failed to presign ANR report");
        if (didTemporarilyChangeSessionId)
          self.sessionId = originalSessionId;
        if (completion)
          completion(NO);
        return;
      }

      NSString *uploadUrl = presignResult[@"presignedUrl"];
      NSString *batchId = presignResult[@"batchId"];

      if (!uploadUrl || uploadUrl.length == 0) {
        RJLogError(@"Invalid presigned URL for ANR");
        if (didTemporarilyChangeSessionId)
          self.sessionId = originalSessionId;
        if (completion)
          completion(NO);
        return;
      }

      if (![self uploadData:gzipped
              toPresignedURL:uploadUrl
                 contentType:@"application/gzip"]) {
        RJLogError(@"Failed to upload ANR report to S3");
        if (didTemporarilyChangeSessionId)
          self.sessionId = originalSessionId;
        if (completion)
          completion(NO);
        return;
      }

      [self completeBatchWithId:batchId
                actualSizeBytes:gzipped.length
                     eventCount:0
                     frameCount:0];

      RJLogDebug(@"ANR report uploaded successfully");
      if (didTemporarilyChangeSessionId)
        self.sessionId = originalSessionId;
      if (completion)
        completion(YES);

    } @catch (NSException *exception) {
      RJLogError(@"ANR upload exception: %@", exception);
      if (didTemporarilyChangeSessionId)
        self.sessionId = originalSessionId;
      if (completion)
        completion(NO);
    }
  });
}

#pragma mark - Payload Building

- (NSDictionary *)buildEventPayloadWithEvents:(NSArray<NSDictionary *> *)events
                                  batchNumber:(NSInteger)batchNumber
                                      isFinal:(BOOL)isFinal {

  @try {
    NSTimeInterval currentTime = [[NSDate date] timeIntervalSince1970];
    NSDictionary *deviceInfo = [self buildDeviceInfo];

    NSString *sessionId = self.sessionId;
    NSString *userId = self.userId;
    NSTimeInterval sessionStartTime = self.sessionStartTime;

    NSMutableDictionary *payload =
        [NSMutableDictionary dictionaryWithCapacity:12];

    payload[@"sessionId"] = sessionId ?: @"";
    payload[@"userId"] = (userId && userId.length > 0) ? userId : @"anonymous";
    payload[@"batchNumber"] = @(batchNumber);
    payload[@"isFinal"] = @(isFinal);
    payload[@"sessionStartTime"] = @(sessionStartTime * 1000);
    payload[@"batchTime"] = @(currentTime * 1000);
    payload[@"deviceInfo"] = deviceInfo ?: @{};
    payload[@"events"] = events ?: @[];

    if (isFinal) {
      payload[@"endTime"] = @(currentTime * 1000);
      NSTimeInterval duration = currentTime - sessionStartTime;
      payload[@"duration"] = @(MAX(0, duration) * 1000);
    }

    return [payload copy];
  } @catch (NSException *exception) {
    RJLogError(@"Payload building failed: %@", exception);
    return nil;
  }
}

- (NSDictionary *)buildDeviceInfo {
  @try {
    UIDevice *device = [UIDevice currentDevice];
    CGRect screenBounds = [UIScreen mainScreen].bounds;
    CGFloat screenScale = [UIScreen mainScreen].scale;

    NSBundle *mainBundle = [NSBundle mainBundle];
    NSString *appVersion =
        [mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
    if (!appVersion || appVersion.length == 0) {

      appVersion = [mainBundle objectForInfoDictionaryKey:@"CFBundleVersion"];
    }
    if (!appVersion || appVersion.length == 0) {
      appVersion = nil;
    }

    NSString *bundleId = [mainBundle bundleIdentifier];

    NSMutableDictionary *deviceInfo =
        [NSMutableDictionary dictionaryWithDictionary:@{
          @"model" : [self deviceModelIdentifier] ?: device.model ?: @"unknown",
          @"systemName" : device.systemName ?: @"iOS",
          @"systemVersion" : device.systemVersion ?: @"unknown",
          @"name" : device.name ?: @"iPhone",
          @"screenWidth" : @(screenBounds.size.width),
          @"screenHeight" : @(screenBounds.size.height),
          @"screenScale" : @(screenScale),
          @"platform" : @"ios"
        }];

    if (appVersion) {
      deviceInfo[@"appVersion"] = appVersion;
    }

    if (bundleId) {
      deviceInfo[@"appId"] = bundleId;
    }

    if (self.deviceHash && self.deviceHash.length > 0) {
      deviceInfo[@"deviceHash"] = self.deviceHash;
    }

    RJNetworkQuality *networkQuality =
        [[RJNetworkMonitor sharedInstance] captureNetworkQuality];
    if (networkQuality) {
      NSDictionary *networkDict = [networkQuality toDictionary];
      if (networkDict[@"networkType"]) {
        deviceInfo[@"networkType"] = networkDict[@"networkType"];
      }
      if (networkDict[@"cellularGeneration"] &&
          ![networkDict[@"cellularGeneration"] isEqualToString:@"unknown"]) {
        deviceInfo[@"cellularGeneration"] = networkDict[@"cellularGeneration"];
      }
      deviceInfo[@"isConstrained"] = networkDict[@"isConstrained"] ?: @(NO);
      deviceInfo[@"isExpensive"] = networkDict[@"isExpensive"] ?: @(NO);
    }

    return [deviceInfo copy];
  } @catch (NSException *exception) {
    RJLogWarning(@"Device info collection failed: %@", exception);
    return @{};
  }
}

- (NSString *)deviceModelIdentifier {
  struct utsname systemInfo;
  uname(&systemInfo);
  return [NSString stringWithCString:systemInfo.machine
                            encoding:NSUTF8StringEncoding];
}

#pragma mark - Presigned Upload Helpers

- (NSDictionary *)configHeaders {
  NSMutableDictionary *headers = [NSMutableDictionary dictionary];

  if (self.publicKey.length > 0) {
    headers[@"x-public-key"] = self.publicKey;
  }

  NSString *bundleId = [[NSBundle mainBundle] bundleIdentifier];
  if (bundleId.length > 0) {
    headers[@"x-bundle-id"] = bundleId;
  }

  headers[@"x-platform"] = @"ios";

  return headers;
}

- (NSDictionary *)authHeaders {
  NSMutableDictionary *headers = [NSMutableDictionary dictionary];

  if (self.publicKey.length > 0) {
    headers[@"X-Rejourney-Key"] = self.publicKey;
  }

  NSString *bundleId = [[NSBundle mainBundle] bundleIdentifier];
  if (bundleId.length > 0) {
    headers[@"X-Bundle-ID"] = bundleId;
  }

  headers[@"X-Rejourney-Platform"] = @"ios";

  if (self.deviceHash.length > 0) {
    headers[@"X-Rejourney-Device-Hash"] = self.deviceHash;
  }

  if (self.deviceAuthManager) {
    NSString *uploadToken = [self.deviceAuthManager currentUploadToken];
    if (uploadToken.length > 0) {
      headers[@"x-upload-token"] = uploadToken;
      RJLogDebug(@"Added upload token to request headers");
    } else {
      RJLogWarning(@"No valid upload token available - triggering async "
                   @"refresh with auto-register");

      [self.deviceAuthManager getUploadTokenWithAutoRegisterCompletion:^(
                                  BOOL success, NSString *token,
                                  NSInteger expiresIn, NSError *error) {
        if (success) {
          RJLogDebug(
              @"Background token refresh completed (expires in %ld seconds)",
              (long)expiresIn);
        } else {
          RJLogWarning(@"Background token refresh failed: %@", error);
        }
      }];
    }
  }

  return headers;
}

- (BOOL)sendJSONRequestTo:(NSString *)urlString
                   method:(NSString *)method
                     body:(NSDictionary *)body
               timeoutSec:(NSTimeInterval)timeout
               retryCount:(NSInteger)retryCount
             responseJSON:(NSDictionary *__autoreleasing *)responseJSON {

  NSURL *url = [NSURL URLWithString:urlString];
  if (!url) {
    RJLogError(@"Invalid URL: %@", urlString);
    return NO;
  }

  NSError *jsonError = nil;
  NSData *bodyData = nil;
  if (body) {
    bodyData = [NSJSONSerialization dataWithJSONObject:body
                                               options:0
                                                 error:&jsonError];
    if (jsonError) {
      RJLogError(@"Failed to serialize JSON: %@", jsonError);
      return NO;
    }
  }

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  request.HTTPMethod = method ?: @"POST";
  request.timeoutInterval = timeout;
  if (bodyData) {
    request.HTTPBody = bodyData;
    [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
  }

  RJLogDebug(@"HTTP %@ %@ (bodyBytes=%lu timeout=%.1fs retry=%ld)",
             request.HTTPMethod ?: @"<nil>", RJRedactedURLForLogFromURL(url),
             (unsigned long)(bodyData ? bodyData.length : 0), timeout,
             (long)retryCount);

  NSDictionary *headers = [self authHeaders];
  for (NSString *key in headers.allKeys) {
    [request setValue:headers[key] forHTTPHeaderField:key];
  }

  __block BOOL success = NO;
  __block NSData *responseData = nil;
  __block NSInteger statusCode = 0;
  __block NSString *errorDesc = nil;
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);

  NSURLSessionConfiguration *config =
      [NSURLSessionConfiguration defaultSessionConfiguration];
  config.timeoutIntervalForRequest = timeout;
  config.timeoutIntervalForResource = timeout;

  NSURLSession *session = [NSURLSession sessionWithConfiguration:config];

  NSURLSessionDataTask *task = [session
      dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response,
                            NSError *error) {
          if (!error && [response isKindOfClass:[NSHTTPURLResponse class]]) {
            NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
            statusCode = http.statusCode;
            success = (statusCode >= 200 && statusCode < 300);
            responseData = data;
          } else {
            errorDesc = error.localizedDescription;
            RJLogError(@"HTTP %@ %@ failed: %@", request.HTTPMethod ?: @"<nil>",
                       RJRedactedURLForLogFromURL(url),
                       errorDesc ?: @"<unknown>");
          }
          dispatch_semaphore_signal(semaphore);
        }];

  [task resume];
  dispatch_time_t timeoutTime =
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC));
  long waitResult = dispatch_semaphore_wait(semaphore, timeoutTime);
  [session finishTasksAndInvalidate];

  // Check if we timed out waiting for the request
  if (waitResult != 0) {
    RJLogInfo(@"[RJ-HTTP] Request TIMED OUT waiting for response: %@ %@",
              request.HTTPMethod ?: @"<nil>", urlString);
    success = NO;
  }

  RJLogInfo(
      @"[RJ-HTTP] %@ %@ -> status=%ld, success=%d, respBytes=%lu, error=%@",
      request.HTTPMethod ?: @"<nil>", urlString, (long)statusCode, success,
      (unsigned long)(responseData ? responseData.length : 0),
      errorDesc ?: @"none");

  RJLogDebug(@"HTTP %@ %@ -> status=%ld ok=%@ respBytes=%lu",
             request.HTTPMethod ?: @"<nil>", RJRedactedURLForLogFromURL(url),
             (long)statusCode, success ? @"YES" : @"NO",
             (unsigned long)(responseData ? responseData.length : 0));

  if (!success && statusCode == 401 && retryCount > 0) {
    RJLogDebug(@"Request failed with 401, attempting token refresh with "
               @"auto-register and retry...");

    __block BOOL refreshSuccess = NO;
    dispatch_semaphore_t refreshSem = dispatch_semaphore_create(0);

    [[RJDeviceAuthManager sharedManager]
        getUploadTokenWithAutoRegisterCompletion:^(
            BOOL tokenSuccess, NSString *token, NSInteger expiresIn,
            NSError *error) {
          refreshSuccess = tokenSuccess;
          dispatch_semaphore_signal(refreshSem);
        }];

    dispatch_semaphore_wait(
        refreshSem,
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(15.0 * NSEC_PER_SEC)));

    if (refreshSuccess) {
      RJLogDebug(@"Token refresh successful, retrying request...");
      return [self sendJSONRequestTo:urlString
                              method:method
                                body:body
                          timeoutSec:timeout
                          retryCount:retryCount - 1
                        responseJSON:responseJSON];
    } else {
      RJLogError(@"Token refresh failed, cannot retry request");
    }
  }

  if (!success) {
    RJLogError(@"Request to %@ failed (status %ld)%@",
               RJRedactedURLForLogFromString(urlString), (long)statusCode,
               (errorDesc.length > 0)
                   ? [NSString stringWithFormat:@" err=%@", errorDesc]
                   : @"");
    return NO;
  }

  if (responseJSON && responseData) {
    NSError *parseError = nil;
    NSDictionary *json = [NSJSONSerialization JSONObjectWithData:responseData
                                                         options:0
                                                           error:&parseError];
    if (!parseError && [json isKindOfClass:[NSDictionary class]]) {
      *responseJSON = json;
    }
  }

  return YES;
}

- (BOOL)sendJSONRequestTo:(NSString *)urlString
                   method:(NSString *)method
                     body:(NSDictionary *)body
               timeoutSec:(NSTimeInterval)timeout
             responseJSON:(NSDictionary *__autoreleasing *)responseJSON {
  return [self sendJSONRequestTo:urlString
                          method:method
                            body:body
                      timeoutSec:timeout
                      retryCount:1
                    responseJSON:responseJSON];
}

- (BOOL)uploadData:(NSData *)data
    toPresignedURL:(NSString *)urlString
       contentType:(NSString *)contentType {

  NSURL *url = [NSURL URLWithString:urlString];
  if (!url) {
    RJLogError(@"Invalid presigned URL");
    return NO;
  }

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  request.HTTPMethod = @"PUT";
  request.HTTPBody = data;
  request.timeoutInterval = RJNetworkResourceTimeout;
  [request setValue:contentType forHTTPHeaderField:@"Content-Type"];
  [request setValue:[NSString
                        stringWithFormat:@"%lu", (unsigned long)data.length]
      forHTTPHeaderField:@"Content-Length"];

  RJLogDebug(@"PUT %@ (bytes=%lu type=%@ timeout=%.1fs)",
             RJRedactedURLForLogFromURL(url), (unsigned long)data.length,
             contentType ?: @"<nil>", RJNetworkResourceTimeout);

  __block BOOL success = NO;
  __block NSInteger statusCode = 0;
  NSTimeInterval start = [[NSDate date] timeIntervalSince1970];
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);

  NSURLSessionConfiguration *config =
      [NSURLSessionConfiguration defaultSessionConfiguration];
  config.timeoutIntervalForRequest = RJNetworkResourceTimeout;
  config.timeoutIntervalForResource = RJNetworkResourceTimeout;
  NSURLSession *session = [NSURLSession sessionWithConfiguration:config];

  NSURLSessionDataTask *task = [session
      dataTaskWithRequest:request
        completionHandler:^(NSData *dataResp, NSURLResponse *response,
                            NSError *error) {
          if (!error && [response isKindOfClass:[NSHTTPURLResponse class]]) {
            NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
            statusCode = http.statusCode;
            success = (http.statusCode >= 200 && http.statusCode < 300);
            if (!success) {
              RJLogError(@"Presigned upload failed with status %ld",
                         (long)http.statusCode);
            }
          } else {
            RJLogError(@"Presigned upload error: %@",
                       error.localizedDescription);
          }
          dispatch_semaphore_signal(semaphore);
        }];

  [task resume];
  dispatch_time_t timeout = dispatch_time(
      DISPATCH_TIME_NOW, (int64_t)(RJNetworkResourceTimeout * NSEC_PER_SEC));
  dispatch_semaphore_wait(semaphore, timeout);
  [session finishTasksAndInvalidate];

  NSTimeInterval elapsedMs =
      ([[NSDate date] timeIntervalSince1970] - start) * 1000.0;
  RJLogDebug(@"PUT %@ -> status=%ld ok=%@ (%.0fms)",
             RJRedactedURLForLogFromURL(url), (long)statusCode,
             success ? @"YES" : @"NO", elapsedMs);

  return success;
}

- (BOOL)presignForContentType:(NSString *)contentType
                  batchNumber:(NSInteger)batchNumber
                    sizeBytes:(NSUInteger)sizeBytes
                   isKeyframe:(BOOL)isKeyframe
                       result:(NSDictionary *__autoreleasing *)result {

  if (![self ensureAttestation]) {
    RJLogError(@"Attestation failed; blocking presign");
    return NO;
  }

  NSMutableDictionary *body = [NSMutableDictionary dictionary];
  body[@"batchNumber"] = @(batchNumber);
  body[@"contentType"] = contentType;
  body[@"sizeBytes"] = @(sizeBytes);
  body[@"userId"] = self.userId ?: @"anonymous";
  body[@"sessionId"] = self.sessionId ?: @"";
  body[@"sessionStartTime"] = @(self.sessionStartTime * 1000);

  NSString *urlString =
      [NSString stringWithFormat:@"%@/api/ingest/presign", self.apiUrl];

  RJLogInfo(
      @"[RJ-PRESIGN] Requesting presign for sessionId=%@, contentType=%@, "
      @"batch=%ld, sizeBytes=%lu, userId=%@, apiUrl=%@",
      self.sessionId ?: @"<nil>", contentType, (long)batchNumber,
      (unsigned long)sizeBytes, self.userId ?: @"anonymous",
      self.apiUrl ?: @"<nil>");

  RJLogDebug(@"Presign %@ batch=%ld bytes=%lu keyframe=%@ -> %@", contentType,
             (long)batchNumber, (unsigned long)sizeBytes,
             isKeyframe ? @"YES" : @"NO",
             RJRedactedURLForLogFromString(urlString));
  NSDictionary *presignResponse = nil;
  BOOL ok = [self sendJSONRequestTo:urlString
                             method:@"POST"
                               body:body
                         timeoutSec:RJNetworkRequestTimeout
                       responseJSON:&presignResponse];

  RJLogInfo(@"[RJ-PRESIGN] Presign result: ok=%d, sessionId=%@, hasResponse=%d",
            ok, self.sessionId ?: @"<nil>", presignResponse != nil);

  if (ok && presignResponse) {

    if ([presignResponse[@"skipUpload"] boolValue]) {
      RJLogDebug(@"Server indicated skip upload for %@ (recording disabled)",
                 contentType);
      if (result) {
        *result = presignResponse;
      }

      return YES;
    }

    if (presignResponse[@"sessionId"]) {
      self.sessionId = presignResponse[@"sessionId"];
    }
    if (result) {
      *result = presignResponse;
    }

    NSString *batchId = presignResponse[@"batchId"];
    if (batchId.length > 0) {
      RJLogDebug(@"Presign ok %@ batch=%ld batchId=%@ sessionId=%@",
                 contentType, (long)batchNumber, batchId,
                 self.sessionId ?: @"");
    }
  }

  return ok;
}

- (BOOL)ensureAttestation {

  if (!self.deviceAuthManager) {
    self.deviceAuthManager = [RJDeviceAuthManager sharedManager];
  }

  if ([self.deviceAuthManager hasValidUploadToken]) {
    return YES;
  }

  NSString *credentialId = [self.deviceAuthManager deviceCredentialId];
  if (credentialId.length > 0) {
    RJLogDebug(@"Device registered, waiting for upload token");
    return YES;
  }

  RJLogWarning(@"Device not yet registered for authentication");
  return YES;
}

- (BOOL)completeBatchWithId:(NSString *)batchId
            actualSizeBytes:(NSUInteger)actualSize
                 eventCount:(NSUInteger)eventCount
                 frameCount:(NSUInteger)frameCount {

  if (!batchId || batchId.length == 0)
    return NO;

  NSString *urlString =
      [NSString stringWithFormat:@"%@/api/ingest/batch/complete", self.apiUrl];
  NSDictionary *body = @{
    @"batchId" : batchId,
    @"actualSizeBytes" : @(actualSize),
    @"eventCount" : @(eventCount),
    @"frameCount" : @(frameCount),
    @"userId" : self.userId ?: @"anonymous"
  };

  RJLogDebug(@"Complete batch batchId=%@ bytes=%lu events=%lu frames=%lu -> %@",
             batchId, (unsigned long)actualSize, (unsigned long)eventCount,
             (unsigned long)frameCount,
             RJRedactedURLForLogFromString(urlString));

  return [self sendJSONRequestTo:urlString
                          method:@"POST"
                            body:body
                      timeoutSec:RJNetworkRequestTimeout
                    responseJSON:nil];
}

- (BOOL)endSessionSync {
  return [self endSessionSyncWithEndedAt:0 timeout:RJNetworkRequestTimeout];
}

- (BOOL)endSessionSyncWithTimeout:(NSTimeInterval)timeout {
  return [self endSessionSyncWithEndedAt:0 timeout:timeout];
}

- (BOOL)endSessionSyncWithEndedAt:(NSTimeInterval)endedAtOverride
                          timeout:(NSTimeInterval)timeout {
  if (!self.sessionId || self.sessionId.length == 0)
    return YES;

  NSString *urlString =
      [NSString stringWithFormat:@"%@/api/ingest/session/end", self.apiUrl];

  NSNumber *endedAt;
  if (endedAtOverride > 0) {
    endedAt = @((NSUInteger)endedAtOverride);
  } else {
    endedAt = @((NSUInteger)([[NSDate date] timeIntervalSince1970] * 1000));
  }

  NSMutableDictionary *body = [NSMutableDictionary dictionary];
  body[@"sessionId"] = self.sessionId;
  body[@"endedAt"] = endedAt;

  RJLogInfo(@"[RJ-SESSION-END] Sending session/end: sessionId=%@, endedAt=%@, "
            @"totalBackgroundTimeMs=%.1f",
            self.sessionId, endedAt, self.totalBackgroundTimeMs);

  if (self.totalBackgroundTimeMs > 0) {
    body[@"totalBackgroundTimeMs"] = @(self.totalBackgroundTimeMs);
    RJLogInfo(
        @"[RJ-SESSION-END] Including totalBackgroundTimeMs=%.1f in request",
        self.totalBackgroundTimeMs);
  } else {
    RJLogInfo(@"[RJ-SESSION-END] totalBackgroundTimeMs is 0, not including in "
              @"request");
  }

  NSDictionary *telemetry = [[RJTelemetry sharedInstance] metricsAsDictionary];
  if (telemetry && telemetry.count > 0) {
    body[@"sdkTelemetry"] = telemetry;
  }

  BOOL ok = [self sendJSONRequestTo:urlString
                             method:@"POST"
                               body:body
                         timeoutSec:timeout
                       responseJSON:nil];

  if (ok) {

    NSString *dir =
        [self.pendingRootPath stringByAppendingPathComponent:self.sessionId];
    NSArray<NSString *> *files =
        [[NSFileManager defaultManager] contentsOfDirectoryAtPath:dir error:nil]
            ?: @[];
    NSArray<NSString *> *remaining =
        [files filteredArrayUsingPredicate:
                   [NSPredicate predicateWithFormat:@"SELF ENDSWITH '.gz'"]];
    if (remaining.count == 0) {
      [self clearSessionRecovery:self.sessionId];
    }
  }

  return ok;
}

#pragma mark - Presign Flow (Events)

- (BOOL)uploadEventsSync:(NSArray<NSDictionary *> *)events
                 isFinal:(BOOL)isFinal {

  if (self.sessionId.length > 0) {
    if (![self flushPendingUploadsForSessionSync:self.sessionId]) {
      return NO;
    }
  }

  if (events.count > 0) {
    if (![self uploadEventsBatchSync:events isFinal:isFinal]) {
      return NO;
    }
  }

  if (isFinal) {
    if (![self endSessionSync]) {
      RJLogWarning(@"Session end call failed");

      return NO;
    }
  }

  return YES;
}

- (void)persistTerminationEvents:(NSArray<NSDictionary *> *)events {
  if (events.count == 0 && self.sessionId.length == 0)
    return;

  self.eventBatchNumber += 1;
  NSInteger currentBatch = self.eventBatchNumber;

  RJLogInfo(@"[RJ-UPLOAD] persistTerminationEvents starting: sessionId=%@, "
            @"batch=%ld, "
            @"eventCount=%lu",
            self.sessionId ?: @"<nil>", (long)currentBatch,
            (unsigned long)events.count);

  NSDictionary *payload = [self buildEventPayloadWithEvents:events
                                                batchNumber:currentBatch
                                                    isFinal:YES];
  if (!payload)
    return;

  NSError *jsonError = nil;
  NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload
                                                     options:0
                                                       error:&jsonError];
  if (jsonError || !jsonData)
    return;

  NSError *gzipError = nil;
  NSData *compressed = RJGzipData(jsonData, &gzipError);
  if (gzipError || !compressed)
    return;

  [self persistPendingUploadWithContentType:@"events"
                                batchNumber:currentBatch
                                   keyframe:NO
                                    gzipped:compressed
                                 eventCount:events.count
                                 frameCount:0];

  [self markSessionActiveForRecovery];

  RJLogInfo(@"[RJ-CHECKPOINT] Persisted termination events to disk, skipping "
            @"sync upload");
}

- (BOOL)uploadEventsBatchSync:(NSArray<NSDictionary *> *)events
                      isFinal:(BOOL)isFinal {
  self.eventBatchNumber += 1;
  NSInteger currentBatch = self.eventBatchNumber;

  RJLogInfo(
      @"[RJ-UPLOAD] uploadEventsBatchSync starting: sessionId=%@, batch=%ld, "
      @"eventCount=%lu, isFinal=%d",
      self.sessionId ?: @"<nil>", (long)currentBatch,
      (unsigned long)events.count, isFinal);

  NSDictionary *payload = [self buildEventPayloadWithEvents:events
                                                batchNumber:currentBatch
                                                    isFinal:isFinal];
  if (!payload) {
    RJLogError(@"Failed to build events payload");
    [[RJTelemetry sharedInstance] recordEvent:RJTelemetryEventUploadFailure];
    return NO;
  }

  NSError *jsonError = nil;
  NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload
                                                     options:0
                                                       error:&jsonError];
  if (jsonError || !jsonData) {
    RJLogError(@"Failed to serialize events payload: %@", jsonError);
    [[RJTelemetry sharedInstance] recordEvent:RJTelemetryEventUploadFailure];
    return NO;
  }

  NSError *gzipError = nil;
  NSData *compressed = RJGzipData(jsonData, &gzipError);
  if (gzipError || !compressed) {
    RJLogError(@"Failed to gzip events payload: %@", gzipError);
    [[RJTelemetry sharedInstance] recordEvent:RJTelemetryEventUploadFailure];
    return NO;
  }

  RJLogDebug(@"Events batch=%ld (sessionId=%@ isFinal=%@) jsonBytes=%lu "
             @"gzipBytes=%lu events=%lu",
             (long)currentBatch, self.sessionId ?: @"",
             isFinal ? @"YES" : @"NO", (unsigned long)jsonData.length,
             (unsigned long)compressed.length, (unsigned long)events.count);

  [self persistPendingUploadWithContentType:@"events"
                                batchNumber:currentBatch
                                   keyframe:NO
                                    gzipped:compressed
                                 eventCount:events.count
                                 frameCount:0];
  [self markSessionActiveForRecovery];

  NSTimeInterval startTime = [[NSDate date] timeIntervalSince1970] * 1000;

  NSDictionary *presign = nil;
  BOOL presignOk = [self presignForContentType:@"events"
                                   batchNumber:currentBatch
                                     sizeBytes:compressed.length
                                    isKeyframe:NO
                                        result:&presign];
  if (!presignOk || !presign) {
    [[RJTelemetry sharedInstance] recordEvent:RJTelemetryEventUploadFailure];
    return NO;
  }

  NSString *uploadUrl = presign[@"presignedUrl"];
  NSString *batchId = presign[@"batchId"];
  if (![self uploadData:compressed
          toPresignedURL:uploadUrl
             contentType:@"application/gzip"]) {
    [[RJTelemetry sharedInstance] recordEvent:RJTelemetryEventUploadFailure];
    return NO;
  }

  BOOL success = [self completeBatchWithId:batchId
                           actualSizeBytes:compressed.length
                                eventCount:events.count
                                frameCount:0];

  RJLogDebug(@"Events batch=%ld complete ok=%@", (long)currentBatch,
             success ? @"YES" : @"NO");

  if (success) {
    NSString *dir = [self pendingSessionDir:self.sessionId];
    NSString *name = [self pendingFilenameForContentType:@"events"
                                             batchNumber:currentBatch
                                                keyframe:NO];
    NSString *path = [dir stringByAppendingPathComponent:name];
    [[NSFileManager defaultManager] removeItemAtPath:path error:nil];
    [[NSFileManager defaultManager]
        removeItemAtPath:[path stringByAppendingString:@".meta.json"]
                   error:nil];
  }

  NSTimeInterval endTime = [[NSDate date] timeIntervalSince1970] * 1000;
  NSTimeInterval durationMs = endTime - startTime;

  [[RJTelemetry sharedInstance] recordUploadDuration:durationMs
                                             success:success
                                           byteCount:compressed.length];

  return success;
}

#pragma mark - Retry & Resilience

- (NSString *)failedUploadsPath {
  NSArray *paths = NSSearchPathForDirectoriesInDomains(NSCachesDirectory,
                                                       NSUserDomainMask, YES);
  NSString *cacheDir = paths.firstObject;
  return [cacheDir stringByAppendingPathComponent:@"rj_failed_uploads.plist"];
}

static const NSInteger kCircuitBreakerThreshold = 5;
static const NSTimeInterval kCircuitBreakerTimeout = 60.0;
static const NSTimeInterval kMaxRetryDelay = 60.0;

- (void)persistPendingUploads {
  dispatch_async(self.uploadQueue, ^{
    @try {
      if (self.retryQueue.count == 0) {
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

      [allPending addObjectsFromArray:self.retryQueue];

      if (allPending.count > 100) {
        allPending = [[allPending
            subarrayWithRange:NSMakeRange(allPending.count - 100, 100)]
            mutableCopy];
      }

      BOOL success = [allPending writeToFile:path atomically:YES];
      if (success) {
        RJLogDebug(@"Persisted %lu failed uploads to disk",
                   (unsigned long)allPending.count);
        [self.retryQueue removeAllObjects];
      } else {
        RJLogWarning(@"Failed to persist uploads to disk");
      }
    } @catch (NSException *exception) {
      RJLogWarning(@"Persist uploads exception: %@", exception);
    }
  });
}

- (void)loadAndRetryPersistedUploads {
  dispatch_async(self.uploadQueue, ^{
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

      [self.retryQueue addObjectsFromArray:persisted];

      [self scheduleRetryIfNeeded];
    } @catch (NSException *exception) {
      RJLogWarning(@"Load persisted uploads exception: %@", exception);
    }
  });
}

- (void)addToRetryQueueWithEvents:(NSArray<NSDictionary *> *)events {
  if (self.isShuttingDown)
    return;

  dispatch_async(self.uploadQueue, ^{
    @try {
      NSDictionary *retryItem = @{
        @"events" : events ?: @[],
        @"timestamp" : @([[NSDate date] timeIntervalSince1970]),
        @"attemptCount" : @0
      };

      [self.retryQueue addObject:retryItem];
      RJLogDebug(@"Added batch to retry queue (queue size: %lu)",
                 (unsigned long)self.retryQueue.count);

      [self scheduleRetryIfNeeded];
    } @catch (NSException *exception) {
      RJLogWarning(@"Add to retry queue exception: %@", exception);
    }
  });
}

- (void)scheduleRetryIfNeeded {

  if (self.isRetryScheduled || self.retryQueue.count == 0 ||
      self.isShuttingDown) {
    return;
  }

  if (self.isCircuitOpen) {
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
    if (now - self.circuitOpenedTime < kCircuitBreakerTimeout) {
      RJLogDebug(@"Circuit breaker open, waiting %.0fs before retry",
                 kCircuitBreakerTimeout - (now - self.circuitOpenedTime));
      return;
    }

    RJLogDebug(@"Circuit breaker entering half-open state");
    self.isCircuitOpen = NO;
  }

  self.isRetryScheduled = YES;

  NSTimeInterval delay =
      MIN(pow(2.0, self.consecutiveFailureCount), kMaxRetryDelay);

  RJLogDebug(@"Scheduling retry in %.1fs (consecutive failures: %ld)", delay,
             (long)self.consecutiveFailureCount);

  __weak typeof(self) weakSelf = self;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)),
      self.uploadQueue, ^{
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf || strongSelf.isShuttingDown)
          return;

        strongSelf.isRetryScheduled = NO;
        [strongSelf processRetryQueue];
      });
}

- (void)processRetryQueue {

  if (self.retryQueue.count == 0 || self.isUploading || self.isShuttingDown) {
    return;
  }

  NSDictionary *item = self.retryQueue.firstObject;
  NSArray *events = item[@"events"];
  NSInteger attemptCount = [item[@"attemptCount"] integerValue];

  [self.retryQueue removeObjectAtIndex:0];

  RJLogDebug(@"Retrying batch (attempt %ld, remaining: %lu)",
             (long)(attemptCount + 1), (unsigned long)self.retryQueue.count);

  self.isUploading = YES;

  __weak typeof(self) weakSelf = self;
  dispatch_async(self.uploadQueue, ^{
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (!strongSelf)
      return;

    BOOL success = NO;
    @try {
      success = [strongSelf uploadEventsSync:events isFinal:NO];
    } @catch (NSException *exception) {
      RJLogWarning(@"Retry upload exception: %@", exception);
      success = NO;
    }

    dispatch_async(dispatch_get_main_queue(), ^{
      strongSelf.isUploading = NO;

      if (success) {

        strongSelf.consecutiveFailureCount = 0;
        strongSelf.isCircuitOpen = NO;
        RJLogDebug(@"Retry upload succeeded");

        if (strongSelf.retryQueue.count > 0) {
          [strongSelf scheduleRetryIfNeeded];
        }
      } else {

        strongSelf.consecutiveFailureCount++;

        if (strongSelf.consecutiveFailureCount >= kCircuitBreakerThreshold) {
          strongSelf.isCircuitOpen = YES;
          strongSelf.circuitOpenedTime = [[NSDate date] timeIntervalSince1970];
          RJLogWarning(@"Circuit breaker opened after %ld failures",
                       (long)strongSelf.consecutiveFailureCount);
        }

        if (attemptCount < 5) {
          NSMutableDictionary *updatedItem = [item mutableCopy];
          updatedItem[@"attemptCount"] = @(attemptCount + 1);
          [strongSelf.retryQueue addObject:updatedItem];
          RJLogDebug(@"Re-queued failed batch (attempt %ld)",
                     (long)(attemptCount + 1));
        } else {
          RJLogWarning(@"Batch exceeded max retries, discarding");
        }

        [strongSelf scheduleRetryIfNeeded];
      }
    });
  });
}

- (void)recordUploadSuccess {
  self.consecutiveFailureCount = 0;
  [[RJTelemetry sharedInstance] recordEvent:RJTelemetryEventUploadSuccess];
  if (self.isCircuitOpen) {
    RJLogDebug(@"Upload succeeded, closing circuit breaker");
    self.isCircuitOpen = NO;
    [[RJTelemetry sharedInstance]
        recordEvent:RJTelemetryEventCircuitBreakerClose];
  }
}

- (void)recordUploadFailure {
  self.consecutiveFailureCount++;
  [[RJTelemetry sharedInstance] recordEvent:RJTelemetryEventUploadFailure];
  if (self.consecutiveFailureCount >= kCircuitBreakerThreshold &&
      !self.isCircuitOpen) {
    self.isCircuitOpen = YES;
    self.circuitOpenedTime = [[NSDate date] timeIntervalSince1970];
    [[RJTelemetry sharedInstance]
        recordEvent:RJTelemetryEventCircuitBreakerOpen];
    RJLogWarning(@"Circuit breaker opened after %ld consecutive failures",
                 (long)self.consecutiveFailureCount);
  }
}

#pragma mark - Background Task Management

- (UIBackgroundTaskIdentifier)beginBackgroundTaskWithName:(NSString *)name {
  __block UIBackgroundTaskIdentifier taskId = UIBackgroundTaskInvalid;

  __weak typeof(self) weakSelf = self;
  taskId = [[UIApplication sharedApplication]
      beginBackgroundTaskWithName:name
                expirationHandler:^{
                  __strong typeof(weakSelf) strongSelf = weakSelf;
                  RJLogWarning(@"Background task '%@' expired - saving state",
                               name);

                  if (strongSelf) {
                    [strongSelf persistPendingUploads];
                  }

                  [[UIApplication sharedApplication] endBackgroundTask:taskId];
                }];

  return taskId;
}

- (void)endBackgroundTask:(UIBackgroundTaskIdentifier)taskId {
  if (taskId != UIBackgroundTaskInvalid) {
    [[UIApplication sharedApplication] endBackgroundTask:taskId];
  }
}

#pragma mark - State Reset

- (void)resetForNewSession {
  @try {

    if (self.activeTask) {
      [self.activeTask cancel];
      self.activeTask = nil;
    }

    self.sessionId = nil;
    self.userId = nil;
    self.sessionStartTime = 0;
    self.batchNumber = 0;
    self.eventBatchNumber = 0;
    self.lastUploadTime = 0;
    self.isUploading = NO;
  } @catch (NSException *exception) {
    RJLogWarning(@"Session reset failed: %@", exception);
  }
}

- (void)shutdown {
  self.isShuttingDown = YES;

  if (self.activeTask) {
    [self.activeTask cancel];
    self.activeTask = nil;
  }

  [self stopBatchUploadTimer];
}

#pragma mark - Replay Promotion

- (void)evaluateReplayPromotionWithMetrics:(NSDictionary *)metrics
                                completion:
                                    (void (^)(BOOL promoted,
                                              NSString *reason))completion {
  if (!self.sessionId || self.sessionId.length == 0) {
    if (completion) {
      completion(NO, @"no_session");
    }
    return;
  }

  NSMutableDictionary *body = [NSMutableDictionary dictionary];
  body[@"sessionId"] = self.sessionId;
  body[@"metrics"] = metrics ?: @{};

  NSString *urlString =
      [NSString stringWithFormat:@"%@/api/ingest/replay/evaluate", self.apiUrl];

  RJLogDebug(@"Evaluating replay promotion for session: %@", self.sessionId);

  __weak typeof(self) weakSelf = self;
  dispatch_async(self.uploadQueue, ^{
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (!strongSelf) {
      if (completion) {
        dispatch_async(dispatch_get_main_queue(), ^{
          completion(NO, @"deallocated");
        });
      }
      return;
    }

    NSDictionary *response = nil;
    BOOL ok = [strongSelf sendJSONRequestTo:urlString
                                     method:@"POST"
                                       body:body
                                 timeoutSec:RJNetworkRequestTimeout
                               responseJSON:&response];

    dispatch_async(dispatch_get_main_queue(), ^{
      if (ok && response) {
        BOOL promoted = [response[@"promoted"] boolValue];
        NSString *reason = response[@"reason"] ?: @"unknown";

        strongSelf.isReplayPromoted = promoted;

        if (promoted) {
          RJLogDebug(@"Session promoted for replay upload (reason: %@)",
                     reason);
        } else {
          RJLogDebug(@"Session not promoted for replay (reason: %@)", reason);
        }

        if (completion) {
          completion(promoted, reason);
        }
      } else {
        RJLogWarning(@"Replay promotion evaluation failed");
        strongSelf.isReplayPromoted = NO;
        if (completion) {
          completion(NO, @"request_failed");
        }
      }
    });
  });
}

@end
