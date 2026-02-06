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

@objc(InteractionRecorder)
public final class InteractionRecorder: NSObject {
    
    @objc public static let shared = InteractionRecorder()
    
    @objc public private(set) var isTracking = false
    
    private var _gestureAggregator: GestureAggregator?
    private var _inputObservers = NSMapTable<UITextField, AnyObject>.weakToStrongObjects()
    private var _navigationStack: [String] = []
    private let _coalesceWindow: TimeInterval = 0.3
    
    private override init() {
        super.init()
    }
    
    @objc public func activate() {
        guard !isTracking else { return }
        isTracking = true
        _gestureAggregator = GestureAggregator(delegate: self)
        _installGlobalRecognizers()
    }
    
    @objc public func deactivate() {
        guard isTracking else { return }
        isTracking = false
        _removeGlobalRecognizers()
        _gestureAggregator = nil
        _inputObservers.removeAllObjects()
        _navigationStack.removeAll()
    }
    
    @objc public func observeTextField(_ field: UITextField) {
        guard _inputObservers.object(forKey: field) == nil else { return }
        let observer = InputEndObserver(recorder: self, field: field)
        _inputObservers.setObject(observer, forKey: field)
    }
    
    @objc public func pushScreen(_ identifier: String) {
        _navigationStack.append(identifier)
        TelemetryPipeline.shared.recordViewTransition(viewId: identifier, viewLabel: identifier, entering: true)
        ReplayOrchestrator.shared.logScreenView(identifier)
    }
    
    @objc public func popScreen() {
        guard let last = _navigationStack.popLast() else { return }
        TelemetryPipeline.shared.recordViewTransition(viewId: last, viewLabel: last, entering: false)
    }
    
    private var _installedRecognizers: [UIGestureRecognizer] = []
    
