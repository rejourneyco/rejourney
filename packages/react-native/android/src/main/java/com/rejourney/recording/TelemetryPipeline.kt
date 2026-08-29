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

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.rejourney.RejourneySdkInfo
import com.rejourney.engine.DiagnosticLog
import com.rejourney.engine.DeviceRegistrar
import com.rejourney.utility.gzipCompress
import org.json.JSONArray
import org.json.JSONObject
import java.util.*
import java.util.ArrayDeque
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.roundToInt

/**
 * Event pipeline for telemetry collection and upload
 * Android implementation aligned with iOS TelemetryPipeline.swift
 */
class TelemetryPipeline private constructor(private val context: Context) {

    companion object {
        @Volatile
        private var instance: TelemetryPipeline? = null

        fun getInstance(context: Context): TelemetryPipeline {
            return instance ?: synchronized(this) {
                instance ?: TelemetryPipeline(context.applicationContext).also { instance = it }
            }
        }

        val shared: TelemetryPipeline?
            get() = instance

        internal fun attributePayload(key: String, value: String): String =
            JSONObject().put("key", key).put("value", value).toString()

        internal fun shouldEmitDeadTap(
            candidateGeneration: Long,
            currentGeneration: Long,
            lastResponseTimestamp: Long,
            tapTimestamp: Long
        ): Boolean = candidateGeneration == currentGeneration && lastResponseTimestamp <= tapTimestamp
    }

    var endpoint: String = "https://api.rejourney.co"
        set(value) {
            field = value
            SegmentDispatcher.shared.endpoint = value
        }

    @Volatile
    var currentReplayId: String? = null
        set(value) {
            field = value
            SegmentDispatcher.shared.currentReplayId = value
        }

    var credential: String? = null
        set(value) {
            field = value
            SegmentDispatcher.shared.credential = value
        }

    var apiToken: String? = null
        set(value) {
            field = value
            SegmentDispatcher.shared.apiToken = value
        }

    var projectId: String? = null
        set(value) {
            field = value
            SegmentDispatcher.shared.projectId = value
        }

    /// SDK's sampling decision for server-side enforcement
    var isSampledIn: Boolean = true
        set(value) {
            field = value
            SegmentDispatcher.shared.isSampledIn = value
        }

    var collectDeviceInfo: Boolean = true

    init {
        SegmentDispatcher.shared.configurePersistence(context)
    }

    private val deviceEnvironmentMonitor = DeviceEnvironmentMonitor(context)

    /**
     * Returns a low-cardinality battery snapshot without requiring a runtime
     * permission. Android recommends a one-shot read of the sticky
     * ACTION_BATTERY_CHANGED intent when continuous monitoring is unnecessary;
     * the short cache avoids repeating that system query for every event batch.
     * Missing emulator/OEM values are omitted instead of guessed.
     */
    fun currentBatteryInfo(): Map<String, Any> = deviceEnvironmentMonitor.currentBatterySnapshot()

    /** Additive session-boundary metrics included in /session/end. */
    fun sessionDeviceMetrics(): Map<String, Any> {
        if (!collectDeviceInfo) return emptyMap()
        return deviceEnvironmentMonitor.sessionSummary()
    }

    // Event ring buffer
    private val eventRing = EventRingBuffer(5000)
    private val frameQueue = FrameBundleQueue(200)
    private val batchSeqBySession = LinkedHashMap<String, Int>()
    private val maxTrackedBatchSequences = 128
    private val drainRegistry = DrainCompletionRegistry()

    private val serialWorker = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var heartbeatRunnable: Runnable? = null
    private val acceptingEvents = AtomicBoolean(false)

    private val batchSizeLimit = 500_000

