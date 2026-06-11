//
//  RejourneyExample.swift
//  CountriesSwiftUI
//
//  Created by Rejourney on 5/4/26.
//

import Foundation
import Rejourney

@MainActor
enum RejourneyExample {
    /// Demo identity for Rejourney `identify` / `RejourneyOptions.userId` (not real PII).
    static let demoUserId = "user_abc123"

    private static let publicKey = "rj_94f602bb3ff12873008b16fb2f3389cc"
    // Fallback URL (Set this to your Mac's local IP address like 192.168.x.x for physical device testing)
    private static let fallbackAPIURL = URL(string: "http://192.168.10.53:3000")!
    private static var didConfigure = false
    private static var didStart = false
    private static var pendingScreens: [String] = []
    private static var pendingEvents: [(name: String, properties: [String: RejourneyMetadataValue])] = []

    static var apiURL: URL {
        for key in ["API_URL", "PUBLIC_API_URL", "REJOURNEY_API_URL"] {
            if let value = ProcessInfo.processInfo.environment[key],
               let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
               url.scheme != nil,
               url.host != nil {
                return url
            }
        }
        return fallbackAPIURL
    }

    static func configureAndStart() {
        guard shouldRun, !didConfigure else { return }

        let resolvedAPIURL = apiURL
        didConfigure = true

        Rejourney.configure(
            publicKey: publicKey,
            options: RejourneyOptions(
                apiURL: resolvedAPIURL,
                userId: demoUserId,
                autoTrackNetwork: true,
                debug: true
            )
        )

        Task { @MainActor in
            let result = await Rejourney.start()
            guard result.success else {
                print("[RejourneyExample] Failed to start Rejourney: \(result.error ?? "unknown error")")
                return
            }

            didStart = true
            Rejourney.identify(demoUserId)
            Rejourney.logEvent("swift_clean_arch_context", properties: [
                "example_app": .string("swift-clean-arch"),
                "platform": .string("ios"),
                "environment": .string(ProcessInfo.processInfo.environment["ENV"] ?? "development"),
                "api_url": .string(resolvedAPIURL.absoluteString),
                "telemetry_only": .bool(result.telemetryOnly)
            ])
            Rejourney.logEvent("swift_clean_arch_started", properties: [
                "session_id": .string(result.sessionId ?? "unknown"),
                "api_url": .string(resolvedAPIURL.absoluteString),
                "telemetry_only": .bool(result.telemetryOnly)
            ])
            flushPendingTelemetry()
        }
    }

    static func trackScreen(_ screenName: String) {
        guard shouldRun, !screenName.isEmpty else { return }
        if didStart {
            Rejourney.trackScreen(screenName)
        } else {
            pendingScreens.append(screenName)
        }
    }

    static func logEvent(_ name: String, properties: [String: Any] = [:]) {
        guard shouldRun, !name.isEmpty else { return }
        let typedProperties = properties.compactMapValues(metadataValue)
        if didStart {
            Rejourney.logEvent(name, properties: typedProperties)
        } else {
            pendingEvents.append((name, typedProperties))
        }
    }

    private static var shouldRun: Bool {
        !ProcessInfo.processInfo.isRunningTests
    }

    private static func flushPendingTelemetry() {
        for screenName in pendingScreens {
            Rejourney.trackScreen(screenName)
        }
        pendingScreens.removeAll()

        for event in pendingEvents {
            Rejourney.logEvent(event.name, properties: event.properties)
        }
        pendingEvents.removeAll()
    }

    private static func metadataValue(from value: Any) -> RejourneyMetadataValue? {
        switch value {
        case let value as RejourneyMetadataValue:
            return value
        case let value as String:
            return .string(value)
        case let value as Int:
            return .int(value)
        case let value as Double:
            return .double(value)
        case let value as Float:
            return .double(Double(value))
        case let value as Bool:
            return .bool(value)
        case let value as [Any]:
            return .array(value.compactMap(metadataValue))
        case let value as [String: Any]:
            return .object(value.compactMapValues(metadataValue))
        default:
            return nil
        }
    }
}
