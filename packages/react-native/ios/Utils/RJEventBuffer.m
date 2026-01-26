//
//  RJEventBuffer.m
//  Rejourney
//
//  Write-first event buffer implementation.
//  Events are persisted to disk immediately in JSONL format.
//
//  Copyright (c) 2026 Rejourney
//

#import "RJEventBuffer.h"
#import "../Core/RJLogger.h"

static void *kRJEventBufferQueueKey = &kRJEventBufferQueueKey;

@interface RJEventBuffer ()

@property(nonatomic, copy, readwrite) NSString *sessionId;
@property(nonatomic, copy, readwrite) NSString *pendingRootPath;
@property(nonatomic, strong) NSFileHandle *fileHandle;
@property(nonatomic, copy) NSString *eventsFilePath;
@property(nonatomic, assign, readwrite) NSInteger eventCount;
@property(nonatomic, assign, readwrite) NSTimeInterval lastEventTimestamp;
@property(nonatomic, strong) dispatch_queue_t writeQueue;
@property(nonatomic, assign) NSInteger uploadedEventCount;

@end

@implementation RJEventBuffer

#pragma mark - Initialization

- (instancetype)initWithSessionId:(NSString *)sessionId
                  pendingRootPath:(NSString *)pendingRootPath {
  self = [super init];
  if (self) {
    _sessionId = [sessionId copy];
    if (pendingRootPath.length == 0) {
      NSString *defaultPath =
          [NSSearchPathForDirectoriesInDomains(NSCachesDirectory,
                                               NSUserDomainMask, YES)
                  .firstObject stringByAppendingPathComponent:@"rj_pending"];
      _pendingRootPath = [defaultPath copy];
    } else {
      _pendingRootPath = [pendingRootPath copy];
    }
    _eventCount = 0;
    _lastEventTimestamp = 0;
    _uploadedEventCount = 0;
    _writeQueue = dispatch_queue_create("com.rejourney.eventbuffer",
                                        DISPATCH_QUEUE_SERIAL);
    dispatch_queue_set_specific(_writeQueue, kRJEventBufferQueueKey,
                                kRJEventBufferQueueKey, NULL);

    [self setupEventsFile];
  }
  return self;
}

- (void)dealloc {
  [self performWriteSync:^{
    [self closeFileHandle];
  }];
}

#pragma mark - File Setup

- (void)setupEventsFile {
  NSString *sessionDir =
      [self.pendingRootPath stringByAppendingPathComponent:self.sessionId];

  NSFileManager *fm = [NSFileManager defaultManager];
  if (![fm fileExistsAtPath:sessionDir]) {
    NSError *error = nil;
    [fm createDirectoryAtPath:sessionDir
        withIntermediateDirectories:YES
                         attributes:nil
                              error:&error];
    if (error) {
      RJLogError(@"Failed to create session directory: %@", error);
      return;
    }
  }

  self.eventsFilePath =
      [sessionDir stringByAppendingPathComponent:@"events.jsonl"];

  if (![fm fileExistsAtPath:self.eventsFilePath]) {
    NSDictionary *attrs = @{
      NSFileProtectionKey : NSFileProtectionCompleteUntilFirstUserAuthentication
    };
    [fm createFileAtPath:self.eventsFilePath contents:nil attributes:attrs];
  }

  NSError *error = nil;
  self.fileHandle =
      [NSFileHandle fileHandleForWritingAtPath:self.eventsFilePath];
  if (!self.fileHandle) {
    RJLogError(@"Failed to open events file for writing: %@",
               self.eventsFilePath);
    return;
  }

  if (@available(iOS 13.0, *)) {
    [self.fileHandle seekToEndReturningOffset:nil error:&error];
  } else {
    [self.fileHandle seekToEndOfFile];
  }

  [self countExistingEvents];

  RJLogDebug(@"Event buffer ready: %@ (%ld existing events)",
             self.eventsFilePath, (long)self.eventCount);
}

- (void)countExistingEvents {
  __block NSInteger count = 0;
  __block NSTimeInterval lastTs = 0;

  [self enumerateEventsWithBlock:^(NSDictionary *event, BOOL *stop) {
    count++;
    NSNumber *ts = event[@"timestamp"];
    if (ts && [ts doubleValue] > lastTs) {
      lastTs = [ts doubleValue];
    }
  }];

  self.eventCount = count;
  self.lastEventTimestamp = lastTs;
}

- (void)enumerateEventsWithBlock:(void (^)(NSDictionary *event,
                                           BOOL *stop))block {
  if (!block || !self.eventsFilePath)
    return;

  FILE *file = fopen([self.eventsFilePath UTF8String], "r");
  if (!file)
    return;

  char *line = NULL;
  size_t linecap = 0;
  ssize_t linelen;
  BOOL stop = NO;

  while (!stop && (linelen = getline(&line, &linecap, file)) > 0) {
    @autoreleasepool {
      if (linelen <= 1)
        continue;

      NSData *data = [NSData dataWithBytesNoCopy:line
                                          length:linelen
                                    freeWhenDone:NO];
      NSError *error = nil;
      NSDictionary *event = [NSJSONSerialization JSONObjectWithData:data
                                                            options:0
                                                              error:&error];
      if (event) {
        block(event, &stop);
      }
    }
  }
  if (line)
    free(line);
  fclose(file);
}

