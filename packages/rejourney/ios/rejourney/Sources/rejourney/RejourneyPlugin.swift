import Flutter
import UIKit

public final class RejourneyPlugin: NSObject, FlutterPlugin {
    private static let channelName = "co.rejourney.flutter/methods"

    public static func register(with registrar: FlutterPluginRegistrar) {
        let channel = FlutterMethodChannel(name: channelName, binaryMessenger: registrar.messenger())
        let instance = RejourneyPlugin(channel: channel)
        registrar.addMethodCallDelegate(instance, channel: channel)
    }

    private let channel: FlutterMethodChannel
    private var configuredOptions = RejourneyOptions()

    private init(channel: FlutterMethodChannel) {
        self.channel = channel
        super.init()
        Task { @MainActor [weak self] in
            RejourneyNativeController.shared.eventHandler = { [weak self] event in
                self?.channel.invokeMethod("nativeEvent", arguments: event)
            }
        }
    }

    public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        let arguments = call.arguments as? [String: Any] ?? [:]

        switch call.method {
        case "configure":
            configure(arguments, result: result)
        case "start":
            Task { @MainActor in
                let start = await Rejourney.start()
                result([
                    "success": start.success,
                    "sessionId": start.sessionId as Any,
                    "error": start.error as Any,
                    "telemetryOnly": start.telemetryOnly
                ])
            }
        case "stop":
            Task { @MainActor in
                let stop = await Rejourney.stop()
                result([
                    "success": stop.success,
                    "sessionId": stop.sessionId as Any,
                    "uploadSuccess": stop.uploadSuccess
                ])
            }
        case "getSessionId":
            Task { @MainActor in result(Rejourney.currentSessionId) }
        case "setUserIdentity":
            Task { @MainActor in
                Rejourney.identify(arguments.string("userId"))
                result(nil)
            }
        case "clearUserIdentity":
            Task { @MainActor in
                Rejourney.clearIdentity()
                result(nil)
            }
        case "logEvent":
            Task { @MainActor in
                Rejourney.logEvent(
                    arguments.string("name"),
                    properties: Self.metadata(arguments["properties"])
                )
                result(nil)
            }
        case "setMetadata":
            Task { @MainActor in
                Rejourney.setMetadata(Self.metadata(arguments["metadata"]))
                result(nil)
            }
        case "trackScreen":
            Task { @MainActor in
                Rejourney.trackScreen(arguments.string("screenName"))
                result(nil)
            }
        case "markVisualChange":
            let importance = arguments.string("importance")
            if importance == "high" || importance == "critical" {
                VisualCapture.shared.snapshotNow()
            }
            result(true)
        case "onScroll":
            ReplayOrchestrator.shared.logScrollAction()
            result(nil)
        case "onOAuthStarted":
            recordBridgeEvent("oauth_started", ["provider": arguments.string("provider")])
            result(true)
        case "onOAuthCompleted":
            recordBridgeEvent("oauth_completed", [
                "provider": arguments.string("provider"),
                "success": arguments.bool("success", default: false)
            ])
            result(true)
        case "onExternalUrlOpened":
            recordBridgeEvent("external_url_opened", ["scheme": arguments.string("urlScheme")])
            result(true)
        case "getSdkMetrics":
            result(
                SegmentDispatcher.shared.sdkTelemetrySnapshot(
                    currentQueueDepth: TelemetryPipeline.shared.getQueueDepth()
                )
            )
        case "updateMaskRegion":
            let rect = CGRect(
                x: arguments.double("left"),
                y: arguments.double("top"),
                width: arguments.double("width"),
                height: arguments.double("height")
            )
            VisualCapture.shared.setExternalRedactionRect(id: arguments.string("id"), rect: rect)
            result(nil)
        case "removeMaskRegion":
            VisualCapture.shared.removeExternalRedactionRect(id: arguments.string("id"))
            result(nil)
        case "debugCrash":
            #if DEBUG
            fatalError("Rejourney Flutter debug crash triggered")
            #else
            result(FlutterError(code: "debug_only", message: "debugCrash is available only in debug builds", details: nil))
            #endif
        case "debugTriggerAnr":
            #if DEBUG
            let duration = max(0, arguments.double("durationMs")) / 1000
            Thread.sleep(forTimeInterval: duration)
            result(nil)
            #else
            result(FlutterError(code: "debug_only", message: "debugTriggerAnr is available only in debug builds", details: nil))
            #endif
        default:
            result(FlutterMethodNotImplemented)
        }
    }

    private func configure(_ arguments: [String: Any], result: @escaping FlutterResult) {
        guard let url = URL(string: arguments.string("apiUrl", default: "https://api.rejourney.co")) else {
            result(FlutterError(code: "invalid_api_url", message: "apiUrl must be an absolute URL", details: nil))
            return
        }

        configuredOptions = RejourneyOptions(
            apiURL: url,
            userId: arguments.optionalString("userId"),
            enabled: arguments.bool("enabled", default: true),
            observeOnly: arguments.bool("observeOnly", default: false),
            captureFPS: arguments.optionalInt("fps"),
            maxSessionDurationMs: arguments.optionalInt("maxSessionDurationMs"),
            detectRageTaps: arguments.bool("detectRageTaps", default: true),
            rageTapThreshold: arguments.int("rageTapThreshold", default: 3),
            rageTapTimeWindowMs: arguments.int("rageTapTimeWindow", default: 500),
            rageTapRadius: arguments.double("rageTapRadius", default: 50),
            captureQuality: RejourneyCaptureQuality(rawValue: arguments.string("quality", default: "medium")) ?? .medium,
            wifiOnly: arguments.bool("wifiOnly", default: false),
            captureScreen: arguments.bool("captureScreen", default: true),
            captureAnalytics: arguments.bool("captureAnalytics", default: true),
            captureCrashes: arguments.bool("captureCrashes", default: true),
            captureANR: arguments.bool("captureANR", default: true),
            trackConsoleLogs: arguments.bool("captureLogs", default: true),
            collectDeviceInfo: arguments.bool("collectDeviceInfo", default: true),
            collectGeoLocation: arguments.bool("collectGeoLocation", default: true),
            autoTrackNetwork: arguments.bool("autoTrackNetwork", default: true),
            captureNativeSheets: arguments.bool("captureNativeSheets", default: true),
            debug: arguments.bool("debug", default: false)
        )

        Task { @MainActor in
            Rejourney.configure(publicKey: arguments.string("publicKey"), options: configuredOptions)
            result(nil)
        }
    }

    private func recordBridgeEvent(_ name: String, _ properties: [String: Any]) {
        Task { @MainActor in
            Rejourney.logEvent(name, properties: Self.metadata(properties))
        }
    }

    private static func metadata(_ raw: Any?) -> [String: RejourneyMetadataValue] {
        guard let dictionary = raw as? [String: Any] else { return [:] }
        return dictionary.mapValues(metadataValue)
    }

    private static func metadataValue(_ value: Any) -> RejourneyMetadataValue {
        if value is NSNull { return .null }
        if let value = value as? Bool { return .bool(value) }
        if let value = value as? Int { return .int(value) }
        if let value = value as? Double { return .double(value) }
        if let value = value as? NSNumber { return .double(value.doubleValue) }
        if let value = value as? String { return .string(value) }
        if let value = value as? [Any] { return .array(value.map(metadataValue)) }
        if let value = value as? [String: Any] { return .object(value.mapValues(metadataValue)) }
        return .string(String(describing: value))
    }
}

private extension Dictionary where Key == String, Value == Any {
    func string(_ key: String, default defaultValue: String = "") -> String {
        self[key] as? String ?? defaultValue
    }

    func optionalString(_ key: String) -> String? {
        guard let value = self[key] as? String, !value.isEmpty else { return nil }
        return value
    }

    func bool(_ key: String, default defaultValue: Bool) -> Bool {
        self[key] as? Bool ?? defaultValue
    }

    func double(_ key: String, default defaultValue: Double = 0) -> Double {
        (self[key] as? NSNumber)?.doubleValue ?? defaultValue
    }

    func int(_ key: String, default defaultValue: Int = 0) -> Int {
        (self[key] as? NSNumber)?.intValue ?? defaultValue
    }

    func optionalInt(_ key: String) -> Int? {
        (self[key] as? NSNumber)?.intValue
    }
}
