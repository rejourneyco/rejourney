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

@objc(ObjCRuntimeUtils)
public final class ObjCRuntimeUtils: NSObject {
    
    @objc public static func hotswap(cls: AnyClass, original: Selector, replacement: Selector) {
        guard let m1 = class_getInstanceMethod(cls, original),
              let m2 = class_getInstanceMethod(cls, replacement) else { return }
        method_exchangeImplementations(m1, m2)
    }
    
    @objc public static func hotswapSafely(cls: AnyClass, original: Selector, replacement: Selector) {
        guard let m1 = class_getInstanceMethod(cls, original),
              let m2 = class_getInstanceMethod(cls, replacement) else { return }
        
        let added = class_addMethod(cls, original, method_getImplementation(m2), method_getTypeEncoding(m2))
        
        if added {
            class_replaceMethod(cls, replacement, method_getImplementation(m1), method_getTypeEncoding(m1))
        } else {
            method_exchangeImplementations(m1, m2)
        }
    }
}