    // Dead tap detection — timestamp comparison.
    // After a tap, a 400ms timer fires and checks whether any "response" event
    // (navigation or input) occurred since the tap.  If not → dead tap.
    // We do NOT cancel the timer proactively because gesture-recognizer scroll
    // events fire on nearly every tap due to micro-movement and would mask real dead taps.
    private var deadTapRunnable: Runnable? = null
    private val deadTapGeneration = AtomicLong(0)
    private val deadTapTimeoutMs: Long = 400
    private val lastResponseTs = AtomicLong(0)

    fun activate() {
        acceptingEvents.set(true)
        if (collectDeviceInfo) {
            deviceEnvironmentMonitor.start(resetSession = true)
        } else {
            deviceEnvironmentMonitor.clearSession()
        }
        // Upload any pending data from previous sessions first
        uploadPendingSessions()

        // Start heartbeat timer on main thread
        mainHandler.post {
            if (!acceptingEvents.get()) return@post
            // A Runnable that re-posts itself stays queued on the Handler after
            // its reference is overwritten. Re-activating for a new session
            // without removing the previous one would leave it calling
            // dispatchNow() every 5s for the rest of the process.
            heartbeatRunnable?.let { mainHandler.removeCallbacks(it) }
            heartbeatRunnable = object : Runnable {
                override fun run() {
                    dispatchNow()
                    mainHandler.postDelayed(this, 5000)
                }
            }
            mainHandler.postDelayed(heartbeatRunnable!!, 5000)
        }
    }

    /**
     * Pause the heartbeat timer when the app goes to background.
     * This prevents the pipeline from uploading empty event batches
     * while backgrounded, which would inflate session duration.
     */
    fun pause() {
        acceptingEvents.set(false)
        cancelDeadTapTimer()
        deviceEnvironmentMonitor.pause()
        mainHandler.post {
            if (acceptingEvents.get()) return@post
            heartbeatRunnable?.let { mainHandler.removeCallbacks(it) }
            heartbeatRunnable = null
        }
    }

    /**
     * Resume the heartbeat timer when the app returns to foreground.
     */
    fun resume() {
        acceptingEvents.set(true)
        if (collectDeviceInfo) deviceEnvironmentMonitor.start(resetSession = false)
        mainHandler.post {
            if (!acceptingEvents.get() || heartbeatRunnable != null) return@post
            heartbeatRunnable = object : Runnable {
                override fun run() {
                    dispatchNow()
                    mainHandler.postDelayed(this, 5000)
                }
            }
            mainHandler.postDelayed(heartbeatRunnable!!, 5000)
        }
    }

    fun shutdown(completion: (() -> Unit)? = null, skipVisualFlush: Boolean = false) {
        acceptingEvents.set(false)
        cancelDeadTapTimer()
        deviceEnvironmentMonitor.pause()
        mainHandler.post {
            if (acceptingEvents.get()) return@post
            heartbeatRunnable?.let { mainHandler.removeCallbacks(it) }
            heartbeatRunnable = null
        }

        drainPendingDataForShutdown(completion, skipVisualFlush)
    }

    fun finalizeAndShip() {
        shutdown()
    }

    fun submitFrameBundle(
        payload: ByteArray,
        filename: String,
        startMs: Long,
        endMs: Long,
        frameCount: Int,
        sessionId: String? = null
    ) {
        // Capture the session ID now so frames are always attributed to the
        // session that was active when they were captured, not when they ship.
        val capturedSessionId = sessionId ?: currentReplayId
        DiagnosticLog.trace("[TelemetryPipeline] submitFrameBundle: $frameCount frames, ${payload.size} bytes, session=$capturedSessionId")
        serialWorker.execute {
            val bundle = PendingFrameBundle(filename, payload, startMs, endMs, frameCount, capturedSessionId)
            frameQueue.enqueue(bundle)
            shipPendingFrames()
        }
    }

