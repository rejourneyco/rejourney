#ifndef Rejourney_h
#define Rejourney_h

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

#ifdef RCT_NEW_ARCH_ENABLED
#import <ReactCommon/RCTTurboModule.h>
#if __has_include(<RejourneySpec/RejourneySpec.h>)
#import <RejourneySpec/RejourneySpec.h>
#elif __has_include("RejourneySpec.h")
#import "RejourneySpec.h"
#endif

@interface Rejourney : NSObject <NativeRejourneySpec>
#else
@interface Rejourney : NSObject <RCTBridgeModule>
#endif

@end

#endif /* Rejourney_h */
