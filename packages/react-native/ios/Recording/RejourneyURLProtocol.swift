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
public class RejourneyURLProtocol: URLProtocol, URLSessionDataDelegate, URLSessionTaskDelegate {
    
    // We tag requests that we've already handled so we don't intercept them repeatedly.
    private static let _handledKey = "co.rejourney.handled"
    
    private var _dataTask: URLSessionDataTask?
    private var _startMs: Int64 = 0
    private var _endMs: Int64 = 0
    private var _responseData: Data?
    private var _response: URLResponse?
    private var _error: Error?
    
    // Session used to forward the intercepted request execution
    private lazy var _session: URLSession = {
        let config = URLSessionConfiguration.default
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    
    @objc public static func enable() {
        URLProtocol.registerClass(RejourneyURLProtocol.self)
        // Hook into default session configs
        if let method = class_getInstanceMethod(URLSessionConfiguration.self, #selector(getter: URLSessionConfiguration.protocolClasses)) {
            let original = method_getImplementation(method)
            // Note: Safest swizzling approach for URLSessionConfiguration here is complex,
            // standard approach is registering the protocol which covers shared sessions and simple setups.
        }
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
        
        // Ignore requests to the Rejourney API endpoints themselves to prevent ingestion duplication
        if let host = url.host, host.contains("api.rejourney.co") {
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
        _dataTask = _session.dataTask(with: request as URLRequest)
        _dataTask?.resume()
    }
    
    public override func stopLoading() {
        _dataTask?.cancel()
        _dataTask = nil
    }
    
    // MARK: - URLSessionDataDelegate
    
    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        client?.urlProtocol(self, didLoad: data)
    }
    
    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        _response = response
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .allowed)
        completionHandler(.allow)
    }
    
    // MARK: - URLSessionTaskDelegate
    
    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        _endMs = Int64(Date().timeIntervalSince1970 * 1000)
        _error = error
        
        if let error = error {
            client?.urlProtocol(self, didFailWithError: error)
        } else {
            client?.urlProtocolDidFinishLoading(self)
        }
        
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
