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
import QuartzCore

// MARK: - Log Level

/// Severity tiers for SDK diagnostic messages
@objc public enum LogLevel: Int {
    case trace = 0
    case notice = 1
    case caution = 2
    case fault = 3
}

// MARK: - Performance Snapshot

/// Captures point-in-time performance metrics
public struct PerformanceSnapshot {
    let wallTimeMs: Double
    let cpuTimeMs: Double
    let mainThreadTimeMs: Double
    let timestamp: CFAbsoluteTime
    let isMainThread: Bool
    let threadName: String
    
    public static func capture() -> PerformanceSnapshot {
        var taskInfo = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        
        var cpuTimeMs: Double = 0
        if task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), withUnsafeMutablePointer(to: &taskInfo) { $0.withMemoryRebound(to: Int32.self, capacity: 1) { $0 } }, &count) == KERN_SUCCESS {
            let userTimeMs = Double(taskInfo.user_time.seconds) * 1000.0 + Double(taskInfo.user_time.microseconds) / 1000.0
            let systemTimeMs = Double(taskInfo.system_time.seconds) * 1000.0 + Double(taskInfo.system_time.microseconds) / 1000.0
            cpuTimeMs = userTimeMs + systemTimeMs
        }
        
        let isMain = Thread.isMainThread
        let name: String
        if isMain {
            name = "main"
        } else if let threadName = Thread.current.name, !threadName.isEmpty {
            name = threadName
        } else {
            name = "bg-\(String(format: "%04x", UInt16(truncatingIfNeeded: UInt(bitPattern: ObjectIdentifier(Thread.current)))))"
        }
        
        return PerformanceSnapshot(
            wallTimeMs: CACurrentMediaTime() * 1000,
            cpuTimeMs: cpuTimeMs,
            mainThreadTimeMs: isMain ? CACurrentMediaTime() * 1000 : 0,
            timestamp: CFAbsoluteTimeGetCurrent(),
            isMainThread: isMain,
            threadName: name
        )
    }
    
    public func elapsed(since start: PerformanceSnapshot) -> (wall: Double, cpu: Double, thread: String) {
        return (
            wall: wallTimeMs - start.wallTimeMs,
            cpu: cpuTimeMs - start.cpuTimeMs,
            thread: isMainThread ? "🟢 MAIN" : "🔵 BG(\(threadName))"
        )
    }
}

// MARK: - Diagnostic Log

/// Centralized logging facility for SDK diagnostics
@objc(DiagnosticLog)
public final class DiagnosticLog: NSObject {
    
    // MARK: Configuration
    
    @objc public static var minimumLevel: Int = 1
    @objc public static var includeTimestamp: Bool = true
    @objc public static var detailedOutput: Bool = false
    @objc public static var performanceTracing: Bool = false
    
    // MARK: Level-Based Emission
    
    public static func emit(_ level: LogLevel, _ message: String) {
        guard level.rawValue >= minimumLevel else { return }
        
        let prefix: String
        switch level {
        case .trace:   prefix = "TRACE"
        case .notice:  prefix = "INFO"
        case .caution: prefix = "WARN"
        case .fault:   prefix = "ERROR"
        }
        
        _writeLog(prefix: prefix, message: message)
    }
    
    // MARK: Convenience Methods
    
    @objc public static func trace(_ message: String) {
        guard minimumLevel <= 0 else { return }
        _writeLog(prefix: "VERBOSE", message: message)
    }
    
    @objc public static func notice(_ message: String) {
        guard minimumLevel <= 1 else { return }
        _writeLog(prefix: "INFO", message: message)
    }
    
    @objc public static func caution(_ message: String) {
        guard minimumLevel <= 2 else { return }
        _writeLog(prefix: "WARN", message: message)
    }
    
    @objc public static func fault(_ message: String) {
        guard minimumLevel <= 3 else { return }
        _writeLog(prefix: "ERROR", message: message)
    }
    
    // MARK: Lifecycle Events
    
    @objc public static func sdkReady(_ version: String) {
        notice("[Rejourney] SDK initialized v\(version)")
    }
    
    @objc public static func sdkFailed(_ reason: String) {
        fault("[Rejourney] Initialization failed: \(reason)")
    }
    
    @objc public static func replayBegan(_ sessionId: String) {
        notice("[Rejourney] Recording started: \(sessionId)")
    }
    
    @objc public static func replayEnded(_ sessionId: String) {
        notice("[Rejourney] Recording ended: \(sessionId)")
    }
    
