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

import android.app.Activity
import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import com.rejourney.engine.DeviceRegistrar
import com.rejourney.engine.DiagnosticLog
import com.rejourney.engine.PerformanceSnapshot
import org.json.JSONObject
import java.io.File
import java.util.*

/**
 * Session orchestration and lifecycle management
 * Android implementation aligned with iOS ReplayOrchestrator.swift
 */
class ReplayOrchestrator private constructor(private val context: Context) {
    
    companion object {
        @Volatile
        private var instance: ReplayOrchestrator? = null
        
        fun getInstance(context: Context): ReplayOrchestrator {
            return instance ?: synchronized(this) {
                instance ?: ReplayOrchestrator(context.applicationContext).also { instance = it }
            }
        }
        
        val shared: ReplayOrchestrator?
            get() = instance
        
        // Process start time for app startup tracking
        private val processStartTime: Long by lazy {
            try {
                // Read process start time from /proc/self/stat
                val stat = File("/proc/self/stat").readText()
                val parts = stat.split(" ")
                if (parts.size > 21) {
                    val startTimeTicks = parts[21].toLongOrNull() ?: 0
                    val ticksPerSecond = 100L // Standard on most Linux systems
                    System.currentTimeMillis() - (android.os.SystemClock.elapsedRealtime() - (startTimeTicks * 1000 / ticksPerSecond))
                } else {
                    System.currentTimeMillis()
                }
            } catch (e: Exception) {
                System.currentTimeMillis()
            }
        }
    }
    
    var apiToken: String? = null
    var replayId: String? = null
    var replayStartMs: Long = 0
    var deferredUploadMode = false
    var frameBundleSize: Int = 5
    
    var serverEndpoint: String
        get() = TelemetryPipeline.shared?.endpoint ?: "https://api.rejourney.co"
        set(value) {
            TelemetryPipeline.shared?.endpoint = value
            SegmentDispatcher.shared.endpoint = value
            DeviceRegistrar.shared?.endpoint = value
        }
    
    var snapshotInterval: Double = 1.0
    var compressionLevel: Double = 0.5
    var visualCaptureEnabled: Boolean = true
    var interactionCaptureEnabled: Boolean = true
    var faultTrackingEnabled: Boolean = true
    var responsivenessCaptureEnabled: Boolean = true
    var consoleCaptureEnabled: Boolean = true
    var wifiRequired: Boolean = false
    var hierarchyCaptureEnabled: Boolean = true
    var hierarchyCaptureInterval: Double = 2.0
    var currentScreenName: String? = null
        private set
    
    // Remote config from backend (set via setRemoteConfig before session start)
    var remoteRejourneyEnabled: Boolean = true
        private set
    var remoteRecordingEnabled: Boolean = true
        private set
    var remoteSampleRate: Int = 100
        private set
    var remoteMaxRecordingMinutes: Int = 10
        private set
    
    // Network state tracking
    var currentNetworkType: String = "unknown"
        private set
    var currentCellularGeneration: String = "unknown"
        private set
    var networkIsConstrained: Boolean = false
        private set
    var networkIsExpensive: Boolean = false
        private set
    
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var netReady = false
    private var live = false
    
    private var crashCount = 0
    private var freezeCount = 0
    private var errorCount = 0
    private var tapCount = 0
    private var scrollCount = 0
    private var gestureCount = 0
    private var rageCount = 0
    private var deadTapCount = 0
    private val visitedScreens = mutableListOf<String>()
    private var bgTimeMs: Long = 0
    private var bgStartMs: Long? = null
    private var finalized = false
    private var hierarchyHandler: Handler? = null
    private var hierarchyRunnable: Runnable? = null
    private var lastHierarchyHash: String? = null
    private var durationLimitRunnable: Runnable? = null
    
    private val mainHandler = Handler(Looper.getMainLooper())
    
