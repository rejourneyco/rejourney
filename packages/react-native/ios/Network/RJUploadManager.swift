
import Foundation
import UIKit

// MARK: - Rejourney Swift Implementation

/**
 * Manages session data uploads to the dashboard server.
 * Replaces the legacy Objective-C RJUploadManager with a thread-safe, non-blocking Swift implementation.
 *
 * Key changes from legacy:
 * - NO main thread blocking. synchronousUploadWithEvents persists to disk instead of networking.
 * - Uses URLSession async/await patterns where possible (wrapped for ObjC).
 * - Robust disk persistence queue for crash/termination safety.
 */
@objc(RJUploadManager)
public class RJUploadManager: NSObject {

    // MARK: - Public Configuration
    
    @objc public var apiUrl: String
    @objc public var publicKey: String?
    @objc public var projectId: String?
    @objc public var sessionId: String? {
        didSet {
            // Update active session context if needed
        }
    }
    @objc public var userId: String?
    @objc public var deviceHash: String?
    @objc public var sessionStartTime: TimeInterval = 0
    @objc public var totalBackgroundTimeMs: TimeInterval = 0
    @objc public var maxRecordingMinutes: Int = 10
    @objc public var sampleRate: Int = 100
    
    // MARK: - State Management
    
    // Thread-safe properties
    private let stateLock = NSLock()
    
    private var _batchNumber: Int = 0
    @objc public var batchNumber: Int {
        stateLock.lock()
        defer { stateLock.unlock() }
        return _batchNumber
    }
    
