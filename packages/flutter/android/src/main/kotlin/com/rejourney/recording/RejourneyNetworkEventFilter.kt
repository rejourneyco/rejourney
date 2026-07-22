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

package com.rejourney.recording

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.URI
import java.util.LinkedHashSet

object RejourneyNetworkEventFilter {
    private val internalPathPrefixes = listOf(
        "/api/sdk/config",
        "/api/ingest",
        "/upload/artifacts"
    )
    private const val maxRegisteredInternalUrls = 200

    @Volatile
    private var apiBasePath: String = normalizeBasePath("https://api.rejourney.co")
    private val registeredInternalUrls = LinkedHashSet<String>()

    fun configure(apiUrl: String?) {
        apiBasePath = normalizeBasePath(apiUrl ?: "https://api.rejourney.co")
        synchronized(registeredInternalUrls) {
            registeredInternalUrls.clear()
        }
    }

    fun registerInternalUrl(url: String?) {
        val normalized = normalizeComparableUrl(url) ?: return
        synchronized(registeredInternalUrls) {
            if (registeredInternalUrls.add(normalized)) {
                while (registeredInternalUrls.size > maxRegisteredInternalUrls) {
                    val first = registeredInternalUrls.iterator().next()
                    registeredInternalUrls.remove(first)
                }
            }
        }
    }

    fun shouldIgnore(url: HttpUrl): Boolean {
        if (isRegisteredInternalUrl(url.toString())) {
            return true
        }
        return shouldIgnorePath(url.encodedPath)
    }

    fun shouldIgnore(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        if (isRegisteredInternalUrl(url)) {
            return true
        }
        return shouldIgnorePath(pathForUrl(url))
    }

    fun shouldIgnore(details: Map<String, Any>): Boolean {
        val url = details["url"] as? String
        if (shouldIgnore(url)) return true

        val path = details["urlPath"] as? String
        return path != null && shouldIgnorePath(path)
    }

    private fun shouldIgnorePath(path: String): Boolean {
        val normalizedPath = normalizePath(path)
        val basePath = apiBasePath
        val prefixes = if (basePath.isBlank()) {
            internalPathPrefixes
        } else {
            internalPathPrefixes + internalPathPrefixes.map { prefix -> normalizePath("$basePath$prefix") }
        }

        return prefixes.any { prefix ->
            normalizedPath == prefix || normalizedPath.startsWith("$prefix/")
        }
    }

    private fun pathForUrl(value: String): String {
        value.toHttpUrlOrNull()?.let { return it.encodedPath }
        return try {
            URI(value).rawPath ?: value.substringBefore('?')
        } catch (_: Exception) {
            value.substringBefore('?')
        }
    }

    private fun isRegisteredInternalUrl(value: String): Boolean {
        val normalized = normalizeComparableUrl(value) ?: return false
        return synchronized(registeredInternalUrls) {
            registeredInternalUrls.contains(normalized)
        }
    }

    private fun normalizeBasePath(value: String): String {
        val trimmed = value.trim()
        if (trimmed.isBlank()) return ""
        val parsed = trimmed.toHttpUrlOrNull() ?: "https://$trimmed".toHttpUrlOrNull()
        val path = parsed?.encodedPath
            ?: try {
                URI(trimmed).rawPath ?: ""
            } catch (_: Exception) {
                ""
            }
        return if (path.isBlank() || path == "/") "" else normalizePath(path)
    }

    private fun normalizePath(value: String): String {
        val withLeadingSlash = if (value.startsWith("/")) value else "/$value"
        val trimmed = withLeadingSlash.trim('/')
        return if (trimmed.isBlank()) "/" else "/$trimmed"
    }

    private fun normalizeComparableUrl(value: String?): String? {
        val trimmed = value?.trim()?.takeIf { it.isNotBlank() } ?: return null
        val parsed = trimmed.toHttpUrlOrNull()
        return parsed?.newBuilder()?.fragment(null)?.build()?.toString()
            ?: trimmed.substringBefore('#')
    }
}
