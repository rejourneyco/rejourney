package com.rejourney

import android.content.Context
import android.os.Build
import android.util.AtomicFile
import com.rejourney.recording.IncidentRecord
import com.rejourney.recording.SegmentDispatcher
import com.rejourney.recording.StabilityMonitor
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Older Android versions have no ApplicationExitInfo; retain only facts available from a signal-safe marker. */
object UnityCrashMarker {
    init { System.loadLibrary("rejourney_unity_signal") }
    @JvmStatic private external fun install(path: String): Boolean
    @JvmStatic private external fun uninstall()
    @JvmStatic external fun deliberateCrash()
    private var root: File? = null
    fun prepare(context: Context) {
        root = File(context.filesDir, "rejourney-unity-fault").also { it.mkdirs() }
        val marker = File(root, "signal.bin")
        val route = File(root, "route.json")
        try {
            if (marker.length() == 16L && route.isFile) {
                val bytes = ByteBuffer.wrap(marker.readBytes()).order(ByteOrder.LITTLE_ENDIAN)
                if (bytes.int == 0x31554a52) {
                    val signal = bytes.int; val timestamp = bytes.long; val info = JSONObject(route.readText())
                    val session = info.getString("sessionId")
                    StabilityMonitor.shared?.persistIncidentSync(IncidentRecord(
                        incidentId = "unity-signal-$session-$timestamp", sessionId = session, timestampMs = timestamp,
                        category = "signal", identifier = "Signal $signal", detail = "Native fatal signal; no stack captured",
                        frames = emptyList(), context = mapOf("source" to "unity_signal_marker", "stackAvailable" to "false", "androidApi" to Build.VERSION.SDK_INT.toString()),
                        routeEndpoint = info.getString("endpoint"), routeProjectId = info.optString("projectId").takeIf { it.isNotEmpty() }
                    ))
                    marker.delete(); route.delete()
                    StabilityMonitor.shared?.transmitStoredReport()
                }
            }
        } catch (_: Exception) { /* Keep original files so a later launch can retry recovery. */ }
    }
    fun bind(session: String?) {
        // Modern Android owns native fatal recovery through ApplicationExitInfo.
        // Installing both paths can upload the marker before exit-history
        // deduplication sees it, producing two reports of the same crash.
        if (Build.VERSION.SDK_INT >= 30) return
        val directory = root ?: return
        if (session.isNullOrEmpty()) { uninstall(); File(directory, "route.json").delete(); return }
        val route = AtomicFile(File(directory, "route.json")); var stream: java.io.FileOutputStream? = null
        try {
            stream = route.startWrite()
            stream.write(JSONObject(mapOf("sessionId" to session, "endpoint" to SegmentDispatcher.shared.endpoint, "projectId" to SegmentDispatcher.shared.projectId)).toString().toByteArray())
            route.finishWrite(stream)
            install(File(directory, "signal.bin").absolutePath)
        } catch (_: Exception) { route.failWrite(stream) }
    }
}