    /**
     * Fast session start using existing credentials - skips credential fetch for faster restart
     */
    fun beginReplayFast(apiToken: String, serverEndpoint: String, credential: String, captureSettings: Map<String, Any>? = null) {
        val perf = PerformanceSnapshot.capture()
        DiagnosticLog.debugSessionCreate("ORCHESTRATOR_FAST_INIT", "beginReplayFast with existing credential", perf)
        
        this.apiToken = apiToken
        this.serverEndpoint = serverEndpoint
        applySettings(captureSettings)
        
        // Set credentials AND endpoint directly without network fetch
        TelemetryPipeline.shared?.apiToken = apiToken
        TelemetryPipeline.shared?.credential = credential
        TelemetryPipeline.shared?.endpoint = serverEndpoint
        SegmentDispatcher.shared.apiToken = apiToken
        SegmentDispatcher.shared.credential = credential
        SegmentDispatcher.shared.endpoint = serverEndpoint
        
        // Skip network monitoring, assume network is available since we just came from background
        mainHandler.post {
            beginRecording(apiToken)
        }
    }
    
    fun beginReplay(apiToken: String, serverEndpoint: String, captureSettings: Map<String, Any>? = null) {
        DiagnosticLog.notice("[ReplayOrchestrator] ★★★ beginReplay v2 ★★★")
        val perf = PerformanceSnapshot.capture()
        DiagnosticLog.debugSessionCreate("ORCHESTRATOR_INIT", "beginReplay", perf)
        DiagnosticLog.notice("[ReplayOrchestrator] beginReplay called, endpoint=$serverEndpoint")
        
        this.apiToken = apiToken
        this.serverEndpoint = serverEndpoint
        applySettings(captureSettings)
        
        DiagnosticLog.debugSessionCreate("CREDENTIAL_START", "Requesting device credential")
        DiagnosticLog.notice("[ReplayOrchestrator] Requesting credential from DeviceRegistrar.shared=${DeviceRegistrar.shared != null}")
        
        DeviceRegistrar.shared?.obtainCredential(apiToken) { ok, cred ->
            DiagnosticLog.notice("[ReplayOrchestrator] Credential callback: ok=$ok, cred=${cred?.take(20) ?: "null"}...")
            if (!ok) {
                DiagnosticLog.debugSessionCreate("CREDENTIAL_FAIL", "Failed")
                DiagnosticLog.caution("[ReplayOrchestrator] Credential fetch FAILED - recording cannot start")
                return@obtainCredential
            }
            
            TelemetryPipeline.shared?.apiToken = apiToken
            TelemetryPipeline.shared?.credential = cred
            SegmentDispatcher.shared.apiToken = apiToken
            SegmentDispatcher.shared.credential = cred
            
            DiagnosticLog.notice("[ReplayOrchestrator] Credential OK, calling monitorNetwork")
            monitorNetwork(apiToken)
        }
    }
    
    fun beginDeferredReplay(apiToken: String, serverEndpoint: String, captureSettings: Map<String, Any>? = null) {
        this.apiToken = apiToken
        this.serverEndpoint = serverEndpoint
        deferredUploadMode = true
        
        applySettings(captureSettings)
        
        DeviceRegistrar.shared?.obtainCredential(apiToken) { ok, cred ->
            if (!ok) return@obtainCredential
            TelemetryPipeline.shared?.apiToken = apiToken
            TelemetryPipeline.shared?.credential = cred
            SegmentDispatcher.shared.apiToken = apiToken
            SegmentDispatcher.shared.credential = cred
        }
        
        initSession()
        TelemetryPipeline.shared?.activateDeferredMode()
        
        val renderCfg = computeRender(1, "standard")
        
        if (visualCaptureEnabled) {
            VisualCapture.shared?.configure(renderCfg.first, renderCfg.second)
            VisualCapture.shared?.beginCapture(replayStartMs)
            VisualCapture.shared?.activateDeferredMode()
        }
        
        if (interactionCaptureEnabled) InteractionRecorder.shared?.activate()
        if (faultTrackingEnabled) StabilityMonitor.shared?.activate()
        
        live = true
    }
    
    fun commitDeferredReplay() {
        deferredUploadMode = false
        TelemetryPipeline.shared?.commitDeferredData()
        VisualCapture.shared?.commitDeferredData()
        TelemetryPipeline.shared?.activate()
    }
    
