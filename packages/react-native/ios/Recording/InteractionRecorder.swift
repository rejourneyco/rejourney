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
    
    private func _installGlobalRecognizers() {
        guard let agg = _gestureAggregator else { return }
        
        for window in UIApplication.shared.windows {
            let tap = UITapGestureRecognizer(target: agg, action: #selector(GestureAggregator.handleTap(_:)))
            tap.cancelsTouchesInView = false
            tap.delaysTouchesEnded = false
            window.addGestureRecognizer(tap)
            
            let pan = UIPanGestureRecognizer(target: agg, action: #selector(GestureAggregator.handlePan(_:)))
            pan.cancelsTouchesInView = false
            pan.delaysTouchesEnded = false
            pan.minimumNumberOfTouches = 1
            window.addGestureRecognizer(pan)
            
            let longPress = UILongPressGestureRecognizer(target: agg, action: #selector(GestureAggregator.handleLongPress(_:)))
            longPress.cancelsTouchesInView = false
            longPress.minimumPressDuration = 0.5
            window.addGestureRecognizer(longPress)
        }
    }
    
    private func _removeGlobalRecognizers() {
        for window in UIApplication.shared.windows {
            window.gestureRecognizers?.forEach { gr in
                if gr.delegate === _gestureAggregator {
                    window.removeGestureRecognizer(gr)
                }
            }
        }
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
    
    fileprivate func reportRageTap(location: CGPoint, count: Int, target: String) {
        TelemetryPipeline.shared.recordRageTapEvent(
            label: target,
            x: UInt64(max(0, location.x)),
            y: UInt64(max(0, location.y)),
            count: count
        )
        ReplayOrchestrator.shared.incrementRageTapTally()
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
    
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        true
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
