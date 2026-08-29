import Foundation
import UIKit

@MainActor
public enum Rejourney {
    public static func configure(publicKey: String, options: RejourneyOptions = .init()) {
        RejourneyNativeController.shared.configure(publicKey: publicKey, options: options)
    }

    public static func start() async -> RejourneyStartResult {
        await RejourneyNativeController.shared.start()
    }

    public static func start(completion: @escaping @Sendable (RejourneyStartResult) -> Void) {
        Task { @MainActor in
            completion(await start())
        }
    }

    public static func stop() async -> RejourneyStopResult {
        await RejourneyNativeController.shared.stop()
    }

    public static func stop(completion: @escaping @Sendable (RejourneyStopResult) -> Void) {
        Task { @MainActor in
            completion(await stop())
        }
    }

    /// Beta: suspends capture and telemetry without ending the active session.
    @discardableResult
    public static func pause() -> Bool {
        RejourneyNativeController.shared.pause()
    }

    /// Beta: resumes a session suspended by `pause()`.
    @discardableResult
    public static func resume() -> Bool {
        RejourneyNativeController.shared.resume()
    }

    public static var currentSessionId: String? {
        RejourneyNativeController.shared.currentSessionId
    }

    public static func identify(_ userId: String) {
        RejourneyNativeController.shared.identify(userId)
    }

    public static func clearIdentity() {
        RejourneyNativeController.shared.clearIdentity()
    }

    public static func trackScreen(_ screenName: String) {
        RejourneyNativeController.shared.trackScreen(screenName)
    }

    public static func logEvent(_ name: String, properties: [String: RejourneyMetadataValue] = [:]) {
        RejourneyNativeController.shared.logEvent(name, properties: properties)
    }

    public static func setMetadata(_ key: String, _ value: RejourneyMetadataValue) {
        RejourneyNativeController.shared.setMetadata(key, value)
    }

    public static func setMetadata(_ metadata: [String: RejourneyMetadataValue]) {
        metadata.forEach { key, value in
            RejourneyNativeController.shared.setMetadata(key, value)
        }
    }

    public static func mask(_ view: UIView) {
        RejourneyNativeController.shared.mask(view)
    }

    public static func unmask(_ view: UIView) {
        RejourneyNativeController.shared.unmask(view)
    }

    public static func setDebugMode(_ enabled: Bool) {
        RejourneyNativeController.shared.setDebugMode(enabled)
    }
}

public struct RejourneyOptions: Sendable, Equatable {
    public var apiURL: URL
    public var userId: String?
    public var enabled: Bool
    public var observeOnly: Bool
    public var captureFPS: Int?
    public var captureQuality: RejourneyCaptureQuality
    public var wifiOnly: Bool
    public var captureScreen: Bool
    public var captureAnalytics: Bool
    public var captureCrashes: Bool
    public var captureANR: Bool
    public var trackConsoleLogs: Bool
    public var collectDeviceInfo: Bool
    public var collectGeoLocation: Bool
    public var autoTrackNetwork: Bool
    public var captureNativeSheets: Bool
    public var detectRageTaps: Bool
    public var rageTapThreshold: Int
    public var rageTapTimeWindow: Int
    public var rageTapRadius: Double
    public var debug: Bool

    public init(
        apiURL: URL = URL(string: "https://api.rejourney.co")!,
        userId: String? = nil,
        enabled: Bool = true,
        observeOnly: Bool = false,
        captureFPS: Int? = nil,
        captureQuality: RejourneyCaptureQuality = .medium,
        wifiOnly: Bool = false,
        captureScreen: Bool = true,
        captureAnalytics: Bool = true,
        captureCrashes: Bool = true,
        captureANR: Bool = true,
        trackConsoleLogs: Bool = true,
        collectDeviceInfo: Bool = true,
        collectGeoLocation: Bool = true,
        autoTrackNetwork: Bool = true,
        captureNativeSheets: Bool = true,
        detectRageTaps: Bool = true,
        rageTapThreshold: Int = 3,
        rageTapTimeWindow: Int = 500,
        rageTapRadius: Double = 50,
        debug: Bool = false
    ) {
        self.apiURL = apiURL
        self.userId = userId
        self.enabled = enabled
        self.observeOnly = observeOnly
        self.captureFPS = captureFPS
        self.captureQuality = captureQuality
        self.wifiOnly = wifiOnly
        self.captureScreen = captureScreen
        self.captureAnalytics = captureAnalytics
        self.captureCrashes = captureCrashes
        self.captureANR = captureANR
        self.trackConsoleLogs = trackConsoleLogs
        self.collectDeviceInfo = collectDeviceInfo
        self.collectGeoLocation = collectGeoLocation
        self.autoTrackNetwork = autoTrackNetwork
        self.captureNativeSheets = captureNativeSheets
        self.detectRageTaps = detectRageTaps
        self.rageTapThreshold = max(1, rageTapThreshold)
        self.rageTapTimeWindow = max(1, rageTapTimeWindow)
        self.rageTapRadius = max(1, rageTapRadius)
        self.debug = debug
    }
}

public enum RejourneyCaptureQuality: String, Sendable, Equatable {
    case low
    case medium
    case high
}

