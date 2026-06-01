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
import CoreImage

private enum MediaMaskKind {
    case image
    case video
}

private enum RedactionMaskKind {
    case generic
    case textInput
}

private struct MediaMaskRegion {
    let rect: CGRect
    let kind: MediaMaskKind
}

private struct RedactionRegion {
    let rect: CGRect
    let kind: RedactionMaskKind
}

private struct VideoLayerRegion {
    let layerBoundsRect: CGRect
    let clipRect: CGRect
}

@objc(RJNativeVisualCapture)
final class VisualCapture: NSObject {
    
    @objc static let shared = VisualCapture()
    
    @objc var snapshotInterval: Double = 1.0
    @objc var quality: CGFloat = 0.5
    /// Capture scale (e.g. 1.25 = capture at 80% linear size). Matches Android for parity; reduces JPEG size.
    @objc var captureScale: CGFloat = 1.25
    
    @objc var isCapturing: Bool {
        _stateMachine.currentState == .capturing
    }
    
    private let _stateMachine = CaptureStateMachine()
    private var _screenshots: [(Data, UInt64)] = []
    private let _stateLock = NSLock()
    private var _captureTimer: Timer?
    private var _frameCounter: UInt64 = 0
    private var _sessionEpoch: UInt64 = 0
    private var _redactionMask: RedactionMask
    private var _framesDiskPath: URL?
    private var _currentSessionId: String?
    private let _ciContext = CIContext(options: nil)
    private var _videoOutputs: [ObjectIdentifier: AVPlayerItemVideoOutput] = [:]
    private var _videoFrameGenerators: [ObjectIdentifier: AVAssetImageGenerator] = [:]
    private let _placeholderFillColor = UIColor.white
    private let _placeholderForegroundColor = UIColor(red: 15 / 255, green: 23 / 255, blue: 42 / 255, alpha: 0.86)
    private let _maxVideoLayerScanDepth = 120
    @objc private(set) var captureGeneration: Int = 0
    // Skip drawHierarchy while the keyboard is animating in/out — calling
    // drawHierarchy during a keyboard transition causes UIKit to stall the
    // main thread (observed 7+ seconds) while it resolves conflicting layout
    // constraints between the keyboard window and the app window.
    private var _isKeyboardTransitioning: Bool = false
    private var _isKeyboardVisible: Bool = false
    private var _keyboardPlaceholderRect: CGRect?
    private var _keyboardCaptureResumeTime: CFAbsoluteTime = 0
    private let _keyboardQuietDelaySec: CFAbsoluteTime = 0.45
    
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
    
