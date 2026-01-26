//
//  RJPerformanceManager.m
//  Rejourney
//
//  System performance monitoring and adaptive throttling implementation.
//
//  Copyright (c) 2026 Rejourney
//

#import "RJPerformanceManager.h"
#import "../Core/RJConstants.h"
#import "../Core/RJLogger.h"
#import <UIKit/UIKit.h>
#import <mach/mach.h>

#pragma mark - Private Interface

@interface RJPerformanceManager ()

@property(nonatomic, assign) RJPerformanceLevel currentLevel;

@property(nonatomic, strong, nullable) dispatch_source_t memoryPressureSource;

@property(nonatomic, strong, nullable) NSTimer *cpuMonitorTimer;

@property(nonatomic, assign) float rollingCPUAverage;

@property(nonatomic, assign) NSInteger highCPUSampleCount;

@property(nonatomic, assign) BOOL isMonitoring;

@end

#pragma mark - Implementation

@implementation RJPerformanceManager

#pragma mark - Singleton

+ (instancetype)sharedManager {
  static RJPerformanceManager *sharedInstance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    sharedInstance = [[self alloc] init];
  });
  return sharedInstance;
}

#pragma mark - Initialization

- (instancetype)init {
  self = [super init];
  if (self) {
    _currentLevel = RJPerformanceLevelNormal;
    _thermalThrottleEnabled = YES;
    _batteryAwareEnabled = YES;
    _isMonitoring = NO;
    _rollingCPUAverage = 0.0;
    _highCPUSampleCount = 0;
  }
  return self;
}

- (void)dealloc {
  [self stopMonitoring];
}

#pragma mark - Monitoring Lifecycle

- (void)startMonitoring {
  if (self.isMonitoring)
    return;

  self.isMonitoring = YES;

  [self setupMemoryPressureMonitoring];

  [[NSNotificationCenter defaultCenter]
      addObserver:self
         selector:@selector(handleMemoryWarningNotification:)
             name:UIApplicationDidReceiveMemoryWarningNotification
           object:nil];

  if (@available(iOS 11.0, *)) {
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(handleThermalStateChange:)
               name:NSProcessInfoThermalStateDidChangeNotification
             object:nil];
  }

  [[UIDevice currentDevice] setBatteryMonitoringEnabled:YES];
  [[NSNotificationCenter defaultCenter]
      addObserver:self
         selector:@selector(handleBatteryStateChange:)
             name:UIDeviceBatteryLevelDidChangeNotification
           object:nil];

  __weak typeof(self) weakSelf = self;
  self.cpuMonitorTimer =
      [NSTimer scheduledTimerWithTimeInterval:2.0
                                      repeats:YES
                                        block:^(NSTimer *timer) {
                                          [weakSelf checkCPUUsage];
                                        }];
  [[NSRunLoop currentRunLoop] addTimer:self.cpuMonitorTimer
                               forMode:NSRunLoopCommonModes];

  RJLogDebug(@"Performance monitoring started");
}

- (void)stopMonitoring {
  if (!self.isMonitoring)
    return;

  self.isMonitoring = NO;

  [[NSNotificationCenter defaultCenter] removeObserver:self];

  if (self.cpuMonitorTimer) {
    [self.cpuMonitorTimer invalidate];
    self.cpuMonitorTimer = nil;
  }

  if (self.memoryPressureSource) {
    @try {
      dispatch_source_cancel(self.memoryPressureSource);
    } @catch (NSException *e) {
    }
    self.memoryPressureSource = nil;
  }

  RJLogDebug(@"Performance monitoring stopped");
}

#pragma mark - Memory Pressure Monitoring

