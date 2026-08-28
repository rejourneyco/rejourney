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

final class SegmentDispatcher {

    static let shared = SegmentDispatcher()

    private let stateLock = NSLock()
    private var _endpoint: String = "https://api.rejourney.co"
    private var _currentReplayId: String?
    private var _apiToken: String?
    private var _credential: String?
    private var _projectId: String?
    private var _isSampledIn: Bool = true
    private var _collectGeoLocation: Bool = true
    private var _observeOnly: Bool = false

    var endpoint: String {
        get { withState { _endpoint } }
        set { withState { _endpoint = newValue } }
    }
    var currentReplayId: String? {
        get { withState { _currentReplayId } }
        set { withState { _currentReplayId = newValue } }
    }
    var apiToken: String? {
        get { withState { _apiToken } }
        set { withState { _apiToken = newValue } }
    }
    var credential: String? {
        get { withState { _credential } }
        set { withState { _credential = newValue } }
    }
    var projectId: String? {
        get { withState { _projectId } }
        set { withState { _projectId = newValue } }
    }
    var isSampledIn: Bool {
        get { withState { _isSampledIn } }
        set { withState { _isSampledIn = newValue } }
    }
    /** When false, the backend is instructed to skip IP geolocation lookup for this session */
    var collectGeoLocation: Bool {
        get { withState { _collectGeoLocation } }
        set { withState { _collectGeoLocation = newValue } }
    }
    /** When true, signals the backend that no visual artifacts will ever arrive for this session */
    var observeOnly: Bool {
        get { withState { _observeOnly } }
        set { withState { _observeOnly = newValue } }
    }

    private var batchSeqNumber = 0
    private var billingBlocked = false
    private var consecutiveFailures = 0
    private var circuitOpen = false
    private var circuitOpenTime: TimeInterval = 0
    private let circuitBreakerThreshold = 5
    private let circuitResetTime: TimeInterval = 60

    @discardableResult
    private func withState<T>(_ body: () -> T) -> T {
        stateLock.lock()
        defer { stateLock.unlock() }
        return body()
    }

    private let workerQueue: OperationQueue = {
        let q = OperationQueue()
        q.maxConcurrentOperationCount = 2
        q.qualityOfService = .utility
        q.name = "co.rejourney.uploader"
        return q
    }()

