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
@objc(SpecialCases)
public final class SpecialCases: NSObject {

    @objc public static let shared = SpecialCases()

    // MARK: - Public state

    /// True when the current key window contains a supported map view.
    @objc public private(set) var mapVisible: Bool = false

    /// True when the map's camera has settled (no user gesture, no animation).
    /// When mapVisible is false this value is meaningless.
    /// Defaults to true so that if we fail to hook idle we still capture.
    @objc public private(set) var mapIdle: Bool = true {
        didSet {
            if mapIdle && !oldValue && mapVisible {
                // Map just settled — capture a frame immediately instead of
                // waiting up to 1s for the next timer tick.  This gives the
                // replay an up-to-date frame the instant motion ends.
                VisualCapture.shared.snapshotNow()
            }
        }
    }

    /// The detected SDK type, or nil if no map is present.
    private(set) var detectedSDK: MapSDKType?

    // MARK: - Internals

    private var _hookedDelegateClass: AnyClass?
    private var _hookedMapView: AnyObject?
    private var _originalRegionDidChange: IMP?
    private var _originalRegionWillChange: IMP?
    private var _originalIdleAtCamera: IMP?
    private var _originalWillMove: IMP?

    /// When true, idle detection is driven by gesture recognizer observation
    /// rather than SDK delegate callbacks.  Used for Mapbox v10+/v11 whose
    /// Swift closure-based event API cannot be hooked from the ObjC runtime.
    private var _usesGestureBasedIdle = false

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

    private override init() {
        super.init()
    }

    // MARK: - Map detection (shallow hierarchy walk)

    /// One-time diagnostic scan counter for debug logging.
    private var _diagScanCount = 0

