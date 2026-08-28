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

import Foundation
import MachO

@_silgen_name("rj_install_signal_handler")
private func rjInstallSignalHandler(_ path: UnsafePointer<CChar>) -> Int32

@_silgen_name("rj_uninstall_signal_handler")
private func rjUninstallSignalHandler()

private typealias RJExceptionCallback = @convention(c) (UnsafeMutableRawPointer?) -> Void

@_silgen_name("rj_install_exception_handler")
private func rjInstallExceptionHandler(_ callback: RJExceptionCallback)

@_silgen_name("rj_uninstall_exception_handler")
private func rjUninstallExceptionHandler()

private func rjCaptureUncaughtException(_ opaque: UnsafeMutableRawPointer?) {
    guard let opaque else { return }
    let exception = Unmanaged<NSException>.fromOpaque(opaque).takeUnretainedValue()
    StabilityMonitor.shared.captureUncaughtException(exception)
}

struct IncidentRecord: Codable {
    let incidentId: String
    let sessionId: String
    let timestampMs: UInt64
    let category: String
    let identifier: String
    let detail: String
    let frames: [String]
    let context: [String: String]

    init(
        incidentId: String = UUID().uuidString,
        sessionId: String,
        timestampMs: UInt64,
        category: String,
        identifier: String,
        detail: String,
        frames: [String],
        context: [String: String]
    ) {
        self.incidentId = incidentId
        self.sessionId = sessionId
        self.timestampMs = timestampMs
        self.category = category
        self.identifier = identifier
        self.detail = detail
        self.frames = frames
        self.context = context
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try values.decode(String.self, forKey: .sessionId)
        timestampMs = try values.decode(UInt64.self, forKey: .timestampMs)
        category = try values.decode(String.self, forKey: .category)
        identifier = try values.decode(String.self, forKey: .identifier)
        detail = try values.decode(String.self, forKey: .detail)
        frames = try values.decode([String].self, forKey: .frames)
        context = try values.decode([String: String].self, forKey: .context)
        incidentId = try values.decodeIfPresent(String.self, forKey: .incidentId)
            ?? String("legacy-\(sessionId)-\(timestampMs)-\(category)-\(identifier)".prefix(128))
    }
}

@objc(RJNativeStabilityMonitor)
final class StabilityMonitor: NSObject {

    @objc static let shared = StabilityMonitor()
    @objc var isMonitoring = false
    @objc var currentSessionId: String? {
        didSet {
            guard let currentSessionId, !currentSessionId.isEmpty else { return }
            try? Data(currentSessionId.utf8).write(to: _sessionContextStore, options: .atomic)
        }
    }

    private let _incidentStore: URL
    private let _signalMarkerStore: URL
    private let _sessionContextStore: URL
    private let _previousSessionId: String?
    private let _incidentStoreLock = NSLock()
    private let _workerQueue = DispatchQueue(label: "co.rejourney.stability", qos: .utility)
    private var _uploadInFlight = false

