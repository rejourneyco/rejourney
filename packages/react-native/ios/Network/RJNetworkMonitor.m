//
//  RJNetworkMonitor.m
//  Rejourney
//
//  Network quality monitoring implementation using NWPathMonitor.
//
//  Copyright (c) 2026 Rejourney
//

#import "RJNetworkMonitor.h"
#import <TargetConditionals.h>

#if TARGET_OS_IOS
#import <CoreTelephony/CTCarrier.h>
#import <CoreTelephony/CTTelephonyNetworkInfo.h>
#import <Network/Network.h>
#endif

#import "../Core/RJLogger.h"

#pragma mark - RJNetworkQuality Implementation

@implementation RJNetworkQuality

- (instancetype)init {
  self = [super init];
  if (self) {
    _networkType = RJNetworkTypeNone;
    _cellularGeneration = RJCellularGenerationUnknown;
    _isConstrained = NO;
    _isExpensive = NO;
    _timestamp = [[NSDate date] timeIntervalSince1970] * 1000;
  }
  return self;
}

- (NSDictionary *)toDictionary {
  NSString *networkTypeString;
  switch (self.networkType) {
  case RJNetworkTypeWiFi:
    networkTypeString = @"wifi";
    break;
  case RJNetworkTypeCellular:
    networkTypeString = @"cellular";
    break;
  case RJNetworkTypeWired:
    networkTypeString = @"wired";
    break;
  case RJNetworkTypeOther:
    networkTypeString = @"other";
    break;
  default:
    networkTypeString = @"none";
    break;
  }

  NSString *cellularGenString;
  switch (self.cellularGeneration) {
  case RJCellularGeneration2G:
    cellularGenString = @"2G";
    break;
  case RJCellularGeneration3G:
    cellularGenString = @"3G";
    break;
  case RJCellularGeneration4G:
    cellularGenString = @"4G";
    break;
  case RJCellularGeneration5G:
    cellularGenString = @"5G";
    break;
  default:
    cellularGenString = @"unknown";
    break;
  }

  return @{
    @"networkType" : networkTypeString,
    @"cellularGeneration" : cellularGenString,
    @"isConstrained" : @(self.isConstrained),
    @"isExpensive" : @(self.isExpensive),
    @"timestamp" : @(self.timestamp)
  };
}

@end

#pragma mark - RJNetworkMonitor Implementation

@interface RJNetworkMonitor ()

@property(nonatomic, strong) dispatch_queue_t monitorQueue;
#if TARGET_OS_IOS
@property(nonatomic, strong)
    nw_path_monitor_t pathMonitor API_AVAILABLE(ios(12.0));
@property(nonatomic, strong) CTTelephonyNetworkInfo *telephonyInfo;
#endif
@property(nonatomic, strong) RJNetworkQuality *currentQuality;
@property(nonatomic, assign) BOOL isMonitoring;

@end

@implementation RJNetworkMonitor

+ (instancetype)sharedInstance {
  static RJNetworkMonitor *instance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [[RJNetworkMonitor alloc] init];
  });
  return instance;
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _monitorQueue = dispatch_queue_create("com.rejourney.network.monitor",
                                          DISPATCH_QUEUE_SERIAL);
#if TARGET_OS_IOS
    _telephonyInfo = [[CTTelephonyNetworkInfo alloc] init];
#endif
    _currentQuality = [[RJNetworkQuality alloc] init];
    _isMonitoring = NO;
  }
  return self;
}

- (void)startMonitoring {
  if (self.isMonitoring)
    return;

#if TARGET_OS_IOS
  if (@available(iOS 12.0, *)) {
    self.pathMonitor = nw_path_monitor_create();
    nw_path_monitor_set_queue(self.pathMonitor, self.monitorQueue);

    __weak typeof(self) weakSelf = self;
    nw_path_monitor_set_update_handler(self.pathMonitor, ^(nw_path_t path) {
      [weakSelf handlePathUpdate:path];
    });

    nw_path_monitor_start(self.pathMonitor);
    self.isMonitoring = YES;
    RJLogDebug(@"Network monitoring started");
  } else {
    RJLogWarning(@"NWPathMonitor requires iOS 12.0+");
  }
#else
  RJLogWarning(@"Network monitoring not available on this platform");
#endif
}

