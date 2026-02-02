import Foundation
import Network
import CoreTelephony
import React

// MARK: - Enums (ObjC Compatibility)

@objc public enum RJNetworkType: Int {
    case none = 0
    case wifi
    case cellular
    case wired
    case other
}

@objc public enum RJCellularGeneration: Int {
    case unknown = 0
    case g2
    case g3
    case g4
    case g5
}

// MARK: - Network Quality Snapshot

@objcMembers
public class RJNetworkQuality: NSObject {
    public var networkType: RJNetworkType = .none
    public var cellularGeneration: RJCellularGeneration = .unknown
    public var isConstrained: Bool = false // Low data mode
    public var isExpensive: Bool = false   // Metered connection
    public var timestamp: TimeInterval = 0
    
    override public init() {
        super.init()
        self.timestamp = Date().timeIntervalSince1970 * 1000
    }
    
    public func toDictionary() -> [String: Any] {
        var typeStr = "none"
        switch networkType {
        case .wifi: typeStr = "wifi"
        case .cellular: typeStr = "cellular"
        case .wired: typeStr = "wired"
        case .other: typeStr = "other"
        default: break
        }
        
        var genStr = "unknown"
        switch cellularGeneration {
        case .g2: genStr = "2G"
        case .g3: genStr = "3G"
        case .g4: genStr = "4G"
        case .g5: genStr = "5G"
        default: break
        }
        
        return [
            "networkType": typeStr,
            "cellularGeneration": genStr,
            "isConstrained": isConstrained,
            "isExpensive": isExpensive,
            "timestamp": timestamp
        ]
    }
}

// MARK: - Delegate Protocol

@objc public protocol RJNetworkMonitorDelegate: AnyObject {
    @objc optional func networkMonitor(_ monitor: Any, didDetectNetworkChange quality: RJNetworkQuality)
}

// MARK: - Network Monitor

@objcMembers
public class RJNetworkMonitor: NSObject {
    
    public static let shared = RJNetworkMonitor()
    
    public weak var delegate: RJNetworkMonitorDelegate?
    
    private let monitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "com.rejourney.network.monitor")
    private var isMonitoring = false
    
    // Thread-safe property access
    private var _currentQuality: RJNetworkQuality
    private let qualityLock = NSLock()
    
    public var currentQuality: RJNetworkQuality {
        qualityLock.lock()
        defer { qualityLock.unlock() }
        return _currentQuality
    }
    
    private let telephonyInfo = CTTelephonyNetworkInfo()
    
    private override init() {
        self._currentQuality = RJNetworkQuality()
        super.init()
    }
    
    public func startMonitoring() {
        guard !isMonitoring else { return }
        
        monitor.pathUpdateHandler = { [weak self] path in
            self?.handlePathUpdate(path)
        }
        
        monitor.start(queue: monitorQueue)
        isMonitoring = true
        RJLogger.logDebugMessage("Network monitoring started (Swift)")
    }
    
    public func stopMonitoring() {
        guard isMonitoring else { return }
        
        monitor.cancel()
        isMonitoring = false
        RJLogger.logDebugMessage("Network monitoring stopped (Swift)")
    }
    
    public func captureNetworkQuality() -> RJNetworkQuality {
        return self.currentQuality
    }
    
    private func handlePathUpdate(_ path: NWPath) {
        let quality = RJNetworkQuality()
        
        // 1. Determine Network Type
        if path.status == .satisfied {
            if path.usesInterfaceType(.wifi) {
                quality.networkType = .wifi
            } else if path.usesInterfaceType(.cellular) {
                quality.networkType = .cellular
                quality.cellularGeneration = detectCellularGeneration()
            } else if path.usesInterfaceType(.wiredEthernet) {
                quality.networkType = .wired
            } else {
                quality.networkType = .other
            }
        } else {
            quality.networkType = .none
        }
        
        // 2. Flags
        quality.isConstrained = path.isConstrained
        quality.isExpensive = path.isExpensive
        quality.timestamp = Date().timeIntervalSince1970 * 1000
        
        // 3. Update State
        qualityLock.lock()
        _currentQuality = quality
        qualityLock.unlock()
        
        // 4. Notify Delegate
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.delegate?.networkMonitor?(self, didDetectNetworkChange: quality)
        }
        
        RJLogger.logDebugMessage("Network changed: \(quality.toDictionary())")
    }
    
    private func detectCellularGeneration() -> RJCellularGeneration {
        // Safe access to CTTelephonyNetworkInfo (can be quirky on older iOS)
        var radioTech: String?
        
        if let serviceTechs = telephonyInfo.serviceCurrentRadioAccessTechnology,
           let firstTech = serviceTechs.values.first {
            radioTech = firstTech
        } else {
            // Fallback for older devices/sims
            radioTech = telephonyInfo.currentRadioAccessTechnology
        }
        
        guard let tech = radioTech else { return .unknown }
        
        if #available(iOS 14.1, *) {
            if tech == CTRadioAccessTechnologyNRNSA || tech == CTRadioAccessTechnologyNR {
                return .g5
            }
        }
        
        if tech == CTRadioAccessTechnologyLTE {
            return .g4
        }
        
        switch tech {
        case CTRadioAccessTechnologyWCDMA,
             CTRadioAccessTechnologyHSDPA,
             CTRadioAccessTechnologyHSUPA,
             CTRadioAccessTechnologyCDMA1x,
             CTRadioAccessTechnologyCDMAEVDORev0,
             CTRadioAccessTechnologyCDMAEVDORevA,
             CTRadioAccessTechnologyCDMAEVDORevB,
             CTRadioAccessTechnologyeHRPD:
            return .g3
            
        case CTRadioAccessTechnologyGPRS,
             CTRadioAccessTechnologyEdge:
            return .g2
            
        default:
            return .unknown
        }
    }
}
