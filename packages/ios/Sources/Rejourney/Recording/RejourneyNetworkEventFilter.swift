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

enum RejourneyNetworkEventFilter {
    private static let lock = NSLock()
    private static let internalPathPrefixes = [
        "/api/sdk/config",
        "/api/ingest",
        "/upload/artifacts"
    ]
    private static let maxRegisteredInternalURLs = 200
    private static var apiBasePath = normalizeBasePath("https://api.rejourney.co")
    private static var registeredInternalURLs: [String] = []

    static func configure(apiURLString: String) {
        lock.lock()
        apiBasePath = normalizeBasePath(apiURLString)
        registeredInternalURLs.removeAll()
        lock.unlock()
    }

    static func registerInternalURL(urlString: String) {
        guard let normalized = normalizeURLString(urlString) else { return }
        lock.lock()
        if !registeredInternalURLs.contains(normalized) {
            registeredInternalURLs.append(normalized)
            if registeredInternalURLs.count > maxRegisteredInternalURLs {
                registeredInternalURLs.removeFirst(registeredInternalURLs.count - maxRegisteredInternalURLs)
            }
        }
        lock.unlock()
    }

    static func shouldIgnore(url: URL) -> Bool {
        if isRegisteredInternalURL(url) {
            return true
        }

        return shouldIgnore(path: url.path.isEmpty ? "/" : url.path)
    }

    static func shouldIgnore(details: [String: Any]) -> Bool {
        if let urlString = details["url"] as? String,
           let url = URL(string: urlString),
           shouldIgnore(url: url) {
            return true
        }

        if let path = details["urlPath"] as? String {
            return shouldIgnore(path: path)
        }

        return false
    }

    private static func shouldIgnore(path: String) -> Bool {
        let normalizedPath = normalizePath(path)
        let basePath = currentAPIBasePath()
        let prefixes: [String]
        if basePath.isEmpty {
            prefixes = internalPathPrefixes
        } else {
            prefixes = internalPathPrefixes + internalPathPrefixes.map { normalizePath("\(basePath)\($0)") }
        }

        return prefixes.contains { prefix in
            normalizedPath == prefix || normalizedPath.hasPrefix("\(prefix)/")
        }
    }

    private static func isRegisteredInternalURL(_ url: URL) -> Bool {
        guard let normalized = normalizeURL(url) else { return false }
        lock.lock()
        defer { lock.unlock() }
        return registeredInternalURLs.contains(normalized)
    }

    private static func currentAPIBasePath() -> String {
        lock.lock()
        defer { lock.unlock() }
        return apiBasePath
    }

    private static func normalizeBasePath(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        let url = URL(string: trimmed) ?? URL(string: "https://\(trimmed)")
        guard let path = url?.path, !path.isEmpty, path != "/" else { return "" }
        return normalizePath(path)
    }

    private static func normalizePath(_ value: String) -> String {
        let path = value.hasPrefix("/") ? value : "/\(value)"
        guard path.count > 1 else { return "/" }
        let trimmed = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return trimmed.isEmpty ? "/" : "/\(trimmed)"
    }

    private static func normalizeURLString(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard let url = URL(string: trimmed) else {
            return trimmed.components(separatedBy: "#").first
        }
        return normalizeURL(url)
    }

    private static func normalizeURL(_ url: URL) -> String? {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url.absoluteString.components(separatedBy: "#").first
        }
        components.fragment = nil
        return components.string
    }
}
