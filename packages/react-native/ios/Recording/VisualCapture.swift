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
import Foundation
import QuartzCore
import Accelerate
import AVFoundation

@objc(VisualCapture)
public final class VisualCapture: NSObject {
    
    @objc public static let shared = VisualCapture()
    
    @objc public var snapshotInterval: Double = 1.0
    @objc public var quality: CGFloat = 0.5
    
    @objc public var isCapturing: Bool {
        _stateMachine.currentState == .capturing
    }
    
    private let _stateMachine = CaptureStateMachine()
    private var _screenshots: [(Data, UInt64)] = []
    private let _stateLock = NSLock()
    private var _captureTimer: Timer?
    private var _frameCounter: UInt64 = 0
    private var _sessionEpoch: UInt64 = 0
    private var _redactionMask: RedactionMask
    private var _deferredUntilCommit = false
    private var _framesDiskPath: URL?
    private var _currentSessionId: String?
    
    // Use OperationQueue like industry standard - serialized, utility QoS
    private let _encodeQueue: OperationQueue = {
        let q = OperationQueue()
        q.maxConcurrentOperationCount = 1
        q.qualityOfService = .utility
        q.name = "co.rejourney.encode"
        return q
    }()
    
    // Backpressure limits to prevent stutter
    private let _maxPendingBatches = 50
    private let _maxBufferedScreenshots = 500
    
    // Industry standard batch size (20 frames per batch, not 5)
    private let _batchSize = 20

    
    private override init() {
        _redactionMask = RedactionMask()
        super.init()
        _setupLifecycleObservers()
    }
    
    deinit {
        NotificationCenter.default.removeObserver(self)
    }
    
