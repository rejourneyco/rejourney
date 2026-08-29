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

@objc(RJNativeTelemetryPipeline)
final class TelemetryPipeline: NSObject {

    @objc static let shared = TelemetryPipeline()

    @objc var endpoint = "https://api.rejourney.co" {
        didSet { SegmentDispatcher.shared.endpoint = endpoint }
    }

    private let _sessionStateLock = NSLock()
    private var _currentReplayId: String?

    @objc var currentReplayId: String? {
        get {
            _sessionStateLock.lock()
            defer { _sessionStateLock.unlock() }
            return _currentReplayId
        }
        set {
            _sessionStateLock.lock()
            _currentReplayId = newValue
            _sessionStateLock.unlock()
            SegmentDispatcher.shared.currentReplayId = newValue
        }
    }

    var credential: String? {
        didSet { SegmentDispatcher.shared.credential = credential }
    }

    var apiToken: String? {
        didSet { SegmentDispatcher.shared.apiToken = apiToken }
    }

    var projectId: String? {
        didSet { SegmentDispatcher.shared.projectId = projectId }
    }

    /// SDK's sampling decision for server-side enforcement
    var isSampledIn: Bool = true {
        didSet { SegmentDispatcher.shared.isSampledIn = isSampledIn }
    }

    /// Remote-config privacy control. When off, batches carry only the
    /// timestamp and no hardware, OS, vendor or network identifiers.
    var collectDeviceInfo: Bool = true

    private let _deviceEnvironmentMonitor = DeviceEnvironmentMonitor()

    /// Returns a low-cardinality battery snapshot for public device-info APIs.
    /// Active sessions are notification-backed; inactive reads are one-shot
    /// and restore the host application's UIDevice monitoring preference.
    func currentBatteryInfo() -> [String: Any] {
        _deviceEnvironmentMonitor.currentBatterySnapshot()
    }

    func sessionDeviceMetrics() -> [String: Any] {
        guard collectDeviceInfo else { return [:] }
        return _deviceEnvironmentMonitor.sessionSummary()
    }

    private let _eventRing = EventRingBuffer(capacity: 5000)
    private let _frameQueue = FrameBundleQueue(maxPending: 200)
    private var _batchSeqBySession: [String: Int] = [:]
    private var _batchSequenceOrder: [String] = []
    private let _maxTrackedBatchSequences = 128
    private let _drainRegistry = DrainCompletionRegistry()
    private let _backgroundTaskLock = NSLock()
    private var _backgroundTasksByGeneration: [UInt64: UIBackgroundTaskIdentifier] = [:]

    private let _serialWorker = DispatchQueue(label: "co.rejourney.telemetry", qos: .utility)
    private var _heartbeat: Timer?
    private let _metadataLock = NSLock()
    private var _staticMetadata: [String: Any] = [:]
    private var _acceptingEvents = false
    private var _captureStateLock = os_unfair_lock_s()

    private let _batchSizeLimit = 500_000

    // Dead tap detection — timestamp comparison.
    // After a tap, a 400ms timer fires and checks whether any "response" event
    // (navigation, input, haptics, or animation) occurred since the tap.  If not → dead tap.
    // We do NOT cancel the timer proactively because gesture-recognizer scroll
    // events fire on nearly every tap due to micro-movement and would mask real dead taps.
    private static let _deadTapTimeoutSec: Double = 0.4
    private var _deadTapTimer: DispatchWorkItem?
    private var _deadTapGeneration: UInt64 = 0
    private var _lastResponseTs: Int64 = 0
    private let _keyboardStateLock = NSLock()
    private var _isKeyboardVisible = false
    private var _keyboardScreenFrame: CGRect?

    @objc var isKeyboardVisible: Bool {
        _keyboardStateLock.lock()
        let cached = _isKeyboardVisible
        _keyboardStateLock.unlock()

        guard !cached, Thread.isMainThread else { return cached }
        if let frame = _visibleKeyboardScreenFrame() {
            _setKeyboardVisible(true, frame: frame)
            return true
        }
        return false
    }

    func isPointInsideKeyboardArea(_ point: CGPoint) -> Bool {
        _keyboardStateLock.lock()
        let cachedVisible = _isKeyboardVisible
        let cachedFrame = _keyboardScreenFrame
        _keyboardStateLock.unlock()

        if cachedVisible, let frame = cachedFrame, frame.insetBy(dx: -8, dy: -8).contains(point) {
            return true
        }

        guard Thread.isMainThread, let scannedFrame = _visibleKeyboardScreenFrame() else {
            return false
        }

        _setKeyboardVisible(true, frame: scannedFrame)
        return scannedFrame.insetBy(dx: -8, dy: -8).contains(point)
    }

    /// Call this when haptic feedback, animations, or other UI responses occur.
    /// This prevents the current tap from being marked as a "dead tap".
    @objc func markResponseReceived() {
        _setLastResponseTimestamp(_ts())
    }

    private override init() {
        super.init()
    }

