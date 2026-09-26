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

@objc(RJNativeAnrSentinel)
final class AnrSentinel: NSObject {

    @objc static let shared = AnrSentinel()

    private let _freezeThreshold: TimeInterval = 5.0
    private let _pollFrequency: TimeInterval = 2.0

    private var _watchThread: Thread?
    private var _volatile = VolatileState()
    private let _stateLock = os_unfair_lock_t.allocate(capacity: 1)

    private override init() {
        _stateLock.initialize(to: os_unfair_lock())
        super.init()
    }

    deinit {
        _stateLock.deallocate()
    }

    @objc func activate() {
        if #available(iOS 14.0, *) {
            RejourneyMetricKitDiagnostics.shared.activateHangDiagnostics()
        }
        os_unfair_lock_lock(_stateLock)
        guard _watchThread == nil else {
            os_unfair_lock_unlock(_stateLock)
            return
        }

        _volatile.generation &+= 1
        let generation = _volatile.generation
        _volatile.running = true
        _volatile.awaitingPong = false
        _volatile.reportedCurrentStall = false
        _volatile.lastResponse = ProcessInfo.processInfo.systemUptime

        let t = Thread { [weak self] in self?._watchLoop(generation: generation) }
        t.name = "co.rejourney.anr"
        t.qualityOfService = .utility
        _watchThread = t
        os_unfair_lock_unlock(_stateLock)

        t.start()
    }

    @objc func halt() {
        if #available(iOS 14.0, *) {
            RejourneyMetricKitDiagnostics.shared.deactivateHangDiagnostics()
        }
        os_unfair_lock_lock(_stateLock)
        _volatile.running = false
        _volatile.awaitingPong = false
        _volatile.generation &+= 1
        _watchThread = nil
        os_unfair_lock_unlock(_stateLock)
    }

    private func _watchLoop(generation: UInt64) {
        while true {
            os_unfair_lock_lock(_stateLock)
            let running = _volatile.running && _volatile.generation == generation
            os_unfair_lock_unlock(_stateLock)
            guard running else { break }

            _sendPing(generation: generation)
            Thread.sleep(forTimeInterval: _pollFrequency)
            _checkPong(generation: generation)
        }
    }

    private func _sendPing(generation: UInt64) {
        os_unfair_lock_lock(_stateLock)
        if !_volatile.running || _volatile.generation != generation || _volatile.awaitingPong {
            os_unfair_lock_unlock(_stateLock)
            return
        }
        _volatile.awaitingPong = true
        os_unfair_lock_unlock(_stateLock)

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            os_unfair_lock_lock(self._stateLock)
            guard self._volatile.running, self._volatile.generation == generation else {
                os_unfair_lock_unlock(self._stateLock)
                return
            }
            self._volatile.lastResponse = ProcessInfo.processInfo.systemUptime
            self._volatile.awaitingPong = false
            self._volatile.reportedCurrentStall = false
            os_unfair_lock_unlock(self._stateLock)
        }
    }

    private func _checkPong(generation: UInt64) {
        os_unfair_lock_lock(_stateLock)
        guard _volatile.running, _volatile.generation == generation else {
            os_unfair_lock_unlock(_stateLock)
            return
        }
        let awaiting = _volatile.awaitingPong
        let last = _volatile.lastResponse
        let alreadyReported = _volatile.reportedCurrentStall
        os_unfair_lock_unlock(_stateLock)

        let now = ProcessInfo.processInfo.systemUptime
        let delta = now - last
        if Self.shouldReportFreeze(
            awaitingPong: awaiting,
            elapsed: delta,
            threshold: _freezeThreshold,
            alreadyReported: alreadyReported
        ) {
            os_unfair_lock_lock(_stateLock)
            guard _volatile.running,
                  _volatile.generation == generation,
                  _volatile.awaitingPong,
                  !_volatile.reportedCurrentStall else {
                os_unfair_lock_unlock(_stateLock)
                return
            }
            // Keep awaitingPong set until the main queue actually responds.
            // Resetting it here caused one long freeze to look like a series
            // of separate ANRs every threshold interval.
            _volatile.reportedCurrentStall = true
            os_unfair_lock_unlock(_stateLock)

            _reportFreeze(duration: delta)
        }
    }

    static func shouldReportFreeze(
        awaitingPong: Bool,
        elapsed: TimeInterval,
        threshold: TimeInterval,
        alreadyReported: Bool
    ) -> Bool {
        awaitingPong && elapsed >= threshold && !alreadyReported
    }

    private func _reportFreeze(duration: TimeInterval) {
        DiagnosticLog.emit(.caution, "Main thread frozen for \(String(format: "%.1f", duration))s")

        ReplayOrchestrator.shared.incrementStalledTally()

        let ms = Int(duration * 1000)
        let incidentId = UUID().uuidString
        let sessionId = StabilityMonitor.shared.currentSessionId
            ?? ReplayOrchestrator.shared.replayId
            ?? "unknown"
        let timestampMs = UInt64(Date().timeIntervalSince1970 * 1000)

        if #available(iOS 14.0, *) {
            RejourneyMetricKitDiagnostics.shared.noteLiveHang(
                incidentId: incidentId,
                sessionId: sessionId,
                timestampMs: timestampMs,
                durationMs: ms
            )
        }

        // A watchdog thread cannot safely or accurately unwind another Swift
        // thread. MetricKit supplies the blocked main-thread tree later; do not
        // publish this watchdog's own call stack as application evidence.
        TelemetryPipeline.shared.recordAnrEvent(durationMs: ms, stack: nil, incidentId: incidentId)

        // Persist ANR incident and send through /api/ingest/fault so ANRs survive
        // process termination/background upload loss, similar to crash recovery.
        let incident = IncidentRecord(
            incidentId: incidentId,
            sessionId: sessionId,
            timestampMs: timestampMs,
            category: "anr",
            identifier: "MainThreadFrozen",
            detail: "Main thread unresponsive for \(ms)ms",
            frames: [],
            context: [
                "durationMs": String(ms),
                "threadState": "blocked",
                "diagnosticSource": "watchdog",
                "diagnosticState": "awaiting_metrickit"
            ]
        )
        StabilityMonitor.shared.persistIncidentSync(incident)
        StabilityMonitor.shared.transmitStoredReport()
    }
}

private struct VolatileState {
    var running = false
    var awaitingPong = false
    var generation: UInt64 = 0
    var lastResponse: TimeInterval = 0
    var reportedCurrentStall = false
}

@objc(RJNativeResponsivenessWatcher)
final class ResponsivenessWatcher: NSObject {
    @objc static let shared = ResponsivenessWatcher()

    private override init() { super.init() }

    @objc func activate() {
        AnrSentinel.shared.activate()
    }

    @objc func halt() {
        AnrSentinel.shared.halt()
    }
}
