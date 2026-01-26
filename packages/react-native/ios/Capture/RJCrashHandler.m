//
//  RJCrashHandler.m
//  Rejourney
//
//  Industry-standard crash handling with proper signal handling and
//  fingerprinting.
//

#import "RJCrashHandler.h"
#import "../Core/RJLogger.h"
#import <CommonCrypto/CommonDigest.h>
#import <UIKit/UIKit.h>
#include <execinfo.h>
#include <signal.h>

static NSUncaughtExceptionHandler *originalExceptionHandler = NULL;
static NSString *const kRJCrashReportFileName = @"rj_crash_report.json";
static NSString *const kRJCurrentSessionIdKey = @"rj_current_session_id";

static struct sigaction originalSigActions[32];
static volatile sig_atomic_t handlingSignal = 0;

static RJPreCrashCallback rj_preCrashCallback = nil;

static void rj_invokePreCrashCallback(void);

@implementation RJCrashHandler

+ (instancetype)sharedInstance {
  static RJCrashHandler *sharedInstance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    sharedInstance = [[self alloc] init];
  });
  return sharedInstance;
}

- (void)registerPreCrashCallback:(RJPreCrashCallback)callback {
  rj_preCrashCallback = [callback copy];
  RJLogDebug(@"Registered pre-crash callback for video segment recovery");
}

- (void)startMonitoring {
  
  originalExceptionHandler = NSGetUncaughtExceptionHandler();
  NSSetUncaughtExceptionHandler(&rj_uncaughtExceptionHandler);

  
  
  int signals[] = {SIGABRT, SIGILL, SIGSEGV, SIGFPE, SIGBUS, SIGPIPE, SIGTRAP};
  int numSignals = sizeof(signals) / sizeof(signals[0]);

  for (int i = 0; i < numSignals; i++) {
    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_sigaction = rj_signalActionHandler;
    action.sa_flags = SA_SIGINFO | SA_ONSTACK;
    sigemptyset(&action.sa_mask);

    
    sigaction(signals[i], &action, &originalSigActions[signals[i]]);
  }

  RJLogDebug(@"RJCrashHandler started monitoring (using sigaction)");
}

static void rj_invokePreCrashCallback(void) {
  if (rj_preCrashCallback) {
    @try {
      rj_preCrashCallback();
    } @catch (NSException *e) {
      
    }
  }
}

- (BOOL)hasPendingCrashReport {
  NSString *path = [self crashReportPath];
  return [[NSFileManager defaultManager] fileExistsAtPath:path];
}

- (NSDictionary *)loadAndPurgePendingCrashReport {
  NSString *path = [self crashReportPath];
  if (![[NSFileManager defaultManager] fileExistsAtPath:path]) {
    return nil;
  }

  NSData *data = [NSData dataWithContentsOfFile:path];
  if (!data)
    return nil;

  NSDictionary *report = [NSJSONSerialization JSONObjectWithData:data
                                                         options:0
                                                           error:nil];

  
  [[NSFileManager defaultManager] removeItemAtPath:path error:nil];

  return report;
}

#pragma mark - Private Methods

- (NSString *)crashReportPath {
  NSArray *paths = NSSearchPathForDirectoriesInDomains(NSCachesDirectory,
                                                       NSUserDomainMask, YES);
  NSString *cacheDir = [paths objectAtIndex:0];
  return [cacheDir stringByAppendingPathComponent:kRJCrashReportFileName];
}

#pragma mark - Fingerprinting

