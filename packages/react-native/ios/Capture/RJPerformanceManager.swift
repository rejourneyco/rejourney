
import Foundation
import UIKit
import MachO

@objc public protocol RJPerformanceManagerDelegate: NSObjectProtocol {
    @objc optional func performanceManagerDidChangeLevel(_ level: RJPerformanceLevel)
    @objc optional func performanceManagerDidReceiveMemoryWarning()
}

@objc(RJPerformanceManager)
public class RJPerformanceManager: NSObject {
    
    @objc public static let sharedManager = RJPerformanceManager()
    
    @objc public weak var delegate: RJPerformanceManagerDelegate?
    @objc public var thermalThrottleEnabled = true
    @objc public var batteryAwareEnabled = true
    
    @objc public private(set) var currentLevel: RJPerformanceLevel = .normal {
        didSet {
            if oldValue != currentLevel {
                delegate?.performanceManagerDidChangeLevel?(currentLevel)
            }
        }
    }
    
    private var isMonitoring = false
    private var memoryPressureSource: DispatchSourceMemoryPressure?
    private var monitorTask: Task<Void, Never>?
    
    private var rollingCPUAverage: Float = 0.0
    private var highCPUSampleCount = 0
    
    // CPU Thresholds
    private let cpuCriticalThreshold: Float = 90.0
    private let cpuHighThreshold: Float = 60.0
    private let cpuNormalThreshold: Float = 40.0
    private let hysteresisSamples = 3
    
    // Low Battery Threshold (20%)
    private let lowBatteryThreshold: Float = 0.20
    
    // Memory Warning Threshold (200MB resident)
    private let memoryWarningThresholdBytes: UInt64 = 200 * 1024 * 1024
    
    private override init() {
        super.init()
    }
    
    deinit {
        stopMonitoring()
    }
    