    private override init() {
        let supportBase = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!.appendingPathComponent("Rejourney", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: supportBase,
            withIntermediateDirectories: true
        )
        _incidentStore = supportBase.appendingPathComponent("rj_incidents.json")
        _signalMarkerStore = supportBase.appendingPathComponent("rj_signal.marker")
        _sessionContextStore = supportBase.appendingPathComponent("rj_last_session.txt")
        _previousSessionId = (try? String(contentsOf: _sessionContextStore, encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if let legacy = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)
            .first?.appendingPathComponent("rj_incidents.json"),
           FileManager.default.fileExists(atPath: legacy.path),
           !FileManager.default.fileExists(atPath: _incidentStore.path) {
            try? FileManager.default.moveItem(at: legacy, to: _incidentStore)
        }
        super.init()
    }

    @objc func activate() {
        guard !isMonitoring else { return }
        isMonitoring = true

        rjInstallExceptionHandler(rjCaptureUncaughtException)

        _processSignalMarker()
        _signalMarkerStore.path.withCString { path in
            if rjInstallSignalHandler(path) != 0 {
                DiagnosticLog.fault("[StabilityMonitor] Failed to install safe signal marker")
            }
        }

        _workerQueue.async { [weak self] in
            self?._uploadStoredIncidents()
        }
    }

    @objc func deactivate() {
        guard isMonitoring else { return }
        isMonitoring = false

        rjUninstallExceptionHandler()
        rjUninstallSignalHandler()
    }

    @objc func transmitStoredReport() {
        _workerQueue.async { [weak self] in
            self?._uploadStoredIncidents()
        }
    }

    private func _captureException(_ exception: NSException) {
        let incident = IncidentRecord(
            sessionId: currentSessionId ?? "unknown",
            timestampMs: UInt64(Date().timeIntervalSince1970 * 1000),
            category: "exception",
            identifier: exception.name.rawValue,
            detail: exception.reason ?? "",
            frames: _formatFrames(exception.callStackSymbols),
            context: _captureContext()
        )

        ReplayOrchestrator.shared.incrementFaultTally()
        _persistIncident(incident)

        // Flush visual frames to disk for crash safety
        VisualCapture.shared.flushToDiskForCrash()

    }

    fileprivate func captureUncaughtException(_ exception: NSException) {
        _captureException(exception)
    }

    private func _processSignalMarker() {
        guard let marker = try? Data(contentsOf: _signalMarkerStore), marker.count >= 8 else {
            return
        }
        let bytes = [UInt8](marker.prefix(8))
        guard bytes[0] == 0x52, bytes[1] == 0x4A, bytes[2] == 0x53, bytes[3] == 0x31 else {
            try? FileManager.default.removeItem(at: _signalMarkerStore)
            return
        }
        let signalNumber = Int32(bitPattern:
            UInt32(bytes[4]) |
            (UInt32(bytes[5]) << 8) |
            (UInt32(bytes[6]) << 16) |
            (UInt32(bytes[7]) << 24)
        )
        let signalName: String
        switch signalNumber {
        case SIGABRT: signalName = "SIGABRT"
        case SIGBUS: signalName = "SIGBUS"
        case SIGFPE: signalName = "SIGFPE"
        case SIGILL: signalName = "SIGILL"
        case SIGSEGV: signalName = "SIGSEGV"
        case SIGTRAP: signalName = "SIGTRAP"
        default: signalName = "SIG\(signalNumber)"
        }
        let attributes = try? FileManager.default.attributesOfItem(atPath: _signalMarkerStore.path)
        let modified = attributes?[.modificationDate] as? Date ?? Date()
        let sessionId = (_previousSessionId?.isEmpty == false ? _previousSessionId : nil)
            ?? "historical_signal_\(UInt64(modified.timeIntervalSince1970 * 1000))"
        let incident = IncidentRecord(
            sessionId: sessionId,
            timestampMs: UInt64(max(0, modified.timeIntervalSince1970 * 1000)),
            category: "signal",
            identifier: signalName,
            detail: "Fatal signal \(signalNumber) recorded by async-signal-safe marker",
            frames: [],
            context: [
                "source": "async_signal_safe_marker",
                "signalNumber": "\(signalNumber)",
                "framesAvailable": "false"
            ]
        )
        persistIncidentSync(incident)
        try? FileManager.default.removeItem(at: _signalMarkerStore)
    }

    func persistIncidentSync(_ incident: IncidentRecord) {
        _incidentStoreLock.lock()
        defer { _incidentStoreLock.unlock() }

        do {
            let existing = Self.decodeStoredIncidents(
                (try? Data(contentsOf: _incidentStore)) ?? Data()
            )
            let queued = Self.mergeStoredIncidents(existing, with: incident)
            let data = try JSONEncoder().encode(queued)
            try data.write(to: _incidentStore, options: .atomic)
        } catch {
            DiagnosticLog.fault("[StabilityMonitor] Incident persist failed: \(error)")
        }
    }

    static func decodeStoredIncidents(_ data: Data) -> [IncidentRecord] {
        guard !data.isEmpty else { return [] }
        if let queued = try? JSONDecoder().decode([IncidentRecord].self, from: data) {
            return queued
        }
        if let legacy = try? JSONDecoder().decode(IncidentRecord.self, from: data) {
            return [legacy]
        }
        return []
    }

    static func mergeStoredIncidents(
        _ existing: [IncidentRecord],
        with incoming: IncidentRecord
    ) -> [IncidentRecord] {
        if existing.contains(where: {
            $0.incidentId != incoming.incidentId
                && !shouldReplaceStoredIncident($0, with: incoming)
        }) {
            return existing
        }

        var queued = existing.filter { $0.incidentId != incoming.incidentId }
        if incoming.category.lowercased() == "exception" {
            queued.removeAll {
                $0.sessionId == incoming.sessionId
                    && $0.category.lowercased() == "signal"
            }
        }
        queued.append(incoming)
        return queued
    }

    static func shouldReplaceStoredIncident(
        _ existing: IncidentRecord,
        with incoming: IncidentRecord
    ) -> Bool {
        let existingHasUsefulException = existing.sessionId == incoming.sessionId
            && existing.category.lowercased() == "exception"
            && !existing.frames.isEmpty

        // An uncaught NSException later terminates through SIGABRT. Keep the
        // exception's original call stack instead of the signal-handler stack.
        if existingHasUsefulException && incoming.category.lowercased() == "signal" {
            return false
        }

        return true
    }

    private func _formatFrames(_ raw: [String]) -> [String] {
        raw.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    }

    private func _captureContext() -> [String: String] {
        [
            "threadName": Thread.current.name ?? "unnamed",
            "isMain": Thread.isMainThread ? "true" : "false",
            "priority": String(format: "%.2f", Thread.current.threadPriority)
        ]
    }

    private func _persistIncident(_ incident: IncidentRecord) {
        persistIncidentSync(incident)
    }

    private func _uploadStoredIncidents() {
        guard !_uploadInFlight else { return }

        _incidentStoreLock.lock()
        let incident = (try? Data(contentsOf: _incidentStore))
            .map(Self.decodeStoredIncidents)?
            .first
        _incidentStoreLock.unlock()
        guard let incident else { return }

        _uploadInFlight = true
        _transmitIncident(incident) { [weak self] ok in
            guard let self else { return }
            self._workerQueue.async {
                self._uploadInFlight = false
                guard ok else { return }

                self._incidentStoreLock.lock()
                var queued = (try? Data(contentsOf: self._incidentStore))
                    .map(Self.decodeStoredIncidents) ?? []
                queued.removeAll { $0.incidentId == incident.incidentId }
                do {
                    if queued.isEmpty {
                        try? FileManager.default.removeItem(at: self._incidentStore)
                    } else {
                        let data = try JSONEncoder().encode(queued)
                        try data.write(to: self._incidentStore, options: .atomic)
                    }
                } catch {
                    DiagnosticLog.fault("[StabilityMonitor] Incident dequeue failed: \(error)")
                }
                self._incidentStoreLock.unlock()

                self._uploadStoredIncidents()
            }
        }
    }

    private func _transmitIncident(_ incident: IncidentRecord, completion: @escaping (Bool) -> Void) {
        let base = SegmentDispatcher.shared.endpoint
        guard let url = URL(string: "\(base)/api/ingest/fault") else {
            completion(false)
            return
        }

        var req = URLRequest(url: url)
        req.timeoutInterval = 10
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let key = SegmentDispatcher.shared.apiToken {
            req.setValue(key, forHTTPHeaderField: "x-rejourney-key")
        }

        do {
            req.httpBody = try JSONEncoder().encode(incident)
        } catch {
            completion(false)
            return
        }

        URLSession.shared.dataTask(with: req) { _, resp, _ in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            completion(code >= 200 && code < 300)
        }.resume()
    }
}

@objc(RJNativeFaultTracker)
final class FaultTracker: NSObject {
    @objc static let shared = FaultTracker()

    private override init() { super.init() }

    @objc func activate() {
        StabilityMonitor.shared.activate()
    }

    @objc func deactivate() {
        StabilityMonitor.shared.deactivate()
    }
}