    /// Flush to the network after this many frames (smaller = more frequent uploads).
    private var _uploadBatchSize = 3

    
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
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(_handleKeyboardWillShow(_:)),
            name: UIResponder.keyboardWillShowNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(_handleKeyboardWillHide(_:)),
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(_handleKeyboardDidShow(_:)),
            name: UIResponder.keyboardDidShowNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(_handleKeyboardDidHide),
            name: UIResponder.keyboardDidHideNotification,
            object: nil
        )
    }
    
    @objc private func _handleKeyboardWillShow(_ notification: Notification) {
        _isKeyboardTransitioning = true
        _isKeyboardVisible = true
        _keyboardPlaceholderRect = _keyboardPlaceholderRect(from: notification)
        _keyboardCaptureResumeTime = CFAbsoluteTimeGetCurrent() + _keyboardQuietDelaySec
        _redactionMask.invalidateCache()
    }

    @objc private func _handleKeyboardWillHide(_ notification: Notification) {
        _isKeyboardTransitioning = true
        _keyboardPlaceholderRect = nil
        _keyboardCaptureResumeTime = CFAbsoluteTimeGetCurrent() + _keyboardQuietDelaySec
        _redactionMask.invalidateCache()
    }

    @objc private func _handleKeyboardDidShow(_ notification: Notification) {
        _isKeyboardTransitioning = false
        _isKeyboardVisible = true
        _keyboardPlaceholderRect = _keyboardPlaceholderRect(from: notification) ?? _keyboardPlaceholderRect
        _keyboardCaptureResumeTime = CFAbsoluteTimeGetCurrent() + _keyboardQuietDelaySec
        _redactionMask.invalidateCache()

        if _stateMachine.currentState == .capturing {
            DispatchQueue.main.asyncAfter(deadline: .now() + _keyboardQuietDelaySec) { [weak self] in
                self?._captureFrame(forced: true)
            }
        }
    }

    @objc private func _handleKeyboardDidHide() {
        _isKeyboardTransitioning = false
        _isKeyboardVisible = false
        _keyboardPlaceholderRect = nil
        _keyboardCaptureResumeTime = CFAbsoluteTimeGetCurrent() + _keyboardQuietDelaySec
        _redactionMask.invalidateCache()

        if _stateMachine.currentState == .capturing {
            DispatchQueue.main.asyncAfter(deadline: .now() + _keyboardQuietDelaySec) { [weak self] in
                self?._captureFrame(forced: true)
            }
        }
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
    
    @objc func beginCapture(sessionOrigin: UInt64) {
        // If still in CAPTURING state (halt() from previous session hasn't
        // run yet), force-halt first to prevent it from stopping the new session.
        if _stateMachine.currentState == .capturing {
            DiagnosticLog.trace("[VisualCapture] Force-halting stale capture before starting new session")
            _stopCaptureTimer()
            _ = _stateMachine.transition(to: .halted)
        }

        guard _stateMachine.transition(to: .capturing) else { return }

        // Bump generation so any stale halt() becomes a no-op
        captureGeneration += 1

        // Discard leftover frames from the previous session
        _stateLock.lock()
        let staleCount = _screenshots.count
        if staleCount > 0 {
            DiagnosticLog.trace("[VisualCapture] Clearing \(staleCount) stale frames from previous session")
            _screenshots.removeAll()
        }
        _stateLock.unlock()

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
    
    @objc func halt(expectedGeneration: Int = -1) {
        // If a specific generation is expected (async/posted halt from a previous
        // session), skip if a new session has already started capture.
        if expectedGeneration >= 0 && expectedGeneration != captureGeneration {
            DiagnosticLog.trace("[VisualCapture] Skipping stale halt (gen=\(expectedGeneration), current=\(captureGeneration))")
            return
        }
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
    @objc func flushToDisk() {
        _flushBufferToDisk()
    }
    
    /// Submit any buffered frames to the upload pipeline immediately
    /// (regardless of batch size threshold). Packages synchronously to
    /// avoid race conditions during backgrounding.
    @objc func flushBufferToNetwork() {
        _flushBuffer()
    }

    /// Blocks the calling thread until all pending encode operations finish.
    /// Used by the shutdown drain path to ensure frame bundles are enqueued
    /// in TelemetryPipeline._frameQueue before _shipPendingFrames runs.
    @objc func waitForEncodingToComplete() {
        _encodeQueue.waitUntilAllOperationsAreFinished()
    }
    
    @objc func registerRedaction(_ view: UIView) {
        _redactionMask.add(view)
    }
    
    @objc func unregisterRedaction(_ view: UIView) {
        _redactionMask.remove(view)
    }
    
    @objc func invalidateMaskCache() {
        _redactionMask.invalidateCache()
    }

    
    @objc func configure(snapshotInterval: Double, jpegQuality: Double, captureScale: CGFloat = 1.25, uploadBatchSize: Int = 3) {
        self.snapshotInterval = snapshotInterval
        self.quality = CGFloat(jpegQuality)
        self.captureScale = max(1.0, captureScale)
        _uploadBatchSize = max(1, min(uploadBatchSize, 100))
        if _stateMachine.currentState == .capturing {
            _stopCaptureTimer()
            _startCaptureTimer()
        }
    }
    
    @objc func snapshotNow() {
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
        
        // Refresh map detection state (very cheap shallow walk)
        SpecialCases.shared.refreshMapState()
        
        if _frameCounter < 5 || _frameCounter % 30 == 0 {
            var info = mach_task_basic_info()
            var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
            let _ = withUnsafeMutablePointer(to: &info) {
                $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                    task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
                }
            }
            let memMB = Double(info.resident_size) / 1_048_576.0
            DiagnosticLog.trace("[VisualCapture] frame#\(_frameCounter) mapVisible=\(SpecialCases.shared.mapVisible) mapIdle=\(SpecialCases.shared.mapIdle) forced=\(forced) residentMB=\(String(format: "%.0f", memMB))")
        }
        
        // Map stutter prevention: when a map view is visible and its camera
        // is still moving (user gesture or animation), skip drawHierarchy
        // entirely — this is the call that causes GPU readback stutter on
        // Metal/OpenGL-backed map tiles.  We resume capture at 1 FPS once
        // the map SDK reports idle.
        if !forced && SpecialCases.shared.mapVisible && !SpecialCases.shared.mapIdle {
            DiagnosticLog.trace("[VisualCapture] SKIPPING frame (map moving)")
            return
        }
        
        // Capture the pixel buffer on the main thread (required by UIKit),
        // then move JPEG compression to the encode queue to reduce main-thread blocking.
        autoreleasepool {
            guard let window = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap({ $0.windows })
                .first(where: { $0.isKeyWindow }) else { return }
            let bounds = window.bounds
            // Guard against NaN and invalid bounds that cause CoreGraphics errors
            guard bounds.width > 0, bounds.height > 0 else { return }
            guard !bounds.width.isNaN && !bounds.height.isNaN else { return }
            guard bounds.width.isFinite && bounds.height.isFinite else { return }

            let captureWindows = _captureWindows(primary: window)
            let redactionRegions = _redactionMask.computeRegions(windows: captureWindows)
            let cameraRects = _cameraMaskRects(windows: captureWindows)
            let mediaRegions = ReplayOrchestrator.shared.maskImagesAndVideosByDefault ? _mediaMaskRegions(windows: captureWindows) : []
            let scale = max(1.0, captureScale)
            let scaledSize = CGSize(width: bounds.width / scale, height: bounds.height / scale)
            guard scaledSize.width >= 1, scaledSize.height >= 1 else {
                return
            }
            
            UIGraphicsBeginImageContextWithOptions(scaledSize, false, 1.0)
            guard let context = UIGraphicsGetCurrentContext() else {
                UIGraphicsEndImageContext()
                return
            }
            context.scaleBy(x: 1.0 / scale, y: 1.0 / scale)
            for captureWindow in captureWindows {
                let drawRect = captureWindow === window ? bounds : captureWindow.frame
                captureWindow.drawHierarchy(in: drawRect, afterScreenUpdates: false)
                if !ReplayOrchestrator.shared.maskImagesAndVideosByDefault {
                    _compositeVideoLayers(in: captureWindow, context: context, snapshotScale: scale)
                }
            }
            
            // Apply redactions inline while context is open
            if !redactionRegions.isEmpty {
                for region in redactionRegions {
                    let r = region.rect
                    // Skip invalid rects that could cause CoreGraphics errors
                    guard r.width > 0 && r.height > 0 else { continue }
                    guard r.origin.x.isFinite && r.origin.y.isFinite && r.width.isFinite && r.height.isFinite else { continue }
                    guard !r.origin.x.isNaN && !r.origin.y.isNaN && !r.width.isNaN && !r.height.isNaN else { continue }
                    context.setFillColor(_placeholderFillColor(for: region.kind).cgColor)
                    context.fill(r)
                    if region.kind == .textInput {
                        _drawTextInputMaskIndicator(in: r)
                    } else if region.kind == .generic {
                        _drawGenericMaskIndicator(in: r)
                    }
                }
            }

            if !cameraRects.isEmpty {
                context.setFillColor(_placeholderFillColor.cgColor)
                for r in cameraRects {
                    guard r.width > 0 && r.height > 0 else { continue }
                    guard r.origin.x.isFinite && r.origin.y.isFinite && r.width.isFinite && r.height.isFinite else { continue }
                    guard !r.origin.x.isNaN && !r.origin.y.isNaN && !r.width.isNaN && !r.height.isNaN else { continue }
                    context.fill(r)
                    _drawCameraMaskIndicator(in: r, context: context)
                }
            }

            if !mediaRegions.isEmpty {
                context.setFillColor(_placeholderFillColor.cgColor)
                for region in mediaRegions {
                    let r = region.rect
                    guard r.width > 0 && r.height > 0 else { continue }
                    guard r.origin.x.isFinite && r.origin.y.isFinite && r.width.isFinite && r.height.isFinite else { continue }
                    guard !r.origin.x.isNaN && !r.origin.y.isNaN && !r.width.isNaN && !r.height.isNaN else { continue }
                    context.fill(r)
                    _drawMediaMaskIndicator(in: r, kind: region.kind, context: context)
                }
            }

            _drawKeyboardPlaceholderIfNeeded(in: context, window: window)
            
            guard let image = UIGraphicsGetImageFromCurrentImageContext() else {
                UIGraphicsEndImageContext()
                return
            }
            UIGraphicsEndImageContext()
            
            let captureTs = UInt64(Date().timeIntervalSince1970 * 1000)
            _frameCounter += 1
            let frameNumber = _frameCounter
            let jpegQuality = quality
            let generation = captureGeneration
            
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
                guard generation == self.captureGeneration, self._stateMachine.currentState == .capturing else {
                    self._stateLock.unlock()
                    return
                }
                self._screenshots.append((data, captureTs))
                self._enforceScreenshotCaps()
                let count = self._screenshots.count
                let shouldSend = forced || count >= self._uploadBatchSize
                // Time-based flush: if frames have been sitting for longer than one full
                // batch interval, send regardless of count. This ensures sessions that end
                // before reaching uploadBatchSize frames (very short sessions) still ship
                // their frames promptly rather than waiting for shutdown.
                let shouldFlushByTime: Bool
                if !shouldSend, count > 0, let oldestTs = self._screenshots.first?.1 {
                    let waitMs = captureTs > oldestTs ? captureTs - oldestTs : 0
                    let thresholdMs = UInt64(Double(self._uploadBatchSize) * self.snapshotInterval * 1_000)
                    shouldFlushByTime = waitMs >= thresholdMs
                } else {
                    shouldFlushByTime = false
                }
                self._stateLock.unlock()

                if shouldSend || shouldFlushByTime {
                    self._sendScreenshots()
                }
            }
        }
    }

    private func _captureWindows(primary: UIWindow) -> [UIWindow] {
        guard ReplayOrchestrator.shared.captureNativeSheets else {
            return [primary]
        }

        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .filter { window in
                if window.isHidden || window.alpha <= 0.01 || window.bounds.width <= 0 || window.bounds.height <= 0 {
                    return false
                }
                if window === primary {
                    return true
                }
                let className = String(describing: type(of: window))
                if _isKeyboardOrTextInputWindow(className) {
                    return false
                }
                return window.screen == primary.screen
            }
            .sorted { lhs, rhs in
                if lhs === rhs {
                    return false
                }
                if lhs === primary {
                    return true
                }
                if rhs === primary {
                    return false
                }
                if lhs.windowLevel == rhs.windowLevel {
                    return ObjectIdentifier(lhs).hashValue < ObjectIdentifier(rhs).hashValue
                }
                return lhs.windowLevel.rawValue < rhs.windowLevel.rawValue
            }

        return windows.contains(where: { $0 === primary }) ? windows : [primary] + windows
    }

    private func _isKeyboardOrTextInputWindow(_ className: String) -> Bool {
        className.contains("UIRemoteKeyboardWindow") ||
        className.contains("UITextEffectsWindow") ||
        className.contains("UIInputSetHostView") ||
        className.contains("UIKeyboard")
    }

    private func _keyWindow() -> UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first(where: { $0.isKeyWindow })
    }

    private func _keyboardPlaceholderRect(from notification: Notification) -> CGRect? {
        guard let screenFrame = (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else {
            return nil
        }

        guard let window = _keyWindow() else {
            return screenFrame.width > 0 && screenFrame.height > 0 ? screenFrame : nil
        }

        let windowFrame = window.convert(screenFrame, from: window.screen.coordinateSpace)
        let clipped = windowFrame.intersection(window.bounds)
        guard clipped.width > 0, clipped.height > 0 else { return nil }
        guard clipped.origin.x.isFinite, clipped.origin.y.isFinite, clipped.width.isFinite, clipped.height.isFinite else { return nil }
        guard !clipped.origin.x.isNaN, !clipped.origin.y.isNaN, !clipped.width.isNaN, !clipped.height.isNaN else { return nil }
        return clipped
    }

    private func _keyboardPlaceholderRect(in window: UIWindow) -> CGRect? {
        guard let rect = _keyboardPlaceholderRect else { return nil }
        let clipped = rect.intersection(window.bounds)
        guard clipped.width > 0, clipped.height > 0 else { return nil }
        guard clipped.origin.x.isFinite, clipped.origin.y.isFinite, clipped.width.isFinite, clipped.height.isFinite else { return nil }
        guard !clipped.origin.x.isNaN, !clipped.origin.y.isNaN, !clipped.width.isNaN, !clipped.height.isNaN else { return nil }
        return clipped
    }

    private func _drawKeyboardPlaceholderIfNeeded(in context: CGContext, window: UIWindow) {
        guard let rect = _keyboardPlaceholderRect(in: window) else { return }

        context.saveGState()
        context.setFillColor(_placeholderFillColor.cgColor)
        context.fill(rect)
        _drawKeyboardPlaceholderLabel(in: rect)
        context.restoreGState()
    }

    private func _placeholderFillColor(for kind: RedactionMaskKind) -> UIColor {
        switch kind {
        case .textInput:
            return _placeholderFillColor
        case .generic:
            return _placeholderFillColor
        }
    }

    private func _drawGenericMaskIndicator(in rect: CGRect) {
        guard rect.width >= 36, rect.height >= 20 else { return }

        let label = "Mask" as NSString
        let horizontalPadding = CGFloat(8)
        var fontSize = min(CGFloat(18), max(CGFloat(10), rect.height * 0.34))
        var attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: fontSize, weight: .semibold),
            .foregroundColor: UIColor.black
        ]
        var textSize = label.size(withAttributes: attributes)
        while textSize.width > rect.width - horizontalPadding * 2, fontSize > 8 {
            fontSize -= 1
            attributes[.font] = UIFont.systemFont(ofSize: fontSize, weight: .semibold)
            textSize = label.size(withAttributes: attributes)
        }
        guard textSize.width <= rect.width - horizontalPadding * 2 else { return }

        let textRect = CGRect(
            x: rect.midX - textSize.width / 2,
            y: rect.midY - textSize.height / 2,
            width: textSize.width,
            height: textSize.height
        )
        label.draw(in: textRect, withAttributes: attributes)
    }

    private func _drawKeyboardPlaceholderLabel(in rect: CGRect) {
        guard rect.width >= 56, rect.height >= 36 else { return }

        // Product compatibility note: camera/image/video masks use icons, but
        // the keyboard placeholder is intentionally text-only. That keeps
        // replays consistent across old Swift 0.2.x recordings and newer
        // backend/dashboard renders where the keyboard itself is never captured.
        let label = "Keyboard" as NSString
        let fontSize = min(CGFloat(34), max(CGFloat(16), rect.height * 0.12))
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: fontSize, weight: .semibold),
            .foregroundColor: _placeholderForegroundColor
        ]
        let textSize = label.size(withAttributes: attributes)
        let textRect = CGRect(
            x: rect.midX - textSize.width / 2,
            y: rect.midY - textSize.height / 2,
            width: textSize.width,
            height: textSize.height
        )
        label.draw(in: textRect, withAttributes: attributes)
    }

    private func _drawTextInputMaskIndicator(in rect: CGRect) {
        guard rect.width >= 48, rect.height >= 24 else { return }

        let label = "Txt Input" as NSString
        let horizontalPadding = CGFloat(8)
        var fontSize = min(CGFloat(18), max(CGFloat(10), rect.height * 0.34))
        var attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: fontSize, weight: .semibold),
            .foregroundColor: UIColor.black
        ]
        var textSize = label.size(withAttributes: attributes)
        while textSize.width > rect.width - horizontalPadding * 2, fontSize > 8 {
            fontSize -= 1
            attributes[.font] = UIFont.systemFont(ofSize: fontSize, weight: .semibold)
            textSize = label.size(withAttributes: attributes)
        }
        guard textSize.width <= rect.width - horizontalPadding * 2 else { return }

        let textRect = CGRect(
            x: rect.midX - textSize.width / 2,
            y: rect.midY - textSize.height / 2,
            width: textSize.width,
            height: textSize.height
        )
        label.draw(in: textRect, withAttributes: attributes)
    }

    private func _drawCameraMaskIndicator(in rect: CGRect, context: CGContext) {
        let minSide = min(rect.width, rect.height)
        guard minSide >= 36 else { return }

        let iconSize = min(CGFloat(64), max(CGFloat(28), minSide * 0.24))
        let bodyWidth = iconSize
        let bodyHeight = iconSize * 0.62
        let body = CGRect(
            x: rect.midX - bodyWidth / 2,
            y: rect.midY - bodyHeight / 2,
            width: bodyWidth,
            height: bodyHeight
        )
        let lineWidth = max(CGFloat(2), iconSize * 0.06)

        context.saveGState()
        _placeholderForegroundColor.setStroke()
        _placeholderForegroundColor.setFill()

        let bodyPath = UIBezierPath(roundedRect: body, cornerRadius: max(CGFloat(4), iconSize * 0.1))
        bodyPath.lineWidth = lineWidth
        bodyPath.stroke()

        let bump = CGRect(
            x: body.minX + iconSize * 0.18,
            y: body.minY - iconSize * 0.13,
            width: iconSize * 0.24,
            height: iconSize * 0.18
        )
        let bumpPath = UIBezierPath(roundedRect: bump, cornerRadius: max(CGFloat(2), iconSize * 0.04))
        bumpPath.lineWidth = lineWidth
        bumpPath.stroke()

        let lensRadius = iconSize * 0.16
        let lens = CGRect(
            x: rect.midX - lensRadius,
            y: rect.midY - lensRadius,
            width: lensRadius * 2,
            height: lensRadius * 2
        )
        let lensPath = UIBezierPath(ovalIn: lens)
        lensPath.lineWidth = lineWidth
        lensPath.stroke()

        let dotRadius = max(CGFloat(1.6), iconSize * 0.035)
        let dot = CGRect(
            x: body.maxX - iconSize * 0.2 - dotRadius,
            y: body.minY + iconSize * 0.16 - dotRadius,
            width: dotRadius * 2,
            height: dotRadius * 2
        )
        UIBezierPath(ovalIn: dot).fill()
        context.restoreGState()
    }

    private func _drawMediaMaskIndicator(in rect: CGRect, kind: MediaMaskKind, context: CGContext) {
        guard rect.width >= 56, rect.height >= 36 else { return }

        let label = (kind == .video ? "Video masked" : "Image masked") as NSString
        let fontSize = min(CGFloat(18), max(CGFloat(11), min(rect.width, rect.height) * 0.12))
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: fontSize, weight: .semibold),
            .foregroundColor: _placeholderForegroundColor
        ]
        let textSize = label.size(withAttributes: attributes)
        let iconSize = min(CGFloat(34), max(CGFloat(18), rect.height * 0.22))
        let showText = rect.width >= iconSize + 8 + textSize.width + 16
        let totalWidth = showText ? iconSize + 8 + textSize.width : iconSize
        let startX = rect.midX - totalWidth / 2
        let centerY = rect.midY
        let iconRect = CGRect(x: startX, y: centerY - iconSize / 2, width: iconSize, height: iconSize)

        context.saveGState()
        if kind == .video {
            _drawVideoIcon(in: iconRect)
        } else {
            _drawImageIcon(in: iconRect)
        }

        if showText {
            let textRect = CGRect(
                x: iconRect.maxX + 8,
                y: centerY - textSize.height / 2,
                width: textSize.width,
                height: textSize.height
            )
            label.draw(in: textRect, withAttributes: attributes)
        }
        context.restoreGState()
    }

    private func _drawImageIcon(in rect: CGRect) {
        _placeholderForegroundColor.setStroke()
        _placeholderForegroundColor.setFill()
        let lineWidth = max(CGFloat(1.8), rect.width * 0.08)
        let framePath = UIBezierPath(roundedRect: rect.insetBy(dx: lineWidth / 2, dy: lineWidth / 2), cornerRadius: max(CGFloat(3), rect.width * 0.12))
        framePath.lineWidth = lineWidth
        framePath.stroke()

        let dotRadius = max(CGFloat(1.8), rect.width * 0.08)
        let dot = CGRect(
            x: rect.minX + rect.width * 0.72 - dotRadius,
            y: rect.minY + rect.height * 0.28 - dotRadius,
            width: dotRadius * 2,
            height: dotRadius * 2
        )
        UIBezierPath(ovalIn: dot).fill()

        let mountainPath = UIBezierPath()
        mountainPath.move(to: CGPoint(x: rect.minX + rect.width * 0.18, y: rect.maxY - rect.height * 0.2))
        mountainPath.addLine(to: CGPoint(x: rect.minX + rect.width * 0.42, y: rect.minY + rect.height * 0.52))
        mountainPath.addLine(to: CGPoint(x: rect.minX + rect.width * 0.55, y: rect.minY + rect.height * 0.66))
        mountainPath.addLine(to: CGPoint(x: rect.minX + rect.width * 0.72, y: rect.minY + rect.height * 0.46))
        mountainPath.addLine(to: CGPoint(x: rect.maxX - rect.width * 0.14, y: rect.maxY - rect.height * 0.2))
        mountainPath.lineWidth = lineWidth
        mountainPath.lineJoinStyle = .round
        mountainPath.stroke()
    }

    private func _drawVideoIcon(in rect: CGRect) {
        _placeholderForegroundColor.setStroke()
        _placeholderForegroundColor.setFill()
        let lineWidth = max(CGFloat(1.8), rect.width * 0.08)
        let body = CGRect(
            x: rect.minX,
            y: rect.minY + rect.height * 0.18,
            width: rect.width * 0.66,
            height: rect.height * 0.64
        ).insetBy(dx: lineWidth / 2, dy: lineWidth / 2)
        let bodyPath = UIBezierPath(roundedRect: body, cornerRadius: max(CGFloat(3), rect.width * 0.1))
        bodyPath.lineWidth = lineWidth
        bodyPath.stroke()

        let lensPath = UIBezierPath()
        lensPath.move(to: CGPoint(x: body.maxX + lineWidth / 2, y: rect.midY - rect.height * 0.18))
        lensPath.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + rect.height * 0.26))
        lensPath.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - rect.height * 0.26))
        lensPath.addLine(to: CGPoint(x: body.maxX + lineWidth / 2, y: rect.midY + rect.height * 0.18))
        lensPath.close()
        lensPath.fill()
    }

    private func _cameraMaskRects(windows: [UIWindow]) -> [CGRect] {
        var rects: [CGRect] = []
        for window in windows {
            _scanForCameraViews(in: window, rects: &rects)
        }
        return rects
    }

    private func _scanForCameraViews(in view: UIView, rects: inout [CGRect], depth: Int = 0) {
        guard depth < 60 else { return }
        guard !view.isHidden, view.alpha > 0.01 else { return }
        guard view.bounds.width > 0, view.bounds.height > 0 else { return }

        let className = String(describing: type(of: view))
        if _isCameraView(view, className: className) {
            if let rect = _viewRectForMedia(view) {
                rects.append(rect)
            }
            return
        }

        for subview in view.subviews {
            _scanForCameraViews(in: subview, rects: &rects, depth: depth + 1)
        }
    }

    private func _mediaMaskRegions(windows: [UIWindow]) -> [MediaMaskRegion] {
        var regions: [MediaMaskRegion] = []
        for window in windows {
            _scanForMediaViews(in: window, regions: &regions)
            _visitVideoLayers(in: window) { _layer, region in
                guard region.clipRect.width > 1, region.clipRect.height > 1 else { return }
                regions.append(MediaMaskRegion(rect: region.clipRect, kind: .video))
            }
        }
        return regions
    }

    private func _scanForMediaViews(in view: UIView, regions: inout [MediaMaskRegion], depth: Int = 0) {
        guard depth < 120 else { return }
        guard !view.isHidden, view.alpha > 0.01 else { return }
        guard view.bounds.width > 0, view.bounds.height > 0 else { return }
        if view.accessibilityHint == "rejourney_occlude" || view.accessibilityIdentifier?.hasPrefix("rj_occlude") == true {
            return
        }

        let className = String(describing: type(of: view))
        if className.contains("UIRemoteKeyboardWindow") ||
           className.contains("UITextEffectsWindow") ||
           className.contains("UIInputSetHostView") ||
           className.contains("UIKeyboard") {
            return
        }

        let regionCountBeforeChildren = regions.count
        for subview in view.subviews {
            _scanForMediaViews(in: subview, regions: &regions, depth: depth + 1)
        }
        if regions.count > regionCountBeforeChildren {
            return
        }

        if let kind = _mediaMaskKind(view, className: className) {
            if let rect = _viewRectForMedia(view) {
                // Expo Video wraps AVPlayerViewController and Expo Image wraps
                // SDAnimatedImageView through several RN/Gesture Handler views.
                // Prefer the actual child media view over broad ancestor wrappers
                // so remote image/video masking does not cover the whole screen.
                regions.append(MediaMaskRegion(rect: rect, kind: kind))
            }
            return
        }
    }

    private func _viewRectForMedia(_ view: UIView) -> CGRect? {
        guard let window = view.window else { return nil }
        let bounds = view.bounds
        guard bounds.width > 0, bounds.height > 0 else { return nil }
        guard bounds.origin.x.isFinite, bounds.origin.y.isFinite, bounds.width.isFinite, bounds.height.isFinite else { return nil }
        let rect = view.convert(bounds, to: window)
        guard rect.width > 0, rect.height > 0 else { return nil }
        guard rect.origin.x.isFinite, rect.origin.y.isFinite, rect.width.isFinite, rect.height.isFinite else { return nil }
        if window.isKeyWindow {
            return rect
        }
        return rect.offsetBy(dx: window.frame.origin.x, dy: window.frame.origin.y)
    }

    private func _isImageOrVideoView(_ view: UIView, className: String? = nil) -> Bool {
        return _mediaMaskKind(view, className: className) != nil
    }

    private func _mediaMaskKind(_ view: UIView, className: String? = nil) -> MediaMaskKind? {
        if _isCameraView(view, className: className) {
            return nil
        }
        // UIKit icons often use UIImageView too. Keep remote image/video
        // masking scoped to content-sized media so small glyphs do not get
        // redacted as if they were photos or videos.
        guard _isContentSizedMediaView(view) else {
            return nil
        }
        if view is UIImageView {
            return .image
        }

        let resolvedClassName = className ?? String(describing: type(of: view))
        let lowerClassName = resolvedClassName.lowercased()
        if _classNameLooksLikeVideoView(lowerClassName) {
            return .video
        }
        if _classNameLooksLikeImageView(lowerClassName) {
            return .image
        }
        return nil
    }

    private func _isContentSizedMediaView(_ view: UIView) -> Bool {
        let bounds = view.bounds
        guard bounds.width > 0, bounds.height > 0 else { return false }
        guard bounds.width.isFinite, bounds.height.isFinite else { return false }
        guard !bounds.width.isNaN, !bounds.height.isNaN else { return false }
        let minSide = min(bounds.width, bounds.height)
        let area = bounds.width * bounds.height
        return minSide >= 44 && area >= 2_500
    }

    private func _classNameLooksLikeImageView(_ lowerClassName: String) -> Bool {
        lowerClassName == "imageview" ||
        lowerClassName.hasSuffix(".imageview") ||
        lowerClassName.hasSuffix("imageview") ||
        lowerClassName.contains("expoimage") ||
        lowerClassName.contains("sdanimatedimage")
    }

    private func _classNameLooksLikeVideoView(_ lowerClassName: String) -> Bool {
        lowerClassName == "videoview" ||
        lowerClassName.hasSuffix(".videoview") ||
        lowerClassName.hasSuffix("videoview")
    }

    private func _isCameraView(_ view: UIView, className: String? = nil) -> Bool {
        let resolvedClassName = className ?? String(describing: type(of: view))
        let lowerClassName = resolvedClassName.lowercased()
        if lowerClassName.contains("camera") || lowerClassName.contains("avcapture") {
            return true
        }
        if view.layer is AVCaptureVideoPreviewLayer {
            return true
        }
        return view.layer.sublayers?.contains(where: { $0 is AVCaptureVideoPreviewLayer }) == true
    }

    private func _compositeVideoLayers(in window: UIWindow, context: CGContext, snapshotScale: CGFloat) {
        guard let baseImage = UIGraphicsGetImageFromCurrentImageContext()?.cgImage else { return }

        _visitVideoLayers(in: window) { [weak self] layer, region in
            guard let self else { return }
            guard region.clipRect.width > 1, region.clipRect.height > 1 else { return }
            guard self._regionLooksMostlyBlack(in: baseImage, rect: region.clipRect, snapshotScale: snapshotScale) else { return }
            guard let frame = self._currentVideoFrame(for: layer) else { return }
            let drawRect = self._videoDrawRect(for: frame, in: region.layerBoundsRect, videoGravity: layer.videoGravity)
            context.saveGState()
            context.clip(to: region.clipRect)
            context.interpolationQuality = .high
            // UIKit's snapshot context is top-left oriented because it is created
            // by UIGraphicsBeginImageContextWithOptions/drawHierarchy. Drawing the
            // raw CGImage directly with CGContext uses Quartz image coordinates and
            // flips AVPlayerLayer frames in replay even though the user sees the
            // video layer upright. UIImage.draw applies UIKit's coordinate handling.
            UIImage(cgImage: frame, scale: 1, orientation: .up).draw(in: drawRect)
            context.restoreGState()
        }
    }

    private func _visitVideoLayers(in view: UIView, depth: Int = 0, body: (AVPlayerLayer, VideoLayerRegion) -> Void) {
        guard depth < _maxVideoLayerScanDepth else { return }
        guard !view.isHidden, view.alpha > 0.01 else { return }
        guard let window = (view as? UIWindow) ?? view.window else { return }
        if let clipRect = _viewClipRect(view, in: window) {
            _visitVideoLayers(in: view.layer, window: window, clipRect: clipRect, depth: depth, body: body)
        }
        for subview in view.subviews {
            _visitVideoLayers(in: subview, depth: depth + 1, body: body)
        }
    }

    private func _visitVideoLayers(in layer: CALayer, window: UIWindow, clipRect: CGRect, depth: Int, body: (AVPlayerLayer, VideoLayerRegion) -> Void) {
        guard depth < _maxVideoLayerScanDepth else { return }
        if let playerLayer = layer as? AVPlayerLayer, let region = _videoLayerRegion(playerLayer, in: window, clipRect: clipRect) {
            body(playerLayer, region)
        }
        for sublayer in layer.sublayers ?? [] {
            if sublayer.delegate is UIView {
                continue
            }
            _visitVideoLayers(in: sublayer, window: window, clipRect: clipRect, depth: depth + 1, body: body)
        }
    }

    private func _viewClipRect(_ view: UIView, in window: UIWindow) -> CGRect? {
        guard view.bounds.width > 0, view.bounds.height > 0 else { return nil }
        let rect = view.layer.convert(view.layer.bounds, to: window.layer).intersection(window.bounds)
        guard rect.width > 0, rect.height > 0 else { return nil }
        guard rect.origin.x.isFinite, rect.origin.y.isFinite, rect.width.isFinite, rect.height.isFinite else { return nil }
        return rect
    }

    private func _videoLayerRegion(_ layer: AVPlayerLayer, in window: UIWindow, clipRect: CGRect) -> VideoLayerRegion? {
        guard layer.bounds.width > 0, layer.bounds.height > 0 else { return nil }
        var convertedBoundsRect = layer.convert(layer.bounds, to: window.layer)
        var convertedClipRect = layer.convert(layer.bounds, to: window.layer).intersection(window.bounds).intersection(clipRect)
        if window.isKeyWindow {
            return _validVideoLayerRegion(layerBoundsRect: convertedBoundsRect, clipRect: convertedClipRect)
        }
        convertedBoundsRect = convertedBoundsRect.offsetBy(dx: window.frame.origin.x, dy: window.frame.origin.y)
        convertedClipRect = convertedClipRect.offsetBy(dx: window.frame.origin.x, dy: window.frame.origin.y)
        return _validVideoLayerRegion(layerBoundsRect: convertedBoundsRect, clipRect: convertedClipRect)
    }

    private func _validVideoLayerRegion(layerBoundsRect: CGRect, clipRect: CGRect) -> VideoLayerRegion? {
        guard layerBoundsRect.width > 0, layerBoundsRect.height > 0, clipRect.width > 0, clipRect.height > 0 else { return nil }
        guard layerBoundsRect.origin.x.isFinite, layerBoundsRect.origin.y.isFinite,
              layerBoundsRect.width.isFinite, layerBoundsRect.height.isFinite else { return nil }
        guard clipRect.origin.x.isFinite, clipRect.origin.y.isFinite, clipRect.width.isFinite, clipRect.height.isFinite else { return nil }
        return VideoLayerRegion(layerBoundsRect: layerBoundsRect, clipRect: clipRect)
    }

    private func _videoDrawRect(for frame: CGImage, in layerBoundsRect: CGRect, videoGravity: AVLayerVideoGravity) -> CGRect {
        // Do not draw into AVPlayerLayer.videoRect here. For aspect-fill layers it
        // can represent the visible clipped bounds, and stretching the raw frame
        // into that rect distorts portrait videos in replay.
        let frameSize = CGSize(width: frame.width, height: frame.height)
        guard frameSize.width > 0, frameSize.height > 0 else {
            return layerBoundsRect
        }
        if videoGravity == .resize {
            return layerBoundsRect
        }

        let widthScale = layerBoundsRect.width / frameSize.width
        let heightScale = layerBoundsRect.height / frameSize.height
        let scale = videoGravity == .resizeAspectFill ? max(widthScale, heightScale) : min(widthScale, heightScale)
        guard scale.isFinite, scale > 0 else {
            return layerBoundsRect
        }

        let size = CGSize(width: frameSize.width * scale, height: frameSize.height * scale)
        return CGRect(
            x: layerBoundsRect.midX - size.width / 2,
            y: layerBoundsRect.midY - size.height / 2,
            width: size.width,
            height: size.height
        )
    }

    private func _currentVideoFrame(for layer: AVPlayerLayer) -> CGImage? {
        if #available(iOS 16.0, *), let pixelBuffer = layer.displayedPixelBuffer(), let image = _cgImage(from: pixelBuffer) {
            return image
        }
        guard let item = layer.player?.currentItem else { return nil }
        let output = _videoOutput(for: item)
        var displayTime = CMTime.zero
        let hostTime = CACurrentMediaTime()
        let currentTime = item.currentTime()
        let outputTime = output.itemTime(forHostTime: hostTime)
        let candidateTimes = [currentTime, outputTime].filter { $0.isValid && !$0.isIndefinite }

        for time in candidateTimes {
            if let pixelBuffer = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: &displayTime) {
                return _cgImage(from: pixelBuffer)
            }
        }

        return _assetVideoFrame(for: item, at: currentTime)
    }

    private func _cgImage(from pixelBuffer: CVPixelBuffer) -> CGImage? {
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        return _ciContext.createCGImage(image, from: image.extent)
    }

    private func _assetVideoFrame(for item: AVPlayerItem, at time: CMTime) -> CGImage? {
        guard item.status == .readyToPlay else { return nil }
        let generator = _videoFrameGenerator(for: item)
        var requestedTime = time
        if item.duration.isValid, !item.duration.isIndefinite, item.duration.seconds.isFinite, item.duration.seconds > 0 {
            let maxTime = CMTimeSubtract(item.duration, CMTime(seconds: 0.05, preferredTimescale: 600))
            if CMTimeCompare(requestedTime, item.duration) >= 0 {
                requestedTime = maxTime
            }
        }
        guard requestedTime.isValid, !requestedTime.isIndefinite else { return nil }
        return try? generator.copyCGImage(at: requestedTime, actualTime: nil)
    }

    private func _videoFrameGenerator(for item: AVPlayerItem) -> AVAssetImageGenerator {
        let identifier = ObjectIdentifier(item)
        if let generator = _videoFrameGenerators[identifier] {
            return generator
        }

        if _videoFrameGenerators.count > 16 {
            _videoFrameGenerators.removeAll()
        }
        let generator = AVAssetImageGenerator(asset: item.asset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = CMTime(seconds: 0.25, preferredTimescale: 600)
        generator.requestedTimeToleranceAfter = CMTime(seconds: 0.25, preferredTimescale: 600)
        _videoFrameGenerators[identifier] = generator
        return generator
    }

    private func _videoOutput(for item: AVPlayerItem) -> AVPlayerItemVideoOutput {
        let identifier = ObjectIdentifier(item)
        if let output = _videoOutputs[identifier] {
            if !item.outputs.contains(where: { $0 === output }) {
                item.add(output)
            }
            return output
        }

        if _videoOutputs.count > 16 {
            _videoOutputs.removeAll()
        }
        let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA)
        ])
        item.add(output)
        _videoOutputs[identifier] = output
        return output
    }

    private func _regionLooksMostlyBlack(in image: CGImage, rect: CGRect, snapshotScale: CGFloat) -> Bool {
        let scale = max(CGFloat(1.0), snapshotScale)
        let imageBounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
        let cropRect = CGRect(
            x: rect.origin.x / scale,
            y: rect.origin.y / scale,
            width: rect.width / scale,
            height: rect.height / scale
        ).integral.intersection(imageBounds)
        guard cropRect.width >= 2, cropRect.height >= 2, let crop = image.cropping(to: cropRect) else {
            return true
        }

        let sampleSide = 16
        var pixels = [UInt8](repeating: 0, count: sampleSide * sampleSide * 4)
        guard let sampleContext = CGContext(
            data: &pixels,
            width: sampleSide,
            height: sampleSide,
            bitsPerComponent: 8,
            bytesPerRow: sampleSide * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return true
        }
        sampleContext.interpolationQuality = .low
        sampleContext.draw(crop, in: CGRect(x: 0, y: 0, width: sampleSide, height: sampleSide))

        var blackCount = 0
        var visibleCount = 0
        for index in stride(from: 0, to: pixels.count, by: 4) {
            let red = pixels[index]
            let green = pixels[index + 1]
            let blue = pixels[index + 2]
            let alpha = pixels[index + 3]
            guard alpha > 16 else { continue }
            visibleCount += 1
            if red < 28 && green < 28 && blue < 28 {
                blackCount += 1
            }
        }
        guard visibleCount > 0 else { return true }
        return Double(blackCount) / Double(visibleCount) > 0.82
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
        let captureSessionId = _currentSessionId
        _stateLock.unlock()
        
        guard !images.isEmpty else { return }
        
        // All heavy work (package, gzip, network) happens in background queue
        _encodeQueue.addOperation { [weak self] in
            self?._packageAndShip(images: images, sessionEpoch: sessionEpoch, sessionId: captureSessionId)
        }
    }
    
    private func _packageAndShip(images: [(Data, UInt64)], sessionEpoch: UInt64, sessionId: String?) {
        let batchStart = CFAbsoluteTimeGetCurrent()
        
        guard let bundle = _packageFrameBundle(images: images, sessionEpoch: sessionEpoch) else { return }
        
        let rid = sessionId ?? "unknown"
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
            frameCount: images.count,
            sessionId: sessionId
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
    @objc func uploadPendingFrames(sessionId: String) {
        uploadPendingFrames(sessionId: sessionId, sessionEpoch: nil, completion: nil)
    }
    
    func uploadPendingFrames(sessionId: String, sessionEpoch: UInt64? = nil, completion: ((Bool) -> Void)? = nil) {
        guard let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            completion?(false)
            return
        }
        let framesPath = cacheDir.appendingPathComponent("rj_pending").appendingPathComponent(sessionId).appendingPathComponent("frames")
        
        guard let frameFiles = try? FileManager.default.contentsOfDirectory(at: framesPath, includingPropertiesForKeys: nil) else {
            completion?(true)
            return
        }
        
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
        
        let recoveryEpoch = sessionEpoch ?? frames.first?.1 ?? 0
        guard !frames.isEmpty, let bundle = _packageFrameBundle(images: frames, sessionEpoch: recoveryEpoch) else {
            completion?(frames.isEmpty)
            return
        }
        
        let endTs = frames.last?.1 ?? 0
        
        SegmentDispatcher.shared.transmitFrameBundle(
            for: sessionId,
            payload: bundle,
            startMs: frames.first?.1 ?? 0,
            endMs: endTs,
            frameCount: frames.count
        ) { ok in
            if ok {
                try? FileManager.default.removeItem(at: framesPath)
            }
            completion?(ok)
        }
    }
    
    /// Clear pending frames for a session after successful upload
    @objc func clearPendingFrames(sessionId: String) {
        guard let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let framesPath = cacheDir.appendingPathComponent("rj_pending").appendingPathComponent(sessionId).appendingPathComponent("frames")
        try? FileManager.default.removeItem(at: framesPath)
    }
    
    private func _flushBuffer() {
        _stateLock.lock()
        let frames = _screenshots
        _screenshots.removeAll()
        let captureSessionId = _currentSessionId
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
        
        let rid = captureSessionId ?? "unknown"
        let endTs = frames.last?.1 ?? _sessionEpoch
        let fname = "\(rid)-\(endTs).tar.gz"
        
        // No main thread dispatch - submit directly (fixes stutter)
        TelemetryPipeline.shared.submitFrameBundle(
            payload: bundle,
            filename: fname,
            startMs: frames.first?.1 ?? _sessionEpoch,
            endMs: endTs,
            frameCount: frames.count,
            sessionId: captureSessionId
        )
    }
    
    /// Android-compatible binary format: [8-byte BE timestamp offset][4-byte BE size][jpeg] per frame. Backend auto-detects.
    private func _packageFrameBundle(images: [(Data, UInt64)], sessionEpoch: UInt64) -> Data? {
        var archive = Data()
        for (jpeg, timestamp) in images {
            let tsOffset = timestamp - sessionEpoch
            archive.append(_uint64BigEndian(tsOffset))
            archive.append(_uint32BigEndian(UInt32(jpeg.count)))
            archive.append(jpeg)
        }
        return archive.gzipCompress()
    }
    
    private func _uint64BigEndian(_ value: UInt64) -> Data {
        Data([
            UInt8((value >> 56) & 0xff),
            UInt8((value >> 48) & 0xff),
            UInt8((value >> 40) & 0xff),
            UInt8((value >> 32) & 0xff),
            UInt8((value >> 24) & 0xff),
            UInt8((value >> 16) & 0xff),
            UInt8((value >> 8) & 0xff),
            UInt8(value & 0xff)
        ])
    }
    
    private func _uint32BigEndian(_ value: UInt32) -> Data {
        Data([
            UInt8((value >> 24) & 0xff),
            UInt8((value >> 16) & 0xff),
            UInt8((value >> 8) & 0xff),
            UInt8(value & 0xff)
        ])
    }
}

