import Foundation
import UIKit
import XCTest
@testable import Rejourney

private class MapDelegateMethodOwner: NSObject {
    @objc(mapView:regionDidChangeAnimated:)
    func mapView(_ mapView: AnyObject, regionDidChangeAnimated animated: Bool) {}

    @objc(mapView:regionWillChangeAnimated:)
    func mapView(_ mapView: AnyObject, regionWillChangeAnimated animated: Bool) {}
}

private final class InheritedMapDelegateMethods: MapDelegateMethodOwner {}

final class RejourneyTests: XCTestCase {
    func testOverlappingDrainsCompleteOnlyTheirOwnLifecycle() {
        let registry = DrainCompletionRegistry()
        var firstCompletions = 0
        var secondCompletions = 0
        let first = registry.begin { firstCompletions += 1 }
        let second = registry.begin { secondCompletions += 1 }

        registry.finish(first)?.forEach { $0() }
        XCTAssertEqual(firstCompletions, 1)
        XCTAssertEqual(secondCompletions, 0)
        XCTAssertNil(registry.finish(first))

        registry.finish(second)?.forEach { $0() }
        XCTAssertEqual(firstCompletions, 1)
        XCTAssertEqual(secondCompletions, 1)
    }

    func testDeadTapCandidateMustStillBeCurrentAndUnanswered() {
        XCTAssertTrue(TelemetryPipeline.shouldEmitDeadTap(
            candidateGeneration: 3,
            currentGeneration: 3,
            lastResponseTimestamp: 99,
            tapTimestamp: 100
        ))
        XCTAssertFalse(TelemetryPipeline.shouldEmitDeadTap(
            candidateGeneration: 3,
            currentGeneration: 4,
            lastResponseTimestamp: 0,
            tapTimestamp: 100
        ))
        XCTAssertFalse(TelemetryPipeline.shouldEmitDeadTap(
            candidateGeneration: 3,
            currentGeneration: 3,
            lastResponseTimestamp: 101,
            tapTimestamp: 100
        ))
    }

    func testRecoveryTimerOnlyRunsForAnActiveForegroundUnpausedSession() {
        XCTAssertTrue(ReplayOrchestrator.shouldRunRecoveryCheckpointTimer(
            live: true,
            userPaused: false,
            backgrounded: false
        ))
        XCTAssertFalse(ReplayOrchestrator.shouldRunRecoveryCheckpointTimer(
            live: false,
            userPaused: false,
            backgrounded: false
        ))
        XCTAssertFalse(ReplayOrchestrator.shouldRunRecoveryCheckpointTimer(
            live: true,
            userPaused: true,
            backgrounded: false
        ))
        XCTAssertFalse(ReplayOrchestrator.shouldRunRecoveryCheckpointTimer(
            live: true,
            userPaused: false,
            backgrounded: true
        ))
    }

    func testNetworkDurationUsesNonnegativeMonotonicDelta() {
        XCTAssertEqual(RejourneyURLProtocol.elapsedDurationMs(start: 100, end: 145), 45)
        XCTAssertEqual(RejourneyURLProtocol.elapsedDurationMs(start: 145, end: 100), 0)
    }

    func testMapRawTouchFallbackIsOnlyUsedWithoutPreciseMotionSignals() {
        XCTAssertFalse(SpecialCases.shouldUseRawTouchFallback(
            delegateIdleHooked: true,
            observedGestureCount: 0
        ))
        XCTAssertFalse(SpecialCases.shouldUseRawTouchFallback(
            delegateIdleHooked: false,
            observedGestureCount: 1
        ))
        XCTAssertTrue(SpecialCases.shouldUseRawTouchFallback(
            delegateIdleHooked: false,
            observedGestureCount: 0
        ))
    }

    func testMapRawTouchFallbackIgnoresOverlayControlsAboveMap() {
        let container = UIView()
        let map = UIView()
        let mapChild = UIView()
        let overlayButton = UIButton(type: .system)
        container.addSubview(map)
        map.addSubview(mapChild)
        container.addSubview(overlayButton)

        XCTAssertTrue(SpecialCases.isTouchView(map, within: map))
        XCTAssertTrue(SpecialCases.isTouchView(mapChild, within: map))
        XCTAssertFalse(SpecialCases.isTouchView(overlayButton, within: map))
        XCTAssertFalse(SpecialCases.isTouchView(nil, within: map))
    }

    func testMapCaptureIsSuppressedOnlyWhileTheCameraMoves() {
        // No map on screen: the heuristic never applies.
        XCTAssertTrue(SpecialCases.shouldCaptureMapBackedContent(
            mapVisible: false,
            mapIdle: false,
            eventDriven: false
        ))
        // A settled map still records at the normal cadence. A map screen is
        // mostly not map -- sheets, results, callouts, overlays -- so gating
        // the whole screen on a map being mounted loses all of that.
        XCTAssertTrue(SpecialCases.shouldCaptureMapBackedContent(
            mapVisible: true,
            mapIdle: true,
            eventDriven: false
        ))
        // An explicit request is never dropped, even mid-gesture: session
        // start, a high-importance visual change, a screen change, resume.
        XCTAssertTrue(SpecialCases.shouldCaptureMapBackedContent(
            mapVisible: true,
            mapIdle: false,
            eventDriven: true
        ))
        XCTAssertTrue(SpecialCases.shouldCaptureMapBackedContent(
            mapVisible: true,
            mapIdle: true,
            eventDriven: true
        ))
        // The one real skip: a periodic tick while the camera is moving.
        XCTAssertFalse(SpecialCases.shouldCaptureMapBackedContent(
            mapVisible: true,
            mapIdle: false,
            eventDriven: false
        ))
    }

