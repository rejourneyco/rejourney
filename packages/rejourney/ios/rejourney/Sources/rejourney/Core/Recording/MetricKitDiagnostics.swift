/**
 * Copyright 2026 Rejourney
 *
 * Licensed under the Apache License, Version 2.0.
 */

import Foundation
#if canImport(MetricKit)
import MetricKit

/// Delivers Apple's persisted hang diagnostics on the next launch. MetricKit is
/// the authoritative iOS source for a blocked-main-thread call tree; the live
/// watchdog only records that a freeze happened and never substitutes its own
/// watchdog-thread stack.
@available(iOS 14.0, *)
final class RejourneyMetricKitDiagnostics: NSObject, MXMetricManagerSubscriber {
    static let shared = RejourneyMetricKitDiagnostics()

    struct PendingLiveHang: Codable, Equatable {
        let incidentId: String
        let sessionId: String
        let timestampMs: UInt64
        let durationMs: Int
    }

    private var active = false
    private let pendingStore: URL
    private let pendingLock = NSLock()

    override init() {
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        pendingStore = cache.appendingPathComponent("rj_pending_hangs.json")
        super.init()
    }

    func activate() {
        guard !active else { return }
        active = true
        MXMetricManager.shared.add(self)
    }

    func deactivate() {
        guard active else { return }
        active = false
        MXMetricManager.shared.remove(self)
    }

    func didReceive(_ payloads: [MXMetricPayload]) {
        // Daily aggregate metrics are not Stability occurrences.
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        guard active else { return }
        for payload in payloads {
            for diagnostic in payload.hangDiagnostics ?? [] {
                persist(diagnostic: diagnostic, payload: payload)
            }
            for diagnostic in payload.crashDiagnostics ?? [] {
                persist(crashDiagnostic: diagnostic, payload: payload)
            }
        }
    }

    func noteLiveHang(
        incidentId: String,
        sessionId: String,
        timestampMs: UInt64,
        durationMs: Int
    ) {
        pendingLock.lock()
        defer { pendingLock.unlock() }

        let retentionStart = timestampMs > 3 * 24 * 60 * 60 * 1_000
            ? timestampMs - 3 * 24 * 60 * 60 * 1_000
            : 0
        var pending = loadPendingHangs()
            .filter { $0.timestampMs >= retentionStart }
        pending.append(PendingLiveHang(
            incidentId: incidentId,
            sessionId: sessionId,
            timestampMs: timestampMs,
            durationMs: durationMs
        ))
        savePendingHangs(Array(pending.suffix(100)))
    }

    private func persist(diagnostic: MXHangDiagnostic, payload: MXDiagnosticPayload) {
        let durationMs = max(
            1,
            Int(diagnostic.hangDuration.converted(to: .milliseconds).value.rounded())
        )
        let frames = Self.frames(from: diagnostic.callStackTree)
        let matchedHang = takeMatchingLiveHang(
            durationMs: durationMs,
            payloadStartMs: UInt64(max(0, payload.timeStampBegin.timeIntervalSince1970 * 1_000)),
            payloadEndMs: UInt64(max(0, payload.timeStampEnd.timeIntervalSince1970 * 1_000))
        )
        let timestampMs = matchedHang?.timestampMs
            ?? UInt64(max(0, payload.timeStampEnd.timeIntervalSince1970 * 1_000))
        let firstFrame = frames.first ?? "missing-stack"
        let stableId = String(
            "metrickit-\(timestampMs)-\(durationMs)-\(firstFrame)"
                .replacingOccurrences(of: " ", with: "-")
                .prefix(128)
        )
        let incident = IncidentRecord(
            incidentId: matchedHang?.incidentId ?? stableId,
            sessionId: matchedHang?.sessionId ?? "unknown",
            timestampMs: timestampMs,
            category: "anr",
            identifier: "MetricKitHang",
            detail: "Main thread unresponsive for \(durationMs)ms",
            frames: frames,
            context: [
                "durationMs": String(durationMs),
                "threadState": "main_thread_hang",
                "diagnosticSource": "metrickit",
                "correlationState": matchedHang == nil ? "unmatched" : "matched_live_watchdog",
                "symbolicationState": "raw"
            ]
        )

        StabilityMonitor.shared.persistIncidentSync(incident)
        StabilityMonitor.shared.transmitStoredReport()
    }

