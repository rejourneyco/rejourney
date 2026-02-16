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
    private var _lastInteractionTimestampMs: UInt64 = 0
    
    private override init() {
        super.init()
    }
    
    @objc public func activate() {
        guard !isTracking else { return }
        isTracking = true
        _gestureAggregator = GestureAggregator(delegate: self)
        _installSendEventHook()
    }
    
    @objc public func deactivate() {
        guard isTracking else { return }
        isTracking = false
        // The sendEvent swizzle stays installed (one-time global hook), but
        // the isTracking guard in processRawTouches prevents event processing.
        _gestureAggregator = nil
        _inputObservers.removeAllObjects()
        _navigationStack.removeAll()
        _lastInteractionTimestampMs = 0
    }
    
    @objc public func latestInteractionTimestampMs() -> UInt64 {
        _lastInteractionTimestampMs
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
    
    private static var _sendEventSwizzled = false
    
    /// Install a UIWindow.sendEvent swizzle to passively observe all touch events.
    /// Unlike gesture recognizers, this does NOT participate in the iOS gesture
    /// resolution system, so it never triggers "System gesture gate timed out"
    /// and never delays text input focus or keyboard appearance.
    /// This is the same approach used by Datadog, Sentry, and FullStory SDKs.
    private func _installSendEventHook() {
        guard !InteractionRecorder._sendEventSwizzled else { return }
        InteractionRecorder._sendEventSwizzled = true
        ObjCRuntimeUtils.hotswapSafely(
            cls: UIWindow.self,
            original: #selector(UIWindow.sendEvent(_:)),
            replacement: #selector(UIWindow.rj_sendEvent(_:))
        )
    }
    
    /// Called from the swizzled UIWindow.sendEvent to process raw touch events.
    @objc public func processRawTouches(_ event: UIEvent, in window: UIWindow) {
        guard isTracking, let agg = _gestureAggregator else { return }
        guard let touches = event.allTouches else { return }
        _lastInteractionTimestampMs = UInt64(Date().timeIntervalSince1970 * 1000)
        for touch in touches {
            agg.processTouch(touch, in: window)
        }
    }
    
    fileprivate func reportTap(location: CGPoint, target: String, isInteractive: Bool) {
        TelemetryPipeline.shared.recordTapEvent(label: target, x: UInt64(max(0, location.x)), y: UInt64(max(0, location.y)), isInteractive: isInteractive)
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

private final class GestureAggregator: NSObject {
    
    weak var recorder: InteractionRecorder?
    
    // Per-touch state for raw touch processing (replaces UIGestureRecognizer)
    private struct TouchState {
        let startLocation: CGPoint
        let startTime: CFAbsoluteTime
        var lastReportTime: CFAbsoluteTime
        var isPanning: Bool
        var maxDistance: CGFloat
    }
    
    private var _activeTouches: [ObjectIdentifier: TouchState] = [:]
    
    // Gesture detection thresholds
    private let _tapMaxDuration: CFAbsoluteTime = 0.3
    private let _tapMaxDistance: CGFloat = 10
    private let _panStartThreshold: CGFloat = 10
    private let _longPressMinDuration: CFAbsoluteTime = 0.5
    
    // Rage tap detection
    private var _recentTaps: [(location: CGPoint, time: CFAbsoluteTime)] = []
    private let _rageTapThreshold = 3
    private let _rageTapWindow: CFAbsoluteTime = 1.0
    private let _rageTapRadius: CGFloat = 50
    
    // Throttle pan events to avoid flooding
    private var _lastPanTime: CFAbsoluteTime = 0
    private let _panThrottleInterval: CFAbsoluteTime = 0.1
    
    init(delegate: InteractionRecorder) {
        self.recorder = delegate
        super.init()
    }
    
    /// Process a raw touch event from UIWindow.sendEvent swizzle.
    /// This replaces all UIGestureRecognizer-based detection. No recognizers are
    /// installed on any window, so iOS's system gesture gate is never triggered
    /// and text input focus / keyboard appearance is never delayed.
    func processTouch(_ touch: UITouch, in window: UIWindow) {
        let touchId = ObjectIdentifier(touch)
        let location = touch.location(in: window)
        let now = CFAbsoluteTimeGetCurrent()
        
        switch touch.phase {
        case .began:
            _activeTouches[touchId] = TouchState(
                startLocation: location,
                startTime: now,
                lastReportTime: 0,
                isPanning: false,
                maxDistance: 0
            )
            
        case .moved:
            guard var state = _activeTouches[touchId] else { return }
            let distance = location.distance(to: state.startLocation)
            state.maxDistance = max(state.maxDistance, distance)
            
            if !state.isPanning && distance > _panStartThreshold {
                state.isPanning = true
            }
            
            if state.isPanning && (now - state.lastReportTime) >= _panThrottleInterval {
                state.lastReportTime = now
                let (target, _) = _resolveTarget(at: location, in: window)
                recorder?.reportPan(location: location, target: target)
            }
            
            _activeTouches[touchId] = state
            
        case .ended:
            guard let state = _activeTouches.removeValue(forKey: touchId) else { return }
            let duration = now - state.startTime
            
            if state.isPanning {
                // Calculate velocity for swipe vs scroll detection
                let dt = max(duration, 0.001)
                let dx = location.x - state.startLocation.x
                let dy = location.y - state.startLocation.y
                let velocity = CGPoint(x: dx / dt, y: dy / dt)
                
                let (target, _) = _resolveTarget(at: location, in: window)
                let vec = SwipeVector.from(velocity: velocity)
                if vec != .none {
                    recorder?.reportSwipe(location: location, direction: vec, target: target)
                } else {
                    recorder?.reportScroll(location: location, target: target)
                }
                ReplayOrchestrator.shared.logScrollAction()
            } else if duration < _tapMaxDuration && state.maxDistance < _tapMaxDistance {
                // Tap — short duration, small movement
                let (target, isInteractive) = _resolveTarget(at: location, in: window)
                
                _recentTaps.append((location: location, time: now))
                _pruneOldTaps(now: now)
                
                let nearby = _recentTaps.filter { $0.location.distance(to: location) < _rageTapRadius }
                if nearby.count >= _rageTapThreshold {
                    recorder?.reportRageTap(location: location, count: nearby.count, target: target)
                    _recentTaps.removeAll()
                } else {
                    recorder?.reportTap(location: location, target: target, isInteractive: isInteractive)
                }
            } else if duration >= _longPressMinDuration && state.maxDistance < _tapMaxDistance {
                // Long press — held without significant movement
                let (target, _) = _resolveTarget(at: location, in: window)
                recorder?.reportLongPress(location: location, target: target)
            }
            
        case .cancelled:
            _activeTouches.removeValue(forKey: touchId)
            
        default:
            break
        }
    }
    
    private func _pruneOldTaps(now: CFAbsoluteTime) {
        let cutoff = now - _rageTapWindow
        _recentTaps.removeAll { $0.time < cutoff }
    }
    
    private func _resolveTarget(at point: CGPoint, in window: UIWindow) -> (label: String, isInteractive: Bool) {
        // When a map view is visible, skip hitTest entirely — performing
        // hitTest on a deep Metal/OpenGL map hierarchy is expensive and
        // causes micro-stutter during pan/zoom gestures.
        if SpecialCases.shared.mapVisible {
            return ("map", false)
        }
        
        guard let hit = window.hitTest(point, with: nil) else { return ("window", false) }
        
        let label = hit.accessibilityIdentifier ?? hit.accessibilityLabel ?? String(describing: type(of: hit))
        let isInteractive = _isViewInteractive(hit)
        
        return (label, isInteractive)
    }
    
    /// Check if a view is interactive (buttons, touchables, controls, etc.)
    ///
    /// In React Native Fabric, all view components render as RCTViewComponentView,
    /// so class name heuristics don't work.  Instead we rely on:
    ///   • UIControl (native buttons/switches/sliders)
    ///   • isAccessibilityElement — RN sets this to true for Pressable,
    ///     TouchableOpacity, and Button (via `accessible` prop, default true).
    ///     Plain View defaults to false.
    ///   • accessibilityTraits containing .button or .link
    /// We walk up to 8 ancestors because hitTest returns the deepest child
    /// (e.g. Text inside a Pressable), not the Pressable itself.
    private func _isViewInteractive(_ view: UIView) -> Bool {
        if _isSingleViewInteractive(view) { return true }
        
        // Walk ancestor chain — tap inside <Pressable><Text>...</Text></Pressable>
        // hits the Text, but the Pressable parent is the interactive element.
        var ancestor = view.superview
        var depth = 0
        while let parent = ancestor, depth < 8 {
            if _isSingleViewInteractive(parent) { return true }
            ancestor = parent.superview
            depth += 1
        }
        
        return false
    }
    
    private func _isSingleViewInteractive(_ view: UIView) -> Bool {
        // Native UIControls (UIButton, UISwitch, UISlider, etc.)
        if view is UIControl { return true }
        
        // Text inputs
        if view is UITextField || view is UITextView { return true }
        
        // React Native Pressable / TouchableOpacity / Button set accessible={true}
        // which maps to isAccessibilityElement = true.  Plain View defaults to false.
        if view.isAccessibilityElement {
            return true
        }
        
        // Explicit accessibility role indicating interactivity
        let traits = view.accessibilityTraits
        if traits.contains(.button) || traits.contains(.link) {
            return true
        }
        
        return false
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

// MARK: - UIWindow sendEvent Swizzle

extension UIWindow {
    /// Swizzled sendEvent that passively observes touch events for session replay.
    /// After ObjCRuntimeUtils.hotswapSafely swaps the IMP pointers, calling
    /// rj_sendEvent actually invokes the ORIGINAL UIWindow.sendEvent.
    @objc func rj_sendEvent(_ event: UIEvent) {
        if event.type == .touches {
            InteractionRecorder.shared.processRawTouches(event, in: self)
        }
        // Call original sendEvent (this IS the original after swizzle)
        rj_sendEvent(event)
    }
}
