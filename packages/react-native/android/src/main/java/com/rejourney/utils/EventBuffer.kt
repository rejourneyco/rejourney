package com.rejourney.utils

import android.content.Context
import com.rejourney.core.Logger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.FileReader
import java.io.OutputStreamWriter

/**
 * Write-first event buffer for crash-safe event persistence.
 *
 * Android implementation aligned with iOS RJEventBuffer:
 * - Events are written to disk on append (Non-blocking Suspend).
 * - JSONL format (one JSON object per line).
 * - Thread-safe via Mutex & Dispatchers.IO.
 */
class EventBuffer(
    private val context: Context,
    private val sessionId: String,
    private val pendingRootPath: File
) {
    private val mutex = Mutex()
    private val eventsFile: File
    private val metaFile: File
    private var fileWriter: OutputStreamWriter? = null

    var eventCount: Int = 0
        private set

    var lastEventTimestamp: Long = 0
        private set

    private var uploadedEventCount: Int = 0
    private var isShutdown = false

    init {
        val sessionDir = File(pendingRootPath, sessionId).apply { mkdirs() }
        eventsFile = File(sessionDir, "events.jsonl")
        metaFile = File(sessionDir, "buffer_meta.json")

        if (!eventsFile.exists()) {
            eventsFile.createNewFile()
        }
    }

    /**
     * Initialize the buffer asynchronously using Dispatchers.IO.
     * Must be called before use if precise event counts are needed immediately,
     * but other methods will lazily init if needed.
     */
    suspend fun init() = withContext(Dispatchers.IO) {
        mutex.withLock {
            countExistingEvents()
            openFileWriter()
            Logger.debug("Event buffer ready: ${eventsFile.absolutePath} ($eventCount existing events)")
        }
    }

    private fun countExistingEvents() {
        try {
            if (!eventsFile.exists()) {
                eventCount = 0
                return
            }

            var count = 0
            var lastTs = 0L

            BufferedReader(FileReader(eventsFile)).use { reader ->
                reader.lineSequence().forEach { line ->
                    if (line.isNotBlank()) {
                        try {
                            val event = JSONObject(line)
                            count++
                            val ts = event.optLong("timestamp", 0)
                            if (ts > lastTs) {
                                lastTs = ts
                            }
                        } catch (_: Exception) {
                        }
                    }
                }
            }

            eventCount = count
            lastEventTimestamp = lastTs

            if (metaFile.exists()) {
                try {
                    val meta = JSONObject(metaFile.readText())
                    uploadedEventCount = meta.optInt("uploadedEventCount", 0)
                } catch (_: Exception) {
                }
            }
        } catch (e: Exception) {
            Logger.warning("Failed to count existing events: ${e.message}")
            eventCount = 0
        }
    }

    private fun openFileWriter() {
        try {
            fileWriter = OutputStreamWriter(
                FileOutputStream(eventsFile, true),
                Charsets.UTF_8
            )
        } catch (e: Exception) {
            Logger.error("Failed to open events file for writing", e)
        }
    }

    suspend fun appendEvent(event: Map<String, Any?>): Boolean = withContext(Dispatchers.IO) {
        if (isShutdown) {
            Logger.warning("[EventBuffer] appendEvent: Buffer is shutdown, rejecting event type=${event["type"]}")
            return@withContext false
        }

        mutex.withLock {
            if (fileWriter == null) openFileWriter()
            writeEventToDisk(event)
        }
    }

    suspend fun appendEvents(events: List<Map<String, Any?>>): Boolean = withContext(Dispatchers.IO) {
        if (events.isEmpty()) return@withContext true
        if (isShutdown) return@withContext false

        mutex.withLock {
            if (fileWriter == null) openFileWriter()
            var allSuccess = true
            events.forEach { event ->
                if (!writeEventToDisk(event)) {
                    allSuccess = false
                }
            }
            allSuccess
        }
    }

    private fun writeEventToDisk(event: Map<String, Any?>): Boolean {
        val writer = fileWriter ?: return false

        return try {
            val jsonObject = JSONObject()
            event.forEach { (key, value) ->
                when (value) {
                    is Map<*, *> -> {
                        val nested = JSONObject()
                        value.forEach { (nestedKey, nestedValue) ->
                            if (nestedKey is String) {
                                nested.put(nestedKey, nestedValue)
                            }
                        }
                        jsonObject.put(key, nested)
                    }
                    is List<*> -> jsonObject.put(key, org.json.JSONArray(value))
                    else -> jsonObject.put(key, value)
                }
            }

            val line = jsonObject.toString() + "\n"
            writer.write(line)
            writer.flush()

            eventCount++
            val ts = event["timestamp"] as? Long ?: (event["timestamp"] as? Number)?.toLong()
            if (ts != null) {
                lastEventTimestamp = ts
            }

            true
        } catch (e: Exception) {
            Logger.warning("Failed to write event: ${e.message}")
            false
        }
    }

    suspend fun flush(): Boolean = withContext(Dispatchers.IO) {
        mutex.withLock {
            try {
                fileWriter?.flush()
                true
            } catch (e: Exception) {
                Logger.error("[EventBuffer] flush: Failed to flush events", e)
                false
            }
        }
    }

    suspend fun readAllEvents(): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
        mutex.withLock {
            try {
                if (fileWriter == null) openFileWriter() // Ensure file handling is consistent
                fileWriter?.flush() // Ensure everything is written before reading

                if (!eventsFile.exists()) {
                    return@withLock emptyList()
                }

                val events = mutableListOf<Map<String, Any?>>()
                BufferedReader(FileReader(eventsFile)).use { reader ->
                    reader.lineSequence().forEach { line ->
                        if (line.isNotBlank()) {
                            try {
                                val json = JSONObject(line)
                                val map = mutableMapOf<String, Any?>()
                                json.keys().forEach { key ->
                                    map[key] = json.opt(key)
                                }
                                events.add(map)
                            } catch (_: Exception) {
                            }
                        }
                    }
                }

                events
            } catch (e: Exception) {
                Logger.error("[EventBuffer] readAllEvents: Failed to read events", e)
                emptyList()
            }
        }
    }

    suspend fun readEventsAfterBatchNumber(afterBatchNumber: Int): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
        mutex.withLock {
            try {
                if (fileWriter == null) openFileWriter()
                fileWriter?.flush()

                if (!eventsFile.exists()) {
                    return@withLock emptyList()
                }

                val events = mutableListOf<Map<String, Any?>>()
                val targetIndex = maxOf(uploadedEventCount, maxOf(0, afterBatchNumber))
                var currentIndex = 0

                BufferedReader(FileReader(eventsFile)).use { reader ->
                    reader.forEachLine { line ->
                        if (line.isNotBlank()) {
                            if (currentIndex >= targetIndex) {
                                try {
                                    val json = JSONObject(line)
                                    val map = mutableMapOf<String, Any?>()
                                    json.keys().forEach { key ->
                                        map[key] = json.opt(key)
                                    }
                                    events.add(map)
                                } catch (_: Exception) {
                                }
                            }
                            currentIndex++
                        }
                    }
                }
                events
            } catch (e: Exception) {
                Logger.error("[EventBuffer] readEventsAfterBatchNumber: Failed to read events", e)
                emptyList()
            }
        }
    }

    suspend fun readPendingEvents(): List<Map<String, Any?>> {
        val allEvents = readAllEvents()
        if (uploadedEventCount >= allEvents.size) {
            return emptyList()
        }
        return allEvents.subList(uploadedEventCount, allEvents.size)
    }

    suspend fun markEventsUploadedUpToIndex(eventIndex: Int) = withContext(Dispatchers.IO) {
        mutex.withLock {
            uploadedEventCount = eventIndex

            try {
                val meta = JSONObject().apply {
                    put("uploadedEventCount", uploadedEventCount)
                    put("lastEventTimestamp", lastEventTimestamp)
                }
                metaFile.writeText(meta.toString())
            } catch (e: Exception) {
                Logger.warning("Failed to save buffer meta: ${e.message}")
            }
        }
    }

    suspend fun clearAllEvents() = withContext(Dispatchers.IO) {
        mutex.withLock {
            closeFileWriter()
            eventsFile.delete()
            metaFile.delete()
            eventCount = 0
            uploadedEventCount = 0
            lastEventTimestamp = 0
        }
    }

    suspend fun close() = withContext(Dispatchers.IO) {
        mutex.withLock {
            isShutdown = true
            closeFileWriter()
        }
    }

    private fun closeFileWriter() {
        try {
            fileWriter?.close()
        } catch (_: Exception) {
        } finally {
            fileWriter = null
        }
    }

    fun getLastEventTimestampMs(): Long = lastEventTimestamp
}
