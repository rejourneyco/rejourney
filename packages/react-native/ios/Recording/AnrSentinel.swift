import Foundation

@objc(AnrSentinel)
public final class AnrSentinel: NSObject {
    
    @objc public static let shared = AnrSentinel()
    
    private let _freezeThreshold: TimeInterval = 5.0
    private let _pollFrequency: TimeInterval = 2.0
    
    private var _watchThread: Thread?
    private var _volatile = VolatileState()
    private let _stateLock = os_unfair_lock_t.allocate(capacity: 1)
    
    private override init() {
        _stateLock.initialize(to: os_unfair_lock())
        super.init()
    }
    
    deinit {
        _stateLock.deallocate()
    }
    
    @objc public func activate() {
        os_unfair_lock_lock(_stateLock)
        guard _watchThread == nil else {
            os_unfair_lock_unlock(_stateLock)
            return
        }
        
        _volatile.running = true
        _volatile.lastResponse = Date().timeIntervalSince1970
        
        let t = Thread { [weak self] in self?._watchLoop() }
        t.name = "co.rejourney.anr"
        t.qualityOfService = .utility
        _watchThread = t
        os_unfair_lock_unlock(_stateLock)
        
        t.start()
    }
    
    @objc public func halt() {
        os_unfair_lock_lock(_stateLock)
        _volatile.running = false
        _watchThread = nil
        os_unfair_lock_unlock(_stateLock)
    }
    
    private func _watchLoop() {
        while true {
            os_unfair_lock_lock(_stateLock)
            let running = _volatile.running
            os_unfair_lock_unlock(_stateLock)
            guard running else { break }
            
            _sendPing()
            Thread.sleep(forTimeInterval: _pollFrequency)
            _checkPong()
        }
    }
    
    private func _sendPing() {
        os_unfair_lock_lock(_stateLock)
        if _volatile.awaitingPong {
            os_unfair_lock_unlock(_stateLock)
            return
        }
        _volatile.awaitingPong = true
        os_unfair_lock_unlock(_stateLock)
        
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            os_unfair_lock_lock(self._stateLock)
            self._volatile.lastResponse = Date().timeIntervalSince1970
            self._volatile.awaitingPong = false
            os_unfair_lock_unlock(self._stateLock)
        }
    }
    
    private func _checkPong() {
        os_unfair_lock_lock(_stateLock)
        let awaiting = _volatile.awaitingPong
        let last = _volatile.lastResponse
        os_unfair_lock_unlock(_stateLock)
        
        guard awaiting else { return }
        
        let delta = Date().timeIntervalSince1970 - last
        if delta >= _freezeThreshold {
            _reportFreeze(duration: delta)
        }
    }
    
    private func _reportFreeze(duration: TimeInterval) {
        DiagnosticLog.emit(.caution, "Main thread frozen for \(String(format: "%.1f", duration))s")
        
        ReplayOrchestrator.shared.incrementStalledTally()
        
        let trace = Thread.callStackSymbols.joined(separator: "\n")
        let ms = Int(duration * 1000)
        
        TelemetryPipeline.shared.recordCustomEvent(
            name: "anr_detected",
            payload: "{\"durationMs\":\(ms),\"stack\":\"\(trace)\"}"
        )
    }
}

private struct VolatileState {
    var running = false
    var awaitingPong = false
    var lastResponse: TimeInterval = 0
}

@objc(ResponsivenessWatcher)
public final class ResponsivenessWatcher: NSObject {
    @objc public static let shared = ResponsivenessWatcher()
    
    private override init() { super.init() }
    
    @objc public func activate() {
        AnrSentinel.shared.activate()
    }
    
    @objc public func halt() {
        AnrSentinel.shared.halt()
    }
}