- (void)setupMemoryPressureMonitoring {
  dispatch_source_t source = dispatch_source_create(
      DISPATCH_SOURCE_TYPE_MEMORYPRESSURE, 0,
      DISPATCH_MEMORYPRESSURE_WARN | DISPATCH_MEMORYPRESSURE_CRITICAL,
      dispatch_get_main_queue());

  if (!source) {
    RJLogWarning(@"Failed to create memory pressure source");
    return;
  }

  __weak typeof(self) weakSelf = self;
  dispatch_source_set_event_handler(source, ^{
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (!strongSelf)
      return;

    dispatch_source_memorypressure_flags_t flags =
        dispatch_source_get_data(source);

    if (flags & DISPATCH_MEMORYPRESSURE_CRITICAL) {
      RJLogWarning(@"CRITICAL memory pressure - pausing captures");
      [strongSelf setLevel:RJPerformanceLevelPaused];
      [strongSelf handleMemoryWarning];
    } else if (flags & DISPATCH_MEMORYPRESSURE_WARN) {
      RJLogWarning(@"Memory pressure warning - reducing captures");
      [strongSelf setLevel:RJPerformanceLevelMinimal];
    }
  });

  dispatch_resume(source);
  self.memoryPressureSource = source;
}

#pragma mark - Level Management

- (void)setLevel:(RJPerformanceLevel)level {
  if (self.currentLevel != level) {
    self.currentLevel = level;
    if ([self.delegate
            respondsToSelector:@selector(performanceManagerDidChangeLevel:)]) {
      [self.delegate performanceManagerDidChangeLevel:level];
    }
  }
}

- (void)updatePerformanceLevel {
  if (!self.thermalThrottleEnabled && !self.batteryAwareEnabled) {
    [self setLevel:RJPerformanceLevelNormal];
    return;
  }

  RJPerformanceLevel newLevel = RJPerformanceLevelNormal;

  if (@available(iOS 11.0, *)) {
    if (self.thermalThrottleEnabled) {
      NSProcessInfoThermalState thermalState =
          [[NSProcessInfo processInfo] thermalState];

      switch (thermalState) {
      case NSProcessInfoThermalStateCritical:
        [self setLevel:RJPerformanceLevelPaused];
        return;
      case NSProcessInfoThermalStateSerious:
        [self setLevel:RJPerformanceLevelMinimal];
        return;
      case NSProcessInfoThermalStateFair:
        newLevel = RJPerformanceLevelReduced;
        break;
      case NSProcessInfoThermalStateNominal:
        break;
      }
    }
  }

  if (self.batteryAwareEnabled) {
    float batteryLevel = [[UIDevice currentDevice] batteryLevel];
    UIDeviceBatteryState batteryState = [[UIDevice currentDevice] batteryState];

    BOOL isCharging = (batteryState == UIDeviceBatteryStateCharging ||
                       batteryState == UIDeviceBatteryStateFull);

    if (!isCharging && batteryLevel >= 0 &&
        batteryLevel < RJLowBatteryThreshold) {
      newLevel = MAX(newLevel, RJPerformanceLevelReduced);
    }
  }

  NSUInteger usedMemory = [self currentMemoryUsage];
  if (usedMemory > RJMemoryWarningThresholdBytes) {
    newLevel = MAX(newLevel, RJPerformanceLevelReduced);
  }

  [self setLevel:newLevel];
}

#pragma mark - Notification Handlers

- (void)handleThermalStateChange:(NSNotification *)notification {
  [self updatePerformanceLevel];
}

- (void)handleBatteryStateChange:(NSNotification *)notification {
  [self updatePerformanceLevel];
}

- (void)handleMemoryWarningNotification:(NSNotification *)notification {
  [self handleMemoryWarning];
}

#pragma mark - Memory Management

- (void)handleMemoryWarning {
  RJLogWarning(@"Memory warning received");

  [self setLevel:RJPerformanceLevelMinimal];

  if ([self.delegate respondsToSelector:@selector
                     (performanceManagerDidReceiveMemoryWarning)]) {
    [self.delegate performanceManagerDidReceiveMemoryWarning];
  }
}

- (NSUInteger)currentMemoryUsage {
  struct task_basic_info info;
  mach_msg_type_number_t size = TASK_BASIC_INFO_COUNT;

  kern_return_t result =
      task_info(mach_task_self(), TASK_BASIC_INFO, (task_info_t)&info, &size);

  return (result == KERN_SUCCESS) ? info.resident_size : 0;
}