public struct RejourneyStartResult: Sendable, Equatable {
    public let success: Bool
    public let sessionId: String?
    public let error: String?
    public let telemetryOnly: Bool

    public init(success: Bool, sessionId: String?, error: String? = nil, telemetryOnly: Bool = false) {
        self.success = success
        self.sessionId = sessionId
        self.error = error
        self.telemetryOnly = telemetryOnly
    }
}

public struct RejourneyStopResult: Sendable, Equatable {
    public let success: Bool
    public let sessionId: String?
    public let uploadSuccess: Bool

    public init(success: Bool, sessionId: String?, uploadSuccess: Bool) {
        self.success = success
        self.sessionId = sessionId
        self.uploadSuccess = uploadSuccess
    }
}

public indirect enum RejourneyMetadataValue: Sendable, Equatable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case array([RejourneyMetadataValue])
    case object([String: RejourneyMetadataValue])
    case null
}

extension RejourneyMetadataValue: ExpressibleByStringLiteral {
    public init(stringLiteral value: String) {
        self = .string(value)
    }
}

extension RejourneyMetadataValue: ExpressibleByIntegerLiteral {
    public init(integerLiteral value: Int) {
        self = .int(value)
    }
}

extension RejourneyMetadataValue: ExpressibleByFloatLiteral {
    public init(floatLiteral value: Double) {
        self = .double(value)
    }
}

extension RejourneyMetadataValue: ExpressibleByBooleanLiteral {
    public init(booleanLiteral value: Bool) {
        self = .bool(value)
    }
}

extension RejourneyMetadataValue: ExpressibleByNilLiteral {
    public init(nilLiteral: ()) {
        self = .null
    }
}

struct RejourneyReadySessionContext: Equatable {
    let userId: String?
    let screenNames: [String]
    let metadata: [String: RejourneyMetadataValue]
}

struct RejourneySessionContext: Equatable {
    private(set) var currentUserId: String?
    private(set) var lastScreenName: String?
    private var queuedScreenNames: [String] = []
    private var metadata: [String: RejourneyMetadataValue] = [:]
    private let maxQueuedScreens = 50

    mutating func setUserId(_ userId: String?) {
        guard let userId, Self.isRealUserId(userId) else {
            currentUserId = nil
            return
        }
        currentUserId = userId
    }

    mutating func clearUserId() {
        currentUserId = nil
    }

    mutating func setMetadata(_ key: String, _ value: RejourneyMetadataValue) {
        guard !key.isEmpty else { return }
        metadata[key] = value
    }

    mutating func trackScreen(_ screenName: String, sessionActive: Bool) -> Bool {
        guard !screenName.isEmpty else { return false }
        lastScreenName = screenName

        if sessionActive {
            return true
        }

        if queuedScreenNames.last != screenName {
            queuedScreenNames.append(screenName)
            if queuedScreenNames.count > maxQueuedScreens {
                queuedScreenNames.removeFirst(queuedScreenNames.count - maxQueuedScreens)
            }
        }
        return false
    }

    mutating func replayContextForReadySession(includeLastKnownScreen: Bool = true) -> RejourneyReadySessionContext {
        var screenNames = queuedScreenNames
        if includeLastKnownScreen, let lastScreenName, screenNames.last != lastScreenName {
            screenNames.append(lastScreenName)
        }
        queuedScreenNames.removeAll()

        return RejourneyReadySessionContext(
            userId: currentUserId,
            screenNames: Self.deduplicatingConsecutive(screenNames),
            metadata: metadata
        )
    }

    private static func isRealUserId(_ userId: String) -> Bool {
        !userId.isEmpty && userId != "anonymous" && !userId.hasPrefix("anon_")
    }

    private static func deduplicatingConsecutive(_ values: [String]) -> [String] {
        var result: [String] = []
        result.reserveCapacity(values.count)
        for value in values where result.last != value {
            result.append(value)
        }
        return result
    }
}

@MainActor
final class RejourneyNativeController: NSObject {
    static let shared = RejourneyNativeController()

    private enum SessionState: Equatable {
        case idle
        case starting(sessionId: String)
        case active(sessionId: String)
        case paused(sessionId: String, backgroundedAt: TimeInterval)
        case terminated
    }

    private var state: SessionState = .idle
    private var startGeneration: UInt64 = 0
    private var publicKey: String?
    private var options = RejourneyOptions()
    private var activeRemoteConfig = RejourneyRemoteConfig.defaultConfig
    private var currentUserIdentity: String?
    private var sessionContext = RejourneySessionContext()
    private struct UserPause {
        let id: String
        let startedAt: TimeInterval
    }
    private var userPause: UserPause?
    private let identityKey = "com.rejourney.native.user.identity"
    private let remoteConfigClient: RejourneyRemoteConfigClient

    private let sessionTimeoutSeconds: TimeInterval = 60
    private let sessionRolloverGraceSeconds: TimeInterval = 2

    var currentSessionId: String? {
        switch state {
        case .active(let sessionId), .paused(let sessionId, _), .starting(let sessionId):
            return sessionId.hasPrefix("pending_") ? ReplayOrchestrator.shared.replayId : sessionId
        case .idle, .terminated:
            return ReplayOrchestrator.shared.replayId
        }
    }

