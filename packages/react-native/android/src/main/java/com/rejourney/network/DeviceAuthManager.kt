/**
 * Device authentication and token management using ECDSA keypairs.
 * Ported from iOS RJDeviceAuthManager with proper cryptographic authentication.
 */
package com.rejourney.network

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.rejourney.core.Constants
import com.rejourney.core.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.security.*
import java.security.spec.ECGenParameterSpec
import java.util.concurrent.TimeUnit

/**
 * Listener interface for authentication failures.
 * Implementations should stop recording and notify the user.
 */
interface AuthFailureListener {
    /**
     * Called when authentication fails due to security errors (403/404).
     * @param errorCode HTTP status code (403 = package name mismatch, 404 = project not found)
     * @param errorMessage Human-readable error message
     * @param domain Error domain for categorization
     */
    fun onAuthenticationFailure(errorCode: Int, errorMessage: String, domain: String)
}

class DeviceAuthManager private constructor(private val context: Context) {

    companion object {
        @Volatile
        private var instance: DeviceAuthManager? = null

        private const val PREFS_NAME = "rejourney_device_auth"
        private const val KEY_CREDENTIAL_ID = "credential_id"
        private const val KEY_UPLOAD_TOKEN = "upload_token"
        private const val KEY_TOKEN_EXPIRY = "token_expiry"
        private const val KEY_API_URL = "api_url"
        private const val KEY_PROJECT_PUBLIC_KEY = "project_public_key"
        private const val KEY_BUNDLE_ID = "bundle_id"
        private const val KEY_PLATFORM = "platform"
        private const val KEY_SDK_VERSION = "sdk_version"
        
        private const val KEYSTORE_ALIAS = "com.rejourney.devicekey"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        
        private const val AUTH_COOLDOWN_BASE_MS = 5000L  
        private const val AUTH_COOLDOWN_MAX_MS = 300000L  
        private const val AUTH_MAX_CONSECUTIVE_FAILURES = 10

        fun getInstance(context: Context): DeviceAuthManager {
            return instance ?: synchronized(this) {
                instance ?: DeviceAuthManager(context.applicationContext).also { instance = it }
            }
        }
    }

    var authFailureListener: AuthFailureListener? = null

    private val client = HttpClientProvider.shared

    private val prefs: SharedPreferences by lazy {
        try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            
            EncryptedSharedPreferences.create(
                context,
                PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            Logger.warning("Failed to create encrypted prefs, using standard prefs: ${e.message}")
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }
    }

    init {
        loadStoredRegistrationInfo()
    }

    private var apiUrl: String = ""
    private var projectPublicKey: String = ""
    private var storedBundleId: String = ""
    private var storedPlatform: String = ""
    private var storedSdkVersion: String = ""
    
    // Rate limiting for auto-registration
    @Volatile private var lastFailedRegistrationTime: Long = 0
    @Volatile private var consecutiveFailures: Int = 0
    @Volatile private var registrationInProgress: Boolean = false
    private val pendingTokenCallbacks = mutableListOf<(Boolean, String?, Int, String?) -> Unit>()

    private fun loadStoredRegistrationInfo() {
        apiUrl = prefs.getString(KEY_API_URL, "")?.takeIf { it.startsWith("http") } ?: ""
        projectPublicKey = prefs.getString(KEY_PROJECT_PUBLIC_KEY, "") ?: ""
        storedBundleId = prefs.getString(KEY_BUNDLE_ID, "") ?: ""
        storedPlatform = prefs.getString(KEY_PLATFORM, "") ?: ""
        storedSdkVersion = prefs.getString(KEY_SDK_VERSION, "") ?: ""
    }

