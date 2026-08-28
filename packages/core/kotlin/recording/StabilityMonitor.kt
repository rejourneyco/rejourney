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

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.util.AtomicFile
import com.rejourney.engine.DiagnosticLog
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.abs

/**
 * Incident record for crash reporting
 */
data class IncidentRecord(
    val incidentId: String = UUID.randomUUID().toString(),
    val sessionId: String,
    val timestampMs: Long,
    val category: String,
    val identifier: String,
    val detail: String,
    val frames: List<String>,
    val context: Map<String, String>
) {
    fun toJson(): JSONObject {
        return JSONObject().apply {
            put("incidentId", incidentId)
            put("sessionId", sessionId)
            put("timestampMs", timestampMs)
            put("category", category)
            put("identifier", identifier)
            put("detail", detail)
            // Store a real JSON array. Passing a Kotlin List directly can be
            // serialized as a platform object that optJSONArray cannot recover
            // on the next launch, silently dropping every crash frame.
            put("frames", JSONArray(frames))
            put("context", JSONObject(context))
        }
    }

    companion object {
        fun fromJson(json: JSONObject): IncidentRecord {
            val framesArray = json.optJSONArray("frames")
            val frames = mutableListOf<String>()
            if (framesArray != null) {
                for (i in 0 until framesArray.length()) {
                    frames.add(framesArray.getString(i))
                }
            }

            val contextObj = json.optJSONObject("context")
            val context = mutableMapOf<String, String>()
            if (contextObj != null) {
                contextObj.keys().forEach { key ->
                    context[key] = contextObj.optString(key, "")
                }
            }

            val sessionId = json.optString("sessionId", "unknown")
            val timestampMs = json.optLong("timestampMs", 0)
            val category = json.optString("category", "")
            val identifier = json.optString("identifier", "")
            // Records written before incidents carried an id get a synthetic one.
            // ifBlank rather than an optString default, because a record can carry
            // the key with an empty value and a default only covers a missing key --
            // that path used to yield an incident with no identity at all.
            // Each component is bounded separately so all of them survive: capping
            // the joined string instead would truncate the tail away and collide
            // incidents that share a session, timestamp and category.
            val incidentId = json.optString("incidentId", "").ifBlank {
                "legacy-${sessionId.take(32)}-$timestampMs-${category.take(16)}-${identifier.hashCode()}"
            }

            return IncidentRecord(
                incidentId = incidentId,
                sessionId = sessionId,
                timestampMs = timestampMs,
                category = category,
                identifier = identifier,
                detail = json.optString("detail", ""),
                frames = frames,
                context = context
            )
        }

        fun listFromJson(data: String): List<IncidentRecord> {
            val normalized = data.trim()
            if (normalized.isEmpty()) return emptyList()
            if (!normalized.startsWith("[")) {
                return listOf(fromJson(JSONObject(normalized)))
            }

            val array = JSONArray(normalized)
            return (0 until array.length()).map { index ->
                fromJson(array.getJSONObject(index))
            }
        }

        fun listToJson(incidents: List<IncidentRecord>): String {
            return JSONArray().apply {
                incidents.forEach { put(it.toJson()) }
            }.toString()
        }

        fun mergeStoredIncidents(
            existing: List<IncidentRecord>,
            incoming: IncidentRecord
        ): List<IncidentRecord> {
            val sameSessionException = existing.any {
                it.incidentId != incoming.incidentId &&
                    it.sessionId == incoming.sessionId &&
                    it.category.equals("exception", ignoreCase = true) &&
                    it.frames.isNotEmpty()
            }
            if (incoming.category.equals("signal", ignoreCase = true) && sameSessionException) {
                return existing
            }

            val queued = existing.filterNot {
                it.incidentId == incoming.incidentId ||
                    (
                        incoming.category.equals("exception", ignoreCase = true) &&
                            it.sessionId == incoming.sessionId &&
                            it.category.equals("signal", ignoreCase = true)
                    )
            }.toMutableList()
            queued.add(incoming)
            return queued
        }
    }
}

