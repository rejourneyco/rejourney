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

    private override init() {
        super.init()
    }

    // MARK: - Map detection (shallow hierarchy walk)

    /// Scan the key window for a known map view.
    /// Call this from the capture timer (main thread, ~1 Hz).
    /// Returns quickly on the first match; limited to depth 40.
    @objc public func refreshMapState() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in self?.refreshMapState() }
            return
        }

        guard let window = _keyWindow() else {
            _clearMapState()
            return
        }

        if let (mapView, sdk) = _findMapView(in: window, depth: 0) {
            let wasAlreadyVisible = mapVisible
            mapVisible = true
            detectedSDK = sdk

            // Only hook once per map view instance
            if _hookedMapView == nil || _hookedMapView !== mapView {
                _unhookPreviousDelegate()
                _hookIdleCallbacks(mapView: mapView, sdk: sdk)
            }

            if !wasAlreadyVisible {
                // Capture an initial frame the moment we detect the map so
                // the replay always has a starting frame of the map screen.
                VisualCapture.shared.snapshotNow()
            }
        } else {
            _clearMapState()
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
    private func _classifyByInheritance(_ view: UIView) -> MapSDKType? {
        var cls: AnyClass? = type(of: view)
        while let c = cls {
            let name = NSStringFromClass(c)
            // NSStringFromClass returns the fully-qualified ObjC name.
            // MKMapView, GMSMapView, MGLMapView are all top-level ObjC classes.
            if name == "MKMapView"  { return .appleMapKit }
            if name == "GMSMapView" { return .googleMaps }
            if name == "MGLMapView" { return .mapbox }
            cls = class_getSuperclass(c)
        }
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
    // MGLMapViewDelegate: mapView(_:regionWillChangeAnimated:) -> not idle
    //                     mapView(_:regionDidChangeAnimated:)  -> idle
    private func _hookMapbox(_ mapView: UIView) {
        guard mapView.responds(to: NSSelectorFromString("delegate")) else {
            DiagnosticLog.trace("[SpecialCases] MGLMapView has no delegate property")
            return
        }
        guard let delegate = mapView.value(forKey: "delegate") as? NSObject else {
            DiagnosticLog.trace("[SpecialCases] MGLMapView delegate is nil")
            return
        }
        _swizzleDelegateForAppleOrMapbox(delegate: delegate, isMapbox: true)
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
    }

    private func _clearMapState() {
        if mapVisible {
            _unhookPreviousDelegate()
        }
        mapVisible = false
        mapIdle = true
        detectedSDK = nil
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
