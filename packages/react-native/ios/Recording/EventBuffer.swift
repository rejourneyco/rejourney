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

/// Write-first event buffer for crash-safe event persistence.
/// Events are written to disk on append for crash safety.
/// JSONL format (one JSON object per line).
@objc(RJEventBuffer)
public final class EventBuffer: NSObject {
    
    @objc public static let shared = EventBuffer()
    
    private let _lock = NSLock()
    private var _sessionId: String?
    private var _eventsFile: URL?
    private var _metaFile: URL?
    private var _fileHandle: FileHandle?
    private var _eventCount: Int = 0
    private var _lastEventTimestamp: Int64 = 0
    private var _pendingRootPath: URL?
    private var _isShutdown = false
    
    @objc public var eventCount: Int {
        _lock.lock()
        defer { _lock.unlock() }
        return _eventCount
    }
    
    @objc public var lastEventTimestamp: Int64 {
        _lock.lock()
        defer { _lock.unlock() }
        return _lastEventTimestamp
    }
    
    private override init() {
        super.init()
    }
    
    // MARK: - Public API
    
    @objc public func configure(sessionId: String) {
        _lock.lock()
        defer { _lock.unlock() }
        
        _closeFileHandle()
        
        _sessionId = sessionId
        _isShutdown = false
        
        guard let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            DiagnosticLog.debugStorage(op: "CONFIGURE", key: sessionId, success: false, detail: "No cache directory")
            return
        }
        
        _pendingRootPath = cacheDir.appendingPathComponent("rj_pending")
        let sessionDir = _pendingRootPath!.appendingPathComponent(sessionId)
        
        do {
            try FileManager.default.createDirectory(at: sessionDir, withIntermediateDirectories: true)
        } catch {
            DiagnosticLog.debugStorage(op: "CONFIGURE", key: sessionId, success: false, detail: "Failed to create directory: \(error)")
            return
        }
        
        _eventsFile = sessionDir.appendingPathComponent("events.jsonl")
        _metaFile = sessionDir.appendingPathComponent("buffer_meta.json")
        
        _countExistingEvents()
        _openFileHandle()
        
