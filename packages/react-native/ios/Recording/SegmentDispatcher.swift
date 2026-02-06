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
        // Industry standard: Use ephemeral config with explicit connection limits
        let cfg = URLSessionConfiguration.ephemeral
        cfg.httpMaximumConnectionsPerHost = 4
        cfg.waitsForConnectivity = true
        cfg.timeoutIntervalForRequest = 30
        cfg.timeoutIntervalForResource = 60
        return URLSession(configuration: cfg)
    }()
    
    private var retryQueue: [PendingUpload] = []
    private let retryLock = NSLock()
    private var active = true
    
    private init() {}
    
    func configure(replayId: String, apiToken: String?, credential: String?, projectId: String?) {
        currentReplayId = replayId
        self.apiToken = apiToken
        self.credential = credential
        self.projectId = projectId
        batchSeqNumber = 0
        billingBlocked = false
        consecutiveFailures = 0
    }
    
    /// Reactivate the dispatcher for a new session
    func activate() {
        active = true
        consecutiveFailures = 0
        circuitOpen = false
    }
    
    func halt() {
        active = false
        workerQueue.cancelAllOperations()
    }
    
    func shipPending() {
        workerQueue.addOperation { [weak self] in self?.drainRetryQueue() }
        workerQueue.waitUntilAllOperationsAreFinished()
    }
    
    func transmitFrameBundle(payload: Data, startMs: UInt64, endMs: UInt64, frameCount: Int, completion: ((Bool) -> Void)? = nil) {
        guard let sid = currentReplayId, canUploadNow() else {
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
            attempt: 0
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
            attempt: 0
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
    
    func concludeReplay(replayId: String, concludedAt: UInt64, backgroundDurationMs: UInt64, metrics: [String: Any]?, completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: "\(endpoint)/api/ingest/session/end") else {
            completion(false)
            return
        }
        
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAuthHeaders(&req)
        
        var body: [String: Any] = ["sessionId": replayId, "endedAt": concludedAt]
        if backgroundDurationMs > 0 { body["totalBackgroundTimeMs"] = backgroundDurationMs }
        if let m = metrics { body["metrics"] = m }
        
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
    
    func evaluateReplayRetention(replayId: String, metrics: [String: Any], completion: @escaping (Bool, String) -> Void) {
        guard let url = URL(string: "\(endpoint)/api/ingest/replay/evaluate") else {
            completion(false, "bad_url")
            return
        }
        
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAuthHeaders(&req)
        
        var body: [String: Any] = ["sessionId": replayId]
        metrics.forEach { body[$0.key] = $0.value }
        
        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            completion(false, "serialize_error")
            return
        }
        
        httpSession.dataTask(with: req) { data, resp, _ in
            guard let data, (resp as? HTTPURLResponse)?.statusCode == 200,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                completion(false, "request_failed")
                return
            }
            let retained = json["promoted"] as? Bool ?? false
            let reason = json["reason"] as? String ?? "unknown"
            completion(retained, reason)
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
        if consecutiveFailures >= circuitBreakerThreshold {
            circuitOpen = true
            circuitOpenTime = Date().timeIntervalSince1970
        }
    }
    
    private func registerSuccess() {
        consecutiveFailures = 0
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
        guard active else {
            completion?(false)
            return
        }
        
        requestPresignedUrl(upload: upload) { [weak self] presignResponse in
            guard let self, self.active else {
                completion?(false)
                return
            }
            
            guard let presign = presignResponse else {
                self.registerFailure()
                self.scheduleRetryIfNeeded(upload, completion: completion)
                return
            }
            
            self.uploadToS3(url: presign.presignedUrl, payload: upload.payload, contentType: upload.contentType) { s3ok in
                guard s3ok else {
                    self.registerFailure()
                    self.scheduleRetryIfNeeded(upload, completion: completion)
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
    
    private func scheduleRetryIfNeeded(_ upload: PendingUpload, completion: ((Bool) -> Void)?) {
        if upload.attempt < 3 {
            var retry = upload
            retry.attempt += 1
            retryLock.lock()
            retryQueue.append(retry)
            retryLock.unlock()
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
        applyAuthHeaders(&req)
        
        var body: [String: Any] = [
            "sessionId": upload.sessionId,
            "sizeBytes": upload.payload.count
        ]
        
        if upload.contentType == "events" {
            body["contentType"] = "events"
            body["batchNumber"] = batchSeqNumber
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
                completion(nil)
                return
            }
            
            guard let presignedUrl = json["presignedUrl"] as? String else {
                completion(nil)
                return
            }
            
            let batchId = json["batchId"] as? String ?? json["segmentId"] as? String ?? ""
            
            completion(PresignResponse(presignedUrl: presignedUrl, batchId: batchId))
        }.resume()
    }
    
    private func uploadToS3(url: String, payload: Data, contentType: String, completion: @escaping (Bool) -> Void) {
        guard let uploadUrl = URL(string: url) else {
            completion(false)
            return
        }
        
        var req = URLRequest(url: uploadUrl)
        req.httpMethod = "PUT"
        
        switch contentType {
        case "video": req.setValue("video/mp4", forHTTPHeaderField: "Content-Type")
        default: req.setValue("application/gzip", forHTTPHeaderField: "Content-Type")
        }
        
        req.httpBody = payload
        
        httpSession.dataTask(with: req) { _, resp, _ in
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            completion(status >= 200 && status < 300)
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
        applyAuthHeaders(&req)
        
        var body: [String: Any] = [
            "actualSizeBytes": upload.payload.count,
            "timestamp": Date().timeIntervalSince1970 * 1000
        ]
        
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
            attempt: 0
        )
        
        requestPresignedUrl(upload: upload) { [weak self] presignResponse in
            guard let self, let presign = presignResponse else {
                self?.registerFailure()
                completion?(false)
                return
            }
            
            self.uploadToS3(url: presign.presignedUrl, payload: payload, contentType: "events") { s3ok in
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
    
    private func applyAuthHeaders(_ req: inout URLRequest) {
        if let t = apiToken {
            req.setValue(t, forHTTPHeaderField: "x-rejourney-key")
        }
        if let c = credential {
            req.setValue(c, forHTTPHeaderField: "x-upload-token")
        }
        if let sid = currentReplayId {
            req.setValue(sid, forHTTPHeaderField: "x-session-id")
        }
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
}

private struct PresignResponse {
    let presignedUrl: String
    let batchId: String
}
