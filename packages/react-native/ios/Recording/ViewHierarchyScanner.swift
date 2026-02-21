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

@objc public class ViewHierarchyScanner: NSObject {
    
    @objc public static let shared = ViewHierarchyScanner()
    @objc public var maxDepth: Int = 12
    @objc public var includeTextContent: Bool = true
    @objc public var includeVisualProperties: Bool = true
    
    private let _timeBudgetNs: UInt64 = 16_000_000
    
    private override init() {
        super.init()
    }
    
    @objc public func captureHierarchy() -> [String: Any]? {
        guard let w = _keyWindow() else { return nil }
        // Only serialize the key window — skip keyboard/system windows
        // whose internal views produce NaN frames during transition
        return serializeWindow(w)
    }
    
    @objc public func serializeWindow(_ window: UIWindow) -> [String: Any] {
        let ts = Int64(Date().timeIntervalSince1970 * 1000)
        let scale = window.screen.scale
        let bounds = window.bounds
        let start = DispatchTime.now().uptimeNanoseconds
        let root = _serializeView(window, depth: 0, start: start)
        
        var result: [String: Any] = [
            "timestamp": ts,
            "screen": ["width": bounds.width, "height": bounds.height, "scale": scale],
            "root": root ?? [:]
        ]
        
        if let sn = ReplayOrchestrator.shared.currentScreenName {
            result["screenName"] = sn
        }
        return result
    }
    
    private func _keyWindow() -> UIWindow? {
        if #available(iOS 15.0, *) {
            return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }.first { $0.isKeyWindow }
        } else {
            return UIApplication.shared.windows.first { $0.isKeyWindow }
        }
    }
    
    private func _serializeView(_ view: UIView, depth: Int, start: UInt64) -> [String: Any]? {
        if depth > maxDepth { return nil }
        if (DispatchTime.now().uptimeNanoseconds - start) > _timeBudgetNs { return ["type": _typeName(view), "bailout": true] }
        if depth > 0 && (view.isHidden || view.alpha <= 0.01 || view.bounds.width <= 0 || view.bounds.height <= 0) { return nil }
        
        // Skip keyboard/system windows to avoid NaN frames during keyboard transitions
        let className = _typeName(view)
        if className.contains("UIRemoteKeyboardWindow") ||
           className.contains("UITextEffectsWindow") ||
           className.contains("UIInputSetHostView") ||
           className.contains("UIKeyboard") {
            return nil
        }
        
        var node: [String: Any] = [:]
        node["type"] = className
        
        // Guard frame values against NaN / Inf — keyboard and animated views
        // can have degenerate frames that poison downstream JSON serialization
        let f = view.frame
        let fx = f.origin.x.isFinite && !f.origin.x.isNaN ? f.origin.x : 0
        let fy = f.origin.y.isFinite && !f.origin.y.isNaN ? f.origin.y : 0
        let fw = f.width.isFinite && !f.width.isNaN ? f.width : 0
        let fh = f.height.isFinite && !f.height.isNaN ? f.height : 0
        node["frame"] = ["x": fx, "y": fy, "w": fw, "h": fh]
        
        if view.isHidden { node["hidden"] = true }
        if view.alpha < 1.0 { node["alpha"] = view.alpha }
        if let aid = view.accessibilityIdentifier, !aid.isEmpty { node["testID"] = aid }
        if let lbl = view.accessibilityLabel, !lbl.isEmpty { node["label"] = lbl }
        if _isSensitive(view) { node["masked"] = true }
        
        if includeVisualProperties, let bg = view.backgroundColor, bg != .clear { node["bg"] = _hexColor(bg) }
        
        if includeTextContent {
            if let tv = view as? UITextView { node["text"] = _mask(tv.text ?? ""); node["textLength"] = tv.text?.count ?? 0 }
            else if let lb = view as? UILabel { node["text"] = _mask(lb.text ?? ""); node["textLength"] = lb.text?.count ?? 0 }
            else if let tf = view as? UITextField { node["text"] = "***"; node["textLength"] = tf.text?.count ?? 0; node["placeholder"] = tf.placeholder }
        }
        
        if _isInteractive(view) {
            node["interactive"] = true
            if let btn = view as? UIButton { if let t = btn.title(for: .normal) { node["buttonTitle"] = t }; node["enabled"] = btn.isEnabled }
            if let ctrl = view as? UIControl { node["enabled"] = ctrl.isEnabled }
        }
        
        if let sv = view as? UIScrollView {
            node["scrollEnabled"] = sv.isScrollEnabled
            let ox = sv.contentOffset.x.isFinite && !sv.contentOffset.x.isNaN ? sv.contentOffset.x : 0
            let oy = sv.contentOffset.y.isFinite && !sv.contentOffset.y.isNaN ? sv.contentOffset.y : 0
            let cw = sv.contentSize.width.isFinite && !sv.contentSize.width.isNaN ? sv.contentSize.width : 0
            let ch = sv.contentSize.height.isFinite && !sv.contentSize.height.isNaN ? sv.contentSize.height : 0
            node["contentOffset"] = ["x": ox, "y": oy]
            node["contentSize"] = ["w": cw, "h": ch]
        }
        
        if view is UIImageView { node["hasImage"] = true }
        
        let subs = view.subviews.filter { !$0.isHidden && $0.alpha > 0.01 }
        if !subs.isEmpty {
            var children: [[String: Any]] = []
            for s in subs {
                if let cn = _serializeView(s, depth: depth + 1, start: start) { children.append(cn) }
            }
            if !children.isEmpty { node["children"] = children }
        }
        
        return node
    }
    
    private func _typeName(_ v: UIView) -> String { String(describing: type(of: v)) }
    
    private func _isSensitive(_ v: UIView) -> Bool {
        if v.accessibilityHint == "rejourney_occlude" { return true }
        if let tf = v as? UITextField, tf.isSecureTextEntry { return true }
        return false
    }
    
    private func _isInteractive(_ v: UIView) -> Bool {
        v is UIButton || v is UIControl || v is UITextField || v is UITextView
    }
    
    private func _mask(_ text: String) -> String {
        text.count > 100 ? String(text.prefix(100)) + "..." : text
    }
    
    private func _hexColor(_ c: UIColor) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255))
    }
}