    func testMapDelegateHookDoesNotTreatInheritedMethodAsClassOwned() {
        let didChange = NSSelectorFromString("mapView:regionDidChangeAnimated:")
        let willChange = NSSelectorFromString("mapView:regionWillChangeAnimated:")

        XCTAssertTrue(SpecialCases.classDirectlyImplementsInstanceMethod(
            MapDelegateMethodOwner.self,
            selector: didChange
        ))
        XCTAssertTrue(SpecialCases.classDirectlyImplementsInstanceMethod(
            MapDelegateMethodOwner.self,
            selector: willChange
        ))
        XCTAssertFalse(SpecialCases.classDirectlyImplementsInstanceMethod(
            InheritedMapDelegateMethods.self,
            selector: didChange
        ))
        XCTAssertFalse(SpecialCases.classDirectlyImplementsInstanceMethod(
            InheritedMapDelegateMethods.self,
            selector: willChange
        ))
    }

    func testAnrWatchdogReportsOnlyOnceUntilMainThreadResponds() {
        XCTAssertFalse(AnrSentinel.shouldReportFreeze(
            awaitingPong: false,
            elapsed: 10,
            threshold: 5,
            alreadyReported: false
        ))
        XCTAssertFalse(AnrSentinel.shouldReportFreeze(
            awaitingPong: true,
            elapsed: 4.99,
            threshold: 5,
            alreadyReported: false
        ))
        XCTAssertTrue(AnrSentinel.shouldReportFreeze(
            awaitingPong: true,
            elapsed: 5,
            threshold: 5,
            alreadyReported: false
        ))
        XCTAssertFalse(AnrSentinel.shouldReportFreeze(
            awaitingPong: true,
            elapsed: 30,
            threshold: 5,
            alreadyReported: true
        ))
    }

    func testMetricKitCrashSuppressionIsBoundedToPreActivationReports() {
        let activation = Date(timeIntervalSince1970: 10_000)

        XCTAssertTrue(RejourneyMetricKitDiagnostics.shouldSuppressCrashPayload(
            endingAt: activation.addingTimeInterval(-1),
            activationCutoff: activation
        ))
        XCTAssertTrue(RejourneyMetricKitDiagnostics.shouldSuppressCrashPayload(
            endingAt: activation,
            activationCutoff: activation
        ))
        XCTAssertFalse(RejourneyMetricKitDiagnostics.shouldSuppressCrashPayload(
            endingAt: activation.addingTimeInterval(1),
            activationCutoff: activation
        ))
        XCTAssertFalse(RejourneyMetricKitDiagnostics.shouldSuppressCrashPayload(
            endingAt: activation.addingTimeInterval(-1),
            activationCutoff: nil
        ))
    }

    @available(iOS 14.0, *)
    func testMetricKitHangFramesUseAttributedMainThreadTree() {
        let payload: [String: Any] = [
            "callStackTree": [
                "callStackPerThread": true,
                "callStacks": [
                    [
                        "threadAttributed": false,
                        "callStackRootFrames": [
                            [
                                "binaryName": "Rejourney",
                                "address": 4_096,
                                "offsetIntoBinaryTextSegment": 16
                            ]
                        ]
                    ],
                    [
                        "threadAttributed": true,
                        "callStackRootFrames": [
                            [
                                "binaryName": "LightWars",
                                "binaryUUID": "70B89F27-1634-3580-A695-57CDB41D7743",
                                "address": 8_192,
                                "offsetIntoBinaryTextSegment": 128,
                                "subFrames": [
                                    [
                                        "binaryName": "Flutter",
                                        "address": 12_288,
                                        "offsetIntoBinaryTextSegment": 256
                                    ]
                                ]
                            ]
                        ]
                    ]
                ]
            ]
        ]

        let frames = RejourneyMetricKitDiagnostics.frames(fromJSONObject: payload)

        XCTAssertEqual(frames.count, 2)
        XCTAssertTrue(frames[0].contains("LightWars 0x2000 + 128"))
        XCTAssertTrue(frames[1].contains("Flutter 0x3000 + 256"))
        XCTAssertFalse(frames.joined(separator: "\n").contains("Rejourney 0x1000"))
    }

