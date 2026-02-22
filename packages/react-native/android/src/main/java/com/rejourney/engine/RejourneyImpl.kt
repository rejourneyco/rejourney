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

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.rejourney.recording.*
import java.security.MessageDigest
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Session state machine aligned with iOS
 */
sealed class SessionState {
    object Idle : SessionState()
    data class Active(val sessionId: String, val startTimeMs: Long) : SessionState()
    data class Paused(val sessionId: String, val startTimeMs: Long) : SessionState()
    object Terminated : SessionState()
}

/**
 * Main SDK implementation aligned with iOS RejourneyImpl.swift
 * 
 * This class provides the core SDK functionality for native Android usage.
 * For React Native, use RejourneyModuleImpl instead.
 */
class RejourneyImpl private constructor(private val context: Context) : 
    Application.ActivityLifecycleCallbacks, DefaultLifecycleObserver {

    companion object {
        @Volatile
        private var instance: RejourneyImpl? = null
        
        fun getInstance(context: Context): RejourneyImpl {
            return instance ?: synchronized(this) {
                instance ?: RejourneyImpl(context.applicationContext).also { instance = it }
            }
        }
        
        val shared: RejourneyImpl?
            get() = instance
            
        var sdkVersion = "1.0.1"
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

    // Session timeout threshold (60 seconds)
    private val sessionTimeoutMs = 60_000L

    private val mainHandler = Handler(Looper.getMainLooper())
    
    @Volatile
    private var isInitialized = false

    init {
        setupLifecycleListeners()
    }

    private fun setupLifecycleListeners() {
        try {
            // Register with ProcessLifecycleOwner
            mainHandler.post {
                ProcessLifecycleOwner.get().lifecycle.addObserver(this)
            }
            
            // Register activity callbacks
            (context.applicationContext as? Application)?.registerActivityLifecycleCallbacks(this)
            
        } catch (e: Exception) {
            DiagnosticLog.fault("[Rejourney] Failed to setup lifecycle listeners: ${e.message}")
        }
    }

    // MARK: - State Transitions

    override fun onStop(owner: LifecycleOwner) {
        handleBackgrounding()
    }

    override fun onStart(owner: LifecycleOwner) {
        handleForegrounding()
    }

    private fun handleBackgrounding() {
        stateLock.withLock {
            when (val currentState = state) {
                is SessionState.Active -> {
                    state = SessionState.Paused(currentState.sessionId, currentState.startTimeMs)
                    backgroundEntryTimeMs = System.currentTimeMillis()
                    DiagnosticLog.notice("[Rejourney] ⏸️ Session '${currentState.sessionId}' paused (app backgrounded)")
                    
                    TelemetryPipeline.shared?.dispatchNow()
                    SegmentDispatcher.shared.shipPending()
                }
                else -> {}
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

            DiagnosticLog.notice("[Rejourney] App foregrounded after ${backgroundDuration / 1000}s (timeout: ${sessionTimeoutMs / 1000}s)")

            if (backgroundDuration > sessionTimeoutMs) {
                // End current session and start a new one
                state = SessionState.Idle
                val oldSessionId = currentState.sessionId

                DiagnosticLog.notice("[Rejourney] 🔄 Session timeout! Ending session '$oldSessionId' and creating new one")

                Thread {
                    ReplayOrchestrator.shared?.endReplay { success, uploaded ->
                        DiagnosticLog.notice("[Rejourney] Old session ended (success: $success, uploaded: $uploaded)")
                        mainHandler.post { startNewSessionAfterTimeout() }
                    }
                }.start()
            } else {
                // Resume existing session
                state = SessionState.Active(currentState.sessionId, currentState.startTimeMs)
                DiagnosticLog.notice("[Rejourney] ▶️ Resuming session '${currentState.sessionId}'")

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

        mainHandler.post {
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
                if (!savedUserId.isNullOrBlank() && savedUserId != "anonymous") {
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

    /**
     * Start a session with the given configuration
     */
    fun startSession(
        userId: String = "anonymous",
        apiUrl: String = "https://api.rejourney.co",
        publicKey: String,
        config: Map<String, Any>? = null,
        callback: ((Boolean, String) -> Unit)? = null
    ) {
        if (publicKey.isEmpty()) {
            callback?.invoke(false, "")
            return
        }

        mainHandler.post {
            // Check if already active
            stateLock.withLock {
                val currentState = state
                if (currentState is SessionState.Active) {
                    callback?.invoke(true, currentState.sessionId)
                    return@post
                }
            }

            currentUserIdentity = userId

            // Store for session restart
            lastSessionConfig = config
            lastApiUrl = apiUrl
            lastPublicKey = publicKey

            // Configure endpoints
            TelemetryPipeline.shared?.endpoint = apiUrl
            SegmentDispatcher.shared.endpoint = apiUrl
            DeviceRegistrar.shared?.endpoint = apiUrl

            // Pre-generate session ID
            val sid = "session_${System.currentTimeMillis()}_${java.util.UUID.randomUUID().toString().replace("-", "").lowercase()}"
            ReplayOrchestrator.shared?.replayId = sid

            // Begin replay
            ReplayOrchestrator.shared?.beginReplay(
                apiToken = publicKey,
                serverEndpoint = apiUrl,
                captureSettings = config
            )

            // Allow orchestrator time to spin up
            mainHandler.postDelayed({
                stateLock.withLock {
                    state = SessionState.Active(sid, System.currentTimeMillis())
                }

                ReplayOrchestrator.shared?.activateGestureRecording()

                if (userId != "anonymous") {
                    ReplayOrchestrator.shared?.associateUser(userId)
                }

                DiagnosticLog.replayBegan(sid)
                callback?.invoke(true, sid)
            }, 300)
        }
    }

    /**
     * Stop the current session
     */
    fun stopSession(callback: ((Boolean, String, Boolean) -> Unit)? = null) {
        mainHandler.post {
            var targetSid = ""

            stateLock.withLock {
                val currentState = state
                if (currentState is SessionState.Active) {
                    targetSid = currentState.sessionId
                }
                state = SessionState.Idle
            }

            if (targetSid.isEmpty()) {
                callback?.invoke(true, "", true)
                return@post
            }

            ReplayOrchestrator.shared?.endReplay { success, uploaded ->
                DiagnosticLog.replayEnded(targetSid)
                callback?.invoke(success, targetSid, uploaded)
            }
        }
    }

    /**
     * Get the current session ID
     */
    fun getSessionId(): String? {
        return stateLock.withLock {
            when (val currentState = state) {
                is SessionState.Active -> currentState.sessionId
                is SessionState.Paused -> currentState.sessionId
                else -> null
            }
        }
    }

    /**
     * Set the user identity for the session
     */
    fun setUserIdentity(userId: String) {
        currentUserIdentity = userId
        ReplayOrchestrator.shared?.associateUser(userId)
    }

    /**
     * Get the current user identity
     */
    fun getUserIdentity(): String? = currentUserIdentity

    /**
     * Log a custom event
     */
    fun logEvent(eventType: String, details: Map<String, Any>? = null) {
        if (eventType == "network_request") {
            TelemetryPipeline.shared?.recordNetworkEvent(details ?: emptyMap())
            return
        }

        // Handle JS error events - route through TelemetryPipeline as type:"error"
        // so the backend ingest worker processes them into the errors table
        if (eventType == "error") {
            val message = details?.get("message")?.toString() ?: "Unknown error"
            val name = details?.get("name")?.toString() ?: "Error"
            val stack = details?.get("stack")?.toString()
            TelemetryPipeline.shared?.recordJSErrorEvent(name, message, stack)
            return
        }

        // Handle dead_tap events from JS-side detection
        if (eventType == "dead_tap") {
            val x = (details?.get("x") as? Number)?.toLong()?.coerceAtLeast(0) ?: 0L
            val y = (details?.get("y") as? Number)?.toLong()?.coerceAtLeast(0) ?: 0L
            val label = details?.get("label")?.toString() ?: "unknown"
            TelemetryPipeline.shared?.recordDeadTapEvent(label, x, y)
            ReplayOrchestrator.shared?.incrementDeadTapTally()
            return
        }

        // Handle console log events - preserve type:"log" with level and message
        // so the dashboard replay can display them in the console terminal
        if (eventType == "log") {
            val level = details?.get("level")?.toString() ?: "log"
            val message = details?.get("message")?.toString() ?: ""
            TelemetryPipeline.shared?.recordConsoleLogEvent(level, message)
            return
        }

        val payload = try {
            org.json.JSONObject(details ?: emptyMap<String, Any>()).toString()
        } catch (e: Exception) {
            "{}"
        }

        ReplayOrchestrator.shared?.recordCustomEvent(eventType, payload)
    }

    /**
     * Record a screen change
     */
    fun screenChanged(screenName: String) {
        TelemetryPipeline.shared?.recordViewTransition(screenName, screenName, true)
        ReplayOrchestrator.shared?.logScreenView(screenName)
    }

    /**
     * Record a scroll action
     */
    fun onScroll(offsetY: Double) {
        ReplayOrchestrator.shared?.logScrollAction()
    }

    /**
     * Mark a visual change
     */
    fun markVisualChange(reason: String, importance: String) {
        if (importance == "high") {
            VisualCapture.shared?.snapshotNow()
        }
    }

    /**
     * Mask a view from recording
     */
    fun maskView(view: View) {
        mainHandler.post {
            ReplayOrchestrator.shared?.redactView(view)
        }
    }

    /**
     * Unmask a view from recording
     */
    fun unmaskView(view: View) {
        mainHandler.post {
            ReplayOrchestrator.shared?.unredactView(view)
        }
    }

    /**
     * Set debug mode
     */
    fun setDebugMode(enabled: Boolean) {
        DiagnosticLog.setVerbose(enabled)
    }

    /**
     * Set custom user data
     */
    fun setUserData(key: String, value: String) {
        ReplayOrchestrator.shared?.attachAttribute(key, value)
    }

    /**
     * Get device info
     */
    fun getDeviceInfo(): Map<String, Any> {
        val androidId = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID
        ) ?: "unknown"

        val deviceHash = try {
            val digest = MessageDigest.getInstance("SHA-256")
            val hash = digest.digest(androidId.toByteArray())
            hash.joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            ""
        }

        return mapOf(
            "platform" to "android",
            "osVersion" to android.os.Build.VERSION.RELEASE,
            "model" to android.os.Build.MODEL,
            "brand" to android.os.Build.MANUFACTURER,
            "deviceHash" to deviceHash
        )
    }

    // MARK: - Activity Lifecycle Callbacks

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityStarted(activity: Activity) {}
    override fun onActivityResumed(activity: Activity) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivityStopped(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}

    // MARK: - Cleanup

    fun shutdown() {
        stateLock.withLock {
            when (state) {
                is SessionState.Active, is SessionState.Paused -> {
                    state = SessionState.Terminated
                    TelemetryPipeline.shared?.finalizeAndShip()
                    SegmentDispatcher.shared.shipPending()
                }
                else -> {}
            }
        }
        
        try {
            (context.applicationContext as? Application)?.unregisterActivityLifecycleCallbacks(this)
            mainHandler.post {
                try {
                    ProcessLifecycleOwner.get().lifecycle.removeObserver(this)
                } catch (_: Exception) {}
            }
        } catch (_: Exception) {}
    }
}