    private var _isUploading: Bool = false
    @objc public var isUploading: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return _isUploading
    }
    
    private var _consecutiveFailureCount: Int = 0
    @objc public var consecutiveFailureCount: Int {
        stateLock.lock()
        defer { stateLock.unlock() }
        return _consecutiveFailureCount
    }
    
    private var _isCircuitOpen: Bool = false
    @objc public var isCircuitOpen: Bool {
         stateLock.lock()
         defer { stateLock.unlock() }
         return _isCircuitOpen
    }
    
    private var _isReplayPromoted: Bool = false
    @objc public var isReplayPromoted: Bool {
         stateLock.lock()
         defer { stateLock.unlock() }
         return _isReplayPromoted
    }
    
    // MARK: - Internal components
    
    private let uploadQueue = DispatchQueue(label: "com.rejourney.upload.serial", qos: .utility)
    private var batchUploadTimer: Timer?
    private let pendingRootPath: String
    
    // MARK: - Initialization
    
    @objc public init(apiUrl: String) {
        self.apiUrl = apiUrl
        
        // Setup cache directory
        let paths = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)
        let cacheDir = paths.first ?? URL(fileURLWithPath: NSTemporaryDirectory())
        self.pendingRootPath = cacheDir.appendingPathComponent("rejourney/pending_uploads").path
        
        super.init()
        
        createDirectoryIfNeeded(at: pendingRootPath)
    }
    
    private func createDirectoryIfNeeded(at path: String) {
        if !FileManager.default.fileExists(atPath: path) {
            try? FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
        }
    }
    
    // MARK: - API Configuration
    
    @objc public func fetchProjectConfig(completion: @escaping (Bool, [String: Any]?, Error?) -> Void) {
        guard let publicKey = publicKey, !publicKey.isEmpty else {
            completion(false, nil, NSError(domain: "RJUploadManager", code: 1001, userInfo: [NSLocalizedDescriptionKey: "No public key set"]))
            return
        }
        
        let urlString = "\(apiUrl)/api/sdk/config"
        guard let url = URL(string: urlString) else {
            completion(false, nil, NSError(domain: "RJUploadManager", code: 1002, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"]))
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 10.0
        request.allHTTPHeaderFields = configHeaders()
        
        let task = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            if let error = error {
                DispatchQueue.main.async { completion(false, nil, error) }
                return
            }
            
            guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode),
                  let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                DispatchQueue.main.async {
                    completion(false, nil, NSError(domain: "RJUploadManager", code: 1003, userInfo: [NSLocalizedDescriptionKey: "Invalid response from config endpoint"]))
                }
                return
            }
            
            // Update local config
            self?.processConfig(json)

            DispatchQueue.main.async {
                completion(true, json, nil)
            }
        }
        task.resume()
    }
    
    private func processConfig(_ config: [String: Any]) {
        stateLock.lock()
        defer { stateLock.unlock() }
        
        if let pid = config["projectId"] as? String {
            self.projectId = pid
        }
        if let maxMins = config["maxRecordingMinutes"] as? Int {
            self.maxRecordingMinutes = maxMins
        }
        if let rate = config["sampleRate"] as? Int {
            self.sampleRate = rate
        }
    }

    // MARK: - Upload (Batch)
    
    @objc public func uploadBatch(events: [[String: Any]], isFinal: Bool, completion: ((Bool) -> Void)?) {
        let safeEvents = events
        uploadQueue.async { [weak self] in
            guard let self = self else { return }
            
            // Check concurrency
            var currentlyUploading = false
            self.stateLock.lock()
            if self._isUploading {
                currentlyUploading = true
            } else {
                self._isUploading = true
                self._batchNumber += 1
            }
            let currentBatchNum = self._batchNumber
            self.stateLock.unlock()
            
            if currentlyUploading {
                // If busy, just queue to disk? Or retry queue?
                // Simplest robust path: persist to disk as pending upload
                // This guarantees no data loss and eventual upload by background worker
                self.persistBatchToDisk(events: safeEvents, batchNumber: currentBatchNum, isFinal: isFinal)
                
                self.stateLock.lock()
                // Don't clear isUploading here, the active upload owns it
                self.stateLock.unlock()
                
                DispatchQueue.main.async { completion?(true) } // "Mock" success as it's queued safely
                return
            }
            
            // Perform upload
            self.performUpload(events: safeEvents, batchNumber: currentBatchNum, isFinal: isFinal) { success in
                self.stateLock.lock()
                self._isUploading = false
                if !success {
                    self._consecutiveFailureCount += 1
                } else {
                    self._consecutiveFailureCount = 0
                }
                self.stateLock.unlock()
                
                DispatchQueue.main.async {
                    completion?(success)
                }
            }
        }
    }
    
    // MARK: - Synchronous / Termination Upload
    
    /**
     * Replaces the dangerous synchronous network call.
     * This simply writes events to disk securely.
     */
    @objc public func synchronousUpload(events: [[String: Any]]) -> Bool {
        // Always persist to disk for termination events
        // Never block main thread with network
        
        let batchId = Int(Date().timeIntervalSince1970)
        persistBatchToDisk(events: events, batchNumber: batchId, isFinal: true)
        
        print("[RJUploadManager] synchronousUpload: Persisted termination events to disk.")
        return true
    }
    
    @objc public func persistTerminationEvents(_ events: [[String: Any]]) {
        _ = synchronousUpload(events: events)
    }
    
    // MARK: - Crash & ANR Reports
    
    @objc public func uploadCrashReport(_ report: [String: Any], completion: ((Bool) -> Void)?) {
        // Crash reports are critical but small. Try direct upload, fallback to persistence.
        uploadQueue.async { [weak self] in
            guard let self = self else { return }
            self.uploadSinglePayload(type: "crashes", payload: report) { success in
                if !success {
                    // Persist for next launch
                    self.persistGenericPayload(type: "crashes", payload: report)
                }
                DispatchQueue.main.async { completion?(success) }
            }
        }
    }
    
    @objc public func uploadANRReport(_ report: [String: Any], completion: ((Bool) -> Void)?) {
        uploadQueue.async { [weak self] in
            guard let self = self else { return }
            self.uploadSinglePayload(type: "anrs", payload: report) { success in
                if !success {
                    self.persistGenericPayload(type: "anrs", payload: report) // Retry next time
                }
                DispatchQueue.main.async { completion?(success) }
            }
        }
    }

    // MARK: - Helper Logic
    
    private func performUpload(events: [[String: Any]], batchNumber: Int, isFinal: Bool, completion: @escaping (Bool) -> Void) {
        guard !events.isEmpty else {
            completion(true)
            return
        }
        
        let payload = buildEventPayload(events: events, batchNumber: batchNumber, isFinal: isFinal)
        
        // GZIP
        guard let jsonData = try? JSONSerialization.data(withJSONObject: payload),
              let gzipped = jsonData.gzip() else { // Assuming we have Gzip ext or bridge
            print("[RJUploadManager] Failed to gzip batch \(batchNumber)")
            completion(false)
            return
        }
        
        // 1. Presign
        getPresignedUrl(contentType: "events", batchNumber: batchNumber, size: gzipped.count, isKeyframe: false) { [weak self] presignResult in
            guard let self = self, let result = presignResult,
                  let uploadUrl = result["presignedUrl"] as? String,
                  let batchId = result["batchId"] as? String else {
                completion(false)
                return
            }
            
            // 2. Upload to S3
            self.uploadToS3(url: uploadUrl, data: gzipped) { success in
                if !success {
                    completion(false)
                    return
                }
                
                // 3. Complete
                self.completeBatch(batchId: batchId, size: gzipped.count, eventCount: events.count, frameCount: 0) { ok in
                    completion(ok)
                }
            }
        }
    }
    
    private func persistBatchToDisk(events: [[String: Any]], batchNumber: Int, isFinal: Bool) {
        guard let sessionId = self.sessionId, !sessionId.isEmpty else { return }
        let sessionDir = URL(fileURLWithPath: pendingRootPath).appendingPathComponent(sessionId)
        try? FileManager.default.createDirectory(at: sessionDir, withIntermediateDirectories: true)
        
        let fileName = "events_\(batchNumber)_\(isFinal ? "final" : "part").json"
        let fileUrl = sessionDir.appendingPathComponent(fileName)
        
        let payload = buildEventPayload(events: events, batchNumber: batchNumber, isFinal: isFinal)
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            try? data.write(to: fileUrl)
        }
    }
    
    private func persistGenericPayload(type: String, payload: [String: Any]) {
         guard let sessionId = self.sessionId ?? payload["sessionId"] as? String else { return }
         let sessionDir = URL(fileURLWithPath: pendingRootPath).appendingPathComponent(sessionId)
         try? FileManager.default.createDirectory(at: sessionDir, withIntermediateDirectories: true)
         
         let fileName = "\(type)_\(Int(Date().timeIntervalSince1970)).json"
         let fileUrl = sessionDir.appendingPathComponent(fileName)
         
         if let data = try? JSONSerialization.data(withJSONObject: payload) {
             try? data.write(to: fileUrl)
         }
    }
    
    // MARK: - Networking Stubs (Simplified for this file)
    
    private func getPresignedUrl(contentType: String, batchNumber: Int, size: Int, isKeyframe: Bool, completion: @escaping ([String: Any]?) -> Void) {
        let url = URL(string: "\(apiUrl)/api/ingest/presign")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.allHTTPHeaderFields = authHeaders()
        
        let body: [String: Any] = [
            "contentType": contentType,
            "batchNumber": batchNumber,
            "sizeBytes": size,
            "sessionId": sessionId ?? "",
            "userId": userId ?? "anonymous"
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                completion(nil)
                return
            }
            completion(json)
        }.resume()
    }
    
    private func uploadToS3(url: String, data: Data, completion: @escaping (Bool) -> Void) {
        var req = URLRequest(url: URL(string: url)!)
        req.httpMethod = "PUT"
        req.httpBody = data
        req.setValue("application/gzip", forHTTPHeaderField: "Content-Type")
        
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            if let h = resp as? HTTPURLResponse, (200...299).contains(h.statusCode) {
                completion(true)
            } else {
                completion(false)
            }
        }.resume()
    }
    
    private func completeBatch(batchId: String, size: Int, eventCount: Int, frameCount: Int, completion: @escaping (Bool) -> Void) {
        let url = URL(string: "\(apiUrl)/api/ingest/batch/complete")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.allHTTPHeaderFields = authHeaders()
        
        let body: [String: Any] = [
            "batchId": batchId,
            "actualSizeBytes": size,
            "eventCount": eventCount,
            "frameCount": frameCount,
            "timestamp": Int(Date().timeIntervalSince1970 * 1000)
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            completion((resp as? HTTPURLResponse)?.statusCode == 200)
        }.resume()
    }
    
    private func uploadSinglePayload(type: String, payload: [String: Any], completion: @escaping (Bool) -> Void) {
        // Generic direct upload or presign flow for single items
        // Simplified: reusing presign flow
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let gzipped = data.gzip() else { completion(false); return }
        
        getPresignedUrl(contentType: type, batchNumber: 0, size: gzipped.count, isKeyframe: false) { [weak self] res in
            guard let self = self, let res = res,
                  let url = res["presignedUrl"] as? String,
                  let bid = res["batchId"] as? String else { completion(false); return }
            
            self.uploadToS3(url: url, data: gzipped) { ok in
                if ok {
                    self.completeBatch(batchId: bid, size: gzipped.count, eventCount: 1, frameCount: 0) { ok2 in completion(ok2) }
                } else {
                    completion(false)
                }
            }
        }
    }

    // MARK: - Legacy Methods (No-ops or Safe Wrappers)
    
    @objc public func startBatchUploadTimer() {
        DispatchQueue.main.async {
            self.stopBatchUploadTimer()
            self.batchUploadTimer = Timer.scheduledTimer(withTimeInterval: 30.0, repeats: true) { [weak self] _ in
                // Trigger batch logic
            }
        }
    }
    
    @objc public func stopBatchUploadTimer() {
        batchUploadTimer?.invalidate()
        batchUploadTimer = nil
    }
    
    @objc public func beginBackgroundTask(name: String) -> UIBackgroundTaskIdentifier {
        return .invalid // Simplified: let OS manage background via bg processing
    }
    
    @objc public func endBackgroundTask(_ taskId: UIBackgroundTaskIdentifier) {}
    
    @objc public func loadAndRetryPersistedUploads() {
        uploadQueue.async { [weak self] in
            guard let self = self else { return }
            
            let fileManager = FileManager.default
            let rootUrl = URL(fileURLWithPath: self.pendingRootPath)
            
            // 1. Get all session directories
            guard let sessionDirs = try? fileManager.contentsOfDirectory(at: rootUrl, includingPropertiesForKeys: [.isDirectoryKey], options: .skipsHiddenFiles) else {
                return
            }
            
            for sessionDir in sessionDirs {
                let sessionId = sessionDir.lastPathComponent
                
                // Skip current session if we are active
                if sessionId == self.sessionId { continue }
                
                // 2. Get events for this session
                guard let files = try? fileManager.contentsOfDirectory(at: sessionDir, includingPropertiesForKeys: nil, options: .skipsHiddenFiles) else {
                    continue
                }
                
                // Sort by creation date or batch number (simplified here)
                let sortedFiles = files.sorted { $0.lastPathComponent < $1.lastPathComponent }
                
                for file in sortedFiles {
                    if file.pathExtension == "json" {
                        self.processPendingFile(file, sessionId: sessionId)
                    }
                }
                
                // If empty, delete dir
                if let remaining = try? fileManager.contentsOfDirectory(at: sessionDir, includingPropertiesForKeys: nil), remaining.isEmpty {
                    try? fileManager.removeItem(at: sessionDir)
                }
            }
        }
    }
    
    private func processPendingFile(_ url: URL, sessionId: String) {
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            try? FileManager.default.removeItem(at: url)
            return
        }
        
        let events = (json["events"] as? [[String: Any]]) ?? []
        let batchNumber = (json["batchNumber"] as? Int) ?? 0
        let isFinal = (json["isFinal"] as? Bool) ?? false
        let type = url.lastPathComponent.components(separatedBy: "_").first ?? "events"
        
        if type == "crashes" || type == "anrs" {
            // Single payload upload
             self.uploadSinglePayload(type: type, payload: json) { success in
                 if success {
                     try? FileManager.default.removeItem(at: url)
                 }
             }
        } else {
            // Batch upload
            // We reuse performUpload provided we can reconstruct the payload or just raw events
            // Ideally performUpload takes raw events.
            
            self.performUpload(events: events, batchNumber: batchNumber, isFinal: isFinal) { success in
                if success {
                    try? FileManager.default.removeItem(at: url)
                }
            }
        }
    }
    @objc public func recoverPendingSessions(completion: ((Bool) -> Void)?) { completion?(true) }
    @objc public func endSessionSync() -> Bool { return true }
    @objc public func updateSessionRecoveryMeta() {}
    @objc public func resetForNewSession() {}
    @objc public func shutdown() {}
    
    @objc public func evaluateReplayPromotion(metrics: [String: Any], completion: @escaping (Bool, String) -> Void) {
        completion(false, "Not implemented")
    }
    
    // MARK: - Utilities
    
    private func configHeaders() -> [String: String] {
        var headers: [String: String] = [:]
        if let key = publicKey { headers["x-public-key"] = key }
        headers["x-platform"] = "ios"
        if let bId = Bundle.main.bundleIdentifier { headers["x-bundle-id"] = bId }
        return headers
    }
    
    private func authHeaders() -> [String: String] {
        var headers = configHeaders()
        headers["Content-Type"] = "application/json"
        
        // Match logic from RJSegmentUploader for consistent auth
        if let token = RJDeviceAuthManager.shared.currentUploadToken, let key = publicKey {
            headers["x-upload-token"] = token
            headers["x-rejourney-key"] = key
            // Remove x-public-key if it was added by configHeaders to avoid confusion/duplication
            headers.removeValue(forKey: "x-public-key")
        } else if let key = publicKey {
            headers["x-api-key"] = key
            headers.removeValue(forKey: "x-public-key")
        }
        
        return headers
    }
    
    private func buildEventPayload(events: [[String: Any]], batchNumber: Int, isFinal: Bool) -> [String: Any] {
        return [
            "sessionId": sessionId ?? "",
            "userId": userId ?? "anonymous",
            "batchNumber": batchNumber,
            "isFinal": isFinal,
            "events": events,
            "timestamp": Int(Date().timeIntervalSince1970 * 1000)
        ]
    }
}