    @available(iOS 14.0, *)
    func testMetricKitHangCorrelationUsesOriginalSessionAndClosestDuration() {
        let pending = [
            RejourneyMetricKitDiagnostics.PendingLiveHang(
                incidentId: "outside-window",
                sessionId: "session-old",
                timestampMs: 900,
                durationMs: 6_550
            ),
            RejourneyMetricKitDiagnostics.PendingLiveHang(
                incidentId: "closest-duration",
                sessionId: "session-correct",
                timestampMs: 1_800,
                durationMs: 6_575
            ),
            RejourneyMetricKitDiagnostics.PendingLiveHang(
                incidentId: "farther-duration",
                sessionId: "session-other",
                timestampMs: 1_900,
                durationMs: 8_000
            ),
        ]

        let match = RejourneyMetricKitDiagnostics.bestPendingHang(
            pending,
            durationMs: 6_600,
            payloadStartMs: 1_000,
            payloadEndMs: 2_000
        )

        XCTAssertEqual(match?.incidentId, "closest-duration")
        XCTAssertEqual(match?.sessionId, "session-correct")
        XCTAssertEqual(match?.timestampMs, 1_800)
    }

    func testUncaughtExceptionStackIsNotReplacedByFollowingAbortSignal() {
        let exception = IncidentRecord(
            incidentId: "exception-id",
            sessionId: "session-crash",
            timestampMs: 1_000,
            category: "exception",
            identifier: "CheckoutFailure",
            detail: "Invalid total",
            frames: ["CheckoutView.submit()", "Cart.total()"],
            context: [:]
        )
        let abortSignal = IncidentRecord(
            incidentId: "signal-id",
            sessionId: "session-crash",
            timestampMs: 1_001,
            category: "signal",
            identifier: "SIGABRT",
            detail: "Signal 6 received",
            frames: ["_rjSignalHandler"],
            context: [:]
        )

        XCTAssertFalse(
            StabilityMonitor.shouldReplaceStoredIncident(exception, with: abortSignal)
        )
        XCTAssertTrue(
            StabilityMonitor.shouldReplaceStoredIncident(abortSignal, with: exception)
        )
    }

    func testStoredIncidentQueuePreservesLegacyFilesAndMultipleDiagnostics() throws {
        let legacy = IncidentRecord(
            incidentId: "legacy-id",
            sessionId: "legacy-session",
            timestampMs: 1_000,
            category: "exception",
            identifier: "LegacyCrash",
            detail: "legacy",
            frames: ["Legacy.crash()"],
            context: [:]
        )
        let diagnostic = IncidentRecord(
            incidentId: "diagnostic-id",
            sessionId: "diagnostic-session",
            timestampMs: 2_000,
            category: "anr",
            identifier: "MetricKitHang",
            detail: "hang",
            frames: ["Checkout.render()"],
            context: [:]
        )

        let decodedLegacy = StabilityMonitor.decodeStoredIncidents(
            try JSONEncoder().encode(legacy)
        )
        XCTAssertEqual(decodedLegacy.map(\.incidentId), ["legacy-id"])

        let queued = StabilityMonitor.mergeStoredIncidents(
            decodedLegacy,
            with: diagnostic
        )
        XCTAssertEqual(queued.map(\.incidentId), ["legacy-id", "diagnostic-id"])

        let decodedQueue = StabilityMonitor.decodeStoredIncidents(
            try JSONEncoder().encode(queued)
        )
        XCTAssertEqual(decodedQueue.map(\.incidentId), ["legacy-id", "diagnostic-id"])
    }

    func testStoredIncidentQueueReplacesAbortSignalWithUsefulException() {
        let signal = IncidentRecord(
            incidentId: "signal-id",
            sessionId: "session-crash",
            timestampMs: 1_000,
            category: "signal",
            identifier: "SIGABRT",
            detail: "Signal 6 received",
            frames: ["_rjSignalHandler"],
            context: [:]
        )
        let exception = IncidentRecord(
            incidentId: "exception-id",
            sessionId: "session-crash",
            timestampMs: 999,
            category: "exception",
            identifier: "CheckoutFailure",
            detail: "Invalid total",
            frames: ["CheckoutView.submit()"],
            context: [:]
        )

        let queued = StabilityMonitor.mergeStoredIncidents([signal], with: exception)
        XCTAssertEqual(queued.map(\.incidentId), ["exception-id"])
        XCTAssertEqual(
            StabilityMonitor.mergeStoredIncidents(queued, with: signal).map(\.incidentId),
            ["exception-id"]
        )
    }