+ (NSString *)generateFingerprintForException:(NSString *)exceptionName
                                   stackTrace:(NSArray *)stackTrace {
  NSMutableString *input =
      [NSMutableString stringWithString:exceptionName ?: @""];

  
  NSInteger frameCount = MIN(5, stackTrace.count);
  for (NSInteger i = 0; i < frameCount; i++) {
    NSString *frame = stackTrace[i];
    
    NSString *cleaned = [frame
        stringByReplacingOccurrencesOfString:@"0x[0-9a-fA-F]+"
                                  withString:@""
                                     options:NSRegularExpressionSearch
                                       range:NSMakeRange(0, frame.length)];
    [input appendString:cleaned];
  }

  
  const char *cStr = [input UTF8String];
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(cStr, (CC_LONG)strlen(cStr), digest);

  NSMutableString *fingerprint =
      [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
  for (int i = 0; i < 8; i++) { 
    [fingerprint appendFormat:@"%02x", digest[i]];
  }

  return fingerprint;
}

#pragma mark - Handlers

void rj_uncaughtExceptionHandler(NSException *exception) {
  RJLogDebug(@"[CRASH] EXCEPTION DETECTED: %@ - %@", exception.name,
             exception.reason);

  
  
  rj_invokePreCrashCallback();

  NSString *sessionId = [[NSUserDefaults standardUserDefaults]
      stringForKey:kRJCurrentSessionIdKey];

  NSMutableDictionary *report = [NSMutableDictionary new];
  report[@"timestamp"] = @([[NSDate date] timeIntervalSince1970] * 1000);
  report[@"exceptionName"] = exception.name;
  report[@"reason"] = exception.reason ?: @"";

  
  
  NSArray *stackSymbols = exception.callStackSymbols;
  if (!stackSymbols || stackSymbols.count == 0) {
    
    void *callstack[128];
    int frames = backtrace(callstack, 128);
    char **strs = backtrace_symbols(callstack, frames);
    NSMutableArray *stack = [NSMutableArray arrayWithCapacity:frames];
    for (int i = 0; i < frames; i++) {
      [stack addObject:[NSString stringWithUTF8String:strs[i]]];
    }
    free(strs);
    stackSymbols = stack;
    RJLogDebug(@"[CRASH] Used backtrace() fallback for stack trace (%d frames)",
               frames);
  } else {
    RJLogDebug(@"[CRASH] Using exception.callStackSymbols (%lu frames)",
               (unsigned long)stackSymbols.count);
  }

  report[@"stackTrace"] = stackSymbols ?: @[];

  if (sessionId) {
    report[@"sessionId"] = sessionId;
  }

  
  report[@"fingerprint"] =
      [RJCrashHandler generateFingerprintForException:exception.name
                                           stackTrace:stackSymbols ?: @[]];

  UIDevice *device = [UIDevice currentDevice];
  report[@"deviceMetadata"] = @{
    @"model" : device.model,
    @"systemName" : device.systemName,
    @"systemVersion" : device.systemVersion,
    @"identifierForVendor" : device.identifierForVendor.UUIDString ?: @"unknown"
  };

  NSData *jsonData =
      [NSJSONSerialization dataWithJSONObject:report
                                      options:NSJSONWritingPrettyPrinted
                                        error:nil];

  NSString *path = [[RJCrashHandler sharedInstance] crashReportPath];
  [jsonData writeToFile:path atomically:YES];

  RJLogDebug(@"[CRASH] Crash report saved to %@", path);

  if (originalExceptionHandler) {
    originalExceptionHandler(exception);
  }
}

void rj_signalActionHandler(int signal, siginfo_t *info, void *context) {
  
  if (handlingSignal) {
    return;
  }
  handlingSignal = 1;

  RJLogDebug(@"[CRASH] SIGNAL DETECTED: %d at address %p", signal,
             info->si_addr);

  
  
  
  
  
  rj_invokePreCrashCallback();

  NSString *sessionId = [[NSUserDefaults standardUserDefaults]
      stringForKey:kRJCurrentSessionIdKey];

  NSMutableDictionary *report = [NSMutableDictionary new];
  report[@"timestamp"] = @([[NSDate date] timeIntervalSince1970] * 1000);

  
  NSString *signalName;
  switch (signal) {
  case SIGABRT:
    signalName = @"SIGABRT (Abort)";
    break;
  case SIGSEGV:
    signalName = @"SIGSEGV (Segmentation Fault)";
    break;
  case SIGBUS:
    signalName = @"SIGBUS (Bus Error)";
    break;
  case SIGFPE:
    signalName = @"SIGFPE (Floating Point Exception)";
    break;
  case SIGILL:
    signalName = @"SIGILL (Illegal Instruction)";
    break;
  case SIGPIPE:
    signalName = @"SIGPIPE (Broken Pipe)";
    break;
  case SIGTRAP:
    signalName = @"SIGTRAP (Trace Trap)";
    break;
  default:
    signalName = [NSString stringWithFormat:@"Signal %d", signal];
    break;
  }

  report[@"exceptionName"] = signalName;
  report[@"reason"] = [NSString
      stringWithFormat:@"%@ at address %p", signalName, info->si_addr];
  if (sessionId) {
    report[@"sessionId"] = sessionId;
  }

  
  void *callstack[128];
  int frames = backtrace(callstack, 128);
  char **strs = backtrace_symbols(callstack, frames);
  NSMutableArray *stack = [NSMutableArray arrayWithCapacity:frames];
  for (int i = 0; i < frames; i++) {
    [stack addObject:[NSString stringWithUTF8String:strs[i]]];
  }
  free(strs);
  report[@"stackTrace"] = stack;

  
  report[@"fingerprint"] =
      [RJCrashHandler generateFingerprintForException:signalName
                                           stackTrace:stack];

  UIDevice *device = [UIDevice currentDevice];
  report[@"deviceMetadata"] = @{
    @"model" : device.model,
    @"systemName" : device.systemName,
    @"systemVersion" : device.systemVersion
  };

  NSData *jsonData =
      [NSJSONSerialization dataWithJSONObject:report
                                      options:NSJSONWritingPrettyPrinted
                                        error:nil];
  NSString *path = [[RJCrashHandler sharedInstance] crashReportPath];
  [jsonData writeToFile:path atomically:YES];

  
  struct sigaction *original = &originalSigActions[signal];
  sigaction(signal, original, NULL);
  raise(signal);
}

@end
