
import Foundation
import UIKit

@objc(RJEventBuffer)
public class RJEventBuffer: NSObject {
    
    // MARK: - Internal Actor for Thread Safety
    private actor BufferActor {
        private let fileHandle: FileHandle?
        private let fileUrl: URL
        var eventCount: Int = 0
        var lastEventTimestamp: TimeInterval = 0
        
        init(sessionId: String, pendingRootPath: String) {
            let fileManager = FileManager.default
            let rootUrl = URL(fileURLWithPath: pendingRootPath)
            let sessionDir = rootUrl.appendingPathComponent(sessionId)
            self.fileUrl = sessionDir.appendingPathComponent("events.jsonl")
            
            do {
                if !fileManager.fileExists(atPath: sessionDir.path) {
                    try fileManager.createDirectory(at: sessionDir, withIntermediateDirectories: true, attributes: nil)
                }
                
                if !fileManager.fileExists(atPath: fileUrl.path) {
                    fileManager.createFile(atPath: fileUrl.path, contents: nil, attributes: [FileAttributeKey.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
                }
                
                self.fileHandle = try FileHandle(forWritingTo: fileUrl)
                self.fileHandle?.seekToEndOfFile()
                
            } catch {
                print("[RJEventBuffer] Failed to initialize file: \(error)")
                self.fileHandle = nil
            }
        }
        
        deinit {
            try? fileHandle?.close()
        }
        
        func append(event: [String: Any]) {
            guard let fileHandle = fileHandle else { return }
            
            do {
                if JSONSerialization.isValidJSONObject(event) {
                    let data = try JSONSerialization.data(withJSONObject: event, options: [])
                    fileHandle.write(data)
                    fileHandle.write("\n".data(using: .utf8)!)
                    
                    self.eventCount += 1
                    if let ts = event["timestamp"] as? NSNumber {
                        self.lastEventTimestamp = ts.doubleValue
                    }
                }
            } catch {
                print("[RJEventBuffer] Write failed: \(error)")
            }
        }
        
        func close() {
            try? fileHandle?.close()
        }
        
        func clear() {
            close()
            try? FileManager.default.removeItem(at: fileUrl)
        }
    }
    
    private let bufferActor: BufferActor
    
    @objc public let pendingRootPath: String
    
    @objc public init(sessionId: String, pendingRootPath: String) {
        self.pendingRootPath = pendingRootPath
        self.bufferActor = BufferActor(sessionId: sessionId, pendingRootPath: pendingRootPath)
        super.init()
    }
    
    @objc public func appendEvent(_ event: [String: Any]) {
        Task {
            await bufferActor.append(event: event)
        }
    }
    
    @objc public func clearAllEvents() {
        Task {
            await bufferActor.clear()
        }
    }
    
    // Legacy support: We don't implement synchronous read because it blocks.
    // If ObjC needs it, we return empty or implement async.
    // Given usage analysis showed NO calls to readAllEvents, we omit it or stub it.
    @objc public func readAllEvents() -> [[String: Any]] {
        // Stub: Reading synchronously is unsafe and we believe it's unused.
        return []
    }
}
