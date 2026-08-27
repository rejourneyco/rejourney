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

import Foundation

/// The shared recording core reads its version through this symbol on every
/// platform. The native and Flutter SDKs bake the version in at build time;
/// React Native's is handed down from the JS package at init, so this forwards
/// to wherever RejourneyImpl last set it rather than duplicating the constant.
enum RejourneySDKInfo {
    static var version: String { RejourneyImpl.sdkVersion }
}
