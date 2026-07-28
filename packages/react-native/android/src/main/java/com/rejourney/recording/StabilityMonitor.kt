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
import android.util.AtomicFile
import com.rejourney.engine.DiagnosticLog
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.util.concurrent.Executors
import kotlin.concurrent.thread

/**
 * Incident record for crash reporting
 */
data class IncidentRecord(
    val incidentId: String = java.util.UUID.randomUUID().toString(),
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
            val fallbackIncidentId =
                "legacy-$sessionId-$timestampMs-$category-$identifier".take(128)

            return IncidentRecord(
                incidentId = json.optString("incidentId", fallbackIncidentId),
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
    var currentSessionId: String? = null
    
    private val incidentStore: File by lazy {
        File(context.cacheDir, "rj_incidents.json")
    }
    private val incidentStoreLock = Any()
    
    private val workerExecutor = Executors.newSingleThreadExecutor()
    
    private var chainedExceptionHandler: Thread.UncaughtExceptionHandler? = null
    
    fun activate() {
        if (isMonitoring) return
        isMonitoring = true
        
        // Chain existing handler
        chainedExceptionHandler = Thread.getDefaultUncaughtExceptionHandler()
        
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            captureException(thread, throwable)
            
            // Call chained handler
            chainedExceptionHandler?.uncaughtException(thread, throwable)
        }
        
        // Upload any stored incidents
        workerExecutor.execute {
            uploadStoredIncidents()
        }
    }
    
    fun deactivate() {
        if (!isMonitoring) return
        isMonitoring = false
        
        // Restore original handler
        Thread.setDefaultUncaughtExceptionHandler(chainedExceptionHandler)
        chainedExceptionHandler = null
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
        try { VisualCapture.shared?.flushToDisk() } catch (_: Exception) { }
        
        // Give time to write
        Thread.sleep(150)
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
