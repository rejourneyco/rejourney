//
//  Rejourney.mm
//  Rejourney
//
//  React Native module for efficient session recording.
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

#import "Rejourney.h"
#import "../Capture/RJANRHandler.h"
#import "../Capture/RJCaptureEngine.h"
#import "../Capture/RJCrashHandler.h"
#import "../Capture/RJMotionEvent.h"
#import "../Capture/RJSegmentUploader.h"
#import "../Capture/RJVideoEncoder.h"
#import "../Capture/RJViewControllerTracker.h"
#import "../Network/RJDeviceAuthManager.h"
#import "../Network/RJNetworkMonitor.h"
#import "../Network/RJUploadManager.h"
#import "../Privacy/RJPrivacyMask.h"
#import "../Touch/RJTouchInterceptor.h"
#import "../Utils/RJEventBuffer.h"
#import "../Utils/RJTelemetry.h"
#import "../Utils/RJWindowUtils.h"
#import "RJConstants.h"
#import "RJLifecycleManager.h"
#import "RJLogger.h"
#import "RJTypes.h"

#import <CommonCrypto/CommonDigest.h>
#import <React/RCTLog.h>
#import <React/RCTUIManager.h>
#import <UIKit/UIKit.h>
#import <mach/mach_time.h>
#import <sys/sysctl.h>
#import <sys/utsname.h>

static uint64_t _rj_constructorMachTime = 0;
static NSTimeInterval _rj_constructorWallTimeMs = 0;
static void *kRJStateQueueKey = &kRJStateQueueKey;

__attribute__((constructor)) static void rj_captureProcessStartTime(void) {

  _rj_constructorMachTime = mach_absolute_time();
  _rj_constructorWallTimeMs = [[NSDate date] timeIntervalSince1970] * 1000.0;
}

#pragma mark - Private Interface

@interface Rejourney () <RJTouchInterceptorDelegate,
                         RJViewControllerTrackerDelegate,
                         RJLifecycleManagerDelegate, RJANRHandlerDelegate>

@property(nonatomic, strong) RJCaptureEngine *captureEngine;
@property(nonatomic, strong) RJUploadManager *uploadManager;
@property(nonatomic, strong) RJLifecycleManager *lifecycleManager;

@property(nonatomic, strong) dispatch_queue_t stateQueue;

@property(nonatomic, copy, nullable) NSString *currentSessionId;
@property(nonatomic, copy, nullable) NSString *userId;
@property(atomic, assign) BOOL isRecording;
@property(atomic, assign) BOOL remoteRejourneyEnabled;
@property(atomic, assign) BOOL remoteRecordingEnabled;
@property(atomic, assign) BOOL recordingEnabledByConfig;
@property(atomic, assign) NSInteger sampleRate;
@property(atomic, assign) BOOL sessionSampled;
@property(atomic, assign) BOOL hasSampleDecision;
@property(atomic, assign) BOOL hasProjectConfig;
@property(atomic, assign) BOOL remoteBillingBlocked;
@property(nonatomic, assign) NSTimeInterval sessionStartTime;

@property(nonatomic, strong) NSMutableArray<NSDictionary *> *sessionEvents;

@property(nonatomic, strong, nullable) RJEventBuffer *eventBuffer;

@property(atomic, assign) UIBackgroundTaskIdentifier backgroundTaskId;

@property(nonatomic, strong, nullable) NSTimer *batchUploadTimer;
@property(nonatomic, assign) NSTimeInterval lastUploadTime;

@property(nonatomic, assign) NSTimeInterval lastImmediateUploadKickMs;

@property(nonatomic, assign) NSInteger maxRecordingMinutes;
@property(nonatomic, strong, nullable) NSTimer *durationLimitTimer;

@property(atomic, assign) BOOL isShuttingDown;

@property(atomic, assign) BOOL fullyInitialized;

@property(nonatomic, assign) NSTimeInterval totalBackgroundTimeMs;
@property(nonatomic, assign) BOOL didOpenExternalURL;
@property(nonatomic, copy, nullable) NSString *lastOpenedURLScheme;

@property(nonatomic, assign) NSTimeInterval lastKeyboardTypingEventTimeMs;

// Auth resilience - retry mechanism
@property(nonatomic, assign) NSInteger authRetryCount;
@property(nonatomic, assign) NSTimeInterval nextAuthRetryTime;
@property(nonatomic, strong, nullable) NSTimer *authRetryTimer;
@property(atomic, assign)
    BOOL authPermanentlyFailed; // Only for 403 (security issues)

- (void)performStateSync:(dispatch_block_t)block;
- (void)resetSamplingDecision;
- (BOOL)updateRecordingEligibilityWithSampleRate:(NSInteger)sampleRate;

@end

// Constants for auth retry
static const NSInteger RJ_MAX_AUTH_RETRIES = 5;
static const NSTimeInterval RJ_AUTH_RETRY_BASE_DELAY = 2.0; // 2 seconds base
static const NSTimeInterval RJ_AUTH_RETRY_MAX_DELAY = 60.0; // 1 minute max

#pragma mark - Implementation

@implementation Rejourney

RCT_EXPORT_MODULE()

#pragma mark - Module Setup

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

#pragma mark - Initialization

- (instancetype)init {
  self = [super init];
  if (self) {
    @try {

      [self setupMinimalComponents];
      [self registerNotifications];

    } @catch (NSException *exception) {
      [RJLogger logInitFailure:[exception reason]];
    }
  }
  return self;
}

- (void)logReactNativeArchitecture {
  BOOL isNewArchitecture = NO;
  NSString *architectureType = @"Unknown";

#ifdef RCT_NEW_ARCH_ENABLED
  isNewArchitecture = YES;
  architectureType = @"New Architecture (TurboModules)";
#else

  Class turboModuleManagerClass = NSClassFromString(@"RCTTurboModuleManager");
  Class fabricSurfaceClass = NSClassFromString(@"RCTFabricSurface");
  Class rctHostClass = NSClassFromString(@"RCTHost");

  if (rctHostClass != nil) {
    isNewArchitecture = YES;
    architectureType = @"New Architecture (Bridgeless)";
  } else if (turboModuleManagerClass != nil && fabricSurfaceClass != nil) {
    isNewArchitecture = YES;
    architectureType = @"New Architecture (TurboModules + Fabric)";
  } else if (turboModuleManagerClass != nil) {
    isNewArchitecture = YES;
    architectureType = @"Hybrid (TurboModules with Bridge)";
  } else {
    architectureType = @"Old Architecture (Bridge)";
  }
#endif
}

- (void)setupMinimalComponents {

  _stateQueue =
      dispatch_queue_create("com.rejourney.state", DISPATCH_QUEUE_SERIAL);
  dispatch_queue_set_specific(_stateQueue, kRJStateQueueKey, kRJStateQueueKey,
                              NULL);

  _isRecording = NO;
  _remoteRejourneyEnabled = YES;
  _remoteRecordingEnabled = YES;
  _recordingEnabledByConfig = YES;
  _sampleRate = 100;
  _sessionSampled = YES;
  _hasSampleDecision = NO;
  _hasProjectConfig = NO;
  _remoteBillingBlocked = NO;
  _isShuttingDown = NO;
  _fullyInitialized = NO;
  _sessionEvents = [NSMutableArray new];
  _backgroundTaskId = UIBackgroundTaskInvalid;
  _maxRecordingMinutes = 10;
  _lastKeyboardTypingEventTimeMs = 0;

  _lifecycleManager = [[RJLifecycleManager alloc] init];
  _lifecycleManager.delegate = self;
}

- (void)performStateSync:(dispatch_block_t)block {
  if (!block || !self.stateQueue) {
    return;
  }

  if (dispatch_get_specific(kRJStateQueueKey)) {
    block();
  } else {
    dispatch_sync(self.stateQueue, block);
  }
}

- (void)resetSamplingDecision {
  self.sessionSampled = YES;
  self.hasSampleDecision = NO;
}

- (BOOL)shouldSampleSessionForRate:(NSInteger)sampleRate {
  NSInteger clampedRate = MAX(0, MIN(100, sampleRate));
  if (clampedRate >= 100) {
    return YES;
  }
  if (clampedRate <= 0) {
    return NO;
  }
  uint32_t roll = arc4random_uniform(100);
  return roll < (uint32_t)clampedRate;
}

- (BOOL)updateRecordingEligibilityWithSampleRate:(NSInteger)sampleRate {
  NSInteger clampedRate = MAX(0, MIN(100, sampleRate));
  self.sampleRate = clampedRate;

  BOOL didDecideSample = NO;
  if (!self.hasSampleDecision) {
    self.sessionSampled = [self shouldSampleSessionForRate:clampedRate];
    self.hasSampleDecision = YES;
    didDecideSample = YES;
  }

  // Decouple video recording from session active state.
  // We want to record video ONLY if:
  // 1. Config says recording is enabled (remote toggles)
  // 2. Sample rate allows it
  //
  // NOTE: Even if shouldRecordVideo is NO, the session remains active
  // (isRecording=YES) and events are still observed and uploaded ("Data-Only
  // Mode").
  BOOL shouldRecordVideo = self.recordingEnabledByConfig && self.sessionSampled;
  self.remoteRecordingEnabled = shouldRecordVideo;

  if (self.captureEngine) {
    self.captureEngine.uploadsEnabled = shouldRecordVideo;
    if (!shouldRecordVideo && self.captureEngine.isRecording) {
      // Stop video capture pipeline to save resources, but keep session alive
      [self.captureEngine stopSession];
    }
  }

  if (didDecideSample && self.recordingEnabledByConfig &&
      !self.sessionSampled) {
    RJLogInfo(@"Session sampled out for video (%ld%%) - entering Data-Only "
              @"Mode (Events enabled, Video disabled)",
              (long)clampedRate);
  }

  return shouldRecordVideo;
}

