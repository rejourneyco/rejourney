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