    private let httpSession: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.httpMaximumConnectionsPerHost = 4
        // Offline uploads must fail rather than wait. With waitsForConnectivity
        // the request parks in memory until connectivity returns, so it never
        // errors, never reaches the on-disk retry queue, and is lost outright if
        // the process is killed first. Failing fast persists the segment instead.
        cfg.waitsForConnectivity = false
        // Inactivity timeout: long enough for a slow link to keep making
        // progress, short enough to give up on a dead one.
        cfg.timeoutIntervalForRequest = 15
        // Whole-transfer ceiling. Kept generous so a large segment on a slow
        // connection still completes; in-flight uploads no longer hold stop(),
        // so this does not delay teardown.
        cfg.timeoutIntervalForResource = 60
        // Strip our own protocol to prevent self-interception. Without this,
        // every SDK upload is intercepted by RejourneyURLProtocol which
        // generates redundant network events and wastes resources.
        if let protocolClasses = cfg.protocolClasses {
            cfg.protocolClasses = protocolClasses.filter { $0 != RejourneyURLProtocol.self }
        }
        return URLSession(configuration: cfg)
    }()

    private var retryQueue: [PendingUpload] = []
    private let retryLock = NSLock()
    // A single changed screen can produce both a screenshot bundle and a
    // hierarchy artifact. Twenty entries was small enough to discard useful
    // replay data during an ordinary one-minute outage, especially while the
    // circuit breaker was open. Keep this bounded, but large enough for the
    // documented offline/relaunch matrix to preserve a realistic session.
    private let maxRetryQueueSize = 64
    private let maxPersistedRetryBytes: Int64 = 32 * 1024 * 1024
    private var active = true
    private let retryDirectoryURL: URL?
    private let persistenceLock = NSLock()
    private var persistedUploadKeys: Set<String> = []
    private var persistedUploadSizes: [String: Int64] = [:]
    private var persistedUploadBytes: Int64 = 0

    // Tracks in-flight upload chains so the shutdown drain can wait for real completion.
    private let _uploadGroup = DispatchGroup()

    private let metricsLock = NSLock()
    private var uploadSuccessCount = 0
    private var uploadFailureCount = 0
    private var retryAttemptCount = 0
    private var circuitBreakerOpenCount = 0
    private var memoryEvictionCount = 0
    private var offlinePersistCount = 0
    private var sessionStartCount = 0
    private var crashCount = 0
    private var totalBytesUploaded: Int64 = 0
    private var totalBytesEvicted: Int64 = 0
    private var totalUploadDurationMs: Double = 0
    private var uploadDurationSampleCount = 0
    private var lastUploadTime: Int64?
    private var lastRetryTime: Int64?

    private init() {
        retryDirectoryURL = Self.makeRetryDirectory()
        loadPersistedRetries()
    }

    func configure(replayId: String, apiToken: String?, credential: String?, projectId: String?, isSampledIn: Bool = true) {
        withState {
            _currentReplayId = replayId
            _apiToken = apiToken
            _credential = credential
            _projectId = projectId
            _isSampledIn = isSampledIn
            batchSeqNumber = 0
            billingBlocked = false
            consecutiveFailures = 0
            circuitOpen = false
            circuitOpenTime = 0
            active = true
        }
        resetSessionTelemetry()
        // Persisted uploads carry their original session ID, so they can be
        // safely retried after a process restart or session rollover.
        shipPending()
    }

    /// Reactivate the dispatcher for a new session
    func activate() {
        withState {
            active = true
            consecutiveFailures = 0
            circuitOpen = false
        }
    }

    func halt() {
        withState { active = false }
    }

    /// Kick a retry-queue drain on the worker queue.
    ///
    /// Deliberately fire-and-forget. Callers include main-thread lifecycle
    /// observers (didEnterBackground, termination, session finalize), and the
    /// previous waitUntilAllOperationsAreFinished() here parked the MAIN thread
    /// on a utility-QoS queue that performs network uploads — a priority
    /// inversion that froze apps for seconds on every backgrounding and risked
    /// the watchdog. The drain that must complete before suspension owns a
    /// proper UIApplication background task in TelemetryPipeline instead.
    func shipPending() {
        workerQueue.addOperation { [weak self] in self?.drainRetryQueue() }
    }

    func transmitFrameBundle(payload: Data, startMs: UInt64, endMs: UInt64, frameCount: Int, completion: ((Bool) -> Void)? = nil) {
        transmitFrameBundle(for: currentReplayId, payload: payload, startMs: startMs, endMs: endMs, frameCount: frameCount, completion: completion)
    }

    func transmitFrameBundle(for sessionId: String?, payload: Data, startMs: UInt64, endMs: UInt64, frameCount: Int, completion: ((Bool) -> Void)? = nil) {
        guard let sid = sessionId else {
            completion?(false)
            return
        }

        let upload = PendingUpload(
            sessionId: sid,
            contentType: "screenshots",
            payload: payload,
            rangeStart: startMs,
            rangeEnd: endMs,
            itemCount: frameCount,
            attempt: 0,
            batchNumber: 0,
            isSampledIn: isSampledIn
        )
        scheduleUpload(upload, completion: completion)
    }

    func transmitHierarchy(replayId: String, hierarchyPayload: Data, timestampMs: UInt64, completion: ((Bool) -> Void)? = nil) {
        let upload = PendingUpload(
            sessionId: replayId,
            contentType: "hierarchy",
            payload: hierarchyPayload,
            rangeStart: timestampMs,
            rangeEnd: timestampMs,
            itemCount: 1,
            attempt: 0,
            batchNumber: 0,
            isSampledIn: isSampledIn
        )
        scheduleUpload(upload, completion: completion)
    }

    func transmitEventBatch(payload: Data, batchNumber: Int, eventCount: Int, completion: ((Bool) -> Void)? = nil) {
        guard let sid = currentReplayId else {
            completion?(false)
            return
        }

        scheduleUpload(PendingUpload(
            sessionId: sid,
            contentType: "events",
            payload: payload,
            rangeStart: 0,
            rangeEnd: 0,
            itemCount: eventCount,
            attempt: 0,
            batchNumber: batchNumber,
            isSampledIn: isSampledIn
        ), completion: completion)
    }

    func transmitEventBatchAlternate(replayId: String, eventPayload: Data, eventCount: Int, completion: ((Bool) -> Void)? = nil) {
        let seq = withState {
            batchSeqNumber += 1
            return batchSeqNumber
        }
        scheduleUpload(PendingUpload(
            sessionId: replayId,
            contentType: "events",
            payload: eventPayload,
            rangeStart: 0,
            rangeEnd: 0,
            itemCount: eventCount,
            attempt: 0,
            batchNumber: seq,
            isSampledIn: isSampledIn
        ), completion: completion)
    }

    func concludeReplay(
        replayId: String,
        concludedAt: UInt64,
        backgroundDurationMs: UInt64,
        metrics: [String: Any]?,
        currentQueueDepth: Int = 0,
        endReason: String? = nil,
        lifecycleVersion: Int? = nil,
        closeAnchorAtMs: UInt64? = nil,
        completion: @escaping (Bool) -> Void
    ) {
        guard let url = URL(string: "\(endpoint)/api/ingest/session/end") else {
            completion(false)
            return
        }
        ingestFinalizeMetrics(metrics)

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAuthHeaders(&req, sessionId: replayId)

        var body: [String: Any] = [
            "sessionId": replayId,
            "endedAt": concludedAt,
            "sdkVersion": RejourneySDKInfo.version,
            "isSampledIn": isSampledIn
        ]
        if backgroundDurationMs > 0 { body["totalBackgroundTimeMs"] = backgroundDurationMs }
        if let m = metrics { body["metrics"] = m }
        body["sdkTelemetry"] = sdkTelemetrySnapshot(currentQueueDepth: currentQueueDepth)
        if let endReason, !endReason.isEmpty {
            body["endReason"] = endReason
        }
        if let lifecycleVersion, lifecycleVersion > 0 {
            body["lifecycleVersion"] = lifecycleVersion
        }
        if let closeAnchorAtMs, closeAnchorAtMs > 0 {
            body["closeAnchorAtMs"] = closeAnchorAtMs
        }

        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            completion(false)
            return
        }

        httpSession.dataTask(with: req) { _, resp, _ in
            completion((resp as? HTTPURLResponse)?.statusCode == 200)
        }.resume()
    }

    private func canUploadNow() -> Bool {
        withState {
            if billingBlocked { return false }
            if circuitOpen {
                if Date().timeIntervalSince1970 - circuitOpenTime > circuitResetTime {
                    circuitOpen = false
                } else {
                    return false
                }
            }
            return true
        }
    }

    private func registerFailure() {
        let openedCircuit = withState { () -> Bool in
            consecutiveFailures += 1
            guard consecutiveFailures >= circuitBreakerThreshold else { return false }
            let newlyOpened = !circuitOpen
            circuitOpen = true
            circuitOpenTime = Date().timeIntervalSince1970
            return newlyOpened
        }
        metricsLock.lock()
        uploadFailureCount += 1
        if openedCircuit { circuitBreakerOpenCount += 1 }
        metricsLock.unlock()
    }

    private func registerSuccess() {
        withState { consecutiveFailures = 0 }
        metricsLock.lock()
        uploadSuccessCount += 1
        lastUploadTime = Self.nowMs()
        metricsLock.unlock()
    }

    private func scheduleUpload(_ upload: PendingUpload, completion: ((Bool) -> Void)?) {
        guard withState({ active }) else {
            completion?(false)
            return
        }
        // Enter before enqueueing so shutdown observes queued work as well as
        // URLSession callbacks that are already in flight.
        let uploadGroup = _uploadGroup
        uploadGroup.enter()
        workerQueue.addOperation { [weak self] in
            defer { uploadGroup.leave() }
            guard let self else { return }
            _ = self.persistUpload(upload)
            self.executeSegmentUpload(upload, completion: completion)
        }
    }

    private func executeSegmentUpload(_ upload: PendingUpload, completion: ((Bool) -> Void)?) {
        // A block Operation is considered finished as soon as its block
        // returns. Wait on this utility worker until the asynchronous
        // presign/upload/confirm chain completes so OperationQueue's configured
        // concurrency of two is a real in-flight network bound.
        let finished = DispatchSemaphore(value: 0)
        let finish: (Bool) -> Void = { success in
            completion?(success)
            // Treat the caller's acknowledgement/requeue callback as part of
            // the upload chain. A shutdown drain must not finish in the narrow
            // window after the network callback but before buffer ownership is
            // settled.
            finished.signal()
        }

        guard canUploadNow() else {
            // The circuit breaker rejected this before a network attempt was
            // made. Requeue the same durable item without consuming one of its
            // retry attempts; otherwise each drain burns an attempt and can
            // evict the recording without ever making another request.
            deferUploadWithoutAttempt(upload, completion: finish)
            finished.wait()
            return
        }

        requestPresignedUrl(upload: upload) { [weak self] presignResponse in
            guard let self else {
                finish(false)
                return
            }

            guard let presign = presignResponse else {
                self.registerFailure()
                self.scheduleRetryIfNeeded(upload, completion: finish)
                return
            }

            if presign.skipUpload {
                self.registerSuccess()
                self.removePersistedUpload(upload)
                finish(true)
                return
            }

            self.uploadToS3(url: presign.presignedUrl, payload: upload.payload) { s3ok in
                guard s3ok else {
                    self.registerFailure()
                    self.scheduleRetryIfNeeded(upload, completion: finish)
                    return
                }

                self.confirmBatchComplete(batchId: presign.batchId, upload: upload) { confirmOk in
                    if confirmOk {
                        self.registerSuccess()
                        self.removePersistedUpload(upload)
                        finish(true)
                    } else {
                        self.registerFailure()
                        self.scheduleRetryIfNeeded(upload, completion: finish)
                    }
                }
            }
        }
        finished.wait()
    }

    /// Blocks the calling thread until all in-flight upload chains complete, or
    /// until `timeout` seconds elapse. Called by TelemetryPipeline during shutdown
    /// to ensure frames are delivered before the background task ends.
    func waitForPendingUploads(timeout: TimeInterval = 25.0) {
        // Drain synchronously only as far as queue submission. Network work is
        // still bounded and asynchronous on the utility workers.
        drainRetryQueue()
        _ = _uploadGroup.wait(timeout: .now() + timeout)
    }

    private func scheduleRetryIfNeeded(_ upload: PendingUpload, completion: ((Bool) -> Void)?) {
        if upload.attempt < 3 {
            var retry = upload
            retry.attempt += 1
            let persisted = persistUpload(retry)
            var evicted: PendingUpload?
            retryLock.lock()
            if retryQueue.count >= maxRetryQueueSize {
                evicted = retryQueue.removeFirst()
            }
            retryQueue.append(retry)
            retryLock.unlock()

            if let evicted {
                removePersistedUpload(evicted)
                metricsLock.lock()
                memoryEvictionCount += 1
                totalBytesEvicted += Int64(evicted.payload.count)
                metricsLock.unlock()
            }

            metricsLock.lock()
            retryAttemptCount += 1
            if persisted { offlinePersistCount += 1 }
            lastRetryTime = Self.nowMs()
            metricsLock.unlock()
            // Once accepted by the retry queue, the caller must not retain a
            // second in-memory copy of the same payload. Persistence failures
            // still leave this bounded in-memory copy available for the next drain.
            completion?(true)
            return
        }
        removePersistedUpload(upload)
        completion?(false)
    }

    private func deferUploadWithoutAttempt(_ upload: PendingUpload, completion: ((Bool) -> Void)?) {
        _ = persistUpload(upload)
        var evicted: PendingUpload?
        retryLock.lock()
        let alreadyQueued = retryQueue.contains { $0.persistenceKey == upload.persistenceKey }
        if !alreadyQueued {
            if retryQueue.count >= maxRetryQueueSize {
                evicted = retryQueue.removeFirst()
            }
            retryQueue.append(upload)
        }
        retryLock.unlock()

        if let evicted {
            removePersistedUpload(evicted)
            metricsLock.lock()
            memoryEvictionCount += 1
            totalBytesEvicted += Int64(evicted.payload.count)
            metricsLock.unlock()
        }

        // No retry metric is incremented here: the breaker prevented a network
        // attempt, and the item's attempt number intentionally did not change.
        completion?(true)
    }

    private func drainRetryQueue() {
        retryLock.lock()
        let items = retryQueue
        retryQueue.removeAll()
        retryLock.unlock()
        items.forEach { scheduleUpload($0, completion: nil) }
    }

    private static func makeRetryDirectory() -> URL? {
        let manager = FileManager.default
        guard let base = manager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        let directory = base.appendingPathComponent("Rejourney/UploadRetry", isDirectory: true)
        do {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var mutableDirectory = directory
            try? mutableDirectory.setResourceValues(values)
            return directory
        } catch {
            DiagnosticLog.caution("[SegmentDispatcher] Could not create upload retry directory: \(error.localizedDescription)")
            return nil
        }
    }

    @discardableResult
    private func persistUpload(_ upload: PendingUpload) -> Bool {
        guard let directory = retryDirectoryURL else { return false }
        let target = directory.appendingPathComponent("\(upload.persistenceKey).plist")
        do {
            let encoder = PropertyListEncoder()
            encoder.outputFormat = .binary
            try encoder.encode(upload).write(to: target, options: .atomic)
            try? FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: target.path
            )
            let size = Int64(
                (try? target.resourceValues(forKeys: [.fileSizeKey]).fileSize)
                    ?? upload.payload.count
            )
            persistenceLock.lock()
            persistedUploadKeys.insert(upload.persistenceKey)
            let previousSize = persistedUploadSizes.updateValue(size, forKey: upload.persistenceKey) ?? 0
            persistedUploadBytes = max(0, persistedUploadBytes - previousSize + size)
            let needsTrim = persistedUploadKeys.count > maxRetryQueueSize
                || persistedUploadBytes > maxPersistedRetryBytes
            persistenceLock.unlock()
            // Directory enumeration is relatively expensive on mobile flash.
            // Only perform it when the known durable set crosses its bound,
            // rather than for every successful online upload.
            if needsTrim { trimPersistedRetries(in: directory) }
            return true
        } catch {
            DiagnosticLog.caution("[SegmentDispatcher] Could not persist upload retry: \(error.localizedDescription)")
            return false
        }
    }

    private func removePersistedUpload(_ upload: PendingUpload) {
        guard let directory = retryDirectoryURL else { return }
        let target = directory.appendingPathComponent("\(upload.persistenceKey).plist")
        let fallbackSize = Int64(
            (try? target.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        )
        try? FileManager.default.removeItem(at: target)
        persistenceLock.lock()
        persistedUploadKeys.remove(upload.persistenceKey)
        let removedSize = persistedUploadSizes.removeValue(forKey: upload.persistenceKey) ?? fallbackSize
        persistedUploadBytes = max(0, persistedUploadBytes - removedSize)
        persistenceLock.unlock()
    }

    private func loadPersistedRetries() {
        guard let directory = retryDirectoryURL,
              let urls = try? FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.contentModificationDateKey],
                options: [.skipsHiddenFiles]
              ) else { return }
        let decoder = PropertyListDecoder()
        let decoded = urls.compactMap { url -> (PendingUpload, Date, Int64)? in
            guard url.pathExtension == "plist",
                  let data = try? Data(contentsOf: url),
                  let upload = try? decoder.decode(PendingUpload.self, from: data) else {
                try? FileManager.default.removeItem(at: url)
                return nil
            }
            let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let size = Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? data.count)
            return (upload, date, size)
        }
        let uploads = decoded.sorted { $0.1 < $1.1 }
        let retained = Array(uploads.suffix(maxRetryQueueSize))
        retryQueue = retained.map(\.0)
        persistenceLock.lock()
        persistedUploadKeys = Set(retryQueue.map(\.persistenceKey))
        persistedUploadSizes = Dictionary(uniqueKeysWithValues: retained.map { ($0.0.persistenceKey, $0.2) })
        persistedUploadBytes = retained.reduce(0) { $0 + $1.2 }
        let exceedsByteLimit = persistedUploadBytes > maxPersistedRetryBytes
        persistenceLock.unlock()
        if uploads.count > maxRetryQueueSize || exceedsByteLimit {
            trimPersistedRetries(in: directory)
            persistenceLock.lock()
            let retainedKeys = persistedUploadKeys
            persistenceLock.unlock()
            retryLock.lock()
            retryQueue.removeAll { !retainedKeys.contains($0.persistenceKey) }
            retryLock.unlock()
        }
    }

    private func trimPersistedRetries(in directory: URL) {
        guard var urls = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        urls = urls.filter { $0.pathExtension == "plist" }
        urls.sort {
            let lhs = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let rhs = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return lhs < rhs
        }
        var retainedCount = urls.count
        var retainedBytes = urls.reduce(Int64(0)) { partial, url in
            partial + Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
        var removedKeys: Set<String> = []
        for url in urls {
            if retainedCount <= maxRetryQueueSize && retainedBytes <= maxPersistedRetryBytes { break }
            let size = Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
            try? FileManager.default.removeItem(at: url)
            let key = url.deletingPathExtension().lastPathComponent
            removedKeys.insert(key)
            persistenceLock.lock()
            persistedUploadKeys.remove(key)
            persistedUploadSizes.removeValue(forKey: key)
            persistenceLock.unlock()
            retainedCount -= 1
            retainedBytes = max(0, retainedBytes - size)
        }
        persistenceLock.lock()
        persistedUploadBytes = retainedBytes
        persistenceLock.unlock()
        if !removedKeys.isEmpty {
            retryLock.lock()
            let evicted = retryQueue.filter { removedKeys.contains($0.persistenceKey) }
            retryQueue.removeAll { removedKeys.contains($0.persistenceKey) }
            retryLock.unlock()
            if !evicted.isEmpty {
                metricsLock.lock()
                memoryEvictionCount += evicted.count
                totalBytesEvicted += evicted.reduce(0) { $0 + Int64($1.payload.count) }
                metricsLock.unlock()
            }
        }
    }

    private func requestPresignedUrl(upload: PendingUpload, completion: @escaping (PresignResponse?) -> Void) {
        let urlPath = upload.contentType == "events" ? "/api/ingest/presign" : "/api/ingest/segment/presign"

        guard let url = URL(string: "\(endpoint)\(urlPath)") else {
            completion(nil)
            return
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAuthHeaders(&req, sessionId: upload.sessionId)

        var body: [String: Any] = [
            "sessionId": upload.sessionId,
            "sizeBytes": upload.payload.count,
            "sdkVersion": RejourneySDKInfo.version,
            "isSampledIn": upload.isSampledIn
        ]

        if upload.contentType == "events" {
            body["contentType"] = "events"
            body["batchNumber"] = upload.batchNumber
        } else {
            body["kind"] = upload.contentType
            body["startTime"] = upload.rangeStart
            body["endTime"] = upload.rangeEnd
            body["frameCount"] = upload.itemCount
            body["compression"] = "gzip"
        }

        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            completion(nil)
            return
        }

        httpSession.dataTask(with: req) { [weak self] data, resp, _ in
            guard let httpResp = resp as? HTTPURLResponse else {
                completion(nil)
                return
            }

            if httpResp.statusCode == 402 {
                if let self {
                    self.withState { self.billingBlocked = true }
                }
                completion(nil)
                return
            }

            guard httpResp.statusCode == 200,
                  let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                completion(nil)
                return
            }

            if json["skipUpload"] as? Bool == true {
                completion(PresignResponse(presignedUrl: "", batchId: "", skipUpload: true))
                return
            }

            guard let presignedUrl = json["presignedUrl"] as? String else {
                completion(nil)
                return
            }

            let batchId = json["batchId"] as? String ?? json["segmentId"] as? String ?? ""

            completion(PresignResponse(presignedUrl: presignedUrl, batchId: batchId, skipUpload: false))
        }.resume()
    }

    private func uploadToS3(url: String, payload: Data, completion: @escaping (Bool) -> Void) {
        RejourneyNetworkEventFilter.registerInternalURL(urlString: url)
        guard let uploadUrl = URL(string: url) else {
            completion(false)
            return
        }

        var req = URLRequest(url: uploadUrl)
        req.httpMethod = "PUT"

        req.setValue("application/gzip", forHTTPHeaderField: "Content-Type")

        req.httpBody = payload
        let startMs = Date().timeIntervalSince1970 * 1000

        httpSession.dataTask(with: req) { _, resp, _ in
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let succeeded = status >= 200 && status < 300
            let durationMs = (Date().timeIntervalSince1970 * 1000) - startMs

            self.metricsLock.lock()
            self.uploadDurationSampleCount += 1
            self.totalUploadDurationMs += durationMs
            if succeeded {
                self.totalBytesUploaded += Int64(payload.count)
            }
            self.metricsLock.unlock()

            completion(succeeded)
        }.resume()
    }

    private func confirmBatchComplete(batchId: String, upload: PendingUpload, completion: @escaping (Bool) -> Void) {
        let urlPath = upload.contentType == "events" ? "/api/ingest/batch/complete" : "/api/ingest/segment/complete"

        guard let url = URL(string: "\(endpoint)\(urlPath)") else {
            completion(false)
            return
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAuthHeaders(&req, sessionId: upload.sessionId)

        var body: [String: Any] = [
            "actualSizeBytes": upload.payload.count,
            "timestamp": Date().timeIntervalSince1970 * 1000
        ]
        body["sdkTelemetry"] = sdkTelemetrySnapshot(currentQueueDepth: 0)

        if upload.contentType == "events" {
            body["batchId"] = batchId
            body["eventCount"] = upload.itemCount
        } else {
            body["segmentId"] = batchId
            body["frameCount"] = upload.itemCount
        }

        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            completion(false)
            return
        }

        httpSession.dataTask(with: req) { _, resp, _ in
            completion((resp as? HTTPURLResponse)?.statusCode == 200)
        }.resume()
    }

    private func applyAuthHeaders(_ req: inout URLRequest, sessionId: String? = nil) {
        if let t = apiToken {
            req.setValue(t, forHTTPHeaderField: "x-rejourney-key")
        }
        if let c = credential {
            req.setValue(c, forHTTPHeaderField: "x-upload-token")
        }
        if let sid = sessionId ?? currentReplayId {
            req.setValue(sid, forHTTPHeaderField: "x-session-id")
        }
        if !collectGeoLocation {
            req.setValue("1", forHTTPHeaderField: "x-rj-no-geo")
        }
        if observeOnly {
            req.setValue("1", forHTTPHeaderField: "x-rj-observe-only")
        }
    }

    private func ingestFinalizeMetrics(_ metrics: [String: Any]?) {
        guard let crashes = (metrics?["crashCount"] as? NSNumber)?.intValue else { return }
        metricsLock.lock()
        crashCount = max(crashCount, crashes)
        metricsLock.unlock()
    }

    func sdkTelemetrySnapshot(currentQueueDepth: Int = 0) -> [String: Any] {
        retryLock.lock()
        let retryDepth = retryQueue.count
        retryLock.unlock()

        metricsLock.lock()
        let successCount = uploadSuccessCount
        let failureCount = uploadFailureCount
        let retryCount = retryAttemptCount
        let breakerCount = circuitBreakerOpenCount
        let memoryEvictions = memoryEvictionCount
        let offlinePersists = offlinePersistCount
        let starts = sessionStartCount
        let crashes = crashCount
        let uploadedBytes = totalBytesUploaded
        let evictedBytes = totalBytesEvicted
        let avgUploadDurationMs = uploadDurationSampleCount > 0
            ? totalUploadDurationMs / Double(uploadDurationSampleCount)
            : 0
        let uploadTs = lastUploadTime
        let retryTs = lastRetryTime
        metricsLock.unlock()

        let totalUploads = successCount + failureCount
        let successRate = totalUploads > 0 ? Double(successCount) / Double(totalUploads) : 1.0

        return [
            "uploadSuccessCount": successCount,
            "uploadFailureCount": failureCount,
            "retryAttemptCount": retryCount,
            "circuitBreakerOpenCount": breakerCount,
            "memoryEvictionCount": memoryEvictions,
            "offlinePersistCount": offlinePersists,
            "sessionStartCount": starts,
            "crashCount": crashes,
            "uploadSuccessRate": successRate,
            "avgUploadDurationMs": avgUploadDurationMs,
            "currentQueueDepth": currentQueueDepth + retryDepth,
            "lastUploadTime": uploadTs.map { NSNumber(value: $0) } ?? NSNull(),
            "lastRetryTime": retryTs.map { NSNumber(value: $0) } ?? NSNull(),
            "totalBytesUploaded": uploadedBytes,
            "totalBytesEvicted": evictedBytes
        ]
    }

    private func resetSessionTelemetry() {
        metricsLock.lock()
        uploadSuccessCount = 0
        uploadFailureCount = 0
        retryAttemptCount = 0
        circuitBreakerOpenCount = 0
        memoryEvictionCount = 0
        offlinePersistCount = 0
        sessionStartCount = 1
        crashCount = 0
        totalBytesUploaded = 0
        totalBytesEvicted = 0
        totalUploadDurationMs = 0
        uploadDurationSampleCount = 0
        lastUploadTime = nil
        lastRetryTime = nil
        metricsLock.unlock()
    }