    fun endReplay(completion: ((Boolean, Boolean) -> Unit)? = null) {
        if (!live) {
            completion?.invoke(false, false)
            return
        }
        live = false
        
        val sid = replayId ?: ""
        val termMs = System.currentTimeMillis()
        val elapsed = ((termMs - replayStartMs) / 1000).toInt()
        
        unregisterNetworkCallback()
        stopHierarchyCapture()
        stopDurationLimitTimer()
        detachLifecycle()
        
        val metrics = mapOf(
            "crashCount" to crashCount,
            "anrCount" to freezeCount,
            "errorCount" to errorCount,
            "durationSeconds" to elapsed,
            "touchCount" to tapCount,
            "scrollCount" to scrollCount,
            "gestureCount" to gestureCount,
            "rageTapCount" to rageCount,
            "deadTapCount" to deadTapCount,
            "screensVisited" to visitedScreens.toList(),
            "screenCount" to visitedScreens.toSet().size
        )
        val queueDepthAtFinalize = TelemetryPipeline.shared?.getQueueDepth() ?: 0
        
        SegmentDispatcher.shared.evaluateReplayRetention(sid, metrics) { retain, reason ->
            // UI operations MUST run on main thread
            mainHandler.post {
                TelemetryPipeline.shared?.shutdown()
                VisualCapture.shared?.halt()
                InteractionRecorder.shared?.deactivate()
                StabilityMonitor.shared?.deactivate()
                AnrSentinel.shared?.deactivate()
            }
            
            SegmentDispatcher.shared.shipPending()
            
            if (finalized) {
                clearRecovery()
                completion?.invoke(true, true)
                return@evaluateReplayRetention
            }
            finalized = true
            
            SegmentDispatcher.shared.concludeReplay(sid, termMs, bgTimeMs, metrics, queueDepthAtFinalize) { ok ->
                if (ok) clearRecovery()
                completion?.invoke(true, ok)
            }
        }
        
        replayId = null
        replayStartMs = 0
    }
    
    fun redactView(view: View) {
        VisualCapture.shared?.registerRedaction(view)
    }
    
    /**
     * Set remote configuration from backend
     * Called by JS side before startSession to apply server-side settings
     */
    fun setRemoteConfig(
        rejourneyEnabled: Boolean,
        recordingEnabled: Boolean,
        sampleRate: Int,
        maxRecordingMinutes: Int
    ) {
        this.remoteRejourneyEnabled = rejourneyEnabled
        this.remoteRecordingEnabled = recordingEnabled
        this.remoteSampleRate = sampleRate
        this.remoteMaxRecordingMinutes = maxRecordingMinutes
        
        // Set isSampledIn for server-side enforcement
        // recordingEnabled=false means either dashboard disabled OR session sampled out by JS
        TelemetryPipeline.shared?.isSampledIn = recordingEnabled
        
        // Apply recording settings immediately
        // If recording is disabled, disable visual capture
        if (!recordingEnabled) {
            visualCaptureEnabled = false
            DiagnosticLog.notice("[ReplayOrchestrator] Visual capture disabled by remote config (recordingEnabled=false)")
        }
        
        // If already recording, restart the duration limit timer with updated config
        if (live) {
            startDurationLimitTimer()
        }
        
        DiagnosticLog.notice("[ReplayOrchestrator] Remote config applied: rejourneyEnabled=$rejourneyEnabled, recordingEnabled=$recordingEnabled, sampleRate=$sampleRate%, maxRecording=${maxRecordingMinutes}min, isSampledIn=$recordingEnabled")
    }
    
    fun unredactView(view: View) {
        VisualCapture.shared?.unregisterRedaction(view)
    }
    
    fun attachAttribute(key: String, value: String) {
        TelemetryPipeline.shared?.recordAttribute(key, value)
    }
    
    fun recordCustomEvent(name: String, payload: String?) {
        TelemetryPipeline.shared?.recordCustomEvent(name, payload ?: "")
    }
    
    fun associateUser(userId: String) {
        TelemetryPipeline.shared?.recordUserAssociation(userId)
    }
    
    fun currentReplayId(): String {
        return replayId ?: ""
    }
    
    fun activateGestureRecording() {
        // Gesture recording activation - handled by InteractionRecorder
    }
    
