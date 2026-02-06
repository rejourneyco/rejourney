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
import com.rejourney.engine.DiagnosticLog
import org.json.JSONObject
import java.io.File
import java.io.FileWriter
import java.io.RandomAccessFile
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Write-first event buffer for crash-safe event persistence.
 * Events are written to disk on append for crash safety.
 * JSONL format (one JSON object per line).
 * Android implementation aligned with iOS EventBuffer.swift
 */
class EventBuffer private constructor(private val context: Context) {
    
    companion object {
        @Volatile
        private var instance: EventBuffer? = null
        
        fun getInstance(context: Context): EventBuffer {
            return instance ?: synchronized(this) {
                instance ?: EventBuffer(context.applicationContext).also { instance = it }
            }
        }
        
        val shared: EventBuffer?
            get() = instance
        
        // Static methods matching iOS API
        
        /**
         * Returns list of session IDs that have pending data on disk
         */
        @JvmStatic
        fun getPendingSessions(context: Context): List<String> {
            val pendingRoot = File(context.cacheDir, "rj_pending")
            if (!pendingRoot.exists()) return emptyList()
            
            return pendingRoot.listFiles()?.mapNotNull { dir ->
                val eventsFile = File(dir, "events.jsonl")
                if (eventsFile.exists()) dir.name else null
            } ?: emptyList()
        }
        
        /**
         * Read events from a specific session's pending data
         */
        @JvmStatic
        fun readEventsForSession(context: Context, sessionId: String): List<Map<String, Any?>> {
            val eventsFile = File(context.cacheDir, "rj_pending/$sessionId/events.jsonl")
            if (!eventsFile.exists()) return emptyList()
            
            val events = mutableListOf<Map<String, Any?>>()
            
            try {
                eventsFile.forEachLine { line ->
                    if (line.isNotBlank()) {
                        try {
                            val json = JSONObject(line)
                            events.add(json.toMap())
                        } catch (_: Exception) { }
                    }
                }
            } catch (e: Exception) {
                DiagnosticLog.debugStorage("READ", sessionId, false, e.message ?: "")
            }
            
            return events
        }
        
        /**
         * Clear all data for a specific session
         */
        @JvmStatic
        fun clearSession(context: Context, sessionId: String) {
            val sessionDir = File(context.cacheDir, "rj_pending/$sessionId")
            sessionDir.deleteRecursively()
        }
        
        /**
         * Get metadata for a specific session
         */
        @JvmStatic
        fun getSessionMetadata(context: Context, sessionId: String): Map<String, Any?>? {
            val metaFile = File(context.cacheDir, "rj_pending/$sessionId/buffer_meta.json")
            if (!metaFile.exists()) return null
            
            return try {
                val json = JSONObject(metaFile.readText())
                json.toMap()
            } catch (_: Exception) {
                null
            }
        }
    }
    
    private val lock = ReentrantLock()
    private var sessionId: String? = null
    private var eventsFile: File? = null
    private var metaFile: File? = null
    private var fileWriter: FileWriter? = null
    private var eventCount: Int = 0
    private var lastEventTimestamp: Long = 0
    private var pendingRootPath: File? = null
    private var isShutdown = false
    
    val currentEventCount: Int
        get() = lock.withLock { eventCount }
    
    val currentLastEventTimestamp: Long
        get() = lock.withLock { lastEventTimestamp }
    
    // Public API
    
    fun configure(sessionId: String) {
        lock.withLock {
            closeFileWriter()
            
            this.sessionId = sessionId
            isShutdown = false
            
            pendingRootPath = File(context.cacheDir, "rj_pending")
            val sessionDir = File(pendingRootPath, sessionId)
            
            try {
                sessionDir.mkdirs()
            } catch (e: Exception) {
                DiagnosticLog.debugStorage("CONFIGURE", sessionId, false, "Failed to create directory: ${e.message}")
                return
            }
            
            eventsFile = File(sessionDir, "events.jsonl")
            metaFile = File(sessionDir, "buffer_meta.json")
            
            countExistingEvents()
            openFileWriter()
            
            DiagnosticLog.debugStorage("CONFIGURE", sessionId, true, "Ready with $eventCount existing events")
        }
    }
    
