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

import UIKit
import ObjectiveC

private var _rjViewIdentifierKey: UInt8 = 0

public extension UIView {
    var rjViewIdentifier: String? {
        if let rnNativeID = value(forKey: "nativeID") as? String, !rnNativeID.isEmpty {
            return rnNativeID
        }
        return objc_getAssociatedObject(self, &_rjViewIdentifierKey) as? String
    }
    
    func setRjViewIdentifier(_ identifier: String?) {
        objc_setAssociatedObject(self, &_rjViewIdentifierKey, identifier, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }
    
    var nativeID: String? {
        value(forKey: "nativeID") as? String
    }
}