    private func _setupLifecycleObservers() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(_handleBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(_handleForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }
    
    @objc private func _handleBackground() {
        // Stop capturing when app goes to background to prevent
        // "Rendering a view that is not in a visible window" warnings
        _stopCaptureTimer()
        
        // Flush any pending screenshots immediately before background
        // This ensures we don't lose data when app is backgrounded
        _sendScreenshots()
    }
    
    @objc private func _handleForeground() {
        // Resume capturing when app comes back to foreground
        if _stateMachine.currentState == .capturing {
            _startCaptureTimer()
        }
    }
    
    @objc public func beginCapture(sessionOrigin: UInt64) {
        guard _stateMachine.transition(to: .capturing) else { return }
        _sessionEpoch = sessionOrigin
        _frameCounter = 0
        
        // Set up disk persistence for frames
        _currentSessionId = TelemetryPipeline.shared.currentReplayId
        if let sid = _currentSessionId,
           let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first {
            _framesDiskPath = cacheDir.appendingPathComponent("rj_pending").appendingPathComponent(sid).appendingPathComponent("frames")
            try? FileManager.default.createDirectory(at: _framesDiskPath!, withIntermediateDirectories: true)
        }
        
        _startCaptureTimer()
    }
    
    @objc public func halt() {
        guard _stateMachine.transition(to: .halted) else { return }
        _stopCaptureTimer()
        
        // Flush any remaining frames to disk before halting
        _flushBufferToDisk()
        _flushBuffer()
        
        _stateLock.lock()
        _screenshots.removeAll()
        _stateLock.unlock()
    }
    
    /// Synchronously flush all pending frames to disk for crash safety
    @objc public func flushToDisk() {
        _flushBufferToDisk()
    }
    
    /// Submit any buffered frames to the upload pipeline immediately
    /// (regardless of batch size threshold). Packages synchronously to
    /// avoid race conditions during backgrounding.
    @objc public func flushBufferToNetwork() {
        _flushBuffer()
    }
    
    @objc public func activateDeferredMode() {
        _deferredUntilCommit = true
    }
    
    @objc public func commitDeferredData() {
        _deferredUntilCommit = false
        _flushBuffer()
    }
    
    @objc public func registerRedaction(_ view: UIView) {
        _redactionMask.add(view)
    }
    
    @objc public func unregisterRedaction(_ view: UIView) {
        _redactionMask.remove(view)
    }
    
    @objc public func configure(snapshotInterval: Double, jpegQuality: Double) {
        self.snapshotInterval = snapshotInterval
        self.quality = CGFloat(jpegQuality)
        if _stateMachine.currentState == .capturing {
            _stopCaptureTimer()
            _startCaptureTimer()
        }
    }
    
    @objc public func snapshotNow() {
        DispatchQueue.main.async { [weak self] in
            self?._captureFrame(forced: true)
        }
    }
    
    private func _startCaptureTimer() {
        _stopCaptureTimer()
        _captureTimer = Timer.scheduledTimer(withTimeInterval: snapshotInterval, repeats: true) { [weak self] _ in
            self?._captureFrame()
        }
    }
    
    private func _stopCaptureTimer() {
        _captureTimer?.invalidate()
        _captureTimer = nil
    }
    
    private func _captureFrame(forced: Bool = false) {
        guard _stateMachine.currentState == .capturing else { return }
        
        // Skip capture if app is not in foreground (prevents "not in visible window" warnings)
        guard UIApplication.shared.applicationState == .active else { return }
        
        let frameStart = CFAbsoluteTimeGetCurrent()
        
        // Capture the pixel buffer on the main thread (required by UIKit),
        // then move JPEG compression to the encode queue to reduce main-thread blocking.
        autoreleasepool {
            guard let window = UIApplication.shared.windows.first(where: \.isKeyWindow) else { return }
            let bounds = window.bounds
            // Guard against NaN and invalid bounds that cause CoreGraphics errors
            guard bounds.width > 0, bounds.height > 0 else { return }
            guard !bounds.width.isNaN && !bounds.height.isNaN else { return }
            guard bounds.width.isFinite && bounds.height.isFinite else { return }
            
            let redactRects = _redactionMask.computeRects()
            
            UIGraphicsBeginImageContextWithOptions(bounds.size, false, 1.0)
            guard let context = UIGraphicsGetCurrentContext() else {
                UIGraphicsEndImageContext()
                return
            }
            
            window.drawHierarchy(in: bounds, afterScreenUpdates: false)
            
            // Apply redactions inline while context is open
            if !redactRects.isEmpty {
                // Use fully opaque black for privacy masks (no transparency)
                context.setFillColor(UIColor.black.cgColor)
                for r in redactRects {
                    // Skip invalid rects that could cause CoreGraphics errors
                    guard r.width > 0 && r.height > 0 else { continue }
                    guard r.origin.x.isFinite && r.origin.y.isFinite && r.width.isFinite && r.height.isFinite else { continue }
                    guard !r.origin.x.isNaN && !r.origin.y.isNaN && !r.width.isNaN && !r.height.isNaN else { continue }
                    context.fill(r)
                }
            }
            
            guard let image = UIGraphicsGetImageFromCurrentImageContext() else {
                UIGraphicsEndImageContext()
                return
            }
            UIGraphicsEndImageContext()
            
            let captureTs = UInt64(Date().timeIntervalSince1970 * 1000)
            _frameCounter += 1
            let frameNumber = _frameCounter
            let jpegQuality = quality
            
            // Move JPEG compression off the main thread.
            // drawHierarchy must be on main, but jpegData is thread-safe and
            // accounts for ~40-60% of per-frame main-thread cost.
            _encodeQueue.addOperation { [weak self] in
                guard let self else { return }
                guard let data = image.jpegData(compressionQuality: jpegQuality) else { return }
                
                // Log frame timing every 30 frames to avoid log spam
                if frameNumber % 30 == 0 {
                    let frameDurationMs = (CFAbsoluteTimeGetCurrent() - frameStart) * 1000
                    DiagnosticLog.perfFrame(operation: "screenshot", durationMs: frameDurationMs, frameNumber: Int(frameNumber), isMainThread: Thread.isMainThread)
                }
                
                // Store in buffer (fast operation)
                self._stateLock.lock()
                self._screenshots.append((data, captureTs))
                self._enforceScreenshotCaps()
                let shouldSend = !self._deferredUntilCommit && self._screenshots.count >= self._batchSize
                self._stateLock.unlock()
                
                if shouldSend {
                    self._sendScreenshots()
                }
            }
        }
    }
    

    
    /// Enforce memory caps to prevent unbounded growth (industry standard backpressure)
    private func _enforceScreenshotCaps() {
        // Called with lock held
        if _screenshots.count > _maxBufferedScreenshots {
            _screenshots.removeFirst(_screenshots.count - _maxBufferedScreenshots)
        }
    }
    
    /// Send screenshots to server - runs on OperationQueue to avoid blocking main thread
    private func _sendScreenshots() {
        // Check backpressure first - drop if too backed up (prevents stutter)
        guard _encodeQueue.operationCount <= _maxPendingBatches else {
            DiagnosticLog.trace("Dropping screenshot batch due to backlog")
            return
        }
        
        // Copy and clear under lock (fast operation)
        _stateLock.lock()
        let images = _screenshots
        _screenshots.removeAll()
        let sessionEpoch = _sessionEpoch
        _stateLock.unlock()
        
        guard !images.isEmpty else { return }
        
        // All heavy work (tar, gzip, network) happens in background queue
        _encodeQueue.addOperation { [weak self] in
            self?._packageAndShip(images: images, sessionEpoch: sessionEpoch)
        }
    }
    
    private func _packageAndShip(images: [(Data, UInt64)], sessionEpoch: UInt64) {
        let batchStart = CFAbsoluteTimeGetCurrent()
        
        guard let bundle = _packageFrameBundle(images: images, sessionEpoch: sessionEpoch) else { return }
        
        let rid = TelemetryPipeline.shared.currentReplayId ?? "unknown"
        let endTs = images.last?.1 ?? sessionEpoch
        let fname = "\(rid)-\(endTs).tar.gz"
        
        let packDurationMs = (CFAbsoluteTimeGetCurrent() - batchStart) * 1000
        DiagnosticLog.perfBatch(operation: "package-frames", itemCount: images.count, totalMs: packDurationMs, isMainThread: Thread.isMainThread)
        
        // Submit directly - no main thread dispatch needed
        TelemetryPipeline.shared.submitFrameBundle(
            payload: bundle,
            filename: fname,
            startMs: images.first?.1 ?? sessionEpoch,
            endMs: endTs,
            frameCount: images.count
        )
    }
    
    private func _writeFrameToDisk(jpeg: Data, timestamp: UInt64) {
        guard let path = _framesDiskPath else { return }
        let framePath = path.appendingPathComponent("\(timestamp).jpeg")
        try? jpeg.write(to: framePath)
    }
    
    private func _flushBufferToDisk() {
        // Package any frames still in memory to disk
        _stateLock.lock()
        let frames = _screenshots
        _stateLock.unlock()
        
        guard !frames.isEmpty, let path = _framesDiskPath else { return }
        
        for (jpeg, timestamp) in frames {
            let framePath = path.appendingPathComponent("\(timestamp).jpeg")
            if !FileManager.default.fileExists(atPath: framePath.path) {
                try? jpeg.write(to: framePath)
            }
        }
    }
    
    /// Load and upload any pending frames from disk for a session
    @objc public func uploadPendingFrames(sessionId: String) {
        guard let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let framesPath = cacheDir.appendingPathComponent("rj_pending").appendingPathComponent(sessionId).appendingPathComponent("frames")
        
        guard let frameFiles = try? FileManager.default.contentsOfDirectory(at: framesPath, includingPropertiesForKeys: nil) else { return }
        
        var frames: [(Data, UInt64)] = []
        for file in frameFiles.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            guard file.pathExtension == "jpeg",
                  let data = try? Data(contentsOf: file) else { continue }
            
            // Try to parse timestamp from filename
            let filename = file.deletingPathExtension().lastPathComponent
            let ts = UInt64(filename) ?? 0
            guard ts > 0 else { continue }
            
            frames.append((data, ts))
        }
        
        guard !frames.isEmpty, let bundle = _packageFrameBundle(images: frames, sessionEpoch: frames.first?.1 ?? 0) else { return }
        
        let endTs = frames.last?.1 ?? 0
        let fname = "\(sessionId)-\(endTs).tar.gz"
        
        TelemetryPipeline.shared.submitFrameBundle(
            payload: bundle,
            filename: fname,
            startMs: frames.first?.1 ?? 0,
            endMs: endTs,
            frameCount: frames.count
        )
    }
    
