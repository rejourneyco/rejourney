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
import React
import CommonCrypto

@objc(RejourneyImpl)
public final class RejourneyImpl: NSObject {
    @objc public static let shared = RejourneyImpl()
    @objc public static var sdkVersion = "1.0.1"
    
    // MARK: - State Machine
    
    private enum SessionState {
        case idle
        case active(sessionId: String, startTime: TimeInterval)
        case paused(sessionId: String, startTime: TimeInterval)
        case terminated
    }
    
    private var state: SessionState = .idle
    private let stateLock = NSLock()
    
    // MARK: - Internal Storage
    
    private var currentUserIdentity: String?
    private var internalEventStream: [[String: Any]] = []
    private var backgroundStartTime: TimeInterval?
    private var lastSessionConfig: [String: Any]?
    private var lastApiUrl: String?
    private var lastPublicKey: String?
    
    // Session timeout threshold (60 seconds)
    private let sessionTimeoutSeconds: TimeInterval = 60
    
    private let userIdentityKey = "com.rejourney.user.identity"
    
    public override init() {
        super.init()
        setupLifecycleListeners()
        _loadPersistedIdentity()
    }
    
    private func _loadPersistedIdentity() {
        if let persisted = UserDefaults.standard.string(forKey: userIdentityKey), !persisted.isEmpty {
            self.currentUserIdentity = persisted
            DiagnosticLog.notice("[Rejourney] Restored persisted user identity: \(persisted)")
        }
    }
    
    deinit {
        NotificationCenter.default.removeObserver(self)
    }
    
