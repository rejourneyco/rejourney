/**
 * Upload management for events and video segment coordination.
 * Uses presigned S3 URLs for production-ready uploads (matching iOS).
 * 
 * Video segments are uploaded via SegmentUploader.
 * Events are uploaded directly here via presigned URL flow.
 * 
 * Flow:
 * 1. Request presigned URL from /api/ingest/presign
 * 2. Gzip payload and upload directly to S3
 * 3. Notify backend via /api/ingest/batch/complete
 * 4. On session end: /api/ingest/session/end
 */
package com.rejourney.network

import android.content.Context
import android.os.Build
import com.rejourney.core.Constants
import com.rejourney.core.Logger
import com.rejourney.utils.Telemetry
import com.rejourney.utils.TelemetryEventType
import com.rejourney.utils.WindowUtils
import com.rejourney.capture.SegmentUploader
import kotlinx.coroutines.*

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.zip.GZIPOutputStream

class UploadManager(
    private val context: Context,
    var apiUrl: String
) {
    var publicKey: String = ""
    var deviceHash: String = ""
    
    var sessionId: String? = null
    private var activeSessionId: String? = null
    
    var userId: String = ""
    var sessionStartTime: Long = 0
    var projectId: String? = null
    
    var totalBackgroundTimeMs: Long = 0
    
    var billingBlocked: Boolean = false
    
    private var batchNumber = AtomicInteger(0)

    private var segmentUploader: SegmentUploader? = null

    private var consecutiveFailures = AtomicInteger(0)
    private var circuitOpen = false
    private var circuitOpenTime: Long = 0
    private val circuitBreakerThreshold = 5
    private val circuitResetTimeMs = 60_000L

    private val maxRetries = 3
    private val initialRetryDelayMs = 1000L

    private val client = HttpClientProvider.shared

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())



    private val pendingRootDir: File by lazy {
        File(context.filesDir, "rejourney/pending_uploads").apply { mkdirs() }
    }

    /**
     * Reset state for new session. Should be called when sessionId changes.
     */
    fun resetForNewSession() {
        batchNumber.set(0)
        totalBackgroundTimeMs = 0
        billingBlocked = false
        segmentUploader = null
    }
    
    /**
     * Set the active session ID. This is the REAL current session ID.
     * Call this instead of setting sessionId directly when starting a new session.
     * The activeSessionId is protected from recovery operations.
     */
    fun setActiveSessionId(newSessionId: String) {
        activeSessionId = newSessionId
        sessionId = newSessionId
        Logger.debug("[UploadManager] sessionId SET to: $newSessionId (activeSessionId=$activeSessionId)")
    }
    
    /**
     * Get the current active session ID.
     * This is protected from recovery operations and always returns the real current session.
     */
    fun getCurrentSessionId(): String? = activeSessionId

    /**
     * Mark a session as active for crash recovery (written to disk).
     * If the process dies before session end, recovery can close it next launch.
     */
    fun markSessionActive(sessionId: String, sessionStartTime: Long) {
        Logger.debug("[UploadManager] markSessionActive: START (sessionId=$sessionId, sessionStartTime=$sessionStartTime, totalBackgroundTimeMs=$totalBackgroundTimeMs)")
        try {
            val dir = File(pendingRootDir, sessionId).apply { mkdirs() }
            val metaFile = File(dir, "session.json")
            val meta = JSONObject().apply {
                put("sessionId", sessionId)
                put("sessionStartTime", sessionStartTime)
                put("totalBackgroundTimeMs", totalBackgroundTimeMs)
                put("updatedAt", System.currentTimeMillis())
            }
            metaFile.writeText(meta.toString())
            Logger.debug("[UploadManager] markSessionActive: ✅ Session metadata written to ${metaFile.absolutePath}")
            Logger.debug("[UploadManager] markSessionActive: Metadata: sessionId=$sessionId, startTime=$sessionStartTime, bgTime=$totalBackgroundTimeMs")
        } catch (e: Exception) {
            Logger.error("[UploadManager] markSessionActive: ❌ Failed to mark session active: ${e.message}", e)
        }
    }

    fun updateSessionRecoveryMeta(sessionId: String) {
        Logger.debug("[UploadManager] updateSessionRecoveryMeta: START (sessionId=$sessionId, totalBackgroundTimeMs=$totalBackgroundTimeMs)")
        try {
            val dir = File(pendingRootDir, sessionId)
            val metaFile = File(dir, "session.json")
            if (!metaFile.exists()) {
                Logger.warning("[UploadManager] updateSessionRecoveryMeta: ⚠️ Session metadata file does not exist: ${metaFile.absolutePath}")
                return
            }
            
            val meta = JSONObject(metaFile.readText())
            val oldBgTime = meta.optLong("totalBackgroundTimeMs", 0)
            meta.put("totalBackgroundTimeMs", totalBackgroundTimeMs)
            meta.put("updatedAt", System.currentTimeMillis())
            metaFile.writeText(meta.toString())
            Logger.debug("[UploadManager] updateSessionRecoveryMeta: ✅ Updated session metadata (bgTime: $oldBgTime -> $totalBackgroundTimeMs)")
        } catch (e: Exception) {
            Logger.error("[UploadManager] updateSessionRecoveryMeta: ❌ Failed to update session recovery meta: ${e.message}", e)
        }
    }

    fun clearSessionRecovery(sessionId: String) {
        try {
            val dir = File(pendingRootDir, sessionId)
            if (dir.exists()) {
                dir.deleteRecursively()
            }
        } catch (e: Exception) {
            Logger.warning("Failed to clear session recovery: ${e.message}")
        }
    }

    /**
     * @deprecated Recovery is now handled by WorkManager.UploadWorker.scheduleRecoveryUpload()
     * which runs independently without blocking the current session's uploads.
     * This function held the uploadMutex for the entire recovery duration, blocking all
     * current session uploads and causing timeouts.
     * 
     * DO NOT CALL THIS FUNCTION. It remains only for reference.
     */
    @Deprecated("Use UploadWorker.scheduleRecoveryUpload() instead - this blocks all uploads")
    suspend fun recoverPendingSessions(): Boolean {
        Logger.warning("[UploadManager] recoverPendingSessions is DEPRECATED - use WorkManager recovery instead")
        return true
    }

    /**
     * Upload a batch of events using presigned S3 URLs.
     * Video segments are uploaded separately via uploadVideoSegment().
     * 
     * NOTE: Mutex removed as part of the nuclear rewrite. Recovery is now handled
     * by WorkManager independently, so there's no mutex contention.
     */
    suspend fun uploadBatch(
        events: List<Map<String, Any?>>,
        isFinal: Boolean = false
    ): Boolean {
        val effectiveSessionId = activeSessionId ?: sessionId
        Logger.debug("[UploadManager] uploadBatch: START (eventCount=${events.size}, isFinal=$isFinal, effectiveSessionId=$effectiveSessionId)")
        
        if (billingBlocked) {
            Logger.warning("[UploadManager] uploadBatch: Upload skipped - billing blocked")
            return false
        }
        
        if (events.isEmpty() && !isFinal) {
            Logger.debug("[UploadManager] uploadBatch: No events and not final, returning success")
            return true
        }

        val startTime = System.currentTimeMillis()
        val currentBatch = batchNumber.getAndIncrement()
        var success = true
        var persistedOk = true
        val canUploadNow = canUpload()
        
        Logger.debug("[UploadManager] uploadBatch: batchNumber=$currentBatch, canUploadNow=$canUploadNow, effectiveSessionId=$effectiveSessionId")

        if (canUploadNow) {
            effectiveSessionId?.takeIf { it.isNotBlank() }?.let { sid ->
                val ok = flushPendingForSession(sid)
                if (!ok) {
                    success = false
                }
            }
        }

        try {
            if (events.isNotEmpty() || isFinal) {
                Logger.debug("[UploadManager] uploadBatch: Building payload (eventCount=${events.size}, isFinal=$isFinal)")
                val payload = buildEventsPayload(events, currentBatch, isFinal)
                Logger.debug("[UploadManager] uploadBatch: Payload built, size=${payload.size} bytes")

                if (canUploadNow) {
                    Logger.debug("[UploadManager] uploadBatch: Uploading events batch $currentBatch online")
                    val eventsSuccess = uploadContent(
                        contentType = "events",
                        batchNumber = currentBatch,
                        content = payload,
                        eventCount = events.size,
                        frameCount = 0
                    )
                    if (!eventsSuccess) {
                        Logger.error("[UploadManager] uploadBatch: ❌ Events upload failed for batch $currentBatch")
                        success = false
                    } else {
                        Logger.debug("[UploadManager] uploadBatch: ✅ Events uploaded successfully for batch $currentBatch")
                    }
                } else {
                    Logger.debug("[UploadManager] uploadBatch: Offline/circuit-open, persisting batch $currentBatch to disk")
                    val ok = persistOnly(
                        contentType = "events",
                        batchNumber = currentBatch,
                        content = payload,
                        eventCount = events.size,
                        frameCount = 0,
                        isKeyframe = false
                    )
                    if (!ok) {
                        Logger.error("[UploadManager] uploadBatch: ❌ Failed to persist batch $currentBatch")
                        persistedOk = false
                        success = false
                    } else {
                        Logger.debug("[UploadManager] uploadBatch: ✅ Queued events batch $currentBatch (offline/circuit-open)")
                    }
                }
            } else {
                Logger.debug("[UploadManager] uploadBatch: No events to upload and not final, skipping")
            }

            val duration = System.currentTimeMillis() - startTime
            if (success) {
                Logger.debug("[UploadManager] uploadBatch: ✅ Upload success in ${duration}ms (batch=$currentBatch)")
                onUploadSuccess(duration)
            } else {
                Logger.error("[UploadManager] uploadBatch: ❌ Upload failed after ${duration}ms (batch=$currentBatch)")
                onUploadFailure()
            }
        } catch (e: CancellationException) {
            Logger.debug("[UploadManager] uploadBatch: Batch upload cancelled - WorkManager will handle upload")
            throw e
        } catch (e: Exception) {
            Logger.error("[UploadManager] uploadBatch: ❌ Exception during batch upload: ${e.message}", e)
            onUploadFailure()
            success = false
        }

        val result = if (canUploadNow) {
            success
        } else {
            persistedOk
        }
        
        Logger.debug("[UploadManager] uploadBatch: END (result=$result, batch=$currentBatch)")
        return result
    }

    /**
     * Upload a video segment file.
     * This delegates to SegmentUploader for presigned URL flow.
     */
    suspend fun uploadVideoSegment(
        segmentFile: File,
        startTime: Long,
        endTime: Long,
        frameCount: Int
    ): Boolean {
        val sid = extractSessionIdFromFilename(segmentFile.name) ?: sessionId ?: return false
        
        Logger.debug("[UploadManager] uploadVideoSegment START (file=${segmentFile.name}, frames=$frameCount)")
        Logger.debug("[UploadManager] sessionId from filename=$sid, this.sessionId=$sessionId")
        
        val authManager = DeviceAuthManager.getInstance(context)
        val tokenValid = authManager.ensureValidToken()
        if (!tokenValid) {
            Logger.warning("[UploadManager] No valid token for video segment upload - upload may fail")
        }
        
        val uploader = getOrCreateSegmentUploader()
        uploader.uploadToken = authManager.getCurrentUploadToken()
        
        val result = uploader.uploadVideoSegment(
            segmentFile = segmentFile,
            sessionId = sid,
            startTime = startTime,
            endTime = endTime,
            frameCount = frameCount
        )
        
        if (result.success) {
            Logger.debug("[UploadManager] Video segment uploaded: ${segmentFile.name}")
        } else {
            Logger.warning("[UploadManager] Video segment upload failed: ${result.error}")
        }
        
        return result.success
    }

    /**
     * Extract session ID from segment filename.
     * Filename format: seg_<sessionId>_<timestamp>.mp4
     * Example: seg_session_1768582930679_9510E45F_1768582931692.mp4
     * Returns: session_1768582930679_9510E45F
     */
    private fun extractSessionIdFromFilename(filename: String): String? {
        if (!filename.startsWith("seg_") || !filename.endsWith(".mp4")) {
            return null
        }
        
        val withoutPrefix = filename.removePrefix("seg_").removeSuffix(".mp4")
        
        val lastUnderscore = withoutPrefix.lastIndexOf('_')
        if (lastUnderscore <= 0) {
            return null
        }
        
        return withoutPrefix.substring(0, lastUnderscore)
    }

    /**
     * Upload a view hierarchy snapshot.
     * 
     * @param sessionId The session ID to upload under. Must be provided explicitly
     *                  to avoid stale session ID issues where this.sessionId may
     *                  still reference a previous session.
     */
    suspend     fun uploadHierarchy(
        hierarchyData: ByteArray,
        timestamp: Long,
        sessionId: String
    ): Boolean {
        Logger.debug("[UploadManager] ===== UPLOAD HIERARCHY START =====")
        Logger.debug("[UploadManager] uploadHierarchy: size=${hierarchyData.size} bytes, timestamp=$timestamp, sessionId=$sessionId")
        Logger.debug("[UploadManager] uploadHierarchy: this.sessionId=$sessionId, activeSessionId=$activeSessionId")
        
        val authManager = DeviceAuthManager.getInstance(context)
        Logger.debug("[UploadManager] uploadHierarchy: Ensuring valid auth token...")
        val tokenValid = authManager.ensureValidToken()
        if (!tokenValid) {
            Logger.error("[UploadManager] uploadHierarchy: ❌ No valid token for hierarchy upload - upload may fail!")
        } else {
            Logger.debug("[UploadManager] uploadHierarchy: ✅ Auth token is valid")
        }
        
        val uploader = getOrCreateSegmentUploader()
        uploader.uploadToken = authManager.getCurrentUploadToken()
        Logger.debug("[UploadManager] uploadHierarchy: SegmentUploader ready, apiKey=${uploader.apiKey?.take(8)}..., projectId=${uploader.projectId}")
        
        Logger.debug("[UploadManager] uploadHierarchy: Calling SegmentUploader.uploadHierarchy...")
        val uploadStartTime = System.currentTimeMillis()
        val result = uploader.uploadHierarchy(
            hierarchyData = hierarchyData,
            sessionId = sessionId,
            timestamp = timestamp
        )
        val uploadDuration = System.currentTimeMillis() - uploadStartTime
        
        if (result.success) {
            Logger.debug("[UploadManager] ✅ Hierarchy uploaded successfully in ${uploadDuration}ms: sessionId=$sessionId")
        } else {
            Logger.error("[UploadManager] ❌ Hierarchy upload FAILED after ${uploadDuration}ms: ${result.error}, sessionId=$sessionId")
        }
        
        Logger.debug("[UploadManager] ===== UPLOAD HIERARCHY END =====")
        return result.success
    }

    private fun getOrCreateSegmentUploader(): SegmentUploader {
        return segmentUploader ?: SegmentUploader(apiUrl).also {
            it.apiKey = publicKey
            it.projectId = projectId
            it.uploadToken = DeviceAuthManager.getInstance(context).getCurrentUploadToken()
            segmentUploader = it
        }
    }

    /**
     * Persist a payload to disk for crash/offline recovery without attempting any network.
     */
    private fun persistOnly(
        contentType: String,
        batchNumber: Int,
        content: ByteArray,
        eventCount: Int,
        frameCount: Int,
        isKeyframe: Boolean
    ): Boolean {
        val gzipped = gzipData(content) ?: return false
        val sidForPersist = (activeSessionId ?: sessionId ?: "").ifBlank { "unknown" }
        persistPendingUpload(
            sessionId = sidForPersist,
            contentType = contentType,
            batchNumber = batchNumber,
            isKeyframe = isKeyframe,
            gzipped = gzipped,
            eventCount = eventCount,
            frameCount = frameCount
        )
        markSessionActive(sidForPersist, sessionStartTime)
        updateSessionRecoveryMeta(sidForPersist)
        return true
    }

    /**
     * Flush pending .gz payloads for a specific session (including current session)
     * when network is available.
     */
    private suspend fun flushPendingForSession(sessionId: String): Boolean {
        val dir = File(pendingRootDir, sessionId)
        if (!dir.exists() || !dir.isDirectory) return true

        val pendingFiles = dir.listFiles()?.filter { it.isFile && it.name.endsWith(".gz") } ?: emptyList()
        if (pendingFiles.isEmpty()) return true

        var allOk = true
        val sorted = pendingFiles.sortedWith(compareBy({ parseBatchNumberFromName(it.name) }, { it.name }))

        for (file in sorted) {
            val parsed = parsePendingFilename(file.name) ?: continue
            val metaFile = File(dir, file.name + ".meta.json")
            val meta = if (metaFile.exists()) {
                try { JSONObject(metaFile.readText()) } catch (_: Exception) { JSONObject() }
            } else JSONObject()
            val eventCount = meta.optInt("eventCount", 0)
            val frameCount = meta.optInt("frameCount", 0)
            val isKeyframe = meta.optBoolean("isKeyframe", parsed.isKeyframe)

            val gzipped = try { file.readBytes() } catch (e: Exception) {
                Logger.warning("Failed to read pending upload ${file.name}: ${e.message}")
                allOk = false
                continue
            }

            val ok = uploadGzippedContent(
                contentType = parsed.contentType,
                batchNumber = parsed.batchNumber,
                gzipped = gzipped,
                eventCount = eventCount,
                frameCount = frameCount,
                isKeyframe = isKeyframe
            )

            if (ok) {
                try {
                    file.delete()
                    metaFile.delete()
                } catch (_: Exception) {
                }
            } else {
                allOk = false
            }
        }

        return allOk
    }

    /**
     * Upload content using presigned URL flow.
     */
    private suspend fun uploadContent(
        contentType: String,
        batchNumber: Int,
        content: ByteArray,
        eventCount: Int,
        frameCount: Int,
        isKeyframe: Boolean = false
    ): Boolean {
        val gzipped = gzipData(content)
        if (gzipped == null) {
            Logger.error("Failed to gzip $contentType data")
            return false
        }

        val sidForPersist = (activeSessionId ?: sessionId ?: "").ifBlank { "unknown" }
        val pendingFile = persistPendingUpload(
            sessionId = sidForPersist,
            contentType = contentType,
            batchNumber = batchNumber,
            isKeyframe = isKeyframe,
            gzipped = gzipped,
            eventCount = eventCount,
            frameCount = frameCount
        )

        Logger.debug("$contentType batch $batchNumber: ${content.size} bytes -> ${gzipped.size} gzipped")

        val presignResult = presignForContentType(contentType, batchNumber, gzipped.size, isKeyframe)
        if (presignResult == null) {
            Logger.error("Failed to get presigned URL for $contentType")
            return false
        }

        val skipUpload = presignResult.optBoolean("skipUpload", false)
        if (skipUpload) {
            Logger.debug("$contentType upload skipped - recording disabled for project")
            try {
                pendingFile?.delete()
                pendingFile?.let { File(it.parentFile, it.name + ".meta.json").delete() }
            } catch (_: Exception) {}
            return true
        }

        val presignedUrl = presignResult.optString("presignedUrl")
        val batchId = presignResult.optString("batchId")
        

        if (presignedUrl.isEmpty() || batchId.isEmpty()) {
            Logger.error("Invalid presign response: $presignResult")
            return false
        }

        val uploadSuccess = uploadToS3(presignedUrl, gzipped)
        if (!uploadSuccess) {
            Logger.error("Failed to upload $contentType to S3")
            return false
        }

        val completeSuccess = completeBatch(batchId, gzipped.size, eventCount, frameCount)
        if (!completeSuccess) {
            Logger.warning("Failed to complete batch $batchId (data uploaded to S3)")
        } else {
            try {
                pendingFile?.delete()
                pendingFile?.let { File(it.parentFile, it.name + ".meta.json").delete() }
            } catch (_: Exception) {
            }
        }

        return true
    }

    private data class PendingName(
        val contentType: String,
        val batchNumber: Int,
        val isKeyframe: Boolean
    )

    private fun parseBatchNumberFromName(name: String): Int {
        val parsed = parsePendingFilename(name)
        return parsed?.batchNumber ?: Int.MAX_VALUE
    }

    private fun parsePendingFilename(name: String): PendingName? {
        if (!name.endsWith(".gz")) return null
        val base = name.removeSuffix(".gz")
        val parts = base.split("_")
        if (parts.size < 3) return null
        val contentType = parts[0]
        val batchNumber = parts[1].toIntOrNull() ?: return null
        val keyFlag = parts[2]
        val isKeyframe = keyFlag == "k"
        return PendingName(contentType, batchNumber, isKeyframe)
    }

    private fun persistPendingUpload(
        sessionId: String,
        contentType: String,
        batchNumber: Int,
        isKeyframe: Boolean,
        gzipped: ByteArray,
        eventCount: Int,
        frameCount: Int
    ): File? {
        return try {
            val dir = File(pendingRootDir, sessionId).apply { mkdirs() }
            val keyFlag = if (isKeyframe) "k" else "n"
            val file = File(dir, "${contentType}_${batchNumber}_${keyFlag}.gz")
            FileOutputStream(file).use { it.write(gzipped) }

            val meta = JSONObject().apply {
                put("contentType", contentType)
                put("batchNumber", batchNumber)
                put("isKeyframe", isKeyframe)
                put("eventCount", eventCount)
                put("frameCount", frameCount)
                put("createdAt", System.currentTimeMillis())
            }
            File(dir, file.name + ".meta.json").writeText(meta.toString())
            file
        } catch (e: Exception) {
            Logger.warning("Failed to persist pending upload: ${e.message}")
            null
        }
    }

    private suspend fun uploadGzippedContent(
        contentType: String,
        batchNumber: Int,
        gzipped: ByteArray,
        eventCount: Int,
        frameCount: Int,
        isKeyframe: Boolean
    ): Boolean {
        if (!canUpload()) return false

        val presignResult = presignForContentType(contentType, batchNumber, gzipped.size, isKeyframe)
            ?: return false

        val presignedUrl = presignResult.optString("presignedUrl")
        val batchId = presignResult.optString("batchId")
        if (presignedUrl.isEmpty() || batchId.isEmpty()) return false

        val uploadSuccess = uploadToS3(presignedUrl, gzipped)
        if (!uploadSuccess) return false

        return completeBatch(batchId, gzipped.size, eventCount, frameCount)
    }

    /**
     * Request presigned URL from backend.
     */
    private suspend fun presignForContentType(
        contentType: String,
        batchNumber: Int,
        sizeBytes: Int,
        isKeyframe: Boolean
    ): JSONObject? {
        Logger.debug("[UploadManager] presignForContentType START (type=$contentType, batch=$batchNumber, size=$sizeBytes, sessionId=${sessionId?.take(20)}...)")
        
        val effectiveSessionId = activeSessionId ?: sessionId ?: ""
        val body = JSONObject().apply {
            put("batchNumber", batchNumber)
            put("contentType", contentType)
            put("sizeBytes", sizeBytes)
            put("userId", userId.ifEmpty { "anonymous" })
            put("sessionId", effectiveSessionId)
            put("sessionStartTime", sessionStartTime)
            if (contentType == "frames") {
                put("isKeyframe", isKeyframe)
            }
        }

        return try {
            withContext(Dispatchers.IO) {
                val request = buildAuthenticatedRequest("/api/ingest/presign", body.toString())
                Logger.debug("[UploadManager] Sending presign request to: ${request.url}")
                
                val response = client.newCall(request).execute()
                
                response.use {
                    Logger.debug("[UploadManager] Presign response code: ${it.code}")
                    if (it.isSuccessful) {
                        val responseBody = it.body?.string() ?: "{}"
                        val result = JSONObject(responseBody)
                        Logger.debug("[UploadManager] Presign SUCCESS - got batchId: ${result.optString("batchId", "null")}")
                        result
                    } else if (it.code == 402) {
                        Logger.warning("[UploadManager] Presign BLOCKED (402) - billing issue, stopping uploads")
                        billingBlocked = true
                        null
                    } else if (it.code == 401) {
                        val errorBody = it.body?.string() ?: ""
                        Logger.error("[UploadManager] Presign UNAUTHORIZED (401) - token likely invalid. Body: $errorBody")
                        null
                    } else {
                        val errorBody = it.body?.string() ?: ""
                        Logger.warning("[UploadManager] Presign FAILED: ${it.code} - $errorBody")
                        null
                    }
                }
            }
        } catch (e: CancellationException) {
            Logger.debug("[UploadManager] Presign request cancelled (shutdown)")
            null
        } catch (e: Exception) {
            Logger.error("[UploadManager] Presign request EXCEPTION", e)
            null
        }
    }

    /**
     * Upload gzipped data to S3 via presigned URL.
     */
    private suspend fun uploadToS3(presignedUrl: String, data: ByteArray): Boolean {
        Logger.debug("[UploadManager] uploadToS3 START (size=${data.size} bytes)")
        
        return try {
            withContext(Dispatchers.IO) {
                val request = Request.Builder()
                    .url(presignedUrl)
                    .put(data.toRequestBody("application/gzip".toMediaType()))
                    .build()

                val response = client.newCall(request).execute()

                response.use {
                    if (it.isSuccessful) {
                        Logger.debug("[UploadManager] S3 upload SUCCESS (code=${it.code})")
                        true
                    } else {
                        val errorBody = it.body?.string() ?: ""
                        Logger.error("[UploadManager] S3 upload FAILED: ${it.code} - $errorBody")
                        false
                    }
                }
            }
        } catch (e: Exception) {
            Logger.error("[UploadManager] S3 upload EXCEPTION", e)
            false
        }
    }

    /**
     * Notify backend that batch upload is complete.
     */
    private suspend fun completeBatch(
        batchId: String,
        actualSizeBytes: Int,
        eventCount: Int,
        frameCount: Int
    ): Boolean {
        Logger.debug("[UploadManager] completeBatch START (batchId=$batchId, events=$eventCount, frames=$frameCount)")
        
        val body = JSONObject().apply {
            put("batchId", batchId)
            put("actualSizeBytes", actualSizeBytes)
            put("eventCount", eventCount)
            put("frameCount", frameCount)
            put("timestamp", System.currentTimeMillis())
            put("userId", userId.ifEmpty { "anonymous" })
        }

        return try {
            withContext(Dispatchers.IO) {
                val request = buildAuthenticatedRequest("/api/ingest/batch/complete", body.toString())
                val response = client.newCall(request).execute()
                response.use { 
                    if (it.isSuccessful) {
                        Logger.debug("[UploadManager] completeBatch SUCCESS")
                        true
                    } else {
                        val errorBody = it.body?.string() ?: ""
                        Logger.error("[UploadManager] completeBatch FAILED: ${it.code} - $errorBody")
                        false
                    }
                }
            }
        } catch (e: Exception) {
            Logger.error("[UploadManager] completeBatch EXCEPTION", e)
            false
        }
    }

    /**
     * End session - send final metrics to backend.
     * @param endedAtOverride If provided, use this timestamp as endedAt instead of current time.
     *                        Used for crash recovery where we want to use the saved timestamp.
     * 
     * NOTE: Mutex removed as part of the nuclear rewrite. Recovery is now handled
     * by WorkManager independently, so there's no mutex contention.
     */
    suspend fun endSession(
        metrics: Map<String, Any?>? = null,
        endedAtOverride: Long? = null,
        sessionIdOverride: String? = null
    ): Boolean {
        Logger.debug("[UploadManager] ===== END SESSION START =====")
        
        val effectiveSessionId = sessionIdOverride ?: sessionId
        Logger.debug("[UploadManager] endSession: sessionId=$effectiveSessionId, totalBackgroundTimeMs=$totalBackgroundTimeMs")
        
        if (effectiveSessionId.isNullOrEmpty()) {
            Logger.error("[UploadManager] endSession: ❌ Called with empty sessionId")
            return true
        }

        Logger.debug("[UploadManager] endSession: Sending session end for: $effectiveSessionId")

        val endedAt = endedAtOverride ?: System.currentTimeMillis()
        Logger.debug("[UploadManager] endSession: endedAt=$endedAt (override=${endedAtOverride != null})")
        
        val body = JSONObject().apply {
            put("sessionId", effectiveSessionId)
            put("endedAt", endedAt)
            if (totalBackgroundTimeMs > 0) {
                put("totalBackgroundTimeMs", totalBackgroundTimeMs)
                Logger.debug("[UploadManager] endSession: Including totalBackgroundTimeMs=$totalBackgroundTimeMs")
            }
            metrics?.let { m ->
                Logger.debug("[UploadManager] endSession: Including metrics: ${m.keys.joinToString(", ")}")
                put("metrics", JSONObject().apply {
                    m.forEach { (key, value) ->
                        if (value != null) put(key, value)
                    }
                })
            }
        }

        Logger.debug("[UploadManager] endSession: Request body: ${body.toString().take(200)}...")

        return try {
            withContext(Dispatchers.IO) {
                Logger.debug("[UploadManager] endSession: Building authenticated request...")
                val request = buildAuthenticatedRequest("/api/ingest/session/end", body.toString())

                Logger.debug("[UploadManager] endSession: Executing request to /api/ingest/session/end...")
                val requestStartTime = System.currentTimeMillis()
                val response = client.newCall(request).execute()
                val requestDuration = System.currentTimeMillis() - requestStartTime

                response.use {
                    if (it.isSuccessful) {
                        Logger.debug("[UploadManager] ✅ Session end signal sent successfully in ${requestDuration}ms for $effectiveSessionId")
                        true
                    } else {
                        val errorBody = it.body?.string() ?: "no body"
                        Logger.error("[UploadManager] ❌ Session end signal FAILED: code=${it.code}, body=$errorBody")
                        Logger.warning("Session end failed: ${it.code} - $errorBody")
                        false
                    }
                }
            }
        } catch (e: Exception) {
            Logger.error("[UploadManager] endSession: ❌ Exception for $effectiveSessionId: ${e.message}", e)
            false
        } finally {
            Logger.debug("[UploadManager] ===== END SESSION END =====")
        }
    }

    /**
     * Upload a crash report using presigned URL flow.
     */
    suspend fun uploadCrashReport(crashReport: Map<String, Any?>): Boolean {
        if (!canUpload()) return false

        val crashSessionId = crashReport["sessionId"] as? String ?: sessionId ?: ""
        
        val payload = JSONObject().apply {
            put("crashes", JSONArray().apply {
                put(JSONObject().apply {
                    crashReport.forEach { (key, value) ->
                        if (value != null) put(key, value)
                    }
                })
            })
            put("sessionId", crashSessionId)
            put("timestamp", crashReport["timestamp"] ?: System.currentTimeMillis())
        }

        val content = payload.toString().toByteArray(Charsets.UTF_8)
        val gzipped = gzipData(content)
        if (gzipped == null) {
            Logger.error("Failed to gzip crash report")
            return false
        }

        val originalSessionId = sessionId
        sessionId = crashSessionId

        try {
            val presignResult = presignForContentType("crashes", 0, gzipped.size, false)
            if (presignResult == null) {
                Logger.error("Failed to get presigned URL for crash report")
                return false
            }

            val presignedUrl = presignResult.optString("presignedUrl")
            val batchId = presignResult.optString("batchId")

            if (presignedUrl.isEmpty()) {
                Logger.error("Invalid crash presign response")
                return false
            }

            val uploadSuccess = uploadToS3(presignedUrl, gzipped)
            if (!uploadSuccess) {
                Logger.error("Failed to upload crash to S3")
                return false
            }

            completeBatch(batchId, gzipped.size, 0, 0)
            Logger.debug("Crash report uploaded")
            return true
        } finally {
            sessionId = originalSessionId
        }
    }

    /**
     * Upload an ANR report using presigned URL flow.
     */
    suspend fun uploadANRReport(anrReport: Map<String, Any?>): Boolean {
        if (!canUpload()) return false

        val anrSessionId = anrReport["sessionId"] as? String ?: sessionId ?: ""
        
        val payload = JSONObject().apply {
            put("anrs", JSONArray().apply {
                put(JSONObject().apply {
                    anrReport.forEach { (key, value) ->
                        if (value != null) put(key, value)
                    }
                })
            })
            put("sessionId", anrSessionId)
            put("timestamp", anrReport["timestamp"] ?: System.currentTimeMillis())
        }

        val content = payload.toString().toByteArray(Charsets.UTF_8)
        val gzipped = gzipData(content)
        if (gzipped == null) {
            Logger.error("Failed to gzip ANR report")
            return false
        }

        val originalSessionId = sessionId
        sessionId = anrSessionId

        try {
            val presignResult = presignForContentType("anrs", 0, gzipped.size, false)
            if (presignResult == null) {
                Logger.error("Failed to get presigned URL for ANR report")
                return false
            }

            val presignedUrl = presignResult.optString("presignedUrl")
            val batchId = presignResult.optString("batchId")

            if (presignedUrl.isEmpty()) {
                Logger.error("Invalid ANR presign response")
                return false
            }

            val uploadSuccess = uploadToS3(presignedUrl, gzipped)
            if (!uploadSuccess) {
                Logger.error("Failed to upload ANR to S3")
                return false
            }

            completeBatch(batchId, gzipped.size, 0, 0)
            Logger.debug("ANR report uploaded")
            return true
        } finally {
            sessionId = originalSessionId
        }
    }

    /**
     * Fetch project configuration from server.
     */
    fun fetchProjectConfig(callback: (success: Boolean, config: Map<String, Any?>?) -> Unit) {
        if (publicKey.isEmpty()) {
            callback(false, null)
            return
        }

        val request = Request.Builder()
            .url("$apiUrl/api/sdk/config")
            .get()
            .addHeader("x-public-key", publicKey)
            .addHeader("x-bundle-id", context.packageName)
            .addHeader("x-platform", "android")
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Logger.error("Project config fetch failed", e)
                callback(false, null)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (it.isSuccessful) {
                        try {
                            val json = JSONObject(it.body?.string() ?: "{}")
                            projectId = json.optString("projectId")
                            
                            val config = mutableMapOf<String, Any?>()
                            json.keys().forEach { key ->
                                config[key] = json.get(key)
                            }
                            callback(true, config)
                        } catch (e: Exception) {
                            callback(false, null)
                        }
                    } else {
                        callback(false, null)
                    }
                }
            }
        })
    }

    private fun buildEventsPayload(
        events: List<Map<String, Any?>>,
        batchNumber: Int,
        isFinal: Boolean
    ): ByteArray {
        Logger.debug("[UploadManager] buildEventsPayload: START (eventCount=${events.size}, batchNumber=$batchNumber, isFinal=$isFinal, sessionId=$sessionId)")
        
        val currentTime = System.currentTimeMillis()
        
        val effectiveSessionId = activeSessionId ?: sessionId ?: ""
        
        val payload = JSONObject().apply {
            put("sessionId", effectiveSessionId)
            put("userId", userId.ifEmpty { "anonymous" })
            put("batchNumber", batchNumber)
            put("isFinal", isFinal)
            put("sessionStartTime", sessionStartTime)
            put("batchTime", currentTime)
            put("deviceInfo", buildDeviceInfo())
            put("events", JSONArray().apply {
                events.forEach { event ->
                    put(JSONObject().apply {
                        event.forEach { (key, value) ->
                            put(key, toJsonValue(value))
                        }
                    })
                }
            })
            
            if (isFinal) {
                put("endTime", currentTime)
                val duration = currentTime - sessionStartTime
                put("duration", maxOf(0, duration))
                Logger.debug("[UploadManager] buildEventsPayload: Final batch - endTime=$currentTime, duration=${duration}ms")
            }
        }
        
        val payloadBytes = payload.toString().toByteArray(Charsets.UTF_8)
        Logger.debug("[UploadManager] buildEventsPayload: Payload built - size=${payloadBytes.size} bytes, sessionId=${sessionId ?: "null"}, userId=${userId.ifEmpty { "anonymous" }}, eventCount=${events.size}")
        
        if (events.isNotEmpty()) {
            val eventTypes = events.mapNotNull { it["type"]?.toString() }.groupingBy { it }.eachCount()
            Logger.debug("[UploadManager] buildEventsPayload: Event types in payload: ${eventTypes.entries.joinToString(", ") { "${it.key}=${it.value}" }}")
        }
        
        return payloadBytes
    }

    /**
     * Recursively convert Kotlin types to JSON-compatible values.
     * Handles nested Maps (-> JSONObject) and Lists (-> JSONArray) properly.
     */
    private fun toJsonValue(value: Any?): Any? {
        return when (value) {
            null -> JSONObject.NULL
            is Map<*, *> -> {
                JSONObject().apply {
                    @Suppress("UNCHECKED_CAST")
                    (value as Map<String, Any?>).forEach { (k, v) ->
                        put(k, toJsonValue(v))
                    }
                }
            }
            is List<*> -> {
                JSONArray().apply {
                    value.forEach { item -> put(toJsonValue(item)) }
                }
            }
            is Number, is String, is Boolean -> value
            else -> value.toString()
        }
    }

    private fun buildDeviceInfo(): JSONObject {
        return JSONObject().apply {
            put("model", Build.MODEL)
            put("manufacturer", Build.MANUFACTURER)
            put("systemName", "Android")
            put("systemVersion", Build.VERSION.RELEASE)
            put("sdkInt", Build.VERSION.SDK_INT)
            put("platform", "android")
            put("deviceHash", deviceHash)
            put("name", Build.DEVICE)
            
            val displayMetrics = context.resources.displayMetrics
            val density = if (displayMetrics.density > 0f) displayMetrics.density else 1f
            var widthPx = displayMetrics.widthPixels
            var heightPx = displayMetrics.heightPixels
            val activity = WindowUtils.getCurrentActivity(context)
            val decorView = activity?.window?.decorView
            if (decorView != null && decorView.width > 0 && decorView.height > 0) {
                widthPx = decorView.width
                heightPx = decorView.height
            }
            put("screenWidth", (widthPx / density).toInt())
            put("screenHeight", (heightPx / density).toInt())
            put("screenScale", density)
            
            try {
                val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
                put("appVersion", packageInfo.versionName)
                put("appId", context.packageName)
            } catch (e: Exception) {
            }
            
            val networkQuality = NetworkMonitor.getInstance(context).captureNetworkQuality()
            val networkMap = networkQuality.toMap()
            put("networkType", networkMap["networkType"] ?: "none")
            val cellularGeneration = networkMap["cellularGeneration"] as? String
            if (!cellularGeneration.isNullOrEmpty() && cellularGeneration != "unknown") {
                put("cellularGeneration", cellularGeneration)
            }
            put("isConstrained", networkMap["isConstrained"] ?: false)
            put("isExpensive", networkMap["isExpensive"] ?: false)
        }
    }

    private fun buildAuthenticatedRequest(path: String, body: String): Request {
        val deviceAuthManager = DeviceAuthManager.getInstance(context)
        val token = deviceAuthManager.getCurrentUploadToken()

        Logger.debug("[UploadManager] buildAuthenticatedRequest: path=$path, token=${if (token != null) "present" else "NULL"}")

        if (token == null) {
            Logger.warning("[UploadManager] No valid upload token available - triggering background refresh")
            scope.launch {
                try {
                    deviceAuthManager.getUploadTokenWithAutoRegister { _, _, _, _ -> }
                } catch (e: Exception) {
                    Logger.warning("[UploadManager] Background token refresh failed: ${e.message}")
                }
            }
        }

        return Request.Builder()
            .url("$apiUrl$path")
            .post(body.toRequestBody("application/json".toMediaType()))
            .apply {
                if (publicKey.isNotEmpty()) {
                    addHeader("X-Rejourney-Key", publicKey)
                }
                addHeader("X-Bundle-ID", context.packageName)
                addHeader("X-Rejourney-Platform", "android")
                if (deviceHash.isNotEmpty()) {
                    addHeader("X-Rejourney-Device-Hash", deviceHash)
                }
                token?.let { addHeader("x-upload-token", it) }
            }
            .build()
    }

    /**
     * Gzip compress data.
     */
    private fun gzipData(input: ByteArray): ByteArray? {
        return try {
            val bos = ByteArrayOutputStream()
            GZIPOutputStream(bos).use { gzip ->
                gzip.write(input)
            }
            bos.toByteArray()
        } catch (e: Exception) {
            Logger.error("Gzip compression failed", e)
            null
        }
    }

    private fun canUpload(): Boolean {
        if (circuitOpen) {
            if (System.currentTimeMillis() - circuitOpenTime > circuitResetTimeMs) {
                circuitOpen = false
                consecutiveFailures.set(0)
                Logger.debug("Circuit breaker reset")
            } else {
                return false
            }
        }

        val networkMonitor = NetworkMonitor.getInstance(context)
        return networkMonitor.isConnected
    }

    private fun onUploadSuccess(durationMs: Long) {
        consecutiveFailures.set(0)
        Telemetry.getInstance().recordUploadDuration(durationMs, success = true, byteCount = 0)
    }

    private fun onUploadFailure() {
        val failures = consecutiveFailures.incrementAndGet()
        Telemetry.getInstance().recordEvent(TelemetryEventType.UPLOAD_FAILURE)

        if (failures >= circuitBreakerThreshold) {
            circuitOpen = true
            circuitOpenTime = System.currentTimeMillis()
            Telemetry.getInstance().recordEvent(TelemetryEventType.CIRCUIT_BREAKER_OPEN)
            Logger.warning("Circuit breaker opened after $failures consecutive failures")
        }
    }


    /**
     * Whether this session has been promoted for replay upload.
     * Set by evaluateReplayPromotion() at session end.
     */
    var isReplayPromoted: Boolean = false
        private set

    /**
     * Request replay promotion evaluation from backend.
     * Returns Pair of (promoted: Boolean, reason: String) indicating if frames should be uploaded.
     * 
     * Call this at session end before uploading frames.
     * The backend evaluates metrics (crash, ANR, error count, etc.) and applies rate limiting.
     */
    suspend fun evaluateReplayPromotion(metrics: Map<String, Any?>): Pair<Boolean, String> {
        if (!canUpload()) {
            Logger.debug("Cannot evaluate replay promotion - network unavailable")
            return Pair(false, "network_unavailable")
        }

        val effectiveSessionId = activeSessionId ?: sessionId ?: ""
        
        val body = JSONObject().apply {
            put("sessionId", effectiveSessionId)
            put("metrics", JSONObject().apply {
                metrics.forEach { (key, value) ->
                    if (value != null) put(key, value)
                }
            })
        }

        return try {
            withContext(Dispatchers.IO) {
                val request = buildAuthenticatedRequest("/api/ingest/replay/evaluate", body.toString())
                val response = client.newCall(request).execute()
                
                response.use {
                    if (it.isSuccessful) {
                        val result = JSONObject(it.body?.string() ?: "{}")
                        val promoted = result.optBoolean("promoted", false)
                        val reason = result.optString("reason", "unknown")
                        
                        isReplayPromoted = promoted
                        
                        if (promoted) {
                            Logger.debug("Session promoted for replay upload (reason: $reason)")
                        } else {
                            Logger.debug("Session not promoted for replay (reason: $reason)")
                        }
                        
                        Pair(promoted, reason)
                    } else {
                        Logger.warning("Replay promotion evaluation failed: ${it.code}")
                        Pair(false, "api_error")
                    }
                }
            }
        } catch (e: Exception) {
            Logger.warning("Replay promotion evaluation error: ${e.message}")
            Pair(false, "exception")
        }
    }
}