    /// Clear pending frames for a session after successful upload
    @objc public func clearPendingFrames(sessionId: String) {
        guard let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let framesPath = cacheDir.appendingPathComponent("rj_pending").appendingPathComponent(sessionId).appendingPathComponent("frames")
        try? FileManager.default.removeItem(at: framesPath)
    }
    
    private func _flushBuffer() {
        _stateLock.lock()
        let frames = _screenshots
        _screenshots.removeAll()
        _stateLock.unlock()
        
        guard !frames.isEmpty else { return }
        
        // Clear the disk copies since we're uploading
        if let path = _framesDiskPath {
            for (_, timestamp) in frames {
                let framePath = path.appendingPathComponent("\(timestamp).jpeg")
                try? FileManager.default.removeItem(at: framePath)
            }
        }
        
        guard let bundle = _packageFrameBundle(images: frames, sessionEpoch: _sessionEpoch) else { return }
        
        let rid = TelemetryPipeline.shared.currentReplayId ?? "unknown"
        let endTs = frames.last?.1 ?? _sessionEpoch
        let fname = "\(rid)-\(endTs).tar.gz"
        
        // No main thread dispatch - submit directly (fixes stutter)
        TelemetryPipeline.shared.submitFrameBundle(
            payload: bundle,
            filename: fname,
            startMs: frames.first?.1 ?? _sessionEpoch,
            endMs: endTs,
            frameCount: frames.count
        )
    }
    
