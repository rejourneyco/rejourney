import UIKit
import Foundation
import QuartzCore
import Accelerate
import AVFoundation

@objc(VisualCapture)
public final class VisualCapture: NSObject {
    
    @objc public static let shared = VisualCapture()
    
    @objc public var snapshotInterval: Double = 0.5
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
            self?._captureFrame()
        }
    }
    
    private func _startCaptureTimer() {
        _stopCaptureTimer()
        // Industry standard: Use default run loop mode (NOT .common)
        // This lets the timer pause during scrolling/tracking which prevents stutter
        // The capture will resume when scrolling stops
        _captureTimer = Timer.scheduledTimer(withTimeInterval: snapshotInterval, repeats: true) { [weak self] _ in
            self?._captureFrame()
        }
    }
    
    private func _stopCaptureTimer() {
        _captureTimer?.invalidate()
        _captureTimer = nil
    }
    
    private func _captureFrame() {
        guard _stateMachine.currentState == .capturing else { return }
        
        // Skip capture if app is not in foreground (prevents "not in visible window" warnings)
        guard UIApplication.shared.applicationState == .active else { return }
        
        let frameStart = CFAbsoluteTimeGetCurrent()
        
        // Industry standard: Take screenshot synchronously on main thread
        // Only move compression to background
        autoreleasepool {
            guard let window = UIApplication.shared.windows.first(where: \.isKeyWindow) else { return }
            let bounds = window.bounds
            // Guard against NaN and invalid bounds that cause CoreGraphics errors
            guard bounds.width > 0, bounds.height > 0 else { return }
            guard !bounds.width.isNaN && !bounds.height.isNaN else { return }
            guard bounds.width.isFinite && bounds.height.isFinite else { return }
            
            let redactRects = _redactionMask.computeRects()
            
            // Use UIGraphicsBeginImageContextWithOptions for lower overhead (industry pattern)
            let screenScale: CGFloat = 1.25 // Lower scale reduces encoding time significantly
            UIGraphicsBeginImageContextWithOptions(bounds.size, false, screenScale)
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
            
            // Compress immediately - JPEG encoding is fast enough inline
            guard let data = image.jpegData(compressionQuality: quality) else { return }
            
            let captureTs = UInt64(Date().timeIntervalSince1970 * 1000)
            _frameCounter += 1
            
            // Log frame timing every 30 frames to avoid log spam
            if _frameCounter % 30 == 0 {
                let frameDurationMs = (CFAbsoluteTimeGetCurrent() - frameStart) * 1000
                DiagnosticLog.perfFrame(operation: "screenshot", durationMs: frameDurationMs, frameNumber: Int(_frameCounter), isMainThread: Thread.isMainThread)
            }
            
            // Store in buffer (fast operation)
            _stateLock.lock()
            _screenshots.append((data, captureTs))
            _enforceScreenshotCaps()
            // Use internal batch size to avoid cross-object call overhead
            let shouldSend = !_deferredUntilCommit && _screenshots.count >= _batchSize
            _stateLock.unlock()
            
            // Move network send to background only
            if shouldSend {
                _sendScreenshots()
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
        
        // 1. Add explicitly registered views
        for v in explicitViews {
            if let rect = _viewRect(v) {
                rects.append(rect)
            }
        }
        
        // 2. Auto-detect sensitive views in window hierarchy
        if let window = _keyWindow() {
            _scanForSensitiveViews(in: window, rects: &rects)
        }
        
        return rects
    }
    
    private func _viewRect(_ v: UIView) -> CGRect? {
        guard let w = v.window else { return nil }
        // Guard against views with invalid bounds before conversion
        let viewBounds = v.bounds
        guard viewBounds.width > 0 && viewBounds.height > 0 else { return nil }
        guard viewBounds.width.isFinite && viewBounds.height.isFinite else { return nil }
        guard !viewBounds.width.isNaN && !viewBounds.height.isNaN else { return nil }
        
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
    
    private func _scanForSensitiveViews(in view: UIView, rects: inout [CGRect]) {
        // Check if this view should be masked
        if _shouldMask(view), let rect = _viewRect(view) {
            rects.append(rect)
            return // Don't scan children - parent mask covers them
        }
        
        // Recurse into subviews (limit depth for performance)
        for subview in view.subviews {
            _scanForSensitiveViews(in: subview, rects: &rects)
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