    func testStoredIncidentRouteMatchingSkipsOtherProjectsButAllowsLegacyRecords() {
        let current = IncidentRecord(
            sessionId: "current",
            timestampMs: 1,
            category: "crash",
            identifier: "Current",
            detail: "",
            frames: [],
            context: [:],
            routeEndpoint: "https://api.rejourney.co",
            routeProjectId: "project-current",
            captureCurrentRoute: false
        )
        let other = IncidentRecord(
            sessionId: "other",
            timestampMs: 2,
            category: "crash",
            identifier: "Other",
            detail: "",
            frames: [],
            context: [:],
            routeEndpoint: "https://api.rejourney.co",
            routeProjectId: "project-other",
            captureCurrentRoute: false
        )
        let legacy = IncidentRecord(
            sessionId: "legacy",
            timestampMs: 3,
            category: "crash",
            identifier: "Legacy",
            detail: "",
            frames: [],
            context: [:],
            captureCurrentRoute: false
        )

        XCTAssertTrue(StabilityMonitor.routeMatches(
            incident: current,
            endpoint: "https://api.rejourney.co",
            projectId: "project-current"
        ))
        XCTAssertFalse(StabilityMonitor.routeMatches(
            incident: other,
            endpoint: "https://api.rejourney.co",
            projectId: "project-current"
        ))
        XCTAssertTrue(StabilityMonitor.routeMatches(
            incident: legacy,
            endpoint: "https://api.rejourney.co",
            projectId: "project-current"
        ))
    }

    func testHistoricalCrashSessionRequiresCaptureAndNormalizesIdentifier() {
        XCTAssertEqual(
            StabilityMonitor.historicalSessionId(
                previousSessionId: "  session-prior  ",
                wasCapturing: true
            ),
            "session-prior"
        )
        XCTAssertNil(StabilityMonitor.historicalSessionId(
            previousSessionId: "session-paused",
            wasCapturing: false
        ))
        XCTAssertNil(StabilityMonitor.historicalSessionId(
            previousSessionId: "   ",
            wasCapturing: true
        ))
    }

    func testNetworkEventFilterIgnoresRejourneyInternalUrls() throws {
        RejourneyNetworkEventFilter.configure(apiURLString: "https://api.rejourney.co")

        XCTAssertTrue(RejourneyNetworkEventFilter.shouldIgnore(url: try XCTUnwrap(URL(string: "https://api.rejourney.co/api/sdk/config"))))
        XCTAssertTrue(RejourneyNetworkEventFilter.shouldIgnore(url: try XCTUnwrap(URL(string: "https://api.rejourney.co/api/ingest/presign"))))
        XCTAssertTrue(RejourneyNetworkEventFilter.shouldIgnore(url: try XCTUnwrap(URL(string: "https://ingest.example.com/upload/artifacts/artifact_123?token=secret"))))
        XCTAssertTrue(RejourneyNetworkEventFilter.shouldIgnore(details: ["urlPath": "/api/ingest/session/end"]))
    }

    func testNetworkEventFilterSupportsSelfHostedApiBasePath() throws {
        RejourneyNetworkEventFilter.configure(apiURLString: "https://example.com/rejourney/")
        defer { RejourneyNetworkEventFilter.configure(apiURLString: "https://api.rejourney.co") }

        XCTAssertTrue(RejourneyNetworkEventFilter.shouldIgnore(url: try XCTUnwrap(URL(string: "https://example.com/rejourney/api/sdk/config"))))
        XCTAssertTrue(RejourneyNetworkEventFilter.shouldIgnore(url: try XCTUnwrap(URL(string: "https://example.com/rejourney/api/ingest/presign"))))
        XCTAssertTrue(RejourneyNetworkEventFilter.shouldIgnore(url: try XCTUnwrap(URL(string: "https://example.com/rejourney/upload/artifacts/artifact_123"))))
        XCTAssertTrue(RejourneyNetworkEventFilter.shouldIgnore(url: try XCTUnwrap(URL(string: "https://upload.example.com/upload/artifacts/artifact_123"))))
        XCTAssertFalse(RejourneyNetworkEventFilter.shouldIgnore(url: try XCTUnwrap(URL(string: "https://example.com/rejourney/api/orders"))))
        XCTAssertFalse(RejourneyNetworkEventFilter.shouldIgnore(url: try XCTUnwrap(URL(string: "https://example.com/rejourneyish/api/ingest/presign"))))
        XCTAssertFalse(RejourneyNetworkEventFilter.shouldIgnore(url: try XCTUnwrap(URL(string: "https://app.example.com/api/orders"))))
        XCTAssertFalse(RejourneyNetworkEventFilter.shouldIgnore(url: try XCTUnwrap(URL(string: "https://app.example.com/api/ingestor"))))
    }

    func testNetworkEventFilterIgnoresRegisteredPresignedUploadUrls() throws {
        RejourneyNetworkEventFilter.configure(apiURLString: "https://api.rejourney.co")
        defer { RejourneyNetworkEventFilter.configure(apiURLString: "https://api.rejourney.co") }

        let uploadUrl = "https://s3.example.com/rejourney-bucket/session/events.gz?X-Amz-Signature=abc"
        XCTAssertFalse(RejourneyNetworkEventFilter.shouldIgnore(url: try XCTUnwrap(URL(string: uploadUrl))))
        RejourneyNetworkEventFilter.registerInternalURL(urlString: uploadUrl)
        XCTAssertTrue(RejourneyNetworkEventFilter.shouldIgnore(url: try XCTUnwrap(URL(string: uploadUrl))))
    }