    fun prepareForNewSession(replayId: String) {
        // Pending work is session-owned. A previous session drain may still be
        // running here; its completion remains bound to its own generation and
        // must not be fired merely because this replacement session starts.
        serialWorker.execute {
            batchSeqBySession.putIfAbsent(replayId, 0)
            val protectedSessions = eventRing.sessionIds()
            while (batchSeqBySession.size > maxTrackedBatchSequences) {
                val staleSession = batchSeqBySession.keys.firstOrNull {
                    it != replayId && it !in protectedSessions
                } ?: break
                batchSeqBySession.remove(staleSession)
            }
        }
    }

    fun dispatchNow() {
        serialWorker.execute {
            shipPendingEvents()
            shipPendingFrames()
        }
    }

    fun getQueueDepth(): Int {
        return eventRing.size() + frameQueue.size()
    }

    private fun drainPendingDataForShutdown(
        completion: (() -> Unit)? = null,
        skipVisualFlush: Boolean = false
    ) {
        val drainToken = drainRegistry.begin(completion)

        if (!skipVisualFlush) {
            // Force any in-memory frames into the upload pipeline before session
            // teardown clears the active replay ID.
            VisualCapture.shared?.flushToDisk()
            VisualCapture.shared?.flushBufferToNetwork()
        }

        // FIX: flushBufferToNetwork() submits encode work to VisualCapture.encodeExecutor,
        // which then dispatches frame bundles to serialWorker. Without waiting for the
        // encode executor, shipPendingFrames() below races and often runs before those bundles
        // are in frameQueue — causing them to be missed entirely.
        //
        // We wait on a plain Thread (not serialWorker) to avoid blocking either queue,
        // then submit the ship + upload-wait work to serialWorker.
        Thread {
            // Step A: wait for encode executor — ensures frameQueue is fully populated.
            // Wrapped in try/catch so an unexpected interruption doesn't skip finishDrain.
            try {
                VisualCapture.shared?.waitForEncodingToComplete()
            } catch (_: Exception) { }

            // Step B: ship events + frames, then wait for actual network uploads
            serialWorker.execute {
                try {
                    shipAllPendingForDrain()
                    // Step C: wait for all in-flight upload coroutines before finishing.
                    SegmentDispatcher.shared.awaitPendingUploads(10_000)
                } finally {
                    finishDrain(drainToken)
                }
            }
        }.start()
    }

    private fun appSuspending() {
        val drainToken = drainRegistry.begin()

        // Flush visual frames to disk for crash safety
        VisualCapture.shared?.flushToDisk()
        // Submit any buffered frames to the upload pipeline (even if below batch threshold)
        VisualCapture.shared?.flushBufferToNetwork()

        // FIX: same encode-executor race fix as drainPendingDataForShutdown above.
        // Replaces the previous hardcoded 2-second sleep with a real upload completion wait.
        Thread {
            try {
                VisualCapture.shared?.waitForEncodingToComplete()
            } catch (_: Exception) { }

            serialWorker.execute {
                try {
                    shipAllPendingForDrain()
                    SegmentDispatcher.shared.awaitPendingUploads(10_000)
                } finally {
                    finishDrain(drainToken)
                }
            }
        }.start()
    }

    private fun finishDrain(generation: Long) {
        val completions = drainRegistry.finish(generation) ?: return
        if (completions.isEmpty()) return

        mainHandler.post {
            completions.forEach { it() }
        }
    }

    private fun uploadPendingSessions() {
        // Intentionally deferred: crash/interruption recovery currently restores
        // pending visual frames via ReplayOrchestrator + VisualCapture only.
        // Telemetry events remain best-effort and are not replayed from EventBuffer yet.
    }

    /** Drain every immediately available batch before waiting on the network.
     * Normal heartbeat dispatch sends one batch at a time for backpressure, but
     * shutdown must enqueue the complete backlog or its completion can race the
     * success callback that schedules the next batch. */
    private fun shipAllPendingForDrain() {
        while (eventRing.size() > 0) {
            val before = eventRing.size()
            shipPendingEvents()
            if (eventRing.size() >= before) break
        }
        while (frameQueue.size() > 0) {
            val before = frameQueue.size()
            shipPendingFrames()
            if (frameQueue.size() >= before) break
        }
    }