- (void)ensureFullyInitialized {
  if (_fullyInitialized) {
    return;
  }
  _fullyInitialized = YES;

  [self logReactNativeArchitecture];

  __weak __typeof__(self) weakSelf = self;
  _captureEngine =
      [[RJCaptureEngine alloc] initWithWindowProvider:^UIWindow *_Nullable {
        __strong __typeof__(weakSelf) strongSelf = weakSelf;
        if (!strongSelf || strongSelf.isShuttingDown)
          return nil;
        @try {
          return [RJWindowUtils keyWindow];
        } @catch (NSException *exception) {
          RJLogWarning(@"Window provider exception: %@", exception);
          return nil;
        }
      }];

  _uploadManager =
      [[RJUploadManager alloc] initWithApiUrl:@"https://api.rejourney.co"];

  if (!_lifecycleManager) {
    _lifecycleManager = [[RJLifecycleManager alloc] init];
    _lifecycleManager.delegate = self;
  }

  [self setupTouchTracking];

  [[RJCrashHandler sharedInstance] startMonitoring];

  __weak RJCaptureEngine *weakCaptureEngine = _captureEngine;
  [[RJCrashHandler sharedInstance] registerPreCrashCallback:^{
    RJCaptureEngine *strongEngine = weakCaptureEngine;
    if (strongEngine && strongEngine.videoEncoder) {
      [strongEngine.videoEncoder emergencyFlushSync];
    }
  }];

  [[RJANRHandler sharedInstance] setDelegate:self];
  [[RJANRHandler sharedInstance] startMonitoring];
  [[RJNetworkMonitor sharedInstance] startMonitoring];

  [RJLogger logInitSuccess:RJSDKVersion];
}

- (void)setupTouchTracking {
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      [RJTouchInterceptor sharedInstance].delegate = self;
      [[RJTouchInterceptor sharedInstance] enableGlobalTracking];
    } @catch (NSException *exception) {
      RJLogWarning(@"Touch tracking setup failed: %@", exception);
    }
  });
}

- (void)dealloc {

  _isShuttingDown = YES;

  if ([NSThread isMainThread]) {
    [self stopBatchUploadTimer];
  } else {
    dispatch_sync(dispatch_get_main_queue(), ^{
      [self stopBatchUploadTimer];
    });
  }

  [[NSNotificationCenter defaultCenter] removeObserver:self];

  @try {
    [self performStateSync:^{
      [self.sessionEvents removeAllObjects];
    }];
  } @catch (NSException *exception) {
  }
}

#pragma mark - React Native Methods

RCT_EXPORT_METHOD(startSession : (NSString *)userId apiUrl : (NSString *)
                      apiUrl publicKey : (NSString *)
                          publicKey resolve : (RCTPromiseResolveBlock)
                              resolve reject : (RCTPromiseRejectBlock)reject) {

  RJLogInfo(@"[RJ-SESSION] startSession called from JS (userId=%@, apiUrl=%@)",
            userId, apiUrl);

  if (self.isShuttingDown) {
    if (resolve) {
      resolve(@{
        @"success" : @NO,
        @"sessionId" : @"",
        @"error" : @"Module is shutting down"
      });
    }
    return;
  }

  RCTPromiseResolveBlock safeResolve = [resolve copy];

  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.isShuttingDown) {
      if (safeResolve) {
        safeResolve(@{
          @"success" : @NO,
          @"sessionId" : @"",
          @"error" : @"Module is shutting down"
        });
      }
      return;
    }

    @try {

      [self ensureFullyInitialized];

      if (self.isRecording) {
        NSString *sessionId = self.currentSessionId;
        if (safeResolve) {
          safeResolve(@{@"success" : @YES, @"sessionId" : sessionId ?: @""});
        }
        return;
      }

      NSString *safeUserId = userId.length > 0 ? userId : @"anonymous";
      NSString *safeApiUrl =
          apiUrl.length > 0 ? apiUrl : @"https://api.rejourney.co";
      NSString *safePublicKey = publicKey.length > 0 ? publicKey : @"";

      NSString *vendorId =
          [[[UIDevice currentDevice] identifierForVendor] UUIDString]
              ?: @"unknown";
      NSData *vendorData = [vendorId dataUsingEncoding:NSUTF8StringEncoding];

      unsigned char hash[CC_SHA256_DIGEST_LENGTH];
      CC_SHA256(vendorData.bytes, (CC_LONG)vendorData.length, hash);

      NSMutableString *deviceHash =
          [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
      for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) {
        [deviceHash appendFormat:@"%02x", hash[i]];
      }

      [self performStateSync:^{
        self.userId = safeUserId;
        self.currentSessionId = [RJWindowUtils generateSessionId];
        self.sessionStartTime = [[NSDate date] timeIntervalSince1970];
        self.totalBackgroundTimeMs = 0;
        [self.sessionEvents removeAllObjects];

        NSString *pendingPath =
            [NSSearchPathForDirectoriesInDomains(NSCachesDirectory,
                                                 NSUserDomainMask, YES)
                    .firstObject stringByAppendingPathComponent:@"rj_pending"];
        self.eventBuffer =
            [[RJEventBuffer alloc] initWithSessionId:self.currentSessionId
                                     pendingRootPath:pendingPath];

        if (self.currentSessionId) {
          [[NSUserDefaults standardUserDefaults]
              setObject:self.currentSessionId
                 forKey:@"rj_current_session_id"];
          [[NSUserDefaults standardUserDefaults] synchronize];
        }
      }];

      if (self.uploadManager) {
        self.uploadManager.apiUrl = safeApiUrl;
        self.uploadManager.publicKey = safePublicKey;
        self.uploadManager.deviceHash = deviceHash;
        self.uploadManager.sessionId = self.currentSessionId;
        self.uploadManager.userId = safeUserId;
        self.uploadManager.sessionStartTime = self.sessionStartTime;
      }

      self.recordingEnabledByConfig = YES;
      self.sampleRate = 100;
      self.hasProjectConfig = NO;
      [self resetSamplingDecision];

      self.remoteRecordingEnabled = YES;
      self.remoteBillingBlocked = NO;
      if (self.captureEngine && self.remoteRecordingEnabled) {
        RJLogInfo(@"[RJ-VIDEO] Configuring segment uploader from Rejourney.mm");
        RJLogInfo(@"[RJ-VIDEO]   apiUrl=%@, publicKey=%@", safeApiUrl,
                  safePublicKey ? @"<set>" : @"<nil>");
        RJLogInfo(@"[RJ-VIDEO]   captureEngine=%@", self.captureEngine);

        [self.captureEngine configureSegmentUploaderWithBaseURL:safeApiUrl
                                                         apiKey:safePublicKey
                                                      projectId:safePublicKey];

        RJLogInfo(@"[RJ-VIDEO] Calling startSessionWithId: %@",
                  self.currentSessionId);
        [self.captureEngine startSessionWithId:self.currentSessionId];
      } else {
        RJLogInfo(@"[RJ-VIDEO] NOT starting capture: captureEngine=%@, "
                  @"remoteRecordingEnabled=%d",
                  self.captureEngine, self.remoteRecordingEnabled);
      }

      self.isRecording = YES;

      if (self.lifecycleManager) {
        self.lifecycleManager.isRecording = YES;
      }

      [self setupDeviceAuthWithPublicKey:safePublicKey apiUrl:safeApiUrl];

      [self startBatchUploadTimer];
      [self startDurationLimitTimer];

      if (_rj_constructorMachTime > 0) {

        uint64_t nowMachTime = mach_absolute_time();
        uint64_t elapsedMachTime = nowMachTime - _rj_constructorMachTime;

        mach_timebase_info_data_t timebase;
        mach_timebase_info(&timebase);
        NSTimeInterval elapsedNs =
            (double)elapsedMachTime * timebase.numer / timebase.denom;
        NSTimeInterval startupDurationMs = elapsedNs / 1000000.0;

        if (startupDurationMs > 0 && startupDurationMs < 60000) {
          [self logEventInternal:@"app_startup"
                         details:@{
                           @"durationMs" : @(startupDurationMs),
                           @"platform" : @"ios"
                         }];
          RJLogDebug(@"Recorded app startup time: %.0fms", startupDurationMs);
        }
      }

      [self.uploadManager fetchProjectConfigWithCompletion:^(
                              BOOL success, NSDictionary *config,
                              NSError *error) {
        if (!success)
          return;

        dispatch_async(dispatch_get_main_queue(), ^{
          self.hasProjectConfig = YES;
          NSInteger sampleRate = self.sampleRate;

          if (config[@"sampleRate"]) {
            sampleRate = [config[@"sampleRate"] integerValue];
          }

          if (config[@"maxRecordingMinutes"]) {
            self.maxRecordingMinutes =
                [config[@"maxRecordingMinutes"] integerValue];
            RJLogDebug(@"Updated maxRecordingMinutes to %ld minutes",
                       (long)self.maxRecordingMinutes);
            [self startDurationLimitTimer];
          }

          if (config[@"rejourneyEnabled"] &&
              ![config[@"rejourneyEnabled"] boolValue]) {
            RJLogWarning(
                @"Rejourney disabled by remote config, stopping session");
            self.remoteRejourneyEnabled = NO;
            [self stopSessionInternal];
            return;
          }
          self.remoteRejourneyEnabled = YES;

          self.remoteBillingBlocked = NO;
          self.recordingEnabledByConfig = YES;

          if (config[@"billingBlocked"] &&
              [config[@"billingBlocked"] boolValue]) {
            RJLogWarning(
                @"Session limit reached - recording blocked by billing");
            self.remoteBillingBlocked = YES;
            self.recordingEnabledByConfig = NO;
          }

          if (config[@"recordingEnabled"] &&
              ![config[@"recordingEnabled"] boolValue]) {
            RJLogWarning(
                @"Recording disabled by remote config, stopping capture only");
            self.recordingEnabledByConfig = NO;
          }

          [self updateRecordingEligibilityWithSampleRate:sampleRate];
        });
      }];

      NSString *sessionId = self.currentSessionId;

      [RJLogger logSessionStart:sessionId];

      RJLogInfo(@"[RJ-SESSION] ✅ Session started successfully (sessionId=%@, "
                @"isRecording=%d)",
                sessionId, self.isRecording);

      if (safeResolve) {
        safeResolve(@{@"success" : @YES, @"sessionId" : sessionId ?: @""});
      }
    } @catch (NSException *exception) {
      RJLogError(@"Failed to start session: %@", exception);
      self.isRecording = NO;

      if (safeResolve) {
        safeResolve(@{
          @"success" : @NO,
          @"sessionId" : @"",
          @"error" : exception.reason ?: @"Unknown error"
        });
      }
    }
  });
}

