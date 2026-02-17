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
import com.rejourney.engine.DiagnosticLog
import com.rejourney.engine.DeviceRegistrar
import com.rejourney.utility.gzipCompress
import org.json.JSONArray
import org.json.JSONObject
import java.util.*
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

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
    }
    
    var endpoint: String = "https://api.rejourney.co"
        set(value) {
            field = value
            SegmentDispatcher.shared.endpoint = value
        }
    
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
    
    // Event ring buffer
    private val eventRing = EventRingBuffer(5000)
    private val frameQueue = FrameBundleQueue(200)
    private var deferredMode = false
    private var batchSeq = 0
    private var draining = false
    
    private val serialWorker = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var heartbeatRunnable: Runnable? = null
    
    private val batchSizeLimit = 500_000
    
    // Dead tap detection — timestamp comparison.
    // After a tap, a 400ms timer fires and checks whether any "response" event
    // (navigation or input) occurred since the tap.  If not → dead tap.
    // We do NOT cancel the timer proactively because gesture-recognizer scroll
    // events fire on nearly every tap due to micro-movement and would mask real dead taps.
    private var deadTapRunnable: Runnable? = null
    private var lastTapLabel: String = ""
    private var lastTapX: Long = 0
    private var lastTapY: Long = 0
    private val deadTapTimeoutMs: Long = 400
    private var lastTapTs: Long = 0
    private var lastResponseTs: Long = 0
    
    fun activate() {
        // Upload any pending data from previous sessions first
        uploadPendingSessions()
        
        // Start heartbeat timer on main thread
        mainHandler.post {
            heartbeatRunnable = object : Runnable {
                override fun run() {
                    dispatchNow()
                    mainHandler.postDelayed(this, 5000)
                }
            }
            mainHandler.postDelayed(heartbeatRunnable!!, 5000)
        }
    }
    
    fun shutdown() {
        heartbeatRunnable?.let { mainHandler.removeCallbacks(it) }
        heartbeatRunnable = null
        
        SegmentDispatcher.shared.halt()
        appSuspending()
    }
    
    fun finalizeAndShip() {
        shutdown()
    }
    
    fun activateDeferredMode() {
        serialWorker.execute { deferredMode = true }
    }
    
    fun commitDeferredData() {
        serialWorker.execute {
            deferredMode = false
            shipPendingEvents()
            shipPendingFrames()
        }
    }
    
    fun submitFrameBundle(payload: ByteArray, filename: String, startMs: Long, endMs: Long, frameCount: Int) {
        DiagnosticLog.trace("[TelemetryPipeline] submitFrameBundle: $frameCount frames, ${payload.size} bytes, deferredMode=$deferredMode")
        serialWorker.execute {
            val bundle = PendingFrameBundle(filename, payload, startMs, endMs, frameCount)
            frameQueue.enqueue(bundle)
            if (!deferredMode) shipPendingFrames()
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
    
    private fun appSuspending() {
        if (draining) return
        draining = true
        
        // Flush visual frames to disk for crash safety
        VisualCapture.shared?.flushToDisk()
        // Submit any buffered frames to the upload pipeline (even if below batch threshold)
        VisualCapture.shared?.flushBufferToNetwork()
        
        // Try to upload pending data
        serialWorker.execute {
            shipPendingEvents()
            shipPendingFrames()
            
            Thread.sleep(2000)
            draining = false
        }
    }
    
    private fun uploadPendingSessions() {
        // TODO: Implement pending session upload
    }
    
    private fun shipPendingFrames() {
        if (deferredMode) {
            DiagnosticLog.trace("[TelemetryPipeline] shipPendingFrames: skipped (deferred mode)")
            return
        }
        val next = frameQueue.dequeue()
        if (next == null) {
            DiagnosticLog.trace("[TelemetryPipeline] shipPendingFrames: no frames in queue")
            return
        }
        if (currentReplayId == null) {
            DiagnosticLog.caution("[TelemetryPipeline] shipPendingFrames: no currentReplayId, requeueing")
            frameQueue.requeue(next)
            return
        }
        
        DiagnosticLog.trace("[TelemetryPipeline] shipPendingFrames: transmitting ${next.count} frames to SegmentDispatcher")
        
        SegmentDispatcher.shared.transmitFrameBundle(
            payload = next.payload,
            startMs = next.rangeStart,
            endMs = next.rangeEnd,
            frameCount = next.count
        ) { ok ->
            if (!ok) {
                frameQueue.requeue(next)
            } else {
                serialWorker.execute { shipPendingFrames() }
            }
        }
    }
    
    private fun shipPendingEvents() {
        if (deferredMode) return
        val batch = eventRing.drain(batchSizeLimit)
        if (batch.isEmpty()) return
        
        val payload = serializeBatch(batch)
        val compressed = payload.gzipCompress()
        if (compressed == null) {
            batch.forEach { eventRing.push(it) }
            return
        }
        
        val seq = batchSeq++
        
        SegmentDispatcher.shared.transmitEventBatch(compressed, seq, batch.size) { ok ->
            if (!ok) {
                batch.forEach { eventRing.push(it) }
            }
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
        val orchestrator = ReplayOrchestrator.shared
        
        val meta = JSONObject().apply {
            put("platform", "android")
            put("model", Build.MODEL)
            put("osVersion", Build.VERSION.RELEASE)
            put("vendorId", DeviceRegistrar.shared?.deviceFingerprint ?: "")
            put("time", System.currentTimeMillis() / 1000.0)
            put("networkType", orchestrator?.currentNetworkType ?: "unknown")
            put("isConstrained", orchestrator?.networkIsConstrained ?: false)
            put("isExpensive", orchestrator?.networkIsExpensive ?: false)
            put("appVersion", getAppVersion())
            put("appId", context.packageName)
            put("screenWidth", displayMetrics.widthPixels)
            put("screenHeight", displayMetrics.heightPixels)
            put("screenScale", displayMetrics.density.toInt())
            put("systemName", "Android")
            put("name", Build.DEVICE)
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
            "payload" to "{\"key\":\"$key\",\"value\":\"$value\"}"
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
    
    fun recordJSErrorEvent(name: String, message: String, stack: String?) {
        val event = mutableMapOf<String, Any>(
            "type" to "error",
            "timestamp" to ts(),
            "name" to name,
            "message" to message
        )
        if (stack != null) {
            event["stack"] = stack
        }
        enqueue(event)
    }
    
    fun recordAnrEvent(durationMs: Long, stack: String?) {
        val event = mutableMapOf<String, Any>(
            "type" to "anr",
            "timestamp" to ts(),
            "durationMs" to durationMs,
            "threadState" to "blocked"
        )
        if (stack != null) {
            event["stack"] = stack
        }
        enqueue(event)
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
        if (isInteractive) return
        
        // Start dead tap timer — when it fires, check if any response event
        // occurred after this tap.  If not → dead tap.
        lastTapLabel = label
        lastTapX = x
        lastTapY = y
        lastTapTs = tapTs
        val runnable = Runnable {
            deadTapRunnable = null
            // Only fire dead tap if no response event occurred since this tap
            if (lastResponseTs <= lastTapTs) {
                recordDeadTapEvent(lastTapLabel, lastTapX, lastTapY)
                ReplayOrchestrator.shared?.incrementDeadTapTally()
            }
        }
        deadTapRunnable = runnable
        mainHandler.postDelayed(runnable, deadTapTimeoutMs)
    }
    
    fun recordRageTapEvent(label: String, x: Long, y: Long, count: Int) {
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
        lastResponseTs = ts()   // keyboard input = definitive response
        enqueue(mapOf(
            "type" to "input",
            "timestamp" to ts(),
            "value" to if (redacted) "***" else value,
            "redacted" to redacted,
            "label" to label
        ))
    }
    
    fun recordViewTransition(viewId: String, viewLabel: String, entering: Boolean) {
        lastResponseTs = ts()   // navigation = definitive response
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
    
    private fun cancelDeadTapTimer() {
        deadTapRunnable?.let { mainHandler.removeCallbacks(it) }
        deadTapRunnable = null
    }
    
    private fun enqueue(dict: Map<String, Any>) {
        try {
            val json = JSONObject(dict)
            val data = (json.toString() + "\n").toByteArray(Charsets.UTF_8)
            eventRing.push(EventEntry(data, data.size))
        } catch (_: Exception) { }
    }
    
    private fun ts(): Long = System.currentTimeMillis()
}

private data class EventEntry(
    val data: ByteArray,
    val size: Int
)

private class EventRingBuffer(private val capacity: Int) {
    private val storage = CopyOnWriteArrayList<EventEntry>()
    private val lock = ReentrantLock()
    
    fun push(entry: EventEntry) {
        lock.withLock {
            if (storage.size >= capacity) {
                storage.removeAt(0)
            }
            storage.add(entry)
        }
    }
    
    fun drain(maxBytes: Int): List<EventEntry> {
        lock.withLock {
            val result = mutableListOf<EventEntry>()
            var total = 0
            while (storage.isNotEmpty()) {
                val next = storage.first()
                if (total + next.size > maxBytes) break
                result.add(next)
                total += next.size
                storage.removeAt(0)
            }
            return result
        }
    }
    
    fun size(): Int = storage.size
}

private data class PendingFrameBundle(
    val tag: String,
    val payload: ByteArray,
    val rangeStart: Long,
    val rangeEnd: Long,
    val count: Int
)

private class FrameBundleQueue(private val maxPending: Int) {
    private val queue = mutableListOf<PendingFrameBundle>()
    private val lock = ReentrantLock()
    
    fun enqueue(bundle: PendingFrameBundle) {
        lock.withLock {
            if (queue.size >= maxPending) {
                queue.removeAt(0)
            }
            queue.add(bundle)
        }
    }
    
    fun dequeue(): PendingFrameBundle? {
        lock.withLock {
            if (queue.isEmpty()) return null
            return queue.removeAt(0)
        }
    }
    
    fun requeue(bundle: PendingFrameBundle) {
        lock.withLock {
            queue.add(0, bundle)
        }
    }
    
    fun size(): Int = queue.size
}