    private fun shipPendingFrames() {
        val next = frameQueue.dequeue()
        if (next == null) {
            DiagnosticLog.trace("[TelemetryPipeline] shipPendingFrames: no frames in queue")
            return
        }

        val activeSession = currentReplayId

        // Determine which session these frames belong to. Prefer the session ID
        // captured at enqueue time; fall back to the current active session.
        val targetSession = next.sessionId ?: activeSession
        if (targetSession == null) {
            DiagnosticLog.caution("[TelemetryPipeline] shipPendingFrames: no session ID, requeueing")
            frameQueue.requeue(next)
            return
        }

        if (next.sessionId != null && next.sessionId != currentReplayId) {
            DiagnosticLog.trace("[TelemetryPipeline] shipPendingFrames: routing ${next.count} frames to captured session ${next.sessionId} (current=${currentReplayId})")
        }

        DiagnosticLog.trace("[TelemetryPipeline] shipPendingFrames: transmitting ${next.count} frames to SegmentDispatcher")

        SegmentDispatcher.shared.transmitFrameBundleForSession(
            sessionId = targetSession,
            payload = next.payload,
            startMs = next.rangeStart,
            endMs = next.rangeEnd,
            frameCount = next.count
        ) { ok ->
            if (!ok) {
                val latestSession = currentReplayId
                if (next.sessionId != null && latestSession != null && next.sessionId != latestSession) {
                    DiagnosticLog.trace("[TelemetryPipeline] Discarding failed stale frame bundle for closed session ${next.sessionId.take(20)} (current=${latestSession.take(20)})")
                    serialWorker.execute { shipPendingFrames() }
                } else {
                    frameQueue.requeue(next)
                }
            } else {
                serialWorker.execute { shipPendingFrames() }
            }
        }
    }

    private fun shipPendingEvents() {
        val batch = eventRing.drain(batchSizeLimit)
        if (batch.isEmpty()) return

        val targetSession = batch.first().sessionId ?: currentReplayId
        if (targetSession == null) {
            eventRing.prepend(batch)
            return
        }

        val payload = serializeBatch(batch)
        val compressed = payload.gzipCompress()
        if (compressed == null) {
            eventRing.prepend(batch)
            return
        }

        val seq = batchSeqBySession[targetSession] ?: 0
        batchSeqBySession[targetSession] = seq + 1

        SegmentDispatcher.shared.transmitEventBatchForSession(targetSession, compressed, seq, batch.size) { ok ->
            if (!ok && currentReplayId == targetSession) {
                eventRing.prepend(batch)
                return@transmitEventBatchForSession
            }
            if (!ok) {
                DiagnosticLog.trace("[TelemetryPipeline] Discarding exhausted event batch for closed session ${targetSession.take(20)}")
            }
            serialWorker.execute { shipPendingEvents() }
        }
    }