    private func _packageFrameBundle(images: [(Data, UInt64)], sessionEpoch: UInt64) -> Data? {
        var archive = Data()
        
        for (jpeg, timestamp) in images {
            let name = "\(sessionEpoch)_1_\(timestamp).jpeg"
            archive.append(_tarHeader(name: name, size: jpeg.count))
            archive.append(jpeg)
            let padding = (512 - (jpeg.count % 512)) % 512
            if padding > 0 { archive.append(Data(repeating: 0, count: padding)) }
        }
        
        archive.append(Data(repeating: 0, count: 1024))
        return archive.gzipCompress()
    }
    
    private func _tarHeader(name: String, size: Int) -> Data {
        var h = Data(count: 512)
        if let nd = name.data(using: .utf8) { h.replaceSubrange(0..<min(100, nd.count), with: nd.prefix(100)) }
        "0000644\0".data(using: .utf8).map { h.replaceSubrange(100..<108, with: $0) }
        let z = "0000000\0".data(using: .utf8)!
        h.replaceSubrange(108..<124, with: z + z)
        String(format: "%011o\0", size).data(using: .utf8).map { h.replaceSubrange(124..<136, with: $0) }
        String(format: "%011o\0", Int(Date().timeIntervalSince1970)).data(using: .utf8).map { h.replaceSubrange(136..<148, with: $0) }
        h[156] = 0x30
        "        ".data(using: .utf8).map { h.replaceSubrange(148..<156, with: $0) }
        let sum = h.reduce(0) { $0 + Int($1) }
        String(format: "%06o\0 ", sum).data(using: .utf8).map { h.replaceSubrange(148..<156, with: $0) }
        return h
    }
}

private enum CaptureState { case idle, capturing, halted }

private final class CaptureStateMachine {
    private var _state: CaptureState = .idle
    private let _lock = NSLock()
    
    var currentState: CaptureState {
        _lock.lock()
        defer { _lock.unlock() }
        return _state
    }
    
