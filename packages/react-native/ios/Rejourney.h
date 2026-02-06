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