    private func setupLifecycleListeners() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(handleTermination), name: UIApplication.willTerminateNotification, object: nil)
        center.addObserver(self, selector: #selector(handleBackgrounding), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(handleForegrounding), name: UIApplication.willEnterForegroundNotification, object: nil)
    }
    
    // MARK: - State Transitions
    
    @objc private func handleTermination() {
        stateLock.lock()
        defer { stateLock.unlock() }
        
        switch state {
        case .active, .paused:
            state = .terminated
            TelemetryPipeline.shared.finalizeAndShip()
            SegmentDispatcher.shared.shipPending()
        default:
            break
        }
    }
    
    @objc private func handleBackgrounding() {
        stateLock.lock()
        defer { stateLock.unlock() }
        
        if case .active(let sid, let start) = state {
            state = .paused(sessionId: sid, startTime: start)
            backgroundStartTime = Date().timeIntervalSince1970
            DiagnosticLog.notice("[Rejourney] ⏸️ Session '\(sid)' paused (app backgrounded)")
            TelemetryPipeline.shared.dispatchNow()
            SegmentDispatcher.shared.shipPending()
        }
    }
    
    @objc private func handleForegrounding() {
        // Dispatch to avoid blocking the main thread notification handler
        DispatchQueue.main.async { [weak self] in
            self?._processForegrounding()
        }
    }
    
    private func _processForegrounding() {
        stateLock.lock()
        
        guard case .paused(let sid, let start) = state else {
            DiagnosticLog.trace("[Rejourney] Foreground: not in paused state, ignoring")
            stateLock.unlock()
            return
        }
        
        // Check if we've been in background longer than the timeout
        let backgroundDuration: TimeInterval
        if let bgStart = backgroundStartTime {
            backgroundDuration = Date().timeIntervalSince1970 - bgStart
        } else {
            backgroundDuration = 0
        }
        backgroundStartTime = nil
        
        DiagnosticLog.notice("[Rejourney] App foregrounded after \(Int(backgroundDuration))s (timeout: \(Int(sessionTimeoutSeconds))s)")
        
        if backgroundDuration > sessionTimeoutSeconds {
            // End current session and start a new one
            state = .idle
            stateLock.unlock()
            
            DiagnosticLog.notice("[Rejourney] 🔄 Session timeout! Ending session '\(sid)' and creating new one")
            
            // End the old session asynchronously, then start new one
            // Use a background queue to avoid blocking main thread
            DispatchQueue.global(qos: .utility).async { [weak self] in
                ReplayOrchestrator.shared.endReplay { success, uploaded in
                    DiagnosticLog.notice("[Rejourney] Old session ended (success: \(success), uploaded: \(uploaded))")
                    // Start a new session with preserved config and user identity
                    DispatchQueue.main.async {
                        self?._startNewSessionAfterTimeout()
                    }
                }
            }
        } else {
            // Resume existing session
            state = .active(sessionId: sid, startTime: start)
            stateLock.unlock()
            
            DiagnosticLog.notice("[Rejourney] ▶️ Resuming session '\(sid)'")
            
            // Record the foreground event with background duration
            let bgMs = UInt64(backgroundDuration * 1000)
            TelemetryPipeline.shared.recordAppForeground(totalBackgroundTimeMs: bgMs)
            
            StabilityMonitor.shared.transmitStoredReport()
        }
    }
    
    private func _startNewSessionAfterTimeout() {
        guard let apiUrl = lastApiUrl, let publicKey = lastPublicKey else {
            DiagnosticLog.caution("[Rejourney] Cannot restart session - missing API config")
            return
        }
        
        let savedUserId = currentUserIdentity
        
        DiagnosticLog.notice("[Rejourney] Starting new session after timeout (user: \(savedUserId ?? "nil"))")
        
        // Use a faster path: directly call beginSessionFast if credentials are still valid
        // This avoids the network roundtrip for credential re-fetch
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            
            // Try the fast path first - if credentials are still valid
            if let existingCred = DeviceRegistrar.shared.uploadCredential, DeviceRegistrar.shared.credentialValid {
                DiagnosticLog.notice("[Rejourney] Using cached credentials for fast session restart")
                ReplayOrchestrator.shared.beginReplayFast(
                    apiToken: publicKey,
                    serverEndpoint: apiUrl,
                    credential: existingCred,
                    captureSettings: self.lastSessionConfig
                )
            } else {
                // Fall back to full credential fetch
                DiagnosticLog.notice("[Rejourney] No cached credentials, doing full session start")
                ReplayOrchestrator.shared.beginReplay(
                    apiToken: publicKey,
                    serverEndpoint: apiUrl,
                    captureSettings: self.lastSessionConfig
                )
            }
            
            // Poll for session to be ready (up to 3 seconds)
            self._waitForSessionReady(savedUserId: savedUserId, attempts: 0)
        }
    }
    
    private func _waitForSessionReady(savedUserId: String?, attempts: Int) {
        let maxAttempts = 30 // 3 seconds max (30 * 100ms)
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            guard let self else { return }
            
            // Check if ReplayOrchestrator has generated a new session ID
            if let newSid = ReplayOrchestrator.shared.replayId, !newSid.isEmpty {
                let start = Date().timeIntervalSince1970
                
                self.stateLock.lock()
                self.state = .active(sessionId: newSid, startTime: start)
                self.stateLock.unlock()
                
                ReplayOrchestrator.shared.activateGestureRecording()
                
                // Re-apply user identity if it was set
                if let userId = savedUserId, userId != "anonymous", !userId.hasPrefix("anon_") {
                    ReplayOrchestrator.shared.associateUser(userId)
                    DiagnosticLog.notice("[Rejourney] ✅ Restored user identity '\(userId)' to new session \(newSid)")
                }
                
                DiagnosticLog.replayBegan(newSid)
                DiagnosticLog.notice("[Rejourney] ✅ New session started: \(newSid)")
            } else if attempts < maxAttempts {
                // Keep polling
                self._waitForSessionReady(savedUserId: savedUserId, attempts: attempts + 1)
            } else {
                DiagnosticLog.caution("[Rejourney] ⚠️ Timeout waiting for new session to initialize")
            }
        }
    }
    
    // MARK: - Public API
    
    @objc(startSession:apiUrl:publicKey:resolve:reject:)
    public func startSession(
        _ userId: String,
        apiUrl: String,
        publicKey: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        startSessionWithOptions(
            [
                "userId": userId,
                "apiUrl": apiUrl,
                "publicKey": publicKey
            ] as NSDictionary,
            resolve: resolve,
            reject: reject
        )
    }
    
    @objc(startSessionWithOptions:resolve:reject:)
    public func startSessionWithOptions(
        _ options: NSDictionary,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        if let debug = options["debug"] as? Bool, debug {
            DiagnosticLog.setVerbose(true)
            DiagnosticLog.notice("[Rejourney] Debug mode ENABLED - verbose logging active")
        }
        
        let startParams = PerformanceSnapshot.capture()
        
        let userId = options["userId"] as? String ?? "anonymous"
        let apiUrl = options["apiUrl"] as? String ?? "https://api.rejourney.co"
        let publicKey = options["publicKey"] as? String ?? ""
        
        guard !publicKey.isEmpty else {
            reject("INVALID_KEY", "publicKey is required", nil)
            return
        }
        
        var config: [String: Any] = [:]
        if let val = options["captureScreen"] as? Bool { config["captureScreen"] = val }
        if let val = options["captureAnalytics"] as? Bool { config["captureAnalytics"] = val }
        if let val = options["captureCrashes"] as? Bool { config["captureCrashes"] = val }
        if let val = options["captureANR"] as? Bool { config["captureANR"] = val }
        if let val = options["wifiOnly"] as? Bool { config["wifiOnly"] = val }
        
        if let fps = options["fps"] as? Int {
            config["captureRate"] = 1.0 / Double(max(1, min(fps, 30)))
        }
        
        if let quality = options["quality"] as? String {
            switch quality.lowercased() {
            case "low": config["imgCompression"] = 0.4
            case "high": config["imgCompression"] = 0.7
            default: config["imgCompression"] = 0.5
            }
        }
        
        // Critical: Ensure async dispatch to allow React Native bridge to return
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                resolve(["success": false, "sessionId": "", "error": "Instance released"])
                return
            }
            
            self.stateLock.lock()
            if case .active(let sid, _) = self.state {
                self.stateLock.unlock()
                resolve(["success": true, "sessionId": sid])
                return
            }
            self.stateLock.unlock()
            
            if !userId.isEmpty && userId != "anonymous" && !userId.hasPrefix("anon_") {
                self.currentUserIdentity = userId
            }
            
            // Store config for session restart after background timeout
            self.lastSessionConfig = config
            self.lastApiUrl = apiUrl
            self.lastPublicKey = publicKey
            
            TelemetryPipeline.shared.endpoint = apiUrl
            SegmentDispatcher.shared.endpoint = apiUrl
            DeviceRegistrar.shared.endpoint = apiUrl
            
            ReplayOrchestrator.shared.beginReplay(apiToken: publicKey, serverEndpoint: apiUrl, captureSettings: config)
            
            // Allow orchestrator time to spin up
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                let sid = ReplayOrchestrator.shared.replayId ?? UUID().uuidString
                let start = Date().timeIntervalSince1970
                
                self.stateLock.lock()
                self.state = .active(sessionId: sid, startTime: start)
                self.stateLock.unlock()
                
                ReplayOrchestrator.shared.activateGestureRecording()
                
                if userId != "anonymous" && !userId.hasPrefix("anon_") {
                    ReplayOrchestrator.shared.associateUser(userId)
                }
                
                DiagnosticLog.replayBegan(sid)
                resolve(["success": true, "sessionId": sid])
            }
        }
    }
    
    @objc(stopSession:reject:)
    public func stopSession(
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            
            var targetSid = ""
            
            self.stateLock.lock()
            if case .active(let sid, _) = self.state {
                targetSid = sid
            }
            self.state = .idle
            self.stateLock.unlock()
            
            guard !targetSid.isEmpty else {
                resolve(["success": true, "sessionId": "", "uploadSuccess": true])
                return
            }
            
            ReplayOrchestrator.shared.endReplay { success, uploaded in
                DiagnosticLog.replayEnded(targetSid)
                
                resolve([
                    "success": success,
                    "sessionId": targetSid,
                    "uploadSuccess": uploaded
                ])
            }
        }
    }
    
    @objc(getSessionId:reject:)
    public func getSessionId(
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        stateLock.lock()
        defer { stateLock.unlock() }
        
        switch state {
        case .active(let sid, _), .paused(let sid, _):
            resolve(sid)
        default:
            resolve(nil)
        }
    }
    
    @objc(setUserIdentity:resolve:reject:)
    public func setUserIdentity(
        _ userId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        if !userId.isEmpty && userId != "anonymous" && !userId.hasPrefix("anon_") {
            currentUserIdentity = userId
            
            // Persist natively
            UserDefaults.standard.set(userId, forKey: userIdentityKey)
            DiagnosticLog.notice("[Rejourney] Persisted user identity: \(userId)")
            
            ReplayOrchestrator.shared.associateUser(userId)
        } else if userId == "anonymous" || userId.isEmpty {
            // Clear identity
            currentUserIdentity = nil
            UserDefaults.standard.removeObject(forKey: userIdentityKey)
            DiagnosticLog.notice("[Rejourney] Cleared user identity")
        }
        
        resolve(["success": true])
    }
    
    @objc(getUserIdentity:reject:)
    public func getUserIdentity(
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(currentUserIdentity)
    }
    
    @objc(logEvent:details:resolve:reject:)
    public func logEvent(
        _ eventType: String,
        details: NSDictionary,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        // Handle network_request events specially to preserve type for backend metrics
        if eventType == "network_request" {
            // Convert NSDictionary to Swift dictionary for network event encoding
            if let detailsDict = details as? [String: Any] {
                TelemetryPipeline.shared.recordNetworkEvent(details: detailsDict)
            }
            resolve(["success": true])
            return
        }
        
        // Handle JS error events - route through TelemetryPipeline as type:"error"
        // so the backend ingest worker processes them into the errors table
        if eventType == "error" {
            let message = details["message"] as? String ?? "Unknown error"
            let name = details["name"] as? String ?? "Error"
            let stack = details["stack"] as? String
            TelemetryPipeline.shared.recordJSErrorEvent(name: name, message: message, stack: stack)
            resolve(["success": true])
            return
        }
        
        // Handle dead_tap events from JS-side detection
        // Native view hierarchy inspection is unreliable in React Native,
        // so dead tap detection runs in JS and reports back via logEvent.
        if eventType == "dead_tap" {
            let x = (details["x"] as? NSNumber)?.uint64Value ?? 0
            let y = (details["y"] as? NSNumber)?.uint64Value ?? 0
            let label = details["label"] as? String ?? "unknown"
            TelemetryPipeline.shared.recordDeadTapEvent(label: label, x: x, y: y)
            ReplayOrchestrator.shared.incrementDeadTapTally()
            resolve(["success": true])
            return
        }
        
        // All other events go through custom event recording
        var payload = "{}"
        if let data = try? JSONSerialization.data(withJSONObject: details),
           let str = String(data: data, encoding: .utf8) {
            payload = str
        }
        ReplayOrchestrator.shared.recordCustomEvent(name: eventType, payload: payload)
        resolve(["success": true])
    }
    
    @objc(screenChanged:resolve:reject:)
    public func screenChanged(
        _ screenName: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        TelemetryPipeline.shared.recordViewTransition(viewId: screenName, viewLabel: screenName, entering: true)
        ReplayOrchestrator.shared.logScreenView(screenName)
        resolve(["success": true])
    }
    
    @objc(onScroll:resolve:reject:)
    public func onScroll(
        _ offsetY: Double,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        ReplayOrchestrator.shared.logScrollAction()
        resolve(["success": true])
    }
    
    @objc(markVisualChange:importance:resolve:reject:)
    public func markVisualChange(
        _ reason: String,
        importance: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        if importance == "high" {
            VisualCapture.shared.snapshotNow()
        }
        resolve(true)
    }
    
    @objc(onExternalURLOpened:resolve:reject:)
    public func onExternalURLOpened(
        _ urlScheme: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        ReplayOrchestrator.shared.recordCustomEvent(name: "external_url_opened", payload: "{\"scheme\":\"\(urlScheme)\"}")
        resolve(["success": true])
    }
    
    @objc(onOAuthStarted:resolve:reject:)
    public func onOAuthStarted(
        _ provider: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        ReplayOrchestrator.shared.recordCustomEvent(name: "oauth_started", payload: "{\"provider\":\"\(provider)\"}")
        resolve(["success": true])
    }
    
    @objc(onOAuthCompleted:success:resolve:reject:)
    public func onOAuthCompleted(
        _ provider: String,
        success: Bool,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        ReplayOrchestrator.shared.recordCustomEvent(name: "oauth_completed", payload: "{\"provider\":\"\(provider)\",\"success\":\(success)}")
        resolve(["success": true])
    }
    
    @objc(maskViewByNativeID:resolve:reject:)
    public func maskViewByNativeID(
        _ nativeID: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            if let target = self.findView(by: nativeID) {
                ReplayOrchestrator.shared.redactView(target)
            }
        }
        resolve(["success": true])
    }
    
    @objc(unmaskViewByNativeID:resolve:reject:)
    public func unmaskViewByNativeID(
        _ nativeID: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            if let target = self.findView(by: nativeID) {
                ReplayOrchestrator.shared.unredactView(target)
            }
        }
        resolve(["success": true])
    }
    
    private func findView(by identifier: String) -> UIView? {
        guard let window = UIApplication.shared.windows.first(where: { $0.isKeyWindow }) else { return nil }
        return scanView(window, id: identifier)
    }
    
    private func scanView(_ node: UIView, id: String) -> UIView? {
        if node.accessibilityIdentifier == id || node.nativeID == id {
            return node
        }
        for child in node.subviews {
            if let match = scanView(child, id: id) {
                return match
            }
        }
        return nil
    }
    
    @objc(setDebugMode:resolve:reject:)
    public func setDebugMode(
        _ enabled: Bool,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DiagnosticLog.setVerbose(enabled)
        resolve(["success": true])
    }
    
    @objc(setRemoteConfigWithRejourneyEnabled:recordingEnabled:sampleRate:maxRecordingMinutes:resolve:reject:)
    public func setRemoteConfig(
        rejourneyEnabled: Bool,
        recordingEnabled: Bool,
        sampleRate: Int,
        maxRecordingMinutes: Int,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DiagnosticLog.notice("[Rejourney] setRemoteConfig: rejourneyEnabled=\(rejourneyEnabled), recordingEnabled=\(recordingEnabled), sampleRate=\(sampleRate), maxRecording=\(maxRecordingMinutes)min")
        
        ReplayOrchestrator.shared.setRemoteConfig(
            rejourneyEnabled: rejourneyEnabled,
            recordingEnabled: recordingEnabled,
            sampleRate: sampleRate,
            maxRecordingMinutes: maxRecordingMinutes
        )
        
        resolve(["success": true])
    }
    
    @objc(setSDKVersion:)
    public func setSDKVersion(_ version: String) {
        RejourneyImpl.sdkVersion = version
    }
    
    @objc(getSDKMetrics:reject:)
    public func getSDKMetrics(
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        let queueDepth = TelemetryPipeline.shared.getQueueDepth()
        resolve(SegmentDispatcher.shared.sdkTelemetrySnapshot(currentQueueDepth: queueDepth))
    }
    
    @objc(getDeviceInfo:reject:)
    public func getDeviceInfo(
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        let device = UIDevice.current
        let screen = UIScreen.main
        
        resolve([
            "platform": "ios",
            "osVersion": device.systemVersion,
            "model": device.model,
            "deviceName": device.name,
            "screenWidth": Int(screen.bounds.width * screen.scale),
            "screenHeight": Int(screen.bounds.height * screen.scale),
            "screenScale": screen.scale,
            "deviceHash": computeHash(),
            "bundleId": Bundle.main.bundleIdentifier ?? "unknown"
        ])
    }
    
    @objc(debugCrash)
    public func debugCrash() {
        DispatchQueue.main.async {
            let arr: [Int] = []
            _ = arr[1]
        }
    }
    
    @objc(debugTriggerANR:)
    public func debugTriggerANR(_ durationMs: Double) {
        DispatchQueue.main.async {
            Thread.sleep(forTimeInterval: durationMs / 1000.0)
        }
    }
    
    @objc(getSDKVersion:reject:)
    public func getSDKVersion(
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(Self.sdkVersion)
    }
    
    @objc(setUserData:value:resolve:reject:)
    public func setUserData(
        _ key: String,
        value: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        ReplayOrchestrator.shared.attachAttribute(key: key, value: value)
        resolve(nil)
    }
    
    private func computeHash() -> String {
        let uuid = UIDevice.current.identifierForVendor?.uuidString ?? "unknown"
        guard let data = uuid.data(using: .utf8) else { return "" }
        
        var buffer = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes {
            _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &buffer)
        }
        
        return buffer.map { String(format: "%02x", $0) }.joined()
    }
}