    func transition(to target: CaptureState) -> Bool {
        _lock.lock()
        defer { _lock.unlock() }
        switch (_state, target) {
        case (.idle, .capturing), (.halted, .capturing), (.capturing, .halted):
            _state = target
            return true
        default:
            return _state == target
        }
    }
}

private final class RedactionMask {
    private var _explicitViews = NSHashTable<UIView>.weakObjects()
    private let _lock = NSLock()
    
    // Cache the hierarchy scan results to avoid scanning every frame.
    // The full recursive scan runs String(describing: type(of:)) reflection
    // on every view in the key window, which is expensive in React Native
    // hierarchies (thousands of views). Caching for ~1s is safe because
    // sensitive views (text inputs, cameras) don't appear/disappear at 3fps.
    private var _cachedAutoRects: [CGRect] = []
    private var _lastScanTime: CFAbsoluteTime = 0
    private let _scanCacheDurationSec: CFAbsoluteTime = 1.0
    
    // View class names that should always be masked (privacy sensitive)
    private let _sensitiveClassNames: Set<String> = [
        // Camera views
        "AVCaptureVideoPreviewLayer",
        "CameraView",
        "RCTCameraView",
        "ExpoCamera",
        "EXCameraView",
        // React Native text inputs (internal class names)
        "RCTSinglelineTextInputView",
        "RCTMultilineTextInputView", 
        "RCTTextInput",
        "RCTBaseTextInputView",
        "RCTUITextField",
        // Expo text inputs
        "EXTextInput"
    ]
    
    func add(_ view: UIView) {
        _lock.lock()
        defer { _lock.unlock() }
        _explicitViews.add(view)
    }
    
    func remove(_ view: UIView) {
        _lock.lock()
        defer { _lock.unlock() }
        _explicitViews.remove(view)
    }
    
    func computeRects() -> [CGRect] {
        _lock.lock()
        let explicitViews = _explicitViews.allObjects
        _lock.unlock()
        
        var rects: [CGRect] = []
        rects.reserveCapacity(explicitViews.count + 20)
        
        // 1. Add explicitly registered views (always fresh — these are few)
        for v in explicitViews {
            if let rect = _viewRect(v) {
                rects.append(rect)
            }
        }
        
        // 2. Auto-detect sensitive views from a cached hierarchy scan.
        //    The full recursive scan is expensive (String(describing:) reflection
        //    on every view) so we cache results for ~1s. Explicit views above
        //    are always re-evaluated, so newly focused inputs still get masked.
        let now = CFAbsoluteTimeGetCurrent()
        if now - _lastScanTime >= _scanCacheDurationSec {
            _cachedAutoRects.removeAll()
            if let window = _keyWindow() {
                _scanForSensitiveViews(in: window, rects: &_cachedAutoRects)
            }
            _lastScanTime = now
        }
        rects.append(contentsOf: _cachedAutoRects)
        
        return rects
    }
    
