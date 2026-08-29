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
    @objc public static var sdkVersion = "1.5.1"

    // MARK: - State Machine

    private enum SessionState {
        case idle
        case starting(sessionId: String, startTime: TimeInterval)
        case active(sessionId: String, startTime: TimeInterval)
        case paused(sessionId: String, startTime: TimeInterval)
        case terminated
    }

    private var state: SessionState = .idle
    private let stateLock = NSLock()
    private var startGeneration: UInt64 = 0

    // MARK: - Internal Storage

    private var currentUserIdentity: String?
    private var internalEventStream: [[String: Any]] = []
    private var backgroundStartTime: TimeInterval?
    private var lastSessionConfig: [String: Any]?
    private var lastApiUrl: String?
    private var lastPublicKey: String?
    private var nativeNetworkTrackingEnabled = true
    private struct UserPause {
        let id: String
        let startedAt: TimeInterval
    }
    private var userPause: UserPause?

    private func isUserPaused() -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return userPause != nil
    }

    // Session timeout threshold (60 seconds)
    private let sessionTimeoutSeconds: TimeInterval = 60
    private let sessionRolloverGraceSeconds: TimeInterval = 2

    private let userIdentityKey = "com.rejourney.user.identity"
    private let anonymousIdentityKey = "com.rejourney.anonymous.identity"
    private let remoteConfigCachePrefix = "com.rejourney.remote_config."

    public override init() {
        super.init()
        setupLifecycleListeners()
        _loadPersistedIdentity()

        // Recover any session interrupted by a previous crash.
        // Send the stored crash report after recovery restores auth/session context.
        ReplayOrchestrator.shared.recoverInterruptedReplay { recoveredId in
            if let recoveredId = recoveredId {
                DiagnosticLog.notice("[Rejourney] Recovered crashed session: \(recoveredId)")
            }
        }
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

    //NOTE: iOS cannot detect reliably app kill so we depend server side with the session reconciliation logic 
    private func setupLifecycleListeners() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(handleTermination), name: UIApplication.willTerminateNotification, object: nil)
        center.addObserver(self, selector: #selector(handleBackgrounding), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(handleForegrounding), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    // MARK: - State Transitions

    @objc private func handleTermination() {
        let shouldFinalize: Bool
        stateLock.lock()
        switch state {
        case .active, .paused:
            state = .terminated
            shouldFinalize = true
        default:
            shouldFinalize = false
        }
        stateLock.unlock()

        guard shouldFinalize else { return }

        if let replayId = ReplayOrchestrator.shared.replayId, !replayId.isEmpty {
            ReplayOrchestrator.shared.endReplayWithReason("termination") { success, uploaded in
                DiagnosticLog.notice("[Rejourney] Termination finalization completed (success: \(success), uploaded: \(uploaded))")
            }
        } else {
            TelemetryPipeline.shared.finalizeAndShip()
            SegmentDispatcher.shared.shipPending()
        }
    }

    @objc private func handleBackgrounding() {
        stateLock.lock()
        defer { stateLock.unlock() }

        if case .active(let sid, let start) = state {
            state = .paused(sessionId: sid, startTime: start)
            backgroundStartTime = ProcessInfo.processInfo.systemUptime
            DiagnosticLog.notice("[Rejourney] ⏸️ Session '\(sid)' paused (app backgrounded)")
            TelemetryPipeline.shared.recordAppBackground()
            TelemetryPipeline.shared.dispatchNow()
            SegmentDispatcher.shared.shipPending()
            // Stop the heartbeat timer to prevent event uploads while backgrounded
            TelemetryPipeline.shared.pause()
            RejourneyURLProtocol.disable()
        }
    }

    @objc private func handleForegrounding() {
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
            backgroundDuration = max(0, ProcessInfo.processInfo.systemUptime - bgStart)
        } else {
            backgroundDuration = 0
        }
        backgroundStartTime = nil

        DiagnosticLog.notice("[Rejourney] App foregrounded after \(Int(backgroundDuration))s (timeout: \(Int(sessionTimeoutSeconds))s)")

        // Resume the heartbeat timer now that we're back in foreground
        if userPause == nil {
            TelemetryPipeline.shared.resume()
            if nativeNetworkTrackingEnabled { RejourneyURLProtocol.enable() }
        }

        if backgroundDuration > sessionTimeoutSeconds {
            // End current session and start a new one
            startGeneration &+= 1
            let rolloverGeneration = startGeneration
            state = .idle
            stateLock.unlock()

            DiagnosticLog.notice("[Rejourney] 🔄 Session timeout! Ending session '\(sid)' and creating new one")

            let restartLock = NSLock()
            var restartStarted = false
            let triggerRestart: (String) -> Void = { [weak self] source in
                restartLock.lock()
                defer { restartLock.unlock() }
                guard !restartStarted else { return }
                restartStarted = true
                DiagnosticLog.notice("[Rejourney] Session rollover trigger source=\(source), oldSession=\(sid)")
                DispatchQueue.main.async {
                    self?._startNewSessionAfterTimeout(expectedGeneration: rolloverGeneration)
                }
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + sessionRolloverGraceSeconds) {
                restartLock.lock()
                let shouldWarn = !restartStarted
                restartLock.unlock()
                if shouldWarn {
                    DiagnosticLog.caution("[Rejourney] Session rollover grace timeout reached (\(Int(self.sessionRolloverGraceSeconds * 1000))ms), forcing new session start")
                }
                triggerRestart("grace_timeout")
            }

            // Replay teardown only schedules its I/O work; its local state,
            // timers, and UIKit-backed device snapshot belong to the main
            // thread. Running this entry point on a utility queue introduced a
            // real data race with the grace-period replacement session.
            ReplayOrchestrator.shared.endReplayWithReason("background_timeout") { success, uploaded in
                DiagnosticLog.notice("[Rejourney] Old session ended (success: \(success), uploaded: \(uploaded))")
                triggerRestart("end_replay_callback")
            }
        } else {
            let orchestratorSessionId = ReplayOrchestrator.shared.replayId
            if orchestratorSessionId?.isEmpty ?? true {
                startGeneration &+= 1
                let rolloverGeneration = startGeneration
                state = .idle
                stateLock.unlock()
                DiagnosticLog.notice("[Rejourney] Session ended while backgrounded, starting fresh session on foreground")
                DispatchQueue.main.async { [weak self] in
                    self?._startNewSessionAfterTimeout(expectedGeneration: rolloverGeneration)
                }
                return
            }

            if let orchestratorSessionId, orchestratorSessionId != sid {
                state = .active(sessionId: orchestratorSessionId, startTime: Date().timeIntervalSince1970)
                stateLock.unlock()
                DiagnosticLog.notice("[Rejourney] ▶️ Foreground reconciled to active session '\(orchestratorSessionId)' (was '\(sid)')")
            } else {
                // Resume existing session
                state = .active(sessionId: sid, startTime: start)
                stateLock.unlock()
                DiagnosticLog.notice("[Rejourney] ▶️ Resuming session '\(sid)'")
            }
            
            // Record the foreground event with background duration
            if userPause == nil {
                let bgMs = UInt64(backgroundDuration * 1000)
                TelemetryPipeline.shared.recordAppForeground(totalBackgroundTimeMs: bgMs)
            }
            
            StabilityMonitor.shared.transmitStoredReport()
        }
    }

    private func _startNewSessionAfterTimeout(expectedGeneration: UInt64) {
        guard let apiUrl = lastApiUrl, let publicKey = lastPublicKey else {
            DiagnosticLog.caution("[Rejourney] Cannot restart session - missing API config")
            return
        }

        let savedUserId = currentUserIdentity

        DiagnosticLog.notice("[Rejourney] Starting new session after timeout (user: \(savedUserId ?? "nil"))")

        stateLock.lock()
        guard startGeneration == expectedGeneration, case .idle = state else {
            stateLock.unlock()
            return
        }
        let generation = expectedGeneration
        state = .starting(
            sessionId: "pending_\(Int(Date().timeIntervalSince1970 * 1000))",
            startTime: Date().timeIntervalSince1970
        )
        stateLock.unlock()

        // Use a faster path when credentials are still valid.
        if let existingCred = DeviceRegistrar.shared.uploadCredential, DeviceRegistrar.shared.credentialValid {
            DiagnosticLog.notice("[Rejourney] Using cached credentials for fast session restart")
            ReplayOrchestrator.shared.beginReplayFast(
                apiToken: publicKey,
                serverEndpoint: apiUrl,
                credential: existingCred,
                captureSettings: lastSessionConfig
            )
        } else {
            DiagnosticLog.notice("[Rejourney] No cached credentials, doing full session start")
            ReplayOrchestrator.shared.beginReplay(
                apiToken: publicKey,
                serverEndpoint: apiUrl,
                captureSettings: lastSessionConfig
            )
        }

        // Poll for session to be ready (up to 3 seconds)
        _waitForSessionReady(savedUserId: savedUserId, attempts: 0, generation: generation)
    }

    private func _waitForSessionReady(
        savedUserId: String?,
        attempts: Int,
        generation: UInt64,
        onReady: ((String) -> Void)? = nil,
        onTimeout: (() -> Void)? = nil
    ) {
        let maxAttempts = 50 // 5 seconds max (50 * 100ms)

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            guard let self else { return }

            self.stateLock.lock()
            let isCurrent: Bool
            if case .starting = self.state {
                isCurrent = self.startGeneration == generation
            } else {
                isCurrent = false
            }
            self.stateLock.unlock()
            guard isCurrent else {
                onTimeout?()
                return
            }

            // Check if ReplayOrchestrator has generated a new session ID
            if let newSid = ReplayOrchestrator.shared.replayId, !newSid.isEmpty {
                let start = Date().timeIntervalSince1970

                self.stateLock.lock()
                self.state = .active(sessionId: newSid, startTime: start)
                self.stateLock.unlock()

                ReplayOrchestrator.shared.activateGestureRecording()

                if let userId = savedUserId,
                   userId != "anonymous",
                   !userId.hasPrefix("anon_") {
                    ReplayOrchestrator.shared.associateUser(userId)
                    DiagnosticLog.notice("[Rejourney] ✅ Restored user identity '\(userId)' to new session \(newSid)")
                }

                if let pause = self.userPause {
                    let inheritedPauseAtMs = UInt64(Date().timeIntervalSince1970 * 1_000)
                    ReplayOrchestrator.shared.recordCustomEvent(
                        name: "sdk_paused",
                        payload: RejourneyEventSerializer.jsonString(from: [
                            "pauseId": pause.id,
                            "reason": "session_rollover_while_paused",
                            "sdkVersion": Self.sdkVersion,
                            "apiStatus": "beta"
                        ])
                    )
                    SegmentDispatcher.shared.updatePauseState(
                        replayId: newSid,
                        pauseId: pause.id,
                        paused: true,
                        occurredAt: inheritedPauseAtMs
                    )
                    VisualCapture.shared.pauseForUser()
                    ReplayOrchestrator.shared.pauseForUser()
                    TelemetryPipeline.shared.pause()
                }

                DiagnosticLog.replayBegan(newSid)
                DiagnosticLog.notice("[Rejourney] ✅ New session started: \(newSid)")
                onReady?(newSid)
            } else if attempts < maxAttempts {
                // Keep polling
                self._waitForSessionReady(
                    savedUserId: savedUserId,
                    attempts: attempts + 1,
                    generation: generation,
                    onReady: onReady,
                    onTimeout: onTimeout
                )
            } else {
                DiagnosticLog.caution("[Rejourney] ⚠️ Timeout waiting for new session to initialize")
                self.stateLock.lock()
                if self.startGeneration == generation, case .starting = self.state {
                    self.state = .idle
                    self.startGeneration &+= 1
                }
                self.stateLock.unlock()
                ReplayOrchestrator.shared.cancelPendingReplayStart()
                onTimeout?()
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

        let userId = options["userId"] as? String ?? "anonymous"
        let apiUrl = options["apiUrl"] as? String ?? "https://api.rejourney.co"
        let publicKey = options["publicKey"] as? String ?? ""
        let projectId = (options["projectId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)

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
        if let val = options["captureLogs"] as? Bool { config["captureLogs"] = val }
        if let val = options["collectDeviceInfo"] as? Bool { config["collectDeviceInfo"] = val }
        if let val = options["collectGeoLocation"] as? Bool { config["collectGeoLocation"] = val }
        if let val = options["observeOnly"] as? Bool { config["observeOnly"] = val }
        if let val = options["textInputMasking"] as? String { config["textInputMasking"] = val }
        if let val = options["imageVideoMasking"] as? String { config["imageVideoMasking"] = val }
        if let val = options["captureNativeSheets"] as? Bool { config["captureNativeSheets"] = val }
        if let val = options["detectRageTaps"] as? Bool { config["detectRageTaps"] = val }
        if let val = options["rageTapThreshold"] as? NSNumber { config["rageTapThreshold"] = max(1, val.intValue) }
        if let val = options["rageTapTimeWindow"] as? NSNumber { config["rageTapTimeWindow"] = max(1, val.intValue) }
        if let val = options["rageTapRadius"] as? NSNumber { config["rageTapRadius"] = max(1.0, val.doubleValue) }

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
            switch self.state {
            case .active(let sid, _), .paused(let sid, _):
                self.stateLock.unlock()
                resolve(["success": true, "sessionId": sid])
                return
            case .starting(_, _):
                let activeSid = ReplayOrchestrator.shared.replayId
                self.stateLock.unlock()
                if let activeSid, !activeSid.isEmpty {
                    resolve(["success": true, "sessionId": activeSid])
                } else {
                    resolve(["success": false, "sessionId": "", "error": "Session is still starting"])
                }
                return
            default:
                self.stateLock.unlock()
            }

            if !userId.isEmpty && userId != "anonymous" && !userId.hasPrefix("anon_") {
                self.currentUserIdentity = userId
            }

            // Store config for session restart after background timeout
            self.lastSessionConfig = config
            self.lastApiUrl = apiUrl
            self.lastPublicKey = publicKey
            self.nativeNetworkTrackingEnabled = (options["autoTrackNetwork"] as? Bool) ?? true

            RejourneyNetworkEventFilter.configure(apiURLString: apiUrl)
            TelemetryPipeline.shared.endpoint = apiUrl
            TelemetryPipeline.shared.projectId = projectId?.isEmpty == false ? projectId : nil
            SegmentDispatcher.shared.endpoint = apiUrl
            SegmentDispatcher.shared.apiToken = publicKey
            DeviceRegistrar.shared.endpoint = apiUrl
            StabilityMonitor.shared.transmitStoredReport()

            // Activate native network interception
            if self.nativeNetworkTrackingEnabled { RejourneyURLProtocol.enable() }

            let pendingSessionId = "session_\(Int(Date().timeIntervalSince1970 * 1000))_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())"
            let pendingStart = Date().timeIntervalSince1970
            self.stateLock.lock()
            self.startGeneration &+= 1
            let generation = self.startGeneration
            self.state = .starting(sessionId: pendingSessionId, startTime: pendingStart)
            self.stateLock.unlock()

            ReplayOrchestrator.shared.beginReplay(apiToken: publicKey, serverEndpoint: apiUrl, captureSettings: config)

            self._waitForSessionReady(
                savedUserId: userId,
                attempts: 0,
                generation: generation,
                onReady: { sid in
                    resolve(["success": true, "sessionId": sid])
                },
                onTimeout: { [weak self] in
                    guard let self else { return }
                    self.stateLock.lock()
                    if self.startGeneration == generation, case .starting = self.state {
                        self.state = .idle
                    }
                    self.stateLock.unlock()
                    RejourneyURLProtocol.disable()
                    resolve(["success": false, "sessionId": "", "error": "Session start cancelled or timed out"])
                }
            )
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
            self.startGeneration &+= 1
            switch self.state {
            case .active(let sid, _), .paused(let sid, _):
                targetSid = sid
            case .starting:
                targetSid = ReplayOrchestrator.shared.replayId ?? ""
            default:
                break
            }
            self.state = .idle
            self.userPause = nil
            self.stateLock.unlock()
            ReplayOrchestrator.shared.cancelPendingReplayStart()

            // Disable native network interception
            RejourneyURLProtocol.disable()

            guard !targetSid.isEmpty else {
                resolve(["success": true, "sessionId": "", "uploadSuccess": true])
                return
            }

            ReplayOrchestrator.shared.endReplayWithReason("user_initiated") { success, uploaded in
                DiagnosticLog.replayEnded(targetSid)

                resolve([
                    "success": success,
                    "sessionId": targetSid,
                    "uploadSuccess": uploaded
                ])
            }
        }
    }

    @objc(pauseSession:reject:)
    public func pauseSession(
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.stateLock.lock()
            if self.userPause != nil {
                let active: Bool
                if case .active = self.state { active = true } else { active = false }
                self.stateLock.unlock()
                resolve(["success": active])
                return
            }
            guard case .active(let sid, _) = self.state,
                  ReplayOrchestrator.shared.replayId == sid else {
                self.stateLock.unlock()
                resolve(["success": false])
                return
            }
            let pause = UserPause(id: UUID().uuidString, startedAt: Date().timeIntervalSince1970)
            self.userPause = pause
            self.stateLock.unlock()

            ReplayOrchestrator.shared.recordCustomEvent(
                name: "sdk_paused",
                payload: RejourneyEventSerializer.jsonString(from: [
                    "pauseId": pause.id,
                    "sdkVersion": Self.sdkVersion,
                    "apiStatus": "beta"
                ])
            )
            SegmentDispatcher.shared.updatePauseState(
                replayId: sid,
                pauseId: pause.id,
                paused: true,
                occurredAt: UInt64(max(0, pause.startedAt * 1_000))
            )
            TelemetryPipeline.shared.dispatchNow()
            SegmentDispatcher.shared.shipPending()
            RejourneyURLProtocol.disable()
            VisualCapture.shared.pauseForUser()
            ReplayOrchestrator.shared.pauseForUser()
            TelemetryPipeline.shared.pause()
            resolve(["success": true, "sessionId": sid])
        }
    }

    @objc(resumeSession:reject:)
    public func resumeSession(
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.stateLock.lock()
            guard let pause = self.userPause else {
                let active: Bool
                if case .active = self.state { active = true } else { active = false }
                self.stateLock.unlock()
                resolve(["success": active])
                return
            }
            guard case .active(let sid, _) = self.state,
                  ReplayOrchestrator.shared.replayId == sid else {
                self.stateLock.unlock()
                resolve(["success": false])
                return
            }
            self.userPause = nil
            self.stateLock.unlock()

            let resumedAt = Date().timeIntervalSince1970
            TelemetryPipeline.shared.resume()
            ReplayOrchestrator.shared.recordCustomEvent(
                name: "sdk_resumed",
                payload: RejourneyEventSerializer.jsonString(from: [
                    "pauseId": pause.id,
                    "gapDurationMs": max(0, Int((resumedAt - pause.startedAt) * 1_000)),
                    "sdkVersion": Self.sdkVersion,
                    "apiStatus": "beta"
                ])
            )
            SegmentDispatcher.shared.updatePauseState(
                replayId: sid,
                pauseId: pause.id,
                paused: false,
                occurredAt: UInt64(max(0, resumedAt * 1_000))
            )
            ReplayOrchestrator.shared.resumeFromUser()
            VisualCapture.shared.resumeFromUser()
            if self.nativeNetworkTrackingEnabled { RejourneyURLProtocol.enable() }
            resolve(["success": true, "sessionId": sid])
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

    @objc(setAnonymousId:resolve:reject:)
    public func setAnonymousId(
        _ anonymousId: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        if anonymousId.isEmpty {
            UserDefaults.standard.removeObject(forKey: anonymousIdentityKey)
        } else {
            UserDefaults.standard.set(anonymousId, forKey: anonymousIdentityKey)
        }

        resolve(["success": true])
    }

    @objc(getAnonymousId:reject:)
    public func getAnonymousId(
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        let stored = UserDefaults.standard.string(forKey: anonymousIdentityKey)
        resolve(stored)
    }

    @objc(setCachedRemoteConfig:configJson:resolve:reject:)
    public func setCachedRemoteConfig(
        _ publicKey: String,
        configJson: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        guard !publicKey.isEmpty else {
            resolve(["success": false])
            return
        }
        UserDefaults.standard.set(configJson, forKey: remoteConfigCachePrefix + publicKey)
        resolve(["success": true])
    }

    @objc(getCachedRemoteConfig:resolve:reject:)
    public func getCachedRemoteConfig(
        _ publicKey: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        guard !publicKey.isEmpty else {
            resolve(nil)
            return
        }
        resolve(UserDefaults.standard.string(forKey: remoteConfigCachePrefix + publicKey))
    }

    @objc(clearCachedRemoteConfig:resolve:reject:)
    public func clearCachedRemoteConfig(
        _ publicKey: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        guard !publicKey.isEmpty else {
            resolve(["success": false])
            return
        }
        UserDefaults.standard.removeObject(forKey: remoteConfigCachePrefix + publicKey)
        resolve(["success": true])
    }

    @objc(logEvent:details:resolve:reject:)
    public func logEvent(
        _ eventType: String,
        details: NSDictionary,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        guard !isUserPaused() else {
            resolve(["success": true])
            return
        }
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
            let exceptionCategory = details["exceptionCategory"] as? String
            let source = details["source"] as? String
            let handled = details["handled"] as? Bool
            TelemetryPipeline.shared.recordJSErrorEvent(
                name: name,
                message: message,
                stack: stack,
                exceptionCategory: exceptionCategory,
                source: source,
                handled: handled
            )
            resolve(["success": true])
            return
        }

        // Handle legacy/direct dead_tap events while native-side detection owns
        // the automatic dead tap pipeline.
        if eventType == "dead_tap" {
            let x = (details["x"] as? NSNumber)?.uint64Value ?? 0
            let y = (details["y"] as? NSNumber)?.uint64Value ?? 0
            let label = details["label"] as? String ?? "unknown"
            guard !TelemetryPipeline.shared.isKeyboardVisible else {
                resolve(["success": true])
                return
            }
            TelemetryPipeline.shared.recordDeadTapEvent(label: label, x: x, y: y)
            ReplayOrchestrator.shared.incrementDeadTapTally()
            resolve(["success": true])
            return
        }

        // Handle console log events - preserve type:"log" with level and message
        // so the dashboard replay can display them in the console terminal
        if eventType == "log" {
            let level = details["level"] as? String ?? "log"
            let message = details["message"] as? String ?? ""
            TelemetryPipeline.shared.recordConsoleLogEvent(level: level, message: message)
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
        guard !isUserPaused() else {
            resolve(["success": true])
            return
        }
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
        guard !isUserPaused() else {
            resolve(["success": true])
            return
        }
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
        guard !isUserPaused() else {
            resolve(false)
            return
        }
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
        guard !isUserPaused() else {
            resolve(["success": true])
            return
        }
        ReplayOrchestrator.shared.recordCustomEvent(name: "external_url_opened", payload: "{\"scheme\":\"\(urlScheme)\"}")
        resolve(["success": true])
    }

    @objc(onOAuthStarted:resolve:reject:)
    public func onOAuthStarted(
        _ provider: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        guard !isUserPaused() else {
            resolve(["success": true])
            return
        }
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
        guard !isUserPaused() else {
            resolve(["success": true])
            return
        }
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
        guard let window = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap(\.windows)
            .first(where: { $0.isKeyWindow }) else { return nil }
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

    @objc(setRemoteConfigWithRejourneyEnabled:recordingEnabled:sampleRate:isSampledIn:maxRecordingMinutes:resolve:reject:)
    public func setRemoteConfig(
        rejourneyEnabled: Bool,
        recordingEnabled: Bool,
        sampleRate: Int,
        isSampledIn: Bool,
        maxRecordingMinutes: Int,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        DiagnosticLog.trace("[Rejourney] setRemoteConfig: rejourneyEnabled=\(rejourneyEnabled), recordingEnabled=\(recordingEnabled), sampleRate=\(sampleRate), isSampledIn=\(isSampledIn), maxRecording=\(maxRecordingMinutes)min")

        ReplayOrchestrator.shared.setRemoteConfig(
            rejourneyEnabled: rejourneyEnabled,
            recordingEnabled: recordingEnabled,
            sampleRate: sampleRate,
            isSampledIn: isSampledIn,
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
        let bounds = screen.bounds
        let scale = screen.scale

        var deviceInfo: [String: Any] = [
            "platform": "ios",
            "osVersion": device.systemVersion,
            "model": (DeviceRegistrar.shared.gatherDeviceProfile()["hwModel"] as? String) ?? device.model,
            "deviceName": device.name,
            "screenWidth": Int(bounds.width),
            "screenHeight": Int(bounds.height),
            "screenWidthPixels": Int(bounds.width * scale),
            "screenHeightPixels": Int(bounds.height * scale),
            "screenScale": scale,
            "pixelRatio": scale,
            "coordinateSpace": "pt",
            "deviceHash": computeHash(),
            "bundleId": Bundle.main.bundleIdentifier ?? "unknown"
        ]
        deviceInfo.merge(TelemetryPipeline.shared.currentBatteryInfo()) { _, new in new }
        resolve(deviceInfo)
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
