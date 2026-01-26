//
//  RJNetworkMonitor.h
//  Rejourney
//
//  Network quality monitoring using NWPathMonitor.
//
//  Copyright (c) 2026 Rejourney
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Network type enumeration
typedef NS_ENUM(NSInteger, RJNetworkType) {
  RJNetworkTypeNone = 0,
  RJNetworkTypeWiFi,
  RJNetworkTypeCellular,
  RJNetworkTypeWired,
  RJNetworkTypeOther
};

/// Cellular generation enumeration
typedef NS_ENUM(NSInteger, RJCellularGeneration) {
  RJCellularGenerationUnknown = 0,
  RJCellularGeneration2G,
  RJCellularGeneration3G,
  RJCellularGeneration4G,
  RJCellularGeneration5G
};

/// Network quality snapshot
@interface RJNetworkQuality : NSObject

@property(nonatomic, assign) RJNetworkType networkType;
@property(nonatomic, assign) RJCellularGeneration cellularGeneration;
@property(nonatomic, assign) BOOL isConstrained; // Low data mode
@property(nonatomic, assign) BOOL isExpensive;   // Metered connection
@property(nonatomic, assign) NSTimeInterval timestamp;

- (NSDictionary *)toDictionary;

@end

/// Protocol for network quality change notifications
@protocol RJNetworkMonitorDelegate <NSObject>
@optional
- (void)networkMonitor:(id)monitor
    didDetectNetworkChange:(RJNetworkQuality *)quality;
@end

/// Network quality monitor using NWPathMonitor
@interface RJNetworkMonitor : NSObject

@property(nonatomic, weak, nullable) id<RJNetworkMonitorDelegate> delegate;
@property(nonatomic, readonly) RJNetworkQuality *currentQuality;

+ (instancetype)sharedInstance;

- (void)startMonitoring;
- (void)stopMonitoring;

/// Get current network quality snapshot
- (RJNetworkQuality *)captureNetworkQuality;

@end

NS_ASSUME_NONNULL_END