#pragma mark - CPU Monitoring

- (float)currentCPUUsage {
  thread_array_t threadList;
  mach_msg_type_number_t threadCount;

  kern_return_t kr = task_threads(mach_task_self(), &threadList, &threadCount);
  if (kr != KERN_SUCCESS) {
    return -1.0;
  }

  float totalUsage = 0.0;

  for (mach_msg_type_number_t i = 0; i < threadCount; i++) {
    thread_info_data_t threadInfo;
    mach_msg_type_number_t threadInfoCount = THREAD_INFO_MAX;

    kr = thread_info(threadList[i], THREAD_BASIC_INFO,
                     (thread_info_t)threadInfo, &threadInfoCount);

    if (kr == KERN_SUCCESS) {
      thread_basic_info_t basicInfo = (thread_basic_info_t)threadInfo;

      if (!(basicInfo->flags & TH_FLAGS_IDLE)) {
        totalUsage += basicInfo->cpu_usage / (float)TH_USAGE_SCALE * 100.0;
      }
    }

    mach_port_deallocate(mach_task_self(), threadList[i]);
  }

  vm_deallocate(mach_task_self(), (vm_address_t)threadList,
                threadCount * sizeof(thread_t));

  return totalUsage;
}

- (BOOL)isCPUHigh {
  return self.rollingCPUAverage >= 60.0;
}

- (void)checkCPUUsage {
  float currentCPU = [self currentCPUUsage];
  if (currentCPU < 0)
    return;

  if (self.rollingCPUAverage == 0) {
    self.rollingCPUAverage = currentCPU;
  } else {
    self.rollingCPUAverage = 0.3 * currentCPU + 0.7 * self.rollingCPUAverage;
  }

  /*
   * Updated CPU Thresholds:
   * CRITICAL: > 90%
   * HIGH:     > 60%
   * NORMAL:   < 40%
   */
  const float CPU_CRITICAL_THRESHOLD = 90.0; // was 80
  const float CPU_HIGH_THRESHOLD = 60.0;     // was 60
  const float CPU_NORMAL_THRESHOLD = 40.0;
  const NSInteger HYSTERESIS_SAMPLES = 3;

  RJPerformanceLevel suggestedLevel = RJPerformanceLevelNormal;

  if (self.rollingCPUAverage >= CPU_CRITICAL_THRESHOLD) {
    suggestedLevel = RJPerformanceLevelMinimal;
    self.highCPUSampleCount++;
  } else if (self.rollingCPUAverage >= CPU_HIGH_THRESHOLD) {
    // Force Reduced level (scales down to 0.4) when CPU is high
    suggestedLevel = RJPerformanceLevelReduced;
    self.highCPUSampleCount++;
  } else if (self.rollingCPUAverage < CPU_NORMAL_THRESHOLD) {
    self.highCPUSampleCount = 0;
    suggestedLevel = RJPerformanceLevelNormal;
  } else {
    // In hysteresis zone, maintain current level if it's already
    // reduced/minimal
    if (self.currentLevel >= RJPerformanceLevelReduced) {
      return;
    }
    // Otherwise keep monitoring
    return;
  }

  // Apply with hysteresis
  if (suggestedLevel > self.currentLevel) {
    if (self.highCPUSampleCount >= HYSTERESIS_SAMPLES) {
      RJLogInfo(@"CPU usage high (%.1f%%), throttling to level %ld",
                self.rollingCPUAverage, (long)suggestedLevel);
      [self setLevel:suggestedLevel];
    }
  } else if (suggestedLevel < self.currentLevel) {
    // Immediate recovery if CPU drops comfortably
    if (self.highCPUSampleCount == 0) {
      RJLogInfo(@"CPU usage normalized (%.1f%%), restoring level %ld",
                self.rollingCPUAverage, (long)suggestedLevel);
      [self setLevel:suggestedLevel];
    }
  }
}

@end
