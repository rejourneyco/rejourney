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
import Network
import QuartzCore

@objc(ReplayOrchestrator)
public final class ReplayOrchestrator: NSObject {
    
    @objc public static let shared = ReplayOrchestrator()
    
    @objc public var apiToken: String?
    @objc public var replayId: String?
    @objc public var replayStartMs: UInt64 = 0
    @objc public var deferredUploadMode = false
    @objc public var frameBundleSize: Int = 5
    
    public var serverEndpoint: String {
        get { TelemetryPipeline.shared.endpoint }
        set {
            TelemetryPipeline.shared.endpoint = newValue
            SegmentDispatcher.shared.endpoint = newValue
            DeviceRegistrar.shared.endpoint = newValue
        }
    }
    
    @objc public var snapshotInterval: Double = 1.0
    @objc public var compressionLevel: Double = 0.5
    @objc public var visualCaptureEnabled: Bool = true
    @objc public var interactionCaptureEnabled: Bool = true
    @objc public var faultTrackingEnabled: Bool = true
    @objc public var responsivenessCaptureEnabled: Bool = true
    @objc public var consoleCaptureEnabled: Bool = true
    @objc public var wifiRequired: Bool = false
    @objc public var hierarchyCaptureEnabled: Bool = true
    @objc public var hierarchyCaptureInterval: Double = 2.0
    @objc public private(set) var currentScreenName: String?
    
    // Remote config from backend (set via setRemoteConfig before session start)
    @objc public private(set) var remoteRejourneyEnabled: Bool = true
    @objc public private(set) var remoteRecordingEnabled: Bool = true
    @objc public private(set) var remoteSampleRate: Int = 100
    @objc public private(set) var remoteMaxRecordingMinutes: Int = 10
    
    private var _netMonitor: NWPathMonitor?
    private var _netReady = false
    private var _live = false
    
    // Network state tracking
    @objc public private(set) var currentNetworkType: String = "unknown"
    @objc public private(set) var currentCellularGeneration: String = "unknown"
    @objc public private(set) var networkIsConstrained: Bool = false
    @objc public private(set) var networkIsExpensive: Bool = false
    
    // App startup tracking - use actual process start time from kernel
    private static var processStartTime: TimeInterval = {
        // Get the actual process start time from the kernel
        var kinfo = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        
        if sysctl(&mib, UInt32(mib.count), &kinfo, &size, nil, 0) == 0 {
            let startSec = kinfo.kp_proc.p_starttime.tv_sec
            let startUsec = kinfo.kp_proc.p_starttime.tv_usec
            return TimeInterval(startSec) + TimeInterval(startUsec) / 1_000_000.0
        }
        // Fallback to current time if sysctl fails
        return Date().timeIntervalSince1970
    }()
    
    private var _crashCount = 0
    private var _freezeCount = 0
    private var _errorCount = 0
    private var _tapCount = 0
    private var _scrollCount = 0
    private var _gestureCount = 0
    private var _rageCount = 0
    private var _deadTapCount = 0
    private var _visitedScreens: [String] = []
    private var _bgTimeMs: UInt64 = 0
    private var _bgStartMs: UInt64?
    private var _finalized = false
    private var _hierarchyTimer: Timer?
    private var _lastHierarchyHash: String?
    private var _durationLimitTimer: DispatchWorkItem?
    
    private override init() {
        super.init()
    }
    
    /// Fast session start using existing credentials - skips credential fetch for faster restart
    @objc public func beginReplayFast(apiToken: String, serverEndpoint: String, credential: String, captureSettings: [String: Any]? = nil) {
        let perf = PerformanceSnapshot.capture()
        DiagnosticLog.debugSessionCreate(phase: "ORCHESTRATOR_FAST_INIT", details: "beginReplayFast with existing credential", perf: perf)
        
        self.apiToken = apiToken
        self.serverEndpoint = serverEndpoint
        _applySettings(captureSettings)
        
        // Set credentials AND endpoint directly without network fetch
        TelemetryPipeline.shared.apiToken = apiToken
        TelemetryPipeline.shared.credential = credential
        TelemetryPipeline.shared.endpoint = serverEndpoint
        SegmentDispatcher.shared.apiToken = apiToken
        SegmentDispatcher.shared.credential = credential
        SegmentDispatcher.shared.endpoint = serverEndpoint
        
        // Skip network monitoring, assume network is available since we just came from background
        DispatchQueue.main.async { [weak self] in
            self?._beginRecording(token: apiToken)
        }
    }
    
