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

// MARK: - Detected map SDK type
enum MapSDKType {
    case appleMapKit   // MKMapView
    case googleMaps    // GMSMapView
    case mapbox        // MGLMapView
}

// MARK: - SpecialCases
/// Centralised detection and idle-state management for map views.
/// All map class names and SDK-specific hooks live here so the rest
/// of the recording pipeline only calls into this module.
///
/// Safety: every call into a map SDK (delegate swizzle, property read)
/// is guarded by responds(to:), null checks, and do/catch.  If any
/// hook fails we fall back to mapIdle = true so capture is never
/// permanently blocked.  We never crash the host app.
@objc(RJNativeSpecialCases)
final class SpecialCases: NSObject {

    @objc static let shared = SpecialCases()

    // MARK: - Public state

    /// True when the current key window contains a supported map view.
    @objc private(set) var mapVisible: Bool = false

    /// True when the map's camera has settled (no user gesture, no animation).
    /// When mapVisible is false this value is meaningless.
    /// Defaults to true so that if we fail to hook idle we still capture.
    @objc private(set) var mapIdle: Bool = true {
        didSet {
            if !mapIdle {
                _mapCaptureWorkItem?.cancel()
                _mapCaptureWorkItem = nil
                _mapIdleRetryWorkItem?.cancel()
                _mapIdleRetryWorkItem = nil
            }
            if mapIdle && !oldValue && mapVisible {
                // Native callbacks already mean fully idle; the gesture
                // fallback reaches this transition only after its momentum
                // debounce. Coalesce onto the next main-loop turn without
                // adding another second that can lose the final map state.
                _scheduleMapCapture(after: SpecialCases.mapIdleCaptureDelay)
                _scheduleMapIdleRetry()
            }
        }
    }

    /// The detected SDK type, or nil if no map is present.
    private(set) var detectedSDK: MapSDKType?

    // MARK: - Internals

    private var _hookedDelegateClass: AnyClass?
    /// Weak, matching the Android side. A strong reference outlives the map on
    /// every path where refreshMapState stops running but the session does not
    /// end -- a user pause, or backgrounding while a map is on screen. Nothing
    /// on those paths clears map state, so the map's whole subtree (tile caches
    /// and Metal drawables, tens of MB) would stay alive until resume.
    private weak var _hookedMapView: UIView?
    private var _originalRegionDidChange: IMP?
    private var _originalRegionWillChange: IMP?
    private var _originalIdleAtCamera: IMP?
    private var _originalWillMove: IMP?
    private var _replacementRegionDidChange: IMP?
    private var _replacementRegionWillChange: IMP?
    private var _replacementIdleAtCamera: IMP?
    private var _replacementWillMove: IMP?
    private var _delegateIdleHooked = false
    private var _delegateHookGeneration: UInt64 = 0

    /// When true, idle detection is driven by gesture recognizer observation
    /// rather than SDK delegate callbacks.  Used for Mapbox v10+/v11 whose
    /// Swift closure-based event API cannot be hooked from the ObjC runtime.
    private var _usesGestureBasedIdle = false

    /// Raw window-touch fallback is only necessary when neither complete
    /// delegate callbacks nor continuous map recognizers are available.
    private var _usesRawTouchIdle = false

    /// Debounce timer for gesture-based idle detection.
    /// Fires after the last gesture end to account for momentum/deceleration.
    /// Mapbox uses UIScrollView.DecelerationRate.normal (0.998/ms).
    /// At 2s after a 500pt/s flick, residual velocity is ~9pt/s (barely visible).
    private var _gestureDebounceTimer: Timer?
    private static let _gestureDebounceDelay: TimeInterval = 2.0

    /// Number of gesture recognizers currently in .began/.changed state.
    private var _activeGestureCount = 0

    /// Gesture recognizers we've added ourselves as targets to.
    private var _observedGestureRecognizers: [UIGestureRecognizer] = []
    private var _activeMapTouches: [ObjectIdentifier: CGPoint] = [:]
    private var _mapTouchSequenceMoved = false
    private var _mapCaptureWorkItem: DispatchWorkItem?
    private var _mapIdleRetryWorkItem: DispatchWorkItem?
    private var _mapVerificationWorkItem: DispatchWorkItem?
    private static let _initialMapCaptureDelay: TimeInterval = 0.35
    static let mapIdleCaptureDelay: TimeInterval = 0
    private static let _mapTapCaptureDelay: TimeInterval = 0.2
    private static let _mapIdleRetryDelay: TimeInterval = 0.35
    private static let _mapVerificationDelay: TimeInterval = 2.0
    private static let _mapTapSlopPoints: CGFloat = 12

    private override init() {
        super.init()
    }

    // MARK: - Map detection (shallow hierarchy walk)

    /// One-time diagnostic scan counter for debug logging.
    private var _diagScanCount = 0
    private var _lastMapScanTime: CFAbsoluteTime = 0
    private let _mapScanIntervalSec: CFAbsoluteTime = 1