RCT_EXPORT_METHOD(debugCrash) {
  RCTLogInfo(@"[Rejourney] Triggering debug crash...");

  dispatch_async(dispatch_get_main_queue(), ^{
    [NSException raise:@"RJDebugCrashException"
                format:@"This is a test crash triggered from React Native"];
  });
}

RCT_EXPORT_METHOD(debugTriggerANR : (double)durationMs) {

  NSTimeInterval anrThreshold = [RJANRHandler sharedInstance].threshold;
  NSTimeInterval minDurationMs = (anrThreshold * 1000.0) + 500.0;
  NSTimeInterval actualDurationMs = MAX(durationMs, minDurationMs);

  RCTLogInfo(@"[Rejourney] Triggering debug ANR for %.0fms (requested %.0fms, "
             @"threshold %.0fms)...",
             actualDurationMs, durationMs, anrThreshold * 1000.0);

  dispatch_async(dispatch_get_main_queue(), ^{
    [NSThread sleepForTimeInterval:actualDurationMs / 1000.0];
  });
}

RCT_EXPORT_METHOD(getDeviceInfo : (RCTPromiseResolveBlock)
                      resolve reject : (RCTPromiseRejectBlock)reject) {
  NSMutableDictionary *info = [NSMutableDictionary new];

  // Model
  struct utsname systemInfo;
  uname(&systemInfo);
  NSString *modelCode = [NSString stringWithCString:systemInfo.machine
                                           encoding:NSUTF8StringEncoding];
  info[@"model"] = modelCode ?: [[UIDevice currentDevice] model];

  info[@"brand"] = @"Apple";
  info[@"systemName"] = [[UIDevice currentDevice] systemName];
  info[@"systemVersion"] = [[UIDevice currentDevice] systemVersion];
  info[@"bundleId"] = [[NSBundle mainBundle] bundleIdentifier] ?: @"";
  info[@"appVersion"] =
      [[NSBundle mainBundle]
          objectForInfoDictionaryKey:@"CFBundleShortVersionString"]
          ?: @"";
  info[@"buildNumber"] =
      [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleVersion"]
          ?: @"";
  info[@"isTablet"] = @([[UIDevice currentDevice] userInterfaceIdiom] ==
                        UIUserInterfaceIdiomPad);

  resolve(info);
}

RCT_EXPORT_METHOD(getSessionId : (RCTPromiseResolveBlock)
                      resolve reject : (RCTPromiseRejectBlock)reject) {
  NSString *sessionId = self.currentSessionId;

  if (sessionId) {
    resolve(sessionId);
  } else {
    resolve([NSNull null]);
  }
}

RCT_EXPORT_METHOD(getSDKMetrics : (RCTPromiseResolveBlock)
                      resolve reject : (RCTPromiseRejectBlock)reject) {

  NSDictionary *metrics = [[RJTelemetry sharedInstance] metricsAsDictionary];
  resolve(metrics ?: @{});
}

RCT_EXPORT_METHOD(stopSession : (RCTPromiseResolveBlock)
                      resolve reject : (RCTPromiseRejectBlock)reject) {

  RCTPromiseResolveBlock safeResolve = [resolve copy];

  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      if (!self.isRecording) {
        if (safeResolve)
          safeResolve(@{@"success" : @YES, @"sessionId" : @""});
        return;
      }

      self.isRecording = NO;

      if (self.lifecycleManager) {
        self.lifecycleManager.isRecording = NO;
      }

      NSString *sessionId = self.currentSessionId ?: @"";

    
      NSTimeInterval totalBgTimeMs = 0;
      if (self.lifecycleManager) {
        totalBgTimeMs = self.lifecycleManager.totalBackgroundTimeMs;
        if (self.lifecycleManager.isInBackground &&
            self.lifecycleManager.backgroundEntryTime > 0) {
          NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
          NSTimeInterval currentBgDurationMs =
              (now - self.lifecycleManager.backgroundEntryTime) * 1000.0;
          totalBgTimeMs += currentBgDurationMs;
          RJLogInfo(@"[RJ-SESSION-END] stopSession adding current background "
                    @"duration: %.0fms, total: %.0fms",
                    currentBgDurationMs, totalBgTimeMs);
        }
      }
      self.totalBackgroundTimeMs = totalBgTimeMs;

      [RJLogger logSessionEnd:sessionId];

      [self stopBatchUploadTimer];
      [self stopDurationLimitTimer];

      if (self.captureEngine) {
        @try {
          [self.captureEngine stopSession];
        } @catch (NSException *captureException) {
          RJLogWarning(@"Capture engine stop exception: %@", captureException);
        }
      }

      [self logEventInternal:RJEventTypeSessionEnd
                     details:@{
                       @"totalBackgroundTime" : @(self.totalBackgroundTimeMs)
                     }];

      if (self.uploadManager) {
        self.uploadManager.totalBackgroundTimeMs = self.totalBackgroundTimeMs;
      }

      __block BOOL flushCompleted = NO;

      [self flushAllDataWithCompletion:^(BOOL success) {
        flushCompleted = YES;
        if (safeResolve)
          safeResolve(@{
            @"success" : @YES,
            @"sessionId" : sessionId,
            @"uploadSuccess" : @(success)
          });
      }];

      dispatch_after(
          dispatch_time(DISPATCH_TIME_NOW, (int64_t)(10.0 * NSEC_PER_SEC)),
          dispatch_get_main_queue(), ^{
            if (!flushCompleted && safeResolve) {
              RJLogWarning(@"Session flush timed out");
              safeResolve(@{
                @"success" : @YES,
                @"sessionId" : sessionId,
                @"uploadSuccess" : @NO,
                @"warning" : @"Flush timed out"
              });
            }
          });
    } @catch (NSException *exception) {
      RJLogError(@"Failed to stop session: %@", exception);
      self.isRecording = NO;
      if (self.lifecycleManager) {
        self.lifecycleManager.isRecording = NO;
      }
      if (safeResolve)
        safeResolve(@{
          @"success" : @NO,
          @"error" : exception.reason ?: @"Unknown error"
        });
    }
  });
}

RCT_EXPORT_METHOD(logEvent : (NSString *)eventType details : (NSDictionary *)
                      details resolve : (RCTPromiseResolveBlock)
                          resolve reject : (RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      if (self.isRecording) {
        [self logEventInternal:eventType details:details];
      }
      resolve(@{@"success" : @YES});
    } @catch (NSException *exception) {
      resolve(@{@"success" : @YES});
    }
  });
}

RCT_EXPORT_METHOD(screenChanged : (NSString *)screenName resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      if (!self.isRecording) {
        resolve(@{@"success" : @YES});
        return;
      }

      [RJViewControllerTracker setAuthoritativeScreenName:screenName];

      [self logEventInternal:RJEventTypeNavigation
                     details:@{@"screen" : screenName, @"source" : @"js"}];

      [self.captureEngine notifyNavigationToScreen:screenName];
      [self.captureEngine notifyReactNativeCommit];

      resolve(@{@"success" : @YES});
    } @catch (NSException *exception) {
      resolve(@{@"success" : @YES});
    }
  });
}

RCT_EXPORT_METHOD(onScroll : (nonnull NSNumber *)offsetY resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {

  resolve(@{@"success" : @YES});
}

RCT_EXPORT_METHOD(markVisualChange : (NSString *)reason importance : (
    NSString *)importanceString resolve : (RCTPromiseResolveBlock)
                      resolve reject : (RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      if (!self.isRecording) {
        resolve(@YES);
        return;
      }

      [self logEventInternal:RJEventTypeVisualChange
                     details:@{
                       @"reason" : reason,
                       @"importance" : importanceString
                     }];

      if (self.captureEngine) {
        [self.captureEngine notifyReactNativeCommit];
      }

      resolve(@YES);
    } @catch (NSException *exception) {
      resolve(@YES);
    }
  });
}

RCT_EXPORT_METHOD(onExternalURLOpened : (NSString *)urlScheme resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      if (!self.isRecording) {
        resolve(@{@"success" : @YES});
        return;
      }

      self.didOpenExternalURL = YES;
      self.lastOpenedURLScheme = urlScheme;

      [self logEventInternal:RJEventTypeExternalURLOpened
                     details:@{@"scheme" : urlScheme ?: @"unknown"}];

      resolve(@{@"success" : @YES});
    } @catch (NSException *exception) {
      resolve(@{@"success" : @YES});
    }
  });
}

RCT_EXPORT_METHOD(onOAuthStarted : (NSString *)provider resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      if (!self.isRecording) {
        resolve(@{@"success" : @YES});
        return;
      }

      self.didOpenExternalURL = YES;
      self.lastOpenedURLScheme =
          [NSString stringWithFormat:@"oauth_%@", provider];

      [self logEventInternal:RJEventTypeOAuthStarted
                     details:@{@"provider" : provider ?: @"unknown"}];

      resolve(@{@"success" : @YES});
    } @catch (NSException *exception) {
      resolve(@{@"success" : @YES});
    }
  });
}

RCT_EXPORT_METHOD(onOAuthCompleted : (NSString *)provider success : (BOOL)
                      success resolve : (RCTPromiseResolveBlock)
                          resolve reject : (RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      if (!self.isRecording) {
        resolve(@{@"success" : @YES});
        return;
      }

      [self logEventInternal:RJEventTypeOAuthCompleted
                     details:@{
                       @"provider" : provider ?: @"unknown",
                       @"success" : @(success)
                     }];

      resolve(@{@"success" : @YES});
    } @catch (NSException *exception) {
      resolve(@{@"success" : @YES});
    }
  });
}

#pragma mark - Privacy / View Masking

RCT_EXPORT_METHOD(maskViewByNativeID : (NSString *)nativeID resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      if (!nativeID || nativeID.length == 0) {
        resolve(@{@"success" : @NO});
        return;
      }

      [self.captureEngine.privacyMask addMaskedNativeID:nativeID];
      RJLogDebug(@"Masked nativeID: %@", nativeID);
      resolve(@{@"success" : @YES});
    } @catch (NSException *exception) {
      RJLogWarning(@"maskViewByNativeID failed: %@", exception);
      resolve(@{@"success" : @NO});
    }
  });
}

