
import Foundation
import UIKit

@objc(RJWindowUtils)
public class RJWindowUtils: NSObject {
    
    // Cache key window execution to prevent repeated main thread traversals in tight loops
    private static var _cachedKeyWindow: UIWindow?
    private static var _lastCacheTime: TimeInterval = 0
    private static let kKeyWindowCacheTTL: TimeInterval = 0.5 // 500ms cache
    
    @objc public static func keyWindow() -> UIWindow? {
        // Must run on main thread
        if !Thread.isMainThread {
            return DispatchQueue.main.sync {
                return self.keyWindow()
            }
        }
        
        let now = Date().timeIntervalSince1970
        if let cached = _cachedKeyWindow, (now - _lastCacheTime) < kKeyWindowCacheTTL {
            return cached
        }
        
        let window = findKeyWindowInternal()
        _cachedKeyWindow = window
        _lastCacheTime = now
        return window
    }
    
    private static func findKeyWindowInternal() -> UIWindow? {
        if #available(iOS 13.0, *) {
            // Scene-based lookup
            let connectedScenes = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .filter { $0.activationState == .foregroundActive }
            
            var bestKeyApp: UIWindow?
            var bestKeyAppLevel: UIWindow.Level = .normal - 1000
            
            var bestApp: UIWindow?
            var bestAppLevel: UIWindow.Level = .normal - 1000
            
            var anyKey: UIWindow?
            
            for scene in connectedScenes {
                for window in scene.windows {
                    if window.isHidden || window.alpha <= 0.01 { continue }
                    
                    let clsName = String(describing: type(of: window))
                    let isSystemInput = clsName.contains("Keyboard") ||
                    clsName.contains("TextEffects") ||
                    clsName.contains("InputWindow") ||
                    clsName.contains("RemoteKeyboard")
                    
                    let hasRoot = window.rootViewController != nil
                    let isAppCandidate = !isSystemInput && hasRoot
                    let level = window.windowLevel
                    
                    if window.isKeyWindow {
                        if anyKey == nil { anyKey = window }
                        if isAppCandidate && level > bestKeyAppLevel {
                            bestKeyAppLevel = level
                            bestKeyApp = window
                        }
                    }
                    
                    if isAppCandidate && level > bestAppLevel {
                        bestAppLevel = level
                        bestApp = window
                    }
                }
            }
            
            if let best = bestKeyApp { return best }
            if let best = bestApp { return best }
            return anyKey
            
        } else {
            // Legacy iOS 12 fallback
            return UIApplication.shared.keyWindow
        }
    }
    
    @objc public static func accessibilityLabelForView(_ view: UIView) -> String? {
        var current: UIView? = view
        while let v = current {
            if let label = v.accessibilityLabel, !label.isEmpty {
                return label
            }
            current = v.superview
        }
        return nil
    }
    
    @objc public static func generateSessionId() -> String {
        let timestamp = Date().timeIntervalSince1970 * 1000
        let timestampStr = String(format: "%.0f", timestamp)
        let randomHex = String(format: "%08X", arc4random())
        return "session_\(timestampStr)_\(randomHex)"
    }
    
    @objc public static func currentTimestampMillis() -> TimeInterval {
        return Date().timeIntervalSince1970 * 1000.0
    }
}