#if DEBUG
    /// Test-only cleanup for the singleton's durable and in-memory retry state.
    func resetRetryStateForTesting() {
        workerQueue.waitUntilAllOperationsAreFinished()
        retryLock.lock()
        retryQueue.removeAll()
        retryLock.unlock()
        if let retryDirectoryURL,
           let urls = try? FileManager.default.contentsOfDirectory(
               at: retryDirectoryURL,
               includingPropertiesForKeys: nil
           ) {
            for url in urls where url.pathExtension == "plist" {
                try? FileManager.default.removeItem(at: url)
            }
        }
        persistenceLock.lock()
        persistedUploadKeys.removeAll()
        persistedUploadSizes.removeAll()
        persistedUploadBytes = 0
        persistenceLock.unlock()
        withState {
            consecutiveFailures = 0
            circuitOpen = false
            circuitOpenTime = 0
            billingBlocked = false
            active = true
        }
        resetSessionTelemetry()
    }
#endif

    private static func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}

private struct PendingUpload: Codable {
    let persistenceKey: String
    let sessionId: String
    let contentType: String
    let payload: Data
    let rangeStart: UInt64
    let rangeEnd: UInt64
    let itemCount: Int
    var attempt: Int
    let batchNumber: Int
    let isSampledIn: Bool

    init(
        persistenceKey: String = UUID().uuidString,
        sessionId: String,
        contentType: String,
        payload: Data,
        rangeStart: UInt64,
        rangeEnd: UInt64,
        itemCount: Int,
        attempt: Int,
        batchNumber: Int,
        isSampledIn: Bool
    ) {
        self.persistenceKey = persistenceKey
        self.sessionId = sessionId
        self.contentType = contentType
        self.payload = payload
        self.rangeStart = rangeStart
        self.rangeEnd = rangeEnd
        self.itemCount = itemCount
        self.attempt = attempt
        self.batchNumber = batchNumber
        self.isSampledIn = isSampledIn
    }
}

private struct PresignResponse {
    let presignedUrl: String
    let batchId: String
    let skipUpload: Bool
}