    private fun serializeBatch(events: List<EventEntry>): ByteArray {
        val jsonEvents = JSONArray()
        for (e in events) {
            try {
                var dataStr = String(e.data, Charsets.UTF_8)
                if (dataStr.endsWith("\n")) {
                    dataStr = dataStr.dropLast(1)
                }
                val obj = JSONObject(dataStr)
                jsonEvents.put(obj)
            } catch (_: Exception) { }
        }

        val displayMetrics = context.resources.displayMetrics
        val density = displayMetrics.density.takeIf { it > 0f } ?: 1f
        val orchestrator = ReplayOrchestrator.shared

        val meta = JSONObject().apply {
            put("platform", "android")
            put("time", System.currentTimeMillis() / 1000.0)
            put("sdkVersion", RejourneySdkInfo.sdkVersion)
            // Rendering geometry and app identity are required to interpret
            // replay coordinates and releases; they do not identify a device.
            put("appVersion", getAppVersion())
            put("appId", context.packageName)
            put("screenWidth", (displayMetrics.widthPixels / density).roundToInt())
            put("screenHeight", (displayMetrics.heightPixels / density).roundToInt())
            put("screenWidthPixels", displayMetrics.widthPixels)
            put("screenHeightPixels", displayMetrics.heightPixels)
            put("screenScale", density.toDouble())
            put("pixelRatio", density.toDouble())
            put("coordinateSpace", "dp")
            if (collectDeviceInfo) {
                put("model", Build.MODEL)
                put("osVersion", Build.VERSION.RELEASE)
                put("vendorId", DeviceRegistrar.shared?.deviceFingerprint ?: "")
                put("networkType", orchestrator?.currentNetworkType ?: "unknown")
                put("isConstrained", orchestrator?.networkIsConstrained ?: false)
                put("isExpensive", orchestrator?.networkIsExpensive ?: false)
                put("systemName", "Android")
                put("name", Build.DEVICE)
                deviceEnvironmentMonitor.currentSnapshot().forEach { (key, value) -> put(key, value) }
            }
        }

        val wrapper = JSONObject().apply {
            put("events", jsonEvents)
            put("deviceInfo", meta)
        }

        return wrapper.toString().toByteArray(Charsets.UTF_8)
    }