    private func persist(
        crashDiagnostic diagnostic: MXCrashDiagnostic,
        payload: MXDiagnosticPayload
    ) {
        let frames = Self.frames(from: diagnostic.callStackTree)
        let timestampMs = UInt64(max(0, payload.timeStampEnd.timeIntervalSince1970 * 1_000))
        let firstFrame = frames.first ?? "missing-stack"
        let incidentId = String(
            "metrickit-crash-\(timestampMs)-\(firstFrame)"
                .replacingOccurrences(of: " ", with: "-")
                .prefix(128)
        )
        let incident = IncidentRecord(
            incidentId: incidentId,
            sessionId: "unknown",
            timestampMs: timestampMs,
            category: "crash",
            identifier: "MetricKitCrash",
            detail: "Crash diagnostic delivered by MetricKit",
            frames: frames,
            context: [
                "diagnosticSource": "metrickit",
                "diagnosticKind": "crash",
                "correlationState": "unmatched",
                "symbolicationState": "raw"
            ]
        )

        StabilityMonitor.shared.persistIncidentSync(incident)
        StabilityMonitor.shared.transmitStoredReport()
    }

    private func takeMatchingLiveHang(
        durationMs: Int,
        payloadStartMs: UInt64,
        payloadEndMs: UInt64
    ) -> PendingLiveHang? {
        pendingLock.lock()
        defer { pendingLock.unlock() }

        var pending = loadPendingHangs()
        guard let matched = Self.bestPendingHang(
            pending,
            durationMs: durationMs,
            payloadStartMs: payloadStartMs,
            payloadEndMs: payloadEndMs
        ) else {
            return nil
        }
        pending.removeAll { $0.incidentId == matched.incidentId }
        savePendingHangs(pending)
        return matched
    }

    static func bestPendingHang(
        _ candidates: [PendingLiveHang],
        durationMs: Int,
        payloadStartMs: UInt64,
        payloadEndMs: UInt64
    ) -> PendingLiveHang? {
        candidates
            .filter { candidate in
                candidate.timestampMs >= payloadStartMs && candidate.timestampMs <= payloadEndMs
            }
            .min { left, right in
                let leftDurationDelta = abs(left.durationMs - durationMs)
                let rightDurationDelta = abs(right.durationMs - durationMs)
                if leftDurationDelta != rightDurationDelta {
                    return leftDurationDelta < rightDurationDelta
                }
                return left.timestampMs > right.timestampMs
            }
    }

    private func loadPendingHangs() -> [PendingLiveHang] {
        guard
            let data = try? Data(contentsOf: pendingStore),
            let pending = try? JSONDecoder().decode([PendingLiveHang].self, from: data)
        else {
            return []
        }
        return pending
    }

    private func savePendingHangs(_ pending: [PendingLiveHang]) {
        guard let data = try? JSONEncoder().encode(pending) else { return }
        try? data.write(to: pendingStore, options: .atomic)
    }

    static func frames(from tree: MXCallStackTree) -> [String] {
        guard
            let json = try? JSONSerialization.jsonObject(with: tree.jsonRepresentation()),
            let root = json as? [String: Any]
        else {
            return []
        }
        return frames(fromJSONObject: root)
    }

    static func frames(fromJSONObject root: [String: Any]) -> [String] {
        guard
            let callStackTree = root["callStackTree"] as? [String: Any],
            let callStacks = callStackTree["callStacks"] as? [[String: Any]]
        else {
            return []
        }

        var frames: [String] = []
        let attributed = callStacks.first(where: { ($0["threadAttributed"] as? Bool) == true })
            ?? callStacks.first
        if let rootFrames = attributed?["callStackRootFrames"] as? [[String: Any]] {
            append(frames: rootFrames, to: &frames, depth: 0)
        }
        return Array(frames.prefix(128))
    }

    private static func append(
        frames: [[String: Any]],
        to output: inout [String],
        depth: Int
    ) {
        guard depth < 128 else { return }
        for frame in frames {
            let binaryName = frame["binaryName"] as? String ?? "unknown"
            let address = unsignedValue(frame["address"])
            let offset = unsignedValue(frame["offsetIntoBinaryTextSegment"])
            let uuid = frame["binaryUUID"] as? String
            var formatted = "\(binaryName) 0x\(String(address ?? 0, radix: 16))"
            if let offset {
                formatted += " + \(offset)"
            }
            if let uuid {
                formatted += " [\(uuid)]"
            }
            output.append(formatted)
            if let children = frame["subFrames"] as? [[String: Any]] {
                append(frames: children, to: &output, depth: depth + 1)
            }
        }
    }

    private static func unsignedValue(_ value: Any?) -> UInt64? {
        if let number = value as? NSNumber {
            return number.uint64Value
        }
        if let string = value as? String {
            return UInt64(string) ?? UInt64(string.replacingOccurrences(of: "0x", with: ""), radix: 16)
        }
        return nil
    }
}
#endif
