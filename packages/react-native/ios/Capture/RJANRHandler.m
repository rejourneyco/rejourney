//
//  RJANRHandler.m
//  Rejourney
//
//  Watchdog-based ANR detection for iOS with main thread stack capture.
//

#import "RJANRHandler.h"
#import "../Core/RJLogger.h"
#import <UIKit/UIKit.h>
#import <mach/mach.h>
#import <pthread.h>

static NSString *const kRJANRReportFileName = @"rj_anr_report.json";
static NSString *const kRJCurrentSessionIdKey = @"rj_current_session_id";

static const NSTimeInterval kDefaultANRThreshold = 5.0;

static const NSTimeInterval kWatchdogInterval = 2.0;

@interface RJANRHandler ()
@property(nonatomic, strong, nullable) dispatch_queue_t watchdogQueue;
@property(nonatomic, strong, nullable) dispatch_source_t watchdogTimer;
@property(nonatomic, assign) BOOL isMonitoring;
@property(nonatomic, assign) CFAbsoluteTime lastPingTime;
@property(nonatomic, assign) BOOL mainThreadResponded;
@end

@implementation RJANRHandler

+ (instancetype)sharedInstance {
  static RJANRHandler *sharedInstance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    sharedInstance = [[self alloc] init];
  });
  return sharedInstance;
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _threshold = kDefaultANRThreshold;
    _isMonitoring = NO;
    _mainThreadResponded = YES;
  }
  return self;
}

- (void)startMonitoring {
  if (self.isMonitoring) {
    return;
  }

  self.isMonitoring = YES;
  self.mainThreadResponded = YES;
  self.lastPingTime = CFAbsoluteTimeGetCurrent();

  
  
  self.watchdogQueue = dispatch_queue_create("com.rejourney.anr.watchdog",
                                             DISPATCH_QUEUE_SERIAL);
  dispatch_set_target_queue(
      self.watchdogQueue,
      dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0));

  
  self.watchdogTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0,
                                              self.watchdogQueue);

  dispatch_source_set_timer(
      self.watchdogTimer,
      dispatch_time(DISPATCH_TIME_NOW,
                    (int64_t)(kWatchdogInterval * NSEC_PER_SEC)),
      (int64_t)(kWatchdogInterval * NSEC_PER_SEC),
      (int64_t)(0.1 * NSEC_PER_SEC)); 

  __weak typeof(self) weakSelf = self;
  dispatch_source_set_event_handler(self.watchdogTimer, ^{
    [weakSelf checkMainThread];
  });

  dispatch_resume(self.watchdogTimer);
  RJLogDebug(@"RJANRHandler started monitoring (threshold: %.1fs)",
             self.threshold);
}

- (void)stopMonitoring {
  if (!self.isMonitoring) {
    return;
  }

  self.isMonitoring = NO;

  if (self.watchdogTimer) {
    dispatch_source_cancel(self.watchdogTimer);
    self.watchdogTimer = nil;
  }

  self.watchdogQueue = nil;
  RJLogDebug(@"RJANRHandler stopped monitoring");
}

- (void)checkMainThread {
  if (!self.isMonitoring) {
    return;
  }

  CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();

  
  if (!self.mainThreadResponded) {
    NSTimeInterval elapsed = now - self.lastPingTime;

    if (elapsed >= self.threshold) {
      
      [self handleANRWithDuration:elapsed];
      
      self.mainThreadResponded = YES;
    }
    return;
  }

  
  self.mainThreadResponded = NO;
  self.lastPingTime = now;

  
  
  CFAbsoluteTime pingTime = now;

  __weak typeof(self) weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    CFAbsoluteTime responseTime = CFAbsoluteTimeGetCurrent();
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (!strongSelf) {
      return;
    }

    
    dispatch_async(strongSelf.watchdogQueue, ^{
      if (!strongSelf.isMonitoring) {
        return;
      }

      NSTimeInterval elapsed = responseTime - pingTime;
      
      
      
      
      NSTimeInterval effectiveThreshold = strongSelf.threshold * 0.9;
      if (!strongSelf.mainThreadResponded && elapsed >= effectiveThreshold) {
        [strongSelf handleANRWithDuration:elapsed];
      }

      strongSelf.mainThreadResponded = YES;
    });
  });
}

- (void)handleANRWithDuration:(NSTimeInterval)duration {
  RJLogDebug(@"[ANR] ANR DETECTED! Duration: %.2fs - main thread blocked",
             duration);

  
  
  NSString *threadState = [self captureThreadState];
  RJLogDebug(@"[ANR] Captured thread state (%lu bytes)",
             (unsigned long)threadState.length);

  
  NSDictionary *report = [self buildANRReportWithDuration:duration
                                              threadState:threadState];

  
  [self persistANRReport:report];

  
  
  if ([self.delegate respondsToSelector:@selector(anrDetectedWithDuration:
                                                              threadState:)]) {
    [self.delegate anrDetectedWithDuration:duration threadState:threadState];
  }
}

