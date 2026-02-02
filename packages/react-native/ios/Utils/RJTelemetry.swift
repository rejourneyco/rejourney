
import Foundation

@objc(RJTelemetryEventType)
public enum RJTelemetryEventType: Int {
    case uploadSuccess
    case uploadFailure
    case retryAttempt
    case circuitBreakerOpen
    case circuitBreakerClose
    case memoryPressureEviction
    case offlineQueuePersist
    case offlineQueueRestore
    case sessionStart
    case sessionEnd
    case crashDetected
    case tokenRefresh
}

@objc(RJTelemetry)
public class RJTelemetry: NSObject {
    
    @objc public static let sharedInstance = RJTelemetry()
    
    // Properties to mirror old ObjC interface
    private var metrics = [String: Any]()
    private let lock = NSLock()
    
    // Counters
    private var uploadSuccessCount = 0
    private var uploadFailureCount = 0
    private var retryAttemptCount = 0
    private var circuitBreakerOpenCount = 0
    private var memoryEvictionCount = 0
    private var crashCount = 0
    private var anrCount = 0
    
    private override init() {
        super.init()
    }
    
    @objc public func recordEvent(_ type: RJTelemetryEventType) {
        recordEvent(type, metadata: nil)
    }
    
    @objc public func recordEvent(_ type: RJTelemetryEventType, metadata: [String: Any]?) {
        lock.lock()
        defer { lock.unlock() }
        
        switch type {
        case .uploadSuccess: uploadSuccessCount += 1
        case .uploadFailure: uploadFailureCount += 1
        case .retryAttempt: retryAttemptCount += 1
        case .circuitBreakerOpen: circuitBreakerOpenCount += 1
        case .memoryPressureEviction: memoryEvictionCount += 1
        case .crashDetected: crashCount += 1
        case .sessionEnd:
            printSummary()
        default: break
        }
    }
    
    @objc public func recordANR() {
        lock.lock()
        anrCount += 1
        lock.unlock()
    }
    
    @objc public func metricsAsDictionary() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        
        return [
            "uploadSuccessCount": uploadSuccessCount,
            "uploadFailureCount": uploadFailureCount,
            "retryAttemptCount": retryAttemptCount,
            "circuitBreakerOpenCount": circuitBreakerOpenCount,
            "memoryEvictionCount": memoryEvictionCount,
            "crashCount": crashCount,
            "anrCount": anrCount
        ]
    }
    
    private func printSummary() {
        print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        print(" SDK Telemetry Summary (Swift)")
        print("   Uploads: \(uploadSuccessCount) success, \(uploadFailureCount) failed")
        print("   Crashes: \(crashCount)")
        print("   ANRs:    \(anrCount)")
        print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    }
}
