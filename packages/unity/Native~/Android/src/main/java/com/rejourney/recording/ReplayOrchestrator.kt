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
import android.util.AtomicFile
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import com.rejourney.engine.DeviceRegistrar
import com.rejourney.engine.DiagnosticLog
import com.rejourney.engine.PerformanceSnapshot
import com.rejourney.utility.gzipCompress
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.util.*
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

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

        internal fun shouldRunRecoveryCheckpointTimer(
            live: Boolean,
            userPaused: Boolean,
            backgrounded: Boolean
        ): Boolean = live && !userPaused && !backgrounded

        internal fun shouldActivateResponsivenessWatcher(
            enabled: Boolean,
            live: Boolean,
            userPaused: Boolean,
            backgrounded: Boolean
        ): Boolean = enabled && live && !userPaused && !backgrounded

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
    var frameBundleSize: Int = 3

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
    var maskTextInputsByDefault: Boolean = true
    var maskImagesAndVideosByDefault: Boolean = false
    var captureNativeSheets: Boolean = true
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
    private var hierarchyHandler: Handler? = null
    private var hierarchyRunnable: Runnable? = null
    private var initialHierarchyRunnable: Runnable? = null
    private var lastHierarchyCaptureMonotonicMs: Long = 0
    private val minimumFrameHierarchyIntervalMs = 200L
    private var lastHierarchyHash: String? = null
    private var durationLimitRunnable: Runnable? = null
    private var recoveryCheckpointRunnable: Runnable? = null
    private var lastActiveCheckpointMs: Long = 0
    private var lastBackgroundEntryMs: Long? = null
    @Volatile private var userCapturePaused = false
    private val lifecycleContractVersion = 3
    private val recoveryCheckpointIntervalMs = 5_000L
    private val startGeneration = AtomicLong(0)
    private val recoveryStoreLock = ReentrantLock()
    private val recoveryWriteGeneration = AtomicLong(0)
    private val recoveryScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * Fast session start using existing credentials - skips credential fetch for faster restart
     */
    fun beginReplayFast(apiToken: String, serverEndpoint: String, credential: String, captureSettings: Map<String, Any>? = null) {
        val generation = startGeneration.incrementAndGet()
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
            if (startGeneration.get() == generation) {
                beginRecording(apiToken, generation)
            }
        }
    }

    fun beginReplay(apiToken: String, serverEndpoint: String, captureSettings: Map<String, Any>? = null) {
        val generation = startGeneration.incrementAndGet()
        DiagnosticLog.trace("[ReplayOrchestrator] beginReplay v2")
        val perf = PerformanceSnapshot.capture()
        DiagnosticLog.debugSessionCreate("ORCHESTRATOR_INIT", "beginReplay", perf)
        DiagnosticLog.trace("[ReplayOrchestrator] beginReplay called, endpoint=$serverEndpoint")

        this.apiToken = apiToken
        this.serverEndpoint = serverEndpoint
        applySettings(captureSettings)

        DiagnosticLog.debugSessionCreate("CREDENTIAL_START", "Requesting device credential")
        DiagnosticLog.trace("[ReplayOrchestrator] Requesting credential from DeviceRegistrar.shared=${DeviceRegistrar.shared != null}")

        DeviceRegistrar.shared?.obtainCredential(apiToken) { ok, cred ->
            DiagnosticLog.trace("[ReplayOrchestrator] Credential callback: ok=$ok, cred=${cred?.take(20) ?: "null"}...")
            if (!ok || startGeneration.get() != generation) {
                DiagnosticLog.debugSessionCreate("CREDENTIAL_FAIL", "Failed")
                DiagnosticLog.caution("[ReplayOrchestrator] Credential fetch FAILED - recording cannot start")
                return@obtainCredential
            }

            TelemetryPipeline.shared?.apiToken = apiToken
            TelemetryPipeline.shared?.credential = cred
            SegmentDispatcher.shared.apiToken = apiToken
            SegmentDispatcher.shared.credential = cred

            DiagnosticLog.trace("[ReplayOrchestrator] Credential OK, calling monitorNetwork")
            monitorNetwork(apiToken, generation)
        }
    }

    fun cancelPendingReplayStart() {
        startGeneration.incrementAndGet()
        unregisterNetworkCallback()
    }

    fun endReplay(completion: ((Boolean, Boolean) -> Unit)? = null) {
        endReplayInternal("unspecified", completion)
    }

    fun endReplayWithReason(endReason: String, completion: ((Boolean, Boolean) -> Unit)? = null) {
        endReplayInternal(endReason, completion)
    }

    private fun endReplayInternal(endReason: String, completion: ((Boolean, Boolean) -> Unit)? = null) {
        cancelPendingReplayStart()
        if (!live) {
            completion?.invoke(false, false)
            return
        }
        live = false
        stopRecoveryCheckpointTimer()

        val sid = replayId ?: ""
        val termMs = System.currentTimeMillis()
        val elapsed = ((termMs - replayStartMs).coerceAtLeast(0L) / 1000).toInt()

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
            "screenCount" to visitedScreens.toSet().size,
            // Frames the SDK declined to capture. Without these a heavily
            // degraded replay is indistinguishable from a complete one.
            "framesSkippedThrottle" to (VisualCapture.shared?.skippedFramesThrottle?.get() ?: 0),
            "framesSkippedBacklog" to (VisualCapture.shared?.skippedFramesBacklog?.get() ?: 0),
            "framesSkippedMapMoving" to (VisualCapture.shared?.skippedFramesMapMoving?.get() ?: 0),
            "framesCaptured" to (VisualCapture.shared?.framesCaptured?.get() ?: 0),
            "framesSkippedDuplicate" to (VisualCapture.shared?.skippedFramesDuplicate?.get() ?: 0)
        ) + (TelemetryPipeline.shared?.sessionDeviceMetrics() ?: emptyMap())
        val queueDepthAtFinalize = TelemetryPipeline.shared?.getQueueDepth() ?: 0
        val backgroundDurationMs = bgTimeMs
        val closeAnchorAtMs = currentCloseAnchorAtMs(endReason)

        // Capture the current generation so a stale halt posted here won't
        // stop a new session's capture that starts before this block runs.
        val haltGeneration = VisualCapture.shared?.captureGeneration ?: -1

        val didFinalize = AtomicBoolean(false)
        val finalizeSession = finalize@{
            if (!didFinalize.compareAndSet(false, true)) return@finalize
            SegmentDispatcher.shared.shipPending()

            SegmentDispatcher.shared.concludeReplay(
                sid,
                termMs,
                backgroundDurationMs,
                metrics,
                queueDepthAtFinalize,
                endReason = endReason,
                lifecycleVersion = lifecycleContractVersion,
                closeAnchorAtMs = closeAnchorAtMs
            ) { ok ->
                if (ok) {
                    VisualCapture.shared?.clearPendingFrames(sid)
                    clearRecovery(expectedSessionId = sid)
                }
                completion?.invoke(true, ok)
            }

            if (replayId == sid) {
                replayId = null
                replayStartMs = 0
            }
        }

        // Do local teardown immediately so lifecycle rollover never depends on network latency,
        // but finish session finalization only after the telemetry drain has been kicked off.
        mainHandler.post {
            VisualCapture.shared?.halt(haltGeneration)
            TelemetryPipeline.shared?.shutdown(completion = finalizeSession, skipVisualFlush = true) ?: finalizeSession()
            InteractionRecorder.shared?.deactivate()
            SpecialCases.shared.reset()
            StabilityMonitor.shared?.deactivate()
            AnrSentinel.shared.deactivate()
        }
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
        isSampledIn: Boolean,
        maxRecordingMinutes: Int
    ) {
        this.remoteRejourneyEnabled = rejourneyEnabled
        this.remoteRecordingEnabled = recordingEnabled
        this.remoteSampleRate = sampleRate
        this.remoteMaxRecordingMinutes = maxRecordingMinutes

        // Set isSampledIn for server-side enforcement. This tracks sampling only;
        // recordingEnabled=false can also mean observe-only/debug telemetry.
        TelemetryPipeline.shared?.isSampledIn = isSampledIn

        // Apply recording settings immediately
        // If recording is disabled, disable visual capture
        if (!recordingEnabled) {
            visualCaptureEnabled = false
            DiagnosticLog.trace("[ReplayOrchestrator] Visual capture disabled by remote config (recordingEnabled=false)")
        }

        // If already recording, restart the duration limit timer with updated config
        if (live) {
            startDurationLimitTimer()
        }

        DiagnosticLog.trace("[ReplayOrchestrator] Remote config applied: rejourneyEnabled=$rejourneyEnabled, recordingEnabled=$recordingEnabled, sampleRate=$sampleRate%, maxRecording=${maxRecordingMinutes}min, isSampledIn=$isSampledIn")
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

    fun pauseForBackground() {
        val now = System.currentTimeMillis()
        lastBackgroundEntryMs = now
        saveRecovery()
        stopRecoveryCheckpointTimer()
        suspendCaptureWork(pauseFaultTracking = false)
    }

    fun resumeFromBackground() {
        lastBackgroundEntryMs = null
        lastActiveCheckpointMs = System.currentTimeMillis()
        saveRecovery()
        startRecoveryCheckpointTimer()
        resumeCaptureWorkIfAllowed()
    }

    fun pauseForUser() {
        if (!live || userCapturePaused) return
        userCapturePaused = true
        lastActiveCheckpointMs = System.currentTimeMillis()
        saveRecovery(asynchronously = true)
        stopRecoveryCheckpointTimer()
        suspendCaptureWork(pauseFaultTracking = true)
    }

    fun resumeFromUser() {
        if (!live || !userCapturePaused) return
        userCapturePaused = false
        lastActiveCheckpointMs = System.currentTimeMillis()
        saveRecovery(asynchronously = true)
        startRecoveryCheckpointTimer()
        resumeCaptureWorkIfAllowed()
    }

    private fun suspendCaptureWork(pauseFaultTracking: Boolean) {
        stopHierarchyCapture()
        InteractionRecorder.shared?.deactivate()
        AnrSentinel.shared.deactivate()
        if (pauseFaultTracking) StabilityMonitor.shared?.deactivate()
    }

    private fun resumeCaptureWorkIfAllowed() {
        if (!live || userCapturePaused || lastBackgroundEntryMs != null) return
        if (interactionCaptureEnabled) InteractionRecorder.shared?.activate()
        if (faultTrackingEnabled) StabilityMonitor.shared?.activate()
        if (responsivenessCaptureEnabled) AnrSentinel.shared.activate()
        if (hierarchyCaptureEnabled && hierarchyRunnable == null) startHierarchyCapture()
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
            val recId = checkpoint.optString("replayId", "")
            if (recId.isBlank()) {
                clearRecovery()
                completion(null)
                return
            }

            val origStart = checkpoint.optLong("startMs", 0)
            val timingVersion = checkpoint.optInt("timingVersion", 0)
            val lastActiveCheckpointMs = checkpoint.optLong("lastActiveCheckpointMs", 0)
            val lastBackgroundEntryMs = checkpoint.optLong("lastBackgroundEntryMs", 0)
            val nowMs = System.currentTimeMillis()

            DiagnosticLog.notice("[ReplayOrchestrator] Recovering interrupted session: $recId")

            checkpoint.optString("apiToken", "").takeIf { it.isNotBlank() }?.let { SegmentDispatcher.shared.apiToken = it }
            checkpoint.optString("endpoint", "").takeIf { it.isNotBlank() }?.let { SegmentDispatcher.shared.endpoint = it }
            checkpoint.optString("credential", "").takeIf { it.isNotBlank() }?.let { SegmentDispatcher.shared.credential = it }
            checkpoint.optString("projectId", "").takeIf { it.isNotBlank() }?.let { SegmentDispatcher.shared.projectId = it }
            SegmentDispatcher.shared.currentReplayId = recId
            SegmentDispatcher.shared.activate()
            TelemetryPipeline.shared?.currentReplayId = recId
            val hasCrashIncident = hasStoredCrashIncidentForSession(recId)

            val finalizeRecoveredSession = {
                val crashMetrics = mapOf(
                    "crashCount" to if (hasCrashIncident) 1 else 0,
                    "durationSeconds" to ((nowMs - origStart).coerceAtLeast(0L) / 1000).toInt()
                )
                val queueDepthAtFinalize = TelemetryPipeline.shared?.getQueueDepth() ?: 0

                SegmentDispatcher.shared.concludeReplay(
                    recId,
                    nowMs,
                    0,
                    crashMetrics,
                    queueDepthAtFinalize,
                    endReason = "recovery_finalize",
                    lifecycleVersion = lifecycleContractVersion,
                    closeAnchorAtMs = if (timingVersion >= 3) {
                        when {
                            lastBackgroundEntryMs > 0 -> lastBackgroundEntryMs
                            lastActiveCheckpointMs > 0 -> lastActiveCheckpointMs
                            else -> null
                        }
                    } else null
                ) { ok ->
                    DiagnosticLog.notice("[ReplayOrchestrator] Crash recovery finalize: success=$ok, sessionId=$recId")
                    if (ok) {
                        clearRecovery(expectedSessionId = recId)
                    }
                    completion(if (ok) recId else null)
                }
            }

            val visualCapture = VisualCapture.shared
            if (visualCapture == null) {
                finalizeRecoveredSession()
            } else {
                visualCapture.uploadPendingFrames(recId, origStart) { framesUploaded ->
                    if (!framesUploaded) {
                        DiagnosticLog.caution("[ReplayOrchestrator] Crash recovery postponed: pending frame upload failed for session $recId")
                        completion(null)
                        return@uploadPendingFrames
                    }
                    finalizeRecoveredSession()
                }
            }
        } catch (e: Exception) {
            DiagnosticLog.fault("[ReplayOrchestrator] Crash recovery failed: ${e.message}")
            completion(null)
        }
    }

    private fun hasStoredCrashIncidentForSession(sessionId: String): Boolean {
        val incidentFile = File(context.filesDir, "rejourney/rj_incidents.json")
        if (!incidentFile.exists() && !File("${incidentFile.path}.bak").exists()) return false

        return try {
            val data = AtomicFile(incidentFile).openRead().bufferedReader().use { it.readText() }
            IncidentRecord.listFromJson(data).any { incident ->
                val category = incident.category.lowercase()
                val crashLikeCategory = category == "signal" || category == "exception" || category == "crash"
                crashLikeCategory &&
                    incident.sessionId == sessionId &&
                    (incident.identifier.isNotBlank() || incident.detail.isNotBlank())
            }
        } catch (_: Exception) {
            false
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
        if (visitedScreens.size >= 500) {
            val excess = visitedScreens.size - 250
            repeat(excess) { visitedScreens.removeAt(0) }
        }
        visitedScreens.add(screenId)
        currentScreenName = screenId
        if (hierarchyCaptureEnabled) captureHierarchy()
    }

    private fun initSession() {
        replayStartMs = System.currentTimeMillis()
        // Always generate a fresh session ID - never reuse stale IDs
        val uuidPart = UUID.randomUUID().toString().replace("-", "").lowercase()
        replayId = "session_${replayStartMs}_$uuidPart"
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
        lastActiveCheckpointMs = replayStartMs
        lastBackgroundEntryMs = null
        lastHierarchyHash = null

        TelemetryPipeline.shared?.currentReplayId = replayId
        SegmentDispatcher.shared.currentReplayId = replayId

        attachLifecycle()
        saveRecovery()
        startRecoveryCheckpointTimer()
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
        snapshotInterval = (cfg["captureRate"] as? Double) ?: 1.0
        compressionLevel = (cfg["imgCompression"] as? Double) ?: 0.5
        visualCaptureEnabled = (cfg["captureScreen"] as? Boolean) ?: true
        interactionCaptureEnabled = (cfg["captureAnalytics"] as? Boolean) ?: true
        faultTrackingEnabled = (cfg["captureCrashes"] as? Boolean) ?: true
        responsivenessCaptureEnabled = (cfg["captureANR"] as? Boolean) ?: true
        consoleCaptureEnabled = (cfg["captureLogs"] as? Boolean) ?: true
        maskTextInputsByDefault = (cfg["textInputMasking"] as? String) != "secure_only"
        maskImagesAndVideosByDefault = (cfg["imageVideoMasking"] as? String) == "all"
        captureNativeSheets = (cfg["captureNativeSheets"] as? Boolean) ?: true
        wifiRequired = (cfg["wifiOnly"] as? Boolean) ?: false
        frameBundleSize = (cfg["screenshotBatchSize"] as? Int) ?: 3
        InteractionRecorder.shared?.configureRageTapDetection(
            enabled = (cfg["detectRageTaps"] as? Boolean) ?: true,
            threshold = (cfg["rageTapThreshold"] as? Int) ?: 3,
            timeWindowMs = ((cfg["rageTapTimeWindow"] as? Number)?.toLong()) ?: 500L,
            radius = ((cfg["rageTapRadius"] as? Number)?.toFloat()) ?: 50f
        )
        TelemetryPipeline.shared?.collectDeviceInfo = (cfg["collectDeviceInfo"] as? Boolean) ?: true
        SegmentDispatcher.shared.collectGeoLocation = (cfg["collectGeoLocation"] as? Boolean) ?: true
        SegmentDispatcher.shared.observeOnly = (cfg["observeOnly"] as? Boolean) ?: false
    }

    private fun monitorNetwork(token: String, generation: Long) {
        DiagnosticLog.trace("[ReplayOrchestrator] monitorNetwork called")
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        if (connectivityManager == null) {
            DiagnosticLog.trace("[ReplayOrchestrator] No ConnectivityManager, starting recording directly")
            mainHandler.post {
                if (startGeneration.get() == generation) beginRecording(token, generation)
            }
            return
        }

        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                handleNetworkChange(capabilities, token, generation)
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
            DiagnosticLog.trace("[ReplayOrchestrator] Network check: activeNetwork=${activeNetwork != null}, capabilities=${capabilities != null}")
            if (capabilities != null) {
                handleNetworkChange(capabilities, token, generation)
            } else {
                // No active network - start recording anyway, uploads will retry when network available
                DiagnosticLog.trace("[ReplayOrchestrator] No active network, starting recording anyway")
                mainHandler.post {
                    if (startGeneration.get() == generation) beginRecording(token, generation)
                }
            }
        } catch (e: Exception) {
            // Fallback: start anyway
            mainHandler.post {
                if (startGeneration.get() == generation) beginRecording(token, generation)
            }
        }
    }

    private fun handleNetworkChange(capabilities: NetworkCapabilities, token: String, generation: Long) {
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
            if (startGeneration.get() != generation) return@post
            netReady = canProceed
            if (canProceed && !live) {
                beginRecording(token, generation)
            }
        }
    }

    private fun beginRecording(token: String, generation: Long) {
        DiagnosticLog.trace("[ReplayOrchestrator] beginRecording called, live=$live")
        if (startGeneration.get() != generation || live) {
            DiagnosticLog.trace("[ReplayOrchestrator] Already live, skipping")
            return
        }
        live = true
        userCapturePaused = false

        this.apiToken = token
        initSession()
        DiagnosticLog.trace("[ReplayOrchestrator] Session initialized: replayId=$replayId")

        replayId?.let { sid ->
            SegmentDispatcher.shared.configure(
                replayId = sid,
                apiToken = TelemetryPipeline.shared?.apiToken ?: token,
                credential = TelemetryPipeline.shared?.credential,
                projectId = TelemetryPipeline.shared?.projectId,
                isSampledIn = TelemetryPipeline.shared?.isSampledIn ?: true
            )
            // Configure the non-secret upload route before persisting the
            // crash/ANR session binding. Otherwise a project switch can leave
            // durable incidents associated with the previous project.
            StabilityMonitor.shared?.currentSessionId = sid
            TelemetryPipeline.shared?.prepareForNewSession(sid)
        }

        // prepareForNewSession clears stale buffered events. Recording startup
        // before it silently discarded every Android app_startup event.
        recordAppStartup()

        // Reactivate the dispatcher in case it was halted from a previous session
        SegmentDispatcher.shared.activate()
        TelemetryPipeline.shared?.activate()

        DiagnosticLog.trace("[ReplayOrchestrator] VisualCapture.shared=${VisualCapture.shared != null}, visualCaptureEnabled=$visualCaptureEnabled")
        VisualCapture.shared?.configure(snapshotInterval, compressionLevel, frameBundleSize)

        if (visualCaptureEnabled) {
            DiagnosticLog.trace("[ReplayOrchestrator] Starting VisualCapture")
            VisualCapture.shared?.beginCapture(replayStartMs)
        }
        if (interactionCaptureEnabled) InteractionRecorder.shared?.activate()
        if (faultTrackingEnabled) StabilityMonitor.shared?.activate()
        if (responsivenessCaptureEnabled) AnrSentinel.shared.activate()
        if (hierarchyCaptureEnabled) startHierarchyCapture()

        // Start duration limit timer based on remote config
        startDurationLimitTimer()

        DiagnosticLog.trace("[ReplayOrchestrator] beginRecording completed")
    }

    // MARK: - Duration Limit Timer

    private fun startDurationLimitTimer() {
        stopDurationLimitTimer()

        val maxMinutes = remoteMaxRecordingMinutes
        if (maxMinutes <= 0) return

        val maxMs = maxMinutes.toLong() * 60 * 1000
        val now = System.currentTimeMillis()
        val elapsed = (now - replayStartMs).coerceAtLeast(0L)
        val remaining = if (maxMs > elapsed) maxMs - elapsed else 0L

        if (remaining <= 0) {
            DiagnosticLog.trace("[ReplayOrchestrator] Duration limit already exceeded, stopping session")
            endReplayWithReason("duration_limit")
            return
        }

        durationLimitRunnable = Runnable {
            if (!live) return@Runnable
            DiagnosticLog.trace("[ReplayOrchestrator] Recording duration limit reached (${maxMinutes}min), stopping session")
            endReplayWithReason("duration_limit")
        }
        mainHandler.postDelayed(durationLimitRunnable!!, remaining)

        DiagnosticLog.trace("[ReplayOrchestrator] Duration limit timer set: ${remaining / 1000}s remaining (max ${maxMinutes}min)")
    }

    private fun stopDurationLimitTimer() {
        durationLimitRunnable?.let { mainHandler.removeCallbacks(it) }
        durationLimitRunnable = null
    }

    private fun saveRecovery(asynchronously: Boolean = false) {
        val sid = replayId ?: return
        val token = apiToken ?: return

        val checkpoint = JSONObject().apply {
            put("timingVersion", lifecycleContractVersion)
            put("replayId", sid)
            put("apiToken", token)
            put("startMs", replayStartMs)
            put("lastActiveCheckpointMs", lastActiveCheckpointMs)
            lastBackgroundEntryMs?.takeIf { it > 0 }?.let { put("lastBackgroundEntryMs", it) }
            put("endpoint", serverEndpoint)
            SegmentDispatcher.shared.credential?.let { put("credential", it) }
            SegmentDispatcher.shared.projectId?.let { put("projectId", it) }
        }

        val data = checkpoint.toString().toByteArray(Charsets.UTF_8)
        val generation = recoveryWriteGeneration.incrementAndGet()
        if (asynchronously) {
            recoveryScope.launch { writeRecovery(data, generation) }
        } else {
            writeRecovery(data, generation)
        }
    }

    private fun writeRecovery(data: ByteArray, generation: Long) {
        if (recoveryWriteGeneration.get() != generation) return
        recoveryStoreLock.withLock {
            if (recoveryWriteGeneration.get() != generation) return
            try {
                val atomicFile = AtomicFile(File(context.filesDir, "rejourney_recovery.json"))
                val stream = atomicFile.startWrite()
                try {
                    stream.write(data)
                    atomicFile.finishWrite(stream)
                } catch (error: Exception) {
                    atomicFile.failWrite(stream)
                    throw error
                }
            } catch (_: Exception) { }
        }
    }

    private fun clearRecovery(expectedSessionId: String? = null) {
        recoveryWriteGeneration.incrementAndGet()
        recoveryStoreLock.withLock {
            try {
                val file = File(context.filesDir, "rejourney_recovery.json")
                if (expectedSessionId != null && file.exists()) {
                    val checkpoint = runCatching {
                        JSONObject(AtomicFile(file).openRead().bufferedReader().use { it.readText() })
                    }.getOrNull()
                    if (checkpoint?.optString("replayId") != expectedSessionId) return@withLock
                }
                file.delete()
            } catch (_: Exception) { }
        }
    }

    private fun startRecoveryCheckpointTimer() {
        stopRecoveryCheckpointTimer()
        if (!shouldRunRecoveryCheckpointTimer(
                live = live,
                userPaused = userCapturePaused,
                backgrounded = bgStartMs != null || lastBackgroundEntryMs != null
            )
        ) return
        recoveryCheckpointRunnable = object : Runnable {
            override fun run() {
                if (!shouldRunRecoveryCheckpointTimer(
                        live = live,
                        userPaused = userCapturePaused,
                        backgrounded = bgStartMs != null || lastBackgroundEntryMs != null
                    )
                ) return
                lastActiveCheckpointMs = System.currentTimeMillis()
                saveRecovery(asynchronously = true)
                mainHandler.postDelayed(this, recoveryCheckpointIntervalMs)
            }
        }
        mainHandler.postDelayed(recoveryCheckpointRunnable!!, recoveryCheckpointIntervalMs)
    }

    private fun stopRecoveryCheckpointTimer() {
        recoveryCheckpointRunnable?.let { mainHandler.removeCallbacks(it) }
        recoveryCheckpointRunnable = null
    }


    private fun currentCloseAnchorAtMs(endReason: String): Long? {
        return when (endReason) {
            "background_timeout" -> lastBackgroundEntryMs ?: bgStartMs
            else -> null
        }?.takeIf { it > 0 }
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
                bgTimeMs += (now - start).coerceAtLeast(0L)
            }
            bgStartMs = null

            if (shouldActivateResponsivenessWatcher(
                    enabled = responsivenessCaptureEnabled,
                    live = live,
                    userPaused = userCapturePaused,
                    backgrounded = lastBackgroundEntryMs != null
                )
            ) {
                AnrSentinel.shared.activate()
            }
        }

        override fun onActivityPaused(activity: Activity) {
            bgStartMs = System.currentTimeMillis()
            AnrSentinel.shared.deactivate()
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
                captureHierarchy(skipDuplicate = true, eventDriven = false)
                hierarchyHandler?.postDelayed(this, (hierarchyCaptureInterval * 1000).toLong())
            }
        }
        hierarchyHandler?.postDelayed(hierarchyRunnable!!, (hierarchyCaptureInterval * 1000).toLong())

        // Initial capture after 500ms
        initialHierarchyRunnable = Runnable {
            initialHierarchyRunnable = null
            if (live) captureHierarchy(skipDuplicate = true, eventDriven = false)
        }
        hierarchyHandler?.postDelayed(initialHierarchyRunnable!!, 500)
    }

    private fun stopHierarchyCapture() {
        hierarchyRunnable?.let { hierarchyHandler?.removeCallbacks(it) }
        initialHierarchyRunnable?.let { hierarchyHandler?.removeCallbacks(it) }
        initialHierarchyRunnable = null
        hierarchyHandler = null
        hierarchyRunnable = null
    }

    fun captureHierarchyForFrame(timestampMs: Long) {
        if (userCapturePaused || lastBackgroundEntryMs != null) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastHierarchyCaptureMonotonicMs < minimumFrameHierarchyIntervalMs) return
        captureHierarchy(timestampMs = timestampMs, skipDuplicate = true, eventDriven = true)
    }

    private fun captureHierarchy(
        timestampMs: Long? = null,
        skipDuplicate: Boolean = true,
        eventDriven: Boolean = false
    ) {
        if (!live || userCapturePaused || lastBackgroundEntryMs != null) return
        val sid = replayId ?: return

        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post {
                captureHierarchy(
                    timestampMs = timestampMs,
                    skipDuplicate = skipDuplicate,
                    eventDriven = eventDriven
                )
            }
            return
        }

        // Throttle hierarchy capture while a map camera is moving -- the scan
        // traverses the full view tree including the map's deep SurfaceView/
        // TextureView subtree, adding UI-thread pressure exactly when the frame
        // is being dropped anyway. An event-driven scan is never throttled.
        if (!shouldCaptureMapBackedContent(
                mapVisible = SpecialCases.shared.mapVisible,
                mapIdle = SpecialCases.shared.mapIdle,
                eventDriven = eventDriven
            )) {
            return
        }

        val hierarchy = (ViewHierarchyScanner.shared.captureHierarchy() ?: return).toMutableMap()
        lastHierarchyCaptureMonotonicMs = SystemClock.elapsedRealtime()
        val ts = timestampMs ?: System.currentTimeMillis()
        hierarchy["timestamp"] = ts

        val hash = hierarchyHash(hierarchy)
        if (skipDuplicate && hash == lastHierarchyHash) return
        lastHierarchyHash = hash

        val json = JSONObject(hierarchy).toString().toByteArray(Charsets.UTF_8)
        val compressed = json.gzipCompress() ?: return

        SegmentDispatcher.shared.transmitHierarchy(sid, compressed, ts, null)
    }

    private fun hierarchyHash(hierarchy: Map<String, Any>): String {
        var hash = -0x340d631b7bdddcdbL
        fun mix(value: String) {
            value.toByteArray(Charsets.UTF_8).forEach { byte ->
                hash = hash xor (byte.toLong() and 0xff)
                hash *= 0x100000001b3L
            }
        }
        fun visit(value: Any?) {
            when (value) {
                is Map<*, *> -> value.keys.filterIsInstance<String>().sorted().forEach { key ->
                    if (key != "timestamp") {
                        mix(key)
                        visit(value[key])
                    }
                }
                is Iterable<*> -> {
                    mix("[")
                    value.forEach(::visit)
                    mix("]")
                }
                null -> mix("null")
                else -> mix(value.toString())
            }
        }
        visit(hierarchy)
        return hash.toULong().toString(16)
    }
}

private fun computeRender(fps: Int, tier: String): Pair<Double, Double> {
    val tierLower = tier.lowercase()
    return when (tierLower) {
        "minimal" -> Pair(2.0, 0.4)  // 0.5 fps for maximum size reduction
        "low" -> Pair(1.0 / fps.coerceIn(1, 99), 0.4)
        "standard" -> Pair(1.0 / fps.coerceIn(1, 99), 0.5)
        "high" -> Pair(1.0 / fps.coerceIn(1, 99), 0.55)
        else -> Pair(1.0 / fps.coerceIn(1, 99), 0.5)
    }
}