    @objc func activate() {
        _setAcceptingEvents(true)
        if Thread.isMainThread {
            _refreshStaticMetadataOnMain()
        } else {
            DispatchQueue.main.async { [weak self] in self?._refreshStaticMetadataOnMain() }
        }
        if collectDeviceInfo {
            _deviceEnvironmentMonitor.start(resetSession: true)
        } else {
            _deviceEnvironmentMonitor.clearSession()
        }

        // Upload any pending data from previous sessions first
        _uploadPendingSessions()

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard self._isAcceptingEvents() else { return }
            // A run loop keeps a strong reference to a scheduled timer, so
            // dropping the last reference does not stop it. Re-activating for a
            // new session without invalidating first would leave the previous
            // heartbeat firing dispatchNow() for the rest of the process.
            self._heartbeat?.invalidate()
            // Industry standard: Use default run loop mode (NOT .common)
            // This lets the timer pause during scrolling which prevents stutter
            self._heartbeat = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
                self?.dispatchNow()
            }
        }

        NotificationCenter.default.addObserver(self, selector: #selector(_appSuspending), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(_appSuspending), name: UIApplication.willTerminateNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(_keyboardWillShow(_:)), name: UIResponder.keyboardWillShowNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(_keyboardDidShow(_:)), name: UIResponder.keyboardDidShowNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(_keyboardDidHide), name: UIResponder.keyboardDidHideNotification, object: nil)
        if Thread.isMainThread {
            let frame = _visibleKeyboardScreenFrame()
            _setKeyboardVisible(frame != nil, frame: frame)
        } else {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                let frame = self._visibleKeyboardScreenFrame()
                self._setKeyboardVisible(frame != nil, frame: frame)
            }
        }
    }

    /// Pause the heartbeat timer when the app goes to background.
    /// This prevents the pipeline from uploading empty event batches
    /// while backgrounded, which would inflate session duration.
    @objc func pause() {
        _setAcceptingEvents(false)
        _cancelDeadTapTimer()
        _deviceEnvironmentMonitor.pause()
        DispatchQueue.main.async { [weak self] in
            guard let self, !self._isAcceptingEvents() else { return }
            self._heartbeat?.invalidate()
            self._heartbeat = nil
        }
    }

    /// Resume the heartbeat timer when the app returns to foreground.
    @objc func resume() {
        _setAcceptingEvents(true)
        if collectDeviceInfo { _deviceEnvironmentMonitor.start(resetSession: false) }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard self._isAcceptingEvents(), self._heartbeat == nil else { return }
            self._heartbeat = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
                self?.dispatchNow()
            }
        }
    }

    @objc func shutdown() {
        shutdown(completion: nil)
    }

    func shutdown(completion: (() -> Void)? = nil, skipVisualFlush: Bool = false) {
        _setAcceptingEvents(false)
        _cancelDeadTapTimer()
        _deviceEnvironmentMonitor.pause()
        if Thread.isMainThread {
            _heartbeat?.invalidate()
            _heartbeat = nil
        } else {
            DispatchQueue.main.async { [weak self] in
                self?._heartbeat?.invalidate()
                self?._heartbeat = nil
            }
        }
        NotificationCenter.default.removeObserver(self)

        _drainPendingDataForShutdown(completion: completion, skipVisualFlush: skipVisualFlush)
    }

    @objc func finalizeAndShip() {
        shutdown()
    }

    @objc func submitFrameBundle(payload: Data, filename: String, startMs: UInt64, endMs: UInt64, frameCount: Int, sessionId: String? = nil) {
        // Capture the session ID now so frames are always attributed to the
        // session that was active when they were captured, not when they ship.
        let capturedSessionId = sessionId ?? currentReplayId
        _serialWorker.async {
            let bundle = PendingFrameBundle(tag: filename, payload: payload, rangeStart: startMs, rangeEnd: endMs, count: frameCount, sessionId: capturedSessionId)
            self._frameQueue.enqueue(bundle)
            self._shipPendingFrames()
        }
    }

    @objc func prepareForNewSession(_ replayId: String) {
        // Pending work is session-owned. A previous session drain may still be
        // running here; its completion remains bound to its own generation and
        // must not be fired merely because this replacement session starts.
        _serialWorker.async { [weak self] in
            guard let self else { return }
            if self._batchSeqBySession[replayId] == nil {
                self._batchSeqBySession[replayId] = 0
                self._batchSequenceOrder.append(replayId)
            }
            let protectedSessions = self._eventRing.sessionIds()
            while self._batchSequenceOrder.count > self._maxTrackedBatchSequences,
                  let staleIndex = self._batchSequenceOrder.firstIndex(where: {
                      $0 != replayId && !protectedSessions.contains($0)
                  }) {
                let staleSession = self._batchSequenceOrder.remove(at: staleIndex)
                self._batchSeqBySession.removeValue(forKey: staleSession)
            }
        }
    }

    @objc func dispatchNow() {
        _serialWorker.async {
            self._shipPendingEvents()
            self._shipPendingFrames()
        }
    }

    @objc func getQueueDepth() -> Int {
        _eventRing.count + _frameQueue.count
    }

    private func _drainPendingDataForShutdown(completion: (() -> Void)? = nil, skipVisualFlush: Bool = false) {
        let drainGeneration = _drainRegistry.begin(completion: completion)
        _beginBackgroundTask(named: "RejourneyShutdownFlush", generation: drainGeneration)

        if !skipVisualFlush {
            // Force any in-memory frames into the upload pipeline before session
            // teardown clears the active replay ID.
            VisualCapture.shared.flushToDisk()
            VisualCapture.shared.flushBufferToNetwork()
        }

        // FIX: flushBufferToNetwork() submits encode work to VisualCapture._encodeQueue,
        // which then dispatches frame bundles to _serialWorker. Without waiting for the
        // encode queue, _shipPendingFrames() below races and often runs before those bundles
        // are in _frameQueue — causing them to be missed entirely.
        //
        // We wait on a background thread (not main, not _serialWorker) to avoid blocking
        // either of those queues, then chain the ship + upload-wait onto _serialWorker.
        DispatchQueue.global(qos: .utility).async { [weak self] in
            // Step A: wait for encode queue — ensures _frameQueue is fully populated
            VisualCapture.shared.waitForEncodingToComplete()

            // Step B: ship events + frames on the serial worker
            self?._serialWorker.async { [weak self] in
                self?._shipAllPendingForDrain()

                // Step C: wait for all in-flight uploads before ending the background task.
                // Timeout is 25s — well within iOS's ~30s background budget.
                SegmentDispatcher.shared.waitForPendingUploads(timeout: 25.0)
                self?._finishDrain(drainGeneration)
            }
        }
    }

    @objc private func _appSuspending() {
        let drainGeneration = _drainRegistry.begin()

        // Request background time to complete uploads
        _beginBackgroundTask(named: "RejourneyFlush", generation: drainGeneration)

        // Flush visual frames to disk for crash safety
        VisualCapture.shared.flushToDisk()
        // Submit any buffered frames to the upload pipeline (even if below batch threshold)
        VisualCapture.shared.flushBufferToNetwork()

        // FIX: same encode-queue race fix as _drainPendingDataForShutdown above.
        // Replaces the previous hardcoded 2-second sleep with a real upload completion wait.
        DispatchQueue.global(qos: .utility).async { [weak self] in
            VisualCapture.shared.waitForEncodingToComplete()

            self?._serialWorker.async { [weak self] in
                self?._shipAllPendingForDrain()
                SegmentDispatcher.shared.waitForPendingUploads(timeout: 25.0)
                self?._finishDrain(drainGeneration)
            }
        }
    }

    @objc private func _keyboardWillShow(_ notification: Notification) {
        _setLastResponseTimestamp(_ts())
        _setKeyboardVisible(true, frame: _keyboardScreenFrame(from: notification))
        _cancelDeadTapTimer()
    }

    @objc private func _keyboardDidShow(_ notification: Notification) {
        _setLastResponseTimestamp(_ts())
        _setKeyboardVisible(true, frame: _keyboardScreenFrame(from: notification) ?? _visibleKeyboardScreenFrame())
        _cancelDeadTapTimer()
    }

    @objc private func _keyboardDidHide() {
        _setLastResponseTimestamp(_ts())
        let frame = _visibleKeyboardScreenFrame()
        _setKeyboardVisible(frame != nil, frame: frame)
    }

    private func _setKeyboardVisible(_ visible: Bool, frame: CGRect? = nil) {
        _keyboardStateLock.lock()
        _isKeyboardVisible = visible
        _keyboardScreenFrame = visible ? frame : nil
        _keyboardStateLock.unlock()
    }

    private func _keyboardScreenFrame(from notification: Notification) -> CGRect? {
        guard let frame = (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else {
            return nil
        }
        guard frame.width > 0, frame.height > 0 else { return nil }
        guard frame.origin.x.isFinite, frame.origin.y.isFinite, frame.width.isFinite, frame.height.isFinite else { return nil }
        guard !frame.origin.x.isNaN, !frame.origin.y.isNaN, !frame.width.isNaN, !frame.height.isNaN else { return nil }
        return _keyboardFrameInKeyWindow(fromScreenFrame: frame)
    }

    private func _visibleKeyboardScreenFrame() -> CGRect? {
        var combined: CGRect?
        for window in UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap({ $0.windows }) {
            guard !window.isHidden, window.alpha > 0.01, window.bounds.width > 0, window.bounds.height > 0 else {
                continue
            }
            let className = String(describing: type(of: window))
            guard className.contains("UIRemoteKeyboardWindow") ||
                className.contains("UITextEffectsWindow") ||
                className.contains("UIInputSetHostView") ||
                className.contains("UIKeyboard") else {
                continue
            }
            let screenRect = window.convert(window.bounds, to: nil)
            guard let rect = _keyboardFrameInKeyWindow(fromScreenFrame: screenRect) else { continue }
            guard rect.width > 0, rect.height > 0 else { continue }
            guard rect.origin.x.isFinite, rect.origin.y.isFinite, rect.width.isFinite, rect.height.isFinite else { continue }
            combined = combined.map { $0.union(rect) } ?? rect
        }
        return combined
    }

    private func _keyboardFrameInKeyWindow(fromScreenFrame frame: CGRect) -> CGRect? {
        guard let keyWindow = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap({ $0.windows })
            .first(where: { $0.isKeyWindow }) else {
            return frame
        }

        let converted = keyWindow.convert(frame, from: keyWindow.screen.coordinateSpace)
        let clipped = converted.intersection(keyWindow.bounds)
        guard clipped.width > 0, clipped.height > 0 else { return nil }
        guard clipped.origin.x.isFinite, clipped.origin.y.isFinite, clipped.width.isFinite, clipped.height.isFinite else { return nil }
        guard !clipped.origin.x.isNaN, !clipped.origin.y.isNaN, !clipped.width.isNaN, !clipped.height.isNaN else { return nil }
        return clipped
    }

    private func _beginBackgroundTask(named name: String, generation: UInt64) {
        // Register a sentinel before asking UIKit for background time. The
        // expiration handler is allowed to run as soon as the task is created;
        // without this entry it could finish the drain before `taskId` is
        // stored, leaving the real task identifier orphaned and never ended.
        _backgroundTaskLock.lock()
        _backgroundTasksByGeneration[generation] = .invalid
        _backgroundTaskLock.unlock()

        let taskId = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            self?._finishDrain(generation)
        }

        _backgroundTaskLock.lock()
        let drainStillRegistered = _backgroundTasksByGeneration[generation] != nil
        if drainStillRegistered {
            _backgroundTasksByGeneration[generation] = taskId
        }
        _backgroundTaskLock.unlock()

        // Expiration won the race and removed the sentinel while UIKit was
        // returning the identifier. End that identifier immediately instead
        // of putting it back into a completed drain.
        if !drainStillRegistered, taskId != .invalid {
            DispatchQueue.main.async {
                UIApplication.shared.endBackgroundTask(taskId)
            }
        }
    }

    private func _finishDrain(_ generation: UInt64) {
        guard let completions = _drainRegistry.finish(generation) else { return }
        _backgroundTaskLock.lock()
        let backgroundTaskId = _backgroundTasksByGeneration.removeValue(forKey: generation)
        _backgroundTaskLock.unlock()

        DispatchQueue.main.async {
            if let backgroundTaskId, backgroundTaskId != .invalid {
                UIApplication.shared.endBackgroundTask(backgroundTaskId)
            }
            completions.forEach { $0() }
        }
    }

    private func _uploadPendingSessions() {
        // Intentionally deferred: crash/interruption recovery currently restores
        // pending visual frames via ReplayOrchestrator + VisualCapture only.
        // Telemetry events remain best-effort and are not replayed from EventBuffer yet.
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
        let networkType = ReplayOrchestrator.shared.currentNetworkType
        let isConstrained = ReplayOrchestrator.shared.networkIsConstrained
        let isExpensive = ReplayOrchestrator.shared.networkIsExpensive

        var meta: [String: Any] = [
            "platform": "ios",
            "time": Date().timeIntervalSince1970,
            "sdkVersion": RejourneySDKInfo.version
        ]
        meta.merge(_staticMetadataSnapshot()) { _, new in new }
        if collectDeviceInfo {
            meta.merge([
                "networkType": networkType,
                "isConstrained": isConstrained,
                "isExpensive": isExpensive
            ]) { _, new in new }
            meta.merge(_deviceEnvironmentMonitor.currentSnapshot()) { _, new in new }
        }

        let wrapper: [String: Any] = ["events": events, "deviceInfo": meta]
        return (try? JSONSerialization.data(withJSONObject: wrapper)) ?? Data()
    }

    /// Drain every immediately available batch before waiting on the network.
    /// Normal heartbeat dispatch sends one batch at a time for backpressure,
    /// but shutdown must enqueue the complete backlog before completing.
    private func _shipAllPendingForDrain() {
        while _eventRing.count > 0 {
            let before = _eventRing.count
            _shipPendingEvents()
            if _eventRing.count >= before { break }
        }
        while _frameQueue.count > 0 {
            let before = _frameQueue.count
            _shipPendingFrames()
            if _frameQueue.count >= before { break }
        }
    }

    private func _shipPendingFrames() {
        guard let next = _frameQueue.dequeue() else { return }

        let activeSession = currentReplayId
        let targetSession = next.sessionId ?? activeSession
        guard let targetSession else {
            _frameQueue.requeue(next)
            return
        }

        if let bundleSession = next.sessionId, bundleSession != currentReplayId {
            DiagnosticLog.trace("[TelemetryPipeline] Routing \(next.count) frames to captured session \(bundleSession) (current=\(currentReplayId ?? "nil"))")
        }

        SegmentDispatcher.shared.transmitFrameBundle(
            for: targetSession,
            payload: next.payload,
            startMs: next.rangeStart,
            endMs: next.rangeEnd,
            frameCount: next.count
        ) { [weak self] ok in
            if !ok {
                if let bundleSession = next.sessionId,
                   let latestSession = self?.currentReplayId,
                   bundleSession != latestSession {
                    DiagnosticLog.trace("[TelemetryPipeline] Discarding failed stale frame bundle for closed session \(bundleSession.prefix(20)) (current=\(latestSession.prefix(20)))")
                    self?._serialWorker.async { self?._shipPendingFrames() }
                } else {
                    self?._frameQueue.requeue(next)
                }
            } else {
                self?._serialWorker.async { self?._shipPendingFrames() }
            }
        }
    }

    private func _shipPendingEvents() {
        let batch = _eventRing.drain(maxBytes: _batchSizeLimit)
        guard !batch.isEmpty else { return }

        let targetSession = batch.first?.sessionId ?? currentReplayId
        guard let targetSession else {
            _eventRing.prepend(batch)
            return
        }

        let payload = _serializeBatch(events: batch)
        guard let compressed = payload.gzipCompress() else {
            _eventRing.prepend(batch)
            return
        }

        if _batchSeqBySession[targetSession] == nil {
            _batchSequenceOrder.append(targetSession)
        }
        let seq = _batchSeqBySession[targetSession] ?? 0
        _batchSeqBySession[targetSession] = seq + 1

        SegmentDispatcher.shared.transmitEventBatch(
            for: targetSession,
            payload: compressed,
            batchNumber: seq,
            eventCount: batch.count
        ) { [weak self] ok in
            if !ok, self?.currentReplayId == targetSession {
                self?._eventRing.prepend(batch)
                return
            }
            if !ok {
                DiagnosticLog.trace("[TelemetryPipeline] Discarding exhausted event batch for closed session \(targetSession.prefix(20))")
            }
            self?._serialWorker.async { self?._shipPendingEvents() }
        }
    }

    private func _serializeBatch(events: [EventEntry]) -> Data {
        var jsonEvents: [[String: Any]] = []
        for e in events {
            var clean = e.data
            if clean.last == 0x0A { clean = clean.dropLast() }
            if let obj = try? JSONSerialization.jsonObject(with: clean) as? [String: Any] { jsonEvents.append(obj) }
        }

        // Get current network state from orchestrator
        let networkType = ReplayOrchestrator.shared.currentNetworkType
        let isConstrained = ReplayOrchestrator.shared.networkIsConstrained
        let isExpensive = ReplayOrchestrator.shared.networkIsExpensive

        var meta: [String: Any] = [
            "platform": "ios",
            "time": Date().timeIntervalSince1970,
            "sdkVersion": RejourneySDKInfo.version
        ]
        meta.merge(_staticMetadataSnapshot()) { _, new in new }
        if collectDeviceInfo {
            meta.merge([
                "networkType": networkType,
                "isConstrained": isConstrained,
                "isExpensive": isExpensive
            ]) { _, new in new }
            meta.merge(_deviceEnvironmentMonitor.currentSnapshot()) { _, new in new }
        }

        let wrapper: [String: Any] = ["events": jsonEvents, "deviceInfo": meta]
        return (try? JSONSerialization.data(withJSONObject: wrapper)) ?? Data()
    }

    @objc func recordAttribute(key: String, value: String) {
        let payload = RejourneyEventSerializer.jsonString(from: [
            "key": key,
            "value": value
        ])
        _enqueue(["type": "custom", "timestamp": _ts(), "name": "attribute", "payload": payload])
    }

    @objc func recordCustomEvent(name: String, payload: String) {
        _enqueue(["type": "custom", "timestamp": _ts(), "name": name, "payload": payload])
    }

    @objc func recordConsoleLogEvent(level: String, message: String) {
        _enqueue([
            "type": "log",
            "timestamp": _ts(),
            "level": level,
            "message": message
        ])
    }

    /// The trailing fields are optional because only some hosts supply them:
    /// React Native and Flutter forward the framework's own error metadata,
    /// while a native call site has just the three basics. Not @objc -- every
    /// caller is Swift, and defaulted arguments would not survive the bridge.
    func recordJSErrorEvent(
        name: String,
        message: String,
        stack: String?,
        incidentId: String? = nil,
        exceptionCategory: String? = nil,
        source: String? = nil,
        handled: Bool? = nil
    ) {
        var event: [String: Any] = [
            "type": "error",
            "timestamp": _ts(),
            "name": name,
            "message": message
        ]
        if let stack = stack {
            event["stack"] = stack
        }
        if let incidentId {
            event["incidentId"] = incidentId
        }
        if let exceptionCategory {
            event["exceptionCategory"] = exceptionCategory
        }
        if let source {
            event["source"] = source
        }
        if let handled {
            event["handled"] = handled
        }
        _enqueue(event)
        // Prioritize JS error delivery to reduce loss on fatal terminations.
        _serialWorker.async { [weak self] in
            self?._shipPendingEvents()
        }
    }

    @objc func recordAnrEvent(durationMs: Int, stack: String?, incidentId: String? = nil) {
        var event: [String: Any] = [
            "type": "anr",
            "timestamp": _ts(),
            "durationMs": durationMs,
            "threadState": "blocked"
        ]
        if let stack = stack {
            event["stack"] = stack
        }
        if let incidentId {
            event["incidentId"] = incidentId
        }
        _enqueue(event)
        // Prioritize ANR delivery while the process is still alive.
        _serialWorker.async { [weak self] in
            self?._shipPendingEvents()
        }
    }

    @objc func recordUserAssociation(_ userId: String) {
        _enqueue(["type": "user_identity_changed", "timestamp": _ts(), "userId": userId])
    }

    @objc func recordTapEvent(label: String, x: UInt64, y: UInt64, isInteractive: Bool = false) {
        // A newer tap supersedes the previous dead-tap candidate. Without this,
        // the old work item remains scheduled and can report a false dead tap.
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
        let tapLabel = label
        let tapX = x
        let tapY = y
        let deadTapGeneration = _currentDeadTapGeneration()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            guard TelemetryPipeline.shouldEmitDeadTap(
                candidateGeneration: deadTapGeneration,
                currentGeneration: self._currentDeadTapGeneration(),
                lastResponseTimestamp: self._lastResponseTimestamp(),
                tapTimestamp: tapTs
            ) else { return }
            self._deadTapTimer = nil
            self.recordDeadTapEvent(label: tapLabel, x: tapX, y: tapY)
            ReplayOrchestrator.shared.incrementDeadTapTally()
        }
        _deadTapTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + TelemetryPipeline._deadTapTimeoutSec, execute: work)
    }

    @objc func recordRageTapEvent(label: String, x: UInt64, y: UInt64, count: Int) {
        // The taps collapsed into a rage gesture must not also become a dead tap.
        _cancelDeadTapTimer()
        // Cross-version safety for users who update the backend before app
        // binaries. Backend still understands Swift 0.2.x rage/dead tap shapes,
        // but current package builds must not create frustration events inside
        // the keyboard placeholder area.
        guard !isPointInsideKeyboardArea(CGPoint(x: CGFloat(x), y: CGFloat(y))) else { return }
        let timestamp = _ts()
        _enqueue([
            "type": "gesture",
            "gestureType": "rage_tap",
            "timestamp": timestamp,
            "label": label,
            "x": x,
            "y": y,
            "count": count,
            "frustrationKind": "rage_tap",
            "touches": [["x": x, "y": y, "timestamp": timestamp]]
        ])
    }

    @objc func recordDeadTapEvent(label: String, x: UInt64, y: UInt64) {
        // See recordRageTapEvent: keyboard-region taps are normal typing, never
        // frustration, regardless of backend/package version skew.
        guard !isPointInsideKeyboardArea(CGPoint(x: CGFloat(x), y: CGFloat(y))) else { return }
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

    @objc func recordSwipeEvent(label: String, x: UInt64, y: UInt64, direction: String) {
        _enqueue(["type": "gesture", "gestureType": "swipe", "timestamp": _ts(), "label": label, "x": x, "y": y, "direction": direction, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }

    @objc func recordScrollEvent(label: String, x: UInt64, y: UInt64, direction: String) {
        // NOTE: Do NOT mark scroll as a "response" for dead tap detection.
        // Gesture recognisers classify micro-movement during a tap as a scroll,
        // which would mask nearly every dead tap.  Only navigation and input
        // count as definitive responses.
        _enqueue(["type": "gesture", "gestureType": "scroll", "timestamp": _ts(), "label": label, "x": x, "y": y, "direction": direction, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }

    @objc func recordPanEvent(label: String, x: UInt64, y: UInt64) {
        _enqueue(["type": "gesture", "gestureType": "pan", "timestamp": _ts(), "label": label, "x": x, "y": y, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }

    @objc func recordLongPressEvent(label: String, x: UInt64, y: UInt64) {
        _enqueue(["type": "gesture", "gestureType": "long_press", "timestamp": _ts(), "label": label, "x": x, "y": y, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }

    @objc func recordPinchEvent(label: String, x: UInt64, y: UInt64, scale: Double) {
        _enqueue(["type": "gesture", "gestureType": "pinch", "timestamp": _ts(), "label": label, "x": x, "y": y, "scale": scale, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }

    @objc func recordRotationEvent(label: String, x: UInt64, y: UInt64, angle: Double) {
        _enqueue(["type": "gesture", "gestureType": "rotation", "timestamp": _ts(), "label": label, "x": x, "y": y, "angle": angle, "touches": [["x": x, "y": y, "timestamp": _ts()]]])
    }

    @objc func recordInputEvent(value: String, redacted: Bool, label: String) {
        _setLastResponseTimestamp(_ts())   // keyboard input = definitive response
        _enqueue(["type": "input", "timestamp": _ts(), "value": redacted ? "***" : value, "redacted": redacted, "label": label])
    }

    @objc func recordViewTransition(viewId: String, viewLabel: String, entering: Bool) {
        _setLastResponseTimestamp(_ts())   // navigation = definitive response
        _enqueue(["type": "navigation", "timestamp": _ts(), "screen": viewLabel, "screenName": viewLabel, "viewId": viewId, "entering": entering])
    }

    @objc func recordNetworkEvent(details: [String: Any]) {
        guard !RejourneyNetworkEventFilter.shouldIgnore(details: details) else { return }
        var e = details
        e["type"] = "network_request"
        e["timestamp"] = _ts()
        _enqueue(e)
    }

    @objc func recordAppStartup(durationMs: Int64) {
        _enqueue([
            "type": "app_startup",
            "timestamp": _ts(),
            "durationMs": durationMs,
            "platform": "ios"
        ])
    }

    @objc func recordAppForeground(totalBackgroundTimeMs: UInt64) {
        _enqueue([
            "type": "app_foreground",
            "timestamp": _ts(),
            "totalBackgroundTime": totalBackgroundTimeMs
        ])
    }

    @objc func recordAppBackground() {
        _enqueue([
            "type": "app_background",
            "timestamp": _ts(),
        ])
    }

    // MARK: - Dead Tap Timer

    private func _cancelDeadTapTimer() {
        os_unfair_lock_lock(&_captureStateLock)
        _deadTapGeneration &+= 1
        os_unfair_lock_unlock(&_captureStateLock)
        _deadTapTimer?.cancel()
        _deadTapTimer = nil
    }

    private func _currentDeadTapGeneration() -> UInt64 {
        os_unfair_lock_lock(&_captureStateLock)
        defer { os_unfair_lock_unlock(&_captureStateLock) }
        return _deadTapGeneration
    }

    private func _setLastResponseTimestamp(_ timestamp: Int64) {
        os_unfair_lock_lock(&_captureStateLock)
        _lastResponseTs = timestamp
        os_unfair_lock_unlock(&_captureStateLock)
    }

    private func _lastResponseTimestamp() -> Int64 {
        os_unfair_lock_lock(&_captureStateLock)
        defer { os_unfair_lock_unlock(&_captureStateLock) }
        return _lastResponseTs
    }

    static func shouldEmitDeadTap(
        candidateGeneration: UInt64,
        currentGeneration: UInt64,
        lastResponseTimestamp: Int64,
        tapTimestamp: Int64
    ) -> Bool {
        candidateGeneration == currentGeneration && lastResponseTimestamp <= tapTimestamp
    }

    private func _refreshStaticMetadataOnMain() {
        dispatchPrecondition(condition: .onQueue(.main))
        let device = UIDevice.current
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: { $0.isKeyWindow })
        let screen = window?.screen ?? UIScreen.main
        let bounds = screen.bounds
        let scale = screen.scale
        let hardwareModel = (DeviceRegistrar.shared.gatherDeviceProfile()["hwModel"] as? String) ?? device.model

        var metadata: [String: Any] = [
            // Rendering geometry and app identity are required to interpret
            // replay coordinates and releases; they do not identify a device.
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
            "appId": Bundle.main.bundleIdentifier ?? "unknown",
            "screenWidth": Int(bounds.width),
            "screenHeight": Int(bounds.height),
            "screenWidthPixels": Int(bounds.width * scale),
            "screenHeightPixels": Int(bounds.height * scale),
            "screenScale": scale,
            "pixelRatio": scale,
            "coordinateSpace": "pt"
        ]
        if collectDeviceInfo {
            metadata.merge([
                "model": hardwareModel,
                "osVersion": device.systemVersion,
                "vendorId": device.identifierForVendor?.uuidString ?? "",
                "systemName": device.systemName,
                "name": device.name
            ]) { _, new in new }
        }

        _metadataLock.lock()
        _staticMetadata = metadata
        _metadataLock.unlock()
    }

    private func _staticMetadataSnapshot() -> [String: Any] {
        _metadataLock.lock()
        defer { _metadataLock.unlock() }
        return _staticMetadata
    }

    private func _enqueue(_ dict: [String: Any]) {
        os_unfair_lock_lock(&_captureStateLock)
        let acceptingEvents = _acceptingEvents
        os_unfair_lock_unlock(&_captureStateLock)
        guard acceptingEvents else { return }

        // Keep in memory ring for immediate upload
        guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return }
        var d = data
        d.append(0x0A)
        guard d.count <= _batchSizeLimit else {
            DiagnosticLog.caution("[TelemetryPipeline] Dropping oversized event (\(d.count) bytes)")
            return
        }
        _eventRing.push(EventEntry(data: d, size: d.count, sessionId: currentReplayId))
    }

    private func _ts() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    private func _setAcceptingEvents(_ accepting: Bool) {
        os_unfair_lock_lock(&_captureStateLock)
        _acceptingEvents = accepting
        os_unfair_lock_unlock(&_captureStateLock)
    }

    private func _isAcceptingEvents() -> Bool {
        os_unfair_lock_lock(&_captureStateLock)
        let accepting = _acceptingEvents
        os_unfair_lock_unlock(&_captureStateLock)
        return accepting
    }
}

/// Owns drain callbacks by generation. Encoding/upload drains execute on one
/// serial worker, but their waits can overlap a lifecycle rollover. Independent
/// tokens prevent either drain from completing the other session early.
final class DrainCompletionRegistry {
    private let lock = NSLock()
    private var nextGeneration: UInt64 = 0
    private var activeGenerations: Set<UInt64> = []
    private var completionsByGeneration: [UInt64: [() -> Void]] = [:]

    func begin(completion: (() -> Void)? = nil) -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        nextGeneration &+= 1
        let generation = nextGeneration
        activeGenerations.insert(generation)
        if let completion { completionsByGeneration[generation] = [completion] }
        return generation
    }

    func finish(_ generation: UInt64) -> [() -> Void]? {
        lock.lock()
        defer { lock.unlock() }
        guard activeGenerations.remove(generation) != nil else { return nil }
        return completionsByGeneration.removeValue(forKey: generation) ?? []
    }
}

struct EventEntry {
    let data: Data
    let size: Int
    let sessionId: String?
}

final class EventRingBuffer {
    private var _storage: ContiguousArray<EventEntry?>
    private let _capacity: Int
    private var _head = 0
    private var _count = 0
    private let _lock = NSLock()

    init(capacity: Int) {
        _capacity = max(1, capacity)
        _storage = ContiguousArray(repeating: nil, count: max(1, capacity))
    }

    var count: Int {
        _lock.lock()
        defer { _lock.unlock() }
        return _count
    }

    func sessionIds() -> Set<String> {
        _lock.lock()
        defer { _lock.unlock() }
        return Set(_storage.compactMap { $0?.sessionId })
    }

    func push(_ entry: EventEntry) {
        _lock.lock()
        defer { _lock.unlock() }
        if _count == _capacity {
            _storage[_head] = entry
            _head = (_head + 1) % _capacity
        } else {
            let tail = (_head + _count) % _capacity
            _storage[tail] = entry
            _count += 1
        }
    }

    func prepend(_ entries: [EventEntry]) {
        guard !entries.isEmpty else { return }
        _lock.lock()
        defer { _lock.unlock() }
        for entry in entries.reversed() {
            if _count == _capacity {
                let tail = (_head + _count - 1) % _capacity
                _storage[tail] = nil
                _count -= 1
            }
            _head = (_head - 1 + _capacity) % _capacity
            _storage[_head] = entry
            _count += 1
        }
    }

    func drain(maxBytes: Int) -> [EventEntry] {
        _lock.lock()
        defer { _lock.unlock() }
        var result: [EventEntry] = []
        var total = 0
        var targetSession: String?
        while _count > 0, let next = _storage[_head] {
            if !result.isEmpty, next.sessionId != targetSession { break }
            if total + next.size > maxBytes { break }
            if result.isEmpty { targetSession = next.sessionId }
            result.append(next)
            total += next.size
            _storage[_head] = nil
            _head = (_head + 1) % _capacity
            _count -= 1
        }
        return result
    }

    func clear() -> Int {
        _lock.lock()
        defer { _lock.unlock() }
        let cleared = _count
        _storage = ContiguousArray(repeating: nil, count: _capacity)
        _head = 0
        _count = 0
        return cleared
    }
}

struct PendingFrameBundle {
    let tag: String
    let payload: Data
    let rangeStart: UInt64
    let rangeEnd: UInt64
    let count: Int
    let sessionId: String?
}

final class FrameBundleQueue {
    private var _queue: [PendingFrameBundle?]
    private let _maxPending: Int
    private var _head = 0
    private var _count = 0
    private let _lock = NSLock()

    init(maxPending: Int) {
        _maxPending = max(1, maxPending)
        _queue = Array(repeating: nil, count: max(1, maxPending))
    }

    var count: Int {
        _lock.lock()
        defer { _lock.unlock() }
        return _count
    }

    func enqueue(_ bundle: PendingFrameBundle) {
        _lock.lock()
        defer { _lock.unlock() }
        if _count == _maxPending {
            _queue[_head] = bundle
            _head = (_head + 1) % _maxPending
        } else {
            let tail = (_head + _count) % _maxPending
            _queue[tail] = bundle
            _count += 1
        }
    }

    func dequeue() -> PendingFrameBundle? {
        _lock.lock()
        defer { _lock.unlock() }
        guard _count > 0, let bundle = _queue[_head] else { return nil }
        _queue[_head] = nil
        _head = (_head + 1) % _maxPending
        _count -= 1
        return bundle
    }

    func requeue(_ bundle: PendingFrameBundle) {
        _lock.lock()
        defer { _lock.unlock() }
        _head = (_head - 1 + _maxPending) % _maxPending
        _queue[_head] = bundle
        if _count < _maxPending { _count += 1 }
    }

    func clear() -> Int {
        _lock.lock()
        defer { _lock.unlock() }
        let cleared = _count
        _queue = Array(repeating: nil, count: _maxPending)
        _head = 0
        _count = 0
        return cleared
    }
}