    private func _installGlobalRecognizers() {
        guard let agg = _gestureAggregator else { return }
        
        for window in UIApplication.shared.windows {
            let tap = UITapGestureRecognizer(target: agg, action: #selector(GestureAggregator.handleTap(_:)))
            tap.cancelsTouchesInView = false
            tap.delaysTouchesBegan = false
            tap.delaysTouchesEnded = false
            tap.delegate = agg
            window.addGestureRecognizer(tap)
            _installedRecognizers.append(tap)
            
            let pan = UIPanGestureRecognizer(target: agg, action: #selector(GestureAggregator.handlePan(_:)))
            pan.cancelsTouchesInView = false
            pan.delaysTouchesBegan = false
            pan.delaysTouchesEnded = false
            pan.minimumNumberOfTouches = 1
            pan.delegate = agg
            window.addGestureRecognizer(pan)
            _installedRecognizers.append(pan)
            
            let longPress = UILongPressGestureRecognizer(target: agg, action: #selector(GestureAggregator.handleLongPress(_:)))
            longPress.cancelsTouchesInView = false
            longPress.delaysTouchesBegan = false
            longPress.delaysTouchesEnded = false
            longPress.minimumPressDuration = 0.5
            longPress.delegate = agg
            window.addGestureRecognizer(longPress)
            _installedRecognizers.append(longPress)
            
            let pinch = UIPinchGestureRecognizer(target: agg, action: #selector(GestureAggregator.handlePinch(_:)))
            pinch.cancelsTouchesInView = false
            pinch.delaysTouchesBegan = false
            pinch.delaysTouchesEnded = false
            pinch.delegate = agg
            window.addGestureRecognizer(pinch)
            _installedRecognizers.append(pinch)
            
            let rotation = UIRotationGestureRecognizer(target: agg, action: #selector(GestureAggregator.handleRotation(_:)))
            rotation.cancelsTouchesInView = false
            rotation.delaysTouchesBegan = false
            rotation.delaysTouchesEnded = false
            rotation.delegate = agg
            window.addGestureRecognizer(rotation)
            _installedRecognizers.append(rotation)
        }
    }
    
    private func _removeGlobalRecognizers() {
        for recognizer in _installedRecognizers {
            recognizer.view?.removeGestureRecognizer(recognizer)
        }
        _installedRecognizers.removeAll()
    }
    
    fileprivate func reportTap(location: CGPoint, target: String) {
        TelemetryPipeline.shared.recordTapEvent(label: target, x: UInt64(max(0, location.x)), y: UInt64(max(0, location.y)))
        ReplayOrchestrator.shared.incrementTapTally()
    }
    
    fileprivate func reportSwipe(location: CGPoint, direction: SwipeVector, target: String) {
        TelemetryPipeline.shared.recordSwipeEvent(
            label: target,
            x: UInt64(max(0, location.x)),
            y: UInt64(max(0, location.y)),
            direction: direction.label
        )
        ReplayOrchestrator.shared.incrementGestureTally()
    }
    
    fileprivate func reportScroll(location: CGPoint, target: String) {
        TelemetryPipeline.shared.recordScrollEvent(
            label: target,
            x: UInt64(max(0, location.x)),
            y: UInt64(max(0, location.y)),
            direction: "vertical"
        )
        ReplayOrchestrator.shared.incrementGestureTally()
    }
    
    fileprivate func reportPan(location: CGPoint, target: String) {
        TelemetryPipeline.shared.recordPanEvent(
            label: target,
            x: UInt64(max(0, location.x)),
            y: UInt64(max(0, location.y))
        )
    }
    
    fileprivate func reportLongPress(location: CGPoint, target: String) {
        TelemetryPipeline.shared.recordLongPressEvent(
            label: target,
            x: UInt64(max(0, location.x)),
            y: UInt64(max(0, location.y))
        )
        ReplayOrchestrator.shared.incrementGestureTally()
    }
    
    fileprivate func reportPinch(location: CGPoint, scale: CGFloat, target: String) {
        TelemetryPipeline.shared.recordPinchEvent(
            label: target,
            x: UInt64(max(0, location.x)),
            y: UInt64(max(0, location.y)),
            scale: Double(scale)
        )
        ReplayOrchestrator.shared.incrementGestureTally()
    }
    
    fileprivate func reportRotation(location: CGPoint, angle: CGFloat, target: String) {
        TelemetryPipeline.shared.recordRotationEvent(
            label: target,
            x: UInt64(max(0, location.x)),
            y: UInt64(max(0, location.y)),
            angle: Double(angle)
        )
        ReplayOrchestrator.shared.incrementGestureTally()
    }
    
    fileprivate func reportRageTap(location: CGPoint, count: Int, target: String) {
        TelemetryPipeline.shared.recordRageTapEvent(
            label: target,
            x: UInt64(max(0, location.x)),
            y: UInt64(max(0, location.y)),
            count: count
        )
        ReplayOrchestrator.shared.incrementRageTapTally()
    }
    
    fileprivate func reportDeadTap(location: CGPoint, target: String) {
        TelemetryPipeline.shared.recordDeadTapEvent(
            label: target,
            x: UInt64(max(0, location.x)),
            y: UInt64(max(0, location.y))
        )
        ReplayOrchestrator.shared.incrementDeadTapTally()
    }
    
    fileprivate func reportInput(value: String, masked: Bool, hint: String) {
        TelemetryPipeline.shared.recordInputEvent(value: value, redacted: masked, label: hint)
    }
}

private final class GestureAggregator: NSObject, UIGestureRecognizerDelegate {
    
    weak var recorder: InteractionRecorder?
    
    private var _recentTaps: [(location: CGPoint, time: Date)] = []
    private let _rageTapThreshold = 3
    private let _rageTapWindow: TimeInterval = 1.0
    private let _rageTapRadius: CGFloat = 50
    
    // Throttle pan events to avoid flooding (100ms between events)
    private var _lastPanTime: Date = .distantPast
    private let _panThrottleInterval: TimeInterval = 0.1
    
    init(delegate: InteractionRecorder) {
        self.recorder = delegate
        super.init()
    }
    
    @objc func handleTap(_ gesture: UITapGestureRecognizer) {
        guard gesture.state == .ended else { return }
        let loc = gesture.location(in: gesture.view)
        let target = _resolveTarget(at: loc, in: gesture.view)
        
        _recentTaps.append((location: loc, time: Date()))
        _pruneOldTaps()
        
        let nearby = _recentTaps.filter { $0.location.distance(to: loc) < _rageTapRadius }
        if nearby.count >= _rageTapThreshold {
            recorder?.reportRageTap(location: loc, count: nearby.count, target: target)
            _recentTaps.removeAll()
        } else {
            recorder?.reportTap(location: loc, target: target)
            // Dead tap detection moved to JS side — native view hierarchy inspection
            // is unreliable in React Native since touch handling is JS-based.
        }
    }
    
    @objc func handlePan(_ gesture: UIPanGestureRecognizer) {
        let loc = gesture.location(in: gesture.view)
        let target = _resolveTarget(at: loc, in: gesture.view)
        
        // Record pan position during the gesture (throttled for trail visualization)
        if gesture.state == .changed {
            let now = Date()
            if now.timeIntervalSince(_lastPanTime) >= _panThrottleInterval {
                _lastPanTime = now
                recorder?.reportPan(location: loc, target: target)
            }
        }
        
        // Record final swipe/scroll direction when gesture ends
        guard gesture.state == .ended else { return }
        let velocity = gesture.velocity(in: gesture.view)
        
        let vec = SwipeVector.from(velocity: velocity)
        if vec != .none {
            // Fast pan = swipe
            recorder?.reportSwipe(location: loc, direction: vec, target: target)
        } else {
            // Slow pan = scroll
            recorder?.reportScroll(location: loc, target: target)
        }
        ReplayOrchestrator.shared.logScrollAction()
    }
    
    @objc func handleLongPress(_ gesture: UILongPressGestureRecognizer) {
        guard gesture.state == .began else { return }
        let loc = gesture.location(in: gesture.view)
        let target = _resolveTarget(at: loc, in: gesture.view)
        
        recorder?.reportLongPress(location: loc, target: target)
    }
    
    @objc func handlePinch(_ gesture: UIPinchGestureRecognizer) {
        let loc = gesture.location(in: gesture.view)
        let target = _resolveTarget(at: loc, in: gesture.view)
        
        switch gesture.state {
        case .changed:
            let now = Date()
            if now.timeIntervalSince(_lastPanTime) >= _panThrottleInterval {
                _lastPanTime = now
                recorder?.reportPinch(location: loc, scale: gesture.scale, target: target)
            }
        case .ended:
            recorder?.reportPinch(location: loc, scale: gesture.scale, target: target)
        default:
            break
        }
    }
    
    @objc func handleRotation(_ gesture: UIRotationGestureRecognizer) {
        let loc = gesture.location(in: gesture.view)
        let target = _resolveTarget(at: loc, in: gesture.view)
        
        switch gesture.state {
        case .changed:
            let now = Date()
            if now.timeIntervalSince(_lastPanTime) >= _panThrottleInterval {
                _lastPanTime = now
                recorder?.reportRotation(location: loc, angle: gesture.rotation, target: target)
            }
        case .ended:
            recorder?.reportRotation(location: loc, angle: gesture.rotation, target: target)
        default:
            break
        }
    }
    
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        true
    }
    
    /// Allow text inputs to receive touches immediately without gesture resolution delay.
    /// Without this, the system gesture gate times out waiting for our 5 window-level
    /// recognizers, causing a ~3s delay before the keyboard appears on first tap.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        if let view = touch.view {
            if view is UITextField || view is UITextView {
                return false
            }
            // React Native text inputs use internal class names
            let className = String(describing: type(of: view))
            if className.contains("TextInput") || className.contains("RCTUITextField") || className.contains("RCTBaseText") {
                return false
            }
        }
        return true
    }
    
    private func _pruneOldTaps() {
        let cutoff = Date().addingTimeInterval(-_rageTapWindow)
        _recentTaps.removeAll { $0.time < cutoff }
    }
    
    private func _resolveTarget(at point: CGPoint, in view: UIView?) -> String {
        guard let window = view as? UIWindow else { return "unknown" }
        guard let hit = window.hitTest(point, with: nil) else { return "window" }
        return hit.accessibilityIdentifier ?? hit.accessibilityLabel ?? String(describing: type(of: hit))
    }
}

private enum SwipeVector {
    case up, down, left, right, none
    
    var label: String {
        switch self {
        case .up: return "up"
        case .down: return "down"
        case .left: return "left"
        case .right: return "right"
        case .none: return "none"
        }
    }
    
    static func from(velocity: CGPoint) -> SwipeVector {
        let threshold: CGFloat = 200
        if abs(velocity.x) > abs(velocity.y) {
            if velocity.x > threshold { return .right }
            if velocity.x < -threshold { return .left }
        } else {
            if velocity.y > threshold { return .down }
            if velocity.y < -threshold { return .up }
        }
        return .none
    }
}

private final class InputEndObserver: NSObject {
    weak var recorder: InteractionRecorder?
    weak var field: UITextField?
    
    init(recorder: InteractionRecorder, field: UITextField) {
        self.recorder = recorder
        self.field = field
        super.init()
        field.addTarget(self, action: #selector(editingEnded), for: .editingDidEnd)
    }
    
    @objc private func editingEnded() {
        guard let f = field else { return }
        let value = f.isSecureTextEntry ? "***" : (f.text ?? "")
        recorder?.reportInput(value: value, masked: f.isSecureTextEntry, hint: f.placeholder ?? "")
    }
}

private extension CGPoint {
    func distance(to other: CGPoint) -> CGFloat {
        sqrt(pow(x - other.x, 2) + pow(y - other.y, 2))
    }
}
