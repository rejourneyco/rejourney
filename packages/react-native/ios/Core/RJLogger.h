//
//  RJLogger.h
//  Rejourney
//
//  Centralized logging utility for the Rejourney SDK.
//  Provides consistent log formatting and level-based filtering.
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

typedef NS_ENUM(NSInteger, RJLogLevel) {
  RJLogLevelDebug = 0,
  RJLogLevelInfo = 1,
  RJLogLevelWarning = 2,
  RJLogLevelError = 3,
  RJLogLevelSilent = 4
};

@interface RJLogger : NSObject

@property(class, nonatomic, assign) RJLogLevel minimumLogLevel;
@property(class, nonatomic, assign) BOOL includeTimestamps;
@property(class, nonatomic, assign) BOOL debugMode;

+ (void)debug:(NSString *)format, ... NS_FORMAT_FUNCTION(1, 2);
+ (void)info:(NSString *)format, ... NS_FORMAT_FUNCTION(1, 2);
+ (void)warning:(NSString *)format, ... NS_FORMAT_FUNCTION(1, 2);
+ (void)error:(NSString *)format, ... NS_FORMAT_FUNCTION(1, 2);
+ (void)logWithLevel:(RJLogLevel)level
              format:(NSString *)format, ... NS_FORMAT_FUNCTION(2, 3);
+ (void)logInitSuccess:(NSString *)version;
+ (void)logInitFailure:(NSString *)reason;
+ (void)logSessionStart:(NSString *)sessionId;
+ (void)logSessionEnd:(NSString *)sessionId;
+ (void)setDebugMode:(BOOL)enabled;

@end

#define RJLogDebug(fmt, ...) [RJLogger debug:fmt, ##__VA_ARGS__]
#define RJLogInfo(fmt, ...) [RJLogger info:fmt, ##__VA_ARGS__]
#define RJLogWarning(fmt, ...) [RJLogger warning:fmt, ##__VA_ARGS__]
#define RJLogError(fmt, ...) [RJLogger error:fmt, ##__VA_ARGS__]
#define RJLogPerf(fmt, ...) [RJLogger info:fmt, ##__VA_ARGS__]

NS_ASSUME_NONNULL_END
