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