        DiagnosticLog.debugStorage(op: "CONFIGURE", key: sessionId, success: true, detail: "Ready with \(_eventCount) existing events")
    }
    
    @objc public func appendEvent(_ event: [String: Any]) -> Bool {
        _lock.lock()
        defer { _lock.unlock() }
        
        guard !_isShutdown else {
            DiagnosticLog.debugStorage(op: "APPEND", key: event["type"] as? String ?? "unknown", success: false, detail: "Buffer is shutdown")
            return false
        }
        
        return _writeEventToDisk(event)
    }
    
    @objc public func flush() -> Bool {
        _lock.lock()
        defer { _lock.unlock() }
        
        guard let handle = _fileHandle else { return false }
        
        do {
            try handle.synchronize()
            _saveMeta()
            return true
        } catch {
            DiagnosticLog.debugStorage(op: "FLUSH", key: _sessionId ?? "", success: false, detail: "\(error)")
            return false
        }
    }
    
    @objc public func shutdown() {
        _lock.lock()
        defer { _lock.unlock() }
        
        _isShutdown = true
        _saveMeta()
        _closeFileHandle()
    }
    
    @objc public func readPendingEvents() -> [[String: Any]] {
        _lock.lock()
        defer { _lock.unlock() }
        
        guard let eventsFile = _eventsFile, FileManager.default.fileExists(atPath: eventsFile.path) else {
            return []
        }
        
        var events: [[String: Any]] = []
        
        do {
            let content = try String(contentsOf: eventsFile, encoding: .utf8)
            let lines = content.components(separatedBy: .newlines)
            
            for line in lines where !line.isEmpty {
                if let data = line.data(using: .utf8),
                   let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    events.append(event)
                }
            }
        } catch {
            DiagnosticLog.debugStorage(op: "READ", key: _sessionId ?? "", success: false, detail: "\(error)")
        }
        
        return events
    }
    
    @objc public func clearEvents() {
        _lock.lock()
        defer { _lock.unlock() }
        
        _closeFileHandle()
        
        if let eventsFile = _eventsFile {
            try? FileManager.default.removeItem(at: eventsFile)
        }
        if let metaFile = _metaFile {
            try? FileManager.default.removeItem(at: metaFile)
        }
        
        _eventCount = 0
        _lastEventTimestamp = 0
        
        _openFileHandle()
    }
    
    @objc public func clearSession(_ sessionId: String) {
        guard let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let sessionDir = cacheDir.appendingPathComponent("rj_pending").appendingPathComponent(sessionId)
        try? FileManager.default.removeItem(at: sessionDir)
    }
    
    /// Returns list of session IDs that have pending data on disk
    @objc public func getPendingSessions() -> [String] {
        guard let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return [] }
        let pendingRoot = cacheDir.appendingPathComponent("rj_pending")
        
        guard let contents = try? FileManager.default.contentsOfDirectory(at: pendingRoot, includingPropertiesForKeys: nil) else {
            return []
        }
        
        return contents.compactMap { url in
            let eventsFile = url.appendingPathComponent("events.jsonl")
            if FileManager.default.fileExists(atPath: eventsFile.path) {
                return url.lastPathComponent
            }
            return nil
        }
    }
    
    /// Read events from a specific session's pending data
    @objc public func readEventsForSession(_ sessionId: String) -> [[String: Any]] {
        guard let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return [] }
        let eventsFile = cacheDir.appendingPathComponent("rj_pending").appendingPathComponent(sessionId).appendingPathComponent("events.jsonl")
        
        guard FileManager.default.fileExists(atPath: eventsFile.path) else { return [] }
        
        var events: [[String: Any]] = []
        
        do {
            let content = try String(contentsOf: eventsFile, encoding: .utf8)
            let lines = content.components(separatedBy: .newlines)
            
            for line in lines where !line.isEmpty {
                if let data = line.data(using: .utf8),
                   let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    events.append(event)
                }
            }
        } catch {
            DiagnosticLog.debugStorage(op: "READ_SESSION", key: sessionId, success: false, detail: "\(error)")
        }
        
        return events
    }
    
    // MARK: - Private Methods
    
    private func _countExistingEvents() {
        guard let eventsFile = _eventsFile, FileManager.default.fileExists(atPath: eventsFile.path) else {
            _eventCount = 0
            _lastEventTimestamp = 0
            return
        }
        
        do {
            let content = try String(contentsOf: eventsFile, encoding: .utf8)
            let lines = content.components(separatedBy: .newlines)
            
            var count = 0
            var lastTs: Int64 = 0
            
            for line in lines where !line.isEmpty {
                if let data = line.data(using: .utf8),
                   let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    count += 1
                    if let ts = event["timestamp"] as? Int64, ts > lastTs {
                        lastTs = ts
                    } else if let ts = event["timestamp"] as? Int, Int64(ts) > lastTs {
                        lastTs = Int64(ts)
                    }
                }
            }
            
            _eventCount = count
            _lastEventTimestamp = lastTs
            
            // Load meta if exists
            if let metaFile = _metaFile, FileManager.default.fileExists(atPath: metaFile.path) {
                if let metaData = try? Data(contentsOf: metaFile),
                   let meta = try? JSONSerialization.jsonObject(with: metaData) as? [String: Any] {
                    // Could track uploadedEventCount here
                }
            }
        } catch {
            _eventCount = 0
            _lastEventTimestamp = 0
        }
    }
    
    private func _openFileHandle() {
        guard let eventsFile = _eventsFile else { return }
        
        if !FileManager.default.fileExists(atPath: eventsFile.path) {
            FileManager.default.createFile(atPath: eventsFile.path, contents: nil)
        }
        
        do {
            _fileHandle = try FileHandle(forWritingTo: eventsFile)
            try _fileHandle?.seekToEnd()
        } catch {
            DiagnosticLog.debugStorage(op: "OPEN_HANDLE", key: _sessionId ?? "", success: false, detail: "\(error)")
        }
    }
    
    private func _closeFileHandle() {
        try? _fileHandle?.close()
        _fileHandle = nil
    }
    
    private func _writeEventToDisk(_ event: [String: Any]) -> Bool {
        guard let handle = _fileHandle else {
            _openFileHandle()
            guard _fileHandle != nil else { return false }
            return _writeEventToDisk(event)
        }
        
        do {
            let data = try JSONSerialization.data(withJSONObject: event)
            var line = data
            line.append(0x0A) // newline
            
            try handle.write(contentsOf: line)
            
            _eventCount += 1
            if let ts = event["timestamp"] as? Int64 {
                _lastEventTimestamp = ts
            } else if let ts = event["timestamp"] as? Int {
                _lastEventTimestamp = Int64(ts)
            }
            
            return true
        } catch {
            DiagnosticLog.debugStorage(op: "WRITE", key: event["type"] as? String ?? "unknown", success: false, detail: "\(error)")
            return false
        }
    }
    
    private func _saveMeta() {
        guard let metaFile = _metaFile else { return }
        
        let meta: [String: Any] = [
            "eventCount": _eventCount,
            "lastEventTimestamp": _lastEventTimestamp,
            "savedAt": Date().timeIntervalSince1970 * 1000
        ]
        
        if let data = try? JSONSerialization.data(withJSONObject: meta) {
            try? data.write(to: metaFile)
        }
    }
}