RCT_EXPORT_METHOD(unmaskViewByNativeID : (NSString *)nativeID resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      if (!nativeID || nativeID.length == 0) {
        resolve(@{@"success" : @NO});
        return;
      }

      [self.captureEngine.privacyMask removeMaskedNativeID:nativeID];
      RJLogDebug(@"Unmasked nativeID: %@", nativeID);
      resolve(@{@"success" : @YES});
    } @catch (NSException *exception) {
      RJLogWarning(@"unmaskViewByNativeID failed: %@", exception);
      resolve(@{@"success" : @NO});
    }
  });
}

- (UIView *)findViewWithNativeID:(NSString *)nativeID inView:(UIView *)view {
  if (!view || !nativeID)
    return nil;

  if ([view.accessibilityIdentifier isEqualToString:nativeID]) {
    return view;
  }

  for (UIView *subview in view.subviews) {
    UIView *found = [self findViewWithNativeID:nativeID inView:subview];
    if (found)
      return found;
  }

  return nil;
}

#pragma mark - Debug Mode

RCT_EXPORT_METHOD(setDebugMode : (BOOL)enabled resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  @try {
    [RJLogger setDebugMode:enabled];
    resolve(@{@"success" : @YES});
  } @catch (NSException *exception) {
    RJLogWarning(@"setDebugMode failed: %@", exception);
    resolve(@{@"success" : @NO});
  }
}

#pragma mark - User Identity

RCT_EXPORT_METHOD(setUserIdentity : (NSString *)userId resolve : (
    RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  dispatch_async(self.stateQueue, ^{
    @try {
      NSString *safeUserId = userId.length > 0 ? userId : @"anonymous";

      [[NSUserDefaults standardUserDefaults] setObject:safeUserId
                                                forKey:@"rj_user_identity"];
      [[NSUserDefaults standardUserDefaults] synchronize];

      self.userId = safeUserId;
      if (self.uploadManager) {
        self.uploadManager.userId = safeUserId;
      }

      RJLogDebug(@"User identity updated and persisted: %@", safeUserId);

      if (self.isRecording) {
        NSMutableDictionary *event = [NSMutableDictionary new];
        event[@"type"] = @"user_identity_changed";
        event[@"timestamp"] = @([RJWindowUtils currentTimestampMillis]);
        event[@"userId"] = safeUserId;

        if (self.eventBuffer) {
          [self.eventBuffer appendEvent:event];
        }
        if (self.sessionEvents && !self.isShuttingDown) {
          [self.sessionEvents addObject:event];
        }
      }

      if (resolve)
        resolve(@{@"success" : @YES});
    } @catch (NSException *exception) {
      if (resolve)
        resolve(@{@"success" : @NO});
    }
  });
}

RCT_EXPORT_METHOD(getUserIdentity : (RCTPromiseResolveBlock)
                      resolve reject : (RCTPromiseRejectBlock)reject) {
  NSString *userId =
      [[NSUserDefaults standardUserDefaults] stringForKey:@"rj_user_identity"];
  resolve(userId ?: [NSNull null]);
}

#pragma mark - RJTouchInterceptorDelegate

- (void)touchInterceptorDidDetectInteractionStart {
}

- (void)touchInterceptorDidRecognizeGesture:(NSString *)gestureType
                                    touches:(NSArray<NSDictionary *> *)touches
                                   duration:(NSTimeInterval)duration
                                targetLabel:(NSString *)targetLabel {

  if (!self.isRecording || self.isShuttingDown) {
    return;
  }
  if (!gestureType) {
    return;
  }

  if ([gestureType hasPrefix:@"scroll"]) {
    static NSTimeInterval lastScrollLogTime = 0;
    NSTimeInterval now = CACurrentMediaTime();
    if (now - lastScrollLogTime < 0.5) {
      return;
    }
    lastScrollLogTime = now;
  }

  dispatch_async(self.stateQueue, ^{
    @try {
      NSMutableDictionary *details =
          [NSMutableDictionary dictionaryWithDictionary:@{
            @"gestureType" : gestureType ?: @"unknown",
            @"duration" : @(duration),
            @"touchCount" : @(touches.count),
            @"touches" : touches ?: @[],
            @"targetLabel" : targetLabel ?: [NSNull null]
          }];

      [self logEventInternal:RJEventTypeGesture details:[details copy]];

      dispatch_async(dispatch_get_main_queue(), ^{
        if (self.captureEngine) {
          [self.captureEngine notifyGesture:gestureType];
        }
      });

    } @catch (NSException *exception) {
      RJLogWarning(@"Gesture handling failed: %@", exception);
    }
  });
}

- (BOOL)isCurrentlyRecording {
  return self.isRecording;
}

- (BOOL)isKeyboardCurrentlyVisible {
  return self.lifecycleManager.isKeyboardVisible;
}

- (CGRect)currentKeyboardFrame {
  return self.lifecycleManager.keyboardFrame;
}

- (void)touchInterceptorDidCaptureMotionEvent:(RJMotionEvent *)motionEvent {

  if (!self.isRecording || self.isShuttingDown)
    return;
  if (!motionEvent)
    return;

  @try {

    NSMutableDictionary *details = [NSMutableDictionary dictionary];
    details[@"motionType"] = [motionEvent typeName];
    details[@"t0"] = @(motionEvent.t0);
    details[@"t1"] = @(motionEvent.t1);
    details[@"dx"] = @(motionEvent.dx);
    details[@"dy"] = @(motionEvent.dy);
    details[@"v0"] = @(motionEvent.v0);
    details[@"v1"] = @(motionEvent.v1);
    details[@"curve"] = [motionEvent curveName];
    if (motionEvent.targetId) {
      details[@"targetId"] = motionEvent.targetId;
    }

    [self logEventInternal:@"motion" details:details];

    RJLogDebug(@"Motion event logged: %@ dx=%.1f dy=%.1f v0=%.1f",
               [motionEvent typeName], motionEvent.dx, motionEvent.dy,
               motionEvent.v0);
  } @catch (NSException *exception) {
    RJLogWarning(@"Motion event handling failed: %@", exception);
  }
}

#pragma mark - Device Authentication

- (void)setupDeviceAuthWithPublicKey:(NSString *)publicKey
                              apiUrl:(NSString *)apiUrl {
  RJLogDebug(@"Registering device for authentication...");
  RJDeviceAuthManager *deviceAuth = [RJDeviceAuthManager sharedManager];
  NSString *bundleId = [[NSBundle mainBundle] bundleIdentifier] ?: @"unknown";

  __weak __typeof__(self) weakSelf = self;
  [deviceAuth
      registerDeviceWithProjectKey:publicKey
                          bundleId:bundleId
                          platform:@"ios"
                        sdkVersion:RJSDKVersion
                            apiUrl:apiUrl
                        completion:^(BOOL success, NSString *credId,
                                     NSError *error) {
                          __strong __typeof__(weakSelf) strongSelf = weakSelf;
                          if (!strongSelf)
                            return;

                          if (!success) {
                            RJLogError(@"Device registration failed: %@",
                                       error);

                            if (error.code == 403) {
                              RJLogError(@"SECURITY: Bundle ID mismatch or "
                                         @"access forbidden. "
                                         @"Stopping recording to prevent data "
                                         @"leakage.");
                              strongSelf.authPermanentlyFailed = YES;
                              [strongSelf handleAuthenticationFailure:error];
                            } else {
                              [strongSelf scheduleAuthRetryWithError:error
                                                           publicKey:publicKey
                                                              apiUrl:apiUrl];
                            }
                          } else {
                            RJLogDebug(@"Device registered: %@", credId);

                            [strongSelf resetAuthRetryState];

                            [strongSelf
                                handleUploadTokenFetchWithDeviceAuth:deviceAuth
                                                           publicKey:publicKey
                                                              apiUrl:apiUrl
                                                             isRetry:NO];
                          }
                        }];
}

- (void)handleAuthenticationFailure:(NSError *)error {
  RJLogError(@"Authentication failure - stopping recording. Error: %@", error);

  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.isRecording) {
      self.isRecording = NO;

      if (self.captureEngine) {
        [self.captureEngine stopSession];
      }

      [[RJDeviceAuthManager sharedManager] clearAllAuthData];

      @try {
        if (self.bridge) {
          [self.bridge enqueueJSCall:@"RCTDeviceEventEmitter"
                              method:@"emit"
                                args:@[
                                  @"rejourneyAuthError", @{
                                    @"code" : @(error.code),
                                    @"message" : error.localizedDescription
                                        ?: @"Authentication failed",
                                    @"domain" : error.domain ?: @"RJDeviceAuth"
                                  }
                                ]
                          completion:nil];
        }
      } @catch (NSException *exception) {
        RJLogWarning(@"Failed to notify JS about auth error: %@", exception);
      }
    }
  });
}

#pragma mark - Auth Retry Mechanism

- (void)scheduleAuthRetryWithError:(NSError *)error
                         publicKey:(NSString *)publicKey
                            apiUrl:(NSString *)apiUrl {
  if (self.authPermanentlyFailed) {
    RJLogWarning(@"Auth permanently failed - not scheduling retry");
    return;
  }

  self.authRetryCount++;

  if (self.authRetryCount > RJ_MAX_AUTH_RETRIES) {
    RJLogError(@"Auth failed after %ld retries. Recording continues locally, "
               @"events will be uploaded when auth succeeds.",
               (long)RJ_MAX_AUTH_RETRIES);

    dispatch_async(dispatch_get_main_queue(), ^{
      @try {
        if (self.bridge) {
          [self.bridge enqueueJSCall:@"RCTDeviceEventEmitter"
                              method:@"emit"
                                args:@[
                                  @"rejourneyAuthWarning", @{
                                    @"code" : @(error.code),
                                    @"message" : @"Auth failed after max "
                                                 @"retries. Recording locally.",
                                    @"retryCount" : @(self.authRetryCount)
                                  }
                                ]
                          completion:nil];
        }
      } @catch (NSException *exception) {
      }
    });

    [self scheduleBackgroundAuthRetryAfter:300.0
                                 publicKey:publicKey
                                    apiUrl:apiUrl];
    return;
  }

  NSTimeInterval delay =
      MIN(RJ_AUTH_RETRY_BASE_DELAY * pow(2, self.authRetryCount - 1),
          RJ_AUTH_RETRY_MAX_DELAY);

  RJLogInfo(@"Auth failed (attempt %ld/%ld), retrying in %.1fs. "
            @"Recording continues locally. Error: %@",
            (long)self.authRetryCount, (long)RJ_MAX_AUTH_RETRIES, delay,
            error.localizedDescription);

  [self scheduleBackgroundAuthRetryAfter:delay
                               publicKey:publicKey
                                  apiUrl:apiUrl];
}

