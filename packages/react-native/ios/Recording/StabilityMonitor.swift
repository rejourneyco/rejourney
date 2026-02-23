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

struct IncidentRecord: Codable {
    let sessionId: String
    let timestampMs: UInt64
    let category: String
    let identifier: String
    let detail: String
    let frames: [String]
    let context: [String: String]
}

private func _rjSignalHandler(_ signum: Int32) {
    let name: String
    switch signum {
    case SIGABRT: name = "SIGABRT"
    case SIGBUS:  name = "SIGBUS"
    case SIGFPE:  name = "SIGFPE"
    case SIGILL:  name = "SIGILL"
    case SIGSEGV: name = "SIGSEGV"
    case SIGTRAP: name = "SIGTRAP"
    default:      name = "SIG\(signum)"
    }

    let incident = IncidentRecord(
        sessionId: StabilityMonitor.shared.currentSessionId ?? "unknown",
        timestampMs: UInt64(Date().timeIntervalSince1970 * 1000),
        category: "signal",
        identifier: name,
        detail: "Signal \(signum) received",
        frames: Thread.callStackSymbols.map { $0.trimmingCharacters(in: .whitespaces) },
        context: [
            "threadName": Thread.current.name ?? "unnamed",
            "isMain": Thread.isMainThread ? "true" : "false",
            "priority": String(format: "%.2f", Thread.current.threadPriority)
        ]
    )

    ReplayOrchestrator.shared.incrementFaultTally()
    StabilityMonitor.shared.persistIncidentSync(incident)

    // Flush visual frames to disk for crash safety
    VisualCapture.shared.flushToDisk()

    signal(signum, SIG_DFL)
    raise(signum)
}

@objc(StabilityMonitor)
public final class StabilityMonitor: NSObject {

    @objc public static let shared = StabilityMonitor()
    @objc public var isMonitoring = false
    @objc public var currentSessionId: String?

    private let _incidentStore: URL
    private let _workerQueue = DispatchQueue(label: "co.rejourney.stability", qos: .utility)

    private static var _chainedExceptionHandler: NSUncaughtExceptionHandler?
    private static var _chainedSignalHandlers: [Int32: sig_t] = [:]
    private static let _trackedSignals: [Int32] = [SIGABRT, SIGBUS, SIGFPE, SIGILL, SIGSEGV, SIGTRAP]

    private override init() {
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        _incidentStore = cache.appendingPathComponent("rj_incidents.json")
        super.init()
    }

    @objc public func activate() {
        guard !isMonitoring else { return }
        isMonitoring = true

        StabilityMonitor._chainedExceptionHandler = NSGetUncaughtExceptionHandler()
        NSSetUncaughtExceptionHandler { ex in
            StabilityMonitor.shared._captureException(ex)
            StabilityMonitor._chainedExceptionHandler?(ex)
        }

        for sig in StabilityMonitor._trackedSignals {
            StabilityMonitor._chainedSignalHandlers[sig] = signal(sig, _rjSignalHandler)
        }

        _workerQueue.async { [weak self] in
            self?._uploadStoredIncidents()
        }
    }

    @objc public func deactivate() {
        guard isMonitoring else { return }
        isMonitoring = false

        NSSetUncaughtExceptionHandler(nil)
        StabilityMonitor._chainedExceptionHandler = nil

        for sig in StabilityMonitor._trackedSignals {
            if let prev = StabilityMonitor._chainedSignalHandlers[sig] {
                signal(sig, prev)
            } else {
                signal(sig, SIG_DFL)
            }
        }
        StabilityMonitor._chainedSignalHandlers.removeAll()
    }

    @objc public func transmitStoredReport() {
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
        VisualCapture.shared.flushToDisk()

        Thread.sleep(forTimeInterval: 0.15)
    }

    func persistIncidentSync(_ incident: IncidentRecord) {
        do {
            let data = try JSONEncoder().encode(incident)
            try data.write(to: _incidentStore, options: .atomic)
        } catch {
            DiagnosticLog.fault("[StabilityMonitor] Incident persist failed: \(error)")
        }
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
        do {
            let data = try JSONEncoder().encode(incident)
            try data.write(to: _incidentStore, options: .atomic)
        } catch {
            DiagnosticLog.fault("[StabilityMonitor] Incident persist failed: \(error)")
        }
    }

    private func _uploadStoredIncidents() {
        guard FileManager.default.fileExists(atPath: _incidentStore.path),
              let data = try? Data(contentsOf: _incidentStore),
              let incident = try? JSONDecoder().decode(IncidentRecord.self, from: data) else { return }

        _transmitIncident(incident) { [weak self] ok in
            guard ok, let self else { return }
            try? FileManager.default.removeItem(at: self._incidentStore)
        }
    }

    private func _transmitIncident(_ incident: IncidentRecord, completion: @escaping (Bool) -> Void) {
        let base = SegmentDispatcher.shared.endpoint
        guard let url = URL(string: "\(base)/api/ingest/fault") else {
            completion(false)
            return
        }

        var req = URLRequest(url: url)
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

@objc(FaultTracker)
public final class FaultTracker: NSObject {
    @objc public static let shared = FaultTracker()

    private override init() { super.init() }

    @objc public func activate() {
        StabilityMonitor.shared.activate()
    }

    @objc public func deactivate() {
        StabilityMonitor.shared.deactivate()
    }
}