    /// Scan the key window for a known map view.
    /// Call this from the capture timer (main thread, ~1 Hz).
    /// Returns quickly on the first match; limited to depth 40.
    @objc public func refreshMapState() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in self?.refreshMapState() }
            return
        }

        guard let window = _keyWindow() else {
            if _diagScanCount == 0 {
                DiagnosticLog.trace("[SpecialCases] refreshMapState: no key window found")
            }
            _clearMapState()
            return
        }

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

            if !wasAlreadyVisible {
                VisualCapture.shared.snapshotNow()
            }
        } else {
            // Print diagnostic view tree dump on first 3 scans and every 10th
            if _diagScanCount <= 3 || _diagScanCount % 10 == 0 {
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
            return
        }

        // Only observe continuous gestures that produce map motion
        // (pan, pinch, rotate, pitch — typically UIPanGestureRecognizer,
        // UIPinchGestureRecognizer, UIRotationGestureRecognizer, and
        // Mapbox's custom pitch handler which is also a pan recognizer).
        for gr in recognizers {
            if gr is UIPanGestureRecognizer ||
               gr is UIPinchGestureRecognizer ||
               gr is UIRotationGestureRecognizer {
                gr.addTarget(self, action: #selector(_handleMapGesture(_:)))
                _observedGestureRecognizers.append(gr)
            }
        }

        if _observedGestureRecognizers.isEmpty {
            DiagnosticLog.trace("[SpecialCases] Mapbox v10+: no continuous gesture recognizers found, falling back to touch-based")
            _usesGestureBasedIdle = true
            return
        }

        _usesGestureBasedIdle = true
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
        case .began:
            _activeGestureCount += 1
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

    // MARK: - Touch-based idle detection (fallback for when gesture observation fails)

    /// Called by InteractionRecorder when a touch begins while a map is visible.
    @objc public func notifyTouchBegan() {
        guard _usesGestureBasedIdle, _observedGestureRecognizers.isEmpty, mapVisible else { return }
        _gestureDebounceTimer?.invalidate()
        _gestureDebounceTimer = nil
        if mapIdle {
            mapIdle = false
        }
    }

    /// Called by InteractionRecorder when a touch ends/cancels while a map is visible.
    @objc public func notifyTouchEnded() {
        guard _usesGestureBasedIdle, _observedGestureRecognizers.isEmpty, mapVisible else { return }
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

        // regionDidChangeAnimated -> idle
        let didChangeSel = NSSelectorFromString("mapView:regionDidChangeAnimated:")
        if let original = class_getInstanceMethod(delegateClass, didChangeSel) {
            let originalIMP = method_getImplementation(original)
            _originalRegionDidChange = originalIMP
            _hookedDelegateClass = delegateClass

            let block: @convention(block) (AnyObject, AnyObject, Bool) -> Void = { [weak self] obj, mapView, animated in
                // Set idle FIRST, then call original
                self?.mapIdle = true
                // Call original IMP safely
                typealias FnType = @convention(c) (AnyObject, Selector, AnyObject, Bool) -> Void
                let fn = unsafeBitCast(originalIMP, to: FnType.self)
                fn(obj, didChangeSel, mapView, animated)
            }
            let newIMP = imp_implementationWithBlock(block)
            method_setImplementation(original, newIMP)
        }

        // regionWillChangeAnimated -> not idle
        let willChangeSel = NSSelectorFromString("mapView:regionWillChangeAnimated:")
        if let original = class_getInstanceMethod(delegateClass, willChangeSel) {
            let originalIMP = method_getImplementation(original)
            _originalRegionWillChange = originalIMP

            let block: @convention(block) (AnyObject, AnyObject, Bool) -> Void = { [weak self] obj, mapView, animated in
                self?.mapIdle = false
                typealias FnType = @convention(c) (AnyObject, Selector, AnyObject, Bool) -> Void
                let fn = unsafeBitCast(originalIMP, to: FnType.self)
                fn(obj, willChangeSel, mapView, animated)
            }
            let newIMP = imp_implementationWithBlock(block)
            method_setImplementation(original, newIMP)
        }

        DiagnosticLog.trace("[SpecialCases] Hooked \(isMapbox ? "Mapbox" : "Apple") delegate on \(delegateClass)")
    }

    // MARK: - Google Maps delegate swizzle

    /// Google Maps uses `mapView:idleAtCameraPosition:` and `mapView:willMove:`.
    private func _swizzleGoogleDelegate(_ delegate: NSObject) {
        let delegateClass: AnyClass = type(of: delegate)

        // idleAtCameraPosition -> idle
        let idleSel = NSSelectorFromString("mapView:idleAtCameraPosition:")
        if let original = class_getInstanceMethod(delegateClass, idleSel) {
            let originalIMP = method_getImplementation(original)
            _originalIdleAtCamera = originalIMP
            _hookedDelegateClass = delegateClass

            let block: @convention(block) (AnyObject, AnyObject, AnyObject) -> Void = { [weak self] obj, mapView, cameraPos in
                self?.mapIdle = true
                typealias FnType = @convention(c) (AnyObject, Selector, AnyObject, AnyObject) -> Void
                let fn = unsafeBitCast(originalIMP, to: FnType.self)
                fn(obj, idleSel, mapView, cameraPos)
            }
            let newIMP = imp_implementationWithBlock(block)
            method_setImplementation(original, newIMP)
        }

        // willMove -> not idle
        let willMoveSel = NSSelectorFromString("mapView:willMove:")
        if let original = class_getInstanceMethod(delegateClass, willMoveSel) {
            let originalIMP = method_getImplementation(original)
            _originalWillMove = originalIMP

            let block: @convention(block) (AnyObject, AnyObject, Bool) -> Void = { [weak self] obj, mapView, gesture in
                self?.mapIdle = false
                typealias FnType = @convention(c) (AnyObject, Selector, AnyObject, Bool) -> Void
                let fn = unsafeBitCast(originalIMP, to: FnType.self)
                fn(obj, willMoveSel, mapView, gesture)
            }
            let newIMP = imp_implementationWithBlock(block)
            method_setImplementation(original, newIMP)
        }

        DiagnosticLog.trace("[SpecialCases] Hooked Google Maps delegate on \(delegateClass)")
    }

    // MARK: - Unhook / cleanup

    private func _unhookPreviousDelegate() {
        // Restore original IMPs if we have them
        if let cls = _hookedDelegateClass {
            if let imp = _originalRegionDidChange,
               let m = class_getInstanceMethod(cls, NSSelectorFromString("mapView:regionDidChangeAnimated:")) {
                method_setImplementation(m, imp)
            }
            if let imp = _originalRegionWillChange,
               let m = class_getInstanceMethod(cls, NSSelectorFromString("mapView:regionWillChangeAnimated:")) {
                method_setImplementation(m, imp)
            }
            if let imp = _originalIdleAtCamera,
               let m = class_getInstanceMethod(cls, NSSelectorFromString("mapView:idleAtCameraPosition:")) {
                method_setImplementation(m, imp)
            }
            if let imp = _originalWillMove,
               let m = class_getInstanceMethod(cls, NSSelectorFromString("mapView:willMove:")) {
                method_setImplementation(m, imp)
            }
        }
        _hookedDelegateClass = nil
        _hookedMapView = nil
        _originalRegionDidChange = nil
        _originalRegionWillChange = nil
        _originalIdleAtCamera = nil
        _originalWillMove = nil

        // Remove gesture recognizer targets
        for gr in _observedGestureRecognizers {
            gr.removeTarget(self, action: #selector(_handleMapGesture(_:)))
        }
        _observedGestureRecognizers.removeAll()
        _activeGestureCount = 0
    }

    private func _clearMapState() {
        if mapVisible {
            _unhookPreviousDelegate()
        }
        mapVisible = false
        mapIdle = true
        detectedSDK = nil
        _usesGestureBasedIdle = false
        _gestureDebounceTimer?.invalidate()
        _gestureDebounceTimer = nil
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