    /**
     * Register device with the dashboard server.
     * Generates ECDSA P-256 keypair if needed and stores in Android Keystore.
     */
    fun registerDevice(
        projectKey: String,
        bundleId: String,
        platform: String,
        sdkVersion: String,
        apiUrl: String,
        callback: (success: Boolean, credentialId: String?, error: String?) -> Unit
    ) {
        this.apiUrl = apiUrl
        this.projectPublicKey = projectKey
        this.storedBundleId = bundleId
        this.storedPlatform = platform
        this.storedSdkVersion = sdkVersion
        prefs.edit()
            .putString(KEY_API_URL, apiUrl)
            .putString(KEY_PROJECT_PUBLIC_KEY, projectKey)
            .putString(KEY_BUNDLE_ID, bundleId)
            .putString(KEY_PLATFORM, platform)
            .putString(KEY_SDK_VERSION, sdkVersion)
            .apply()

        val existingCredentialId = prefs.getString(KEY_CREDENTIAL_ID, null)
        if (!existingCredentialId.isNullOrEmpty()) {
            Logger.debug("Device already registered with credential: $existingCredentialId")
            callback(true, existingCredentialId, null)
            return
        }

        val publicKeyPEM = try {
            getOrCreatePublicKeyPEM()
        } catch (e: Exception) {
            Logger.error("Failed to generate ECDSA keypair", e)
            callback(false, null, "Failed to generate keypair: ${e.message}")
            return
        }

        if (publicKeyPEM == null) {
            callback(false, null, "Failed to export public key")
            return
        }

        val requestBody = JSONObject().apply {
            put("projectPublicKey", projectKey)
            put("bundleId", bundleId)
            put("platform", platform)
            put("sdkVersion", sdkVersion)
            put("devicePublicKey", publicKeyPEM)
        }

        Logger.debug("Registering device with backend...")

        val request = Request.Builder()
            .url("$apiUrl/api/devices/register")
            .post(requestBody.toString().toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Logger.error("Device registration failed", e)
                callback(false, null, e.message)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (it.isSuccessful) {
                        try {
                            val json = JSONObject(it.body?.string() ?: "{}")
                            val credentialId = json.optString("deviceCredentialId")
                            
                            prefs.edit().putString(KEY_CREDENTIAL_ID, credentialId).apply()
                            
                            Logger.debug("Device registered: $credentialId")
                            callback(true, credentialId, null)
                        } catch (e: Exception) {
                            Logger.error("Failed to parse registration response", e)
                            callback(false, null, "Failed to parse response")
                        }
                    } else {
                        val errorBody = it.body?.string() ?: ""
                        val errorCode = it.code
                        Logger.error("Registration failed: $errorCode - $errorBody")
                        
                        when (errorCode) {
                            403 -> {
                                // Package name mismatch or access forbidden
                                Logger.error("SECURITY: Package name mismatch or access forbidden")
                                val errorMessage = parseErrorMessage(errorBody) 
                                    ?: "Package name mismatch. The app package name does not match the project configuration."
                                clearCredentials()
                                authFailureListener?.onAuthenticationFailure(403, errorMessage, "RJDeviceAuth")
                                callback(false, null, errorMessage)
                            }
                            404 -> {
                                // Project not found - invalid project key
                                Logger.error("SECURITY: Project not found. Invalid project key.")
                                val errorMessage = parseErrorMessage(errorBody) ?: "Project not found. Invalid project key."
                                clearCredentials()
                                authFailureListener?.onAuthenticationFailure(404, errorMessage, "RJDeviceAuth")
                                callback(false, null, errorMessage)
                            }
                            else -> {
                                callback(false, null, "Registration failed: $errorCode")
                            }
                        }
                    }
                }
            }
        })
    }

    /**
     * Get upload token via challenge-response authentication.
     */
    fun getUploadToken(
        callback: (success: Boolean, token: String?, expiresIn: Int, error: String?) -> Unit
    ) {
        val cachedToken = prefs.getString(KEY_UPLOAD_TOKEN, null)
        val tokenExpiry = prefs.getLong(KEY_TOKEN_EXPIRY, 0)
        
        if (!cachedToken.isNullOrEmpty() && tokenExpiry > System.currentTimeMillis() + 60_000) {
            val remainingSeconds = ((tokenExpiry - System.currentTimeMillis()) / 1000).toInt()
            Logger.debug("Using cached upload token (expires in $remainingSeconds seconds)")
            callback(true, cachedToken, remainingSeconds, null)
            return
        }
        
        val credentialId = prefs.getString(KEY_CREDENTIAL_ID, null)
        if (credentialId.isNullOrEmpty()) {
            Logger.warning("Cannot get upload token: device not registered")
            callback(false, null, 0, "Device not registered")
            return
        }
        
        val savedApiUrl = prefs.getString(KEY_API_URL, null)?.takeIf { it.startsWith("http") } ?: "https://api.rejourney.co"

        requestChallenge(credentialId) { challengeSuccess, challenge, nonce, challengeError ->
            if (!challengeSuccess || challenge == null || nonce == null) {
                callback(false, null, 0, challengeError ?: "Failed to get challenge")
                return@requestChallenge
            }

            val signature = try {
                signChallenge(challenge)
            } catch (e: Exception) {
                Logger.error("Failed to sign challenge", e)
                callback(false, null, 0, "Failed to sign challenge: ${e.message}")
                return@requestChallenge
            }

            if (signature == null) {
                callback(false, null, 0, "Failed to sign challenge")
                return@requestChallenge
            }

            startSession(credentialId, challenge, nonce, signature, callback)
        }
    }

    /**
     * Get current upload token if valid.
     */
    fun getCurrentUploadToken(): String? {
        val token = prefs.getString(KEY_UPLOAD_TOKEN, null)
        val expiry = prefs.getLong(KEY_TOKEN_EXPIRY, 0)
        
        return if (!token.isNullOrEmpty() && expiry > System.currentTimeMillis()) {
            token
        } else {
            null
        }
    }

    /**
     * Suspend function to refresh upload token for coroutine callers.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    suspend fun refreshUploadToken(): Boolean {
        return kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
            getUploadToken { success, _, _, _ ->
                if (continuation.isActive) {
                    continuation.resume(success, onCancellation = { _ -> })
                }
            }
        }
    }

    /**
     * Check if upload token is still valid.
     */
    fun hasValidUploadToken(): Boolean {
        val token = prefs.getString(KEY_UPLOAD_TOKEN, null)
        val expiry = prefs.getLong(KEY_TOKEN_EXPIRY, 0)
        val isValid = !token.isNullOrEmpty() && expiry > System.currentTimeMillis() + 60_000
        Logger.debug("[DeviceAuthManager] hasValidUploadToken: $isValid (token=${if (token.isNullOrEmpty()) "null" else "present"}, expiresIn=${(expiry - System.currentTimeMillis()) / 1000}s)")
        return isValid
    }

    private fun canAutoRegister(): Boolean {
        if (apiUrl.isBlank() || projectPublicKey.isBlank() || storedBundleId.isBlank() ||
            storedPlatform.isBlank() || storedSdkVersion.isBlank()) {
            loadStoredRegistrationInfo()
        }
        return apiUrl.isNotBlank() && projectPublicKey.isNotBlank() &&
            storedBundleId.isNotBlank() && storedPlatform.isNotBlank() &&
            storedSdkVersion.isNotBlank()
    }

    private fun drainPendingCallbacks(
        success: Boolean,
        token: String?,
        expiresIn: Int,
        error: String?
    ) {
        val callbacks = synchronized(pendingTokenCallbacks) {
            val copy = pendingTokenCallbacks.toList()
            pendingTokenCallbacks.clear()
            registrationInProgress = false
            copy
        }
        callbacks.forEach { it(success, token, expiresIn, error) }
    }

    fun getUploadTokenWithAutoRegister(
        callback: (success: Boolean, token: String?, expiresIn: Int, error: String?) -> Unit
    ) {
        if (hasValidUploadToken()) {
            val token = prefs.getString(KEY_UPLOAD_TOKEN, null)
            val expiry = prefs.getLong(KEY_TOKEN_EXPIRY, 0)
            val remainingSeconds = ((expiry - System.currentTimeMillis()) / 1000).toInt()
            callback(true, token, remainingSeconds, null)
            return
        }

        val credentialId = prefs.getString(KEY_CREDENTIAL_ID, null)
        if (!credentialId.isNullOrEmpty()) {
            getUploadToken(callback)
            return
        }

        if (!canAutoRegister()) {
            callback(false, null, 0, "Device not registered and auto-registration not configured")
            return
        }

        if (consecutiveFailures >= AUTH_MAX_CONSECUTIVE_FAILURES) {
            callback(false, null, 0, "Auto-registration disabled after repeated failures")
            return
        }

        val now = System.currentTimeMillis()
        if (consecutiveFailures > 0 && lastFailedRegistrationTime > 0) {
            val cooldown = minOf(
                AUTH_COOLDOWN_BASE_MS * (1L shl (consecutiveFailures - 1)),
                AUTH_COOLDOWN_MAX_MS
            )
            val timeSinceFailure = now - lastFailedRegistrationTime
            if (timeSinceFailure < cooldown) {
                val remaining = (cooldown - timeSinceFailure) / 1000
                callback(false, null, 0, "Rate limited - retry in ${remaining}s")
                return
            }
        }

        synchronized(pendingTokenCallbacks) {
            pendingTokenCallbacks.add(callback)
            if (registrationInProgress) {
                Logger.debug("[DeviceAuthManager] Auto-registration already in progress, callback queued")
                return
            }
            registrationInProgress = true
        }

        registerDevice(
            projectKey = projectPublicKey,
            bundleId = storedBundleId,
            platform = storedPlatform,
            sdkVersion = storedSdkVersion,
            apiUrl = this.apiUrl
        ) { success, _, error ->
            if (!success) {
                consecutiveFailures++
                lastFailedRegistrationTime = System.currentTimeMillis()
                Logger.warning("[DeviceAuthManager] Auto-registration failed: $error")
                drainPendingCallbacks(false, null, 0, error ?: "Registration failed")
                return@registerDevice
            }

            consecutiveFailures = 0
            lastFailedRegistrationTime = 0

            getUploadToken { tokenSuccess, token, expiresIn, tokenError ->
                drainPendingCallbacks(tokenSuccess, token, expiresIn, tokenError)
            }
        }
    }

    /**
     * Ensure a valid upload token exists before proceeding with uploads.
     * This is the critical fix - blocks until token is refreshed if expired/missing.
     * Returns true if token is valid after this call, false if refresh failed.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    suspend fun ensureValidToken(): Boolean {
        Logger.debug("[DeviceAuthManager] ensureValidToken() called")

        loadStoredRegistrationInfo()

        return kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
            getUploadTokenWithAutoRegister { success, token, expiresIn, error ->
                if (continuation.isActive) {
                    if (success && !token.isNullOrEmpty()) {
                        Logger.debug("[DeviceAuthManager] Token refresh SUCCESS (expiresIn=${expiresIn}s)")
                        continuation.resume(true, onCancellation = { _ -> })
                    } else {
                        Logger.error("[DeviceAuthManager] Token refresh FAILED: $error")
                        continuation.resume(false, onCancellation = { _ -> })
                    }
                }
            }
        }
    }

    /**
     * Get stored project public key (for recovery uploads).
     */
    fun getCurrentPublicKey(): String? = prefs.getString(KEY_PROJECT_PUBLIC_KEY, null)
    
    /**
     * Get stored API URL (for recovery uploads).
     */
    fun getCurrentApiUrl(): String? = prefs.getString(KEY_API_URL, null)
    
    /**
     * Get stored device hash (for recovery uploads).
     * This is derived from the credential ID.
     */
    fun getCurrentDeviceHash(): String? = prefs.getString(KEY_CREDENTIAL_ID, null)

    /**
     * Clear stored credentials.
     */
    fun clearCredentials() {
        prefs.edit()
            .remove(KEY_CREDENTIAL_ID)
            .remove(KEY_UPLOAD_TOKEN)
            .remove(KEY_TOKEN_EXPIRY)
            .apply()
        
        try {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
            keyStore.load(null)
            keyStore.deleteEntry(KEYSTORE_ALIAS)
            Logger.debug("Cleared all device auth data")
        } catch (e: Exception) {
            Logger.warning("Failed to delete private key: ${e.message}")
        }
    }

    /**
     * Parse error message from JSON response body.
     */
    private fun parseErrorMessage(responseBody: String): String? {
        return try {
            val json = JSONObject(responseBody)
            val message = json.optString("message", "")
            if (message.isNotBlank()) {
                message
            } else {
                json.optString("error", "").ifBlank { null }
            }
        } catch (e: Exception) {
            null
        }
    }


    /**
     * Get or create ECDSA P-256 keypair and return public key in PEM format.
     */
    private fun getOrCreatePublicKeyPEM(): String? {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)

        if (keyStore.containsAlias(KEYSTORE_ALIAS)) {
            Logger.debug("Loaded existing ECDSA private key")
            val certificate = keyStore.getCertificate(KEYSTORE_ALIAS)
            return exportPublicKeyToPEM(certificate.publicKey)
        }

        Logger.debug("Generating new ECDSA P-256 keypair")
        
        val keyPairGenerator = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_EC,
            ANDROID_KEYSTORE
        )

        val parameterSpec = KeyGenParameterSpec.Builder(
            KEYSTORE_ALIAS,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")) // P-256
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false) 
            .build()

        keyPairGenerator.initialize(parameterSpec)
        val keyPair = keyPairGenerator.generateKeyPair()

        Logger.debug("Successfully generated ECDSA P-256 keypair")
        return exportPublicKeyToPEM(keyPair.public)
    }

    /**
     * Export public key to PEM format.
     */
    private fun exportPublicKeyToPEM(publicKey: PublicKey): String? {
        return try {
            val encoded = publicKey.encoded
            val base64 = Base64.encodeToString(encoded, Base64.NO_WRAP)
            
            // Wrap in PEM format
            "-----BEGIN PUBLIC KEY-----\n$base64\n-----END PUBLIC KEY-----"
        } catch (e: Exception) {
            Logger.error("Failed to export public key", e)
            null
        }
    }

    /**
     * Sign a challenge using the private key.
     */
    private fun signChallenge(challenge: String): String? {
        return try {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
            keyStore.load(null)

            val privateKey = keyStore.getKey(KEYSTORE_ALIAS, null) as? PrivateKey
                ?: run {
                    // Critical error: Key missing but we have a credential ID.
                    // This implies a corrupted state (e.g. app backup restored prefs but not keystore).
                    // We MUST clear credentials to allow re-registration.
                    Logger.error("CRITICAL: Private key not found for existing credential. Clearing credentials.")
                    clearCredentials()
                    throw Exception("Private key not found - credentials cleared")
                }

            val challengeBytes = Base64.decode(challenge, Base64.DEFAULT)

            val signature = Signature.getInstance("SHA256withECDSA")
            signature.initSign(privateKey)
            signature.update(challengeBytes)
            val signatureBytes = signature.sign()

            // Return base64-encoded signature
            Base64.encodeToString(signatureBytes, Base64.NO_WRAP)
        } catch (e: Exception) {
            Logger.error("Failed to sign challenge", e)
            if (e.message?.contains("Private key not found") == true) {
                 clearCredentials()
            }
            null
        }
    }


    /**
     * Request challenge from backend.
     */
    private fun requestChallenge(
        credentialId: String,
        callback: (success: Boolean, challenge: String?, nonce: String?, error: String?) -> Unit
    ) {
        val requestBody = JSONObject().apply {
            put("deviceCredentialId", credentialId)
        }
        
        Logger.debug("Requesting challenge from backend...")
        
        val request = Request.Builder()
            .url("$apiUrl/api/devices/challenge")
            .post(requestBody.toString().toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Logger.error("Challenge request failed", e)
                callback(false, null, null, e.message)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (it.isSuccessful) {
                        try {
                            val json = JSONObject(it.body?.string() ?: "{}")
                            val challenge = json.optString("challenge")
                            val nonce = json.optString("nonce")
                            
                            Logger.debug("Received challenge from backend")
                            callback(true, challenge, nonce, null)
                        } catch (e: Exception) {
                            Logger.error("Failed to parse challenge response", e)
                            callback(false, null, null, "Failed to parse response")
                        }
                    } else {
                        val errorBody = it.body?.string() ?: ""
                        val errorCode = it.code
                        Logger.error("Challenge request failed: $errorCode - $errorBody")
                        
                        when (errorCode) {
                            403 -> {
                                Logger.error("SECURITY: Challenge request forbidden")
                                val errorMessage = parseErrorMessage(errorBody) ?: "Access forbidden"
                                clearCredentials()
                                authFailureListener?.onAuthenticationFailure(403, errorMessage, "RJDeviceAuth")
                                callback(false, null, null, errorMessage)
                            }
                            404 -> {
                                Logger.error("SECURITY: Device credential not found")
                                val errorMessage = parseErrorMessage(errorBody) ?: "Credential not found"
                                clearCredentials()
                                authFailureListener?.onAuthenticationFailure(404, errorMessage, "RJDeviceAuth")
                                callback(false, null, null, errorMessage)
                            }
                            else -> {
                                callback(false, null, null, "Challenge request failed: $errorCode")
                            }
                        }
                    }
                }
            }
        })
    }

    /**
     * Start session with signed challenge to get upload token.
     */
    private fun startSession(
        credentialId: String,
        challenge: String,
        nonce: String,
        signature: String,
        callback: (success: Boolean, token: String?, expiresIn: Int, error: String?) -> Unit
    ) {
        val requestBody = JSONObject().apply {
            put("deviceCredentialId", credentialId)
            put("challenge", challenge)
            put("signature", signature)
            put("nonce", nonce)
        }
        
        Logger.debug("Starting session with signed challenge...")
        
        val request = Request.Builder()
            .url("$apiUrl/api/devices/start-session")
            .post(requestBody.toString().toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Logger.error("Start-session request failed", e)
                callback(false, null, 0, e.message)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (it.isSuccessful) {
                        try {
                            val json = JSONObject(it.body?.string() ?: "{}")
                            val token = json.optString("uploadToken")
                            val expiresIn = json.optInt("expiresIn", 3600)
                            
                            // Cache token
                            prefs.edit()
                                .putString(KEY_UPLOAD_TOKEN, token)
                                .putLong(KEY_TOKEN_EXPIRY, System.currentTimeMillis() + (expiresIn * 1000L))
                                .apply()
                            
                            Logger.debug("Got upload token (expires in $expiresIn seconds)")
                            callback(true, token, expiresIn, null)
                        } catch (e: Exception) {
                            Logger.error("Failed to parse start-session response", e)
                            callback(false, null, 0, "Failed to parse response")
                        }
                    } else {
                        val errorBody = it.body?.string() ?: ""
                        val errorCode = it.code
                        Logger.error("Start-session failed: $errorCode - $errorBody")
                        
                        when (errorCode) {
                            403 -> {
                                Logger.error("SECURITY: Start-session forbidden")
                                val errorMessage = parseErrorMessage(errorBody) ?: "Access forbidden"
                                clearCredentials()
                                authFailureListener?.onAuthenticationFailure(403, errorMessage, "RJDeviceAuth")
                                callback(false, null, 0, errorMessage)
                            }
                            404 -> {
                                Logger.error("SECURITY: Start-session resource not found")
                                val errorMessage = parseErrorMessage(errorBody) ?: "Resource not found"
                                clearCredentials()
                                authFailureListener?.onAuthenticationFailure(404, errorMessage, "RJDeviceAuth")
                                callback(false, null, 0, errorMessage)
                            }
                            else -> {
                                callback(false, null, 0, "Start-session failed: $errorCode")
                            }
                        }
                    }
                }
            }
        })
    }
}
