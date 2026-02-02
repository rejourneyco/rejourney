import Foundation
import UIKit
import React

// MARK: - Delegate Protocol (Objective-C Compatible)

@objc public protocol RJLifecycleManagerDelegate: AnyObject {
    @objc optional func lifecycleManagerDidEnterBackground()
    @objc optional func lifecycleManagerWillTerminate()
    @objc optional func lifecycleManagerDidBecomeActive()
    @objc optional func lifecycleManagerDidResignActive()
    @objc optional func lifecycleManagerKeyboardDidShow(_ keyboardFrame: CGRect)
    @objc optional func lifecycleManagerKeyboardWillHide(_ keyPressCount: Int)
    @objc optional func lifecycleManagerTextDidChange()
    @objc optional func lifecycleManagerSessionDidTimeout(_ backgroundDuration: TimeInterval)
}

// MARK: - Lifecycle Manager

@objcMembers
public class RJLifecycleManager: NSObject {
    
    // MARK: - Public Properties
    
    public weak var delegate: RJLifecycleManagerDelegate?
    
    // Thread-safe state access via internal locking
    private let stateLock = NSLock()
    
    private var _isKeyboardVisible = false
    public var isKeyboardVisible: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return _isKeyboardVisible
    }
    
    private var _currentKeyboardFrame: CGRect = .zero
    public var keyboardFrame: CGRect {
        stateLock.lock()
        defer { stateLock.unlock() }
        return _currentKeyboardFrame
    }
    
    private var _isRecording = false
    public var isRecording: Bool {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return _isRecording
        }
        set {
            stateLock.lock()
            _isRecording = newValue
            stateLock.unlock()
            RJLogger.logInfoMessage("[Swift-Lifecycle] isRecording set to \(newValue)")
        }
    }
    
    private var _inBackground = false
    public var isInBackground: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return _inBackground
    }
    
    private var _backgroundEntryTime: TimeInterval = 0
    public var backgroundEntryTime: TimeInterval {
        stateLock.lock()
        defer { stateLock.unlock() }
        return _backgroundEntryTime
    }
    
    private var _accumulatedBackgroundTimeMs: TimeInterval = 0
    public var totalBackgroundTimeMs: TimeInterval {
        stateLock.lock()
        defer { stateLock.unlock() }
        return _accumulatedBackgroundTimeMs
    }
    
    public var backgroundTimeoutThreshold: TimeInterval = 60.0 // Default 60s
    
    // MARK: - Private State
    
    private var keyPressCount = 0
    private var didOpenExternalURL = false
    private var lastOpenedURLScheme: String?
    
    // MARK: - Initialization
    
    override public init() {
        super.init()
        RJLogger.logInfoMessage("[Swift-Lifecycle] Initialized")
    }
    
    deinit {
        stopObserving()
    }
    
    // MARK: - External API
    
    public func startObserving() {
        let center = NotificationCenter.default
        
        // Keyboard
        center.addObserver(self, selector: #selector(keyboardWillShow), name: UIResponder.keyboardWillShowNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardWillHide), name: UIResponder.keyboardWillHideNotification, object: nil)
        
        // Lifecycle
        center.addObserver(self, selector: #selector(appDidEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(appWillTerminate), name: UIApplication.willTerminateNotification, object: nil)
        center.addObserver(self, selector: #selector(appWillResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(appDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        
        // Text Changes
        center.addObserver(self, selector: #selector(textDidChange), name: UITextField.textDidChangeNotification, object: nil)
        center.addObserver(self, selector: #selector(textDidChange), name: UITextView.textDidChangeNotification, object: nil)
        
        RJLogger.logInfoMessage("[Swift-Lifecycle] Started observing notifications")
    }
    
    public func stopObserving() {
        NotificationCenter.default.removeObserver(self)
        RJLogger.logDebugMessage("[Swift-Lifecycle] Stopped observing")
    }
    
    public func resetBackgroundTime() {
        stateLock.lock()
        defer { stateLock.unlock() }
        RJLogger.logInfoMessage("[Swift-Lifecycle] Resetting background time (was \(_accumulatedBackgroundTimeMs)ms)")
        _accumulatedBackgroundTimeMs = 0
        _inBackground = false
        _backgroundEntryTime = 0
    }
    
    public func markExternalURLOpened(_ urlScheme: String) {
        stateLock.lock()
        didOpenExternalURL = true
        lastOpenedURLScheme = urlScheme
        stateLock.unlock()
    }
    
    // Swift-friendly usage: returns tuple (Bool, String?)
    // ObjC compatibility wrapper is tricky with inout params, but we can do it via a specialized method if needed.
    // For now, implementing exactly as the ObjC header requested for compatibility: reference pointer.
    
    public func consumeExternalURLOpened(scheme: AutoreleasingUnsafeMutablePointer<NSString?>?) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        
        guard didOpenExternalURL else { return false }
        
        if let ptr = scheme, let lastScheme = lastOpenedURLScheme {
            ptr.pointee = lastScheme as NSString
        }
        
        didOpenExternalURL = false
        lastOpenedURLScheme = nil
        return true
    }
    
    // MARK: - Notification Handlers
    
    // Keyboard
    
    @objc private func keyboardWillShow(_ notification: Notification) {
        stateLock.lock()
        _isKeyboardVisible = true
        if let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
            _currentKeyboardFrame = frame
        }
        let recording = _isRecording
        let frame = _currentKeyboardFrame
        stateLock.unlock()
        
        if recording {
            delegate?.lifecycleManagerKeyboardDidShow?(frame)
        }
    }
    
    @objc private func keyboardWillHide(_ notification: Notification) {
        stateLock.lock()
        let recording = _isRecording
        let presses = keyPressCount
        
        if recording && presses > 0 {
            delegate?.lifecycleManagerKeyboardWillHide?(presses)
            keyPressCount = 0
        }
        
        _isKeyboardVisible = false
        _currentKeyboardFrame = .zero
        stateLock.unlock()
    }
    
    @objc private func textDidChange(_ notification: Notification) {
        stateLock.lock()
        if _isRecording {
            keyPressCount += 1
            stateLock.unlock()
            delegate?.lifecycleManagerTextDidChange?()
        } else {
            stateLock.unlock()
        }
    }
    
    // App Lifecycle
    
    @objc private func appWillResignActive(_ notification: Notification) {
        if isRecording {
            delegate?.lifecycleManagerDidResignActive?()
        }
    }
    
    @objc private func appDidEnterBackground(_ notification: Notification) {
        stateLock.lock()
        _inBackground = true
        _backgroundEntryTime = Date().timeIntervalSince1970
        let recording = _isRecording
        stateLock.unlock()
        
        RJLogger.logInfoMessage("[Swift-Lifecycle] Entered background, recording=\(recording)")
        
        if recording {
            delegate?.lifecycleManagerDidEnterBackground?()
        }
    }
    
    @objc private func appWillTerminate(_ notification: Notification) {
        RJLogger.logInfoMessage("[Swift-Lifecycle] App will terminate")
        delegate?.lifecycleManagerWillTerminate?()
    }
    
    @objc private func appDidBecomeActive(_ notification: Notification) {
        let currentTime = Date().timeIntervalSince1970
        
        stateLock.lock()
        let wasInBackground = _inBackground && _backgroundEntryTime > 0
        let entryTime = _backgroundEntryTime
        let recording = _isRecording
        
        _inBackground = false
        _backgroundEntryTime = 0
        
        var backgroundDurationSec: TimeInterval = 0
        if wasInBackground {
            backgroundDurationSec = currentTime - entryTime
        }
        
        stateLock.unlock()
        
        if wasInBackground {
            RJLogger.logInfoMessage("[Swift-Lifecycle] Returned from background after \(String(format: "%.1f", backgroundDurationSec))s, recording=\(recording)")
        }
        
        if !recording {
            // Check for timeout even if not recording (to reset staled sessions)
            if wasInBackground && backgroundDurationSec >= backgroundTimeoutThreshold {
                RJLogger.logInfoMessage("[Swift-Lifecycle] Session timeout while not recording")
                delegate?.lifecycleManagerSessionDidTimeout?(backgroundDurationSec)
            }
            return
        }
        
        if wasInBackground {
            let bgDurationMs = backgroundDurationSec * 1000
            
            stateLock.lock()
            _accumulatedBackgroundTimeMs += bgDurationMs
            let totalBgTime = _accumulatedBackgroundTimeMs
            stateLock.unlock()
            
            if backgroundDurationSec >= backgroundTimeoutThreshold {
                RJLogger.logInfoMessage("[Swift-Lifecycle] TIMEOUT: total bg=\(totalBgTime)ms - signaling restart")
                delegate?.lifecycleManagerSessionDidTimeout?(backgroundDurationSec)
            } else {
                RJLogger.logInfoMessage("[Swift-Lifecycle] Resuming session (total bg=\(totalBgTime)ms)")
            }
        }
        
        delegate?.lifecycleManagerDidBecomeActive?()
    }
}
