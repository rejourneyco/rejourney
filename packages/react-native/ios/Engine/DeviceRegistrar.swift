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

import UIKit
import CommonCrypto

// MARK: - Device Registrar

/// Establishes device identity and obtains upload credentials
@objc(DeviceRegistrar)
public final class DeviceRegistrar: NSObject {
    
    @objc public static let shared = DeviceRegistrar()
    
    // MARK: Public Configuration
    
    @objc public var endpoint = "https://api.rejourney.co"
    @objc public var apiToken: String?
    
    @objc public private(set) var deviceFingerprint: String?
    @objc public private(set) var uploadCredential: String?
    @objc public private(set) var credentialValid = false
    
    // MARK: Private State
    
    private let _keychainId = "com.rejourney.device.fingerprint"
    
    private lazy var _httpSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config)
    }()
    
    // MARK: Lifecycle
    
    private override init() {
        super.init()
        _establishIdentity()
    }
    
    // MARK: Credential Management
    
    @objc public func obtainCredential(apiToken: String, completion: @escaping (Bool, String?) -> Void) {
        self.apiToken = apiToken
        
        guard let fingerprint = deviceFingerprint else {
            completion(false, "Device identity unavailable")
            return
        }
        
        _fetchServerCredential(fingerprint: fingerprint, apiToken: apiToken, completion: completion)
    }
    
    @objc public func invalidateCredential() {
        uploadCredential = nil
        credentialValid = false
    }
    
    // MARK: Device Profile
    
    @objc public func gatherDeviceProfile() -> [String: Any] {
        let device = UIDevice.current
        let screen = UIScreen.main
        
        return [
            "fingerprint": deviceFingerprint ?? "",
            "os": "ios",
            "hwModel": _resolveHardwareModel(),
            "osRelease": device.systemVersion,
            "appRelease": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
            "buildId": Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown",
            "displayWidth": Int(screen.bounds.width * screen.scale),
            "displayHeight": Int(screen.bounds.height * screen.scale),
            "displayDensity": screen.scale,
            "region": Locale.current.identifier,
            "tz": TimeZone.current.identifier,
            "simulated": _isSimulator()
        ]
    }
    
    public func composeAuthHeaders() -> [String: String] {
        var headers: [String: String] = [:]
        
        if let token = apiToken {
            headers["x-rejourney-key"] = token
        }
        if let credential = uploadCredential {
            headers["x-upload-token"] = credential
        }
        
        return headers
    }
    
    // MARK: Identity Establishment
    
    private func _establishIdentity() {
        if let stored = _keychainLoad(_keychainId) {
            deviceFingerprint = stored
            return
        }
        
        let fresh = _generateFingerprint()
        deviceFingerprint = fresh
        _keychainSave(_keychainId, value: fresh)
    }
    
    private func _generateFingerprint() -> String {
        let device = UIDevice.current
        let bundleId = Bundle.main.bundleIdentifier ?? "unknown"
        
        var composite = bundleId
        composite += device.model
        composite += device.systemName
        composite += device.systemVersion
        composite += device.identifierForVendor?.uuidString ?? UUID().uuidString
        
        return _sha256(composite)
    }
    
    // MARK: Server Communication
    
    private func _fetchServerCredential(fingerprint: String, apiToken: String, completion: @escaping (Bool, String?) -> Void) {
        let requestStartTime = CFAbsoluteTimeGetCurrent()
        DiagnosticLog.debugCredentialFlow(phase: "START", fingerprint: fingerprint, success: true, detail: "apiToken=\(apiToken.prefix(12))...")
        
        guard let url = URL(string: "\(endpoint)/api/ingest/auth/device") else {
            DiagnosticLog.debugCredentialFlow(phase: "ERROR", fingerprint: fingerprint, success: false, detail: "Malformed endpoint URL")
            completion(false, "Malformed endpoint URL")
            return
        }
        
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(apiToken, forHTTPHeaderField: "x-rejourney-key")
        
        let profile = gatherDeviceProfile()
        let payload: [String: Any] = [
            "deviceId": fingerprint,
            "metadata": profile
        ]
        
        DiagnosticLog.debugNetworkRequest(method: "POST", url: url.absoluteString, headers: ["x-rejourney-key": apiToken])
        
        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: payload)
            DiagnosticLog.debugCredentialFlow(phase: "PAYLOAD", fingerprint: fingerprint, success: true, detail: "size=\(req.httpBody?.count ?? 0)B")
        } catch {
            DiagnosticLog.debugCredentialFlow(phase: "ERROR", fingerprint: fingerprint, success: false, detail: "Payload encoding failed: \(error)")
            completion(false, "Payload encoding failed")
            return
        }
        
        _httpSession.dataTask(with: req) { [weak self] data, response, error in
            let requestDurationMs = (CFAbsoluteTimeGetCurrent() - requestStartTime) * 1000
            
            guard let self else {
                DiagnosticLog.debugCredentialFlow(phase: "ERROR", fingerprint: fingerprint, success: false, detail: "Instance released")
                completion(false, "Instance released")
                return
            }
            
            guard let data = data, let httpResp = response as? HTTPURLResponse else {
                DiagnosticLog.debugCredentialFlow(phase: "FALLBACK", fingerprint: fingerprint, success: true, detail: "No response, using local credential error=\(error?.localizedDescription ?? "none")")
                DiagnosticLog.debugNetworkResponse(url: url.absoluteString, status: 0, bodySize: 0, durationMs: requestDurationMs)
                
                self.uploadCredential = self._synthesizeLocalCredential(fingerprint: fingerprint, apiToken: apiToken)
                self.credentialValid = true
                DispatchQueue.main.async { completion(true, self.uploadCredential) }
                return
            }
            
            DiagnosticLog.debugNetworkResponse(url: url.absoluteString, status: httpResp.statusCode, bodySize: data.count, durationMs: requestDurationMs)
            
            if httpResp.statusCode == 200 {
                do {
                    if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let token = json["uploadToken"] as? String {
                        DiagnosticLog.debugCredentialFlow(phase: "SUCCESS", fingerprint: fingerprint, success: true, detail: "Got server credential uploadToken=\(token.prefix(12))...")
                        self.uploadCredential = token
                        self.credentialValid = true
                        DispatchQueue.main.async { completion(true, token) }
                        return
                    }
                } catch {
                    DiagnosticLog.debugCredentialFlow(phase: "PARSE_ERROR", fingerprint: fingerprint, success: false, detail: "\(error)")
                }
            } else {
                let bodyPreview = String(data: data.prefix(200), encoding: .utf8) ?? "binary"
                DiagnosticLog.debugCredentialFlow(phase: "HTTP_ERROR", fingerprint: fingerprint, success: false, detail: "status=\(httpResp.statusCode) body=\(bodyPreview)")
            }
            
            DiagnosticLog.debugCredentialFlow(phase: "FALLBACK", fingerprint: fingerprint, success: true, detail: "Using local credential after server error")
            self.uploadCredential = self._synthesizeLocalCredential(fingerprint: fingerprint, apiToken: apiToken)
            self.credentialValid = true
            DispatchQueue.main.async { completion(true, self.uploadCredential) }
        }.resume()
    }
    
    private func _synthesizeLocalCredential(fingerprint: String, apiToken: String) -> String {
        let timestamp = Int(Date().timeIntervalSince1970)
        let composite = "\(apiToken):\(fingerprint):\(timestamp)"
        return _sha256(composite)
    }
    
    // MARK: Hardware Detection
    
    private func _resolveHardwareModel() -> String {
        var size: Int = 0
        sysctlbyname("hw.machine", nil, &size, nil, 0)
        
        var machine = [CChar](repeating: 0, count: size)
        sysctlbyname("hw.machine", &machine, &size, nil, 0)
        
        return String(cString: machine)
    }
    
    private func _isSimulator() -> Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }
    
    // MARK: Cryptographic Helpers
    
    private func _sha256(_ input: String) -> String {
        guard let data = input.data(using: .utf8) else { return "" }
        
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes { bytes in
            _ = CC_SHA256(bytes.baseAddress, CC_LONG(data.count), &digest)
        }
        
        return digest.map { String(format: "%02x", $0) }.joined()
    }
    
    // MARK: Keychain Operations
    
    private func _keychainSave(_ key: String, value: String) {
        guard let data = value.data(using: .utf8) else { return }
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }
    
    private func _keychainLoad(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            return nil
        }
        
        return value
    }
}
