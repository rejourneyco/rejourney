package com.rejourney

import android.app.Activity
import android.os.Handler
import android.os.Looper
import com.rejourney.recording.*
import com.rejourney.utility.gzipCompress
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean

/** No Unity Java classes required: usable with both Activity and GameActivity. */
object RejourneyUnity {
    private val main = Handler(Looper.getMainLooper())
    private val responses = ConcurrentLinkedQueue<String>()
    private var hierarchyPending = false
    private var queuedHierarchy: Triple<String, ByteArray, Long>? = null
    /** Main looper only. A snapshot arriving mid-upload is kept (newest wins), never dropped. */
    private fun transmitHierarchy(session: String, payload: ByteArray, timestamp: Long) {
        if (hierarchyPending) { queuedHierarchy = Triple(session, payload, timestamp); return }
        hierarchyPending = true
        SegmentDispatcher.shared.transmitHierarchy(session, payload, timestamp) {
            main.post {
                hierarchyPending = false
                queuedHierarchy?.let { (queuedSession, queuedPayload, queuedTimestamp) ->
                    queuedHierarchy = null
                    transmitHierarchy(queuedSession, queuedPayload, queuedTimestamp)
                }
            }
        }
    }
    private val frameDispatchPending = AtomicBoolean(false)
    private var controller: RejourneyNativeController? = null
    @JvmStatic fun deliberateUiStall() { main.post { Thread.sleep(7000) } }
    @JvmStatic fun poll(): String? = responses.poll()
    @Synchronized private fun reply(id: Int, value: Map<String, Any?>) {
        if (responses.size >= 256) responses.poll()
        responses.add(JSONObject(value + ("id" to id)).toString())
    }
    private fun afterPendingFrames(completion: () -> Unit) { VisualCapture.shared?.afterPendingFrames(completion) ?: completion() }
    @JvmStatic fun request(activity: Activity, json: String) {
        // Unity's GameActivity player thread has no Java looper.
        main.post {
            val request = try { JSONObject(json) } catch (_: Exception) { return@post }
            val id = request.optInt("id", -1).takeIf { it >= 0 } ?: return@post
            try {
                val native = controller ?: RejourneyNativeController(activity) { name, data -> if (name == "sessionRolledOver") UnityCrashMarker.bind(data["sessionId"] as? String) }.also { controller = it }
                val payload = request.optJSONObject("payload") ?: JSONObject()
                when (request.getString("command")) {
                    "configure" -> {
                        native.configure(payload.asMap())
                        native.setActivity(activity)
                        UnityCrashMarker.prepare(activity)
                        ReplayOrchestrator.shared?.hierarchyCaptureEnabled = false
                        TelemetryPipeline.shared?.setExternalRuntimeMetadata(payload.optJSONObject("runtime")?.asMap() ?: emptyMap())
                        reply(id, mapOf("success" to true))
                    }
                    "start" -> native.start { if (it["success"] == true && StabilityMonitor.shared?.isMonitoring == true) UnityCrashMarker.bind(it["sessionId"] as? String); reply(id, status() + it) }
                    "status" -> reply(id, status())
                    "stop" -> afterPendingFrames { native.stop { result ->
                        UnityCrashMarker.bind(null)
                        val delivery = result + SegmentDispatcher.shared.externalDeliveryStatus()
                        reply(id, if (result["success"] != true || result["uploadSuccess"] != true)
                            delivery + mapOf("success" to false, "delivered" to false, "error" to "session_end_or_upload_failed") else delivery)
                    } }
                    "pause" -> {
                        val keepFatalRecovery = StabilityMonitor.shared?.isMonitoring == true
                        val paused = native.pause()
                        if (paused && keepFatalRecovery) StabilityMonitor.shared?.activate()
                        reply(id, mapOf("success" to paused))
                    }
                    "resume" -> reply(id, mapOf("success" to native.resume()))
                    "flush" -> {
                        afterPendingFrames { TelemetryPipeline.shared?.flushExternal { reply(id, SegmentDispatcher.shared.externalDeliveryStatus()) } ?: reply(id, mapOf("success" to true, "delivered" to true)) }
                    }
                    "identify" -> { val identity = payload.optString("identity"); if (identity.isEmpty()) native.clearUserIdentity() else native.setUserIdentity(identity); reply(id, mapOf("success" to true)) }
                    "metadata" -> { native.setMetadata(mapOf(payload.getString("key") to payload.opt("value"))); reply(id, mapOf("success" to true)) }
                    "screen" -> { native.trackScreen(payload.optString("name")); reply(id, mapOf("success" to true)) }
                    "events" -> {
                        val events = request.optJSONArray("payload") ?: JSONArray()
                        for (i in 0 until minOf(64, events.length())) {
                            val event = events.optJSONObject(i) ?: continue
                            TelemetryPipeline.shared?.recordExternalEvent(event.asMap(), event.optString("sessionId"))
                            if (event.optString("sessionId") == native.currentSessionId() && event.optString("type") == "screen_view") ReplayOrchestrator.shared?.logScreenView(event.optString("screen"))
                        }
                        reply(id, mapOf("success" to true))
                    }
                    "hierarchy" -> {
                        val sid = payload.optString("sessionId")
                        if (sid == native.currentSessionId()) {
                            payload.optJSONObject("snapshot")?.toString()?.gzipCompress()?.let { transmitHierarchy(sid, it, payload.getLong("timestamp")) }
                        }
                        reply(id, mapOf("success" to true))
                    }
                    else -> reply(id, mapOf("success" to false, "error" to "unknown_command"))
                }
            } catch (error: Exception) { reply(id, mapOf("success" to false, "error" to error.javaClass.simpleName)) }
        }
    }
    private fun status(): Map<String, Any?> = mapOf(
        "success" to (controller?.currentSessionId() != null), "sessionId" to controller?.currentSessionId(),
        "telemetryOnly" to (ReplayOrchestrator.shared?.visualCaptureEnabled != true),
        "fps" to (1.0 / (VisualCapture.shared?.snapshotInterval ?: 1.0)).toInt().coerceIn(1, 3),
        "maskTextInputs" to (ReplayOrchestrator.shared?.maskTextInputsByDefault ?: true),
        "maskImagesAndVideos" to (ReplayOrchestrator.shared?.maskImagesAndVideosByDefault ?: false),
        "nativeFramesAccepted" to (VisualCapture.shared?.framesCaptured?.get() ?: 0),
        "nativeFramesSkippedBackpressure" to (VisualCapture.shared?.skippedFramesBacklog?.get() ?: 0)
    )
    // JNI marshals each call's managed bytes into a fresh Java array that nothing
    // else references, so it can be handed to the capture buffer without a copy.
    @JvmStatic fun frame(bytes: ByteArray, session: String, timestamp: Long) {
        if (bytes.size > 4*1024*1024 || !frameDispatchPending.compareAndSet(false, true)) return
        main.post { try { VisualCapture.shared?.accept(bytes, session, timestamp) } finally { frameDispatchPending.set(false) } }
    }
}
private fun JSONObject.asMap(): Map<String, Any> = keys().asSequence().mapNotNull { key ->
    val value = opt(key)
    if (value == null || value === JSONObject.NULL) null else key to value
}.toMap()