    /// Scan the key window for a known map view.
    /// Call this from the capture timer (main thread, ~1 Hz).
    /// Returns quickly on the first match; limited to depth 40.
    @objc func refreshMapState(eventDrivenCaptureInProgress: Bool = false) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in
                self?.refreshMapState(eventDrivenCaptureInProgress: eventDrivenCaptureInProgress)
            }
            return
        }

        guard let window = _keyWindow() else {
            if _diagScanCount == 0 {
                DiagnosticLog.trace("[SpecialCases] refreshMapState: no key window found")
            }
            _clearMapState()
            return
        }

        let now = CFAbsoluteTimeGetCurrent()
        if _diagScanCount >= 3 && now - _lastMapScanTime < _mapScanIntervalSec {
            return
        }
        _lastMapScanTime = now
        _diagScanCount += 1

        if _diagScanCount == 1 {
            DiagnosticLog.trace("[SpecialCases] refreshMapState running (scan #1)")
        }

        if let (mapView, sdk) = _findMapView(in: window, depth: 0) {
            let wasAlreadyVisible = mapVisible
            mapVisible = true
            detectedSDK = sdk

            if !wasAlreadyVisible {
                let className = NSStringFromClass(type(of: mapView))
                DiagnosticLog.trace("[SpecialCases] Map DETECTED: class=\(className) sdk=\(sdk)")
            }

            // Only hook once per map view instance
            if _hookedMapView == nil || _hookedMapView !== mapView {
                _unhookPreviousDelegate()
                _hookIdleCallbacks(mapView: mapView, sdk: sdk)
            }

            if !wasAlreadyVisible && !eventDrivenCaptureInProgress {
                _scheduleMapCapture(after: SpecialCases._initialMapCaptureDelay)
            }
        } else {
            // Print diagnostic view tree dump on first 3 scans and every 10th
            if DiagnosticLog.minimumLevel <= 0,
               (_diagScanCount <= 3 || _diagScanCount % 10 == 0) {
                _logViewTreeDiagnostic(window)
            }
            _clearMapState()
        }
    }

    /// Log the first few levels of the view tree to help diagnose detection failures.
    /// Debug-only (DiagnosticLog.trace).
    private func _logViewTreeDiagnostic(_ window: UIView) {
        var lines: [String] = ["[SpecialCases] scan #\(_diagScanCount) — no map found. Map-like classes:"]
        var deepMatches: [String] = []
        _findMapLikeClassNames(view: window, depth: 0, maxDepth: 40, matches: &deepMatches)
        if deepMatches.isEmpty {
            lines.append("  (none found in \(_countViews(window)) views)")
        } else {
            for match in deepMatches {
                lines.append("  \(match)")
            }
        }
        DiagnosticLog.trace(lines.joined(separator: "\n"))
    }

    /// Count total views in hierarchy (for diagnostic context).
    private func _countViews(_ view: UIView) -> Int {
        var count = 1
        for sub in view.subviews { count += _countViews(sub) }
        return count
    }

    private func _findMapLikeClassNames(view: UIView, depth: Int, maxDepth: Int, matches: inout [String]) {
        guard depth <= maxDepth else { return }
        let name = NSStringFromClass(type(of: view))
        let nameLC = name.lowercased()
        if nameLC.contains("map") || nameLC.contains("mbx") || nameLC.contains("mapbox") ||
           nameLC.contains("metal") || nameLC.contains("opengl") {
            matches.append("\(name) @depth=\(depth)")
        }
        for sub in view.subviews {
            _findMapLikeClassNames(view: sub, depth: depth + 1, maxDepth: maxDepth, matches: &matches)
        }
    }

    // MARK: - Map view search

    // Expo Router + React Navigation nests navigators 3+ levels deep, each
    // adding ~8 depth levels (UILayoutContainerView > UINavigationTransitionView
    // > UIViewControllerWrapperView > RNSScreenView > RCTViewComponentView > …).
    // In the test app the deepest RNSScreenView is already at depth 25 before
    // the actual map view.  40 handles any reasonable nesting.
    // The walk is cheap (~200 views, simple string checks) so 40 is safe at 1 Hz.
    private static let _maxScanDepth = 40

    private func _findMapView(in view: UIView, depth: Int) -> (UIView, MapSDKType)? {
        guard depth < SpecialCases._maxScanDepth else { return nil }

        // Walk the entire class inheritance chain — react-native-maps uses
        // AIRMap (subclass of MKMapView), RCTMGLMapView (subclass of
        // MGLMapView), etc.  Checking only the runtime class misses these.
        if let sdk = _classifyByInheritance(view) {
            return (view, sdk)
        }

        for sub in view.subviews {
            if let found = _findMapView(in: sub, depth: depth + 1) {
                return found
            }
        }
        return nil
    }

    /// Walk the superclass chain and return the map SDK type if any
    /// ancestor is a known map base class.
    ///
    /// True when this view is a map from any SDK we recognise.
    ///
    /// Capture uses this to leave map internals alone: a map lays its
    /// annotations out in its own coordinate space, so rects converted out of
    /// that hierarchy do not line up with what they meant to cover.
    @objc func isMapView(_ view: UIView) -> Bool {
        return _classifyByInheritance(view) != nil
    }

    /// NSStringFromClass for Swift classes includes the module prefix, e.g.:
    ///   "MapboxMaps.MapView", "rnmapbox_maps.RNMBXMapView"
    /// The module prefix varies by build config (static lib, framework, etc.)
    /// so we use .contains() checks rather than strict prefix matching.
    private func _classifyByInheritance(_ view: UIView) -> MapSDKType? {
        var cls: AnyClass? = type(of: view)
        while let c = cls {
            let name = NSStringFromClass(c)

            // Apple MapKit (ObjC class — no module prefix)
            if name == "MKMapView" { return .appleMapKit }

            // Google Maps iOS SDK (ObjC class)
            if name == "GMSMapView" { return .googleMaps }

            // Mapbox GL Native v5/v6 (ObjC class)
            if name == "MGLMapView" { return .mapbox }

            // Mapbox Maps SDK v10+/v11 (Swift class, used by @rnmapbox/maps)
            // NSStringFromClass returns: "MapboxMaps.MapView"
            // Use .contains to handle any module prefix variations.
            if name.contains("MapboxMaps") && name.contains("MapView") { return .mapbox }

            cls = class_getSuperclass(c)
        }

        // Also check the runtime class name directly for the RN wrapper.
        // CocoaPods may compile it as "rnmapbox_maps.RNMBXMapView" or
        // "RNMBX.RNMBXMapView" depending on the pod name.
        let runtimeName = NSStringFromClass(type(of: view))
        if runtimeName.contains("RNMBXMap") { return .mapbox }

        return nil
    }

    // MARK: - Idle hooks (delegate swizzle, safe)

    private func _hookIdleCallbacks(mapView: UIView, sdk: MapSDKType) {
        _hookedMapView = mapView
        // Reset idle to true (safe default) before attempting hook
        mapIdle = true

        switch sdk {
        case .appleMapKit:
            _hookAppleMapKit(mapView)
        case .googleMaps:
            _hookGoogleMaps(mapView)
        case .mapbox:
            _hookMapbox(mapView)
        }

        // Official delegate completion callbacks are more precise than a
        // time-based gesture debounce. Only install the fallback when the host
        // delegate does not implement both sides of the motion lifecycle.
        if !_delegateIdleHooked {
            _observeContinuousGestures(in: mapView)
        }
        _usesRawTouchIdle = SpecialCases.shouldUseRawTouchFallback(
            delegateIdleHooked: _delegateIdleHooked,
            observedGestureCount: _observedGestureRecognizers.count
        )
        if _usesRawTouchIdle {
            // If delegate hooks are unavailable and the SDK exposes no
            // recognizers we can observe, fall back to raw touch idle gating.
            _usesGestureBasedIdle = true
        }
    }

    // ---- Apple MapKit ----
    // MKMapViewDelegate: mapView(_:regionWillChangeAnimated:)  -> not idle
    //                    mapView(_:regionDidChangeAnimated:)   -> idle
    private func _hookAppleMapKit(_ mapView: UIView) {
        guard mapView.responds(to: NSSelectorFromString("delegate")) else {
            DiagnosticLog.trace("[SpecialCases] MKMapView has no delegate property")
            return
        }
        guard let delegate = mapView.value(forKey: "delegate") as? NSObject else {
            DiagnosticLog.trace("[SpecialCases] MKMapView delegate is nil")
            return
        }
        _swizzleDelegateForAppleOrMapbox(delegate: delegate, isMapbox: false)
    }

    // ---- Google Maps ----
    // GMSMapViewDelegate: mapView(_:willMove:)             -> not idle
    //                     mapView(_:idleAtCameraPosition:)  -> idle
    private func _hookGoogleMaps(_ mapView: UIView) {
        guard mapView.responds(to: NSSelectorFromString("delegate")) else {
            DiagnosticLog.trace("[SpecialCases] GMSMapView has no delegate property")
            return
        }
        guard let delegate = mapView.value(forKey: "delegate") as? NSObject else {
            DiagnosticLog.trace("[SpecialCases] GMSMapView delegate is nil")
            return
        }
        _swizzleGoogleDelegate(delegate)
    }

    // ---- Mapbox ----
    // Supports both old MGLMapView (v5/v6) and new MapboxMaps.MapView (v10+/v11).
    private func _hookMapbox(_ mapView: UIView) {
        // Old MGLMapView (v5/v6) — delegate-based, same pattern as Apple MapKit
        if _superclassChainContains(mapView, name: "MGLMapView") {
            guard mapView.responds(to: NSSelectorFromString("delegate")) else { return }
            guard let delegate = mapView.value(forKey: "delegate") as? NSObject else { return }
            _swizzleDelegateForAppleOrMapbox(delegate: delegate, isMapbox: true)
            return
        }

        // @rnmapbox/maps v10+/v11 — the SDK's event API uses Swift generics
        // and closures that can't be hooked from the ObjC runtime.
        // Instead, we observe the map's UIGestureRecognizers directly.
        // The MapboxMaps.MapView has pan/pinch/rotate/pitch recognizers
        // exposed via its `gestures` GestureManager.  These are standard
        // UIGestureRecognizers added to the view hierarchy, so we can use
        // addTarget(_:action:) without importing the framework.
        _hookMapboxV10GestureRecognizers(mapView)
    }

    /// Check if any superclass has the given name.
    private func _superclassChainContains(_ view: UIView, name: String) -> Bool {
        var cls: AnyClass? = type(of: view)
        while let c = cls {
            if NSStringFromClass(c) == name { return true }
            cls = class_getSuperclass(c)
        }
        return false
    }

    // MARK: - Mapbox v10+ gesture recognizer observation

    /// Find the actual MapboxMaps.MapView and observe its gesture recognizers.
    private func _hookMapboxV10GestureRecognizers(_ mapView: UIView) {
        // The detected view might be the RNMBX wrapper.  Find the actual
        // MapboxMaps.MapView which holds the gesture recognizers.
        let target = _findMapboxMapsView(in: mapView) ?? mapView
        let targetClass = NSStringFromClass(type(of: target))
        let mapViewClass = NSStringFromClass(type(of: mapView))
        DiagnosticLog.trace("[SpecialCases] Mapbox v10+ hook: detected=\(mapViewClass), target=\(targetClass)")

        // Collect all gesture recognizers on the map view.
        // The MapboxMaps.MapView has pan, pinch, rotate, pitch, double-tap,
        // quick-zoom, and single-tap recognizers.
        guard let recognizers = target.gestureRecognizers, !recognizers.isEmpty else {
            DiagnosticLog.trace("[SpecialCases] Mapbox v10+: no gesture recognizers on \(NSStringFromClass(type(of: target))), falling back to touch-based")
            _usesGestureBasedIdle = true
            _usesRawTouchIdle = true
            return
        }

        _observeContinuousGestures(on: target)

        if _observedGestureRecognizers.isEmpty {
            DiagnosticLog.trace("[SpecialCases] Mapbox v10+: no continuous gesture recognizers found, falling back to touch-based")
            _usesGestureBasedIdle = true
            _usesRawTouchIdle = true
            return
        }

        _usesGestureBasedIdle = true
        _usesRawTouchIdle = false
        DiagnosticLog.trace("[SpecialCases] Mapbox v10+: observing \(_observedGestureRecognizers.count) gesture recognizers")
    }

    /// Find the actual MapboxMaps.MapView in a view and its near children.
    /// Uses .contains() for class name matching to handle module prefix variations.
    private func _findMapboxMapsView(in view: UIView) -> UIView? {
        if _isMapboxMapsViewClass(view) { return view }
        for sub in view.subviews {
            if _isMapboxMapsViewClass(sub) { return sub }
        }
        for sub in view.subviews {
            for subsub in sub.subviews {
                if _isMapboxMapsViewClass(subsub) { return subsub }
            }
        }
        // Go one more level — some wrappers add intermediate containers
        for sub in view.subviews {
            for subsub in sub.subviews {
                for subsubsub in subsub.subviews {
                    if _isMapboxMapsViewClass(subsubsub) { return subsubsub }
                }
            }
        }
        return nil
    }

    /// Check if a view is the actual MapboxMaps.MapView (not the RN wrapper).
    private func _isMapboxMapsViewClass(_ view: UIView) -> Bool {
        let name = NSStringFromClass(type(of: view))
        return name.contains("MapboxMaps") && name.contains("MapView")
    }

    /// Target-action handler for map gesture recognizers.
    @objc private func _handleMapGesture(_ gr: UIGestureRecognizer) {
        switch gr.state {
        case .began, .changed:
            if gr.state == .began {
                _activeGestureCount += 1
                // A new pan can begin on the exact run-loop turn when the
                // previous pan's settled watchdog fires. Cancel every pending
                // readback here as well as in the raw-touch path; Mapbox's
                // gesture host is not always a descendant of its render view,
                // so raw-touch containment alone cannot close this race.
                _mapCaptureWorkItem?.cancel()
                _mapCaptureWorkItem = nil
                _mapIdleRetryWorkItem?.cancel()
                _mapIdleRetryWorkItem = nil
                _mapVerificationWorkItem?.cancel()
                _mapVerificationWorkItem = nil
            }
            _gestureDebounceTimer?.invalidate()
            _gestureDebounceTimer = nil
            if mapIdle {
                mapIdle = false
            }

        case .ended, .cancelled, .failed:
            _activeGestureCount = max(0, _activeGestureCount - 1)
            if _activeGestureCount == 0 {
                // All gestures ended — start the deceleration debounce timer.
                _gestureDebounceTimer?.invalidate()
                _gestureDebounceTimer = Timer.scheduledTimer(
                    withTimeInterval: SpecialCases._gestureDebounceDelay,
                    repeats: false
                ) { [weak self] _ in
                    guard let self = self else { return }
                    self._gestureDebounceTimer = nil
                    if !self.mapIdle {
                        self.mapIdle = true
                    }
                }
            }

        default:
            break
        }
    }

    private func _observeContinuousGestures(in view: UIView, depth: Int = 0) {
        guard depth < 8 else { return }
        _observeContinuousGestures(on: view)
        for subview in view.subviews {
            _observeContinuousGestures(in: subview, depth: depth + 1)
        }
    }

    private func _observeContinuousGestures(on view: UIView) {
        guard let recognizers = view.gestureRecognizers else { return }
        for recognizer in recognizers where _isMapMotionGesture(recognizer) {
            guard !_observedGestureRecognizers.contains(where: { $0 === recognizer }) else { continue }
            recognizer.addTarget(self, action: #selector(_handleMapGesture(_:)))
            _observedGestureRecognizers.append(recognizer)
        }

        if !_observedGestureRecognizers.isEmpty {
            _usesGestureBasedIdle = true
        }
    }

    private func _isMapMotionGesture(_ recognizer: UIGestureRecognizer) -> Bool {
        recognizer is UIPanGestureRecognizer ||
            recognizer is UIPinchGestureRecognizer ||
            recognizer is UIRotationGestureRecognizer
    }

    // MARK: - Touch-based idle detection (fallback for when gesture observation fails)

    /// Called by InteractionRecorder when a touch begins inside any supported
    /// map. Every integration uses this to arm the settled verification; only
    /// integrations without reliable callbacks also use it as their idle gate.
    func notifyTouchBegan(_ touch: UITouch, in window: UIWindow) {
        guard mapVisible,
              let mapView = _hookedMapView,
              mapView.window === window else { return }
        let point = mapView.convert(touch.location(in: window), from: window)
        guard mapView.bounds.contains(point),
              SpecialCases.isTouchView(touch.view, within: mapView) else { return }
        if _activeMapTouches.isEmpty {
            _mapTouchSequenceMoved = false
        }
        _activeMapTouches[ObjectIdentifier(touch)] = point
        _mapCaptureWorkItem?.cancel()
        _mapCaptureWorkItem = nil
        _mapIdleRetryWorkItem?.cancel()
        _mapIdleRetryWorkItem = nil
        _mapVerificationWorkItem?.cancel()
        _mapVerificationWorkItem = nil
        guard _usesRawTouchIdle else { return }
        _gestureDebounceTimer?.invalidate()
        _gestureDebounceTimer = nil
        if mapIdle {
            mapIdle = false
        }
    }

    /// Records movement throughout the gesture instead of comparing only its
    /// endpoints. This catches circular pans and pinches that finish near the
    /// coordinate where they began.
    func notifyTouchMoved(_ touch: UITouch) {
        guard let start = _activeMapTouches[ObjectIdentifier(touch)],
              let mapView = _hookedMapView,
              mapVisible else { return }
        let point = touch.location(in: mapView)
        if hypot(point.x - start.x, point.y - start.y) > SpecialCases._mapTapSlopPoints {
            _mapTouchSequenceMoved = true
        }
    }

    /// Called by InteractionRecorder when a tracked map touch ends/cancels.
    /// Movement arms the same one-shot verification for every supported map.
    func notifyTouchEnded(_ touch: UITouch) {
        guard let start = _activeMapTouches.removeValue(forKey: ObjectIdentifier(touch)),
              let mapView = _hookedMapView,
              mapVisible else { return }
        let end = touch.location(in: mapView)
        let moved = hypot(end.x - start.x, end.y - start.y)
        _mapTouchSequenceMoved = _mapTouchSequenceMoved || moved > SpecialCases._mapTapSlopPoints
        guard _activeMapTouches.isEmpty else { return }

        let touchSequenceMoved = _mapTouchSequenceMoved
        _mapTouchSequenceMoved = false
        if touchSequenceMoved {
            _scheduleMapVerification()
        }

        if !_usesRawTouchIdle {
            guard mapIdle, !touchSequenceMoved else { return }
            // A map-marker tap can change a callout without moving the camera,
            // so no camera-idle callback will fire. Capture that state once,
            // after the map SDK has had a frame to present it. Coalesce rapid
            // taps rather than reintroducing periodic GPU readback.
            _scheduleMapCapture(after: SpecialCases._mapTapCaptureDelay)
            return
        }

        _gestureDebounceTimer?.invalidate()
        _gestureDebounceTimer = Timer.scheduledTimer(
            withTimeInterval: SpecialCases._gestureDebounceDelay,
            repeats: false
        ) { [weak self] _ in
            guard let self = self else { return }
            self._gestureDebounceTimer = nil
            if !self.mapIdle {
                self.mapIdle = true
            }
        }
    }

    // MARK: - Apple / Mapbox delegate swizzle

    /// Both Apple MapKit and Mapbox use `regionDidChangeAnimated:` /
    /// `regionWillChangeAnimated:` on their delegate protocols.
    /// The ObjC selectors are identical:
    ///   mapView:regionDidChangeAnimated:
    ///   mapView:regionWillChangeAnimated:
    private func _swizzleDelegateForAppleOrMapbox(delegate: NSObject, isMapbox: Bool) {
        let delegateClass: AnyClass = type(of: delegate)
        let didChangeSel = NSSelectorFromString("mapView:regionDidChangeAnimated:")
        let willChangeSel = NSSelectorFromString("mapView:regionWillChangeAnimated:")
        // class_getInstanceMethod also returns inherited methods. Mutating that
        // Method would swizzle the superclass globally and could alter unrelated
        // delegates, so a selector is hooked only when this concrete class owns
        // it. Ownership is decided per selector: a delegate that implements one
        // side of the lifecycle and inherits the other still gets its half
        // hooked, and the gesture observer covers the half that is missing.
        let ownsDidChange = SpecialCases.classDirectlyImplementsInstanceMethod(delegateClass, selector: didChangeSel)
        let ownsWillChange = SpecialCases.classDirectlyImplementsInstanceMethod(delegateClass, selector: willChangeSel)
        guard ownsDidChange || ownsWillChange else {
            DiagnosticLog.trace("[SpecialCases] \(isMapbox ? "Mapbox" : "Apple") delegate owns neither lifecycle callback; using gesture fallback")
            return
        }
        _delegateHookGeneration &+= 1
        let hookGeneration = _delegateHookGeneration
        _hookedDelegateClass = delegateClass
        var hookedDidChange = false
        var hookedWillChange = false

        // regionDidChangeAnimated -> idle
        if ownsDidChange, let original = class_getInstanceMethod(delegateClass, didChangeSel) {
            let originalIMP = method_getImplementation(original)
            _originalRegionDidChange = originalIMP

            let block: @convention(block) (AnyObject, AnyObject, Bool) -> Void = { [weak self] obj, mapView, animated in
                // Set idle FIRST, then call original
                if self?._delegateHookIsActive(
                    hookGeneration,
                    delegateClass: delegateClass
                ) == true {
                    self?.mapIdle = true
                }
                // Call original IMP safely
                typealias FnType = @convention(c) (AnyObject, Selector, AnyObject, Bool) -> Void
                let fn = unsafeBitCast(originalIMP, to: FnType.self)
                fn(obj, didChangeSel, mapView, animated)
            }
            let newIMP = imp_implementationWithBlock(block)
            _replacementRegionDidChange = newIMP
            method_setImplementation(original, newIMP)
            hookedDidChange = true
        }

        // regionWillChangeAnimated -> not idle
        if ownsWillChange, let original = class_getInstanceMethod(delegateClass, willChangeSel) {
            let originalIMP = method_getImplementation(original)
            _originalRegionWillChange = originalIMP

            let block: @convention(block) (AnyObject, AnyObject, Bool) -> Void = { [weak self] obj, mapView, animated in
                if self?._delegateHookIsActive(
                    hookGeneration,
                    delegateClass: delegateClass
                ) == true {
                    self?.mapIdle = false
                }
                typealias FnType = @convention(c) (AnyObject, Selector, AnyObject, Bool) -> Void
                let fn = unsafeBitCast(originalIMP, to: FnType.self)
                fn(obj, willChangeSel, mapView, animated)
            }
            let newIMP = imp_implementationWithBlock(block)
            _replacementRegionWillChange = newIMP
            method_setImplementation(original, newIMP)
            hookedWillChange = true
        }

        // Only a complete pair can drive idle on its own. A partial hook leaves
        // this false so _hookIdleCallbacks still installs the gesture observer.
        _delegateIdleHooked = hookedDidChange && hookedWillChange

        DiagnosticLog.trace("[SpecialCases] Hooked \(isMapbox ? "Mapbox" : "Apple") delegate on \(delegateClass) (didChange=\(hookedDidChange) willChange=\(hookedWillChange))")
    }

    // MARK: - Google Maps delegate swizzle

    /// Google Maps uses `mapView:idleAtCameraPosition:` and `mapView:willMove:`.
    private func _swizzleGoogleDelegate(_ delegate: NSObject) {
        let delegateClass: AnyClass = type(of: delegate)
        let idleSel = NSSelectorFromString("mapView:idleAtCameraPosition:")
        let willMoveSel = NSSelectorFromString("mapView:willMove:")
        // Google hosts very often implement idleAtCameraPosition: without
        // willMove:. Hooking per selector keeps that idle signal instead of
        // discarding both; see the Apple/Mapbox swizzler for the reasoning.
        let ownsIdle = SpecialCases.classDirectlyImplementsInstanceMethod(delegateClass, selector: idleSel)
        let ownsWillMove = SpecialCases.classDirectlyImplementsInstanceMethod(delegateClass, selector: willMoveSel)
        guard ownsIdle || ownsWillMove else {
            DiagnosticLog.trace("[SpecialCases] Google delegate owns neither lifecycle callback; using gesture fallback")
            return
        }
        _delegateHookGeneration &+= 1
        let hookGeneration = _delegateHookGeneration
        _hookedDelegateClass = delegateClass
        var hookedIdle = false
        var hookedWillMove = false

        // idleAtCameraPosition -> idle
        if ownsIdle, let original = class_getInstanceMethod(delegateClass, idleSel) {
            let originalIMP = method_getImplementation(original)
            _originalIdleAtCamera = originalIMP

            let block: @convention(block) (AnyObject, AnyObject, AnyObject) -> Void = { [weak self] obj, mapView, cameraPos in
                if self?._delegateHookIsActive(
                    hookGeneration,
                    delegateClass: delegateClass
                ) == true {
                    self?.mapIdle = true
                }
                typealias FnType = @convention(c) (AnyObject, Selector, AnyObject, AnyObject) -> Void
                let fn = unsafeBitCast(originalIMP, to: FnType.self)
                fn(obj, idleSel, mapView, cameraPos)
            }
            let newIMP = imp_implementationWithBlock(block)
            _replacementIdleAtCamera = newIMP
            method_setImplementation(original, newIMP)
            hookedIdle = true
        }

        // willMove -> not idle
        if ownsWillMove, let original = class_getInstanceMethod(delegateClass, willMoveSel) {
            let originalIMP = method_getImplementation(original)
            _originalWillMove = originalIMP

            let block: @convention(block) (AnyObject, AnyObject, Bool) -> Void = { [weak self] obj, mapView, gesture in
                if self?._delegateHookIsActive(
                    hookGeneration,
                    delegateClass: delegateClass
                ) == true {
                    self?.mapIdle = false
                }
                typealias FnType = @convention(c) (AnyObject, Selector, AnyObject, Bool) -> Void
                let fn = unsafeBitCast(originalIMP, to: FnType.self)
                fn(obj, willMoveSel, mapView, gesture)
            }
            let newIMP = imp_implementationWithBlock(block)
            _replacementWillMove = newIMP
            method_setImplementation(original, newIMP)
            hookedWillMove = true
        }

        _delegateIdleHooked = hookedIdle && hookedWillMove

        DiagnosticLog.trace("[SpecialCases] Hooked Google Maps delegate on \(delegateClass) (idle=\(hookedIdle) willMove=\(hookedWillMove))")
    }

    // MARK: - Unhook / cleanup

    /// Release process-lifetime delegate/gesture hooks when recording stops,
    /// even if the map remains mounted and no later hierarchy scan occurs.
    @objc func reset() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in self?.reset() }
            return
        }
        _clearMapState()
    }

    private func _unhookPreviousDelegate() {
        // Any replacement retained in a later swizzler's predecessor chain
        // becomes a forwarding-only node. A future recording cycle can install
        // one active wrapper without the retained node emitting duplicates.
        _delegateHookGeneration &+= 1
        // Restore only when our implementation is still installed. Another
        // library may have legitimately chained/swizzled the delegate after
        // Rejourney; overwriting that newer implementation would break the app.
        if let cls = _hookedDelegateClass {
            if let imp = _originalRegionDidChange,
               let replacement = _replacementRegionDidChange,
               let m = class_getInstanceMethod(cls, NSSelectorFromString("mapView:regionDidChangeAnimated:")),
               method_getImplementation(m) == replacement {
                method_setImplementation(m, imp)
                imp_removeBlock(replacement)
            }
            if let imp = _originalRegionWillChange,
               let replacement = _replacementRegionWillChange,
               let m = class_getInstanceMethod(cls, NSSelectorFromString("mapView:regionWillChangeAnimated:")),
               method_getImplementation(m) == replacement {
                method_setImplementation(m, imp)
                imp_removeBlock(replacement)
            }
            if let imp = _originalIdleAtCamera,
               let replacement = _replacementIdleAtCamera,
               let m = class_getInstanceMethod(cls, NSSelectorFromString("mapView:idleAtCameraPosition:")),
               method_getImplementation(m) == replacement {
                method_setImplementation(m, imp)
                imp_removeBlock(replacement)
            }
            if let imp = _originalWillMove,
               let replacement = _replacementWillMove,
               let m = class_getInstanceMethod(cls, NSSelectorFromString("mapView:willMove:")),
               method_getImplementation(m) == replacement {
                method_setImplementation(m, imp)
                imp_removeBlock(replacement)
            }
        }
        _hookedDelegateClass = nil
        _hookedMapView = nil
        _originalRegionDidChange = nil
        _originalRegionWillChange = nil
        _originalIdleAtCamera = nil
        _originalWillMove = nil
        _replacementRegionDidChange = nil
        _replacementRegionWillChange = nil
        _replacementIdleAtCamera = nil
        _replacementWillMove = nil
        _delegateIdleHooked = false

        // Remove gesture recognizer targets
        for gr in _observedGestureRecognizers {
            gr.removeTarget(self, action: #selector(_handleMapGesture(_:)))
        }
        _observedGestureRecognizers.removeAll()
        _activeGestureCount = 0
        _activeMapTouches.removeAll()
    }

    /// The generation and class checks carry the staleness guarantee on their
    /// own. The reported map view is deliberately not compared against
    /// _hookedMapView: _findMapView returns the first map in a depth-first
    /// walk, so with two maps mounted -- a cached RN screen behind the visible
    /// one, or a preview map beside a full one -- the hooked instance and the
    /// reporting instance differ, and comparing them discards every real
    /// callback in silence.
    private func _delegateHookIsActive(
        _ generation: UInt64,
        delegateClass: AnyClass
    ) -> Bool {
        generation == _delegateHookGeneration
            && _hookedDelegateClass === delegateClass
            && mapVisible
    }

    static func shouldUseRawTouchFallback(
        delegateIdleHooked: Bool,
        observedGestureCount: Int
    ) -> Bool {
        !delegateIdleHooked && observedGestureCount == 0
    }

    /// Readback is skipped only while a map camera is actually moving -- that
    /// is the drawHierarchy call that stutters on Metal/OpenGL tiles. Once the
    /// camera settles, capture resumes at the normal cadence: a map screen is
    /// mostly not map (sheets, results, callouts, overlays), and suppressing
    /// the whole screen because a map is mounted loses all of it. An explicit
    /// request -- session start, a high-importance visual change, resume --
    /// is never skipped; those are rare and the caller knows it needs a frame.
    ///
    /// The settled frame still arrives promptly rather than up to a tick late:
    /// the idle/tap/verification schedulers below post it on the next
    /// main-loop turn. Repeated identical idle frames cost nothing to store,
    /// because frame deduplication drops them.
    static func shouldCaptureMapBackedContent(
        mapVisible: Bool,
        mapIdle: Bool,
        eventDriven: Bool
    ) -> Bool {
        eventDriven || !mapVisible || mapIdle
    }

    private func _scheduleMapCapture(after delay: TimeInterval) {
        _mapCaptureWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.mapVisible, self.mapIdle else { return }
            self._mapCaptureWorkItem = nil
            VisualCapture.shared.snapshotNow()
        }
        _mapCaptureWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    /// A bounded retry gives a GPU-backed map time to publish its final pixels
    /// without restoring the old permanent one-frame-per-second idle polling.
    private func _scheduleMapIdleRetry() {
        _mapIdleRetryWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.mapVisible, self.mapIdle,
                  self._activeMapTouches.isEmpty else { return }
            self._mapIdleRetryWorkItem = nil
            self._scheduleMapCapture(after: 0)
        }
        _mapIdleRetryWorkItem = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + SpecialCases._mapIdleRetryDelay,
            execute: work
        )
    }

    /// One settled verification readback after a completed pan/zoom/rotate.
    /// Native idle callbacks can arrive before a Metal-backed map has made its
    /// final pixels available to drawHierarchy. A new map touch cancels and
    /// rearms this one-shot watchdog, so it never reads back while panning.
    private func _scheduleMapVerification() {
        _mapVerificationWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.mapVisible, self._activeMapTouches.isEmpty else { return }
            self._mapVerificationWorkItem = nil
            if !self.mapIdle {
                self.mapIdle = true
            }
            // Coalesce with an idle-transition capture scheduled on this same
            // main-loop turn. Frame deduplication drops an unchanged result.
            self._scheduleMapCapture(after: 0)
        }
        _mapVerificationWorkItem = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + SpecialCases._mapVerificationDelay,
            execute: work
        )
    }

    static func isTouchView(_ touchedView: UIView?, within mapView: UIView) -> Bool {
        guard let touchedView else { return false }
        return touchedView === mapView || touchedView.isDescendant(of: mapView)
    }

    /// `class_getInstanceMethod` walks superclasses. Delegate swizzling must
    /// only mutate methods owned by the concrete class so one map cannot alter
    /// callbacks for every instance of a shared superclass.
    static func classDirectlyImplementsInstanceMethod(
        _ cls: AnyClass,
        selector: Selector
    ) -> Bool {
        var count: UInt32 = 0
        guard let methods = class_copyMethodList(cls, &count) else { return false }
        defer { free(methods) }
        for index in 0..<Int(count) where method_getName(methods[index]) == selector {
            return true
        }
        return false
    }

    private func _clearMapState() {
        let wasVisible = mapVisible
        // Prevent mapIdle's transition hook from scheduling a teardown frame.
        mapVisible = false
        if wasVisible {
            _unhookPreviousDelegate()
        }
        mapIdle = true
        detectedSDK = nil
        _usesGestureBasedIdle = false
        _usesRawTouchIdle = false
        _gestureDebounceTimer?.invalidate()
        _gestureDebounceTimer = nil
        _mapCaptureWorkItem?.cancel()
        _mapCaptureWorkItem = nil
        _mapIdleRetryWorkItem?.cancel()
        _mapIdleRetryWorkItem = nil
        _mapVerificationWorkItem?.cancel()
        _mapVerificationWorkItem = nil
        _activeMapTouches.removeAll()
        _mapTouchSequenceMoved = false
    }

    // MARK: - Helpers

    private func _keyWindow() -> UIWindow? {
        if #available(iOS 15.0, *) {
            return UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
                .first { $0.isKeyWindow }
        } else {
            return UIApplication.shared.windows.first { $0.isKeyWindow }
        }
    }
}