    func testRemoteConfigFetchSendsNativeHeadersAndParsesConfig() async {
        let body = """
        {
          "projectId": "proj_123",
          "rejourneyEnabled": true,
          "recordingEnabled": false,
          "textInputMasking": "secure_only",
          "imageVideoMasking": "all",
          "recordingFps": 3,
          "sampleRate": 25,
          "maxRecordingMinutes": 7
        }
        """.data(using: .utf8)!

        let session = MockURLSession(
            data: body,
            statusCode: 200,
            url: URL(string: "https://api.rejourney.co/api/sdk/config")!
        )
        let client = RejourneyRemoteConfigClient(session: session)

        let result = await client.fetch(
            apiURL: URL(string: "https://api.rejourney.co")!,
            publicKey: "pk_test"
        )

        XCTAssertEqual(session.lastRequest?.value(forHTTPHeaderField: "x-public-key"), "pk_test")
        XCTAssertEqual(session.lastRequest?.value(forHTTPHeaderField: "x-platform"), "ios")

        guard case .success(let config) = result else {
            XCTFail("Expected successful config fetch")
            return
        }

        XCTAssertEqual(config.projectId, "proj_123")
        XCTAssertFalse(config.recordingEnabled)
        XCTAssertEqual(config.textInputMasking, "secure_only")
        XCTAssertEqual(config.imageVideoMasking, "all")
        XCTAssertEqual(config.recordingFps, 3)
        XCTAssertEqual(config.sampleRate, 25)
        XCTAssertEqual(config.maxRecordingMinutes, 7)
    }

    func testRemoteConfigAccessDeniedFailsClosed() async {
        let session = MockURLSession(
            data: Data(),
            statusCode: 403,
            url: URL(string: "https://api.rejourney.co/api/sdk/config")!
        )
        let client = RejourneyRemoteConfigClient(session: session)

        let result = await client.fetch(
            apiURL: URL(string: "https://api.rejourney.co")!,
            publicKey: "bad_key"
        )

        XCTAssertEqual(result, .accessDenied(403))
    }

    func testSamplingAndBlockedStateDerivation() {
        XCTAssertEqual(
            RejourneySessionPolicy.derive(remoteConfig: nil),
            RejourneyRemoteStartState(
                effectiveRemoteConfig: .defaultConfig,
                sessionSampledOut: false,
                blockedReason: nil
            )
        )

        let sampledConfig = RejourneyRemoteConfig(
            projectId: "proj_123",
            rejourneyEnabled: true,
            recordingEnabled: true,
            sampleRate: 25,
            maxRecordingMinutes: 10,
            billingBlocked: false,
            billingReason: nil
        )

        XCTAssertFalse(
            RejourneySessionPolicy.derive(
                remoteConfig: sampledConfig,
                randomValue: 24.9
            ).sessionSampledOut
        )
        XCTAssertTrue(
            RejourneySessionPolicy.derive(
                remoteConfig: sampledConfig,
                randomValue: 25.0
            ).sessionSampledOut
        )

        let disabledConfig = RejourneyRemoteConfig(
            projectId: "proj_123",
            rejourneyEnabled: false,
            recordingEnabled: true,
            sampleRate: 100,
            maxRecordingMinutes: 10,
            billingBlocked: false,
            billingReason: nil
        )

        XCTAssertEqual(
            RejourneySessionPolicy.derive(remoteConfig: disabledConfig).blockedReason,
            .disabled
        )
    }

    @MainActor
    func testSampledOutStartReturnsBeforeNativeSession() async {
        let body = """
        {
          "projectId": "proj_123",
          "rejourneyEnabled": true,
          "recordingEnabled": true,
          "sampleRate": 0,
          "maxRecordingMinutes": 10
        }
        """.data(using: .utf8)!

        let session = MockURLSession(
            data: body,
            statusCode: 200,
            url: URL(string: "https://api.rejourney.co/api/sdk/config")!
        )
        let controller = RejourneyNativeController(
            remoteConfigClient: RejourneyRemoteConfigClient(session: session)
        )
        controller.configure(
            publicKey: "pk_test",
            options: RejourneyOptions(autoTrackNetwork: false)
        )

        let result = await controller.start()

        XCTAssertFalse(result.success)
        XCTAssertNil(result.sessionId)
        XCTAssertEqual(result.error, "sampled_out")
        XCTAssertFalse(result.telemetryOnly)
    }