/**
 * Crash and exception monitoring
 * Android implementation aligned with iOS StabilityMonitor.swift
 */
class StabilityMonitor private constructor(private val context: Context) {

    companion object {
        @Volatile
        private var instance: StabilityMonitor? = null

        fun getInstance(context: Context): StabilityMonitor {
            return instance ?: synchronized(this) {
                instance ?: StabilityMonitor(context.applicationContext).also { instance = it }
            }
        }

        val shared: StabilityMonitor?
            get() = instance
    }

    var isMonitoring = false
        private set
    private val statePreferences = context.getSharedPreferences(
        "com.rejourney.stability",
        Context.MODE_PRIVATE
    )
    private val previousSessionId = statePreferences.getString("last_session_id", null)
    private val previousSessionStartedAtMs = statePreferences.getLong("last_session_started_at_ms", 0L)
    var currentSessionId: String? = null
        set(value) {
            val changed = !value.isNullOrBlank() && value != field
            field = value
            if (changed) {
                statePreferences.edit()
                    .putString("last_session_id", value)
                    .putLong("last_session_started_at_ms", System.currentTimeMillis())
                    .apply()
            }
        }

    private val incidentStore: File = File(context.filesDir, "rejourney/rj_incidents.json").also {
        it.parentFile?.mkdirs()
        val legacy = File(context.cacheDir, "rj_incidents.json")
        if (!it.exists() && legacy.exists()) {
            runCatching { legacy.copyTo(it, overwrite = false) }
                .onSuccess { legacy.delete() }
        }
    }
    private val incidentStoreLock = Any()

    private val workerExecutor = Executors.newSingleThreadExecutor()

    private var chainedExceptionHandler: Thread.UncaughtExceptionHandler? = null
    private var installedExceptionHandler: Thread.UncaughtExceptionHandler? = null
    private var exceptionHandlerChainedExternally = false

    fun activate() {
        if (isMonitoring) return
        isMonitoring = true

        val currentHandler = Thread.getDefaultUncaughtExceptionHandler()
        if (currentHandler !== installedExceptionHandler && !exceptionHandlerChainedExternally) {
            // Install once above the current owner. If a later crash reporter
            // wraps us, subsequent session activation keeps that ordering so
            // it cannot create a recursive A -> Rejourney -> A chain.
            chainedExceptionHandler = currentHandler
            installedExceptionHandler = Thread.UncaughtExceptionHandler { thread, throwable ->
                if (isMonitoring) captureException(thread, throwable)
                chainedExceptionHandler?.uncaughtException(thread, throwable)
            }
            Thread.setDefaultUncaughtExceptionHandler(installedExceptionHandler)
        }

        // Android 11+ retains system-classified exits across process death. Process
        // these before upload so killed ANRs and native crashes are not limited to
        // what an in-process watchdog or Java exception handler can observe.
        workerExecutor.execute {
            captureHistoricalProcessExits()
            uploadStoredIncidents()
        }
    }

    fun deactivate() {
        if (!isMonitoring) return
        isMonitoring = false

        // Do not overwrite a crash reporter installed after Rejourney.
        if (Thread.getDefaultUncaughtExceptionHandler() === installedExceptionHandler) {
            Thread.setDefaultUncaughtExceptionHandler(chainedExceptionHandler)
            installedExceptionHandler = null
            chainedExceptionHandler = null
            exceptionHandlerChainedExternally = false
        } else if (installedExceptionHandler != null) {
            // The current owner may retain our handler as its predecessor.
            // Keep the predecessor reference alive so its chain still reaches
            // the system/previous crash handler while Rejourney is inactive.
            exceptionHandlerChainedExternally = true
        }
    }

    fun transmitStoredReport() {
        workerExecutor.execute {
            uploadStoredIncidents()
        }
    }

