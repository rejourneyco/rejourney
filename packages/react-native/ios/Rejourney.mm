/**
 * Copyright 2026 Rejourney
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#import "Rejourney.h"
#import <React/RCTBridgeModule.h>
#import <React/RCTLog.h>

// Import the Swift-generated header - this is created at build time
// The header name follows the pattern: <ProductModuleName>-Swift.h
#if __has_include(<Rejourney/Rejourney-Swift.h>)
#import <Rejourney/Rejourney-Swift.h>
#elif __has_include("Rejourney-Swift.h")
#import "Rejourney-Swift.h"
#else
// Fallback: forward declare the Swift class for runtime resolution
@class RejourneyImpl;
#endif

#ifdef RCT_NEW_ARCH_ENABLED
#import <ReactCommon/RCTTurboModule.h>
#if __has_include(<RejourneySpec/RejourneySpec.h>)
#import <RejourneySpec/RejourneySpec.h>
#elif __has_include("RejourneySpec.h")
#import "RejourneySpec.h"
#endif
#endif

#pragma mark - Private Interface

@interface Rejourney ()
@property(nonatomic, strong) RejourneyImpl *impl;
@end

#pragma mark - Implementation

@implementation Rejourney

@synthesize bridge = _bridge;

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _impl = [self resolveSwiftImpl];
    if (!_impl) {
      RCTLogWarn(@"[Rejourney] Swift implementation not found - will retry at "
                 @"method call time");
    }
  }
  return self;
}

#pragma mark - Tap Event Emission (no-ops, dead tap detection is native-side)

RCT_EXPORT_METHOD(addListener : (NSString *)eventName) {
  // No-op: dead tap detection is handled natively in TelemetryPipeline
}

RCT_EXPORT_METHOD(removeListeners : (double)count) {
  // No-op: dead tap detection is handled natively in TelemetryPipeline
}

- (RejourneyImpl *)resolveSwiftImpl {
  // First try direct class access (works when Swift header is properly
  // imported)
  Class implClass = NSClassFromString(@"RejourneyImpl");
  if (!implClass) {
    // Try module-prefixed names
    implClass = NSClassFromString(@"Rejourney.RejourneyImpl");
  }
  if (!implClass) {
    implClass = NSClassFromString(@"rejourney.RejourneyImpl");
  }

  if (implClass) {
    SEL sharedSel = NSSelectorFromString(@"shared");
    if ([implClass respondsToSelector:sharedSel]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
      return [implClass performSelector:sharedSel];
#pragma clang diagnostic pop
    }
  }

  return nil;
}

- (RejourneyImpl *)ensureImpl {
  if (!_impl) {
    _impl = [self resolveSwiftImpl];
  }
  return _impl;
}

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeRejourneySpecJSI>(params);
}
#endif

#pragma mark - Session Lifecycle

RCT_EXPORT_METHOD(startSession : (NSString *)userId apiUrl : (NSString *)
                      apiUrl publicKey : (NSString *)
                          publicKey resolve : (RCTPromiseResolveBlock)
                              resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{
      @"success" : @NO,
      @"sessionId" : @"",
      @"error" : @"Native module not available - cannot start recording"
    });
    return;
  }
  [impl startSession:userId
              apiUrl:apiUrl
           publicKey:publicKey
             resolve:resolve
              reject:reject];
}

RCT_EXPORT_METHOD(startSessionWithOptions : (NSDictionary *)options resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{
      @"success" : @NO,
      @"sessionId" : @"",
      @"error" : @"Native module not available"
    });
    return;
  }
  [impl startSessionWithOptions:options resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(stopSession : (RCTPromiseResolveBlock)
                      resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{@"success" : @YES, @"sessionId" : @""});
    return;
  }
  [impl stopSession:resolve reject:reject];
}

RCT_EXPORT_METHOD(getSessionId : (RCTPromiseResolveBlock)
                      resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve([NSNull null]);
    return;
  }
  [impl getSessionId:resolve reject:reject];
}

#pragma mark - User Identity

RCT_EXPORT_METHOD(setUserIdentity : (NSString *)userId resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{@"success" : @NO});
    return;
  }
  [impl setUserIdentity:userId resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(getUserIdentity : (RCTPromiseResolveBlock)
                      resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve([NSNull null]);
    return;
  }
  [impl getUserIdentity:resolve reject:reject];
}

#pragma mark - Events and Tracking

RCT_EXPORT_METHOD(logEvent : (NSString *)eventType details : (NSDictionary *)
                      details resolve : (RCTPromiseResolveBlock)
                          resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{@"success" : @YES}); // Silent success - don't break the app
    return;
  }
  [impl logEvent:eventType details:details resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(screenChanged : (NSString *)screenName resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{@"success" : @YES});
    return;
  }
  [impl screenChanged:screenName resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(onScroll : (double)offsetY resolve : (RCTPromiseResolveBlock)
                      resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{@"success" : @YES});
    return;
  }
  [impl onScroll:offsetY resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(markVisualChange : (NSString *)reason importance : (
    NSString *)importance resolve : (RCTPromiseResolveBlock)
                      resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@YES);
    return;
  }
  [impl markVisualChange:reason
              importance:importance
                 resolve:resolve
                  reject:reject];
}

#pragma mark - External Events

RCT_EXPORT_METHOD(onExternalURLOpened : (NSString *)urlScheme resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{@"success" : @YES});
    return;
  }
  [impl onExternalURLOpened:urlScheme resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(onOAuthStarted : (NSString *)provider resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{@"success" : @YES});
    return;
  }
  [impl onOAuthStarted:provider resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(onOAuthCompleted : (NSString *)provider success : (BOOL)
                      success resolve : (RCTPromiseResolveBlock)
                          resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{@"success" : @YES});
    return;
  }
  [impl onOAuthCompleted:provider
                 success:success
                 resolve:resolve
                  reject:reject];
}

#pragma mark - View Masking

RCT_EXPORT_METHOD(maskViewByNativeID : (NSString *)nativeID resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{@"success" : @NO});
    return;
  }
  [impl maskViewByNativeID:nativeID resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(unmaskViewByNativeID : (NSString *)nativeID resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{@"success" : @NO});
    return;
  }
  [impl unmaskViewByNativeID:nativeID resolve:resolve reject:reject];
}

#pragma mark - Debug and Info

RCT_EXPORT_METHOD(setDebugMode : (BOOL)enabled resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{@"success" : @NO});
    return;
  }
  [impl setDebugMode:enabled resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(setRemoteConfig : (BOOL)rejourneyEnabled recordingEnabled : (
    BOOL)recordingEnabled sampleRate : (double)
                      sampleRate maxRecordingMinutes : (double)
                          maxRecordingMinutes resolve : (RCTPromiseResolveBlock)
                              resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{@"success" : @NO});
    return;
  }
  [impl setRemoteConfigWithRejourneyEnabled:rejourneyEnabled
                           recordingEnabled:recordingEnabled
                                 sampleRate:(NSInteger)sampleRate
                        maxRecordingMinutes:(NSInteger)maxRecordingMinutes
                                    resolve:resolve
                                     reject:reject];
}

RCT_EXPORT_METHOD(getSDKMetrics : (RCTPromiseResolveBlock)
                      resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{});
    return;
  }
  [impl getSDKMetrics:resolve reject:reject];
}

RCT_EXPORT_METHOD(getDeviceInfo : (RCTPromiseResolveBlock)
                      resolve reject : (RCTPromiseRejectBlock)reject) {
  RejourneyImpl *impl = [self ensureImpl];
  if (!impl) {
    resolve(@{});
    return;
  }
  [impl getDeviceInfo:resolve reject:reject];
}

RCT_EXPORT_METHOD(setSDKVersion : (NSString *)version) {
  RejourneyImpl *impl = [self ensureImpl];
  if (impl) {
    [impl setSDKVersion:version];
  }
}

RCT_EXPORT_METHOD(debugCrash) {
  RejourneyImpl *impl = [self ensureImpl];
  if (impl) {
    [impl debugCrash];
  }
}

RCT_EXPORT_METHOD(debugTriggerANR : (double)durationMs) {
  RejourneyImpl *impl = [self ensureImpl];
  if (impl) {
    [impl debugTriggerANR:durationMs];
  }
}

@end
