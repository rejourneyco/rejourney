import Foundation
import UIKit
import XCTest
@testable import Rejourney

final class RejourneyTests: XCTestCase {
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
                collectGeoLocation: false,
                captureNativeSheets: false
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
        XCTAssertEqual(settings["collectGeoLocation"] as? Bool, false)
        XCTAssertEqual(settings["captureNativeSheets"] as? Bool, false)
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
        XCTAssertFalse(context.trackScreen("Search", sessionActive: false))
        context.setUserId("new_user")
        XCTAssertFalse(context.trackScreen("Details", sessionActive: false))
        XCTAssertFalse(context.trackScreen("Details", sessionActive: false))

        let replay = context.replayContextForReadySession()
        XCTAssertEqual(replay.userId, "new_user")
        XCTAssertEqual(replay.screenNames, ["Search", "Details"])

        let nextReplay = context.replayContextForReadySession()
        XCTAssertEqual(nextReplay.screenNames, ["Details"])
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