    fun recoverInterruptedReplay(completion: (String?) -> Unit) {
        val recoveryFile = File(context.filesDir, "rejourney_recovery.json")
        
        if (!recoveryFile.exists()) {
            completion(null)
            return
        }
        
        try {
            val data = recoveryFile.readText()
            val checkpoint = JSONObject(data)
            val recId = checkpoint.optString("replayId", null)
            
            if (recId == null) {
                completion(null)
                return
            }
            
            val origStart = checkpoint.optLong("startMs", 0)
            val nowMs = System.currentTimeMillis()
            
            checkpoint.optString("apiToken", null)?.let { SegmentDispatcher.shared.apiToken = it }
            checkpoint.optString("endpoint", null)?.let { SegmentDispatcher.shared.endpoint = it }
            
            val crashMetrics = mapOf(
                "crashCount" to 1,
                "durationSeconds" to ((nowMs - origStart) / 1000).toInt()
            )
            val queueDepthAtFinalize = TelemetryPipeline.shared?.getQueueDepth() ?: 0
            
            SegmentDispatcher.shared.concludeReplay(recId, nowMs, 0, crashMetrics, queueDepthAtFinalize) { ok ->
                clearRecovery()
                completion(if (ok) recId else null)
            }
        } catch (e: Exception) {
            completion(null)
        }
    }
    
    // Tally methods
    fun incrementFaultTally() { crashCount++ }
    fun incrementStalledTally() { freezeCount++ }
    fun incrementExceptionTally() { errorCount++ }
    fun incrementTapTally() { tapCount++ }
    fun logScrollAction() { scrollCount++ }
    fun incrementGestureTally() { gestureCount++ }
    fun incrementRageTapTally() { rageCount++ }
    fun incrementDeadTapTally() { deadTapCount++ }
    
    fun logScreenView(screenId: String) {
        if (screenId.isEmpty()) return
        visitedScreens.add(screenId)
        currentScreenName = screenId
        if (hierarchyCaptureEnabled) captureHierarchy()
    }
    
    private fun initSession() {
        replayStartMs = System.currentTimeMillis()
        // Always generate a fresh session ID - never reuse stale IDs
        val uuidPart = UUID.randomUUID().toString().replace("-", "").lowercase()
        replayId = "session_${replayStartMs}_$uuidPart"
        finalized = false
        
        crashCount = 0
        freezeCount = 0
        errorCount = 0
        tapCount = 0
        scrollCount = 0
        gestureCount = 0
        rageCount = 0
        deadTapCount = 0
        visitedScreens.clear()
        bgTimeMs = 0
        bgStartMs = null
        
        TelemetryPipeline.shared?.currentReplayId = replayId
        SegmentDispatcher.shared.currentReplayId = replayId
        StabilityMonitor.shared?.currentSessionId = replayId
        
        attachLifecycle()
        saveRecovery()
        
        recordAppStartup()
    }
    
    private fun recordAppStartup() {
        val nowMs = System.currentTimeMillis()
        val startupDurationMs = nowMs - processStartTime
        
        // Only record if it's a reasonable startup time (> 0 and < 60 seconds)
        if (startupDurationMs > 0 && startupDurationMs < 60000) {
            TelemetryPipeline.shared?.recordAppStartup(startupDurationMs)
        }
    }
    
    private fun applySettings(cfg: Map<String, Any>?) {
        if (cfg == null) return
        snapshotInterval = (cfg["captureRate"] as? Double) ?: 0.33
        compressionLevel = (cfg["imgCompression"] as? Double) ?: 0.5
        visualCaptureEnabled = (cfg["captureScreen"] as? Boolean) ?: true
        interactionCaptureEnabled = (cfg["captureAnalytics"] as? Boolean) ?: true
        faultTrackingEnabled = (cfg["captureCrashes"] as? Boolean) ?: true
        responsivenessCaptureEnabled = (cfg["captureANR"] as? Boolean) ?: true
        consoleCaptureEnabled = (cfg["captureLogs"] as? Boolean) ?: true
        wifiRequired = (cfg["wifiOnly"] as? Boolean) ?: false
        frameBundleSize = (cfg["screenshotBatchSize"] as? Int) ?: 5
    }
    
    private fun monitorNetwork(token: String) {
        DiagnosticLog.notice("[ReplayOrchestrator] monitorNetwork called")
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        if (connectivityManager == null) {
            DiagnosticLog.notice("[ReplayOrchestrator] No ConnectivityManager, starting recording directly")
            beginRecording(token)
            return
        }
        
        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                handleNetworkChange(capabilities, token)
            }
            