    // MARK: Debug-Only Session Logs
    
    public static func debugSessionCreate(phase: String, details: String, perf: PerformanceSnapshot? = nil) {
        guard detailedOutput else { return }
        var msg = "📍 [SESSION] \(phase): \(details)"
        if let p = perf, performanceTracing {
            let threadIcon = p.isMainThread ? "🟢 MAIN" : "🔵 BG"
            msg += " | \(threadIcon) wall=\(String(format: "%.2f", p.wallTimeMs))ms cpu=\(String(format: "%.2f", p.cpuTimeMs))ms"
        }
        _writeLog(prefix: "DEBUG", message: msg)
    }
    
    public static func debugSessionTiming(operation: String, startPerf: PerformanceSnapshot, endPerf: PerformanceSnapshot) {
        guard detailedOutput && performanceTracing else { return }
        let elapsed = endPerf.elapsed(since: startPerf)
        _writeLog(prefix: "PERF", message: "⏱️ [\(operation)] \(elapsed.thread) | wall=\(String(format: "%.2f", elapsed.wall))ms cpu=\(String(format: "%.2f", elapsed.cpu))ms")
    }
    
    // MARK: Enhanced Performance Logging
    
    /// Log a timed operation with automatic thread detection
    public static func perfOperation(_ name: String, category: String = "OP", block: () -> Void) {
        guard detailedOutput && performanceTracing else {
            block()
            return
        }
        
        let start = PerformanceSnapshot.capture()
        block()
        let end = PerformanceSnapshot.capture()
        let elapsed = end.elapsed(since: start)
        
        let warningThreshold: Double = 16.67 // One frame at 60fps
        let icon = elapsed.wall > warningThreshold ? "🔴" : (elapsed.wall > 8 ? "🟡" : "🟢")
        
        _writeLog(prefix: "PERF", message: "\(icon) [\(category)] \(name) | \(elapsed.thread) | ⏱️ \(String(format: "%.2f", elapsed.wall))ms wall, \(String(format: "%.2f", elapsed.cpu))ms cpu")
    }
    
    /// Log a timed async operation start
    public static func perfStart(_ name: String, category: String = "ASYNC") -> CFAbsoluteTime {
        let start = CFAbsoluteTimeGetCurrent()
        if detailedOutput && performanceTracing {
            let threadInfo = Thread.isMainThread ? "🟢 MAIN" : "🔵 BG"
            _writeLog(prefix: "PERF", message: "▶️ [\(category)] \(name) started | \(threadInfo)")
        }
        return start
    }
    
    /// Log a timed async operation end
    public static func perfEnd(_ name: String, startTime: CFAbsoluteTime, category: String = "ASYNC", success: Bool = true) {
        guard detailedOutput && performanceTracing else { return }
        let elapsed = (CFAbsoluteTimeGetCurrent() - startTime) * 1000
        let threadInfo = Thread.isMainThread ? "🟢 MAIN" : "🔵 BG"
        let icon = success ? "✅" : "❌"
        
        let warningThreshold: Double = 100 // 100ms for async ops
        let timeIcon = elapsed > warningThreshold ? "🔴" : (elapsed > 50 ? "🟡" : "🟢")
        
        _writeLog(prefix: "PERF", message: "\(icon) [\(category)] \(name) finished | \(threadInfo) | \(timeIcon) \(String(format: "%.2f", elapsed))ms")
    }
    
    /// Log frame timing for visual capture
    public static func perfFrame(operation: String, durationMs: Double, frameNumber: Int, isMainThread: Bool) {
        guard detailedOutput && performanceTracing else { return }
        let threadInfo = isMainThread ? "🟢 MAIN" : "🔵 BG"
        let budget: Double = 33.33 // 30fps budget
        let icon = durationMs > budget ? "🔴 DROPPED" : (durationMs > 16.67 ? "🟡 SLOW" : "🟢 OK")
        
        _writeLog(prefix: "FRAME", message: "🎬 [\(operation)] #\(frameNumber) | \(threadInfo) | \(icon) \(String(format: "%.2f", durationMs))ms (budget: \(String(format: "%.1f", budget))ms)")
    }
    
    /// Log batch operation timing
    public static func perfBatch(operation: String, itemCount: Int, totalMs: Double, isMainThread: Bool) {
        guard detailedOutput && performanceTracing else { return }
        let threadInfo = isMainThread ? "🟢 MAIN" : "🔵 BG"
        let avgMs = itemCount > 0 ? totalMs / Double(itemCount) : 0
        
        _writeLog(prefix: "BATCH", message: "📦 [\(operation)] \(itemCount) items | \(threadInfo) | total=\(String(format: "%.2f", totalMs))ms avg=\(String(format: "%.3f", avgMs))ms/item")
    }
    
