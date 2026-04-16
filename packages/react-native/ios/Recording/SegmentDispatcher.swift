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
    
    var endpoint: String = "https://api.rejourney.co"
    var currentReplayId: String?
    var apiToken: String?
    var credential: String?
    var projectId: String?
    var isSampledIn: Bool = true  // SDK's sampling decision for server-side enforcement
    /** When false, the backend is instructed to skip IP geolocation lookup for this session */
    var collectGeoLocation: Bool = true
    /** When true, signals the backend that no visual artifacts will ever arrive for this session */
    var observeOnly: Bool = false
    
    private var batchSeqNumber = 0
    private var billingBlocked = false
    private var consecutiveFailures = 0
    private var circuitOpen = false
    private var circuitOpenTime: TimeInterval = 0
    private let circuitBreakerThreshold = 5
    private let circuitResetTime: TimeInterval = 60
    
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
        cfg.waitsForConnectivity = true
        cfg.timeoutIntervalForRequest = 30
        cfg.timeoutIntervalForResource = 60
        // Strip our own protocol to prevent self-interception. Without this,
        // every SDK upload is intercepted by RejourneyURLProtocol which
        // generates redundant network events and wastes resources.
        cfg.protocolClasses = cfg.protocolClasses?.filter { $0 != RejourneyURLProtocol.self } ?? []
        return URLSession(configuration: cfg)
    }()
    
    private var retryQueue: [PendingUpload] = []
    private let retryLock = NSLock()
    private let maxRetryQueueSize = 20
    private var active = true

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
    
    private init() {}
    
    func configure(replayId: String, apiToken: String?, credential: String?, projectId: String?, isSampledIn: Bool = true) {
        currentReplayId = replayId
        self.apiToken = apiToken
        self.credential = credential
        self.projectId = projectId
        self.isSampledIn = isSampledIn
        batchSeqNumber = 0
        billingBlocked = false
        consecutiveFailures = 0
        circuitOpen = false
        circuitOpenTime = 0
        active = true
        retryLock.lock()
        let droppedRetries = retryQueue.count
        retryQueue.removeAll()
        retryLock.unlock()
        if droppedRetries > 0 {
            DiagnosticLog.trace("[SegmentDispatcher] Dropped \(droppedRetries) stale retries while configuring session \(replayId.prefix(20))")
        }
        resetSessionTelemetry()
    }
    
    /// Reactivate the dispatcher for a new session
    func activate() {
        active = true
        consecutiveFailures = 0
        circuitOpen = false
    }
    
    func halt() {
        active = false
    }
    
    func shipPending() {
        workerQueue.addOperation { [weak self] in self?.drainRetryQueue() }
        workerQueue.waitUntilAllOperationsAreFinished()
    }
    
    func transmitFrameBundle(payload: Data, startMs: UInt64, endMs: UInt64, frameCount: Int, completion: ((Bool) -> Void)? = nil) {
        transmitFrameBundle(for: currentReplayId, payload: payload, startMs: startMs, endMs: endMs, frameCount: frameCount, completion: completion)
    }

    func transmitFrameBundle(for sessionId: String?, payload: Data, startMs: UInt64, endMs: UInt64, frameCount: Int, completion: ((Bool) -> Void)? = nil) {
        guard let sid = sessionId, canUploadNow() else {
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
            batchNumber: 0
        )
        scheduleUpload(upload, completion: completion)
    }
    
    func transmitHierarchy(replayId: String, hierarchyPayload: Data, timestampMs: UInt64, completion: ((Bool) -> Void)? = nil) {
        guard canUploadNow() else {
            completion?(false)
            return
        }
        
        let upload = PendingUpload(
            sessionId: replayId,
            contentType: "hierarchy",
            payload: hierarchyPayload,
            rangeStart: timestampMs,
            rangeEnd: timestampMs,
            itemCount: 1,
            attempt: 0,
            batchNumber: 0
        )
        scheduleUpload(upload, completion: completion)
    }
    
    func transmitEventBatch(payload: Data, batchNumber: Int, eventCount: Int, completion: ((Bool) -> Void)? = nil) {
        guard let sid = currentReplayId, canUploadNow() else {
            completion?(false)
            return
        }
        
        workerQueue.addOperation { [weak self] in
            self?.executeEventBatchUpload(sessionId: sid, payload: payload, batchNum: batchNumber, eventCount: eventCount, completion: completion)
        }
    }
    
    func transmitEventBatchAlternate(replayId: String, eventPayload: Data, eventCount: Int, completion: ((Bool) -> Void)? = nil) {
        guard canUploadNow() else {
            completion?(false)
            return
        }
        
        batchSeqNumber += 1
        let seq = batchSeqNumber
        
        workerQueue.addOperation { [weak self] in
            self?.executeEventBatchUpload(sessionId: replayId, payload: eventPayload, batchNum: seq, eventCount: eventCount, completion: completion)
        }
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
            "sdkVersion": RejourneyImpl.sdkVersion
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
    
    private func registerFailure() {
        consecutiveFailures += 1
        metricsLock.lock()
        uploadFailureCount += 1
        metricsLock.unlock()
        
        if consecutiveFailures >= circuitBreakerThreshold {
            metricsLock.lock()
            if !circuitOpen {
                circuitBreakerOpenCount += 1
            }
            metricsLock.unlock()
            
            circuitOpen = true
            circuitOpenTime = Date().timeIntervalSince1970
        }
    }
    
    private func registerSuccess() {
        consecutiveFailures = 0
        metricsLock.lock()
        uploadSuccessCount += 1
        lastUploadTime = Self.nowMs()
        metricsLock.unlock()
    }
    
    private func scheduleUpload(_ upload: PendingUpload, completion: ((Bool) -> Void)?) {
        guard active else {
            completion?(false)
            return
        }
        workerQueue.addOperation { [weak self] in
            self?.executeSegmentUpload(upload, completion: completion)
        }
    }
    
    private func executeSegmentUpload(_ upload: PendingUpload, completion: ((Bool) -> Void)?) {
        // Track this upload chain so waitForPendingUploads() can block until completion.
        _uploadGroup.enter()

        guard active else {
            _uploadGroup.leave()
            completion?(false)
            return
        }
        if isUploadForClosedSession(upload.sessionId) {
            DiagnosticLog.trace("[SegmentDispatcher] Dropping stale \(upload.contentType) upload for closed session \(upload.sessionId.prefix(20))")
            _uploadGroup.leave()
            completion?(false)
            return
        }

        requestPresignedUrl(upload: upload) { [weak self] presignResponse in
            guard let self, self.active else {
                self?._uploadGroup.leave()
                completion?(false)
                return
            }

            guard let presign = presignResponse else {
                self.registerFailure()
                self._uploadGroup.leave()
                self.scheduleRetryIfNeeded(upload, completion: completion)
                return
            }

            if presign.skipUpload {
                self.registerSuccess()
                self._uploadGroup.leave()
                completion?(true)
                return
            }

            self.uploadToS3(url: presign.presignedUrl, payload: upload.payload) { s3ok in
                guard s3ok else {
                    self.registerFailure()
                    self._uploadGroup.leave()
                    self.scheduleRetryIfNeeded(upload, completion: completion)
                    return
                }

                self.confirmBatchComplete(batchId: presign.batchId, upload: upload) { confirmOk in
                    if confirmOk {
                        self.registerSuccess()
                    }
                    self._uploadGroup.leave()
                    completion?(confirmOk)
                }
            }
        }
    }

    /// Blocks the calling thread until all in-flight upload chains complete, or
    /// until `timeout` seconds elapse. Called by TelemetryPipeline during shutdown
    /// to ensure frames are delivered before the background task ends.
    func waitForPendingUploads(timeout: TimeInterval = 25.0) {
        _ = _uploadGroup.wait(timeout: .now() + timeout)
    }
    
    private func scheduleRetryIfNeeded(_ upload: PendingUpload, completion: ((Bool) -> Void)?) {
        if isUploadForClosedSession(upload.sessionId) {
            DiagnosticLog.trace("[SegmentDispatcher] Discarding retry for closed session \(upload.sessionId.prefix(20))")
            completion?(false)
            return
        }
        if upload.attempt < 3 {
            var retry = upload
            retry.attempt += 1
            retryLock.lock()
            if retryQueue.count >= maxRetryQueueSize {
                retryQueue.removeFirst()
            }
            retryQueue.append(retry)
            retryLock.unlock()
            
            metricsLock.lock()
            retryAttemptCount += 1
            lastRetryTime = Self.nowMs()
            metricsLock.unlock()
        }
        completion?(false)
    }
    
    private func drainRetryQueue() {
        retryLock.lock()
        let items = retryQueue
        retryQueue.removeAll()
        retryLock.unlock()
        items.forEach { executeSegmentUpload($0, completion: nil) }
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
            "sdkVersion": RejourneyImpl.sdkVersion
        ]
        
        if upload.contentType == "events" {
            body["contentType"] = "events"
            body["batchNumber"] = upload.batchNumber
            body["isSampledIn"] = isSampledIn  // Server-side enforcement
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
                self?.billingBlocked = true
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
    
    private func executeEventBatchUpload(sessionId: String, payload: Data, batchNum: Int, eventCount: Int, completion: ((Bool) -> Void)?) {
        let upload = PendingUpload(
            sessionId: sessionId,
            contentType: "events",
            payload: payload,
            rangeStart: 0,
            rangeEnd: 0,
            itemCount: eventCount,
            attempt: 0,
            batchNumber: batchNum
        )
        if isUploadForClosedSession(upload.sessionId) {
            DiagnosticLog.trace("[SegmentDispatcher] Dropping stale events upload for closed session \(upload.sessionId.prefix(20))")
            completion?(false)
            return
        }
        
        requestPresignedUrl(upload: upload) { [weak self] presignResponse in
            guard let self, let presign = presignResponse else {
                self?.registerFailure()
                completion?(false)
                return
            }
            
            self.uploadToS3(url: presign.presignedUrl, payload: payload) { s3ok in
                guard s3ok else {
                    self.registerFailure()
                    completion?(false)
                    return
                }
                
                self.confirmBatchComplete(batchId: presign.batchId, upload: upload) { confirmOk in
                    if confirmOk {
                        self.registerSuccess()
                    }
                    completion?(confirmOk)
                }
            }
        }
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

    private func isUploadForClosedSession(_ sessionId: String) -> Bool {
        guard let activeSessionId = currentReplayId, !activeSessionId.isEmpty else {
            return false
        }
        return sessionId != activeSessionId
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
    
    private static func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}

private struct PendingUpload {
    let sessionId: String
    let contentType: String
    let payload: Data
    let rangeStart: UInt64
    let rangeEnd: UInt64
    let itemCount: Int
    var attempt: Int
    let batchNumber: Int
}

private struct PresignResponse {
    let presignedUrl: String
    let batchId: String
    let skipUpload: Bool
}