- (void)scheduleBackgroundAuthRetryAfter:(NSTimeInterval)delay
                               publicKey:(NSString *)publicKey
                                  apiUrl:(NSString *)apiUrl {
  if (self.authRetryTimer) {
    [self.authRetryTimer invalidate];
    self.authRetryTimer = nil;
  }

  self.nextAuthRetryTime = [[NSDate date] timeIntervalSince1970] + delay;

  __weak __typeof__(self) weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    __strong __typeof__(weakSelf) strongSelf = weakSelf;
    if (!strongSelf)
      return;

    strongSelf.authRetryTimer = [NSTimer
        scheduledTimerWithTimeInterval:delay
                               repeats:NO
                                 block:^(NSTimer *timer) {
                                   [strongSelf
                                       performAuthRetryWithPublicKey:publicKey
                                                              apiUrl:apiUrl];
                                 }];
  });
}

- (void)performAuthRetryWithPublicKey:(NSString *)publicKey
                               apiUrl:(NSString *)apiUrl {
  if (self.authPermanentlyFailed || self.isShuttingDown) {
    return;
  }

  RJLogInfo(@"Retrying auth (attempt %ld)...", (long)(self.authRetryCount + 1));

  if (self.authRetryCount >= 2) {
    RJLogInfo(@"Clearing cached auth data and re-registering fresh...");
    [[RJDeviceAuthManager sharedManager] clearAllAuthData];
  }

  [self setupDeviceAuthWithPublicKey:publicKey apiUrl:apiUrl];
}

- (void)resetAuthRetryState {
  self.authRetryCount = 0;
  self.authPermanentlyFailed = NO;
  self.nextAuthRetryTime = 0;

  if (self.authRetryTimer) {
    [self.authRetryTimer invalidate];
    self.authRetryTimer = nil;
  }
}

- (void)handleUploadTokenFetchWithDeviceAuth:(RJDeviceAuthManager *)deviceAuth
                                   publicKey:(NSString *)publicKey
                                      apiUrl:(NSString *)apiUrl
                                     isRetry:(BOOL)isRetry {
  __weak __typeof__(self) weakSelf = self;
  [deviceAuth getUploadTokenWithCompletion:^(BOOL success, NSString *token,
                                             NSInteger expiresIn,
                                             NSError *error) {
    __strong __typeof__(weakSelf) strongSelf = weakSelf;
    if (!strongSelf)
      return;

    if (success) {
      RJLogDebug(@"Got upload token (expires in %ld seconds)", (long)expiresIn);

      [strongSelf.uploadManager recoverPendingSessionsWithCompletion:nil];
      [strongSelf handlePendingCrashReportUpload];
      [strongSelf handlePendingANRReportUpload];
      [strongSelf handlePendingVideoSegmentRecovery];
      return;
    }

    if ((error.code == 403 || error.code == 404) &&
        [error.domain isEqualToString:@"RJDeviceAuth"]) {

      if (!isRetry) {
        RJLogDebug(@"Device auth invalid (%ld), attempting re-registration...",
                   (long)error.code);
        NSString *bundleId =
            [[NSBundle mainBundle] bundleIdentifier] ?: @"unknown";

        __typeof__(strongSelf) nestedSelf = strongSelf;
        [deviceAuth
            registerDeviceWithProjectKey:publicKey
                                bundleId:bundleId
                                platform:@"ios"
                              sdkVersion:RJSDKVersion
                                  apiUrl:apiUrl
                              completion:^(BOOL retrySuccess, NSString *credId,
                                           NSError *retryError) {
                                if (retrySuccess) {
                                  RJLogDebug(@"Re-registration successful, "
                                             @"retrying token fetch...");
                                  [nestedSelf
                                      handleUploadTokenFetchWithDeviceAuth:
                                          deviceAuth
                                                                 publicKey:
                                                                     publicKey
                                                                    apiUrl:
                                                                        apiUrl
                                                                   isRetry:YES];
                                } else {
                                  RJLogError(@"Re-registration failed: %@",
                                             retryError);
                                  if (retryError.code == 403 ||
                                      retryError.code == 404) {
                                    [nestedSelf
                                        handleAuthenticationFailure:retryError];
                                  }
                                }
                              }];
      } else {
        RJLogError(@"Token fetch failed after retry: %@", error);
        [strongSelf handleAuthenticationFailure:error];
      }
    } else {
      RJLogWarning(@"Failed to get upload token (transient): %@", error);
    }
  }];
}

- (void)handlePendingCrashReportUpload {
  if (![[RJCrashHandler sharedInstance] hasPendingCrashReport])
    return;

  RJLogDebug(@"Found pending crash report from previous session");
  NSDictionary *crashReport =
      [[RJCrashHandler sharedInstance] loadAndPurgePendingCrashReport];
  if (!crashReport)
    return;

  NSMutableDictionary *augmentedReport = [crashReport mutableCopy];
  augmentedReport[@"projectId"] = self.uploadManager.projectId;

  [self.uploadManager
      uploadCrashReport:augmentedReport
             completion:^(BOOL success) {
               if (success) {
                 RJLogDebug(@"Pending crash report uploaded");
               } else {
                 RJLogWarning(@"Failed to upload pending crash report");
               }
             }];
}

- (void)handlePendingANRReportUpload {
  if (![[RJANRHandler sharedInstance] hasPendingANRReport])
    return;

  RJLogDebug(@"Found pending ANR report from previous session");
  NSDictionary *anrReport =
      [[RJANRHandler sharedInstance] loadAndPurgePendingANRReport];
  if (!anrReport)
    return;

  NSMutableDictionary *augmentedReport = [anrReport mutableCopy];
  augmentedReport[@"projectId"] = self.uploadManager.projectId;
  augmentedReport[@"type"] = @"anr";

  [self.uploadManager
      uploadANRReport:augmentedReport
           completion:^(BOOL success) {
             if (success) {
               RJLogDebug(@"Pending ANR report uploaded");
             } else {
               RJLogWarning(@"Failed to upload pending ANR report");
             }
           }];
}

- (void)handlePendingVideoSegmentRecovery {
  NSDictionary *metadata = [RJVideoEncoder pendingCrashSegmentMetadata];
  if (!metadata)
    return;

  RJLogDebug(@"Found pending video segment from crash: %@", metadata);

  NSString *segmentPath = metadata[@"segmentPath"];
  NSString *sessionId = metadata[@"sessionId"];
  NSNumber *startTime = metadata[@"startTime"];
  NSNumber *endTime = metadata[@"endTime"];
  NSNumber *frameCount = metadata[@"frameCount"];
  BOOL finalized = [metadata[@"finalized"] boolValue];

  if (!segmentPath ||
      ![[NSFileManager defaultManager] fileExistsAtPath:segmentPath]) {
    RJLogWarning(@"Pending segment file not found at: %@", segmentPath);
    [RJVideoEncoder clearPendingCrashSegmentMetadata];
    return;
  }

  if (!finalized) {
    RJLogWarning(@"Pending segment was not finalized, skipping upload");

    [[NSFileManager defaultManager] removeItemAtPath:segmentPath error:nil];
    [RJVideoEncoder clearPendingCrashSegmentMetadata];
    return;
  }

  if (self.captureEngine.segmentUploader && sessionId.length > 0) {
    NSURL *segmentURL = [NSURL fileURLWithPath:segmentPath];

    RJLogDebug(@"Uploading recovered crash segment: %@", segmentPath);
    [self.captureEngine.segmentUploader
        uploadVideoSegment:segmentURL
                 sessionId:sessionId
                 startTime:[startTime doubleValue]
                   endTime:[endTime doubleValue]
                frameCount:[frameCount integerValue]
                completion:^(BOOL success, NSError *error) {
                  if (success) {
                    RJLogDebug(
                        @"Recovered crash segment uploaded successfully");

                    [[NSFileManager defaultManager] removeItemAtPath:segmentPath
                                                               error:nil];
                  } else {
                    RJLogWarning(
                        @"Failed to upload recovered crash segment: %@", error);
                  }

                  [RJVideoEncoder clearPendingCrashSegmentMetadata];
                }];
  } else {
    RJLogWarning(@"Cannot upload recovered segment: uploader not configured or "
                 @"no sessionId");
    [RJVideoEncoder clearPendingCrashSegmentMetadata];
  }
}

#pragma mark - RJANRHandlerDelegate

- (void)anrDetectedWithDuration:(NSTimeInterval)duration
                    threadState:(nullable NSString *)threadState {
  if (!self.isRecording)
    return;

  RJLogDebug(@"ANR callback: duration=%.2fs", duration);

  NSMutableDictionary *details = [NSMutableDictionary new];
  details[@"durationMs"] = @((NSInteger)(duration * 1000));
  if (threadState) {
    details[@"threadState"] = threadState;
  }

  [self logEventInternal:@"anr" details:details];

  if (self.uploadManager && self.currentSessionId &&
      self.currentSessionId.length > 0) {
    NSMutableDictionary *report = [NSMutableDictionary new];
    report[@"timestamp"] = @([[NSDate date] timeIntervalSince1970] * 1000);
    report[@"durationMs"] = @((NSInteger)(duration * 1000));
    report[@"type"] = @"anr";
    report[@"sessionId"] = self.currentSessionId;
    if (threadState) {
      report[@"threadState"] = threadState;
    }

    __weak __typeof__(self) weakSelf = self;
    [self.uploadManager
        uploadANRReport:[report copy]
             completion:^(BOOL success) {
               __strong __typeof__(weakSelf) strongSelf = weakSelf;
               if (!strongSelf)
                 return;
               if (success) {
                 RJLogDebug(@"ANR report uploaded (live)");
               } else {
                 RJLogWarning(@"ANR report upload failed (live)");
               }
             }];
  }

  [[RJTelemetry sharedInstance] recordANR];
}

#pragma mark - Event Logging