    private fun getAppVersion(): String {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown"
        } catch (e: Exception) {
            "unknown"
        }
    }

    // Event Recording Methods

    fun recordAttribute(key: String, value: String) {
        enqueue(mapOf(
            "type" to "custom",
            "timestamp" to ts(),
            "name" to "attribute",
            // Metadata is user-controlled. Interpolation produced malformed
            // nested JSON for quotes, backslashes and newlines.
            "payload" to attributePayload(key, value)
        ))
    }

    fun recordCustomEvent(name: String, payload: String) {
        enqueue(mapOf(
            "type" to "custom",
            "timestamp" to ts(),
            "name" to name,
            "payload" to payload
        ))
    }

    fun recordConsoleLogEvent(level: String, message: String) {
        enqueue(mapOf(
            "type" to "log",
            "timestamp" to ts(),
            "level" to level,
            "message" to message
        ))
    }

    fun recordJSErrorEvent(
        name: String,
        message: String,
        stack: String?,
        incidentId: String? = null,
        exceptionCategory: String? = null,
        source: String? = null,
        handled: Boolean? = null
    ) {
        val event = mutableMapOf<String, Any>(
            "type" to "error",
            "timestamp" to ts(),
            "name" to name,
            "message" to message
        )
        if (stack != null) {
            event["stack"] = stack
        }
        if (incidentId != null) {
            event["incidentId"] = incidentId
        }
        if (exceptionCategory != null) {
            event["exceptionCategory"] = exceptionCategory
        }
        if (source != null) {
            event["source"] = source
        }
        if (handled != null) {
            event["handled"] = handled
        }
        enqueue(event)
        // Prioritize JS error delivery to reduce loss on fatal terminations.
        serialWorker.execute { shipPendingEvents() }
    }

    fun recordAnrEvent(
        durationMs: Long,
        stack: String?,
        incidentId: String? = null,
        threadState: String = "unknown"
    ) {
        val event = mutableMapOf<String, Any>(
            "type" to "anr",
            "timestamp" to ts(),
            "durationMs" to durationMs,
            "threadState" to threadState
        )
        if (incidentId != null) {
            event["incidentId"] = incidentId
        }
        if (stack != null) {
            event["stack"] = stack
        }
        enqueue(event)
        // Prioritize ANR delivery while the process is still alive.
        serialWorker.execute { shipPendingEvents() }
    }

    fun recordUserAssociation(userId: String) {
        enqueue(mapOf(
            "type" to "user_identity_changed",
            "timestamp" to ts(),
            "userId" to userId
        ))
    }

    fun recordTapEvent(label: String, x: Long, y: Long, isInteractive: Boolean = false) {
        // Cancel any existing dead tap timer (new tap supersedes previous)
        cancelDeadTapTimer()

        val tapTs = ts()
        enqueue(mapOf(
            "type" to "touch",
            "gestureType" to "tap",
            "timestamp" to tapTs,
            "label" to label,
            "x" to x,
            "y" to y,
            "touches" to listOf(mapOf("x" to x, "y" to y, "timestamp" to tapTs))
        ))

        // Skip dead tap detection for interactive elements (buttons, touchables, etc.)
        // These are expected to respond, so we don't need to track "no response" as dead.
        if (isInteractive || isKeyboardVisible()) return

        // Start dead tap timer — when it fires, check if any response event
        // occurred after this tap.  If not → dead tap.
        val candidateGeneration = deadTapGeneration.get()
        val tapLabel = label
        val tapX = x
        val tapY = y
        val runnable = Runnable {
            if (!shouldEmitDeadTap(
                    candidateGeneration,
                    deadTapGeneration.get(),
                    lastResponseTs.get(),
                    tapTs
                )
            ) return@Runnable
            deadTapRunnable = null
            if (!isKeyboardVisible()) {
                recordDeadTapEvent(tapLabel, tapX, tapY)
                ReplayOrchestrator.shared?.incrementDeadTapTally()
            }
        }
        deadTapRunnable = runnable
        mainHandler.postDelayed(runnable, deadTapTimeoutMs)
    }

    fun recordRageTapEvent(label: String, x: Long, y: Long, count: Int) {
        cancelDeadTapTimer()
        if (isKeyboardVisible()) return
        enqueue(mapOf(
            "type" to "gesture",
            "gestureType" to "rage_tap",
            "timestamp" to ts(),
            "label" to label,
            "x" to x,
            "y" to y,
            "count" to count,
            "frustrationKind" to "rage_tap",
            "touches" to listOf(mapOf("x" to x, "y" to y, "timestamp" to ts()))
        ))
    }

    fun recordDeadTapEvent(label: String, x: Long, y: Long) {
        if (isKeyboardVisible()) return
        enqueue(mapOf(
            "type" to "gesture",
            "gestureType" to "dead_tap",
            "timestamp" to ts(),
            "label" to label,
            "x" to x,
            "y" to y,
            "frustrationKind" to "dead_tap",
            "touches" to listOf(mapOf("x" to x, "y" to y, "timestamp" to ts()))
        ))
    }

    fun recordSwipeEvent(label: String, x: Long, y: Long, direction: String) {
        enqueue(mapOf(
            "type" to "gesture",
            "gestureType" to "swipe",
            "timestamp" to ts(),
            "label" to label,
            "x" to x,
            "y" to y,
            "direction" to direction,
            "touches" to listOf(mapOf("x" to x, "y" to y, "timestamp" to ts()))
        ))
    }

    fun recordScrollEvent(label: String, x: Long, y: Long, direction: String) {
        // NOTE: Do NOT mark scroll as a "response" for dead tap detection.
        // Gesture recognisers classify micro-movement during a tap as a scroll,
        // which would mask nearly every dead tap.  Only navigation and input
        // count as definitive responses.
        enqueue(mapOf(
            "type" to "gesture",
            "gestureType" to "scroll",
            "timestamp" to ts(),
            "label" to label,
            "x" to x,
            "y" to y,
            "direction" to direction,
            "touches" to listOf(mapOf("x" to x, "y" to y, "timestamp" to ts()))
        ))
    }

    fun recordPanEvent(label: String, x: Long, y: Long) {
        enqueue(mapOf(
            "type" to "gesture",
            "gestureType" to "pan",
            "timestamp" to ts(),
            "label" to label,
            "x" to x,
            "y" to y,
            "touches" to listOf(mapOf("x" to x, "y" to y, "timestamp" to ts()))
        ))
    }

    fun recordLongPressEvent(label: String, x: Long, y: Long) {
        enqueue(mapOf(
            "type" to "gesture",
            "gestureType" to "long_press",
            "timestamp" to ts(),
            "label" to label,
            "x" to x,
            "y" to y,
            "touches" to listOf(mapOf("x" to x, "y" to y, "timestamp" to ts()))
        ))
    }

    fun recordPinchEvent(label: String, x: Long, y: Long, scale: Double) {
        enqueue(mapOf(
            "type" to "gesture",
            "gestureType" to "pinch",
            "timestamp" to ts(),
            "label" to label,
            "x" to x,
            "y" to y,
            "scale" to scale,
            "touches" to listOf(mapOf("x" to x, "y" to y, "timestamp" to ts()))
        ))
    }

    fun recordRotationEvent(label: String, x: Long, y: Long, angle: Double) {
        enqueue(mapOf(
            "type" to "gesture",
            "gestureType" to "rotation",
            "timestamp" to ts(),
            "label" to label,
            "x" to x,
            "y" to y,
            "angle" to angle,
            "touches" to listOf(mapOf("x" to x, "y" to y, "timestamp" to ts()))
        ))
    }

    fun recordInputEvent(value: String, redacted: Boolean, label: String) {
        lastResponseTs.set(ts())   // keyboard input = definitive response
        enqueue(mapOf(
            "type" to "input",
            "timestamp" to ts(),
            "value" to if (redacted) "***" else value,
            "redacted" to redacted,
            "label" to label
        ))
    }

    fun recordViewTransition(viewId: String, viewLabel: String, entering: Boolean) {
        lastResponseTs.set(ts())   // navigation = definitive response
        enqueue(mapOf(
            "type" to "navigation",
            "timestamp" to ts(),
            "screen" to viewLabel,
            "screenName" to viewLabel,
            "viewId" to viewId,
            "entering" to entering
        ))
    }

    fun recordNetworkEvent(details: Map<String, Any>) {
        if (RejourneyNetworkEventFilter.shouldIgnore(details)) return
        val event = details.toMutableMap()
        event["type"] = "network_request"
        event["timestamp"] = ts()
        enqueue(event)
    }

    fun recordAppStartup(durationMs: Long) {
        enqueue(mapOf(
            "type" to "app_startup",
            "timestamp" to ts(),
            "durationMs" to durationMs,
            "platform" to "android"
        ))
    }

    fun recordAppForeground(totalBackgroundTimeMs: Long) {
        enqueue(mapOf(
            "type" to "app_foreground",
            "timestamp" to ts(),
            "totalBackgroundTime" to totalBackgroundTimeMs
        ))
    }

    fun recordAppBackground() {
        enqueue(mapOf(
            "type" to "app_background",
            "timestamp" to ts(),
        ))
    }

    private fun cancelDeadTapTimer() {
        deadTapGeneration.incrementAndGet()
        deadTapRunnable?.let { mainHandler.removeCallbacks(it) }
        deadTapRunnable = null
    }

    private fun isKeyboardVisible(): Boolean {
        return InteractionRecorder.shared?.isKeyboardVisible() ?: false
    }

    private fun enqueue(dict: Map<String, Any>) {
        if (!acceptingEvents.get()) return
        try {
            val json = JSONObject(dict)
            val data = (json.toString() + "\n").toByteArray(Charsets.UTF_8)
            if (data.size > batchSizeLimit) {
                DiagnosticLog.caution("[TelemetryPipeline] Dropping oversized event (${data.size} bytes)")
                return
            }
            eventRing.push(EventEntry(data, data.size, currentReplayId))
        } catch (_: Exception) { }
    }

    private fun ts(): Long = System.currentTimeMillis()
}

