//
//  RJLogger.m
//  Rejourney
//
//  Centralized logging utility implementation.
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

#import "RJLogger.h"

#if __has_include(<React/RCTLog.h>)
#import <React/RCTLog.h>
#define RJ_HAS_RCT_LOG 1
#else
#define RJ_HAS_RCT_LOG 0
#endif

static RJLogLevel _minimumLogLevel;
static BOOL _includeTimestamps = NO;
static BOOL _debugMode = NO;
static dispatch_once_t _onceToken;

static NSString *const kLogPrefix = @"[Rejourney]";

@implementation RJLogger

#pragma mark - Class Properties

+ (void)initialize {
  if (self == [RJLogger class]) {
    dispatch_once(&_onceToken, ^{
      _minimumLogLevel = RJLogLevelSilent;
      _debugMode = NO;
    });
  }
}

+ (RJLogLevel)minimumLogLevel {
  return _minimumLogLevel;
}

+ (void)setMinimumLogLevel:(RJLogLevel)minimumLogLevel {
  _minimumLogLevel = minimumLogLevel;
}

+ (BOOL)includeTimestamps {
  return _includeTimestamps;
}

+ (void)setIncludeTimestamps:(BOOL)includeTimestamps {
  _includeTimestamps = includeTimestamps;
}

+ (BOOL)debugMode {
  return _debugMode;
}

+ (void)setDebugMode:(BOOL)enabled {
  _debugMode = enabled;
  if (enabled) {
    _minimumLogLevel = RJLogLevelDebug;
  } else {
#ifdef DEBUG
    _minimumLogLevel = RJLogLevelError;
#else
    _minimumLogLevel = RJLogLevelSilent;
#endif
  }
}

#pragma mark - Logging Methods

+ (void)logDebug:(NSString *)format, ... {
  va_list args;
  va_start(args, format);
  [self logWithLevel:RJLogLevelDebug format:format arguments:args];
  va_end(args);
}

+ (void)logInfo:(NSString *)format, ... {
  va_list args;
  va_start(args, format);
  [self logWithLevel:RJLogLevelInfo format:format arguments:args];
  va_end(args);
}

+ (void)logWarning:(NSString *)format, ... {
  va_list args;
  va_start(args, format);
  [self logWithLevel:RJLogLevelWarning format:format arguments:args];
  va_end(args);
}

+ (void)logError:(NSString *)format, ... {
  va_list args;
  va_start(args, format);
  [self logWithLevel:RJLogLevelError format:format arguments:args];
  va_end(args);
}

#pragma mark - Swift Interop Methods

+ (void)logDebugMessage:(NSString *)message {
  [self logLevel:RJLogLevelDebug message:message];
}

+ (void)logInfoMessage:(NSString *)message {
  [self logLevel:RJLogLevelInfo message:message];
}

+ (void)logWarningMessage:(NSString *)message {
  [self logLevel:RJLogLevelWarning message:message];
}

+ (void)logErrorMessage:(NSString *)message {
  [self logLevel:RJLogLevelError message:message];
}

+ (void)logLevel:(RJLogLevel)level message:(NSString *)message {
  // Use %s to avoid having message implicitly treated as format string
  [self logWithLevel:level format:@"%@", message];
}

+ (void)logWithLevel:(RJLogLevel)level format:(NSString *)format, ... {
  va_list args;
  va_start(args, format);
  [self logWithLevel:level format:format arguments:args];
  va_end(args);
}

#pragma mark - Private Methods

+ (void)logWithLevel:(RJLogLevel)level
              format:(NSString *)format
           arguments:(va_list)args {

  if (level < _minimumLogLevel) {
    return;
  }

  NSString *message = [[NSString alloc] initWithFormat:format arguments:args];

  NSMutableString *fullMessage = [NSMutableString string];

  if (_includeTimestamps) {
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    formatter.dateFormat = @"HH:mm:ss.SSS";
    [fullMessage
        appendFormat:@"[%@] ", [formatter stringFromDate:[NSDate date]]];
  }

  [fullMessage appendString:kLogPrefix];
  [fullMessage appendString:[self levelIndicator:level]];
  [fullMessage appendString:@" "];
  [fullMessage appendString:message];

  [self outputLog:fullMessage level:level];
}

+ (NSString *)levelIndicator:(RJLogLevel)level {
  switch (level) {
  case RJLogLevelDebug:
    return @"[DEBUG]";
  case RJLogLevelInfo:
    return @"";
  case RJLogLevelWarning:
    return @"[WARN]";
  case RJLogLevelError:
    return @"[ERROR]";
  case RJLogLevelSilent:
    return @"";
  }
}

+ (void)outputLog:(NSString *)message level:(RJLogLevel)level {
#if RJ_HAS_RCT_LOG

  switch (level) {
  case RJLogLevelDebug:
  case RJLogLevelInfo:
    RCTLogInfo(@"%@", message);
    break;
  case RJLogLevelWarning:
    RCTLogWarn(@"%@", message);
    break;
  case RJLogLevelError:
    RCTLogError(@"%@", message);
    break;
  case RJLogLevelSilent:
    break;
  }
#else
  NSLog(@"%@", message);
#endif
}

#pragma mark - Lifecycle Logs

+ (void)logInitSuccess:(NSString *)version {
  if (_debugMode) {
    RJLogInfo(@"[Rejourney] ✓ SDK initialized (v%@)", version);
  }
}

+ (void)logInitFailure:(NSString *)reason {
  RJLogInfo(@"[Rejourney] ✗ Initialization failed: %@", reason);
}

+ (void)logSessionStart:(NSString *)sessionId {
  if (_debugMode) {
    RJLogInfo(@"[Rejourney] Session started: %@", sessionId);
  }
}

+ (void)logSessionEnd:(NSString *)sessionId {
  if (_debugMode) {
    RJLogInfo(@"[Rejourney] Session ended: %@", sessionId);
  }
}

@end