- (void)logEventInternal:(NSString *)eventType details:(NSDictionary *)details {

  if (self.isShuttingDown || !eventType)
    return;

  if ([eventType isEqualToString:@"gesture"]) {
    NSString *gestureType = details[@"gestureType"] ?: @"unknown";
    RJLogInfo(
        @"[RJ-EVENT] Logging gesture event: gestureType=%@, sessionId=%@, "
        @"eventBuffer=%@",
        gestureType, self.currentSessionId,
        self.eventBuffer ? @"exists" : @"nil");
  }

  @try {
    NSMutableDictionary *event =
        [NSMutableDictionary dictionaryWithCapacity:10];

    if (details) {
      @try {
        [event addEntriesFromDictionary:details];
      } @catch (NSException *e) {
        RJLogWarning(@"Failed to copy event details: %@", e);
      }
    }

    event[@"type"] = eventType;
    event[@"timestamp"] = @([RJWindowUtils currentTimestampMillis]);

    if (self.eventBuffer) {
      [self.eventBuffer appendEvent:event];
    }

    dispatch_async(self.stateQueue, ^{
      @try {
        if (self.sessionEvents && !self.isShuttingDown) {
          [self.sessionEvents addObject:event];
        }
      } @catch (NSException *e) {
        RJLogWarning(@"Failed to add event: %@", e);
      }
    });
  } @catch (NSException *exception) {
    RJLogWarning(@"Event logging failed: %@", exception);
  }
}

#pragma mark - Batch Upload Management

- (void)startBatchUploadTimer {
  [self stopBatchUploadTimer];

  __weak __typeof__(self) weakSelf = self;

  self.batchUploadTimer =
      [NSTimer scheduledTimerWithTimeInterval:RJBatchUploadInterval
                                      repeats:YES
                                        block:^(NSTimer *timer) {
                                          [weakSelf performBatchUploadIfNeeded];
                                        }];

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,
                               (int64_t)(RJInitialUploadDelay * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
                   if (weakSelf.isRecording) {
                     [weakSelf performBatchUploadIfNeeded];
                   }
                 });
}

- (void)stopBatchUploadTimer {
  [self.batchUploadTimer invalidate];
  self.batchUploadTimer = nil;
}

#pragma mark - Duration Limit Timer

- (void)startDurationLimitTimer {
  [self stopDurationLimitTimer];

  if (self.maxRecordingMinutes <= 0) {
    return;
  }

  NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
  NSTimeInterval elapsed = now - self.sessionStartTime;
  NSTimeInterval limitSeconds = self.maxRecordingMinutes * 60.0;
  NSTimeInterval remaining = limitSeconds - elapsed;

  if (remaining <= 0) {
    RJLogInfo(@"Duration limit reached immediately (elapsed: %.1fs, limit: "
              @"%.1fs), stopping session",
              elapsed, limitSeconds);
    [self stopSessionDueToMaxDuration];
    return;
  }

  RJLogDebug(
      @"Starting duration limit timer for %.1f seconds (limit: %ld mins)",
      remaining, (long)self.maxRecordingMinutes);

  __weak __typeof__(self) weakSelf = self;
  self.durationLimitTimer = [NSTimer
      scheduledTimerWithTimeInterval:remaining
                             repeats:NO
                               block:^(NSTimer *_Nonnull timer) {
                                 [weakSelf stopSessionDueToMaxDuration];
                               }];
}

- (void)stopDurationLimitTimer {
  if (self.durationLimitTimer) {
    [self.durationLimitTimer invalidate];
    self.durationLimitTimer = nil;
  }
}

- (void)stopSessionDueToMaxDuration {
  if (!self.isRecording)
    return;

  RJLogDebug(@"Max recording duration reached (%ld minutes) - stopping session",
             (long)self.maxRecordingMinutes);

  [self logEventInternal:RJEventTypeSessionEnd
                 details:@{
                   @"reason" : @"max_duration_reached",
                   @"maxMinutes" : @(self.maxRecordingMinutes)
                 }];

  [self stopSessionInternal];
}

- (void)stopSessionInternal {
  // Call the renamed method with nil callbacks
  [self stopSession:nil reject:nil];
}

- (void)performBatchUploadIfNeeded {
  RJLogInfo(@"[RJ-BATCH] performBatchUploadIfNeeded called, isRecording=%d, "
            @"isShuttingDown=%d",
            self.isRecording, self.isShuttingDown);

  if (!self.isRecording || self.isShuttingDown) {
    RJLogInfo(@"[RJ-BATCH] Early return - not recording or shutting down");
    return;
  }
  if (!self.uploadManager || self.uploadManager.isUploading) {
    RJLogInfo(@"[RJ-BATCH] Early return - uploadManager=%@, isUploading=%d",
              self.uploadManager ? @"exists" : @"nil",
              self.uploadManager.isUploading);
    return;
  }

  @try {

    __block NSArray<NSDictionary *> *events = nil;
    __block NSInteger eventCount = 0;
    [self performStateSync:^{
      events = [self.sessionEvents copy];
      eventCount = events.count;
    }];

    if (!events || events.count == 0) {
      RJLogInfo(@"[RJ-BATCH] No events to upload");
      return;
    }

    RJLogInfo(@"[RJ-BATCH] Uploading %ld events for session %@",
              (long)eventCount, self.currentSessionId);

    __weak __typeof__(self) weakSelf = self;
    [self.uploadManager
        uploadBatchWithEvents:events
                      isFinal:NO
                   completion:^(BOOL success) {
                     RJLogInfo(@"[RJ-BATCH] Batch upload completed, success=%d",
                               success);
                     __strong __typeof__(weakSelf) strongSelf = weakSelf;
                     if (!strongSelf || strongSelf.isShuttingDown)
                       return;

                     if (success) {
                       if (eventCount > 0) {

                         __typeof__(strongSelf) innerSelf = strongSelf;

                         dispatch_async(strongSelf.stateQueue, ^{
                           @try {
                             if (innerSelf.sessionEvents.count >= eventCount) {
                               [innerSelf.sessionEvents
                                   removeObjectsInRange:NSMakeRange(
                                                            0, eventCount)];
                             }
                           } @catch (NSException *innerException) {
                             RJLogWarning(@"Failed to remove events: %@",
                                          innerException);
                           }
                         });
                       }
                     }
                   }];
  } @catch (NSException *outerException) {
    RJLogWarning(@"Batch upload preparation failed: %@", outerException);
  }
}

- (void)scheduleImmediateUploadKick {
  if (!self.isRecording || self.isShuttingDown)
    return;

  NSTimeInterval nowMs = [[NSDate date] timeIntervalSince1970] * 1000.0;
  if (nowMs - self.lastImmediateUploadKickMs < 1000.0)
    return;
  self.lastImmediateUploadKickMs = nowMs;

  dispatch_async(dispatch_get_main_queue(), ^{
    [self performBatchUploadIfNeeded];
  });
}

- (void)flushDataWithCompletion:(RJCompletionHandler)completion
                        isFinal:(BOOL)isFinal {

  RJCompletionHandler safeCompletion = [completion copy];

  @try {

    __weak __typeof__(self) weakSelf = self;

    dispatch_after(
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)),
        dispatch_get_main_queue(), ^{
          __strong __typeof__(weakSelf) strongSelf = weakSelf;

          if (!strongSelf) {
            if (safeCompletion)
              safeCompletion(NO);
            return;
          }

          @try {

            __typeof__(strongSelf) innerSelf = strongSelf;

            __block NSArray<NSDictionary *> *events = nil;
            [strongSelf performStateSync:^{
              events = [innerSelf.sessionEvents copy];
            }];

            NSInteger crashCount = 0;
            NSInteger anrCount = 0;
            NSInteger errorCount = 0;
            for (NSDictionary *event in events) {
              NSString *type = event[@"type"];
              if ([type isEqualToString:@"crash"])
                crashCount++;
              else if ([type isEqualToString:@"anr"])
                anrCount++;
              else if ([type isEqualToString:@"error"])
                errorCount++;
            }

            NSDictionary *metrics = @{
              @"crashCount" : @(crashCount),
              @"anrCount" : @(anrCount),
              @"errorCount" : @(errorCount),
              @"durationSeconds" :
                  @((NSInteger)([[NSDate date] timeIntervalSince1970] -
                                strongSelf.sessionStartTime))
            };

            if (!strongSelf.uploadManager) {
              if (safeCompletion)
                safeCompletion(NO);
              return;
            }

            if (!isFinal) {
              RJLogInfo(
                  @"[RJ-FLUSH] Non-final background flush - uploading %lu "
                  @"events without ending session",
                  (unsigned long)(events ?: @[]).count);
              [strongSelf.uploadManager uploadBatchWithEvents:events ?: @[]
                                                      isFinal:NO
                                                   completion:safeCompletion];
              return;
            }

            [strongSelf.uploadManager
                evaluateReplayPromotionWithMetrics:metrics
                                        completion:^(BOOL promoted,
                                                     NSString *reason) {
                                          __strong __typeof__(weakSelf)
                                              innerStrongSelf = weakSelf;
                                          if (!innerStrongSelf) {
                                            if (safeCompletion)
                                              safeCompletion(NO);
                                            return;
                                          }

                                          if (!promoted) {
                                            RJLogDebug(
                                                @"Session not promoted for "
                                                @"replay (reason: %@)",
                                                reason);
                                          } else {
                                            RJLogDebug(
                                                @"Session promoted (reason: "
                                                @"%@)",
                                                reason);
                                          }

                                          if (innerStrongSelf.uploadManager
                                                  .isUploading) {
                                            RJLogDebug(
                                                @"Upload in progress during "
                                                @"flush; waiting then "
                                                @"performing synchronous final "
                                                @"upload");
                                            dispatch_async(
                                                dispatch_get_global_queue(
                                                    DISPATCH_QUEUE_PRIORITY_DEFAULT,
                                                    0),
                                                ^{
                                                  BOOL ok = [innerStrongSelf
                                                                 .uploadManager
                                                      synchronousUploadWithEvents:
                                                          events ?: @[]];
                                                  dispatch_async(
                                                      dispatch_get_main_queue(),
                                                      ^{
                                                        if (safeCompletion)
                                                          safeCompletion(ok);
                                                      });
                                                });
                                          } else {
                                            [innerStrongSelf.uploadManager
                                                uploadBatchWithEvents:events
                                                                          ?: @[]
                                                              isFinal:YES
                                                           completion:
                                                               safeCompletion];
                                          }
                                        }];
          } @catch (NSException *exception) {
            RJLogWarning(@"Flush data failed: %@", exception);
            if (safeCompletion)
              safeCompletion(NO);
          }
        });
  } @catch (NSException *exception) {
    RJLogWarning(@"Flush preparation failed: %@", exception);
    if (safeCompletion)
      safeCompletion(NO);
  }
}