    @objc public func beginReplay(apiToken: String, serverEndpoint: String, captureSettings: [String: Any]? = nil) {
        let perf = PerformanceSnapshot.capture()
        DiagnosticLog.debugSessionCreate(phase: "ORCHESTRATOR_INIT", details: "beginReplay", perf: perf)
        
        self.apiToken = apiToken
        self.serverEndpoint = serverEndpoint
        _applySettings(captureSettings)
        
        DiagnosticLog.debugSessionCreate(phase: "CREDENTIAL_START", details: "Requesting device credential")
        
        DeviceRegistrar.shared.obtainCredential(apiToken: apiToken) { [weak self] ok, cred in
            guard let self, ok else {
                DiagnosticLog.debugSessionCreate(phase: "CREDENTIAL_FAIL", details: "Failed")
                return
            }
            
            TelemetryPipeline.shared.apiToken = apiToken
            TelemetryPipeline.shared.credential = cred
            SegmentDispatcher.shared.apiToken = apiToken
            SegmentDispatcher.shared.credential = cred
            
            self._monitorNetwork(token: apiToken)
        }
    }
    
    @objc public func beginDeferredReplay(apiToken: String, serverEndpoint: String, captureSettings: [String: Any]? = nil) {
        self.apiToken = apiToken
        self.serverEndpoint = serverEndpoint
        deferredUploadMode = true
        
        _applySettings(captureSettings)
        
        DeviceRegistrar.shared.obtainCredential(apiToken: apiToken) { [weak self] ok, cred in
            guard let self, ok else { return }
            TelemetryPipeline.shared.apiToken = apiToken
            TelemetryPipeline.shared.credential = cred
            SegmentDispatcher.shared.apiToken = apiToken
            SegmentDispatcher.shared.credential = cred
        }
        
        _initSession()
        TelemetryPipeline.shared.activateDeferredMode()
        
        let renderCfg = _computeRender(fps: 1, tier: "standard")
        
        if visualCaptureEnabled {
            VisualCapture.shared.configure(snapshotInterval: renderCfg.interval, jpegQuality: renderCfg.quality)
            VisualCapture.shared.beginCapture(sessionOrigin: replayStartMs)
            VisualCapture.shared.activateDeferredMode()
        }
        
        if interactionCaptureEnabled { InteractionRecorder.shared.activate() }
        if faultTrackingEnabled { FaultTracker.shared.activate() }
        
        _live = true
    }
    
    @objc public func commitDeferredReplay() {
        deferredUploadMode = false
        TelemetryPipeline.shared.commitDeferredData()
        VisualCapture.shared.commitDeferredData()
        TelemetryPipeline.shared.activate()
    }
    
    @objc public func endReplay() {
        endReplay(completion: nil)
    }
    
