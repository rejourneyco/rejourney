/**
 * WorkManager-based upload worker for guaranteed background uploads.
 * 
 * This worker survives process death and device restarts, ensuring that
 * analytics events are always uploaded even when the app is killed.
 * 
 * Key features:
 * - Reads pending events from disk-persisted EventBuffer
 * - Automatic retry with exponential backoff on failure
 * - Network constraint ensures uploads only happen when connected
 * - Unique work per session prevents duplicate uploads
 */
package com.rejourney.network

import android.content.Context
import androidx.work.*
import com.rejourney.core.Logger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

class UploadWorker(
    private val appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        const val KEY_SESSION_ID = "sessionId"
        const val KEY_IS_FINAL = "isFinal"
        const val KEY_IS_RECOVERY = "isRecovery"
        
        private const val WORK_NAME_PREFIX = "rejourney_upload_"
        private const val RECOVERY_WORK_NAME = "rejourney_recovery_upload"
        
        /**
         * Schedule an upload for a specific session.
         * Uses unique work to prevent duplicate uploads for the same session.
         */
        fun scheduleUpload(
            context: Context,
            sessionId: String,
            isFinal: Boolean = false,
            expedited: Boolean = false
        ) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(androidx.work.NetworkType.CONNECTED)
                .build()
            
            val inputData = workDataOf(
                KEY_SESSION_ID to sessionId,
                KEY_IS_FINAL to isFinal,
                KEY_IS_RECOVERY to false
            )
            
            val workRequestBuilder = OneTimeWorkRequestBuilder<UploadWorker>()
                .setConstraints(constraints)
                .setInputData(inputData)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    30,
                    TimeUnit.SECONDS
                )
            
            if (expedited) {
                workRequestBuilder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            }
            
            val workRequest = workRequestBuilder.build()
            
            Logger.debug("[UploadWorker] scheduleUpload: Enqueuing work for session: $sessionId")
            Logger.debug("[UploadWorker] scheduleUpload: Work name: $WORK_NAME_PREFIX$sessionId")
            Logger.debug("[UploadWorker] scheduleUpload: Constraints: network=CONNECTED, expedited=$expedited")
            
            WorkManager.getInstance(context)
                .enqueueUniqueWork(
                    "$WORK_NAME_PREFIX$sessionId",
                    ExistingWorkPolicy.REPLACE,
                    workRequest
                )
            
            Logger.debug("[UploadWorker] ✅ Scheduled upload for session: $sessionId (final=$isFinal, expedited=$expedited)")
            Logger.debug("[UploadWorker] scheduleUpload: WorkManager should execute this work when network is available")
        }
        
        /**
         * Schedule recovery of any pending uploads from previous sessions.
         * Called on app startup to ensure no data is lost.
         */
        fun scheduleRecoveryUpload(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(androidx.work.NetworkType.CONNECTED)
                .build()
            
            val inputData = workDataOf(
                KEY_IS_RECOVERY to true
            )
            
            val workRequest = OneTimeWorkRequestBuilder<UploadWorker>()
                .setConstraints(constraints)
                .setInputData(inputData)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    30,
                    TimeUnit.SECONDS
                )
                .setInitialDelay(2, TimeUnit.SECONDS)
                .build()
            
            WorkManager.getInstance(context)
                .enqueueUniqueWork(
                    RECOVERY_WORK_NAME,
                    ExistingWorkPolicy.KEEP,
                    workRequest
                )
            
            Logger.debug("[UploadWorker] Scheduled recovery upload")
        }
        
        /**
         * Cancel any pending upload work for a session.
         */
        fun cancelUpload(context: Context, sessionId: String) {
            WorkManager.getInstance(context)
                .cancelUniqueWork("$WORK_NAME_PREFIX$sessionId")
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        Logger.debug("[UploadWorker] ========================================")
        Logger.debug("[UploadWorker] ===== DO WORK CALLED BY WORKMANAGER =====")
        Logger.debug("[UploadWorker] ========================================")
        Logger.debug("[UploadWorker] WorkManager execution started at ${System.currentTimeMillis()}")
        
        val sessionId = inputData.getString(KEY_SESSION_ID)
        val isFinal = inputData.getBoolean(KEY_IS_FINAL, false)
        val isRecovery = inputData.getBoolean(KEY_IS_RECOVERY, false)
        
        Logger.debug("[UploadWorker] ===== STARTING WORK =====")
        Logger.debug("[UploadWorker] Starting work (sessionId=$sessionId, isFinal=$isFinal, isRecovery=$isRecovery, attempt=${runAttemptCount})")
        Logger.debug("[UploadWorker] Input data keys: ${inputData.keyValueMap.keys.joinToString(", ")}")
        Logger.debug("[UploadWorker] Input data values: sessionId=$sessionId, isFinal=$isFinal, isRecovery=$isRecovery")
        
        try {
            if (isRecovery) {
                val success = performRecoveryUpload()
                return@withContext if (success) Result.success() else Result.retry()
            }
            
            if (sessionId.isNullOrEmpty()) {
                Logger.warning("[UploadWorker] No session ID provided")
                return@withContext Result.failure()
            }
            
            Logger.debug("[UploadWorker] ===== CALLING performSessionUpload =====")
            Logger.debug("[UploadWorker] About to upload session: $sessionId, isFinal=$isFinal")
            val success = performSessionUpload(sessionId, isFinal)
            Logger.debug("[UploadWorker] performSessionUpload returned: $success")
            
            if (success) {
                Logger.debug("[UploadWorker] ===== UPLOAD SUCCESS =====")
                Logger.debug("[UploadWorker] ✅ Upload succeeded for session: $sessionId")
                Result.success()
            } else {
                Logger.debug("[UploadWorker] ===== UPLOAD FAILED =====")
                if (runAttemptCount < 5) {
                    Logger.warning("[UploadWorker] ⚠️ Upload failed, will retry (attempt $runAttemptCount)")
                    Result.retry()
                } else {
                    Logger.error("[UploadWorker] ❌ Upload failed after $runAttemptCount attempts")
                    Result.failure()
                }
            }
        } catch (e: CancellationException) {
            Logger.debug("[UploadWorker] Work cancelled")
            throw e
        } catch (e: Exception) {
            Logger.error("[UploadWorker] Upload error", e)
            
            if (runAttemptCount < 5) {
                Result.retry()
            } else {
                Result.failure()
            }
        }
    }
    
    /**
     * Upload pending data for a specific session.
     * Events are stored in cacheDir/rj_pending/<sessionId>/events.jsonl by EventBuffer.
     * Session metadata is stored in filesDir/rejourney/pending_uploads/<sessionId>/session.json by UploadManager.
     */
    private suspend fun performSessionUpload(sessionId: String, isFinal: Boolean): Boolean {
        Logger.debug("[UploadWorker] performSessionUpload START (sessionId=$sessionId, isFinal=$isFinal)")
        
        val eventBufferDir = File(appContext.cacheDir, "rj_pending/$sessionId")
        val uploadManagerDir = File(appContext.filesDir, "rejourney/pending_uploads/$sessionId")
        
        Logger.debug("[UploadWorker] Checking directories: eventBufferDir=${eventBufferDir.exists()}, uploadManagerDir=${uploadManagerDir.exists()}")
        
        val eventsFile = File(eventBufferDir, "events.jsonl")
        Logger.debug("[UploadWorker] ===== READING EVENTS FROM DISK =====")
        Logger.debug("[UploadWorker] Events file path: ${eventsFile.absolutePath}")
        Logger.debug("[UploadWorker] Events file exists: ${eventsFile.exists()}")
        
        if (eventsFile.exists()) {
            Logger.debug("[UploadWorker] Events file size: ${eventsFile.length()} bytes")
        }
        
        if (!eventsFile.exists()) {
            Logger.warning("[UploadWorker] ⚠️ No events file for session: $sessionId - nothing to upload")
            Logger.warning("[UploadWorker] EventBuffer directory exists: ${eventBufferDir.exists()}")
            if (eventBufferDir.exists()) {
                Logger.warning("[UploadWorker] EventBuffer directory contents: ${eventBufferDir.listFiles()?.map { it.name }?.joinToString(", ") ?: "empty"}")
            }
            return true
        }
        
        Logger.debug("[UploadWorker] Reading events from file...")
        val readStartTime = System.currentTimeMillis()
        val events = readEventsFromFile(eventsFile)
        val readDuration = System.currentTimeMillis() - readStartTime
        
        Logger.debug("[UploadWorker] ✅ Read ${events.size} events from file in ${readDuration}ms (sessionId=$sessionId)")
        
        if (events.isNotEmpty()) {
            val eventTypes = events.mapNotNull { it["type"]?.toString() }.distinct()
            Logger.debug("[UploadWorker] Event types found: ${eventTypes.joinToString(", ")}")
            Logger.debug("[UploadWorker] First event: type=${events.first()["type"]}, timestamp=${events.first()["timestamp"]}")
            if (events.size > 1) {
                Logger.debug("[UploadWorker] Last event: type=${events.last()["type"]}, timestamp=${events.last()["timestamp"]}")
            }
        }
        
        if (events.isEmpty()) {
            Logger.warning("[UploadWorker] ⚠️ No events to upload for session: $sessionId (file exists but is empty or unreadable)")
            eventsFile.delete()
            File(eventBufferDir, "buffer_meta.json").delete()
            if (eventBufferDir.listFiles()?.isEmpty() == true) {
                eventBufferDir.delete()
            }
            return true
        }
        
        Logger.debug("[UploadWorker] ===== FOUND ${events.size} EVENTS TO UPLOAD =====")
        
        val authManager = DeviceAuthManager.getInstance(appContext)
        Logger.debug("[UploadWorker] Ensuring valid auth token before upload...")
        
        val tokenValid = authManager.ensureValidToken()
        if (!tokenValid) {
            Logger.error("[UploadWorker] FAILED to obtain valid auth token - upload will likely fail!")
        } else {
            Logger.debug("[UploadWorker] Auth token is valid, proceeding with upload")
        }
        
        val uploadManager = createUploadManager(sessionId, uploadManagerDir)
        Logger.debug("[UploadWorker] UploadManager created (apiUrl=${uploadManager.apiUrl}, publicKey=${uploadManager.publicKey.take(8)}...)")
        
        Logger.debug("[UploadWorker] ===== STARTING EVENT UPLOAD =====")
        Logger.debug("[UploadWorker] Calling uploadBatch for ${events.size} events (isFinal=$isFinal, sessionId=$sessionId)")
        val uploadStartTime = System.currentTimeMillis()
        val uploadSuccess = uploadManager.uploadBatch(events, isFinal = isFinal)
        val uploadDuration = System.currentTimeMillis() - uploadStartTime
        Logger.debug("[UploadWorker] uploadBatch returned: $uploadSuccess (duration=${uploadDuration}ms)")
        
        if (uploadSuccess) {
            Logger.debug("[UploadWorker] Upload SUCCESS - cleaning up local files")
            eventsFile.delete()
            File(eventBufferDir, "buffer_meta.json").delete()
            
            if (eventBufferDir.listFiles()?.isEmpty() == true) {
                eventBufferDir.delete()
            }
            
            if (isFinal) {
                Logger.debug("[UploadWorker] Sending session end signal...")
                val endSuccess = uploadManager.endSession()
                Logger.debug("[UploadWorker] Session end signal: ${if (endSuccess) "SUCCESS" else "FAILED"}")
                uploadManagerDir.deleteRecursively()
            }
        } else {
            Logger.error("[UploadWorker] Upload FAILED for session $sessionId - will retry")
        }
        
        checkAndUploadCrashSegment(uploadManager, sessionId)

        return uploadSuccess
    }

    /**
     * Check for and upload a pending crash segment (saved by emergencyFlush).
     */
    private suspend fun checkAndUploadCrashSegment(uploadManager: UploadManager, sessionId: String) {
        val segmentsDir = File(appContext.filesDir, "rejourney/segments")
        val metaFile = File(segmentsDir, "pending_crash_segment.json")
        
        if (!metaFile.exists()) return
        
        try {
            val metaJson = JSONObject(metaFile.readText())
            val metaSessionId = metaJson.optString("sessionId")
            
            if (metaSessionId != sessionId) return
            
            Logger.debug("[UploadWorker] Found pending crash segment for session $sessionId")
            
            val segmentPath = metaJson.optString("segmentFile")
            val startTime = metaJson.optLong("startTime")
            val endTime = metaJson.optLong("endTime")
            val frameCount = metaJson.optInt("frameCount")
            val segmentFile = File(segmentPath)
            
            if (segmentFile.exists() && segmentFile.length() > 0) {
                Logger.debug("[UploadWorker] Recovering crash segment: ${segmentFile.name} ($frameCount frames)")
                val success = uploadManager.uploadVideoSegment(
                    segmentFile = segmentFile,
                    startTime = startTime,
                    endTime = endTime,
                    frameCount = frameCount
                )
                
                if (success) {
                    Logger.debug("[UploadWorker] Crash segment recovered successfully")
                    metaFile.delete()
                    segmentFile.delete()
                } else {
                    Logger.warning("[UploadWorker] Failed to upload crash segment")
                }
            } else {
                Logger.warning("[UploadWorker] Crash segment file missing or empty: $segmentPath")
                metaFile.delete()
            }
        } catch (e: Exception) {
            Logger.error("[UploadWorker] Error processing crash segment", e)
        }
    }
    
    /**
     * Recover and upload data from all pending sessions.
     * Scans both the EventBuffer cache directory and UploadManager pending directory.
     */
    private suspend fun performRecoveryUpload(): Boolean {
        val eventBufferRootDir = File(appContext.cacheDir, "rj_pending")
        val uploadManagerRootDir = File(appContext.filesDir, "rejourney/pending_uploads")
        
        val sessionIds = mutableSetOf<String>()
        
        eventBufferRootDir.listFiles()?.filter { it.isDirectory }?.forEach { 
            sessionIds.add(it.name) 
        }
        
        uploadManagerRootDir.listFiles()?.filter { it.isDirectory }?.forEach { 
            sessionIds.add(it.name) 
        }
        
        if (sessionIds.isEmpty()) {
            Logger.debug("[UploadWorker] No pending sessions to recover")
            return true
        }
        
        Logger.debug("[UploadWorker] Found ${sessionIds.size} sessions to check for recovery")
        
        var allSuccess = true
        
        for (sessionId in sessionIds) {
            if (sessionId.isBlank()) continue
            
            Logger.debug("[UploadWorker] Checking session for recovery: $sessionId")
            
            val sessionMetaFile = File(uploadManagerRootDir, "$sessionId/session.json")
            if (sessionMetaFile.exists()) {
                try {
                    val meta = JSONObject(sessionMetaFile.readText())
                    val updatedAt = meta.optLong("updatedAt", 0)
                    val age = System.currentTimeMillis() - updatedAt
                    
                    if (age < 60_000) {
                        Logger.debug("[UploadWorker] Skipping recent session: $sessionId (age=${age}ms)")
                        continue
                    }
                } catch (e: Exception) {
                }
            }
            
            val success = performSessionUpload(sessionId, isFinal = true)
            if (!success) {
                allSuccess = false
            }
        }
        
        return allSuccess
    }
    
    /**
     * Read events from a JSONL file.
     */
    private fun readEventsFromFile(file: File): List<Map<String, Any?>> {
        val events = mutableListOf<Map<String, Any?>>()
        
        try {
            file.bufferedReader().useLines { lines ->
                lines.forEach { line ->
                    if (line.isNotBlank()) {
                        try {
                            val json = JSONObject(line)
                            val map = mutableMapOf<String, Any?>()
                            json.keys().forEach { key ->
                                map[key] = json.opt(key)
                            }
                            events.add(map)
                        } catch (e: Exception) {
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Logger.warning("[UploadWorker] Failed to read events file: ${e.message}")
        }
        
        return events
    }
    
    /**
     * Create an UploadManager configured for the given session.
     */
    private fun createUploadManager(sessionId: String, sessionDir: File): UploadManager {
        val sessionMetaFile = File(sessionDir, "session.json")
        var sessionStartTime = System.currentTimeMillis()
        var totalBackgroundTimeMs = 0L
        
        if (sessionMetaFile.exists()) {
            try {
                val meta = JSONObject(sessionMetaFile.readText())
                sessionStartTime = meta.optLong("sessionStartTime", sessionStartTime)
                totalBackgroundTimeMs = meta.optLong("totalBackgroundTimeMs", 0)
            } catch (e: Exception) {
            }
        }
        
        val authManager = DeviceAuthManager.getInstance(appContext)
        val publicKey = authManager.getCurrentPublicKey() ?: ""
        val deviceHash = authManager.getCurrentDeviceHash() ?: ""
        val apiUrl = authManager.getCurrentApiUrl() ?: "https://api.rejourney.co"
        
        return UploadManager(appContext, apiUrl).apply {
            this.sessionId = sessionId
            this.publicKey = publicKey
            this.deviceHash = deviceHash
            this.sessionStartTime = sessionStartTime
            this.totalBackgroundTimeMs = totalBackgroundTimeMs
        }
    }
}
