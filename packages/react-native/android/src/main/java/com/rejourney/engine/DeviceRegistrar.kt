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

package com.rejourney.engine

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Establishes device identity and obtains upload credentials
 * Android implementation aligned with iOS DeviceRegistrar.swift
 */
class DeviceRegistrar private constructor(private val context: Context) {
    
    companion object {
        @Volatile
        private var instance: DeviceRegistrar? = null
        
        fun getInstance(context: Context): DeviceRegistrar {
            return instance ?: synchronized(this) {
                instance ?: DeviceRegistrar(context.applicationContext).also { instance = it }
            }
        }
        
        // For static access pattern matching iOS
        val shared: DeviceRegistrar?
            get() = instance
    }
    
    // Public Configuration
    var endpoint: String = "https://api.rejourney.co"
    var apiToken: String? = null
    
    // Public State
    var deviceFingerprint: String? = null
        private set
    var uploadCredential: String? = null
        private set
    var credentialValid: Boolean = false
        private set
    
    // Private State
    private val prefsKey = "com.rejourney.device"
    private val fingerprintKey = "device_fingerprint"
    private val fallbackIdKey = "device_fallback_id"
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS) // Short timeout for debugging
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()
    
    init {
        establishIdentity()
    }
    
    // Credential Management
    
    fun obtainCredential(apiToken: String, callback: (Boolean, String?) -> Unit) {
        DiagnosticLog.notice("[DeviceRegistrar] ★★★ obtainCredential v2 ★★★")
        DiagnosticLog.notice("[DeviceRegistrar] obtainCredential called, apiToken=${apiToken.take(12)}...")
        this.apiToken = apiToken
        
        val fingerprint = deviceFingerprint
        if (fingerprint == null) {
            DiagnosticLog.caution("[DeviceRegistrar] No fingerprint available!")
            callback(false, "Device identity unavailable")
            return
        }
        DiagnosticLog.notice("[DeviceRegistrar] Fingerprint OK, fetching credential from server")
        
        scope.launch {
            fetchServerCredential(fingerprint, apiToken, callback)
        }
    }
    
    fun invalidateCredential() {
        uploadCredential = null
        credentialValid = false
    }
    
    // Device Profile
    
    fun gatherDeviceProfile(): Map<String, Any> {
        val displayMetrics = context.resources.displayMetrics
        val packageInfo = try {
            context.packageManager.getPackageInfo(context.packageName, 0)
        } catch (e: Exception) {
            null
        }
        
        return mapOf(
            "fingerprint" to (deviceFingerprint ?: ""),
            "os" to "android",
            "hwModel" to Build.MODEL,
            "osRelease" to Build.VERSION.RELEASE,
            "sdkInt" to Build.VERSION.SDK_INT,
            "appRelease" to (packageInfo?.versionName ?: "unknown"),
            "buildId" to (packageInfo?.let { 
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) it.longVersionCode.toString() 
                else @Suppress("DEPRECATION") it.versionCode.toString() 
            } ?: "unknown"),
            "displayWidth" to displayMetrics.widthPixels,
            "displayHeight" to displayMetrics.heightPixels,
            "displayDensity" to displayMetrics.density,
            "region" to java.util.Locale.getDefault().toString(),
            "tz" to java.util.TimeZone.getDefault().id,
            "manufacturer" to Build.MANUFACTURER,
            "brand" to Build.BRAND,
            "device" to Build.DEVICE,
            "simulated" to isEmulator()
        )
    }
    
    fun composeAuthHeaders(): Map<String, String> {
        val headers = mutableMapOf<String, String>()
        
        apiToken?.let { token ->
            headers["x-rejourney-key"] = token
        }
        uploadCredential?.let { cred ->
            headers["x-upload-token"] = cred
        }
        
        return headers
    }
    
    // Identity Establishment
    
    private fun establishIdentity() {
        val prefs = context.getSharedPreferences(prefsKey, Context.MODE_PRIVATE)
        val stored = prefs.getString(fingerprintKey, null)
        
        if (stored != null) {
            deviceFingerprint = stored
            return
        }
        
        val fresh = generateFingerprint()
        deviceFingerprint = fresh
        prefs.edit().putString(fingerprintKey, fresh).apply()
    }
    
    private fun generateFingerprint(): String {
        val packageName = context.packageName
        
        var composite = packageName
        composite += Build.MODEL
        composite += Build.MANUFACTURER
        composite += getAndroidId()
        
        return sha256(composite)
    }
    
    private fun getAndroidId(): String {
        return try {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
                ?: stableDeviceFallback()
        } catch (e: Exception) {
            stableDeviceFallback()
        }
    }
    
    /**
     * Returns a SharedPreferences-persisted UUID so the fingerprint stays stable
     * even when ANDROID_ID is unavailable (restricted profiles, some OEM devices).
     */
    private fun stableDeviceFallback(): String {
        val prefs = context.getSharedPreferences(prefsKey, Context.MODE_PRIVATE)
        val existing = prefs.getString(fallbackIdKey, null)
        if (existing != null) return existing
        
        val fresh = java.util.UUID.randomUUID().toString()
        prefs.edit().putString(fallbackIdKey, fresh).apply()
        return fresh
    }
    
    // Server Communication
    
    private suspend fun fetchServerCredential(
        fingerprint: String,
        apiToken: String,
        callback: (Boolean, String?) -> Unit
    ) {
        val requestStartTime = System.currentTimeMillis()
        DiagnosticLog.notice("[DeviceRegistrar] fetchServerCredential: starting request to $endpoint")
        DiagnosticLog.debugCredentialFlow("START", fingerprint, true, "apiToken=${apiToken.take(12)}...")
        
        val url = "$endpoint/api/ingest/auth/device"
        
        val profile = gatherDeviceProfile()
        val payload = JSONObject().apply {
            put("deviceId", fingerprint)
            put("metadata", JSONObject(profile))
        }
        
        DiagnosticLog.debugNetworkRequest("POST", url, mapOf("x-rejourney-key" to apiToken))
        
        val requestBody = payload.toString().toRequestBody("application/json".toMediaType())
        
        val request = Request.Builder()
            .url(url)
            .post(requestBody)
            .header("Content-Type", "application/json")
            .header("x-rejourney-key", apiToken)
            .build()
        
        try {
            val response = httpClient.newCall(request).execute()
            val durationMs = System.currentTimeMillis() - requestStartTime
            val body = response.body?.string()
            
            DiagnosticLog.notice("[DeviceRegistrar] Response: code=${response.code}, bodyLen=${body?.length ?: 0}, duration=${durationMs}ms")
            DiagnosticLog.debugNetworkResponse(url, response.code, body?.length ?: 0, durationMs.toDouble())
            
            if (response.isSuccessful && body != null) {
                try {
                    val json = JSONObject(body)
                    val token = json.optString("uploadToken", null)
                    if (token != null) {
                        DiagnosticLog.notice("[DeviceRegistrar] Got uploadToken from server")
                        DiagnosticLog.debugCredentialFlow("SUCCESS", fingerprint, true, "Got server credential uploadToken=${token.take(12)}...")
                        uploadCredential = token
                        credentialValid = true
                        withContext(Dispatchers.Main) { callback(true, token) }
                        return
                    }
                } catch (e: Exception) {
                    DiagnosticLog.notice("[DeviceRegistrar] JSON parse error: ${e.message}")
                    DiagnosticLog.debugCredentialFlow("PARSE_ERROR", fingerprint, false, e.message ?: "")
                }
            } else {
                val bodyPreview = body?.take(200) ?: "empty"
                DiagnosticLog.notice("[DeviceRegistrar] Server error: ${response.code}")
                DiagnosticLog.debugCredentialFlow("HTTP_ERROR", fingerprint, false, "status=${response.code} body=$bodyPreview")
            }
            
            // Fallback to local credential
            DiagnosticLog.notice("[DeviceRegistrar] Using local fallback credential")
            DiagnosticLog.debugCredentialFlow("FALLBACK", fingerprint, true, "Using local credential after server error")
            uploadCredential = synthesizeLocalCredential(fingerprint, apiToken)
            credentialValid = true
            withContext(Dispatchers.Main) { callback(true, uploadCredential) }
            
        } catch (e: Exception) {
            val durationMs = System.currentTimeMillis() - requestStartTime
            DiagnosticLog.notice("[DeviceRegistrar] Network exception: ${e.message}, using fallback")
            DiagnosticLog.debugCredentialFlow("FALLBACK", fingerprint, true, "No response, using local credential error=${e.message}")
            DiagnosticLog.debugNetworkResponse(url, 0, 0, durationMs.toDouble())
            
            uploadCredential = synthesizeLocalCredential(fingerprint, apiToken)
            credentialValid = true
            withContext(Dispatchers.Main) { callback(true, uploadCredential) }
        }
    }
    
    private fun synthesizeLocalCredential(fingerprint: String, apiToken: String): String {
        val timestamp = System.currentTimeMillis() / 1000
        val composite = "$apiToken:$fingerprint:$timestamp"
        return sha256(composite)
    }
    
    // Hardware Detection
    
    private fun isEmulator(): Boolean {
        return (Build.FINGERPRINT.startsWith("generic")
                || Build.FINGERPRINT.startsWith("unknown")
                || Build.MODEL.contains("google_sdk")
                || Build.MODEL.contains("Emulator")
                || Build.MODEL.contains("Android SDK built for x86")
                || Build.MANUFACTURER.contains("Genymotion")
                || (Build.BRAND.startsWith("generic") && Build.DEVICE.startsWith("generic"))
                || "google_sdk" == Build.PRODUCT)
    }
    
    // Cryptographic Helpers
    
    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
