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
    
    /// SDK's sampling decision for server-side enforcement
    public var isSampledIn: Bool = true {
        didSet { SegmentDispatcher.shared.isSampledIn = isSampledIn }
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
    
    // Dead tap detection — timestamp comparison.
    // After a tap, a 400ms timer fires and checks whether any "response" event
    // (navigation, input, haptics, or animation) occurred since the tap.  If not → dead tap.
    // We do NOT cancel the timer proactively because gesture-recognizer scroll
    // events fire on nearly every tap due to micro-movement and would mask real dead taps.
    private static let _deadTapTimeoutSec: Double = 0.4
    private var _deadTapTimer: DispatchWorkItem?
    private var _lastTapLabel: String = ""
    private var _lastTapX: UInt64 = 0
    private var _lastTapY: UInt64 = 0
    private var _lastTapTs: Int64 = 0
    private var _lastResponseTs: Int64 = 0
    
    /// Call this when haptic feedback, animations, or other UI responses occur.
    /// This prevents the current tap from being marked as a "dead tap".
    @objc public func markResponseReceived() {
        _lastResponseTs = _ts()
    }
    
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
    
    @objc public func recordJSErrorEvent(name: String, message: String, stack: String?) {
        var event: [String: Any] = [
            "type": "error",
            "timestamp": _ts(),
            "name": name,
            "message": message
        ]
        if let stack = stack {
            event["stack"] = stack
        }
        _enqueue(event)
    }
    
    @objc public func recordAnrEvent(durationMs: Int, stack: String?) {
        var event: [String: Any] = [
            "type": "anr",
            "timestamp": _ts(),
            "durationMs": durationMs,
            "threadState": "blocked"
        ]
        if let stack = stack {
            event["stack"] = stack
        }
        _enqueue(event)
    }
    
    @objc public func recordUserAssociation(_ userId: String) {
        _enqueue(["type": "user_identity_changed", "timestamp": _ts(), "userId": userId])
    }
    
    @objc public func recordTapEvent(label: String, x: UInt64, y: UInt64, isInteractive: Bool = false) {
        // Cancel any existing dead tap timer (new tap supersedes previous)
        _cancelDeadTapTimer()
        
        let tapTs = _ts()
        _enqueue(["type": "touch", "gestureType": "tap", "timestamp": tapTs, "label": label, "x": x, "y": y, "touches": [["x": x, "y": y, "timestamp": tapTs]]])
        
        // Skip dead tap detection for interactive elements (buttons, touchables, etc.)
        // These are expected to respond, so we don't need to track "no response" as dead.
        if isInteractive {
            // Interactive elements are assumed to respond — no dead tap timer needed
            return
        }
        
        // Start dead tap timer only for non-interactive elements (labels, images, empty space)
        // When it fires, check if any response event occurred after this tap. If not → dead tap.
        _lastTapLabel = label
        _lastTapX = x
        _lastTapY = y
        _lastTapTs = tapTs
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self._deadTapTimer = nil
            // Only fire dead tap if no response event occurred since this tap
            if self._lastResponseTs <= self._lastTapTs {
                self.recordDeadTapEvent(label: self._lastTapLabel, x: self._lastTapX, y: self._lastTapY)
                ReplayOrchestrator.shared.incrementDeadTapTally()
            }
        }
        _deadTapTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + TelemetryPipeline._deadTapTimeoutSec, execute: work)
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
    
    @objc public func recordDeadTapEvent(label: String, x: UInt64, y: UInt64) {
        _enqueue([
            "type": "gesture",
            "gestureType": "dead_tap",
            "timestamp": _ts(),
            "label": label,
            "x": x,
            "y": y,
            "frustrationKind": "dead_tap",
            "touches": [["x": x, "y": y, "timestamp": _ts()]]
        ])
    }
    
    @objc public func recordSwipeEvent(label: String, x: UInt64, y: UInt64, direction: String) {
        _enqueue(["type": "gesture", "gestureType": "swipe", "timestamp": _ts(), "label": label, "x": x, "y": y, "direction": direction, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }
    
    @objc public func recordScrollEvent(label: String, x: UInt64, y: UInt64, direction: String) {
        // NOTE: Do NOT mark scroll as a "response" for dead tap detection.
        // Gesture recognisers classify micro-movement during a tap as a scroll,
        // which would mask nearly every dead tap.  Only navigation and input
        // count as definitive responses.
        _enqueue(["type": "gesture", "gestureType": "scroll", "timestamp": _ts(), "label": label, "x": x, "y": y, "direction": direction, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }
    
    @objc public func recordPanEvent(label: String, x: UInt64, y: UInt64) {
        _enqueue(["type": "gesture", "gestureType": "pan", "timestamp": _ts(), "label": label, "x": x, "y": y, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }
    
    @objc public func recordLongPressEvent(label: String, x: UInt64, y: UInt64) {
        _enqueue(["type": "gesture", "gestureType": "long_press", "timestamp": _ts(), "label": label, "x": x, "y": y, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }
    
    @objc public func recordPinchEvent(label: String, x: UInt64, y: UInt64, scale: Double) {
        _enqueue(["type": "gesture", "gestureType": "pinch", "timestamp": _ts(), "label": label, "x": x, "y": y, "scale": scale, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }
    
    @objc public func recordRotationEvent(label: String, x: UInt64, y: UInt64, angle: Double) {
        _enqueue(["type": "gesture", "gestureType": "rotation", "timestamp": _ts(), "label": label, "x": x, "y": y, "angle": angle, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }
    
    @objc public func recordInputEvent(value: String, redacted: Bool, label: String) {
        _lastResponseTs = _ts()   // keyboard input = definitive response
        _enqueue(["type": "input", "timestamp": _ts(), "value": redacted ? "***" : value, "redacted": redacted, "label": label])
    }
    
    @objc public func recordViewTransition(viewId: String, viewLabel: String, entering: Bool) {
        _lastResponseTs = _ts()   // navigation = definitive response
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
    
    // MARK: - Dead Tap Timer
    
    private func _cancelDeadTapTimer() {
        _deadTapTimer?.cancel()
        _deadTapTimer = nil
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
