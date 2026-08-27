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

/// Event payload serialization for the recording core.
///
/// This lives in the core because the pipeline needs it on every platform.
/// The React Native SDK used to build these payloads by interpolating values
/// straight into a JSON string, which produced malformed JSON as soon as a key
/// or value contained a quote, a backslash or a newline. Going through
/// JSONSerialization escapes them properly.
///
/// The metadata-typed overload stays with each SDK's own entry file, because
/// `RejourneyMetadataValue` is part of that public surface rather than the core.
enum RejourneyEventSerializer {
    static func jsonString(from object: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let string = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return string
    }
}