- (void)flushAllDataWithCompletion:(RJCompletionHandler)completion {
  [self flushDataWithCompletion:completion isFinal:YES];
}

- (void)flushDataForBackgroundWithCompletion:(RJCompletionHandler)completion {
  [self flushDataWithCompletion:completion isFinal:NO];
}

#pragma mark - Helpers

- (RJCaptureImportance)importanceFromString:(NSString *)string {
  if ([string isEqualToString:@"low"]) {
    return RJCaptureImportanceLow;
  } else if ([string isEqualToString:@"high"]) {
    return RJCaptureImportanceHigh;
  } else if ([string isEqualToString:@"critical"]) {
    return RJCaptureImportanceCritical;
  }
  return RJCaptureImportanceMedium;
}

#pragma mark - Notifications

- (void)registerNotifications {

  RJLogInfo(@"[RJ-LIFECYCLE] registerNotifications called (isRecording=%@, "
            @"lifecycleManager=%@)",
            self.isRecording ? @"YES" : @"NO",
            self.lifecycleManager ? @"exists" : @"nil");
  self.lifecycleManager.isRecording = self.isRecording;
  [self.lifecycleManager startObserving];
}

#pragma mark - RJLifecycleManagerDelegate

- (void)lifecycleManagerKeyboardDidShow:(CGRect)keyboardFrame {
  RJLogInfo(
      @"[RJ-DELEGATE] lifecycleManagerKeyboardDidShow called, isRecording=%d",
      self.isRecording);
  if (self.isRecording) {
    RJLogDebug(@"[KEYBOARD] Keyboard shown (height=%.0f)",
               keyboardFrame.size.height);
    [self logEventInternal:RJEventTypeKeyboardShow
                   details:@{
                     @"keyboardHeight" : @(keyboardFrame.size.height),
                     @"keyboardY" : @(keyboardFrame.origin.y)
                   }];
  }
}

- (void)lifecycleManagerKeyboardWillHide:(NSInteger)keyPressCount {
  RJLogInfo(
      @"[RJ-DELEGATE] lifecycleManagerKeyboardWillHide called, isRecording=%d",
      self.isRecording);
  if (self.isRecording) {
    RJLogDebug(@"[KEYBOARD] Keyboard hiding (keyPresses=%ld)",
               (long)keyPressCount);
    if (keyPressCount > 0) {
      [self logEventInternal:RJEventTypeKeyboardTyping
                     details:@{@"keyPressCount" : @(keyPressCount)}];
    }
    [self logEventInternal:RJEventTypeKeyboardHide details:nil];
  }
}

- (void)lifecycleManagerTextDidChange {
  if (!self.isRecording || self.isShuttingDown)
    return;

  NSTimeInterval nowMs = [[NSDate date] timeIntervalSince1970] * 1000;
  if (self.lastKeyboardTypingEventTimeMs > 0 &&
      (nowMs - self.lastKeyboardTypingEventTimeMs) < 250) {
    return;
  }
  self.lastKeyboardTypingEventTimeMs = nowMs;

  [self logEventInternal:RJEventTypeKeyboardTyping
                 details:@{@"keyPressCount" : @1}];
}

- (void)lifecycleManagerDidResignActive {
  RJLogInfo(@"[RJ-DELEGATE] lifecycleManagerDidResignActive called");
}

- (void)lifecycleManagerDidEnterBackground {
  RJLogInfo(@"[RJ-DELEGATE] lifecycleManagerDidEnterBackground called, "
            @"isRecording=%d, isShuttingDown=%d",
            self.isRecording, self.isShuttingDown);

  if (!self.isRecording || self.isShuttingDown) {
    RJLogInfo(
        @"[RJ-DELEGATE] lifecycleManagerDidEnterBackground - early return "
        @"(not recording or shutting down)");
    return;
  }

  RJLogInfo(@"[RJ-DELEGATE] App entered background - flushing all data");

  @try {
    [self stopBatchUploadTimer];

    if (self.uploadManager && self.lifecycleManager) {
      NSTimeInterval currentBgTime =
          self.lifecycleManager.totalBackgroundTimeMs;
      self.uploadManager.totalBackgroundTimeMs = currentBgTime;
      RJLogInfo(
          @"[RJ-DELEGATE] Synced background time to uploadManager: %.0fms",
          currentBgTime);
    }

    NSMutableDictionary *bgEvent =
        [NSMutableDictionary dictionaryWithCapacity:3];
    bgEvent[@"type"] = RJEventTypeAppBackground;
    bgEvent[@"timestamp"] = @([RJWindowUtils currentTimestampMillis]);
    [self performStateSync:^{
      if (self.sessionEvents) {
        [self.sessionEvents addObject:bgEvent];
        RJLogInfo(@"[RJ-EVENT] Added app_background event synchronously (total "
                  @"events: %lu)",
                  (unsigned long)self.sessionEvents.count);
      }
    }];

    if (self.eventBuffer) {
      [self.eventBuffer appendEvent:bgEvent];
    }

    if (self.captureEngine) {
      @try {
        RJLogInfo(@"[RJ-VIDEO] Pausing video capture for background (ASYNC)");
        [self.captureEngine pauseVideoCapture];
        RJLogInfo(@"[RJ-VIDEO] Video capture pause initiated");
      } @catch (NSException *e) {
        RJLogWarning(@"Background capture failed: %@", e);
      }
    }

    __weak __typeof__(self) weakSelf = self;
    if (self.uploadManager) {
      self.backgroundTaskId = [self.uploadManager
          beginBackgroundTaskWithName:@"RejourneySessionFlush"];
    }

    RJLogInfo(@"[RJ-FLUSH] Starting non-final background flush (session will "
              @"resume if user returns)");
    [self flushDataForBackgroundWithCompletion:^(BOOL success) {
      __strong __typeof__(weakSelf) strongSelf = weakSelf;
      if (!strongSelf)
        return;

      __typeof__(strongSelf) innerSelf = strongSelf;
      dispatch_async(dispatch_get_main_queue(), ^{
        @try {
          if (success) {
            RJLogDebug(@"Background flush successful");

            [innerSelf.uploadManager updateSessionRecoveryMeta];
          } else {
            RJLogWarning(@"Background flush failed - data may be lost");
          }

          if (innerSelf.uploadManager &&
              innerSelf.backgroundTaskId != UIBackgroundTaskInvalid) {
            [innerSelf.uploadManager
                endBackgroundTask:innerSelf.backgroundTaskId];
            innerSelf.backgroundTaskId = UIBackgroundTaskInvalid;
          }
        } @catch (NSException *e) {
          RJLogWarning(@"Background task cleanup failed: %@", e);
        }
      });
    }];
  } @catch (NSException *exception) {
    RJLogError(@"App background handling failed: %@", exception);
  }
}

- (void)lifecycleManagerWillTerminate {
  if (!self.isRecording)
    return;

  RJLogDebug(
      @"[LIFECYCLE] App TERMINATING - attempting final flush (sessionId=%@)",
      self.currentSessionId);
  self.isRecording = NO;
  if (self.lifecycleManager) {
    self.lifecycleManager.isRecording = NO;
  }
  self.isShuttingDown = YES;

  RJLogDebug(@"App terminating - synchronous flush");

  @try {
    [self stopBatchUploadTimer];

    if (self.uploadManager && self.lifecycleManager) {
      NSTimeInterval totalBgTime = self.lifecycleManager.totalBackgroundTimeMs;

      if (self.lifecycleManager.isInBackground &&
          self.lifecycleManager.backgroundEntryTime > 0) {
        NSTimeInterval currentTime = [[NSDate date] timeIntervalSince1970];
        NSTimeInterval currentBgDurationMs =
            (currentTime - self.lifecycleManager.backgroundEntryTime) * 1000;
        totalBgTime += currentBgDurationMs;
        RJLogInfo(@"[RJ-TERMINATE] Adding current background duration: %.0fms, "
                  @"total: %.0fms",
                  currentBgDurationMs, totalBgTime);
      }

      self.uploadManager.totalBackgroundTimeMs = totalBgTime;
      RJLogInfo(
          @"[RJ-TERMINATE] Synced total background time to uploadManager: "
          @"%.0fms",
          totalBgTime);
    }

    if (self.captureEngine) {

      RJLogInfo(@"[RJ-TERMINATE] Stopping capture engine synchronously");
      [self.captureEngine stopSessionSync];
      RJLogInfo(@"[RJ-TERMINATE] Capture engine stopped");
    }

    NSMutableDictionary *terminateEvent =
        [NSMutableDictionary dictionaryWithCapacity:3];
    terminateEvent[@"type"] = RJEventTypeAppTerminated;
    terminateEvent[@"timestamp"] = @([RJWindowUtils currentTimestampMillis]);

    [self performStateSync:^{
      if (self.sessionEvents) {
        [self.sessionEvents addObject:terminateEvent];
        RJLogInfo(@"[RJ-EVENT] Added app_terminated event synchronously (total "
                  @"events: %lu)",
                  (unsigned long)self.sessionEvents.count);
      }
    }];

    __block NSArray<NSDictionary *> *events = nil;
    @try {
      [self performStateSync:^{
        events = [self.sessionEvents copy];
      }];
    } @catch (NSException *e) {
      events = @[];
    }
    if (!events) {
      events = @[];
    }

    if (self.uploadManager && events.count > 0) {
      @try {
        [self.uploadManager persistTerminationEvents:events ?: @[]];
      } @catch (NSException *e) {
        RJLogWarning(@"Terminate persistence failed: %@", e);
      }
    }
  } @catch (NSException *exception) {
    RJLogError(@"App termination handling failed: %@", exception);
  }
}

