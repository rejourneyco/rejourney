//
//
//  Rejourney.h
//  Rejourney
//
//  Umbrella header for the Rejourney SDK.
//  Import this header to access the complete SDK.
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

#ifndef Rejourney_h
#define Rejourney_h

// Core
#import "Core/RJConstants.h"
#import "Core/RJLogger.h"
#import "Core/RJTypes.h"
// #import "Rejourney.h" // Avoid circular import ambiguity

// Capture
#import "Capture/RJCaptureEngine.h"
#import "Capture/RJVideoEncoder.h"
#import "Capture/RJViewSerializer.h"

// Touch
#import "Touch/RJGestureClassifier.h"
#import "Touch/RJTouchInterceptor.h"

// Network
// RJUploadManager is Swift-only

// Utils
// RJWindowUtils is Swift-only

#endif /* Rejourney_h */