    @objc public func endReplay(completion: ((Bool, Bool) -> Void)?) {
        guard _live else {
            completion?(false, false)
            return
        }
        _live = false
        
        let sid = replayId ?? ""
        let termMs = UInt64(Date().timeIntervalSince1970 * 1000)
        let elapsed = Int((termMs - replayStartMs) / 1000)
        
        _netMonitor?.cancel()
        _netMonitor = nil
        _hierarchyTimer?.invalidate()
        _hierarchyTimer = nil
        _stopDurationLimitTimer()
        _detachLifecycle()
        
        let metrics: [String: Any] = [
            "crashCount": _crashCount,
            "anrCount": _freezeCount,
            "errorCount": _errorCount,
            "durationSeconds": elapsed,
            "touchCount": _tapCount,
            "scrollCount": _scrollCount,
            "gestureCount": _gestureCount,
            "rageTapCount": _rageCount,
            "deadTapCount": _deadTapCount,
            "screensVisited": _visitedScreens,
            "screenCount": Set(_visitedScreens).count
        ]
        let queueDepthAtFinalize = TelemetryPipeline.shared.getQueueDepth()
        
        SegmentDispatcher.shared.evaluateReplayRetention(replayId: sid, metrics: metrics) { [weak self] retain, reason in
            guard let self else { return }
            
            // UI operations MUST run on main thread
            DispatchQueue.main.async {
                TelemetryPipeline.shared.shutdown()
                VisualCapture.shared.halt()
                InteractionRecorder.shared.deactivate()
                FaultTracker.shared.deactivate()
                ResponsivenessWatcher.shared.halt()
            }
            
            SegmentDispatcher.shared.shipPending()
            
            guard !self._finalized else {
                self._clearRecovery()
                completion?(true, true)
                return
            }
            self._finalized = true
            
            SegmentDispatcher.shared.concludeReplay(
                replayId: sid,
                concludedAt: termMs,
                backgroundDurationMs: self._bgTimeMs,
                metrics: metrics,
                currentQueueDepth: queueDepthAtFinalize
            ) { [weak self] ok in
                if ok { self?._clearRecovery() }
                completion?(true, ok)
            }
        }
        
        replayId = nil
        replayStartMs = 0
    }
    
    @objc public func redactView(_ view: UIView) {
        VisualCapture.shared.registerRedaction(view)
    }
    
    @objc public func unredactView(_ view: UIView) {
        VisualCapture.shared.unregisterRedaction(view)
    }
    
    /// Set remote configuration from backend
    /// Called by JS side before startSession to apply server-side settings
    @objc public func setRemoteConfig(
        rejourneyEnabled: Bool,
        recordingEnabled: Bool,
        sampleRate: Int,
        maxRecordingMinutes: Int
    ) {
        self.remoteRejourneyEnabled = rejourneyEnabled
        self.remoteRecordingEnabled = recordingEnabled
        self.remoteSampleRate = sampleRate
        self.remoteMaxRecordingMinutes = maxRecordingMinutes
        
        // Set isSampledIn for server-side enforcement
        // recordingEnabled=false means either dashboard disabled OR session sampled out by JS
        TelemetryPipeline.shared.isSampledIn = recordingEnabled
        
        // Apply recording settings immediately
        // If recording is disabled, disable visual capture
        if !recordingEnabled {
            visualCaptureEnabled = false
            DiagnosticLog.trace("[ReplayOrchestrator] Visual capture disabled by remote config (recordingEnabled=false)")
        }
        
        // If already recording, restart the duration limit timer with updated config
        if _live {
            _startDurationLimitTimer()
        }
        
        DiagnosticLog.trace("[ReplayOrchestrator] Remote config applied: rejourneyEnabled=\(rejourneyEnabled), recordingEnabled=\(recordingEnabled), sampleRate=\(sampleRate)%, maxRecording=\(maxRecordingMinutes)min, isSampledIn=\(recordingEnabled)")
    }
    
    @objc public func attachAttribute(key: String, value: String) {
        TelemetryPipeline.shared.recordAttribute(key: key, value: value)
    }
    
    @objc public func recordCustomEvent(name: String, payload: String?) {
        TelemetryPipeline.shared.recordCustomEvent(name: name, payload: payload ?? "")
    }
    
    @objc public func associateUser(_ userId: String) {
        TelemetryPipeline.shared.recordUserAssociation(userId)
    }
    
    @objc public func currentReplayId() -> String {
        replayId ?? ""
    }
    
    @objc public func activateGestureRecording() {
    }
    
    @objc public func recoverInterruptedReplay(completion: @escaping (String?) -> Void) {
        guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            completion(nil)
            return
        }
        
        let path = docs.appendingPathComponent("rejourney_recovery.json")
        