    func testCaptureSettingsNormalizeOptions() {
        let settings = RejourneyCaptureSettings(
            options: RejourneyOptions(
                captureFPS: 100,
                captureQuality: .high,
                wifiOnly: true,
                trackConsoleLogs: false,
                collectDeviceInfo: false,
                collectGeoLocation: false,
                captureNativeSheets: false,
                detectRageTaps: false,
                rageTapThreshold: 5,
                rageTapTimeWindow: 750,
                rageTapRadius: 72.5
            ),
            recordingEnabled: true,
            textInputMasking: "secure_only",
            imageVideoMasking: "all",
            recordingFps: 3
        ).nativeDictionary

        XCTAssertEqual(settings["captureRate"] as? Double ?? -1, 1.0 / 3.0, accuracy: 0.0001)
        XCTAssertEqual(settings["imgCompression"] as? Double, 0.7)
        XCTAssertEqual(settings["wifiOnly"] as? Bool, true)
        XCTAssertEqual(settings["captureLogs"] as? Bool, false)
        XCTAssertEqual(settings["collectDeviceInfo"] as? Bool, false)
        XCTAssertEqual(settings["collectGeoLocation"] as? Bool, false)
        XCTAssertEqual(settings["captureNativeSheets"] as? Bool, false)
        XCTAssertEqual(settings["detectRageTaps"] as? Bool, false)
        XCTAssertEqual(settings["rageTapThreshold"] as? Int, 5)
        XCTAssertEqual(settings["rageTapTimeWindow"] as? Int, 750)
        XCTAssertEqual(settings["rageTapRadius"] as? Double, 72.5)
        XCTAssertEqual(settings["textInputMasking"] as? String, "secure_only")
        XCTAssertEqual(settings["imageVideoMasking"] as? String, "all")
        XCTAssertEqual(settings["observeOnly"] as? Bool, false)

        let telemetryOnlySettings = RejourneyCaptureSettings(
            options: RejourneyOptions(observeOnly: true),
            recordingEnabled: false
        ).nativeDictionary

        XCTAssertEqual(telemetryOnlySettings["captureScreen"] as? Bool, false)
        XCTAssertEqual(telemetryOnlySettings["observeOnly"] as? Bool, true)
    }

    func testMetadataAndEventSerialization() {
        let object = RejourneyEventSerializer.jsonObject(from: [
            "screen": "Checkout",
            "attempt": 2,
            "value": 19.95,
            "success": true,
            "nested": .object(["plan": "pro"]),
            "tags": .array(["ios", "native"])
        ])

        XCTAssertEqual(object["screen"] as? String, "Checkout")
        XCTAssertEqual(object["attempt"] as? Int, 2)
        XCTAssertEqual(object["success"] as? Bool, true)

        let json = RejourneyEventSerializer.jsonString(from: object)
        XCTAssertTrue(json.contains("\"Checkout\""))
        XCTAssertTrue(json.contains("\"nested\""))
    }

    func testMetadataAttributeStringSupportsScalarValues() {
        XCTAssertEqual(RejourneyMetadataValue.int(2).attributeString, "2")
        XCTAssertEqual(RejourneyMetadataValue.double(19.95).attributeString, "19.95")
        XCTAssertEqual(RejourneyMetadataValue.bool(true).attributeString, "true")
        XCTAssertEqual(RejourneyMetadataValue.null.attributeString, "null")
    }

    func testMetadataAttributeStringSupportsCompositeValues() throws {
        let array = RejourneyMetadataValue.array(["ios", 3, true]).attributeString
        let arrayData = try XCTUnwrap(array.data(using: .utf8))
        let arrayObject = try XCTUnwrap(try JSONSerialization.jsonObject(with: arrayData) as? [Any])
        XCTAssertEqual(arrayObject[0] as? String, "ios")
        XCTAssertEqual(arrayObject[1] as? Int, 3)
        XCTAssertEqual(arrayObject[2] as? Bool, true)

        let object = RejourneyMetadataValue.object([
            "plan": "pro",
            "enabled": true
        ]).attributeString
        let objectData = try XCTUnwrap(object.data(using: .utf8))
        let objectValue = try XCTUnwrap(try JSONSerialization.jsonObject(with: objectData) as? [String: Any])
        XCTAssertEqual(objectValue["plan"] as? String, "pro")
        XCTAssertEqual(objectValue["enabled"] as? Bool, true)
    }

    func testSessionContextReplaysLatestScreenAndIdentityForNewSession() {
        var context = RejourneySessionContext()

        context.setUserId("user_1")
        XCTAssertTrue(context.trackScreen("Home", sessionActive: true))

        let replay = context.replayContextForReadySession()
        XCTAssertEqual(replay.userId, "user_1")
        XCTAssertEqual(replay.screenNames, ["Home"])
    }

    func testSessionContextQueuesScreensAndUsesLatestIdentityDuringRestart() {
        var context = RejourneySessionContext()

        context.setUserId("old_user")
        context.setMetadata("plan", .string("pro"))
        context.setMetadata("attempt", .int(1))
        XCTAssertFalse(context.trackScreen("Search", sessionActive: false))
        context.setUserId("new_user")
        context.setMetadata("attempt", .int(2))
        XCTAssertFalse(context.trackScreen("Details", sessionActive: false))
        XCTAssertFalse(context.trackScreen("Details", sessionActive: false))

        let replay = context.replayContextForReadySession()
        XCTAssertEqual(replay.userId, "new_user")
        XCTAssertEqual(replay.screenNames, ["Search", "Details"])
        XCTAssertEqual(replay.metadata["plan"], .string("pro"))
        XCTAssertEqual(replay.metadata["attempt"], .int(2))

        let nextReplay = context.replayContextForReadySession()
        XCTAssertEqual(nextReplay.screenNames, ["Details"])
        XCTAssertEqual(nextReplay.metadata, replay.metadata)
    }