    /// Log network timing with throughput
    public static func perfNetwork(operation: String, url: String, durationMs: Double, bytesTransferred: Int, success: Bool) {
        guard detailedOutput && performanceTracing else { return }
        let threadInfo = Thread.isMainThread ? "🟢 MAIN" : "🔵 BG"
        let throughputKBps = durationMs > 0 ? Double(bytesTransferred) / durationMs : 0
        let icon = success ? "✅" : "❌"
        let shortUrl = url.components(separatedBy: "/").suffix(2).joined(separator: "/")
        
        _writeLog(prefix: "NET", message: "\(icon) [\(operation)] \(shortUrl) | \(threadInfo) | \(String(format: "%.2f", durationMs))ms, \(bytesTransferred)B @ \(String(format: "%.1f", throughputKBps))KB/s")
    }
    
    // MARK: Debug-Only Presign Logs
    
    public static func debugPresignRequest(url: String, sessionId: String, kind: String, sizeBytes: Int) {
        guard detailedOutput else { return }
        _writeLog(prefix: "DEBUG", message: "🔐 [PRESIGN-REQ] url=\(url) sessionId=\(sessionId) kind=\(kind) size=\(sizeBytes)B")
    }
    
    public static func debugPresignResponse(status: Int, segmentId: String?, uploadUrl: String?, durationMs: Double) {
        guard detailedOutput else { return }
        if let segId = segmentId, let url = uploadUrl {
            let truncUrl = url.count > 80 ? String(url.prefix(80)) + "..." : url
            _writeLog(prefix: "DEBUG", message: "✅ [PRESIGN-OK] status=\(status) segmentId=\(segId) uploadUrl=\(truncUrl) took=\(String(format: "%.1f", durationMs))ms")
        } else {
            _writeLog(prefix: "DEBUG", message: "❌ [PRESIGN-FAIL] status=\(status) took=\(String(format: "%.1f", durationMs))ms")
        }
    }
    
    public static func debugUploadProgress(phase: String, segmentId: String, bytesWritten: Int64, totalBytes: Int64) {
        guard detailedOutput else { return }
        let pct = totalBytes > 0 ? Double(bytesWritten) / Double(totalBytes) * 100 : 0
        _writeLog(prefix: "DEBUG", message: "📤 [UPLOAD] \(phase) segmentId=\(segmentId) progress=\(String(format: "%.1f", pct))% (\(bytesWritten)/\(totalBytes)B)")
    }
    
    public static func debugUploadComplete(segmentId: String, status: Int, durationMs: Double, throughputKBps: Double) {
        guard detailedOutput else { return }
        _writeLog(prefix: "DEBUG", message: "📤 [UPLOAD-DONE] segmentId=\(segmentId) status=\(status) took=\(String(format: "%.1f", durationMs))ms throughput=\(String(format: "%.1f", throughputKBps))KB/s")
    }
    
    // MARK: Debug-Only Network Logs
    
    public static func debugNetworkRequest(method: String, url: String, headers: [String: String]?) {
        guard detailedOutput else { return }
        var msg = "🌐 [NET-REQ] \(method) \(url)"
        if let h = headers {
            let sanitized = h.mapValues { $0.count > 20 ? String($0.prefix(8)) + "..." : $0 }
            msg += " headers=\(sanitized)"
        }
        _writeLog(prefix: "DEBUG", message: msg)
    }
    
    public static func debugNetworkResponse(url: String, status: Int, bodySize: Int, durationMs: Double) {
        guard detailedOutput else { return }
        _writeLog(prefix: "DEBUG", message: "🌐 [NET-RSP] \(url.components(separatedBy: "/").last ?? url) status=\(status) size=\(bodySize)B took=\(String(format: "%.1f", durationMs))ms")
    }
    
    // MARK: Debug-Only Credential Logs
    
    public static func debugCredentialFlow(phase: String, fingerprint: String?, success: Bool, detail: String = "") {
        guard detailedOutput else { return }
        let fp = fingerprint.map { String($0.prefix(12)) + "..." } ?? "nil"
        let icon = success ? "✅" : "❌"
        _writeLog(prefix: "DEBUG", message: "\(icon) [CRED] \(phase) fingerprint=\(fp) \(detail)")
    }
    