- (void)closeFileHandle {
  if (self.fileHandle) {
    if (@available(iOS 13.0, *)) {
      [self.fileHandle closeAndReturnError:nil];
    } else {
      [self.fileHandle closeFile];
    }
    self.fileHandle = nil;
  }
}

#pragma mark - Event Operations

- (void)performWriteSync:(dispatch_block_t)block {
  if (!block || !self.writeQueue) {
    return;
  }

  if (dispatch_get_specific(kRJEventBufferQueueKey)) {
    block();
  } else {
    dispatch_sync(self.writeQueue, block);
  }
}

- (BOOL)appendEvent:(NSDictionary *)event {
  if (!event)
    return NO;

  __block BOOL success = NO;

  [self performWriteSync:^{
    success = [self writeEventToDisk:event];
  }];

  return success;
}

- (BOOL)appendEvents:(NSArray<NSDictionary *> *)events {
  if (!events || events.count == 0)
    return YES;

  __block BOOL success = YES;

  [self performWriteSync:^{
    for (NSDictionary *event in events) {
      if (![self writeEventToDisk:event]) {
        success = NO;
      }
    }
  }];

  return success;
}

- (BOOL)writeEventToDisk:(NSDictionary *)event {
  if (!self.fileHandle) {
    RJLogWarning(@"Event buffer file handle not available");
    return NO;
  }

  @try {
    NSError *jsonError = nil;
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:event
                                                       options:0
                                                         error:&jsonError];
    if (jsonError || !jsonData) {
      RJLogWarning(@"Failed to serialize event: %@", jsonError);
      return NO;
    }

    NSMutableData *lineData = [jsonData mutableCopy];
    [lineData appendData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];

    if (@available(iOS 13.4, *)) {
      NSError *writeError = nil;
      [self.fileHandle writeData:lineData error:&writeError];
      if (writeError) {
        RJLogWarning(@"Failed to write event: %@", writeError);
        return NO;
      }
    } else {
      @try {
        [self.fileHandle writeData:lineData];
      } @catch (NSException *e) {
        RJLogWarning(@"Failed to write event: %@", e);
        return NO;
      }
    }

    // Removed redundant synchronizeFile (fsync) calls to improve performance.
    // The serial writeQueue ensures order, and the OS will manage buffering.

    self.eventCount++;
    NSNumber *ts = event[@"timestamp"];
    if (ts) {
      self.lastEventTimestamp = [ts doubleValue];
    }

    return YES;

  } @catch (NSException *exception) {
    RJLogError(@"Exception writing event: %@", exception);
    return NO;
  }
}

- (NSArray<NSDictionary *> *)readAllEvents {
  __block NSMutableArray<NSDictionary *> *events = [NSMutableArray new];

  [self performWriteSync:^{
    [self enumerateEventsWithBlock:^(NSDictionary *event, BOOL *stop) {
      [events addObject:event];
    }];
  }];

  return events;
}

- (NSArray<NSDictionary *> *)readEventsAfterBatchNumber:
    (NSInteger)afterBatchNumber {

  NSArray<NSDictionary *> *allEvents = [self readAllEvents];

  __block NSInteger uploadedCount = 0;
  [self performWriteSync:^{
    uploadedCount = self.uploadedEventCount;
  }];

  NSInteger startIndex = MAX(uploadedCount, MAX(0, afterBatchNumber));
  if (startIndex >= allEvents.count) {
    return @[];
  }

  return [allEvents
      subarrayWithRange:NSMakeRange(startIndex, allEvents.count - startIndex)];
}

- (void)markEventsUploadedUpToIndex:(NSInteger)eventIndex {
  [self performWriteSync:^{
    self.uploadedEventCount = eventIndex;

    NSString *metaPath =
        [[self.eventsFilePath stringByDeletingLastPathComponent]
            stringByAppendingPathComponent:@"buffer_meta.json"];
    NSDictionary *meta = @{
      @"uploadedEventCount" : @(self.uploadedEventCount),
      @"lastEventTimestamp" : @(self.lastEventTimestamp)
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:meta
                                                   options:0
                                                     error:nil];
    [data writeToFile:metaPath atomically:YES];
  }];
}

- (void)clearAllEvents {
  [self performWriteSync:^{
    [self closeFileHandle];

    NSFileManager *fm = [NSFileManager defaultManager];
    [fm removeItemAtPath:self.eventsFilePath error:nil];

    NSString *metaPath =
        [[self.eventsFilePath stringByDeletingLastPathComponent]
            stringByAppendingPathComponent:@"buffer_meta.json"];
    [fm removeItemAtPath:metaPath error:nil];

    self.eventCount = 0;
    self.uploadedEventCount = 0;
    self.lastEventTimestamp = 0;
  }];
}

- (NSTimeInterval)lastEventTimestampMs {
  return self.lastEventTimestamp;
}

@end
