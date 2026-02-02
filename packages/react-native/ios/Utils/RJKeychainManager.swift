import Foundation
import Security

@objcMembers
public class RJKeychainManager: NSObject {
    
    public static let shared = RJKeychainManager()
    
    private let serviceName = "com.rejourney.sdk"
    
    private override init() {
        super.init()
    }
    
    // MARK: - Query Builder
    
    private func baseQuery(key: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
    }
    
    // MARK: - Public API
    
    @discardableResult
    public func setString(_ value: String, forKey key: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        
        let query = baseQuery(key: key)
        
        // Delete existing item first to ensure upsert behavior
        SecItemDelete(query as CFDictionary)
        
        var newQuery = query
        newQuery[kSecValueData as String] = data
        
        let status = SecItemAdd(newQuery as CFDictionary, nil)
        
        if status == errSecSuccess {
            RJLogger.logDebugMessage("Keychain: Stored value for key '\(key)'")
            return true
        } else {
            RJLogger.logErrorMessage("Keychain: Failed to store value for key '\(key)' (status: \(status))")
            return false
        }
    }
    
    public func stringForKey(_ key: String) -> String? {
        var query = baseQuery(key: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        if status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) {
            return value
        }
        
        return nil
    }
    
    @discardableResult
    public func deleteValue(forKey key: String) -> Bool {
        let query = baseQuery(key: key)
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
    
    public func clearAll() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName
        ]
        
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess {
            RJLogger.logDebugMessage("Keychain: Cleared all Rejourney items")
        }
    }
}
