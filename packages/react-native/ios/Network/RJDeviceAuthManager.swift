
import Foundation
import Security
import CommonCrypto

// MARK: - Rejourney Device Authentication Manager (Swift)

/**
 * Manages device authentication, key generation, and token management.
 * Replaces the legacy Objective-C implementation using Swift actors for thread safety.
 */
@objc(RJDeviceAuthManager)
public class RJDeviceAuthManager: NSObject {
    
    // MARK: - Constants
    
    private let keychainKeyTag = "com.rejourney.devicekey"
    private let deviceCredentialKey = "RJDeviceCredentialId"
    private let uploadTokenKey = "RJUploadToken"
    private let uploadTokenExpiryKey = "RJUploadTokenExpiry"
    
    // MARK: - State (Actor-protected via isolation or explicit MainActor if strictly needed,
    // but here we use a private serial queue or internal locking for ObjC interop, or just @MainActor for simplicity if acceptable.
    // Given this is called from arbitrary threads, we'll use an internal serial queue or NSLock for the properties exposed to ObjC).
    
    // For true Swift replacement, we'd use an actor, but we need @objc getters.
    // We'll use a lock for thread-safe property access.
    private let stateLock = NSLock()
    
    private var _cachedDeviceCredentialId: String?
    @objc public var deviceCredentialId: String? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return _cachedDeviceCredentialId
    }
    
    private var _cachedUploadToken: String?
    @objc public var currentUploadToken: String? {
        stateLock.lock()
        defer { stateLock.unlock() }
        if hasValidUploadToken_unlocked {
            return _cachedUploadToken
        }
        return nil
    }
    
    private var _uploadTokenExpiry: Date?
    
    private var hasValidUploadToken_unlocked: Bool {
        guard let _ = _cachedUploadToken, let expiry = _uploadTokenExpiry else {
            return false
        }
        return expiry.timeIntervalSinceNow > 60 // Buffer of 60s
    }
    
    @objc public var hasValidUploadToken: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return hasValidUploadToken_unlocked
    }

    private var apiUrl: String?
    private var projectPublicKey: String?
    
    // MARK: - Singleton
    
    @objc public static let shared = RJDeviceAuthManager()
    
    private override init() {
        super.init()
        loadStoredCredentials()
    }
    
    // MARK: - Public API
    
    @objc public func registerDevice(projectKey: String, bundleId: String, platform: String, sdkVersion: String, apiUrl: String, completion: @escaping (Bool, String?, Error?) -> Void) {
        
        self.stateLock.lock()
        self.apiUrl = apiUrl
        self.projectPublicKey = projectKey
        self.stateLock.unlock()
        
        // Check if already registered
        if let credId = self.deviceCredentialId {
            print("[RJDeviceAuth] Device already registered: \(credId)")
            completion(true, credId, nil)
            return
        }
        
        Task {
            do {
                let privateKey = try getOrCreatePrivateKey()
                guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
                    throw NSError(domain: "RJDeviceAuth", code: 1002, userInfo: [NSLocalizedDescriptionKey: "Failed to extract public key"])
                }
                
                guard let pem = exportPublicKeyToPEM(publicKey) else {
                    throw NSError(domain: "RJDeviceAuth", code: 1003, userInfo: [NSLocalizedDescriptionKey: "Failed to export PEM"])
                }
                
                let credId = try await registerWithBackend(
                    projectKey: projectKey,
                    bundleId: bundleId,
                    platform: platform,
                    sdkVersion: sdkVersion,
                    publicKeyPEM: pem,
                    apiUrl: apiUrl
                )
                
                self.saveDeviceCredentialId(credId)
                
                DispatchQueue.main.async {
                    completion(true, credId, nil)
                }
            } catch {
                print("[RJDeviceAuth] Registration failed: \(error)")
                DispatchQueue.main.async {
                    completion(false, nil, error)
                }
            }
        }
    }
    
    @objc public func getUploadToken(completion: @escaping (Bool, String?, Int, Error?) -> Void) {
        if hasValidUploadToken {
            stateLock.lock()
            let token = _cachedUploadToken
            let expiry = _uploadTokenExpiry
            stateLock.unlock()
            
            let timeLeft = Int(expiry?.timeIntervalSinceNow ?? 0)
            completion(true, token, timeLeft, nil)
            return
        }
        
        guard let credentialId = deviceCredentialId, let apiUrl = self.apiUrl else {
            completion(false, nil, 0, NSError(domain: "RJDeviceAuth", code: 2001, userInfo: [NSLocalizedDescriptionKey: "Not registered"]))
            return
        }
        
        Task {
            do {
                // 1. Get Challenge
                let (challenge, nonce) = try await requestChallenge(credentialId: credentialId, apiUrl: apiUrl)
                
                // 2. Sign Challenge (Sync operation)
                guard let signature = signChallenge(challenge) else {
                    throw NSError(domain: "RJDeviceAuth", code: 2002, userInfo: [NSLocalizedDescriptionKey: "Failed to sign challenge"])
                }
                
                // 3. Start Session
                let (token, expiresIn) = try await startSession(credentialId: credentialId, challenge: challenge, nonce: nonce, signature: signature, apiUrl: apiUrl)
                
                saveUploadToken(token, expiresIn: expiresIn)
                
                DispatchQueue.main.async {
                    completion(true, token, expiresIn, nil)
                }
            } catch {
                print("[RJDeviceAuth] Token fetch failed: \(error)")
                DispatchQueue.main.async {
                    completion(false, nil, 0, error)
                }
            }
        }
    }
    
    @objc public func clearAllAuthData() {
        stateLock.lock()
        _cachedDeviceCredentialId = nil
        _cachedUploadToken = nil
        _uploadTokenExpiry = nil
        stateLock.unlock()
        
        // Keychain cleanup
        deletePrivateKey()
        RJKeychainManager.shared.deleteValue(forKey: deviceCredentialKey)
        RJKeychainManager.shared.deleteValue(forKey: uploadTokenKey)
        RJKeychainManager.shared.deleteValue(forKey: uploadTokenExpiryKey)
    }
    
    // MARK: - Internal Logic (Async Network)
    
    private func registerWithBackend(projectKey: String, bundleId: String, platform: String, sdkVersion: String, publicKeyPEM: String, apiUrl: String) async throws -> String {
        guard let url = URL(string: "\(apiUrl)/api/devices/register") else { throw URLError(.badURL) }
        
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "projectPublicKey": projectKey,
            "bundleId": bundleId,
            "platform": platform,
            "sdkVersion": sdkVersion,
            "devicePublicKey": publicKeyPEM
        ]
        
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: req)
        
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let credId = json["deviceCredentialId"] as? String else {
            throw URLError(.cannotParseResponse)
        }
        
        return credId
    }
    
    private func requestChallenge(credentialId: String, apiUrl: String) async throws -> (String, String) {
        guard let url = URL(string: "\(apiUrl)/api/devices/challenge") else { throw URLError(.badURL) }
        
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body = ["deviceCredentialId": credentialId]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: req)
        
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        
        if http.statusCode == 403 || http.statusCode == 404 {
            clearAllAuthData()
            throw NSError(domain: "RJDeviceAuth", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "Device credentials rejected"])
        }
        
        guard http.statusCode == 200 else { throw URLError(.badServerResponse) }
        
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let challenge = json["challenge"] as? String,
              let nonce = json["nonce"] as? String else {
            throw URLError(.cannotParseResponse)
        }
        
        return (challenge, nonce)
    }
    
    private func startSession(credentialId: String, challenge: String, nonce: String, signature: String, apiUrl: String) async throws -> (String, Int) {
        guard let url = URL(string: "\(apiUrl)/api/devices/start-session") else { throw URLError(.badURL) }
        
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body = [
            "deviceCredentialId": credentialId,
            "challenge": challenge,
            "signature": signature,
            "nonce": nonce
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: req)
        
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = json["uploadToken"] as? String,
              let expiresIn = json["expiresIn"] as? Int else {
            throw URLError(.cannotParseResponse)
        }
        
        return (token, expiresIn)
    }
    
    // MARK: - Crypto Helpers
    
    private func getOrCreatePrivateKey() throws -> SecKey {
        let tag = keychainKeyTag.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true
        ]
        
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        
        if status == errSecSuccess, let key = item as! SecKey? {
            return key
        }
        
        // Generate new
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tag
            ]
        ]
        
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw error!.takeRetainedValue() as Error
        }
        return key
    }
    
    private func deletePrivateKey() {
        let tag = keychainKeyTag.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom
        ]
        SecItemDelete(query as CFDictionary)
    }
    
    private func exportPublicKeyToPEM(_ key: SecKey) -> String? {
        var error: Unmanaged<CFError>?
        guard let data = SecKeyCopyExternalRepresentation(key, &error) as Data? else {
            return nil
        }
        
        let base64 = data.base64EncodedString(options: .lineLength64Characters)
        return "-----BEGIN PUBLIC KEY-----\n\(base64)\n-----END PUBLIC KEY-----"
    }
    
    private func signChallenge(_ challenge: String) -> String? {
        guard let data = Data(base64Encoded: challenge) else { return nil }
        
        do {
            let privateKey = try getOrCreatePrivateKey()
            var error: Unmanaged<CFError>?
            guard let signature = SecKeyCreateSignature(privateKey, .ecdsaSignatureMessageX962SHA256, data as CFData, &error) as Data? else {
                return nil
            }
            return signature.base64EncodedString()
        } catch {
            return nil
        }
    }
    
    // MARK: - Storage Helpers
    
    private func loadStoredCredentials() {
        if let cred = RJKeychainManager.shared.stringForKey(deviceCredentialKey) {
            _cachedDeviceCredentialId = cred
            _cachedUploadToken = RJKeychainManager.shared.stringForKey(uploadTokenKey)
            if let expiryStr = RJKeychainManager.shared.stringForKey(uploadTokenExpiryKey), let ts = Double(expiryStr) {
                _uploadTokenExpiry = Date(timeIntervalSince1970: ts)
            }
        }
    }
    
    private func saveDeviceCredentialId(_ id: String) {
        stateLock.lock()
        _cachedDeviceCredentialId = id
        stateLock.unlock()
        
        RJKeychainManager.shared.setString(id, forKey: deviceCredentialKey)
    }
    
    private func saveUploadToken(_ token: String, expiresIn: Int) {
        let expiry = Date().addingTimeInterval(TimeInterval(expiresIn))
        
        stateLock.lock()
        _cachedUploadToken = token
        _uploadTokenExpiry = expiry
        stateLock.unlock()
        
        RJKeychainManager.shared.setString(token, forKey: uploadTokenKey)
        RJKeychainManager.shared.setString("\(expiry.timeIntervalSince1970)", forKey: uploadTokenExpiryKey)
    }
}