    // MARK: Debug-Only Storage Logs
    
    public static func debugStorage(op: String, key: String, success: Bool, detail: String = "") {
        guard detailedOutput else { return }
        let icon = success ? "✅" : "❌"
        _writeLog(prefix: "DEBUG", message: "\(icon) [STORAGE] \(op) key=\(key) \(detail)")
    }
    
    // MARK: Debug-Only Performance Logs
    
    public static func debugPerformanceMarker(_ operation: String, startTime: CFAbsoluteTime, context: String = "") {
        guard detailedOutput && performanceTracing else { return }
        let elapsed = (CFAbsoluteTimeGetCurrent() - startTime) * 1000
        let threadInfo = Thread.isMainThread ? "🟢 MAIN" : "🔵 BG"
        let warningIcon = elapsed > 16.67 ? "🔴" : (elapsed > 8 ? "🟡" : "🟢")
        var msg = "\(warningIcon) [\(operation)] \(threadInfo) | \(String(format: "%.2f", elapsed))ms"
        if !context.isEmpty { msg += " | \(context)" }
        _writeLog(prefix: "PERF", message: msg)
    }
    
    public static func debugMemoryUsage(context: String) {
        guard detailedOutput && performanceTracing else { return }
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: Int32.self, capacity: 1) { task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count) }
        }
        if result == KERN_SUCCESS {
            let usedMB = Double(info.resident_size) / 1_048_576
            let virtualMB = Double(info.virtual_size) / 1_048_576
            let warningIcon = usedMB > 100 ? "🔴" : (usedMB > 50 ? "🟡" : "🟢")
            _writeLog(prefix: "MEM", message: "\(warningIcon) [\(context)] resident=\(String(format: "%.1f", usedMB))MB virtual=\(String(format: "%.1f", virtualMB))MB")
        }
    }
    
    public static func debugCPUUsage(context: String) {
        guard detailedOutput && performanceTracing else { return }
        var threadsList: thread_act_array_t?
        var threadCount: mach_msg_type_number_t = 0
        guard task_threads(mach_task_self_, &threadsList, &threadCount) == KERN_SUCCESS, let threads = threadsList else { return }
        
        var totalCPU: Double = 0
        var mainThreadCPU: Double = 0
        let threadInfoCount = mach_msg_type_number_t(MemoryLayout<thread_basic_info_data_t>.size / MemoryLayout<natural_t>.size)
        
        for i in 0..<Int(threadCount) {
            var info = thread_basic_info()
            var infoCount = threadInfoCount
            let result = withUnsafeMutablePointer(to: &info) {
                $0.withMemoryRebound(to: Int32.self, capacity: 1) { thread_info(threads[i], thread_flavor_t(THREAD_BASIC_INFO), $0, &infoCount) }
            }
            if result == KERN_SUCCESS, info.flags & TH_FLAGS_IDLE == 0 {
                let cpuUsage = Double(info.cpu_usage) / Double(TH_USAGE_SCALE) * 100
                totalCPU += cpuUsage
                if i == 0 { mainThreadCPU = cpuUsage } // First thread is typically main
            }
        }
        
        vm_deallocate(mach_task_self_, vm_address_t(bitPattern: threads), vm_size_t(threadCount) * vm_size_t(MemoryLayout<thread_t>.size))
        
        let warningIcon = totalCPU > 80 ? "🔴" : (totalCPU > 50 ? "🟡" : "🟢")
        _writeLog(prefix: "CPU", message: "\(warningIcon) [\(context)] 🟢 main=\(String(format: "%.1f", mainThreadCPU))% | total=\(String(format: "%.1f", totalCPU))% across \(threadCount) threads")
    }
    
    // MARK: Configuration
    
    @objc public static func setVerbose(_ enabled: Bool) {
        detailedOutput = enabled
        performanceTracing = enabled
        minimumLevel = enabled ? 0 : 1
        if enabled {
            _writeLog(prefix: "INFO", message: "🔧 [CONFIG] Debug mode ENABLED: detailedOutput=\\(detailedOutput), performanceTracing=\\(performanceTracing), minimumLevel=\\(minimumLevel)")
        }
    }
    
    // MARK: Private Implementation
    
    private static func _writeLog(prefix: String, message: String) {
        var output = "[RJ]"
        
        if includeTimestamp {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            output += " \(formatter.string(from: Date()))"
        }
        
        output += " [\(prefix)] \(message)"
        print(output)
    }
}

// Type alias for backward compatibility
typealias LogSeverity = LogLevel