    private func _viewRect(_ v: UIView) -> CGRect? {
        guard let w = v.window else { return nil }
        
        // Skip views in non-key windows (keyboard windows, system windows).
        // These have transitional layer transforms during animation that cause
        // UIView.convert() to pass NaN to CoreGraphics internally, producing
        // "invalid numeric value (NaN)" errors that we cannot catch because
        // CoreGraphics logs the error before the return value is available.
        if !w.isKeyWindow { return nil }
        
        // Guard against views with invalid bounds before conversion
        let viewBounds = v.bounds
        guard viewBounds.width > 0 && viewBounds.height > 0 else { return nil }
        guard viewBounds.width.isFinite && viewBounds.height.isFinite else { return nil }
        guard !viewBounds.width.isNaN && !viewBounds.height.isNaN else { return nil }
        guard viewBounds.origin.x.isFinite && viewBounds.origin.y.isFinite else { return nil }
        guard !viewBounds.origin.x.isNaN && !viewBounds.origin.y.isNaN else { return nil }
        
        // During animation, convert() internally passes NaN to CoreGraphics
        // which logs an error even though we guard the output. Skip animated views.
        if v.layer.animationKeys()?.isEmpty == false {
            return nil
        }
        
        // Also check the view's layer transform — keyboard views during transition
        // can have a transform with NaN or degenerate values that cause convert()
        // to produce NaN internally in CoreGraphics before we can catch the result.
        let t = v.layer.transform
        if t.m11.isNaN || t.m22.isNaN || t.m33.isNaN || t.m44.isNaN ||
           t.m41.isNaN || t.m42.isNaN || t.m43.isNaN {
            return nil
        }
        // Degenerate transform (scale=0) will produce zero-area results
        if t.m11 == 0 && t.m22 == 0 {
            return nil
        }
        
        // Also check the window's transform for safety (keyboard windows can have odd transforms)
        let wt = w.layer.transform
        if wt.m11.isNaN || wt.m22.isNaN || wt.m41.isNaN || wt.m42.isNaN {
            return nil
        }
        
        let r = v.convert(viewBounds, to: w)
        // Guard against NaN and invalid values that cause CoreGraphics errors
        guard r.width > 0 && r.height > 0 else { return nil }
        guard !r.origin.x.isNaN && !r.origin.y.isNaN && !r.width.isNaN && !r.height.isNaN else { return nil }
        guard r.origin.x.isFinite && r.origin.y.isFinite && r.width.isFinite && r.height.isFinite else { return nil }
        return r
    }
    
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
    
    private func _scanForSensitiveViews(in view: UIView, rects: inout [CGRect], depth: Int = 0) {
        // Limit recursion depth to avoid scanning deep hierarchies
        guard depth < 20 else { return }
        
        // Skip hidden, transparent, or zero-sized views entirely
        guard !view.isHidden && view.alpha > 0.01 else { return }
        guard view.bounds.width > 0 && view.bounds.height > 0 else { return }
        
        // Skip keyboard windows entirely — their internal views have
        // transitional frames during animation that produce NaN when
        // converted via UIView.convert(_:to:), causing CoreGraphics
        // "invalid numeric value (NaN)" errors. Keyboard content is
        // not meaningful for session replay and is never recorded.
        let className = String(describing: type(of: view))
        if className.contains("UIRemoteKeyboardWindow") ||
           className.contains("UITextEffectsWindow") ||
           className.contains("UIInputSetHostView") ||
           className.contains("UIKeyboard") {
            return
        }
        
        // Check if this view should be masked
        if _shouldMask(view), let rect = _viewRect(view) {
            rects.append(rect)
            return // Don't scan children - parent mask covers them
        }
        
        // Recurse into subviews
        for subview in view.subviews {
            _scanForSensitiveViews(in: subview, rects: &rects, depth: depth + 1)
        }
    }
    
    private func _shouldMask(_ view: UIView) -> Bool {
        // 1. Mask ALL text input fields by default (privacy first)
        // This includes password fields, instructions, notes, etc.
        if view is UITextField {
            return true
        }
        
        // 2. Mask ALL text views (multiline inputs like instructions, notes, etc.)
        if view is UITextView {
            return true
        }
        
        // 3. Check class name against known sensitive types
        let className = String(describing: type(of: view))
        if _sensitiveClassNames.contains(className) {
            return true
        }
        
        // 4. Check if class name contains camera-related keywords
        let lowerClassName = className.lowercased()
        if lowerClassName.contains("camera") || lowerClassName.contains("preview") {
            // Verify it's actually a camera preview, not just any view with "camera" in name
            if lowerClassName.contains("video") || lowerClassName.contains("capture") || 
               lowerClassName.contains("avcapture") || view.layer is AVCaptureVideoPreviewLayer {
                return true
            }
        }
        
        // 5. Check layer type for camera preview layers
        if view.layer.sublayers?.contains(where: { $0 is AVCaptureVideoPreviewLayer }) == true {
            return true
        }
        
        return false
    }
}