private enum CaptureState { case idle, capturing, halted }

private final class CaptureStateMachine {
    private var _state: CaptureState = .idle
    private let _lock = NSLock()
    
    fileprivate var currentState: CaptureState {
        _lock.lock()
        defer { _lock.unlock() }
        return _state
    }
    
    fileprivate func transition(to target: CaptureState) -> Bool {
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
    // hierarchies (thousands of views). Cache view references, not rects:
    // rects must be recomputed every frame so masks follow scrolling and
    // pull-to-refresh transforms instead of staying at stale coordinates.
    private struct WeakViewRef {
        weak var view: UIView?
        let kind: RedactionMaskKind
    }
    private var _cachedAutoViews: [WeakViewRef] = []
    private var _lastScanTime: CFAbsoluteTime = 0
    private let _scanCacheDurationSec: CFAbsoluteTime = 0.5
    private let _maxSensitiveScanDepth = 120
    
    private var _observers: [Any] = []
    
    init() {
        _observers.append(NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: nil) { [weak self] _ in self?.invalidateCache() })
        _observers.append(NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: nil) { [weak self] _ in self?.invalidateCache() })
        _observers.append(NotificationCenter.default.addObserver(forName: UITextField.textDidChangeNotification, object: nil, queue: nil) { [weak self] _ in self?.invalidateCache() })
        _observers.append(NotificationCenter.default.addObserver(forName: UITextView.textDidChangeNotification, object: nil, queue: nil) { [weak self] _ in self?.invalidateCache() })
    }
    
    deinit {
        for observer in _observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }
    
    func invalidateCache() {
        _lock.lock()
        _lastScanTime = 0
        _lock.unlock()
    }
    
    // View class names that should always be masked (privacy sensitive)
    private let _alwaysSensitiveClassNames: Set<String> = [
        // Camera views
        "AVCaptureVideoPreviewLayer",
        "CameraView",
        "RCTCameraView",
        "ExpoCamera",
        "EXCameraView",
    ]

    private let _textInputClassNames: Set<String> = [
        // React Native text inputs (internal class names)
        "RCTSinglelineTextInputView",
        "RCTMultilineTextInputView", 
        "RCTTextInput",
        "RCTBaseTextInputView",
        "RCTTextInputComponentView",
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
    
    func computeRects(windows: [UIWindow]? = nil) -> [CGRect] {
        computeRegions(windows: windows).map { $0.rect }
    }

    fileprivate func computeRegions(windows: [UIWindow]? = nil) -> [RedactionRegion] {
        _lock.lock()
        let explicitViews = _explicitViews.allObjects
        _lock.unlock()
        
        var regions: [RedactionRegion] = []
        regions.reserveCapacity(explicitViews.count + 20)
        
        // 1. Add explicitly registered views (always fresh — these are few)
        for v in explicitViews {
            if let rect = _maskRect(v) {
                regions.append(RedactionRegion(rect: rect, kind: .generic))
            }
        }
        
        // 2. Auto-detect sensitive views from a cached hierarchy scan.
        //    The full recursive scan is expensive (String(describing:) reflection
        //    on every view) so we cache sensitive view refs for ~0.5s. Rects are
        //    always re-evaluated, so moving list content stays covered.
        let now = CFAbsoluteTimeGetCurrent()
        if now - _lastScanTime >= _scanCacheDurationSec {
            _cachedAutoViews.removeAll()
            let scanWindows = windows ?? _keyWindow().map { [$0] } ?? []
            for window in scanWindows {
                _scanForSensitiveViews(in: window, views: &_cachedAutoViews)
            }
            _lastScanTime = now
        }
        for ref in _cachedAutoViews {
            guard let view = ref.view, let rect = _maskRect(view) else { continue }
            regions.append(RedactionRegion(rect: rect, kind: ref.kind))
        }
        
        return regions
    }

    private func _maskRect(_ v: UIView) -> CGRect? {
        // Prefer the current rendered layer position. During pull-to-refresh and
        // other scroll animations UIKit can render a view at its presentation
        // layer position before model-layer coordinates settle.
        if let rect = _viewRectAnimationSafe(v) {
            return rect
        }
        return _viewRect(v)
    }
    
    private func _viewRect(_ v: UIView) -> CGRect? {
        guard let w = v.window else { return nil }
        
        // Skip non-key windows unless native sheet capture is explicitly enabled.
        // These have transitional layer transforms during animation that cause
        // UIView.convert() to pass NaN to CoreGraphics internally, producing
        // "invalid numeric value (NaN)" errors that we cannot catch because
        // CoreGraphics logs the error before the return value is available.
        if !w.isKeyWindow && !ReplayOrchestrator.shared.captureNativeSheets { return nil }
        
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
        if w.isKeyWindow {
            return r
        }
        return r.offsetBy(dx: w.frame.origin.x, dy: w.frame.origin.y)
    }
    
    /// Fallback rect computation for views that have active CoreAnimation keys.
    /// Used only for views explicitly marked for masking (accessibilityHint =
    /// "rejourney_occlude") where we must produce a rect even during animations,
    /// such as when a map page triggers layout animations on the Mask wrapper.
    ///
    /// Uses CALayer.presentation() to get the current rendered frame, which avoids
    /// the UIView.convert() NaN issue that affects keyboard-window views. Regular
    /// RCTViews never produce NaN transforms, so this path is safe for app-layer views.
    private func _viewRectAnimationSafe(_ v: UIView) -> CGRect? {
        guard let w = v.window, w.isKeyWindow else { return nil }
        guard v.bounds.width > 0, v.bounds.height > 0 else { return nil }

        // Use the presentation layer (current animated state) so the mask covers
        // where the view is visually rendered right now, not its final model position.
        let layer = v.layer.presentation() ?? v.layer
        let frameInWindow = layer.convert(layer.bounds, to: w.layer)

        guard frameInWindow.width > 0, frameInWindow.height > 0 else { return nil }
        guard frameInWindow.origin.x.isFinite, frameInWindow.origin.y.isFinite,
              frameInWindow.width.isFinite, frameInWindow.height.isFinite else { return nil }
        guard !frameInWindow.origin.x.isNaN, !frameInWindow.origin.y.isNaN,
              !frameInWindow.width.isNaN, !frameInWindow.height.isNaN else { return nil }
        return frameInWindow
    }

    private func _keyWindow() -> UIWindow? {
        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
    }
    
    private func _scanForSensitiveViews(in view: UIView, views: inout [WeakViewRef], depth: Int = 0) {
        guard depth < _maxSensitiveScanDepth else { return }

        guard !view.isHidden && view.alpha > 0.01 else { return }
        guard view.bounds.width > 0 && view.bounds.height > 0 else { return }

        let className = String(describing: type(of: view))
        if className.contains("UIRemoteKeyboardWindow") ||
           className.contains("UITextEffectsWindow") ||
           className.contains("UIInputSetHostView") ||
           className.contains("UIKeyboard") {
            return
        }

        if let maskKind = _maskKind(view) {
            views.append(WeakViewRef(view: view, kind: maskKind))
            return
        }

        for subview in view.subviews {
            _scanForSensitiveViews(in: subview, views: &views, depth: depth + 1)
        }
    }
    
    private func _maskKind(_ view: UIView) -> RedactionMaskKind? {
        if view.accessibilityHint == "rejourney_occlude" {
            return .generic
        }
        // Fallback: nativeID maps to accessibilityIdentifier and is always set
        // regardless of the accessible prop. Covers RN New Architecture / Bridgeless
        // mode where accessibilityHint may not be propagated when accessible={false}.
        if view.accessibilityIdentifier?.hasPrefix("rj_occlude") == true {
            return .generic
        }
        
        if let textField = view as? UITextField, textField.isSecureTextEntry {
            return .textInput
        }
        if view is UITextField {
            return ReplayOrchestrator.shared.maskTextInputsByDefault ? .textInput : nil
        }
        if view is UITextView {
            return ReplayOrchestrator.shared.maskTextInputsByDefault ? .textInput : nil
        }

        let className = String(describing: type(of: view))
        if _alwaysSensitiveClassNames.contains(className) {
            return .generic
        }
        if ReplayOrchestrator.shared.maskTextInputsByDefault && _textInputClassNames.contains(className) {
            return .textInput
        }

        let lowerClassName = className.lowercased()

        if lowerClassName.contains("camera") || lowerClassName.contains("preview") {
            // Verify it's actually a camera preview, not just any view with "camera" in name
            if lowerClassName.contains("video") || lowerClassName.contains("capture") || 
               lowerClassName.contains("avcapture") || view.layer is AVCaptureVideoPreviewLayer {
                return .generic
            }
        }
        
        // 5. Check layer type for camera preview layers
        if view.layer.sublayers?.contains(where: { $0 is AVCaptureVideoPreviewLayer }) == true {
            return .generic
        }
        
        return nil
    }
}
