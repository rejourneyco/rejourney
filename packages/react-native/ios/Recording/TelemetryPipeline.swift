import UIKit
import QuartzCore

@objc(TelemetryPipeline)
public final class TelemetryPipeline: NSObject {
    
    @objc public static let shared = TelemetryPipeline()
    
    @objc public var endpoint = "https://api.rejourney.co" {
        didSet { SegmentDispatcher.shared.endpoint = endpoint }
    }
    
    @objc public var currentReplayId: String? {
        didSet {
            SegmentDispatcher.shared.currentReplayId = currentReplayId
        }
    }
    
    public var credential: String? {
        didSet { SegmentDispatcher.shared.credential = credential }
    }
    
    public var apiToken: String? {
        didSet { SegmentDispatcher.shared.apiToken = apiToken }
    }
    
    public var projectId: String? {
        didSet { SegmentDispatcher.shared.projectId = projectId }
    }
    
    private let _eventRing = EventRingBuffer(capacity: 5000)
    private let _frameQueue = FrameBundleQueue(maxPending: 200)
    private var _deferredMode = false
    private var _batchSeq = 0
    private var _draining = false
    private var _backgroundTaskId: UIBackgroundTaskIdentifier = .invalid
    
    private let _serialWorker = DispatchQueue(label: "co.rejourney.telemetry", qos: .utility)
    private var _heartbeat: Timer?
    
    private let _batchSizeLimit = 500_000
    
    private override init() {
        super.init()
    }
    