- (void)lifecycleManagerDidBecomeActive {
  RJLogInfo(@"[RJ-DELEGATE] lifecycleManagerDidBecomeActive called, "
            @"isRecording=%d, isShuttingDown=%d",
            self.isRecording, self.isShuttingDown);

  if (!self.isRecording || self.isShuttingDown) {
    RJLogInfo(
        @"[RJ-DELEGATE] lifecycleManagerDidBecomeActive - early return (not "
        @"recording or shutting down)");
    return;
  }

  RJLogInfo(@"[RJ-DELEGATE] App became active - resuming video capture");

  @try {
    NSTimeInterval bgTimeMs = self.lifecycleManager.totalBackgroundTimeMs;

    self.totalBackgroundTimeMs = bgTimeMs;

    if (self.uploadManager) {
      self.uploadManager.totalBackgroundTimeMs = bgTimeMs;
    }

    [self logEventInternal:RJEventTypeAppForeground
                   details:@{@"totalBackgroundTime" : @(bgTimeMs)}];

    [self startBatchUploadTimer];

    if (self.captureEngine && self.remoteRecordingEnabled) {
      RJLogInfo(@"[RJ-VIDEO] Calling resumeVideoCapture");
      [self.captureEngine resumeVideoCapture];
    } else if (!self.remoteRecordingEnabled) {
      RJLogInfo(
          @"[RJ-VIDEO] Video capture resume skipped - recording disabled");
    } else {
      RJLogInfo(
          @"[RJ-VIDEO] captureEngine is nil, cannot resume video capture");
    }

    NSString *scheme = nil;
    if ([self.lifecycleManager consumeExternalURLOpenedWithScheme:&scheme]) {
      [self logEventInternal:RJEventTypeOAuthReturned
                     details:@{@"scheme" : scheme ?: @"unknown"}];
    }
  } @catch (NSException *exception) {
    RJLogWarning(@"App foreground handling failed: %@", exception);
  }
}

- (void)lifecycleManagerSessionDidTimeout:(NSTimeInterval)backgroundDuration {
  RJLogInfo(@"[RJ-SESSION-TIMEOUT] Called with backgroundDuration=%.1fs",
            backgroundDuration);
  NSTimeInterval currentTime = [[NSDate date] timeIntervalSince1970];
  [self handleSessionTimeout:backgroundDuration currentTime:currentTime];
}

- (void)handleSessionTimeout:(NSTimeInterval)backgroundDuration
                 currentTime:(NSTimeInterval)currentTime {
  RJLogInfo(
      @"[RJ-SESSION-TIMEOUT] handleSessionTimeout: bg=%.1fs, isRecording=%d",
      backgroundDuration, self.isRecording);

  @try {
    NSString *oldSessionId = self.currentSessionId ?: @"none";
    BOOL wasRecording = self.isRecording;

    RJLogInfo(@"[RJ-SESSION-TIMEOUT] === ENDING OLD SESSION: %@ ===",
              oldSessionId);

    NSTimeInterval totalBackgroundMs = 0;
    if (self.lifecycleManager) {
      totalBackgroundMs = self.lifecycleManager.totalBackgroundTimeMs;
      RJLogInfo(
          @"[RJ-SESSION-TIMEOUT] Total background time from lifecycle: %.0fms",
          totalBackgroundMs);
    }

    [self stopBatchUploadTimer];
    [self stopDurationLimitTimer];

    if (wasRecording && self.captureEngine) {
      @try {
        RJLogInfo(@"[RJ-SESSION-TIMEOUT] Stopping capture engine");
        [self.captureEngine stopSession];
      } @catch (NSException *e) {
        RJLogWarning(@"Capture stop failed: %@", e);
      }
    }

    if (wasRecording && self.uploadManager && oldSessionId.length > 0 &&
        ![oldSessionId isEqualToString:@"none"]) {
      self.uploadManager.totalBackgroundTimeMs = totalBackgroundMs;

      __block NSArray<NSDictionary *> *finalEvents = nil;
      [self performStateSync:^{
        finalEvents = [self.sessionEvents copy];
      }];

      RJLogInfo(@"[RJ-SESSION-TIMEOUT] Ending old session with %lu events, "
                @"bgTime=%.0fms",
                (unsigned long)finalEvents.count, totalBackgroundMs);

      if (finalEvents.count > 0) {
        [self.uploadManager synchronousUploadWithEvents:finalEvents];
      } else {
        [self.uploadManager endSessionSync];
      }

      RJLogInfo(@"[RJ-SESSION-TIMEOUT] Old session %@ ended", oldSessionId);
    }

    RJLogInfo(@"[RJ-SESSION-TIMEOUT] === STARTING NEW SESSION ===");

    __block NSString *newSessionId = nil;
    [self performStateSync:^{
      newSessionId = [RJWindowUtils generateSessionId];
      self.currentSessionId = newSessionId;
      self.sessionStartTime = currentTime;
      self.totalBackgroundTimeMs = 0;
      [self.sessionEvents removeAllObjects];
      [[NSUserDefaults standardUserDefaults]
          setObject:newSessionId
             forKey:@"rj_current_session_id"];
      [[NSUserDefaults standardUserDefaults] synchronize];
    }];

    RJLogInfo(@"[RJ-SESSION-TIMEOUT] New session ID: %@", newSessionId);

    if (self.uploadManager) {
      @try {
        [self.uploadManager resetForNewSession];
      } @catch (NSException *e) {
        RJLogWarning(@"Upload manager reset failed: %@", e);
      }

      self.uploadManager.sessionId = newSessionId;
      self.uploadManager.sessionStartTime = currentTime;
      self.uploadManager.totalBackgroundTimeMs = 0;

      if (!self.userId) {
        self.userId = [[NSUserDefaults standardUserDefaults]
            stringForKey:@"rj_user_identity"];
      }
      self.uploadManager.userId = self.userId ?: @"anonymous";
    }

    if (self.lifecycleManager) {
      [self.lifecycleManager resetBackgroundTime];
      self.lifecycleManager.isRecording = YES;
    }

    if (self.eventBuffer) {
      [self.eventBuffer clearAllEvents];
    }
    NSString *pendingPath = self.eventBuffer.pendingRootPath;
    if (pendingPath.length == 0) {
      pendingPath =
          [NSSearchPathForDirectoriesInDomains(NSCachesDirectory,
                                               NSUserDomainMask, YES)
                  .firstObject stringByAppendingPathComponent:@"rj_pending"];
    }
    self.eventBuffer = [[RJEventBuffer alloc] initWithSessionId:newSessionId
                                                pendingRootPath:pendingPath];

    [self resetSamplingDecision];
    self.remoteRecordingEnabled = self.recordingEnabledByConfig;
    if (self.captureEngine) {
      self.captureEngine.uploadsEnabled = self.remoteRecordingEnabled;
    }
    if (self.hasProjectConfig) {
      [self updateRecordingEligibilityWithSampleRate:self.sampleRate];
    }

    if (self.captureEngine && self.remoteRecordingEnabled) {
      @try {
        RJLogInfo(@"[RJ-SESSION-TIMEOUT] Starting capture engine for %@",
                  newSessionId);
        [self.captureEngine startSessionWithId:newSessionId];
      } @catch (NSException *e) {
        RJLogWarning(@"New session capture start failed: %@", e);
      }
    } else {
      RJLogInfo(@"[RJ-SESSION-TIMEOUT] Capture skipped - recording disabled");
    }

    self.isRecording = YES;
    RJTouchInterceptor *touchInterceptor = [RJTouchInterceptor sharedInstance];
    if (touchInterceptor && !touchInterceptor.isTrackingEnabled) {
      RJLogInfo(@"[RJ-SESSION-TIMEOUT] Re-enabling touch tracking");
      [self setupTouchTracking];
    }
    [self startBatchUploadTimer];
    [self startDurationLimitTimer];

    NSMutableDictionary *sessionStartEvent = [NSMutableDictionary dictionary];
    sessionStartEvent[@"type"] = RJEventTypeSessionStart;
    sessionStartEvent[@"timestamp"] = @([RJWindowUtils currentTimestampMillis]);
    sessionStartEvent[@"previousSessionId"] = oldSessionId;
    sessionStartEvent[@"backgroundDuration"] = @(backgroundDuration * 1000);
    sessionStartEvent[@"reason"] = @"background_timeout";
    sessionStartEvent[@"userId"] = self.userId ?: @"anonymous";

    [self performStateSync:^{
      [self.sessionEvents addObject:sessionStartEvent];
    }];

    if (self.eventBuffer) {
      [self.eventBuffer appendEvent:sessionStartEvent];
    }

    dispatch_after(
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.1 * NSEC_PER_SEC)),
        dispatch_get_main_queue(), ^{
          [self performBatchUploadIfNeeded];
        });

    RJLogInfo(@"[RJ-SESSION-TIMEOUT] Session restart complete: %@ -> %@",
              oldSessionId, newSessionId);

  } @catch (NSException *exception) {
    RJLogError(@"Session timeout handling failed: %@", exception);
  }
}

#pragma mark - RJViewControllerTrackerDelegate

- (void)viewControllerDidAppear:(UIViewController *)viewController
                     screenName:(NSString *)screenName {
  if (!self.isRecording)
    return;

  @try {
    RJLogDebug(@"Auto-detected navigation to: %@", screenName);

    [self logEventInternal:RJEventTypeNavigation
                   details:@{@"screen" : screenName, @"auto" : @YES}];

    [self.captureEngine notifyNavigationToScreen:screenName];
    [self.captureEngine notifyReactNativeCommit];
  } @catch (NSException *exception) {
    RJLogWarning(@"Navigation tracking failed: %@", exception);
  }
}

- (void)viewControllerWillDisappear:(UIViewController *)viewController
                         screenName:(NSString *)screenName {
}

- (void)tabBarDidSelectIndex:(NSInteger)index
                   fromIndex:(NSInteger)previousIndex {
  if (!self.isRecording)
    return;

  @try {
    RJLogDebug(@"Auto-detected tab change: %ld -> %ld", (long)previousIndex,
               (long)index);

    [self logEventInternal:RJEventTypeNavigation
                   details:@{
                     @"type" : @"tab_change",
                     @"fromIndex" : @(previousIndex),
                     @"toIndex" : @(index),
                     @"auto" : @YES
                   }];

  } @catch (NSException *exception) {
    RJLogWarning(@"Tab change tracking failed: %@", exception);
  }
}

#pragma mark - TurboModule Support

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeRejourneySpecJSI>(params);
}
#endif

@end