    @objc public func startMonitoring() {
        if isMonitoring { return }
        isMonitoring = true
        
        setupMemoryPressureMonitoring()
        
        NotificationCenter.default.addObserver(self, selector: #selector(handleMemoryWarningNotification), name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
        
        NotificationCenter.default.addObserver(self, selector: #selector(handleThermalStateChange), name: ProcessInfo.thermalStateDidChangeNotification, object: nil)
        
        UIDevice.current.isBatteryMonitoringEnabled = true
        NotificationCenter.default.addObserver(self, selector: #selector(handleBatteryStateChange), name: UIDevice.batteryLevelDidChangeNotification, object: nil)
        
        // Start background monitoring loop
        monitorTask = Task.detached(priority: .utility) { [weak self] in
            while !Task.isCancelled {
                // Sleep for 2 seconds
                try? await Task.sleep(nanoseconds: 2 * 1_000_000_000)
                
                guard let self = self else { return }
                await self.checkCPUUsageAndLevel()
            }
        }
        
        RJLogger.debug("Performance monitoring started")
    }
    
    @objc public func stopMonitoring() {
        if !isMonitoring { return }
        isMonitoring = false
        
        NotificationCenter.default.removeObserver(self)
        
        monitorTask?.cancel()
        monitorTask = nil
        
        if let source = memoryPressureSource {
            source.cancel()
            memoryPressureSource = nil
        }
        
        RJLogger.debug("Performance monitoring stopped")
    }
    
    @objc public func updatePerformanceLevel() {
        // Run on main actor or sync queue if needed, but since we modify property, let's keep it safe.
        // For simplicity, we can just trigger the check logic which handles logic.
        // But since this is public and might be called from any thread, let's use Task to be safe if called from ObjC
        Task { @MainActor in
            self.performUpdateCheck()
        }
    }
    
    // MARK: - Monitoring Logic
    
    private func setupMemoryPressureMonitoring() {
        let source = DispatchSource.makeMemoryPressureSource(eventMask: [.warning, .critical], queue: .main)
        
        source.setEventHandler { [weak self] in
             guard let self = self else { return }
             let event = source.data
             
             if event.contains(.critical) {
                 RJLogger.warning("CRITICAL memory pressure - pausing captures")
                 self.setLevel(.paused)
                 self.handleMemoryWarning()
             } else if event.contains(.warning) {
                 RJLogger.warning("Memory pressure warning - reducing captures")
                 self.setLevel(.minimal)
             }
        }
        
        source.resume()
        memoryPressureSource = source
    }
    
    @objc private func handleMemoryWarningNotification() {
        handleMemoryWarning()
    }
    
    @objc public func handleMemoryWarning() {
        RJLogger.warning("Memory warning received")
        setLevel(.minimal)
        delegate?.performanceManagerDidReceiveMemoryWarning?()
    }
    
    @objc private func handleThermalStateChange() {
        Task { @MainActor in performUpdateCheck() }
    }
    
    @objc private func handleBatteryStateChange() {
        Task { @MainActor in performUpdateCheck() }
    }
    
    @MainActor
    private func performUpdateCheck() {
        if !thermalThrottleEnabled && !batteryAwareEnabled {
            setLevel(.normal)
            return
        }
        
        var newLevel = RJPerformanceLevel.normal
        
        // Thermal State
        if thermalThrottleEnabled {
            let state = ProcessInfo.processInfo.thermalState
            switch state {
            case .critical:
                setLevel(.paused)
                return
            case .serious:
                setLevel(.minimal)
                return
            case .fair:
                newLevel = .reduced
            case .nominal:
                break
            @unknown default:
                break
            }
        }
        
        // Battery State
        if batteryAwareEnabled {
            let batteryState = UIDevice.current.batteryState
            let batteryLevel = UIDevice.current.batteryLevel
            
            let isCharging = (batteryState == .charging || batteryState == .full)
            if !isCharging && batteryLevel >= 0 && batteryLevel < lowBatteryThreshold {
                newLevel = maxLevel(newLevel, .reduced)
            }
        }
        
        // Memory Usage
        let usedMemory = currentMemoryUsage()
        if usedMemory > memoryWarningThresholdBytes {
             newLevel = maxLevel(newLevel, .reduced)
        }
        
        setLevel(newLevel)
    }
    
    private func setLevel(_ level: RJPerformanceLevel) {
        if currentLevel != level {
            currentLevel = level
        }
    }
    
    private func maxLevel(_ l1: RJPerformanceLevel, _ l2: RJPerformanceLevel) -> RJPerformanceLevel {
        return l1.rawValue > l2.rawValue ? l1 : l2
    }
    
    private func checkCPUUsageAndLevel() async {
        let cpu = currentCPUUsage()
        if cpu < 0 { return }
        
        if rollingCPUAverage == 0 {
            rollingCPUAverage = cpu
        } else {
            rollingCPUAverage = 0.3 * cpu + 0.7 * rollingCPUAverage
        }
        
        var suggestedLevel = RJPerformanceLevel.normal
        
        if rollingCPUAverage >= cpuCriticalThreshold {
            suggestedLevel = .minimal
            highCPUSampleCount += 1
        } else if rollingCPUAverage >= cpuHighThreshold {
            suggestedLevel = .reduced
            highCPUSampleCount += 1
        } else if rollingCPUAverage < cpuNormalThreshold {
            highCPUSampleCount = 0
            suggestedLevel = .normal
        } else {
            // Hysteresis zone
            if currentLevel.rawValue >= RJPerformanceLevel.reduced.rawValue {
                return
            }
            return
        }
        
        await MainActor.run {
            if suggestedLevel.rawValue > currentLevel.rawValue {
                if highCPUSampleCount >= hysteresisSamples {
                    RJLogger.info("CPU usage high (\(String(format: "%.1f", rollingCPUAverage))%), throttling to level \(suggestedLevel.rawValue)")
                    setLevel(suggestedLevel)
                }
            } else if suggestedLevel.rawValue < currentLevel.rawValue {
                if highCPUSampleCount == 0 {
                    RJLogger.info("CPU usage normalized (\(String(format: "%.1f", rollingCPUAverage))%), restoring level \(suggestedLevel.rawValue)")
                    setLevel(suggestedLevel)
                }
            }
        }
    }

    // MARK: - Metrics Calculation
    
    @objc public func currentMemoryUsage() -> UInt {
        var info = task_basic_info()
        var count = mach_msg_type_number_t(TASK_BASIC_INFO_COUNT)
        
        let kerr: kern_return_t = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_BASIC_INFO), $0, &count)
            }
        }
        
        if kerr == KERN_SUCCESS {
            return UInt(info.resident_size)
        } else {
            return 0
        }
    }
    
    @objc public func currentCPUUsage() -> Float {
        var totalUsage: Float = 0.0
        var threadList: thread_act_array_t?
        var threadCount: mach_msg_type_number_t = 0
        
        let kr = task_threads(mach_task_self_, &threadList, &threadCount)
        if kr != KERN_SUCCESS { return -1.0 }
        
        if let threadList = threadList {
            for i in 0..<Int(threadCount) {
                var threadInfo = thread_basic_info()
                var threadInfoCount = mach_msg_type_number_t(THREAD_INFO_MAX)
                
                let kerr: kern_return_t = withUnsafeMutablePointer(to: &threadInfo) {
                    $0.withMemoryRebound(to: integer_t.self, capacity: Int(threadInfoCount)) {
                        thread_info(threadList[i], thread_flavor_t(THREAD_BASIC_INFO), $0, &threadInfoCount)
                    }
                }
                
                if kerr == KERN_SUCCESS {
                    if (threadInfo.flags & TH_FLAGS_IDLE) == 0 {
                        totalUsage += Float(threadInfo.cpu_usage) / Float(TH_USAGE_SCALE) * 100.0
                    }
                }
            }
            
            vm_deallocate(mach_task_self_, vm_address_t(bitPattern: threadList), vm_size_t(threadCount * UInt32(MemoryLayout<thread_t>.stride)))
        }
        
        return totalUsage
    }
    
    @objc public var isCPUHigh: Bool {
        return rollingCPUAverage >= 60.0
    }
}