/**
 * Owns drain completion callbacks by generation. Encoding/upload drains run on
 * one serial worker, but their waits can overlap with lifecycle rollover. A
 * single shared "active drain" slot lets a replacement session complete the
 * old session early, or lets the old worker complete the replacement. Keeping
 * each token independent makes either ordering safe and is cheap off the hot
 * capture path.
 */
internal class DrainCompletionRegistry {
    private val lock = ReentrantLock()
    private var nextGeneration = 0L
    private val activeGenerations = mutableSetOf<Long>()
    private val completionsByGeneration = mutableMapOf<Long, List<() -> Unit>>()

    fun begin(completion: (() -> Unit)? = null): Long = lock.withLock {
        nextGeneration += 1
        val generation = nextGeneration
        activeGenerations.add(generation)
        if (completion != null) completionsByGeneration[generation] = listOf(completion)
        generation
    }

    fun finish(generation: Long): List<() -> Unit>? = lock.withLock {
        if (!activeGenerations.remove(generation)) return null
        completionsByGeneration.remove(generation) ?: emptyList()
    }
}

internal data class EventEntry(
    val data: ByteArray,
    val size: Int,
    val sessionId: String?
)

internal class EventRingBuffer(private val capacity: Int) {
    // Mutations dominate this hot path. A CopyOnWriteArrayList copied up to
    // 5,000 entries on every enqueue/dequeue even though access was already
    // serialized by this lock.
    private val storage = ArrayDeque<EventEntry>(capacity)
    private val lock = ReentrantLock()

