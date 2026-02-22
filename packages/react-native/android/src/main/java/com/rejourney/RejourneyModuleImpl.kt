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

/**
 * Shared implementation for Rejourney React Native module.
 * 
 * Architecture aligned with iOS RejourneyImpl.swift
 * Uses the new recording/engine/utility package structure.
 */
package com.rejourney

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.facebook.react.bridge.*
import com.rejourney.engine.DeviceRegistrar
import com.rejourney.engine.DiagnosticLog
import com.rejourney.platform.OEMDetector
import com.rejourney.platform.SessionLifecycleService
import com.rejourney.platform.TaskRemovedListener
import com.rejourney.recording.*
import kotlinx.coroutines.*
import java.security.MessageDigest
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Session state machine
 */
sealed class SessionState {
    object Idle : SessionState()
    data class Active(val sessionId: String, val startTimeMs: Long) : SessionState()
    data class Paused(val sessionId: String, val startTimeMs: Long) : SessionState()
    object Terminated : SessionState()
}

class RejourneyModuleImpl(
    private val reactContext: ReactApplicationContext,
    private val isNewArchitecture: Boolean
) : Application.ActivityLifecycleCallbacks, DefaultLifecycleObserver {

    companion object {
        const val NAME = "Rejourney"
        var sdkVersion = "1.0.1"
        
        private const val SESSION_TIMEOUT_MS = 60_000L // 60 seconds
        
        private const val PREFS_NAME = "com.rejourney.prefs"
        private const val KEY_USER_IDENTITY = "user_identity"
    }

    // State machine
    private var state: SessionState = SessionState.Idle
    private val stateLock = ReentrantLock()

    // Internal storage
    private var currentUserIdentity: String? = null
    private var backgroundEntryTimeMs: Long? = null
    private var lastSessionConfig: Map<String, Any>? = null
    private var lastApiUrl: String? = null
    private var lastPublicKey: String? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val backgroundScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @Volatile
    private var isInitialized = false
    private val initLock = Any()

    @Volatile
    private var isShuttingDown = false

    init {
        DiagnosticLog.trace("[Rejourney] RejourneyModuleImpl constructor")
    }

    /**
     * Lazy initialization - called on first method invocation
     */
    private fun ensureInitialized() {
        if (isInitialized) return
        
        synchronized(initLock) {
            if (isInitialized) return
            
            try {
                // Initialize core components
                DiagnosticLog.notice("[Rejourney] ensureInitialized: Creating core components...")
                
                // Load persisted identity
                try {
                    val prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    val persistedIdentity = prefs.getString(KEY_USER_IDENTITY, null)
                    if (!persistedIdentity.isNullOrBlank()) {
                        currentUserIdentity = persistedIdentity
                        DiagnosticLog.notice("[Rejourney] Restored persisted user identity: $persistedIdentity")
                    }
                } catch (e: Exception) {
                    DiagnosticLog.fault("[Rejourney] Failed to load persisted identity: ${e.message}")
                }

                DeviceRegistrar.getInstance(reactContext)
                DiagnosticLog.notice("[Rejourney] ensureInitialized: DeviceRegistrar OK")
                SegmentDispatcher.shared  // Uses lazy singleton
                TelemetryPipeline.getInstance(reactContext)
                DiagnosticLog.notice("[Rejourney] ensureInitialized: TelemetryPipeline OK")
                ReplayOrchestrator.getInstance(reactContext)
                DiagnosticLog.notice("[Rejourney] ensureInitialized: ReplayOrchestrator OK")
                VisualCapture.getInstance(reactContext)
                DiagnosticLog.notice("[Rejourney] ensureInitialized: VisualCapture OK, shared=${VisualCapture.shared != null}")
                EventBuffer.getInstance(reactContext)
                InteractionRecorder.getInstance(reactContext)
                ViewHierarchyScanner.shared  // Uses lazy singleton
                StabilityMonitor.getInstance(reactContext)
                AnrSentinel.shared
                
                // Register lifecycle callbacks
                registerActivityLifecycleCallbacks()
                registerProcessLifecycleObserver()
                
                // Transmit any stored crash reports
                StabilityMonitor.getInstance(reactContext).transmitStoredReport()
                
                // Android-specific: OEM detection and task removed handling
                setupOEMSpecificHandling()
                
                DiagnosticLog.notice("[Rejourney] SDK initialized (version: $sdkVersion)")
                isInitialized = true
                
            } catch (e: Exception) {
                DiagnosticLog.fault("[Rejourney] Init failed: ${e.message}")
                isInitialized = true // Mark as initialized to prevent retry loops
            }
        }
    }
    
    /**
     * Android-specific: Set up OEM-aware task removal detection
     * Different Android OEMs have different behaviors for app lifecycle
     */
    private fun setupOEMSpecificHandling() {
        val oem = OEMDetector.getOEM()
        DiagnosticLog.trace("[Rejourney] Device OEM: $oem")
        DiagnosticLog.trace("[Rejourney] OEM Recommendations: ${OEMDetector.getRecommendations()}")
        DiagnosticLog.trace("[Rejourney] onTaskRemoved() reliable: ${OEMDetector.isTaskRemovedReliable()}")
        
        try {
            SessionLifecycleService.taskRemovedListener = object : TaskRemovedListener {
                override fun onTaskRemoved() {
                    DiagnosticLog.notice("[Rejourney] App terminated via swipe-away (OEM: $oem)")
                    // CRITICAL: Do NOT attempt synchronous network calls here.
                    // It causes ANRs. The session recovery will handle on next launch.
                }
            }
        } catch (e: Exception) {
            DiagnosticLog.fault("[Rejourney] Failed to set up task removed listener: ${e.message}")
        }
    }

    private fun registerActivityLifecycleCallbacks() {
        try {
            val application = reactContext.applicationContext as? Application
            application?.registerActivityLifecycleCallbacks(this)
        } catch (e: Exception) {
            DiagnosticLog.fault("[Rejourney] Failed to register activity callbacks: ${e.message}")
        }
    }

    private fun registerProcessLifecycleObserver() {
        mainHandler.post {
            try {
                ProcessLifecycleOwner.get().lifecycle.addObserver(this)
            } catch (e: Exception) {
                DiagnosticLog.fault("[Rejourney] Failed to register lifecycle observer: ${e.message}")
            }
        }
    }

    // MARK: - Lifecycle Handlers

    override fun onStop(owner: LifecycleOwner) {
        handleBackgrounding()
    }

    override fun onStart(owner: LifecycleOwner) {
        handleForegrounding()
    }

    private fun handleBackgrounding() {
        stateLock.withLock {
            val currentState = state
            if (currentState is SessionState.Active) {
                state = SessionState.Paused(currentState.sessionId, currentState.startTimeMs)
                backgroundEntryTimeMs = System.currentTimeMillis()
                DiagnosticLog.notice("[Rejourney] ⏸️ Session '${currentState.sessionId}' paused (app backgrounded)")
                
                // Flush pending data
                TelemetryPipeline.shared?.dispatchNow()
                SegmentDispatcher.shared.shipPending()
            }
        }
    }

    private fun handleForegrounding() {
        mainHandler.post { processForegrounding() }
    }

    private fun processForegrounding() {
        stateLock.withLock {
            val currentState = state
            if (currentState !is SessionState.Paused) {
                DiagnosticLog.trace("[Rejourney] Foreground: not in paused state, ignoring")
                return
            }

            val backgroundDuration = backgroundEntryTimeMs?.let {
                System.currentTimeMillis() - it
            } ?: 0L
            backgroundEntryTimeMs = null

            DiagnosticLog.notice("[Rejourney] App foregrounded after ${backgroundDuration / 1000}s (timeout: ${SESSION_TIMEOUT_MS / 1000}s)")

            if (backgroundDuration > SESSION_TIMEOUT_MS) {
                // End current session and start a new one
                state = SessionState.Idle
                val oldSessionId = currentState.sessionId
                
                DiagnosticLog.notice("[Rejourney] 🔄 Session timeout! Ending session '$oldSessionId' and creating new one")

                backgroundScope.launch {
                    ReplayOrchestrator.shared?.endReplay { success, uploaded ->
                        DiagnosticLog.notice("[Rejourney] Old session ended (success: $success, uploaded: $uploaded)")
                        mainHandler.post { startNewSessionAfterTimeout() }
                    }
                }
            } else {
                // Resume existing session
                state = SessionState.Active(currentState.sessionId, currentState.startTimeMs)
                DiagnosticLog.notice("[Rejourney] ▶️ Resuming session '${currentState.sessionId}'")
                
                // Record foreground event
                TelemetryPipeline.shared?.recordAppForeground(backgroundDuration)
                StabilityMonitor.shared?.transmitStoredReport()
            }
        }
    }

    private fun startNewSessionAfterTimeout() {
        val apiUrl = lastApiUrl ?: return
        val publicKey = lastPublicKey ?: return
        val savedUserId = currentUserIdentity

        DiagnosticLog.notice("[Rejourney] Starting new session after timeout (user: $savedUserId)")

        // Try fast path with cached credentials
        val existingCred = DeviceRegistrar.shared?.uploadCredential
        if (existingCred != null && DeviceRegistrar.shared?.credentialValid == true) {
            DiagnosticLog.notice("[Rejourney] Using cached credentials for fast session restart")
            ReplayOrchestrator.shared?.beginReplayFast(
                apiToken = publicKey,
                serverEndpoint = apiUrl,
                credential = existingCred,
                captureSettings = lastSessionConfig
            )
        } else {
            DiagnosticLog.notice("[Rejourney] No cached credentials, doing full session start")
            ReplayOrchestrator.shared?.beginReplay(
                apiToken = publicKey,
                serverEndpoint = apiUrl,
                captureSettings = lastSessionConfig
            )
        }

        // Poll for session ready
        waitForSessionReady(savedUserId, 0)
    }

    private fun waitForSessionReady(savedUserId: String?, attempts: Int) {
        val maxAttempts = 30 // 3 seconds max

        mainHandler.postDelayed({
            val newSid = ReplayOrchestrator.shared?.replayId
            if (!newSid.isNullOrEmpty()) {
                stateLock.withLock {
                    state = SessionState.Active(newSid, System.currentTimeMillis())
                }

                ReplayOrchestrator.shared?.activateGestureRecording()

                // Restore user identity
                if (!savedUserId.isNullOrBlank() && savedUserId != "anonymous" && !savedUserId.startsWith("anon_")) {
                    ReplayOrchestrator.shared?.associateUser(savedUserId)
                    DiagnosticLog.notice("[Rejourney] ✅ Restored user identity '$savedUserId' to new session $newSid")
                }

                DiagnosticLog.replayBegan(newSid)
                DiagnosticLog.notice("[Rejourney] ✅ New session started: $newSid")
            } else if (attempts < maxAttempts) {
                waitForSessionReady(savedUserId, attempts + 1)
            } else {
                DiagnosticLog.caution("[Rejourney] ⚠️ Timeout waiting for new session to initialize")
            }
        }, 100)
    }

    // MARK: - Public API

    fun startSession(userId: String, apiUrl: String, publicKey: String, promise: Promise) {
        startSessionWithOptions(
            Arguments.createMap().apply {
                putString("userId", userId)
                putString("apiUrl", apiUrl)
                putString("publicKey", publicKey)
            },
            promise
        )
    }

    fun startSessionWithOptions(options: ReadableMap, promise: Promise) {
        ensureInitialized()

        if (isShuttingDown) {
            promise.resolve(createResultMap(false, "", "Module is shutting down"))
            return
        }

        val debug = options.getBooleanSafe("debug", false)
        if (debug) {
            DiagnosticLog.setVerbose(true)
            DiagnosticLog.notice("[Rejourney] Debug mode ENABLED - verbose logging active")
        }

        val userId = options.getStringSafe("userId", "anonymous")
        val apiUrl = options.getStringSafe("apiUrl", "https://api.rejourney.co")
        val publicKey = options.getStringSafe("publicKey", "")

        if (publicKey.isEmpty()) {
            promise.reject("INVALID_KEY", "publicKey is required")
            return
        }

        // Build config from options
        val config = mutableMapOf<String, Any>()
        if (options.hasKey("captureScreen")) config["captureScreen"] = options.getBoolean("captureScreen")
        if (options.hasKey("captureAnalytics")) config["captureAnalytics"] = options.getBoolean("captureAnalytics")
        if (options.hasKey("captureCrashes")) config["captureCrashes"] = options.getBoolean("captureCrashes")
        if (options.hasKey("captureANR")) config["captureANR"] = options.getBoolean("captureANR")
        if (options.hasKey("wifiOnly")) config["wifiOnly"] = options.getBoolean("wifiOnly")
        
        if (options.hasKey("fps")) {
            val fps = options.getInt("fps").coerceIn(1, 30)
            config["captureRate"] = 1.0 / fps
        }
        
        if (options.hasKey("quality")) {
            when (options.getString("quality")?.lowercase()) {
                "low" -> config["imgCompression"] = 0.4
                "high" -> config["imgCompression"] = 0.7
                else -> config["imgCompression"] = 0.5
            }
        }

        mainHandler.post {
            // Check if already active
            stateLock.withLock {
                val currentState = state
                if (currentState is SessionState.Active) {
                    promise.resolve(createResultMap(true, currentState.sessionId))
                    return@post
                }
            }

            if (!userId.isNullOrBlank() && userId != "anonymous" && !userId.startsWith("anon_")) {
                currentUserIdentity = userId
            }

            // Store for session restart
            lastSessionConfig = config
            lastApiUrl = apiUrl
            lastPublicKey = publicKey

            // Configure endpoints and tokens
            TelemetryPipeline.shared?.endpoint = apiUrl
            TelemetryPipeline.shared?.apiToken = publicKey
            SegmentDispatcher.shared.endpoint = apiUrl
            DeviceRegistrar.shared?.endpoint = apiUrl

            // Set current activity on capture components before starting
            val activity = reactContext.currentActivity
            DiagnosticLog.notice("[Rejourney] startSession: currentActivity=${activity?.javaClass?.simpleName ?: "NULL"}, VisualCapture.shared=${VisualCapture.shared != null}")
            if (activity != null) {
                DiagnosticLog.notice("[Rejourney] Setting activity on capture components")
                VisualCapture.shared?.setCurrentActivity(activity)
                ViewHierarchyScanner.shared?.setCurrentActivity(activity)
                InteractionRecorder.shared?.setCurrentActivity(activity)
                DiagnosticLog.notice("[Rejourney] Activity set on all components")
            } else {
                DiagnosticLog.fault("[Rejourney] CRITICAL: No current activity available for capture!")
            }

            // Pre-generate session ID to ensure consistency between JS and native
            val sid = "session_${System.currentTimeMillis()}_${java.util.UUID.randomUUID().toString().replace("-", "").lowercase()}"
            ReplayOrchestrator.shared?.replayId = sid
            TelemetryPipeline.shared?.currentReplayId = sid

            // Begin replay
            ReplayOrchestrator.shared?.beginReplay(
                apiToken = publicKey,
                serverEndpoint = apiUrl,
                captureSettings = config
            )
            
            // Android-specific: Start SessionLifecycleService for task removal detection
            startSessionLifecycleService()

            // Allow orchestrator time to spin up
            mainHandler.postDelayed({
                stateLock.withLock {
                    state = SessionState.Active(sid, System.currentTimeMillis())
                }

                ReplayOrchestrator.shared?.activateGestureRecording()

                if (!userId.isNullOrBlank() && userId != "anonymous" && !userId.startsWith("anon_")) {
                    ReplayOrchestrator.shared?.associateUser(userId)
                }

                DiagnosticLog.replayBegan(sid)
                promise.resolve(createResultMap(true, sid))
            }, 300)
        }
    }
    
    /**
     * Android-specific: Start the SessionLifecycleService for task removal detection
     */
    private fun startSessionLifecycleService() {
        try {
            val serviceIntent = Intent(reactContext, SessionLifecycleService::class.java)
            reactContext.startService(serviceIntent)
            DiagnosticLog.trace("[Rejourney] SessionLifecycleService started")
        } catch (e: Exception) {
            DiagnosticLog.caution("[Rejourney] Failed to start SessionLifecycleService: ${e.message}")
        }
    }
    
    /**
     * Android-specific: Stop the SessionLifecycleService
     */
    private fun stopSessionLifecycleService() {
        try {
            val serviceIntent = Intent(reactContext, SessionLifecycleService::class.java)
            reactContext.stopService(serviceIntent)
            DiagnosticLog.trace("[Rejourney] SessionLifecycleService stopped")
        } catch (e: Exception) {
            DiagnosticLog.caution("[Rejourney] Failed to stop SessionLifecycleService: ${e.message}")
        }
    }

    fun stopSession(promise: Promise) {
        mainHandler.post {
            var targetSid = ""

            stateLock.withLock {
                val currentState = state
                if (currentState is SessionState.Active) {
                    targetSid = currentState.sessionId
                }
                state = SessionState.Idle
            }
            
            
            // Android-specific: Stop SessionLifecycleService
            stopSessionLifecycleService()

            if (targetSid.isEmpty()) {
                promise.resolve(createResultMap(true, "", uploadSuccess = true))
                return@post
            }

            ReplayOrchestrator.shared?.endReplay { success, uploaded ->
                DiagnosticLog.replayEnded(targetSid)
                
                promise.resolve(Arguments.createMap().apply {
                    putBoolean("success", success)
                    putString("sessionId", targetSid)
                    putBoolean("uploadSuccess", uploaded)
                })
            }
        }
    }

    fun getSessionId(promise: Promise) {
        stateLock.withLock {
            when (val currentState = state) {
                is SessionState.Active -> promise.resolve(currentState.sessionId)
                is SessionState.Paused -> promise.resolve(currentState.sessionId)
                else -> promise.resolve(null)
            }
        }
    }

    fun setUserIdentity(userId: String, promise: Promise) {
        if (!userId.isNullOrBlank() && userId != "anonymous" && !userId.startsWith("anon_")) {
            currentUserIdentity = userId
            
            // Persist natively
            try {
                val prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                prefs.edit().putString(KEY_USER_IDENTITY, userId).apply()
                DiagnosticLog.notice("[Rejourney] Persisted user identity: $userId")
            } catch (e: Exception) {
                DiagnosticLog.fault("[Rejourney] Failed to persist identity: ${e.message}")
            }
            
            ReplayOrchestrator.shared?.associateUser(userId)
        } else if (userId == "anonymous" || userId.isNullOrBlank()) {
            // Clear identity
            currentUserIdentity = null
            try {
                val prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                prefs.edit().remove(KEY_USER_IDENTITY).apply()
            } catch (e: Exception) {}
        }
        
        promise.resolve(createResultMap(true))
    }

    fun getUserIdentity(promise: Promise) {
        promise.resolve(currentUserIdentity)
    }

    fun logEvent(eventType: String, details: ReadableMap, promise: Promise) {
        // Handle network_request events specially
        if (eventType == "network_request") {
            val detailsMap = details.toHashMap().filterValues { it != null }.mapValues { it.value!! }
            TelemetryPipeline.shared?.recordNetworkEvent(detailsMap)
            promise.resolve(createResultMap(true))
            return
        }

        // Handle JS error events - route through TelemetryPipeline as type:"error"
        // so the backend ingest worker processes them into the errors table
        if (eventType == "error") {
            val detailsMap = details.toHashMap()
            val message = detailsMap["message"]?.toString() ?: "Unknown error"
            val name = detailsMap["name"]?.toString() ?: "Error"
            val stack = detailsMap["stack"]?.toString()
            TelemetryPipeline.shared?.recordJSErrorEvent(name, message, stack)
            promise.resolve(createResultMap(true))
            return
        }

        // Handle dead_tap events from JS-side detection
        // Native view hierarchy inspection is unreliable in React Native,
        // so dead tap detection runs in JS and reports back via logEvent.
        if (eventType == "dead_tap") {
            val detailsMap = details.toHashMap()
            val x = (detailsMap["x"] as? Number)?.toLong()?.coerceAtLeast(0) ?: 0L
            val y = (detailsMap["y"] as? Number)?.toLong()?.coerceAtLeast(0) ?: 0L
            val label = detailsMap["label"]?.toString() ?: "unknown"
            TelemetryPipeline.shared?.recordDeadTapEvent(label, x, y)
            ReplayOrchestrator.shared?.incrementDeadTapTally()
            promise.resolve(createResultMap(true))
            return
        }

        // Handle console log events - preserve type:"log" with level and message
        // so the dashboard replay can display them in the console terminal
        if (eventType == "log") {
            val detailsMap = details.toHashMap()
            val level = detailsMap["level"]?.toString() ?: "log"
            val message = detailsMap["message"]?.toString() ?: ""
            TelemetryPipeline.shared?.recordConsoleLogEvent(level, message)
            promise.resolve(createResultMap(true))
            return
        }

        // All other events go through custom event recording
        val payload = try {
            val json = org.json.JSONObject(details.toHashMap()).toString()
            json
        } catch (e: Exception) {
            "{}"
        }
        
        ReplayOrchestrator.shared?.recordCustomEvent(eventType, payload)
        promise.resolve(createResultMap(true))
    }

    fun screenChanged(screenName: String, promise: Promise) {
        TelemetryPipeline.shared?.recordViewTransition(screenName, screenName, true)
        ReplayOrchestrator.shared?.logScreenView(screenName)
        promise.resolve(createResultMap(true))
    }

    fun onScroll(offsetY: Double, promise: Promise) {
        ReplayOrchestrator.shared?.logScrollAction()
        promise.resolve(createResultMap(true))
    }

    fun markVisualChange(reason: String, importance: String, promise: Promise) {
        if (importance == "high") {
            VisualCapture.shared?.snapshotNow()
        }
        promise.resolve(true)
    }

    fun onExternalURLOpened(urlScheme: String, promise: Promise) {
        ReplayOrchestrator.shared?.recordCustomEvent("external_url_opened", "{\"scheme\":\"$urlScheme\"}")
        promise.resolve(createResultMap(true))
    }

    fun onOAuthStarted(provider: String, promise: Promise) {
        ReplayOrchestrator.shared?.recordCustomEvent("oauth_started", "{\"provider\":\"$provider\"}")
        promise.resolve(createResultMap(true))
    }

    fun onOAuthCompleted(provider: String, success: Boolean, promise: Promise) {
        ReplayOrchestrator.shared?.recordCustomEvent("oauth_completed", "{\"provider\":\"$provider\",\"success\":$success}")
        promise.resolve(createResultMap(true))
    }

    fun maskViewByNativeID(nativeID: String, promise: Promise) {
        mainHandler.post {
            findViewByNativeID(nativeID)?.let { view ->
                ReplayOrchestrator.shared?.redactView(view)
            }
        }
        promise.resolve(createResultMap(true))
    }

    fun unmaskViewByNativeID(nativeID: String, promise: Promise) {
        mainHandler.post {
            findViewByNativeID(nativeID)?.let { view ->
                ReplayOrchestrator.shared?.unredactView(view)
            }
        }
        promise.resolve(createResultMap(true))
    }

    private fun findViewByNativeID(nativeID: String): View? {
        val activity = reactContext.currentActivity ?: return null
        val rootView = activity.window?.decorView?.rootView as? ViewGroup ?: return null
        return scanViewForNativeID(rootView, nativeID)
    }

    private fun scanViewForNativeID(view: View, nativeID: String): View? {
        if (view.contentDescription?.toString() == nativeID) {
            return view
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                val result = scanViewForNativeID(view.getChildAt(i), nativeID)
                if (result != null) return result
            }
        }
        return null
    }

    fun setDebugMode(enabled: Boolean, promise: Promise) {
        DiagnosticLog.setVerbose(enabled)
        promise.resolve(createResultMap(true))
    }

    fun setRemoteConfig(
        rejourneyEnabled: Boolean,
        recordingEnabled: Boolean,
        sampleRate: Double,
        maxRecordingMinutes: Double,
        promise: Promise
    ) {
        try {
            ReplayOrchestrator.shared?.setRemoteConfig(
                rejourneyEnabled = rejourneyEnabled,
                recordingEnabled = recordingEnabled,
                sampleRate = sampleRate.toInt(),
                maxRecordingMinutes = maxRecordingMinutes.toInt()
            )
            DiagnosticLog.notice("[Rejourney] Remote config applied: rejourneyEnabled=$rejourneyEnabled, recordingEnabled=$recordingEnabled, sampleRate=$sampleRate%, maxRecording=${maxRecordingMinutes}min")
            promise.resolve(createResultMap(true))
        } catch (e: Exception) {
            DiagnosticLog.fault("[Rejourney] Failed to set remote config: ${e.message}")
            promise.resolve(createResultMap(false, error = "Failed to set remote config: ${e.message}"))
        }
    }

    fun setSDKVersion(version: String) {
        sdkVersion = version
    }

    fun getSDKVersion(promise: Promise) {
        promise.resolve(sdkVersion)
    }

    fun getSDKMetrics(promise: Promise) {
        val dispatcher = SegmentDispatcher.shared
        val pipeline = TelemetryPipeline.shared
        val telemetry = dispatcher.sdkTelemetrySnapshot(pipeline?.getQueueDepth() ?: 0)
        
        fun toIntValue(key: String): Int = (telemetry[key] as? Number)?.toInt() ?: 0
        fun toDoubleValue(key: String, fallback: Double = 0.0): Double = (telemetry[key] as? Number)?.toDouble() ?: fallback
        fun toLongValue(key: String): Long? = (telemetry[key] as? Number)?.toLong()
        
        promise.resolve(Arguments.createMap().apply {
            putInt("uploadSuccessCount", toIntValue("uploadSuccessCount"))
            putInt("uploadFailureCount", toIntValue("uploadFailureCount"))
            putInt("retryAttemptCount", toIntValue("retryAttemptCount"))
            putInt("circuitBreakerOpenCount", toIntValue("circuitBreakerOpenCount"))
            putInt("memoryEvictionCount", toIntValue("memoryEvictionCount"))
            putInt("offlinePersistCount", toIntValue("offlinePersistCount"))
            putInt("sessionStartCount", toIntValue("sessionStartCount"))
            putInt("crashCount", toIntValue("crashCount"))
            putDouble("uploadSuccessRate", toDoubleValue("uploadSuccessRate", 1.0))
            putDouble("avgUploadDurationMs", toDoubleValue("avgUploadDurationMs", 0.0))
            putInt("currentQueueDepth", toIntValue("currentQueueDepth"))
            toLongValue("lastUploadTime")?.let { putDouble("lastUploadTime", it.toDouble()) } ?: putNull("lastUploadTime")
            toLongValue("lastRetryTime")?.let { putDouble("lastRetryTime", it.toDouble()) } ?: putNull("lastRetryTime")
            putDouble("totalBytesUploaded", toDoubleValue("totalBytesUploaded", 0.0))
            putDouble("totalBytesEvicted", toDoubleValue("totalBytesEvicted", 0.0))
        })
    }

    fun getDeviceInfo(promise: Promise) {
        val deviceHash = computeDeviceHash()
        
        promise.resolve(Arguments.createMap().apply {
            putString("platform", "android")
            putString("osVersion", Build.VERSION.RELEASE)
            putString("model", Build.MODEL)
            putString("brand", Build.MANUFACTURER)
            putInt("screenWidth", reactContext.resources.displayMetrics.widthPixels)
            putInt("screenHeight", reactContext.resources.displayMetrics.heightPixels)
            putDouble("screenScale", reactContext.resources.displayMetrics.density.toDouble())
            putString("deviceHash", deviceHash)
            putString("bundleId", reactContext.packageName ?: "unknown")
        })
    }

    fun debugCrash() {
        mainHandler.post {
            throw RuntimeException("Rejourney debug crash triggered")
        }
    }

    fun debugTriggerANR(durationMs: Double) {
        mainHandler.post {
            Thread.sleep(durationMs.toLong())
        }
    }

    fun setUserData(key: String, value: String, promise: Promise) {
        ReplayOrchestrator.shared?.attachAttribute(key, value)
        promise.resolve(null)
    }

    // MARK: - Utility Methods

    private fun computeDeviceHash(): String {
        val androidId = Settings.Secure.getString(
            reactContext.contentResolver,
            Settings.Secure.ANDROID_ID
        ) ?: "unknown"
        
        return try {
            val digest = MessageDigest.getInstance("SHA-256")
            val hash = digest.digest(androidId.toByteArray())
            hash.joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            ""
        }
    }

    private fun createResultMap(success: Boolean, sessionId: String = "", error: String? = null, uploadSuccess: Boolean? = null): WritableMap {
        return Arguments.createMap().apply {
            putBoolean("success", success)
            putString("sessionId", sessionId)
            error?.let { putString("error", it) }
            uploadSuccess?.let { putBoolean("uploadSuccess", it) }
        }
    }

    // MARK: - Activity Lifecycle Callbacks

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityStarted(activity: Activity) {}
    override fun onActivityResumed(activity: Activity) {
        // Set current activity on capture components so they can capture the screen
        DiagnosticLog.notice("[Rejourney] onActivityResumed: ${activity.javaClass.simpleName}")
        VisualCapture.shared?.setCurrentActivity(activity)
        ViewHierarchyScanner.shared?.setCurrentActivity(activity)
        InteractionRecorder.shared?.setCurrentActivity(activity)
    }
    override fun onActivityPaused(activity: Activity) {
        // DO NOT clear activity references on pause!
        // Activities can be paused during normal operation (dialogs, config changes, etc.)
        // Clearing the activity here breaks screen capture during async credential fetch.
        // Activity will be updated when a new activity resumes or when the app is destroyed.
        DiagnosticLog.trace("[Rejourney] onActivityPaused: ${activity.javaClass.simpleName} (keeping activity reference)")
    }
    override fun onActivityStopped(activity: Activity) {
        // Only clear when stopped (not visible) to avoid breaking capture during pause states
        DiagnosticLog.trace("[Rejourney] onActivityStopped: ${activity.javaClass.simpleName}")
    }
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {
        // Clear references only on destroy to avoid leaks
        DiagnosticLog.trace("[Rejourney] onActivityDestroyed: ${activity.javaClass.simpleName}")
        VisualCapture.shared?.setCurrentActivity(null)
        ViewHierarchyScanner.shared?.setCurrentActivity(null)
        InteractionRecorder.shared?.setCurrentActivity(null)
    }

    // MARK: - Event Emission (no-ops, dead tap detection is native-side)

    fun addListener(eventName: String) {
        // No-op: dead tap detection is handled natively in TelemetryPipeline
    }

    fun removeListeners(count: Double) {
        // No-op: dead tap detection is handled natively in TelemetryPipeline
    }

    // MARK: - Cleanup

    fun invalidate() {
        isShuttingDown = true
        scope.cancel()
        backgroundScope.cancel()
        
        val application = reactContext.applicationContext as? Application
        application?.unregisterActivityLifecycleCallbacks(this)
        
        mainHandler.post {
            try {
                ProcessLifecycleOwner.get().lifecycle.removeObserver(this)
            } catch (_: Exception) {}
        }
    }
}

// Extension functions for safe ReadableMap access
private fun ReadableMap.getStringSafe(key: String, default: String): String {
    return if (hasKey(key) && !isNull(key)) getString(key) ?: default else default
}

private fun ReadableMap.getBooleanSafe(key: String, default: Boolean): Boolean {
    return if (hasKey(key) && !isNull(key)) getBoolean(key) else default
}