- (NSString *)captureThreadState {
  
  
  

  NSMutableString *threadState = [NSMutableString new];

  
  thread_act_array_t threads;
  mach_msg_type_number_t threadCount;

  if (task_threads(mach_task_self(), &threads, &threadCount) == KERN_SUCCESS &&
      threadCount > 0) {
    
    thread_t mainThread = threads[0];

    [threadState appendString:@"Main Thread Stack (blocked):\n"];

    
#if defined(__arm64__)
    arm_thread_state64_t state;
    mach_msg_type_number_t stateCount = ARM_THREAD_STATE64_COUNT;
    if (thread_get_state(mainThread, ARM_THREAD_STATE64, (thread_state_t)&state,
                         &stateCount) == KERN_SUCCESS) {
      [threadState
          appendFormat:@"PC: 0x%llx\n", arm_thread_state64_get_pc(state)];
      [threadState appendFormat:@"LR: 0x%llx\n", (uint64_t)state.__lr];
      [threadState
          appendFormat:@"SP: 0x%llx\n", arm_thread_state64_get_sp(state)];
    }
#elif defined(__x86_64__)
    x86_thread_state64_t state;
    mach_msg_type_number_t stateCount = x86_THREAD_STATE64_COUNT;
    if (thread_get_state(mainThread, x86_THREAD_STATE64, (thread_state_t)&state,
                         &stateCount) == KERN_SUCCESS) {
      [threadState appendFormat:@"RIP: 0x%llx\n", state.__rip];
      [threadState appendFormat:@"RSP: 0x%llx\n", state.__rsp];
    }
#endif

    
    for (mach_msg_type_number_t i = 0; i < threadCount; i++) {
      mach_port_deallocate(mach_task_self(), threads[i]);
    }
    vm_deallocate(mach_task_self(), (vm_address_t)threads,
                  threadCount * sizeof(thread_act_t));
  }

  
  NSArray<NSString *> *watchdogSymbols = [NSThread callStackSymbols];
  [threadState appendString:@"\nWatchdog Thread Stack:\n"];
  [threadState appendString:[watchdogSymbols componentsJoinedByString:@"\n"]];

  return threadState;
}

- (NSDictionary *)buildANRReportWithDuration:(NSTimeInterval)duration
                                 threadState:(nullable NSString *)threadState {
  NSString *sessionId = [[NSUserDefaults standardUserDefaults]
      stringForKey:kRJCurrentSessionIdKey];

  NSMutableDictionary *report = [NSMutableDictionary new];
  report[@"timestamp"] = @([[NSDate date] timeIntervalSince1970] * 1000); 
  report[@"durationMs"] = @((NSInteger)(duration * 1000));
  report[@"type"] = @"anr";

  if (sessionId) {
    report[@"sessionId"] = sessionId;
  }

  if (threadState) {
    report[@"threadState"] = threadState;
  }

  
  UIDevice *device = [UIDevice currentDevice];
  report[@"deviceMetadata"] = @{
    @"model" : device.model,
    @"systemName" : device.systemName,
    @"systemVersion" : device.systemVersion,
    @"identifierForVendor" : device.identifierForVendor.UUIDString ?: @"unknown"
  };

  return [report copy];
}

- (void)persistANRReport:(NSDictionary *)report {
  NSError *error = nil;
  NSData *jsonData =
      [NSJSONSerialization dataWithJSONObject:report
                                      options:NSJSONWritingPrettyPrinted
                                        error:&error];
  if (error) {
    RJLogError(@"Failed to serialize ANR report: %@",
               error.localizedDescription);
    return;
  }

  NSString *path = [self anrReportPath];
  [jsonData writeToFile:path atomically:YES];
  RJLogDebug(@"ANR report persisted to disk");
}

- (NSString *)anrReportPath {
  NSArray *paths = NSSearchPathForDirectoriesInDomains(NSCachesDirectory,
                                                       NSUserDomainMask, YES);
  NSString *cacheDir = [paths objectAtIndex:0];
  return [cacheDir stringByAppendingPathComponent:kRJANRReportFileName];
}

#pragma mark - Pending Report Methods

- (BOOL)hasPendingANRReport {
  NSString *path = [self anrReportPath];
  return [[NSFileManager defaultManager] fileExistsAtPath:path];
}

- (NSDictionary *)loadAndPurgePendingANRReport {
  NSString *path = [self anrReportPath];
  if (![[NSFileManager defaultManager] fileExistsAtPath:path]) {
    return nil;
  }

  NSData *data = [NSData dataWithContentsOfFile:path];
  if (!data) {
    return nil;
  }

  NSDictionary *report = [NSJSONSerialization JSONObjectWithData:data
                                                         options:0
                                                           error:nil];

  
  [[NSFileManager defaultManager] removeItemAtPath:path error:nil];

  return report;
}

- (void)dealloc {
  [self stopMonitoring];
}

@end