    fun push(entry: EventEntry) {
        lock.withLock {
            if (storage.size >= capacity) {
                storage.removeFirst()
            }
            storage.addLast(entry)
        }
    }

    fun prepend(entries: List<EventEntry>) {
        if (entries.isEmpty()) return
        lock.withLock {
            for (entry in entries.asReversed()) {
                if (storage.size >= capacity) storage.removeLast()
                storage.addFirst(entry)
            }
        }
    }

    fun drain(maxBytes: Int): List<EventEntry> {
        lock.withLock {
            val result = mutableListOf<EventEntry>()
            var total = 0
            var targetSession: String? = null
            while (storage.isNotEmpty()) {
                val next = storage.first()
                if (result.isNotEmpty() && next.sessionId != targetSession) break
                if (total + next.size > maxBytes) break
                if (result.isEmpty()) targetSession = next.sessionId
                result.add(next)
                total += next.size
                storage.removeFirst()
            }
            return result
        }
    }

    fun size(): Int = lock.withLock { storage.size }

    fun sessionIds(): Set<String> = lock.withLock {
        storage.mapNotNullTo(mutableSetOf()) { it.sessionId }
    }

    fun clear(): Int {
        lock.withLock {
            val cleared = storage.size
            storage.clear()
            return cleared
        }
    }
}

internal data class PendingFrameBundle(
    val tag: String,
    val payload: ByteArray,
    val rangeStart: Long,
    val rangeEnd: Long,
    val count: Int,
    val sessionId: String? = null
)

internal class FrameBundleQueue(private val maxPending: Int) {
    private val queue = ArrayDeque<PendingFrameBundle>(maxPending)
    private val lock = ReentrantLock()

    fun enqueue(bundle: PendingFrameBundle) {
        lock.withLock {
            if (queue.size >= maxPending) {
                queue.removeFirst()
            }
            queue.addLast(bundle)
        }
    }

    fun dequeue(): PendingFrameBundle? {
        lock.withLock {
            if (queue.isEmpty()) return null
            return queue.removeFirst()
        }
    }

    fun requeue(bundle: PendingFrameBundle) {
        lock.withLock {
            if (queue.size >= maxPending) {
                // Preserve the failed oldest bundle for retry while keeping the
                // queue's memory bound if new captures arrived in flight.
                queue.removeLast()
            }
            queue.addFirst(bundle)
        }
    }

    fun size(): Int = lock.withLock { queue.size }

    fun clear(): Int {
        lock.withLock {
            val cleared = queue.size
            queue.clear()
            return cleared
        }
    }
}