    private fun captureException(thread: Thread, throwable: Throwable) {
        val sw = StringWriter()
        throwable.printStackTrace(PrintWriter(sw))
        val stackTrace = sw.toString()

        val frames = stackTrace.lines()
            .filter { it.trim().startsWith("at ") }
            .map { it.trim() }
            .take(256)

        val incident = IncidentRecord(
            sessionId = currentSessionId ?: "unknown",
            timestampMs = System.currentTimeMillis(),
            category = "exception",
            identifier = throwable.javaClass.name,
            detail = throwable.message ?: "",
            frames = frames,
            context = mapOf(
                "threadName" to thread.name,
                "isMain" to (thread == android.os.Looper.getMainLooper().thread).toString(),
                "priority" to thread.priority.toString()
            )
        )

        ReplayOrchestrator.shared?.incrementFaultTally()
        persistIncident(incident)

        // Flush visual frames to disk for crash safety
        try { VisualCapture.shared?.flushToDiskForCrash() } catch (_: Exception) { }

    }

    private fun captureHistoricalProcessExits() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return

        try {
            val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                ?: return
            val processed = LinkedHashSet(
                statePreferences.getStringSet("processed_exit_keys", emptySet()) ?: emptySet()
            )

            val mainProcessName = context.applicationInfo.processName
            val relevantExits = activityManager
                .getHistoricalProcessExitReasons(context.packageName, 0, 32)
                .filter { exit ->
                    exit.processName == mainProcessName &&
                        (exit.reason == ApplicationExitInfo.REASON_ANR ||
                            exit.reason == ApplicationExitInfo.REASON_CRASH ||
                            exit.reason == ApplicationExitInfo.REASON_CRASH_NATIVE)
                }
                .sortedBy { it.timestamp }
            val attributableExit = relevantExits.lastOrNull { exit ->
                previousSessionId != null &&
                    (previousSessionStartedAtMs <= 0L || exit.timestamp >= previousSessionStartedAtMs)
            }

            relevantExits
                .forEach { exit ->
                    val category = when (exit.reason) {
                        ApplicationExitInfo.REASON_ANR -> "anr"
                        ApplicationExitInfo.REASON_CRASH,
                        ApplicationExitInfo.REASON_CRASH_NATIVE -> "crash"
                        else -> return@forEach
                    }
                    val exitKey = "${exit.timestamp}:${exit.pid}:${exit.reason}:${exit.status}"
                    if (exitKey in processed) return@forEach

                    // ApplicationExitInfo can retain a backlog that predates
                    // SDK installation and can include other app processes.
                    // Only the newest main-process exit after the saved session
                    // start has defensible session ownership.
                    if (exit !== attributableExit) {
                        processed.add(exitKey)
                        return@forEach
                    }

                    val sessionId = previousSessionId ?: return@forEach
                    val alreadyPersisted = synchronized(incidentStoreLock) {
                        readStoredIncidentsLocked().any { stored ->
                            stored.sessionId == sessionId &&
                                abs(stored.timestampMs - exit.timestamp) <= 10_000L &&
                                (stored.category == category ||
                                    stored.category == "exception" ||
                                    stored.category == "signal")
                        }
                    }
                    if (!alreadyPersisted) {
                        val trace = if (exit.reason == ApplicationExitInfo.REASON_ANR) {
                            runCatching {
                                exit.traceInputStream?.bufferedReader()?.use { reader ->
                                    val buffer = CharArray(262_144)
                                    val count = reader.read(buffer)
                                    if (count > 0) String(buffer, 0, count) else ""
                                }
                            }.getOrNull().orEmpty()
                        } else {
                            ""
                        }
                        val identifier = when (exit.reason) {
                            ApplicationExitInfo.REASON_ANR -> "ApplicationExitInfo.REASON_ANR"
                            ApplicationExitInfo.REASON_CRASH_NATIVE -> "ApplicationExitInfo.REASON_CRASH_NATIVE"
                            else -> "ApplicationExitInfo.REASON_CRASH"
                        }
                        persistIncidentSync(
                            IncidentRecord(
                                sessionId = sessionId,
                                timestampMs = exit.timestamp,
                                category = category,
                                identifier = identifier,
                                detail = exit.description ?: identifier,
                                frames = trace.lineSequence()
                                    .map(String::trim)
                                    .filter(String::isNotEmpty)
                                    .take(256)
                                    .toList(),
                                context = mapOf(
                                    "source" to "application_exit_info",
                                    "processName" to exit.processName,
                                    "pid" to exit.pid.toString(),
                                    "importance" to exit.importance.toString(),
                                    "pssKb" to exit.pss.toString(),
                                    "rssKb" to exit.rss.toString(),
                                    "status" to exit.status.toString(),
                                    "reasonCode" to exit.reason.toString()
                                )
                            )
                        )
                    }

                    processed.add(exitKey)
                }

            val bounded = processed.toList().takeLast(128).toSet()
            statePreferences.edit().putStringSet("processed_exit_keys", bounded).apply()
        } catch (error: Exception) {
            DiagnosticLog.fault("Historical exit processing failed: ${error.message}")
        }
    }

    fun persistIncidentSync(incident: IncidentRecord) {
        try {
            synchronized(incidentStoreLock) {
                val queued = IncidentRecord.mergeStoredIncidents(
                    readStoredIncidentsLocked(),
                    incident
                )
                writeStoredIncidentsLocked(queued)
            }
        } catch (e: Exception) {
            DiagnosticLog.fault("Incident persist failed: ${e.message}")
        }
    }

    private fun persistIncident(incident: IncidentRecord) {
        persistIncidentSync(incident)
    }

    private fun readStoredIncidentsLocked(): List<IncidentRecord> {
        val atomicStore = AtomicFile(incidentStore)
        if (!incidentStore.exists() && !File("${incidentStore.path}.bak").exists()) {
            return emptyList()
        }
        val data = atomicStore.openRead().bufferedReader().use { it.readText() }
        return IncidentRecord.listFromJson(data)
    }

    private fun writeStoredIncidentsLocked(incidents: List<IncidentRecord>) {
        if (incidents.isEmpty()) {
            AtomicFile(incidentStore).delete()
            return
        }

        val atomicStore = AtomicFile(incidentStore)
        val output = atomicStore.startWrite()
        try {
            output.write(IncidentRecord.listToJson(incidents).toByteArray())
            atomicStore.finishWrite(output)
        } catch (error: Exception) {
            atomicStore.failWrite(output)
            throw error
        }
    }

    private fun uploadStoredIncidents() {
        try {
            while (true) {
                val incident = synchronized(incidentStoreLock) {
                    readStoredIncidentsLocked().firstOrNull()
                } ?: return

                var uploaded = false
                transmitIncident(incident) { ok -> uploaded = ok }
                if (!uploaded) return

                synchronized(incidentStoreLock) {
                    val remaining = readStoredIncidentsLocked()
                        .filterNot { it.incidentId == incident.incidentId }
                    writeStoredIncidentsLocked(remaining)
                }
            }
        } catch (e: Exception) {
            DiagnosticLog.fault("Failed to read stored incident: ${e.message}")
        }
    }

    private fun transmitIncident(incident: IncidentRecord, completion: (Boolean) -> Unit) {
        val base = SegmentDispatcher.shared.endpoint
        val url = "$base/api/ingest/fault"

        try {
            val connection = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            connection.requestMethod = "POST"
            connection.connectTimeout = 5_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Content-Type", "application/json")

            SegmentDispatcher.shared.apiToken?.let {
                connection.setRequestProperty("x-rejourney-key", it)
            }

            connection.doOutput = true
            connection.outputStream.write(incident.toJson().toString().toByteArray())

            val responseCode = connection.responseCode
            completion(responseCode in 200..299)

            connection.disconnect()
        } catch (e: Exception) {
            DiagnosticLog.fault("Failed to transmit incident: ${e.message}")
            completion(false)
        }
    }
}