    override convenience private init() {
        self.init(remoteConfigClient: RejourneyRemoteConfigClient())
    }

    init(remoteConfigClient: RejourneyRemoteConfigClient) {
        self.remoteConfigClient = remoteConfigClient
        super.init()
        currentUserIdentity = UserDefaults.standard.string(forKey: identityKey)
        sessionContext.setUserId(currentUserIdentity)
        setupLifecycleListeners()
        ReplayOrchestrator.shared.recoverInterruptedReplay { recoveredId in
            if let recoveredId {
                DiagnosticLog.notice("[Rejourney] Recovered interrupted native session: \(recoveredId)")
            }
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    func configure(publicKey: String, options: RejourneyOptions) {
        self.publicKey = publicKey
        self.options = options
        let apiURLString = options.apiURL.rejourneyAbsoluteString
        RejourneyNetworkEventFilter.configure(apiURLString: apiURLString)
        SegmentDispatcher.shared.endpoint = apiURLString
        SegmentDispatcher.shared.apiToken = publicKey
        StabilityMonitor.shared.transmitStoredReport()
        if let userId = options.userId, !userId.isEmpty {
            currentUserIdentity = userId
            sessionContext.setUserId(userId)
        }
        setDebugMode(options.debug)
        DiagnosticLog.sdkReady(RejourneySDKInfo.version)
    }

    func start() async -> RejourneyStartResult {
        guard options.enabled else {
            return RejourneyStartResult(success: false, sessionId: nil, error: "disabled")
        }

        guard let publicKey, !publicKey.isEmpty else {
            return RejourneyStartResult(success: false, sessionId: nil, error: "publicKey is required")
        }

        switch state {
        case .active(let sessionId), .paused(let sessionId, _):
            return RejourneyStartResult(success: true, sessionId: sessionId, telemetryOnly: isTelemetryOnly)
        case .starting:
            return RejourneyStartResult(success: false, sessionId: nil, error: "Session is still starting")
        case .idle, .terminated:
            break
        }

        startGeneration &+= 1
        let generation = startGeneration
        let pendingSessionId = "pending_\(Int(Date().timeIntervalSince1970 * 1000))"
        state = .starting(sessionId: pendingSessionId)

        let configResult = await remoteConfigClient.fetch(apiURL: options.apiURL, publicKey: publicKey)
        guard generation == startGeneration, case .starting = state else {
            return RejourneyStartResult(success: false, sessionId: nil, error: "start_cancelled")
        }
        let remoteConfig: RejourneyRemoteConfig?

        switch configResult {
        case .success(let config):
            remoteConfig = config
        case .networkError:
            remoteConfig = nil
        case .accessDenied(let statusCode):
            state = .idle
            return RejourneyStartResult(
                success: false,
                sessionId: nil,
                error: "access_denied_\(statusCode)"
            )
        }

        let startState = RejourneySessionPolicy.derive(remoteConfig: remoteConfig)
        if let blockedReason = startState.blockedReason {
            state = .idle
            return RejourneyStartResult(success: false, sessionId: nil, error: blockedReason.rawValue)
        }

        if startState.sessionSampledOut {
            state = .idle
            return RejourneyStartResult(success: false, sessionId: nil, error: "sampled_out")
        }

        let effectiveRemoteConfig = startState.effectiveRemoteConfig
        activeRemoteConfig = effectiveRemoteConfig
        let recordingEnabled = effectiveRemoteConfig.recordingEnabled
            && !options.observeOnly
            && options.captureScreen

        ReplayOrchestrator.shared.setRemoteConfig(
            rejourneyEnabled: effectiveRemoteConfig.rejourneyEnabled,
            recordingEnabled: recordingEnabled,
            sampleRate: effectiveRemoteConfig.sampleRate,
            isSampledIn: !startState.sessionSampledOut,
            maxRecordingMinutes: effectiveRemoteConfig.maxRecordingMinutes
        )

        TelemetryPipeline.shared.projectId = effectiveRemoteConfig.projectId
        SegmentDispatcher.shared.projectId = effectiveRemoteConfig.projectId
        StabilityMonitor.shared.transmitStoredReport()
        TelemetryPipeline.shared.endpoint = options.apiURL.rejourneyAbsoluteString
        SegmentDispatcher.shared.endpoint = options.apiURL.rejourneyAbsoluteString
        DeviceRegistrar.shared.endpoint = options.apiURL.rejourneyAbsoluteString

        if options.autoTrackNetwork {
            RejourneyURLProtocol.enable()
        } else {
            RejourneyURLProtocol.disable()
        }

        let captureSettings = RejourneyCaptureSettings(
            options: options,
            recordingEnabled: recordingEnabled,
            textInputMasking: effectiveRemoteConfig.textInputMasking,
            imageVideoMasking: effectiveRemoteConfig.imageVideoMasking,
            recordingFps: remoteConfig == nil ? nil : effectiveRemoteConfig.recordingFps
        ).nativeDictionary

        if let existingCredential = DeviceRegistrar.shared.uploadCredential,
           DeviceRegistrar.shared.credentialValid {
            ReplayOrchestrator.shared.beginReplayFast(
                apiToken: publicKey,
                serverEndpoint: options.apiURL.rejourneyAbsoluteString,
                credential: existingCredential,
                captureSettings: captureSettings
            )
        } else {
            ReplayOrchestrator.shared.beginReplay(
                apiToken: publicKey,
                serverEndpoint: options.apiURL.rejourneyAbsoluteString,
                captureSettings: captureSettings
            )
        }

        guard let sessionId = await waitForSessionReady(
            userId: currentUserIdentity ?? options.userId,
            generation: generation
        ) else {
            if generation == startGeneration {
                state = .idle
                ReplayOrchestrator.shared.cancelPendingReplayStart()
                RejourneyURLProtocol.disable()
            }
            return RejourneyStartResult(
                success: false,
                sessionId: nil,
                error: "Timed out waiting for replay session to initialize"
            )
        }

        let telemetryOnly = !recordingEnabled
        return RejourneyStartResult(success: true, sessionId: sessionId, telemetryOnly: telemetryOnly)
    }

    func stop() async -> RejourneyStopResult {
        let targetSessionId = currentSessionId ?? ""
        startGeneration &+= 1
        state = .idle
        userPause = nil
        ReplayOrchestrator.shared.cancelPendingReplayStart()
        RejourneyURLProtocol.disable()

        guard !targetSessionId.isEmpty else {
            return RejourneyStopResult(success: true, sessionId: nil, uploadSuccess: true)
        }

        return await withCheckedContinuation { continuation in
            ReplayOrchestrator.shared.endReplayWithReason("user_initiated") { success, uploaded in
                DiagnosticLog.replayEnded(targetSessionId)
                continuation.resume(
                    returning: RejourneyStopResult(
                        success: success,
                        sessionId: targetSessionId,
                        uploadSuccess: uploaded
                    )
                )
            }
        }
    }

    func pause() -> Bool {
        if userPause != nil { return hasActiveReplaySession }
        guard case .active(let sessionId) = state,
              ReplayOrchestrator.shared.replayId == sessionId else { return false }

        let pause = UserPause(id: UUID().uuidString, startedAt: Date().timeIntervalSince1970)
        userPause = pause
        ReplayOrchestrator.shared.recordCustomEvent(
            name: "sdk_paused",
            payload: RejourneyEventSerializer.jsonString(from: [
                "pauseId": pause.id,
                "sdkVersion": RejourneySDKInfo.version,
                "apiStatus": "beta"
            ])
        )
        SegmentDispatcher.shared.updatePauseState(
            replayId: sessionId,
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
        return true
    }

    func resume() -> Bool {
        guard let pause = userPause else { return hasActiveReplaySession }
        guard case .active(let sessionId) = state,
              ReplayOrchestrator.shared.replayId == sessionId else { return false }

        userPause = nil
        TelemetryPipeline.shared.resume()
        let resumedAt = Date().timeIntervalSince1970
        let gapMs = max(0, Int((resumedAt - pause.startedAt) * 1_000))
        ReplayOrchestrator.shared.recordCustomEvent(
            name: "sdk_resumed",
            payload: RejourneyEventSerializer.jsonString(from: [
                "pauseId": pause.id,
                "gapDurationMs": gapMs,
                "sdkVersion": RejourneySDKInfo.version,
                "apiStatus": "beta"
            ])
        )
        SegmentDispatcher.shared.updatePauseState(
            replayId: sessionId,
            pauseId: pause.id,
            paused: false,
            occurredAt: UInt64(max(0, resumedAt * 1_000))
        )
        ReplayOrchestrator.shared.resumeFromUser()
        VisualCapture.shared.resumeFromUser()
        if options.autoTrackNetwork { RejourneyURLProtocol.enable() }
        return true
    }

    func identify(_ userId: String) {
        guard !userId.isEmpty, userId != "anonymous", !userId.hasPrefix("anon_") else {
            clearIdentity()
            return
        }
        currentUserIdentity = userId
        sessionContext.setUserId(userId)
        UserDefaults.standard.set(userId, forKey: identityKey)

        if hasActiveReplaySession {
            ReplayOrchestrator.shared.associateUser(userId)
        }
    }

    func clearIdentity() {
        currentUserIdentity = nil
        sessionContext.clearUserId()
        UserDefaults.standard.removeObject(forKey: identityKey)
    }

    func trackScreen(_ screenName: String) {
        guard userPause == nil, !screenName.isEmpty else { return }
        guard sessionContext.trackScreen(screenName, sessionActive: hasActiveReplaySession) else {
            return
        }
        recordScreenTransition(screenName)
    }

    private func recordScreenTransition(_ screenName: String) {
        TelemetryPipeline.shared.recordViewTransition(
            viewId: screenName,
            viewLabel: screenName,
            entering: true
        )
        ReplayOrchestrator.shared.logScreenView(screenName)
    }

    func logEvent(_ name: String, properties: [String: RejourneyMetadataValue]) {
        guard userPause == nil, !name.isEmpty else { return }
        let object = RejourneyEventSerializer.jsonObject(from: properties)

        switch name {
        case "network_request":
            TelemetryPipeline.shared.recordNetworkEvent(details: object)
        case "error":
            let message = object["message"] as? String ?? "Unknown error"
            let errorName = object["name"] as? String ?? "Error"
            let stack = object["stack"] as? String
            TelemetryPipeline.shared.recordJSErrorEvent(name: errorName, message: message, stack: stack)
        case "log":
            let level = object["level"] as? String ?? "log"
            let message = object["message"] as? String ?? ""
            TelemetryPipeline.shared.recordConsoleLogEvent(level: level, message: message)
        default:
            ReplayOrchestrator.shared.recordCustomEvent(
                name: name,
                payload: RejourneyEventSerializer.jsonString(from: object)
            )
        }
    }

    func setMetadata(_ key: String, _ value: RejourneyMetadataValue) {
        guard !key.isEmpty else { return }
        sessionContext.setMetadata(key, value)
        if hasActiveReplaySession {
            ReplayOrchestrator.shared.attachAttribute(key: key, value: value.attributeString)
        }
    }

    func mask(_ view: UIView) {
        ReplayOrchestrator.shared.redactView(view)
    }

    func unmask(_ view: UIView) {
        ReplayOrchestrator.shared.unredactView(view)
    }

    func setDebugMode(_ enabled: Bool) {
        DiagnosticLog.setVerbose(enabled)
    }

    private var isTelemetryOnly: Bool {
        !ReplayOrchestrator.shared.visualCaptureEnabled || options.observeOnly || !options.captureScreen
    }

    private var hasActiveReplaySession: Bool {
        guard case .active = state else { return false }
        guard let replayId = ReplayOrchestrator.shared.replayId, !replayId.isEmpty else { return false }
        return true
    }

    private func waitForSessionReady(userId: String?, generation: UInt64) async -> String? {
        for _ in 0..<50 {
            guard generation == startGeneration, case .starting = state else { return nil }
            try? await Task.sleep(nanoseconds: 100_000_000)
            guard generation == startGeneration, case .starting = state else { return nil }
            if let sessionId = ReplayOrchestrator.shared.replayId, !sessionId.isEmpty {
                state = .active(sessionId: sessionId)
                ReplayOrchestrator.shared.activateGestureRecording()
                if sessionContext.currentUserId == nil, let userId {
                    sessionContext.setUserId(userId)
                }
                applySessionContextToActiveReplay()
                if let pause = userPause {
                    let inheritedPauseAtMs = UInt64(Date().timeIntervalSince1970 * 1_000)
                    ReplayOrchestrator.shared.recordCustomEvent(
                        name: "sdk_paused",
                        payload: RejourneyEventSerializer.jsonString(from: [
                            "pauseId": pause.id,
                            "reason": "session_rollover_while_paused",
                            "sdkVersion": RejourneySDKInfo.version,
                            "apiStatus": "beta"
                        ])
                    )
                    SegmentDispatcher.shared.updatePauseState(
                        replayId: sessionId,
                        pauseId: pause.id,
                        paused: true,
                        occurredAt: inheritedPauseAtMs
                    )
                    VisualCapture.shared.pauseForUser()
                    ReplayOrchestrator.shared.pauseForUser()
                    TelemetryPipeline.shared.pause()
                }
                DiagnosticLog.replayBegan(sessionId)
                return sessionId
            }
        }
        return nil
    }

    private func applySessionContextToActiveReplay(includeLastKnownScreen: Bool = true) {
        let context = sessionContext.replayContextForReadySession(includeLastKnownScreen: includeLastKnownScreen)
        if let userId = context.userId {
            ReplayOrchestrator.shared.associateUser(userId)
            DiagnosticLog.notice("[Rejourney] Restored user identity '\(userId)' to active native session")
        }
        for screenName in context.screenNames {
            recordScreenTransition(screenName)
        }
        for (key, value) in context.metadata {
            ReplayOrchestrator.shared.attachAttribute(key: key, value: value.attributeString)
        }
    }

    private func setupLifecycleListeners() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(handleTermination), name: UIApplication.willTerminateNotification, object: nil)
        center.addObserver(self, selector: #selector(handleBackgrounding), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(handleForegrounding), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc private func handleTermination() {
        switch state {
        case .active, .paused:
            break
        case .idle, .starting, .terminated:
            return
        }
        state = .terminated
        if let sessionId = ReplayOrchestrator.shared.replayId, !sessionId.isEmpty {
            ReplayOrchestrator.shared.endReplayWithReason("termination") { _, _ in }
        } else {
            TelemetryPipeline.shared.finalizeAndShip()
            SegmentDispatcher.shared.shipPending()
        }
    }

    @objc private func handleBackgrounding() {
        guard case .active(let sessionId) = state else { return }
        state = .paused(sessionId: sessionId, backgroundedAt: ProcessInfo.processInfo.systemUptime)
        DiagnosticLog.notice("[Rejourney] ⏸️ Session '\(sessionId)' paused (app backgrounded)")
        TelemetryPipeline.shared.recordAppBackground()
        TelemetryPipeline.shared.dispatchNow()
        SegmentDispatcher.shared.shipPending()
        TelemetryPipeline.shared.pause()
    }

    @objc private func handleForegrounding() {
        guard case .paused(let sessionId, let backgroundedAt) = state else { return }

        let backgroundDuration = max(0, ProcessInfo.processInfo.systemUptime - backgroundedAt)
        DiagnosticLog.notice("[Rejourney] App foregrounded after \(Int(backgroundDuration))s (timeout: \(Int(sessionTimeoutSeconds))s)")

        if userPause == nil {
            TelemetryPipeline.shared.resume()
        }

        if backgroundDuration > sessionTimeoutSeconds {
            startGeneration &+= 1
            let rolloverGeneration = startGeneration
            state = .idle
            DiagnosticLog.notice("[Rejourney] 🔄 Session timeout! Ending session '\(sessionId)' and creating new one")

            let restartLock = NSLock()
            var restartStarted = false
            let triggerRestart: (String) -> Void = { [weak self] source in
                restartLock.lock()
                defer { restartLock.unlock() }
                guard !restartStarted else { return }
                restartStarted = true
                DiagnosticLog.notice("[Rejourney] Session rollover trigger source=\(source), oldSession=\(sessionId)")
                Task { @MainActor [weak self] in
                    await self?.startNewSessionAfterTimeout(expectedGeneration: rolloverGeneration)
                }
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + sessionRolloverGraceSeconds) {
                restartLock.lock()
                let shouldWarn = !restartStarted
                restartLock.unlock()
                if shouldWarn {
                    DiagnosticLog.caution("[Rejourney] Session rollover grace timeout reached, forcing new session start")
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
                DiagnosticLog.notice("[Rejourney] Session ended while backgrounded, starting fresh session on foreground")
                Task { @MainActor [weak self] in
                    await self?.startNewSessionAfterTimeout(expectedGeneration: rolloverGeneration)
                }
                return
            }

            if let orchestratorSessionId, orchestratorSessionId != sessionId {
                state = .active(sessionId: orchestratorSessionId)
                DiagnosticLog.notice("[Rejourney] ▶️ Foreground reconciled to active session '\(orchestratorSessionId)' (was '\(sessionId)')")
            } else {
                state = .active(sessionId: sessionId)
                DiagnosticLog.notice("[Rejourney] ▶️ Resuming session '\(sessionId)'")
            }

            if userPause == nil {
                let bgMs = UInt64(backgroundDuration * 1000)
                TelemetryPipeline.shared.recordAppForeground(totalBackgroundTimeMs: bgMs)
                applySessionContextToActiveReplay(includeLastKnownScreen: false)
            }
            StabilityMonitor.shared.transmitStoredReport()
        }
    }

    @MainActor
    private func startNewSessionAfterTimeout(expectedGeneration: UInt64) async {
        guard expectedGeneration == startGeneration, case .idle = state else { return }
        guard let publicKey, !publicKey.isEmpty else {
            DiagnosticLog.caution("[Rejourney] Cannot restart session - missing API config")
            return
        }

        let savedUserId = currentUserIdentity
        DiagnosticLog.notice("[Rejourney] Starting new session after timeout (user: \(savedUserId ?? "nil"))")
        let generation = expectedGeneration
        state = .starting(sessionId: "pending_\(Int(Date().timeIntervalSince1970 * 1000))")

        let captureSettings = RejourneyCaptureSettings(
            options: options,
            recordingEnabled: ReplayOrchestrator.shared.remoteRecordingEnabled,
            textInputMasking: activeRemoteConfig.textInputMasking,
            imageVideoMasking: activeRemoteConfig.imageVideoMasking,
            recordingFps: activeRemoteConfig.recordingFps
        ).nativeDictionary

        if let existingCred = DeviceRegistrar.shared.uploadCredential,
           DeviceRegistrar.shared.credentialValid {
            DiagnosticLog.notice("[Rejourney] Using cached credentials for fast session restart")
            ReplayOrchestrator.shared.beginReplayFast(
                apiToken: publicKey,
                serverEndpoint: options.apiURL.rejourneyAbsoluteString,
                credential: existingCred,
                captureSettings: captureSettings
            )
        } else {
            DiagnosticLog.notice("[Rejourney] No cached credentials, doing full session start")
            ReplayOrchestrator.shared.beginReplay(
                apiToken: publicKey,
                serverEndpoint: options.apiURL.rejourneyAbsoluteString,
                captureSettings: captureSettings
            )
        }

        guard let newSessionId = await waitForSessionReady(userId: savedUserId, generation: generation) else {
            if generation == startGeneration, case .starting = state {
                state = .idle
                ReplayOrchestrator.shared.cancelPendingReplayStart()
                RejourneyURLProtocol.disable()
            }
            DiagnosticLog.caution("[Rejourney] ⚠️ Timeout waiting for new session to initialize after rollover")
            return
        }

        DiagnosticLog.notice("[Rejourney] ✅ New session started after rollover: \(newSessionId)")
    }
}

enum RejourneyConfigFetchResult: Equatable {
    case success(RejourneyRemoteConfig)
    case networkError
    case accessDenied(Int)
}

struct RejourneyRemoteConfig: Codable, Equatable, Sendable {
    let projectId: String
    let rejourneyEnabled: Bool
    let recordingEnabled: Bool
    let textInputMasking: String
    let imageVideoMasking: String
    let recordingFps: Int
    let sampleRate: Int
    let maxRecordingMinutes: Int
    let billingBlocked: Bool
    let billingReason: String?

    static let defaultConfig = RejourneyRemoteConfig(
        projectId: "default",
        rejourneyEnabled: true,
        recordingEnabled: true,
        textInputMasking: "all",
        imageVideoMasking: "none",
        recordingFps: 1,
        sampleRate: 100,
        maxRecordingMinutes: 10,
        billingBlocked: false,
        billingReason: nil
    )

    enum CodingKeys: String, CodingKey {
        case projectId
        case rejourneyEnabled
        case recordingEnabled
        case textInputMasking
        case imageVideoMasking
        case recordingFps
        case sampleRate
        case maxRecordingMinutes
        case billingBlocked
        case billingReason
    }

    init(
        projectId: String,
        rejourneyEnabled: Bool,
        recordingEnabled: Bool,
        textInputMasking: String = "all",
        imageVideoMasking: String = "none",
        recordingFps: Int = 1,
        sampleRate: Int,
        maxRecordingMinutes: Int,
        billingBlocked: Bool,
        billingReason: String?
    ) {
        self.projectId = projectId
        self.rejourneyEnabled = rejourneyEnabled
        self.recordingEnabled = recordingEnabled
        self.textInputMasking = textInputMasking == "secure_only" ? "secure_only" : "all"
        self.imageVideoMasking = imageVideoMasking == "all" ? "all" : "none"
        self.recordingFps = min(3, max(1, recordingFps))
        self.sampleRate = min(100, max(0, sampleRate))
        self.maxRecordingMinutes = max(1, maxRecordingMinutes)
        self.billingBlocked = billingBlocked
        self.billingReason = billingReason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            projectId: (try? container.decode(String.self, forKey: .projectId)) ?? "default",
            rejourneyEnabled: (try? container.decode(Bool.self, forKey: .rejourneyEnabled)) ?? true,
            recordingEnabled: (try? container.decode(Bool.self, forKey: .recordingEnabled)) ?? true,
            textInputMasking: (try? container.decode(String.self, forKey: .textInputMasking)) ?? "all",
            imageVideoMasking: (try? container.decode(String.self, forKey: .imageVideoMasking)) ?? "none",
            recordingFps: Self.decodeInt(container, .recordingFps, defaultValue: 1),
            sampleRate: Self.decodeInt(container, .sampleRate, defaultValue: 100),
            maxRecordingMinutes: Self.decodeInt(container, .maxRecordingMinutes, defaultValue: 10),
            billingBlocked: (try? container.decode(Bool.self, forKey: .billingBlocked)) ?? false,
            billingReason: try? container.decode(String.self, forKey: .billingReason)
        )
    }

    private static func decodeInt(
        _ container: KeyedDecodingContainer<CodingKeys>,
        _ key: CodingKeys,
        defaultValue: Int
    ) -> Int {
        if let intValue = try? container.decode(Int.self, forKey: key) {
            return intValue
        }
        if let doubleValue = try? container.decode(Double.self, forKey: key) {
            return Int(doubleValue.rounded())
        }
        if let stringValue = try? container.decode(String.self, forKey: key),
           let intValue = Int(stringValue) {
            return intValue
        }
        return defaultValue
    }
}

enum RejourneyBlockedReason: String, Equatable {
    case disabled
    case billingBlocked
}

struct RejourneyRemoteStartState: Equatable {
    let effectiveRemoteConfig: RejourneyRemoteConfig
    let sessionSampledOut: Bool
    let blockedReason: RejourneyBlockedReason?
}

enum RejourneySessionPolicy {
    static func derive(
        remoteConfig: RejourneyRemoteConfig?,
        randomValue: Double = Double.random(in: 0..<100)
    ) -> RejourneyRemoteStartState {
        guard let remoteConfig else {
            return RejourneyRemoteStartState(
                effectiveRemoteConfig: .defaultConfig,
                sessionSampledOut: false,
                blockedReason: nil
            )
        }

        if !remoteConfig.rejourneyEnabled {
            return RejourneyRemoteStartState(
                effectiveRemoteConfig: remoteConfig,
                sessionSampledOut: false,
                blockedReason: .disabled
            )
        }

        if remoteConfig.billingBlocked {
            return RejourneyRemoteStartState(
                effectiveRemoteConfig: remoteConfig,
                sessionSampledOut: false,
                blockedReason: .billingBlocked
            )
        }

        let sampledIn: Bool
        if remoteConfig.sampleRate >= 100 {
            sampledIn = true
        } else if remoteConfig.sampleRate <= 0 {
            sampledIn = false
        } else {
            sampledIn = randomValue < Double(remoteConfig.sampleRate)
        }

        return RejourneyRemoteStartState(
            effectiveRemoteConfig: remoteConfig,
            sessionSampledOut: !sampledIn,
            blockedReason: nil
        )
    }
}

protocol RejourneyURLSession {
    func rejourneyData(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: RejourneyURLSession {
    func rejourneyData(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await data(for: request)
    }
}

struct RejourneyRemoteConfigClient {
    private let session: RejourneyURLSession
    private let decoder = JSONDecoder()

    init(session: RejourneyURLSession = URLSession.shared) {
        self.session = session
    }

    func fetch(apiURL: URL, publicKey: String) async -> RejourneyConfigFetchResult {
        guard var components = URLComponents(url: apiURL, resolvingAgainstBaseURL: false) else {
            return .networkError
        }

        let basePath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path = "/" + ([basePath, "api/sdk/config"].filter { !$0.isEmpty }.joined(separator: "/"))

        guard let url = components.url else {
            return .networkError
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(publicKey, forHTTPHeaderField: "x-public-key")
        request.setValue("ios", forHTTPHeaderField: "x-platform")
        if let bundleId = Bundle.main.bundleIdentifier, !bundleId.isEmpty {
            request.setValue(bundleId, forHTTPHeaderField: "x-bundle-id")
        }

        do {
            let (data, response) = try await session.rejourneyData(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                return .networkError
            }

            if httpResponse.statusCode == 401 || httpResponse.statusCode == 403 || httpResponse.statusCode == 404 {
                return .accessDenied(httpResponse.statusCode)
            }

            guard (200..<300).contains(httpResponse.statusCode) else {
                return .networkError
            }

            do {
                return .success(try decoder.decode(RejourneyRemoteConfig.self, from: data))
            } catch {
                return .networkError
            }
        } catch {
            return .networkError
        }
    }
}

struct RejourneyCaptureSettings: Equatable {
    let nativeDictionary: [String: Any]

    init(
        options: RejourneyOptions,
        recordingEnabled: Bool,
        textInputMasking: String = "all",
        imageVideoMasking: String = "none",
        recordingFps: Int? = nil
    ) {
        var settings: [String: Any] = [
            "captureScreen": recordingEnabled && options.captureScreen,
            "captureAnalytics": options.captureAnalytics,
            "captureCrashes": options.captureCrashes,
            "captureANR": options.captureANR,
            "wifiOnly": options.wifiOnly,
            "captureLogs": options.trackConsoleLogs,
            "collectDeviceInfo": options.collectDeviceInfo,
            "collectGeoLocation": options.collectGeoLocation,
            "captureNativeSheets": options.captureNativeSheets,
            "detectRageTaps": options.detectRageTaps,
            "rageTapThreshold": options.rageTapThreshold,
            "rageTapTimeWindow": options.rageTapTimeWindow,
            "rageTapRadius": options.rageTapRadius,
            "textInputMasking": textInputMasking == "secure_only" ? "secure_only" : "all",
            "imageVideoMasking": imageVideoMasking == "all" ? "all" : "none",
            "observeOnly": options.observeOnly || !recordingEnabled
        ]

        if let fps = recordingFps ?? options.normalizedCaptureFPS {
            settings["captureRate"] = 1.0 / Double(fps)
        }

        settings["imgCompression"] = options.captureQuality.jpegCompression
        nativeDictionary = settings
    }

    static func == (lhs: RejourneyCaptureSettings, rhs: RejourneyCaptureSettings) -> Bool {
        NSDictionary(dictionary: lhs.nativeDictionary).isEqual(to: rhs.nativeDictionary)
    }
}

// jsonString(from:) lives in the shared core; this overload stays here because
// RejourneyMetadataValue is part of this SDK's public surface, not the core's.
extension RejourneyEventSerializer {
    static func jsonObject(from metadata: [String: RejourneyMetadataValue]) -> [String: Any] {
        metadata.mapValues { $0.jsonObject }
    }
}

extension RejourneyMetadataValue {
    var jsonObject: Any {
        switch self {
        case .string(let value):
            return value
        case .int(let value):
            return value
        case .double(let value):
            return value
        case .bool(let value):
            return value
        case .array(let value):
            return value.map { $0.jsonObject }
        case .object(let value):
            return value.mapValues { $0.jsonObject }
        case .null:
            return NSNull()
        }
    }

    var attributeString: String {
        switch self {
        case .string(let value):
            return value
        case .int(let value):
            return String(value)
        case .double(let value):
            return value.isFinite ? String(value) : "null"
        case .bool(let value):
            return value ? "true" : "false"
        case .null:
            return "null"
        default:
            guard JSONSerialization.isValidJSONObject(jsonObject),
                  let data = try? JSONSerialization.data(withJSONObject: jsonObject),
                  let string = String(data: data, encoding: .utf8) else {
                return String(describing: jsonObject)
            }
            return string
        }
    }
}

extension RejourneyOptions {
    var normalizedCaptureFPS: Int? {
        guard let captureFPS else { return nil }
        return min(30, max(1, captureFPS))
    }
}

extension RejourneyCaptureQuality {
    var jpegCompression: Double {
        switch self {
        case .low:
            return 0.4
        case .medium:
            return 0.5
        case .high:
            return 0.7
        }
    }
}

extension URL {
    var rejourneyAbsoluteString: String {
        absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}