            override fun onLost(network: Network) {
                currentNetworkType = "none"
                netReady = false
            }
        }
        
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        
        try {
            connectivityManager.registerNetworkCallback(request, networkCallback!!)
            
            // Check current network state immediately (callback only fires on CHANGES)
            val activeNetwork = connectivityManager.activeNetwork
            val capabilities = activeNetwork?.let { connectivityManager.getNetworkCapabilities(it) }
            DiagnosticLog.notice("[ReplayOrchestrator] Network check: activeNetwork=${activeNetwork != null}, capabilities=${capabilities != null}")
            if (capabilities != null) {
                handleNetworkChange(capabilities, token)
            } else {
                // No active network - start recording anyway, uploads will retry when network available
                DiagnosticLog.notice("[ReplayOrchestrator] No active network, starting recording anyway")
                mainHandler.post { beginRecording(token) }
            }
        } catch (e: Exception) {
            // Fallback: start anyway
            beginRecording(token)
        }
    }
    
    private fun handleNetworkChange(capabilities: NetworkCapabilities, token: String) {
        val isWifi = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
        val isCellular = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
        val isEthernet = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
        
        networkIsExpensive = !isWifi && !isEthernet
        networkIsConstrained = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
        } else {
            networkIsExpensive
        }
        
        currentNetworkType = when {
            isWifi -> "wifi"
            isCellular -> "cellular"
            isEthernet -> "wired"
            else -> "other"
        }
        
        val canProceed = when {
            wifiRequired && !isWifi -> false
            else -> true
        }
        
        mainHandler.post {
            netReady = canProceed
            if (canProceed && !live) {
                beginRecording(token)
            }
        }
    }
    
    private fun beginRecording(token: String) {
        DiagnosticLog.notice("[ReplayOrchestrator] beginRecording called, live=$live")
        if (live) {
            DiagnosticLog.notice("[ReplayOrchestrator] Already live, skipping")
            return
        }
        live = true
        
        this.apiToken = token
        initSession()
        DiagnosticLog.notice("[ReplayOrchestrator] Session initialized: replayId=$replayId")
        
        // Reactivate the dispatcher in case it was halted from a previous session
        SegmentDispatcher.shared.activate()
        TelemetryPipeline.shared?.activate()
        
        val renderCfg = computeRender(1, "high")
        DiagnosticLog.notice("[ReplayOrchestrator] VisualCapture.shared=${VisualCapture.shared != null}, visualCaptureEnabled=$visualCaptureEnabled")
        VisualCapture.shared?.configure(renderCfg.first, renderCfg.second)
        
        if (visualCaptureEnabled) {
            DiagnosticLog.notice("[ReplayOrchestrator] Starting VisualCapture")
            VisualCapture.shared?.beginCapture(replayStartMs)
        }
        if (interactionCaptureEnabled) InteractionRecorder.shared?.activate()
        if (faultTrackingEnabled) StabilityMonitor.shared?.activate()
        if (responsivenessCaptureEnabled) AnrSentinel.shared?.activate()
        if (hierarchyCaptureEnabled) startHierarchyCapture()
        
        // Start duration limit timer based on remote config
        startDurationLimitTimer()
        
        DiagnosticLog.notice("[ReplayOrchestrator] beginRecording completed")
    }
    
    // MARK: - Duration Limit Timer
    
    private fun startDurationLimitTimer() {
        stopDurationLimitTimer()
        
        val maxMinutes = remoteMaxRecordingMinutes
        if (maxMinutes <= 0) return
        
        val maxMs = maxMinutes.toLong() * 60 * 1000
        val now = System.currentTimeMillis()
        val elapsed = now - replayStartMs
        val remaining = if (maxMs > elapsed) maxMs - elapsed else 0L
        
        if (remaining <= 0) {
            DiagnosticLog.notice("[ReplayOrchestrator] Duration limit already exceeded, stopping session")
            endReplay()
            return
        }
        
        durationLimitRunnable = Runnable {
            if (!live) return@Runnable
            DiagnosticLog.notice("[ReplayOrchestrator] Recording duration limit reached (${maxMinutes}min), stopping session")
            endReplay()
        }
        mainHandler.postDelayed(durationLimitRunnable!!, remaining)
        
        DiagnosticLog.notice("[ReplayOrchestrator] Duration limit timer set: ${remaining / 1000}s remaining (max ${maxMinutes}min)")
    }
    
    private fun stopDurationLimitTimer() {
        durationLimitRunnable?.let { mainHandler.removeCallbacks(it) }
        durationLimitRunnable = null
    }
    
    private fun saveRecovery() {
        val sid = replayId ?: return
        val token = apiToken ?: return
        
        val checkpoint = JSONObject().apply {
            put("replayId", sid)
            put("apiToken", token)
            put("startMs", replayStartMs)
            put("endpoint", serverEndpoint)
        }
        
        try {
            File(context.filesDir, "rejourney_recovery.json").writeText(checkpoint.toString())
        } catch (_: Exception) { }
    }
    
    private fun clearRecovery() {
        try {
            File(context.filesDir, "rejourney_recovery.json").delete()
        } catch (_: Exception) { }
    }
    
    private fun attachLifecycle() {
        val app = context as? Application ?: return
        app.registerActivityLifecycleCallbacks(lifecycleCallbacks)
    }
    
    private fun detachLifecycle() {
        val app = context as? Application ?: return
        app.unregisterActivityLifecycleCallbacks(lifecycleCallbacks)
    }
    
    private val lifecycleCallbacks = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityResumed(activity: Activity) {
            bgStartMs?.let { start ->
                val now = System.currentTimeMillis()
                bgTimeMs += (now - start)
            }
            bgStartMs = null
        }
        
        override fun onActivityPaused(activity: Activity) {
            bgStartMs = System.currentTimeMillis()
        }
        
        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
        override fun onActivityStarted(activity: Activity) {}
        override fun onActivityStopped(activity: Activity) {}
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
        override fun onActivityDestroyed(activity: Activity) {}
    }
    
    private fun unregisterNetworkCallback() {
        networkCallback?.let { callback ->
            try {
                val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                cm?.unregisterNetworkCallback(callback)
            } catch (_: Exception) { }
        }
        networkCallback = null
    }
    
    private fun startHierarchyCapture() {
        stopHierarchyCapture()
        
        hierarchyHandler = Handler(Looper.getMainLooper())
        hierarchyRunnable = object : Runnable {
            override fun run() {
                captureHierarchy()
                hierarchyHandler?.postDelayed(this, (hierarchyCaptureInterval * 1000).toLong())
            }
        }
        hierarchyHandler?.postDelayed(hierarchyRunnable!!, (hierarchyCaptureInterval * 1000).toLong())
        
        // Initial capture after 500ms
        hierarchyHandler?.postDelayed({ captureHierarchy() }, 500)
    }
    
    private fun stopHierarchyCapture() {
        hierarchyRunnable?.let { hierarchyHandler?.removeCallbacks(it) }
        hierarchyHandler = null
        hierarchyRunnable = null
    }
    
    private fun captureHierarchy() {
        if (!live) return
        val sid = replayId ?: return
        
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post { captureHierarchy() }
            return
        }
        
        val hierarchy = ViewHierarchyScanner.shared?.captureHierarchy() ?: return
        
        val hash = hierarchyHash(hierarchy)
        if (hash == lastHierarchyHash) return
        lastHierarchyHash = hash
        
        val json = JSONObject(hierarchy).toString().toByteArray(Charsets.UTF_8)
        val ts = System.currentTimeMillis()
        
        SegmentDispatcher.shared.transmitHierarchy(sid, json, ts, null)
    }
    
    private fun hierarchyHash(h: Map<String, Any>): String {
        val screen = currentScreenName ?: "unknown"
        var childCount = 0
        (h["root"] as? Map<*, *>)?.let { root ->
            (root["children"] as? List<*>)?.let { children ->
                childCount = children.size
            }
        }
        return "$screen:$childCount"
    }
}

private fun computeRender(fps: Int, tier: String): Pair<Double, Double> {
    val interval = 1.0 / fps.coerceIn(1, 99)
    val quality = when (tier.lowercase()) {
        "low" -> 0.4
        "standard" -> 0.5
        // Slightly reduce default high-tier JPEG quality for lower storage without a major visual shift.
        "high" -> 0.55
        else -> 0.5
    }
    return Pair(interval, quality)
}
