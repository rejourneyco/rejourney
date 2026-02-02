import Foundation
import UIKit
import React
import zlib

@objcMembers
public class RJSegmentUploader: NSObject {
    
    // MARK: - Properties
    
    public var baseURL: String
    public var apiKey: String?
    public var projectId: String?
    public var uploadToken: String?
    public var maxRetries: Int = 3
    public var deleteAfterUpload: Bool = true
    
    // Thread-safe counter
    private var _pendingUploadCount = 0
    private let stateLock = NSLock()
    
    public var pendingUploads: Int {
        stateLock.lock()
        defer { stateLock.unlock() }
        return _pendingUploadCount
    }
    
    private let urlSession: URLSession
    
    // MARK: - Initialization
    
    public init(baseURL: String) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 300
        config.waitsForConnectivity = true
        self.urlSession = URLSession(configuration: config)
        super.init()
        self.cleanupOrphanedSegments()
    }
    
    // MARK: - Public API
    
    public func uploadVideoSegment(_ segmentURL: URL, sessionId: String, startTime: TimeInterval, endTime: TimeInterval, frameCount: Int, completion: ((Bool, Error?) -> Void)?) {
        let bgTask = UIApplication.shared.beginBackgroundTask(withName: "RJVideoUpload") { [weak self] in
            RJLogger.logWarningMessage("Background task for video upload expired!")
        }
        
        Task {
            do {
                incrementPending()
                defer {
                    decrementPending()
                    UIApplication.shared.endBackgroundTask(bgTask)
                }
                
                // 1. Pre-read data (Sync)
                // We read immediately to avoid file deletion race conditions during termination
                guard let fileData = try? Data(contentsOf: segmentURL) else {
                    throw NSError(domain: "RJSegmentUploader", code: -1, userInfo: [NSLocalizedDescriptionKey: "File not found: \(segmentURL.path)"])
                }
                
                RJLogger.logInfoMessage("[Swift-Upload] Uploading segment \(segmentURL.lastPathComponent) (\(fileData.count) bytes)")
                
                // 2. Get Presigned URL
                let presign = try await requestPresign(sessionId: sessionId, kind: "video", sizeBytes: fileData.count, startTime: startTime, endTime: endTime, frameCount: frameCount, compression: nil)
                
                // 3. Upload to S3
                try await uploadToS3(data: fileData, presignedURL: presign.url, contentType: "video/mp4")
                
                // 4. Notify Complete
                try await notifyComplete(segmentId: presign.segmentId, sessionId: sessionId, frameCount: frameCount)
                
                // 5. Cleanup
                if deleteAfterUpload {
                    try? FileManager.default.removeItem(at: segmentURL)
                }
                
                DispatchQueue.main.async { completion?(true, nil) }
                
            } catch {
                RJLogger.logErrorMessage("Segment upload failed: \(error)")
                DispatchQueue.main.async { completion?(false, error) }
            }
        }
    }
    
    public func uploadHierarchy(_ hierarchyData: Data, sessionId: String, timestamp: TimeInterval, completion: ((Bool, Error?) -> Void)?) {
        let bgTask = UIApplication.shared.beginBackgroundTask(withName: "RJHierarchyUpload") {
            RJLogger.logWarningMessage("Hierarchy upload background task expired")
        }
        
        Task {
            do {
                incrementPending()
                defer {
                    decrementPending()
                    UIApplication.shared.endBackgroundTask(bgTask)
                }
                
                guard let compressed = hierarchyData.gzip() else {
                    throw NSError(domain: "RJSegmentUploader", code: -1, userInfo: [NSLocalizedDescriptionKey: "Compression failed"])
                }
                
                let presign = try await requestPresign(sessionId: sessionId, kind: "hierarchy", sizeBytes: compressed.count, startTime: timestamp, endTime: timestamp, frameCount: 0, compression: "gzip")
                
                try await uploadToS3(data: compressed, presignedURL: presign.url, contentType: "application/gzip")
                
                try await notifyComplete(segmentId: presign.segmentId, sessionId: sessionId, frameCount: 0)
                
                DispatchQueue.main.async { completion?(true, nil) }
                
            } catch {
                RJLogger.logErrorMessage("Hierarchy upload failed: \(error)")
                DispatchQueue.main.async { completion?(false, error) }
            }
        }
    }
    
    public func cancelAllUploads() {
        urlSession.getAllTasks { tasks in
            tasks.forEach { $0.cancel() }
        }
    }
    
    public func cleanupOrphanedSegments() {
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("rj_segments")
        guard let files = try? FileManager.default.contentsOfDirectory(at: tempDir, includingPropertiesForKeys: [.creationDateKey]) else { return }
        
        let cutoff = Date().addingTimeInterval(-3600) // 1 hour ago
        
        for file in files {
            if let attrs = try? FileManager.default.attributesOfItem(atPath: file.path),
               let date = attrs[.creationDate] as? Date,
               date < cutoff {
                try? FileManager.default.removeItem(at: file)
            }
        }
    }
    
    // MARK: - Private Helpers
    
    private func incrementPending() {
        stateLock.lock()
        _pendingUploadCount += 1
        stateLock.unlock()
    }
    
    private func decrementPending() {
        stateLock.lock()
        _pendingUploadCount -= 1
        stateLock.unlock()
    }
    
    private struct PresignResponse {
        let url: URL
        let segmentId: String
        let s3Key: String
    }
    
    private func requestPresign(sessionId: String, kind: String, sizeBytes: Int, startTime: TimeInterval, endTime: TimeInterval, frameCount: Int, compression: String?) async throws -> PresignResponse {
        guard let url = URL(string: "\(baseURL)/api/ingest/segment/presign") else { throw URLError(.badURL) }
        
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuthHeaders(to: &req)
        
        var body: [String: Any] = [
            "sessionId": sessionId,
            "kind": kind,
            "sizeBytes": sizeBytes,
            "startTime": startTime,
            "endTime": endTime,
            "frameCount": frameCount
        ]
        if let compression = compression {
            body["compression"] = compression
        }
        
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await urlSession.data(for: req)
        
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let urlStr = json["presignedUrl"] as? String,
              let presignedUrl = URL(string: urlStr),
              let segmentId = json["segmentId"] as? String,
              let s3Key = json["s3Key"] as? String else {
            throw URLError(.cannotParseResponse)
        }
        
        return PresignResponse(url: presignedUrl, segmentId: segmentId, s3Key: s3Key)
    }
    
    private func uploadToS3(data: Data, presignedURL: URL, contentType: String) async throws {
        var req = URLRequest(url: presignedURL)
        req.httpMethod = "PUT"
        req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        req.setValue("\(data.count)", forHTTPHeaderField: "Content-Length")
        
        // Retry logic loop
        var lastError: Error?
        for attempt in 1...maxRetries {
            do {
                let (_, response) = try await urlSession.upload(for: req, from: data)
                if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                    throw URLError(.badServerResponse)
                }
                return // Success
            } catch {
                lastError = error
                if attempt < maxRetries {
                    try await Task.sleep(nanoseconds: UInt64(pow(2.0, Double(attempt)) * 1_000_000_000))
                }
            }
        }
        throw lastError ?? URLError(.unknown)
    }
    
    private func notifyComplete(segmentId: String, sessionId: String, frameCount: Int) async throws {
        guard let url = URL(string: "\(baseURL)/api/ingest/segment/complete") else { throw URLError(.badURL) }
        
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuthHeaders(to: &req)
        
        let body: [String: Any] = [
            "segmentId": segmentId,
            "sessionId": sessionId,
            "frameCount": frameCount
        ]
        
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        // Retry logic
        for attempt in 1...maxRetries {
            do {
                let (_, response) = try await urlSession.data(for: req)
                if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                    throw URLError(.badServerResponse)
                }
                return
            } catch {
                 if attempt < maxRetries {
                    try await Task.sleep(nanoseconds: UInt64(MIN(pow(2.0, Double(attempt)), 8.0) * 1_000_000_000))
                } else {
                    throw error
                }
            }
        }
    }
    
    private func addAuthHeaders(to request: inout URLRequest) {
        if let token = RJDeviceAuthManager.shared.currentUploadToken, let key = apiKey {
            request.setValue(token, forHTTPHeaderField: "x-upload-token")
            request.setValue(key, forHTTPHeaderField: "x-rejourney-key")
        } else if let key = apiKey {
            request.setValue(key, forHTTPHeaderField: "x-api-key")
        }
    }
    
    private func gzipData(_ data: Data) -> Data? {
        return data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) -> Data? in
            var stream = z_stream()
            stream.next_in = UnsafeMutablePointer<Bytef>(mutating: bytes.bindMemory(to: Bytef.self).baseAddress)
            stream.avail_in = uint(data.count)
            stream.total_out = 0
            
            // 16 + MAX_WBITS = gzip header
            if deflateInit2_(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, MAX_WBITS + 16, 8, Z_DEFAULT_STRATEGY, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) != Z_OK {
                return nil
            }
            
            var compressedData = Data(capacity: data.count / 2)
            let chunkSize = 16384
            
            repeat {
                if Int(stream.total_out) >= compressedData.count {
                    compressedData.count += chunkSize
                }
                
                compressedData.withUnsafeMutableBytes { (outBytes: UnsafeMutableRawBufferPointer) in
                    stream.next_out = outBytes.bindMemory(to: Bytef.self).baseAddress!.advanced(by: Int(stream.total_out))
                    stream.avail_out = uint(outBytes.count - Int(stream.total_out))
                    
                    deflate(&stream, Z_FINISH)
                }
            } while stream.avail_out == 0
            
            deflateEnd(&stream)
            compressedData.count = Int(stream.total_out)
            return compressedData
        }
    }
    
    private func MIN(_ a: Double, _ b: Double) -> Double {
        return a < b ? a : b
    }
}