        guard let data = try? Data(contentsOf: path),
              let checkpoint = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let recId = checkpoint["replayId"] as? String else {
            completion(nil)
            return
        }
        
        let origStart = checkpoint["startMs"] as? UInt64 ?? 0
        let nowMs = UInt64(Date().timeIntervalSince1970 * 1000)
        
        if let token = checkpoint["apiToken"] as? String {
            SegmentDispatcher.shared.apiToken = token
        }
        if let endpoint = checkpoint["endpoint"] as? String {
            SegmentDispatcher.shared.endpoint = endpoint
        }
        
        let crashMetrics: [String: Any] = [
            "crashCount": 1,
            "durationSeconds": Int((nowMs - origStart) / 1000)
        ]
        let queueDepthAtFinalize = TelemetryPipeline.shared.getQueueDepth()
        
        SegmentDispatcher.shared.concludeReplay(
            replayId: recId,
            concludedAt: nowMs,
            backgroundDurationMs: 0,
            metrics: crashMetrics,
            currentQueueDepth: queueDepthAtFinalize
        ) { [weak self] ok in
            self?._clearRecovery()
            completion(ok ? recId : nil)
        }
    }
    
    @objc public func incrementFaultTally() { _crashCount += 1 }
    @objc public func incrementStalledTally() { _freezeCount += 1 }
    @objc public func incrementExceptionTally() { _errorCount += 1 }
    @objc public func incrementTapTally() { _tapCount += 1 }
    @objc public func logScrollAction() { _scrollCount += 1 }
    @objc public func incrementGestureTally() { _gestureCount += 1 }
    @objc public func incrementRageTapTally() { _rageCount += 1 }
    @objc public func incrementDeadTapTally() { _deadTapCount += 1 }
    
    @objc public func logScreenView(_ screenId: String) {
        guard !screenId.isEmpty else { return }
        _visitedScreens.append(screenId)
        currentScreenName = screenId
        if hierarchyCaptureEnabled { _captureHierarchy() }
    }
    
    private func _initSession() {
        replayStartMs = UInt64(Date().timeIntervalSince1970 * 1000)
        let uuidPart = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        replayId = "session_\(replayStartMs)_\(uuidPart)"
        _finalized = false
        
        _crashCount = 0
        _freezeCount = 0
        _errorCount = 0
        _tapCount = 0
        _scrollCount = 0
        _gestureCount = 0
        _rageCount = 0
        _deadTapCount = 0
        _visitedScreens.removeAll()
        _bgTimeMs = 0
        _bgStartMs = nil
        
        TelemetryPipeline.shared.currentReplayId = replayId
        SegmentDispatcher.shared.currentReplayId = replayId
        StabilityMonitor.shared.currentSessionId = replayId
        
        _attachLifecycle()
        _saveRecovery()
        
        // Record app startup time
        _recordAppStartup()
    }
    
    private func _recordAppStartup() {
        let nowSec = Date().timeIntervalSince1970
        let startupDurationMs = Int64((nowSec - ReplayOrchestrator.processStartTime) * 1000)
        
        // Only record if it's a reasonable startup time (> 0 and < 60 seconds)
        guard startupDurationMs > 0 && startupDurationMs < 60000 else { return }
        
        TelemetryPipeline.shared.recordAppStartup(durationMs: startupDurationMs)
    }
    
    private func _applySettings(_ cfg: [String: Any]?) {
        guard let cfg else { return }
        snapshotInterval = cfg["captureRate"] as? Double ?? 0.33
        compressionLevel = cfg["imgCompression"] as? Double ?? 0.5
        visualCaptureEnabled = cfg["captureScreen"] as? Bool ?? true
        interactionCaptureEnabled = cfg["captureAnalytics"] as? Bool ?? true
        faultTrackingEnabled = cfg["captureCrashes"] as? Bool ?? true
        responsivenessCaptureEnabled = cfg["captureANR"] as? Bool ?? true
        consoleCaptureEnabled = cfg["captureLogs"] as? Bool ?? true
        wifiRequired = cfg["wifiOnly"] as? Bool ?? false
        frameBundleSize = cfg["screenshotBatchSize"] as? Int ?? 5
    }
    
    private func _monitorNetwork(token: String) {
        _netMonitor = NWPathMonitor()
        _netMonitor?.pathUpdateHandler = { [weak self] path in
            self?.handlePathChange(path: path, token: token)
        }
        _netMonitor?.start(queue: DispatchQueue.global(qos: .utility))
    }
    
    private func handlePathChange(path: NWPath, token: String) {
        let canProceed: Bool
        
        if path.status != .satisfied {
            canProceed = false
        } else if wifiRequired && !path.isExpensive {
            canProceed = true
        } else if wifiRequired && path.isExpensive {
            canProceed = false
        } else {
            canProceed = true
        }
        
        // Extract network interface type
        let networkType: String
        let isExpensive = path.isExpensive
        let isConstrained = path.isConstrained
        
        if path.status != .satisfied {
            networkType = "none"
        } else if path.usesInterfaceType(.wifi) {
            networkType = "wifi"
        } else if path.usesInterfaceType(.cellular) {
            networkType = "cellular"
        } else if path.usesInterfaceType(.wiredEthernet) {
            networkType = "wired"
        } else if path.usesInterfaceType(.loopback) {
            networkType = "other"
        } else {
            networkType = "other"
        }
        
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self._netReady = canProceed
            self.currentNetworkType = networkType
            self.networkIsExpensive = isExpensive
            self.networkIsConstrained = isConstrained
            
            if canProceed && !self._live {
                self._beginRecording(token: token)
            }
        }
    }
    
    private func _beginRecording(token: String) {
        guard !_live else { return }
        _live = true
        
        self.apiToken = token
        _initSession()
        
        // Reactivate the dispatcher in case it was halted from a previous session
        SegmentDispatcher.shared.activate()
        TelemetryPipeline.shared.activate()
        
        let renderCfg = _computeRender(fps: 1, tier: "standard")
        VisualCapture.shared.configure(snapshotInterval: renderCfg.interval, jpegQuality: renderCfg.quality)
        
        if visualCaptureEnabled { VisualCapture.shared.beginCapture(sessionOrigin: replayStartMs) }
        if interactionCaptureEnabled { InteractionRecorder.shared.activate() }
        if faultTrackingEnabled { FaultTracker.shared.activate() }
        if responsivenessCaptureEnabled { ResponsivenessWatcher.shared.activate() }
        if hierarchyCaptureEnabled { _startHierarchyCapture() }
        
        // Start duration limit timer based on remote config
        _startDurationLimitTimer()
    }
    
    // MARK: - Duration Limit Timer
    
    private func _startDurationLimitTimer() {
        _stopDurationLimitTimer()
        
        let maxMinutes = remoteMaxRecordingMinutes
        guard maxMinutes > 0 else { return }
        
        let maxMs = UInt64(maxMinutes) * 60 * 1000
        let now = UInt64(Date().timeIntervalSince1970 * 1000)
        let elapsed = now - replayStartMs
        let remaining = maxMs > elapsed ? maxMs - elapsed : 0
        
        guard remaining > 0 else {
            DiagnosticLog.trace("[ReplayOrchestrator] Duration limit already exceeded, stopping session")
            endReplay()
            return
        }
        
        let workItem = DispatchWorkItem { [weak self] in
            guard let self, self._live else { return }
            DiagnosticLog.trace("[ReplayOrchestrator] Recording duration limit reached (\(maxMinutes)min), stopping session")
            self.endReplay()
        }
        _durationLimitTimer = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int(remaining)), execute: workItem)
        
        DiagnosticLog.trace("[ReplayOrchestrator] Duration limit timer set: \(remaining / 1000)s remaining (max \(maxMinutes)min)")
    }
    
    private func _stopDurationLimitTimer() {
        _durationLimitTimer?.cancel()
        _durationLimitTimer = nil
    }
    
    private func _saveRecovery() {
        guard let sid = replayId, let token = apiToken else { return }
        let checkpoint: [String: Any] = ["replayId": sid, "apiToken": token, "startMs": replayStartMs, "endpoint": serverEndpoint]
        guard let data = try? JSONSerialization.data(withJSONObject: checkpoint),
              let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        try? data.write(to: docs.appendingPathComponent("rejourney_recovery.json"))
    }
    
    private func _clearRecovery() {
        guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        try? FileManager.default.removeItem(at: docs.appendingPathComponent("rejourney_recovery.json"))
    }
    
    private func _attachLifecycle() {
        NotificationCenter.default.addObserver(self, selector: #selector(_onBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(_onForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }
    
    private func _detachLifecycle() {
        NotificationCenter.default.removeObserver(self, name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.removeObserver(self, name: UIApplication.willEnterForegroundNotification, object: nil)
    }
    
    @objc private func _onBackground() {
        _bgStartMs = UInt64(Date().timeIntervalSince1970 * 1000)
    }
    
    @objc private func _onForeground() {
        guard let start = _bgStartMs else { return }
        let now = UInt64(Date().timeIntervalSince1970 * 1000)
        _bgTimeMs += (now - start)
        _bgStartMs = nil
    }
    
    private func _startHierarchyCapture() {
        _hierarchyTimer?.invalidate()
        // Industry standard: Use default run loop mode (NOT .common)
        // This lets the timer pause during scrolling which prevents stutter
        _hierarchyTimer = Timer.scheduledTimer(withTimeInterval: hierarchyCaptureInterval, repeats: true) { [weak self] _ in
            self?._captureHierarchy()
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?._captureHierarchy()
        }
    }
    
    private func _captureHierarchy() {
        guard _live, let sid = replayId else { return }
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in self?._captureHierarchy() }
            return
        }
        
        // Throttle hierarchy capture when map is visible and animating —
        // hierarchy scanning traverses the full view tree including the
        // map's deep Metal/GL subviews, adding main-thread pressure.
        if SpecialCases.shared.mapVisible && !SpecialCases.shared.mapIdle {
            return
        }
        
        guard let hierarchy = ViewHierarchyScanner.shared.captureHierarchy() else { return }
        
        let hash = _hierarchyHash(hierarchy)
        if hash == _lastHierarchyHash { return }
        _lastHierarchyHash = hash
        
        guard let json = try? JSONSerialization.data(withJSONObject: hierarchy) else { return }
        let ts = UInt64(Date().timeIntervalSince1970 * 1000)
        
        SegmentDispatcher.shared.transmitHierarchy(replayId: sid, hierarchyPayload: json, timestampMs: ts, completion: nil)
    }
    
    private func _hierarchyHash(_ h: [String: Any]) -> String {
        let screen = currentScreenName ?? "unknown"
        var childCount = 0
        if let root = h["root"] as? [String: Any], let children = root["children"] as? [[String: Any]] {
            childCount = children.count
        }
        return "\(screen):\(childCount)"
    }
}

private func _computeRender(fps: Int, tier: String) -> (interval: Double, quality: Double) {
    let tierLower = tier.lowercased()
    let interval: Double
    let quality: Double
    switch tierLower {
    case "minimal":
        interval = 2.0  // 0.5 fps for maximum size reduction
        quality = 0.4
    case "low":
        interval = 1.0 / Double(max(1, min(fps, 99)))
        quality = 0.4
    case "standard":
        interval = 1.0 / Double(max(1, min(fps, 99)))
        quality = 0.5
    case "high":
        interval = 1.0 / Double(max(1, min(fps, 99)))
        quality = 0.55
    default:
        interval = 1.0 / Double(max(1, min(fps, 99)))
        quality = 0.5
    }
    return (interval, quality)
}

func computeQualityPreset(targetFps: Int, preset: String) -> (interval: Double, quality: Double) {
    _computeRender(fps: targetFps, tier: preset)
}