- (void)stopMonitoring {
  if (!self.isMonitoring)
    return;

#if TARGET_OS_IOS
  if (@available(iOS 12.0, *)) {
    if (self.pathMonitor) {
      nw_path_monitor_cancel(self.pathMonitor);
      self.pathMonitor = nil;
    }
  }
#endif

  self.isMonitoring = NO;
  RJLogDebug(@"Network monitoring stopped");
}

#if TARGET_OS_IOS
- (void)handlePathUpdate:(nw_path_t)path API_AVAILABLE(ios(12.0)) {
  RJNetworkQuality *quality = [[RJNetworkQuality alloc] init];

  
  nw_path_status_t status = nw_path_get_status(path);
  if (status == nw_path_status_satisfied ||
      status == nw_path_status_satisfiable) {
    if (nw_path_uses_interface_type(path, nw_interface_type_wifi)) {
      quality.networkType = RJNetworkTypeWiFi;
    } else if (nw_path_uses_interface_type(path, nw_interface_type_cellular)) {
      quality.networkType = RJNetworkTypeCellular;
      quality.cellularGeneration = [self detectCellularGeneration];
    } else if (nw_path_uses_interface_type(path, nw_interface_type_wired)) {
      quality.networkType = RJNetworkTypeWired;
    } else {
      quality.networkType = RJNetworkTypeOther;
    }
  } else {
    quality.networkType = RJNetworkTypeNone;
  }

  
  quality.isConstrained = nw_path_is_constrained(path);
  quality.isExpensive = nw_path_is_expensive(path);
  quality.timestamp = [[NSDate date] timeIntervalSince1970] * 1000;

  
  self.currentQuality = quality;

  
  if (self.delegate &&
      [self.delegate respondsToSelector:@selector(networkMonitor:
                                            didDetectNetworkChange:)]) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self.delegate networkMonitor:self didDetectNetworkChange:quality];
    });
  }

  RJLogDebug(@"Network changed: %@", [quality toDictionary]);
}

- (RJCellularGeneration)detectCellularGeneration {
  NSString *radioTech = nil;

  if (@available(iOS 12.0, *)) {
    NSDictionary *radioTechDict =
        self.telephonyInfo.serviceCurrentRadioAccessTechnology;
    radioTech = radioTechDict.allValues.firstObject;
  } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    radioTech = self.telephonyInfo.currentRadioAccessTechnology;
#pragma clang diagnostic pop
  }

  if (!radioTech)
    return RJCellularGenerationUnknown;

  
  if (@available(iOS 14.1, *)) {
    if ([radioTech isEqualToString:CTRadioAccessTechnologyNRNSA] ||
        [radioTech isEqualToString:CTRadioAccessTechnologyNR]) {
      return RJCellularGeneration5G;
    }
  }

  
  if ([radioTech isEqualToString:CTRadioAccessTechnologyLTE]) {
    return RJCellularGeneration4G;
  }

  
  if ([radioTech isEqualToString:CTRadioAccessTechnologyWCDMA] ||
      [radioTech isEqualToString:CTRadioAccessTechnologyHSDPA] ||
      [radioTech isEqualToString:CTRadioAccessTechnologyHSUPA] ||
      [radioTech isEqualToString:CTRadioAccessTechnologyCDMA1x] ||
      [radioTech isEqualToString:CTRadioAccessTechnologyCDMAEVDORev0] ||
      [radioTech isEqualToString:CTRadioAccessTechnologyCDMAEVDORevA] ||
      [radioTech isEqualToString:CTRadioAccessTechnologyCDMAEVDORevB] ||
      [radioTech isEqualToString:CTRadioAccessTechnologyeHRPD]) {
    return RJCellularGeneration3G;
  }

  
  if ([radioTech isEqualToString:CTRadioAccessTechnologyGPRS] ||
      [radioTech isEqualToString:CTRadioAccessTechnologyEdge]) {
    return RJCellularGeneration2G;
  }

  return RJCellularGenerationUnknown;
}
#endif

- (RJNetworkQuality *)captureNetworkQuality {
  return self.currentQuality;
}

@end