    fun appendEvent(event: Map<String, Any?>): Boolean {
        lock.withLock {
            if (isShutdown) {
                DiagnosticLog.debugStorage("APPEND", event["type"]?.toString() ?: "unknown", false, "Buffer is shutdown")
                return false
            }
            
            return writeEventToDisk(event)
        }
    }
    
    fun flush(): Boolean {
        lock.withLock {
            val writer = fileWriter ?: return false
            
            return try {
                writer.flush()
                saveMeta()
                true
            } catch (e: Exception) {
                DiagnosticLog.debugStorage("FLUSH", sessionId ?: "", false, e.message ?: "")
                false
            }
        }
    }
    
    fun shutdown() {
        lock.withLock {
            isShutdown = true
            saveMeta()
            closeFileWriter()
        }
    }
    
    fun readPendingEvents(): List<Map<String, Any?>> {
        lock.withLock {
            val file = eventsFile
            if (file == null || !file.exists()) return emptyList()
            
            val events = mutableListOf<Map<String, Any?>>()
            
            try {
                file.forEachLine { line ->
                    if (line.isNotBlank()) {
                        try {
                            val json = JSONObject(line)
                            events.add(json.toMap())
                        } catch (_: Exception) { }
                    }
                }
            } catch (e: Exception) {
                DiagnosticLog.debugStorage("READ", sessionId ?: "", false, e.message ?: "")
            }
            
            return events
        }
    }
    
    fun clearEvents() {
        lock.withLock {
            closeFileWriter()
            
            eventsFile?.delete()
            metaFile?.delete()
            
            eventCount = 0
            lastEventTimestamp = 0
            
            openFileWriter()
        }
    }
    
    fun clearSession(sessionId: String) {
        val sessionDir = File(context.cacheDir, "rj_pending/$sessionId")
        sessionDir.deleteRecursively()
    }
    
    fun getPendingSessions(): List<String> {
        return Companion.getPendingSessions(context)
    }
    
    fun readEventsForSession(sessionId: String): List<Map<String, Any?>> {
        return Companion.readEventsForSession(context, sessionId)
    }
    
    // Private Implementation
    
    private fun writeEventToDisk(event: Map<String, Any?>): Boolean {
        val writer = fileWriter ?: return false
        
        return try {
            val json = JSONObject(event)
            writer.write(json.toString())
            writer.write("\n")
            writer.flush()
            
            eventCount++
            lastEventTimestamp = System.currentTimeMillis()
            
            // Save meta every 10 events
            if (eventCount % 10 == 0) {
                saveMeta()
            }
            
            true
        } catch (e: Exception) {
            DiagnosticLog.debugStorage("WRITE", event["type"]?.toString() ?: "unknown", false, e.message ?: "")
            false
        }
    }
    
    private fun countExistingEvents() {
        val file = eventsFile
        if (file == null || !file.exists()) {
            eventCount = 0
            return
        }
        
        eventCount = try {
            file.readLines().count { it.isNotBlank() }
        } catch (_: Exception) {
            0
        }
    }
    
    private fun openFileWriter() {
        val file = eventsFile ?: return
        
        try {
            fileWriter = FileWriter(file, true)
        } catch (e: Exception) {
            DiagnosticLog.debugStorage("OPEN", sessionId ?: "", false, e.message ?: "")
        }
    }
    
    private fun closeFileWriter() {
        try {
            fileWriter?.close()
        } catch (_: Exception) { }
        fileWriter = null
    }
    
    private fun saveMeta() {
        val file = metaFile ?: return
        
        try {
            val meta = JSONObject().apply {
                put("sessionId", sessionId)
                put("eventCount", eventCount)
                put("lastEventTimestamp", lastEventTimestamp)
                put("savedAt", System.currentTimeMillis())
            }
            file.writeText(meta.toString())
        } catch (_: Exception) { }
    }
}

// Extension to convert JSONObject to Map
private fun JSONObject.toMap(): Map<String, Any?> {
    val map = mutableMapOf<String, Any?>()
    keys().forEach { key ->
        map[key] = when (val value = get(key)) {
            is JSONObject -> value.toMap()
            JSONObject.NULL -> null
            else -> value
        }
    }
    return map
}