    @MainActor
    func testRedactionMaskMasksVisibleTextFields() {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 240, height: 240))
        let field = UITextField(frame: CGRect(x: 20, y: 30, width: 140, height: 36))
        field.text = "private"
        window.addSubview(field)
        window.makeKeyAndVisible()
        defer { window.isHidden = true }

        let rects = RedactionMask().computeRects(windows: [window])

        XCTAssertTrue(rects.contains { $0.intersects(field.frame) })
    }

    @MainActor
    func testRedactionMaskIgnoresHiddenTextInputAncestorsLikeReactNative() {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 240, height: 240))
        let fullScreenContainer = UIView(frame: window.bounds)
        let hiddenField = UITextField(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        hiddenField.isHidden = true

        fullScreenContainer.addSubview(hiddenField)
        window.addSubview(fullScreenContainer)
        window.makeKeyAndVisible()
        defer { window.isHidden = true }

        let rects = RedactionMask().computeRects(windows: [window])

        XCTAssertTrue(rects.isEmpty)
    }

    @MainActor
    func testRedactionMaskTracksAutoMaskedViewMovementBeforeCacheExpiry() {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 240, height: 240))
        let field = UITextField(frame: CGRect(x: 20, y: 30, width: 140, height: 36))

        window.addSubview(field)
        window.makeKeyAndVisible()
        defer { window.isHidden = true }

        let mask = RedactionMask()
        let initialRect = mask.computeRects(windows: [window]).first
        field.frame.origin.y = 96
        window.layoutIfNeeded()
        let movedRect = mask.computeRects(windows: [window]).first

        XCTAssertEqual(initialRect?.origin.y, 30)
        XCTAssertEqual(movedRect?.origin.y, 96)
    }

    @MainActor
    func testLifecycleStartRequiresConfigurationAndStopIsIdempotent() async {
        Rejourney.configure(publicKey: "", options: RejourneyOptions())

        let start = await Rejourney.start()
        XCTAssertFalse(start.success)
        XCTAssertEqual(start.error, "publicKey is required")

        let stop = await Rejourney.stop()
        XCTAssertTrue(stop.success)
        XCTAssertNil(stop.sessionId)
        XCTAssertTrue(stop.uploadSuccess)
    }

    func testOpenCircuitDefersDurableUploadsWithoutBurningRetryAttempts() {
        let dispatcher = SegmentDispatcher.shared
        dispatcher.resetRetryStateForTesting()
        defer { dispatcher.resetRetryStateForTesting() }

        dispatcher.endpoint = "http://127.0.0.1:1"
        dispatcher.configure(
            replayId: "session_circuit_breaker_test",
            apiToken: "rj_test",
            credential: nil,
            projectId: nil
        )

        let failuresQueued = expectation(description: "failed uploads enter durable retry queue")
        failuresQueued.expectedFulfillmentCount = 6
        for index in 0..<6 {
            dispatcher.transmitHierarchy(
                replayId: "session_circuit_breaker_test",
                hierarchyPayload: Data("hierarchy-\(index)".utf8),
                timestampMs: UInt64(index)
            ) { _ in
                failuresQueued.fulfill()
            }
        }
        wait(for: [failuresQueued], timeout: 5)

        let beforeDrain = dispatcher.sdkTelemetrySnapshot()
        XCTAssertGreaterThanOrEqual(beforeDrain["uploadFailureCount"] as? Int ?? 0, 5)
        XCTAssertGreaterThanOrEqual(beforeDrain["retryAttemptCount"] as? Int ?? 0, 5)

        dispatcher.waitForPendingUploads(timeout: 2)

        let afterDrain = dispatcher.sdkTelemetrySnapshot()
        XCTAssertEqual(
            afterDrain["retryAttemptCount"] as? Int,
            beforeDrain["retryAttemptCount"] as? Int,
            "a circuit-open drain must not consume retries without a network attempt"
        )
        XCTAssertEqual(afterDrain["memoryEvictionCount"] as? Int, 0)
    }

    func testBatterySnapshotUsesNormalizedAdditiveFields() {
        let snapshot = TelemetryPipeline.shared.currentBatteryInfo()

        XCTAssertNotNil(snapshot["batteryState"] as? String)
        XCTAssertNotNil(snapshot["lowPowerModeEnabled"] as? Bool)
        if let percent = snapshot["batteryLevelPercent"] as? Int {
            XCTAssertTrue((0...100).contains(percent))
        }
    }

    func testEventRingKeepsSessionBatchesSeparateAndRetryOrderStable() {
        func entry(_ label: String, session: String) -> EventEntry {
            let data = Data(label.utf8)
            return EventEntry(data: data, size: data.count, sessionId: session)
        }

        let ring = EventRingBuffer(capacity: 4)
        ring.push(entry("a1", session: "session-a"))
        ring.push(entry("a2", session: "session-a"))
        ring.push(entry("b1", session: "session-b"))

        let firstAttempt = ring.drain(maxBytes: 100)
        XCTAssertEqual(firstAttempt.map(\.sessionId), ["session-a", "session-a"])
        XCTAssertEqual(firstAttempt.map { String(decoding: $0.data, as: UTF8.self) }, ["a1", "a2"])

        ring.prepend(firstAttempt)
        XCTAssertEqual(
            ring.drain(maxBytes: 100).map { String(decoding: $0.data, as: UTF8.self) },
            ["a1", "a2"]
        )
        XCTAssertEqual(
            ring.drain(maxBytes: 100).map { String(decoding: $0.data, as: UTF8.self) },
            ["b1"]
        )
    }

    func testEventRetryAtCapacityEvictsNewestInsteadOfFailedOldestBatch() {
        func entry(_ label: String) -> EventEntry {
            let data = Data(label.utf8)
            return EventEntry(data: data, size: data.count, sessionId: "session")
        }

        let ring = EventRingBuffer(capacity: 3)
        ["a", "b", "c"].forEach { ring.push(entry($0)) }
        let failed = ring.drain(maxBytes: 2)
        ring.push(entry("d"))
        ring.push(entry("e"))
        ring.prepend(failed)

        XCTAssertEqual(
            ring.drain(maxBytes: 100).map { String(decoding: $0.data, as: UTF8.self) },
            ["a", "b", "c"]
        )
    }

    func testFrameRetryAtCapacityPreservesFailedAndOlderBundles() {
        func bundle(_ tag: String) -> PendingFrameBundle {
            PendingFrameBundle(
                tag: tag,
                payload: Data(tag.utf8),
                rangeStart: 0,
                rangeEnd: 1,
                count: 1,
                sessionId: "session"
            )
        }

        let queue = FrameBundleQueue(maxPending: 2)
        queue.enqueue(bundle("old"))
        queue.enqueue(bundle("middle"))
        let failed = queue.dequeue()
        queue.enqueue(bundle("newest"))
        queue.requeue(try! XCTUnwrap(failed))

        XCTAssertEqual(queue.dequeue()?.tag, "old")
        XCTAssertEqual(queue.dequeue()?.tag, "middle")
        XCTAssertNil(queue.dequeue())
    }

    func testSessionUploadBindingSurvivesLaterProjectConfiguration() {
        let dispatcher = SegmentDispatcher.shared
        dispatcher.endpoint = "https://old.example"
        dispatcher.collectGeoLocation = false
        dispatcher.observeOnly = true
        dispatcher.configure(
            replayId: "session-old-route",
            apiToken: "old-key",
            credential: nil,
            projectId: "project-old",
            isSampledIn: false
        )

        dispatcher.endpoint = "https://new.example"
        dispatcher.collectGeoLocation = true
        dispatcher.observeOnly = false
        dispatcher.configure(
            replayId: "session-new-route",
            apiToken: "new-key",
            credential: nil,
            projectId: "project-new",
            isSampledIn: true
        )
        defer {
            dispatcher.endpoint = "https://api.rejourney.co"
            dispatcher.collectGeoLocation = true
            dispatcher.observeOnly = false
        }

        XCTAssertEqual(
            dispatcher.uploadBinding(for: "session-old-route"),
            SessionUploadBinding(
                endpoint: "https://old.example",
                projectId: "project-old",
                isSampledIn: false,
                collectGeoLocation: false,
                observeOnly: true
            )
        )
        XCTAssertEqual(
            dispatcher.uploadBinding(for: "session-new-route").projectId,
            "project-new"
        )
        XCTAssertFalse(dispatcher.matchesCurrentUploadRoute(
            endpoint: "https://old.example",
            projectId: "project-old"
        ))
    }

    func testPauseStatePayloadIsSmallAndSessionOwned() {
        let payload = SegmentDispatcher.pauseStatePayload(
            replayId: "session-1",
            pauseId: "pause-1",
            paused: true,
            occurredAt: 1_777_000_001_000,
            isSampledIn: false
        )

        XCTAssertEqual(payload["sessionId"] as? String, "session-1")
        XCTAssertEqual(payload["pauseId"] as? String, "pause-1")
        XCTAssertEqual(payload["paused"] as? Bool, true)
        XCTAssertEqual(payload["occurredAt"] as? UInt64, 1_777_000_001_000)
        XCTAssertEqual(payload["isSampledIn"] as? Bool, false)
        XCTAssertEqual(payload["sdkVersion"] as? String, RejourneySDKInfo.version)
        XCTAssertEqual(payload.count, 6)
    }
}

private final class MockURLSession: RejourneyURLSession {
    let data: Data
    let statusCode: Int
    let url: URL
    var lastRequest: URLRequest?

    init(data: Data, statusCode: Int, url: URL) {
        self.data = data
        self.statusCode = statusCode
        self.url = url
    }

    func rejourneyData(for request: URLRequest) async throws -> (Data, URLResponse) {
        lastRequest = request
        return (
            data,
            HTTPURLResponse(
                url: url,
                statusCode: statusCode,
                httpVersion: "HTTP/1.1",
                headerFields: nil
            )!
        )
    }
}
