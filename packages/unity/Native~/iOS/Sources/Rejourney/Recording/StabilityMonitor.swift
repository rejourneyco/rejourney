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
    let routeEndpoint: String?
    let routeProjectId: String?

    init(
        incidentId: String = UUID().uuidString,
        sessionId: String,
        timestampMs: UInt64,
        category: String,
        identifier: String,
        detail: String,
        frames: [String],
        context: [String: String],
        routeEndpoint: String? = nil,
        routeProjectId: String? = nil,
        captureCurrentRoute: Bool = true
    ) {
        self.incidentId = incidentId
        self.sessionId = sessionId
        self.timestampMs = timestampMs
        self.category = category
        self.identifier = identifier
        self.detail = detail
        self.frames = frames
        self.context = context
        if captureCurrentRoute {
            let route = SegmentDispatcher.shared.currentUploadRoute()
            self.routeEndpoint = routeEndpoint ?? route.endpoint
            self.routeProjectId = routeProjectId ?? route.projectId
        } else {
            self.routeEndpoint = routeEndpoint
            self.routeProjectId = routeProjectId
        }
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
        routeEndpoint = try values.decodeIfPresent(String.self, forKey: .routeEndpoint)
        routeProjectId = try values.decodeIfPresent(String.self, forKey: .routeProjectId)
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
            _persistCurrentSessionRoute()
        }
    }

    private let _incidentStore: URL
    private let _signalMarkerStore: URL
    private let _sessionContextStore: URL
    private let _captureStateStore: URL
    private let _sessionRouteStore: URL
    private let _previousSessionId: String?
    private let _previousSessionWasCapturing: Bool
    private let _previousRouteEndpoint: String?
    private let _previousRouteProjectId: String?
    private let _incidentStoreLock = NSLock()
    private let _workerQueue = DispatchQueue(label: "co.rejourney.stability", qos: .utility)
    private var _uploadInFlight = false
    private var _hasActivatedCrashDiagnosticsThisProcess = false
    private static let maxStoredIncidents = 100

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
        _captureStateStore = supportBase.appendingPathComponent("rj_capture_enabled.txt")
        _sessionRouteStore = supportBase.appendingPathComponent("rj_last_session_route.json")
        _previousSessionId = (try? String(contentsOf: _sessionContextStore, encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let state = try? String(contentsOf: _captureStateStore, encoding: .utf8) {
            _previousSessionWasCapturing = state.trimmingCharacters(in: .whitespacesAndNewlines) == "1"
        } else {
            // Preserve historical crash recovery for upgrades from SDK builds
            // that predate the explicit pause-state marker.
            _previousSessionWasCapturing = _previousSessionId?.isEmpty == false
        }
        if let routeData = try? Data(contentsOf: _sessionRouteStore),
           let route = try? JSONSerialization.jsonObject(with: routeData) as? [String: Any] {
            _previousRouteEndpoint = route["endpoint"] as? String
            _previousRouteProjectId = route["projectId"] as? String
        } else {
            _previousRouteEndpoint = nil
            _previousRouteProjectId = nil
        }

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
        _persistCaptureState(true)

        if #available(iOS 14.0, *) {
            let suppressPreviousPausedLaunch = !_hasActivatedCrashDiagnosticsThisProcess
                && !_previousSessionWasCapturing
            _hasActivatedCrashDiagnosticsThisProcess = true
            RejourneyMetricKitDiagnostics.shared.activateCrashDiagnostics(
                suppressNextDelivery: suppressPreviousPausedLaunch
            )
        }

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
        // Explicit user pause and full stop both end crash collection. Persist
        // before returning so a later MetricKit delivery cannot report a crash
        // that happened while Rejourney was paused.
        _persistCaptureState(false)

        if #available(iOS 14.0, *) {
            RejourneyMetricKitDiagnostics.shared.deactivateCrashDiagnostics()
        }

        rjUninstallExceptionHandler()
        rjUninstallSignalHandler()
    }

    private func _persistCaptureState(_ enabled: Bool) {
        try? Data((enabled ? "1" : "0").utf8).write(to: _captureStateStore, options: .atomic)
    }

    private func _persistCurrentSessionRoute() {
        let route = SegmentDispatcher.shared.currentUploadRoute()
        var payload: [String: Any] = ["endpoint": route.endpoint]
        if let projectId = route.projectId { payload["projectId"] = projectId }
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        try? data.write(to: _sessionRouteStore, options: .atomic)
    }

    func historicalUploadRoute() -> (endpoint: String?, projectId: String?) {
        (_previousRouteEndpoint, _previousRouteProjectId)
    }

    func historicalSessionContext() -> (sessionId: String?, endpoint: String?, projectId: String?) {
        (
            Self.historicalSessionId(
                previousSessionId: _previousSessionId,
                wasCapturing: _previousSessionWasCapturing
            ),
            _previousRouteEndpoint,
            _previousRouteProjectId
        )
    }

    static func historicalSessionId(
        previousSessionId: String?,
        wasCapturing: Bool
    ) -> String? {
        guard wasCapturing,
              let normalized = previousSessionId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !normalized.isEmpty else { return nil }
        return normalized
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
        guard isMonitoring else { return }
        _captureException(exception)
    }

    private func _processSignalMarker() {
        guard let marker = try? Data(contentsOf: _signalMarkerStore), marker.count >= 8 else {
            return
        }
        guard _previousSessionWasCapturing else {
            // Deactivation persists the disabled state before uninstalling the
            // process-wide handler. Ignore the narrow race where a fatal signal
            // lands between those two operations.
            try? FileManager.default.removeItem(at: _signalMarkerStore)
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
            ],
            routeEndpoint: _previousRouteEndpoint,
            routeProjectId: _previousRouteProjectId,
            captureCurrentRoute: false
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
            let queued = Array(
                Self.mergeStoredIncidents(existing, with: incident)
                    .suffix(Self.maxStoredIncidents)
            )
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

        let route = SegmentDispatcher.shared.currentUploadRoute()
        _incidentStoreLock.lock()
        let incident = (try? Data(contentsOf: _incidentStore))
            .map(Self.decodeStoredIncidents)?
            .first(where: {
                Self.routeMatches(
                    incident: $0,
                    endpoint: route.endpoint,
                    projectId: route.projectId
                )
            })
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

    static func routeMatches(
        incident: IncidentRecord,
        endpoint: String,
        projectId: String?
    ) -> Bool {
        if let routeEndpoint = incident.routeEndpoint, routeEndpoint != endpoint {
            return false
        }
        if let routeProjectId = incident.routeProjectId, routeProjectId != projectId {
            return false
        }
        return true
    }

    private func _transmitIncident(_ incident: IncidentRecord, completion: @escaping (Bool) -> Void) {
        guard SegmentDispatcher.shared.matchesCurrentUploadRoute(
            endpoint: incident.routeEndpoint,
            projectId: incident.routeProjectId
        ) else {
            completion(false)
            return
        }
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
            let storedData = try JSONEncoder().encode(incident)
            guard var body = try JSONSerialization.jsonObject(with: storedData) as? [String: Any] else {
                completion(false)
                return
            }
            // Routing metadata is SDK-internal and exists only to prevent a
            // durable report crossing projects after reconfiguration.
            body.removeValue(forKey: "routeEndpoint")
            body.removeValue(forKey: "routeProjectId")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
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
