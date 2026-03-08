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

/// Intercepts URLSession network traffic globally for Rejourney Session Replay.
@objc(RejourneyURLProtocol)
public class RejourneyURLProtocol: URLProtocol {
    
    private static let _handledKey = "co.rejourney.handled"
    
    private var _dataTask: URLSessionDataTask?
    private var _startMs: Int64 = 0
    private var _endMs: Int64 = 0
    private var _response: URLResponse?
    private var _error: Error?
    
    /// Shared forwarding session. Uses ephemeral config with protocol classes
    /// stripped to prevent self-interception, and a delegate adapter that routes
    /// callbacks to the correct RejourneyURLProtocol instance via a task map.
    /// This avoids the per-instance URLSession retain cycle that previously
    /// leaked every intercepted request (~1-3MB each).
    private static let _delegateAdapter = SessionDelegateAdapter()
    private static let _sharedSession: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = []
        return URLSession(configuration: cfg, delegate: _delegateAdapter, delegateQueue: nil)
    }()
    
    @objc public static func enable() {
        URLProtocol.registerClass(RejourneyURLProtocol.self)
        
        // Swizzle URLSessionConfiguration.protocolClasses to automatically inject our protocol
        // into custom sessions (e.g. used by SDWebImage, AlamoFire, etc.)
        swizzleProtocolClasses()
    }
    
    private static var isSwizzled = false
    
    /// Store the original IMP so we can call through to it safely.
    private static var originalProtocolClassesIMP: IMP?
    
    private static func swizzleProtocolClasses() {
        guard !isSwizzled else { return }
        
        let configClass: AnyClass = URLSessionConfiguration.self
        let originalSel = #selector(getter: URLSessionConfiguration.protocolClasses)
        let swizzledSel = #selector(RejourneyURLProtocol.rj_protocolClasses)
        
        guard let originalMethod = class_getInstanceMethod(configClass, originalSel),
              let swizzledMethod = class_getInstanceMethod(RejourneyURLProtocol.self, swizzledSel) else {
            return
        }
        
        // Add the swizzled method onto URLSessionConfiguration itself so that
        // method_exchangeImplementations works within a single class.
        let didAdd = class_addMethod(
            configClass,
            swizzledSel,
            method_getImplementation(swizzledMethod),
            method_getTypeEncoding(swizzledMethod)
        )
        
        if didAdd, let addedMethod = class_getInstanceMethod(configClass, swizzledSel) {
            originalProtocolClassesIMP = method_getImplementation(originalMethod)
            method_exchangeImplementations(originalMethod, addedMethod)
        }
        
        isSwizzled = true
    }
    
    /// Replacement getter injected into URLSessionConfiguration.
    /// After exchange, `self` IS a URLSessionConfiguration instance.
    @objc private func rj_protocolClasses() -> [AnyClass]? {
        // Call through to the original implementation via the saved IMP
        typealias OriginalFunc = @convention(c) (AnyObject, Selector) -> [AnyClass]?
        var classes: [AnyClass] = []
        
        if let imp = RejourneyURLProtocol.originalProtocolClassesIMP {
            let original = unsafeBitCast(imp, to: OriginalFunc.self)
            classes = original(self, #selector(getter: URLSessionConfiguration.protocolClasses)) ?? []
        }
        
        // Inject our protocol at the beginning if not already present
        if !classes.contains(where: { $0 == RejourneyURLProtocol.self }) {
            classes.insert(RejourneyURLProtocol.self, at: 0)
        }
        
        return classes
    }

    
    @objc public static func disable() {
        URLProtocol.unregisterClass(RejourneyURLProtocol.self)
    }
    
    public override class func canInit(with request: URLRequest) -> Bool {
        guard let url = request.url,
              let scheme = url.scheme,
              ["http", "https"].contains(scheme) else {
            return false
        }
        
        // Prevent infinite loop by not intercepting our own forwarded requests
        if URLProtocol.property(forKey: RejourneyURLProtocol._handledKey, in: request) != nil {
            return false
        }
        
        return true
    }
    
    public override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        return request
    }
    
    public override func startLoading() {
        guard let request = (request as NSURLRequest).mutableCopy() as? NSMutableURLRequest else {
            return
        }
        
        URLProtocol.setProperty(true, forKey: RejourneyURLProtocol._handledKey, in: request)
        
        _startMs = Int64(Date().timeIntervalSince1970 * 1000)
        let task = Self._sharedSession.dataTask(with: request as URLRequest)
        Self._delegateAdapter.register(task: task, protocol: self)
        _dataTask = task
        task.resume()
    }
    
    public override func stopLoading() {
        if let task = _dataTask {
            Self._delegateAdapter.unregister(task: task)
            task.cancel()
        }
        _dataTask = nil
    }
    
    // MARK: - Callbacks from SessionDelegateAdapter
    
    fileprivate func handleDidReceiveData(_ data: Data) {
        client?.urlProtocol(self, didLoad: data)
    }
    
    fileprivate func handleDidReceiveResponse(_ response: URLResponse) {
        _response = response
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .allowed)
    }
    
    fileprivate func handleDidComplete(error: Error?) {
        _endMs = Int64(Date().timeIntervalSince1970 * 1000)
        _error = error
        
        if let error = error {
            client?.urlProtocol(self, didFailWithError: error)
        } else {
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    
    fileprivate func handleDidCompleteLogging(task: URLSessionTask) {
        _logRequest(task: task)
    }
    
    private func _logRequest(task: URLSessionTask) {
        guard let req = task.originalRequest, let url = req.url else { return }
        
        let duration = _endMs - _startMs
        let isSuccess = _error == nil && ((_response as? HTTPURLResponse)?.statusCode ?? 0) < 400
        let statusCode = (_response as? HTTPURLResponse)?.statusCode ?? 0
        let method = req.httpMethod ?? "GET"
        
        var urlStr = url.absoluteString
        if urlStr.count > 300 {
            urlStr = String(urlStr.prefix(300))
        }
        
        let pathStr = url.path
        let reqSize = req.httpBody?.count ?? 0
        let resSize = task.countOfBytesReceived
        
        var event: [String: Any] = [
            "requestId": "n_\(UUID().uuidString)",
            "method": method,
            "url": urlStr,
            "urlPath": pathStr.isEmpty ? "/" : pathStr,
            "urlHost": url.host ?? "",
            "statusCode": statusCode,
            "duration": duration,
            "startTimestamp": _startMs,
            "endTimestamp": _endMs,
            "success": isSuccess
        ]
        
        if reqSize > 0 { event["requestBodySize"] = reqSize }
        if resSize > 0 { event["responseBodySize"] = resSize }
        
        if let cType = req.value(forHTTPHeaderField: "Content-Type") {
            event["requestContentType"] = cType
        }
        
        if let hr = _response as? HTTPURLResponse, let cType = hr.value(forHTTPHeaderField: "Content-Type") {
            event["responseContentType"] = cType
        }
        
        if let e = _error {
            event["errorMessage"] = e.localizedDescription
        }
        
        TelemetryPipeline.shared.recordNetworkEvent(details: event)
    }
}

/// Routes URLSession delegate callbacks to the correct RejourneyURLProtocol
/// instance using a task-to-protocol map. Uses weak references to avoid
/// retaining protocol instances that have been stopped by the URL loading system.
private final class SessionDelegateAdapter: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    private let _lock = NSLock()
    private let _taskMap = NSMapTable<URLSessionTask, RejourneyURLProtocol>.strongToWeakObjects()
    
    func register(task: URLSessionTask, protocol proto: RejourneyURLProtocol) {
        _lock.lock()
        _taskMap.setObject(proto, forKey: task)
        _lock.unlock()
    }
    
    func unregister(task: URLSessionTask) {
        _lock.lock()
        _taskMap.removeObject(forKey: task)
        _lock.unlock()
    }
    
    private func proto(for task: URLSessionTask) -> RejourneyURLProtocol? {
        _lock.lock()
        defer { _lock.unlock() }
        return _taskMap.object(forKey: task)
    }
    
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        proto(for: dataTask)?.handleDidReceiveData(data)
    }
    
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        proto(for: dataTask)?.handleDidReceiveResponse(response)
        completionHandler(.allow)
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let p = proto(for: task) else { return }
        p.handleDidComplete(error: error)
        p.handleDidCompleteLogging(task: task)
        unregister(task: task)
    }
}