    @objc public func activate() {
        // Upload any pending data from previous sessions first
        _uploadPendingSessions()
        
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            // Industry standard: Use default run loop mode (NOT .common)
            // This lets the timer pause during scrolling which prevents stutter
            self._heartbeat = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
                self?.dispatchNow()
            }
        }
        
        NotificationCenter.default.addObserver(self, selector: #selector(_appSuspending), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(_appSuspending), name: UIApplication.willTerminateNotification, object: nil)
    }
    
    @objc public func shutdown() {
        _heartbeat?.invalidate()
        _heartbeat = nil
        NotificationCenter.default.removeObserver(self)
        
        SegmentDispatcher.shared.halt()
        _appSuspending()
    }
    
    @objc public func finalizeAndShip() {
        shutdown()
    }
    
    @objc public func activateDeferredMode() {
        _serialWorker.async { self._deferredMode = true }
    }
    
    @objc public func commitDeferredData() {
        _serialWorker.async {
            self._deferredMode = false
            self._shipPendingEvents()
            self._shipPendingFrames()
        }
    }
    
    @objc public func submitFrameBundle(payload: Data, filename: String, startMs: UInt64, endMs: UInt64, frameCount: Int) {
        _serialWorker.async {
            let bundle = PendingFrameBundle(tag: filename, payload: payload, rangeStart: startMs, rangeEnd: endMs, count: frameCount)
            self._frameQueue.enqueue(bundle)
            if !self._deferredMode { self._shipPendingFrames() }
        }
    }
    
    @objc public func dispatchNow() {
        _serialWorker.async {
            self._shipPendingEvents()
            self._shipPendingFrames()
        }
    }
    
    @objc private func _appSuspending() {
        guard !_draining else { return }
        _draining = true
        
        // Request background time to complete uploads
        _backgroundTaskId = UIApplication.shared.beginBackgroundTask(withName: "RejourneyFlush") { [weak self] in
            self?._endBackgroundTask()
        }
        
        // Flush visual frames to disk immediately
        VisualCapture.shared.flushToDisk()
        
        // Try to upload pending data with remaining background time
        _serialWorker.async { [weak self] in
            self?._shipPendingEvents()
            self?._shipPendingFrames()
            
            // Allow a short delay for network operations to complete
            Thread.sleep(forTimeInterval: 0.5)
            
            DispatchQueue.main.async {
                self?._endBackgroundTask()
            }
        }
    }
    
    private func _endBackgroundTask() {
        guard _backgroundTaskId != .invalid else { return }
        UIApplication.shared.endBackgroundTask(_backgroundTaskId)
        _backgroundTaskId = .invalid
        _draining = false
    }
    
    private func _uploadPendingSessions() {
        // TODO: Re-enable when EventBuffer is added to Xcode project
        // For now, just upload pending frames
    }
    
    private func _uploadSessionEvents(sessionId: String, events: [[String: Any]], completion: @escaping (Bool) -> Void) {
        let payload = _serializeBatchFromEvents(events: events)
        guard let compressed = payload.gzipCompress() else {
            completion(false)
            return
        }
        
        SegmentDispatcher.shared.transmitEventBatchAlternate(
            replayId: sessionId,
            eventPayload: compressed,
            eventCount: events.count,
            completion: completion
        )
    }
    
    private func _serializeBatchFromEvents(events: [[String: Any]]) -> Data {
        let device = UIDevice.current
        
        let networkType = ReplayOrchestrator.shared.currentNetworkType
        let isConstrained = ReplayOrchestrator.shared.networkIsConstrained
        let isExpensive = ReplayOrchestrator.shared.networkIsExpensive
        
        let meta: [String: Any] = [
            "platform": "ios",
            "model": device.model,
            "osVersion": device.systemVersion,
            "vendorId": device.identifierForVendor?.uuidString ?? "",
            "time": Date().timeIntervalSince1970,
            "networkType": networkType,
            "isConstrained": isConstrained,
            "isExpensive": isExpensive
        ]
        
        let wrapper: [String: Any] = ["events": events, "deviceInfo": meta]
        return (try? JSONSerialization.data(withJSONObject: wrapper)) ?? Data()
    }
    
    private func _shipPendingFrames() {
        guard !_deferredMode, let next = _frameQueue.dequeue(), currentReplayId != nil else { return }
        
        SegmentDispatcher.shared.transmitFrameBundle(
            payload: next.payload,
            startMs: next.rangeStart,
            endMs: next.rangeEnd,
            frameCount: next.count
        ) { [weak self] ok in
            if !ok { self?._frameQueue.requeue(next) }
            else { self?._serialWorker.async { self?._shipPendingFrames() } }
        }
    }
    
    private func _shipPendingEvents() {
        guard !_deferredMode else { return }
        let batch = _eventRing.drain(maxBytes: _batchSizeLimit)
        guard !batch.isEmpty else { return }
        
        let payload = _serializeBatch(events: batch)
        guard let compressed = payload.gzipCompress() else {
            batch.forEach { _eventRing.push($0) }
            return
        }
        
        let seq = _batchSeq
        _batchSeq += 1
        
        SegmentDispatcher.shared.transmitEventBatch(payload: compressed, batchNumber: seq, eventCount: batch.count) { [weak self] ok in
            if !ok { batch.forEach { self?._eventRing.push($0) } }
            else if self?._draining == true { }
        }
    }
    
    private func _serializeBatch(events: [EventEntry]) -> Data {
        var jsonEvents: [[String: Any]] = []
        for e in events {
            var clean = e.data
            if clean.last == 0x0A { clean = clean.dropLast() }
            if let obj = try? JSONSerialization.jsonObject(with: clean) as? [String: Any] { jsonEvents.append(obj) }
        }
        
        let device = UIDevice.current
        let bounds = UIScreen.main.bounds
        
        // Get current network state from orchestrator
        let networkType = ReplayOrchestrator.shared.currentNetworkType
        let isConstrained = ReplayOrchestrator.shared.networkIsConstrained
        let isExpensive = ReplayOrchestrator.shared.networkIsExpensive
        
        // Get app version from bundle
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        let appId = Bundle.main.bundleIdentifier ?? "unknown"
        
        let meta: [String: Any] = [
            "platform": "ios",
            "model": device.model,
            "osVersion": device.systemVersion,
            "vendorId": device.identifierForVendor?.uuidString ?? "",
            "time": Date().timeIntervalSince1970,
            "networkType": networkType,
            "isConstrained": isConstrained,
            "isExpensive": isExpensive,
            "appVersion": appVersion,
            "appId": appId,
            "screenWidth": Int(bounds.width),
            "screenHeight": Int(bounds.height),
            "screenScale": Int(UIScreen.main.scale),
            "systemName": device.systemName,
            "name": device.name
        ]
        
        let wrapper: [String: Any] = ["events": jsonEvents, "deviceInfo": meta]
        return (try? JSONSerialization.data(withJSONObject: wrapper)) ?? Data()
    }
    
    @objc public func recordAttribute(key: String, value: String) {
        _enqueue(["type": "custom", "timestamp": _ts(), "name": "attribute", "payload": "{\"key\":\"\(key)\",\"value\":\"\(value)\"}"])
    }
    
    @objc public func recordCustomEvent(name: String, payload: String) {
        _enqueue(["type": "custom", "timestamp": _ts(), "name": name, "payload": payload])
    }
    
    @objc public func recordUserAssociation(_ userId: String) {
        _enqueue(["type": "user_identity_changed", "timestamp": _ts(), "userId": userId])
    }
    
    @objc public func recordTapEvent(label: String, x: UInt64, y: UInt64) {
        _enqueue(["type": "touch", "gestureType": "tap", "timestamp": _ts(), "label": label, "x": x, "y": y, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }
    
    @objc public func recordRageTapEvent(label: String, x: UInt64, y: UInt64, count: Int) {
        _enqueue([
            "type": "gesture",
            "gestureType": "rage_tap",
            "timestamp": _ts(),
            "label": label,
            "x": x,
            "y": y,
            "count": count,
            "frustrationKind": "rage_tap",
            "touches": [["x": x, "y": y, "timestamp": _ts()]]
        ])
    }
    
    @objc public func recordSwipeEvent(label: String, x: UInt64, y: UInt64, direction: String) {
        _enqueue(["type": "gesture", "gestureType": "swipe", "timestamp": _ts(), "label": label, "x": x, "y": y, "direction": direction, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }
    
    @objc public func recordScrollEvent(label: String, x: UInt64, y: UInt64, direction: String) {
        _enqueue(["type": "gesture", "gestureType": "scroll", "timestamp": _ts(), "label": label, "x": x, "y": y, "direction": direction, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }
    
    @objc public func recordPanEvent(label: String, x: UInt64, y: UInt64) {
        _enqueue(["type": "gesture", "gestureType": "pan", "timestamp": _ts(), "label": label, "x": x, "y": y, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }
    
    @objc public func recordLongPressEvent(label: String, x: UInt64, y: UInt64) {
        _enqueue(["type": "gesture", "gestureType": "long_press", "timestamp": _ts(), "label": label, "x": x, "y": y, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }
    
    @objc public func recordInputEvent(value: String, redacted: Bool, label: String) {
        _enqueue(["type": "input", "timestamp": _ts(), "value": redacted ? "***" : value, "redacted": redacted, "label": label])
    }
    
    @objc public func recordViewTransition(viewId: String, viewLabel: String, entering: Bool) {
        _enqueue(["type": "navigation", "timestamp": _ts(), "screen": viewLabel, "screenName": viewLabel, "viewId": viewId, "entering": entering])
    }
    
    @objc public func recordNetworkEvent(details: [String: Any]) {
        var e = details
        e["type"] = "network_request"
        e["timestamp"] = _ts()
        _enqueue(e)
    }
    
    @objc public func recordAppStartup(durationMs: Int64) {
        _enqueue([
            "type": "app_startup",
            "timestamp": _ts(),
            "durationMs": durationMs,
            "platform": "ios"
        ])
    }
    
    @objc public func recordAppForeground(totalBackgroundTimeMs: UInt64) {
        _enqueue([
            "type": "app_foreground",
            "timestamp": _ts(),
            "totalBackgroundTime": totalBackgroundTimeMs
        ])
    }
    
    private func _enqueue(_ dict: [String: Any]) {
        // Keep in memory ring for immediate upload
        guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return }
        var d = data
        d.append(0x0A)
        _eventRing.push(EventEntry(data: d, size: d.count))
    }
    
    private func _ts() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}

private struct EventEntry {
    let data: Data
    let size: Int
}

private final class EventRingBuffer {
    private var _storage: ContiguousArray<EventEntry> = []
    private let _capacity: Int
    private let _lock = NSLock()
    
    init(capacity: Int) {
        _capacity = capacity
        _storage.reserveCapacity(capacity)
    }
    
    func push(_ entry: EventEntry) {
        _lock.lock()
        defer { _lock.unlock() }
        if _storage.count >= _capacity { _storage.removeFirst() }
        _storage.append(entry)
    }
    
    func drain(maxBytes: Int) -> [EventEntry] {
        _lock.lock()
        defer { _lock.unlock() }
        var result: [EventEntry] = []
        var total = 0
        while !_storage.isEmpty {
            let next = _storage.first!
            if total + next.size > maxBytes { break }
            result.append(next)
            total += next.size
            _storage.removeFirst()
        }
        return result
    }
}

private struct PendingFrameBundle {
    let tag: String
    let payload: Data
    let rangeStart: UInt64
    let rangeEnd: UInt64
    let count: Int
}

private final class FrameBundleQueue {
    private var _queue: [PendingFrameBundle] = []
    private let _maxPending: Int
    private let _lock = NSLock()
    
    init(maxPending: Int) {
        _maxPending = maxPending
    }
    
    func enqueue(_ bundle: PendingFrameBundle) {
        _lock.lock()
        defer { _lock.unlock() }
        if _queue.count >= _maxPending { _queue.removeFirst() }
        _queue.append(bundle)
    }
    
    func dequeue() -> PendingFrameBundle? {
        _lock.lock()
        defer { _lock.unlock() }
        guard !_queue.isEmpty else { return nil }
        return _queue.removeFirst()
    }
    
    func requeue(_ bundle: PendingFrameBundle) {
        _lock.lock()
        defer { _lock.unlock() }
        _queue.insert(bundle, at: 0)
    }
}
