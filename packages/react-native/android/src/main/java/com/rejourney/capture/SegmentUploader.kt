/**
 * Uploads finished video segments to S3/R2 storage.
 * Ported from iOS RJSegmentUploader.
 *
 * Uses the presigned URL flow:
 * 1. Request presigned URL from backend
 * 2. Upload directly to S3/R2
 * 3. Notify backend of completion
 *
 * ## Features
 * - Background upload support
 * - Retry with exponential backoff
 * - Queue management for multiple segments
 * - Automatic cleanup of uploaded files
 *
 * Licensed under the Apache License, Version 2.0
 * Copyright (c) 2026 Rejourney
 */
package com.rejourney.capture

import com.rejourney.core.Logger
import com.rejourney.network.HttpClientProvider
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.zip.GZIPOutputStream

/**
 * Result type for segment upload operations.
 */
data class SegmentUploadResult(
    val success: Boolean,
    val error: String? = null
)

/**
 * Uploads video segments and hierarchy snapshots to cloud storage.
 */
class SegmentUploader(
    /** Base URL for the Rejourney API */
    var baseURL: String
) {

    /** API key (public key rj_...) for authentication */
    var apiKey: String? = null

    /** Project ID for the current recording session */
    var projectId: String? = null

    /** Upload token from device auth for authenticated uploads */
    var uploadToken: String? = null

    /** Maximum number of retry attempts. Default: 3 */
    var maxRetries: Int = 3

    /** Whether to delete local files after successful upload. Default: true */
    var deleteAfterUpload: Boolean = true

    /** Number of uploads currently in progress */
    val pendingUploads: Int
        get() = pendingUploadCount.get()

    private val pendingUploadCount = AtomicInteger(0)
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val client = HttpClientProvider.shared.newBuilder()
        .connectTimeout(60, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    /**
     * Uploads a video segment to cloud storage.
     *
     * @param segmentFile Local file path of the .mp4 segment
     * @param sessionId Session identifier
     * @param startTime Segment start time in epoch milliseconds
     * @param endTime Segment end time in epoch milliseconds
     * @param frameCount Number of frames in the segment
     * @return SegmentUploadResult indicating success or failure
     */
    suspend fun uploadVideoSegment(
        segmentFile: File,
        sessionId: String,
        startTime: Long,
        endTime: Long,
        frameCount: Int
    ): SegmentUploadResult = withContext(Dispatchers.IO) {
        Logger.debug("[SegmentUploader] uploadVideoSegment: ${segmentFile.name}, sessionId=$sessionId, frames=$frameCount")
        Logger.debug("[SegmentUploader] apiKey=${if (apiKey != null) "<set>" else "<nil>"}, projectId=$projectId")

        val key = apiKey
        val pid = projectId

        if (key == null || pid == null) {
            Logger.error("[SegmentUploader] Missing apiKey or projectId!")
            return@withContext SegmentUploadResult(false, "Missing configuration")
        }

        if (!segmentFile.exists()) {
            Logger.error("[SegmentUploader] File not found: ${segmentFile.absolutePath}")
            return@withContext SegmentUploadResult(false, "File not found")
        }

        pendingUploadCount.incrementAndGet()

        try {
            Logger.debug("[SegmentUploader] Requesting presigned URL for segment")
            val presignResult = requestPresignedURL(
                sessionId = sessionId,
                kind = "video",
                sizeBytes = segmentFile.length(),
                startTime = startTime,
                endTime = endTime,
                frameCount = frameCount
            )

            if (!presignResult.success || presignResult.presignedUrl == null) {
                Logger.error("[SegmentUploader] Failed to get presigned URL: ${presignResult.error}")
                return@withContext SegmentUploadResult(false, presignResult.error ?: "Failed to get presigned URL")
            }

            val presignedUrl = presignResult.presignedUrl
            val segmentId = presignResult.segmentId
            val s3Key = presignResult.s3Key

            Logger.debug("[SegmentUploader] Got presigned URL, segmentId=$segmentId")

            Logger.debug("[SegmentUploader] Uploading to S3...")
            val uploadResult = uploadFileToS3(segmentFile, presignedUrl, "video/mp4")

            if (!uploadResult.success) {
                Logger.error("[SegmentUploader] S3 upload failed: ${uploadResult.error}")
                return@withContext SegmentUploadResult(false, uploadResult.error ?: "S3 upload failed")
            }

            Logger.debug("[SegmentUploader] S3 upload SUCCESS, calling segment/complete")

            val completeResult = notifySegmentComplete(
                segmentId = segmentId!!,
                sessionId = sessionId,
                startTime = startTime,
                endTime = endTime,
                frameCount = frameCount
            )

            if (completeResult.success) {
                Logger.info("[SegmentUploader] Upload complete for ${segmentFile.name}")
                if (deleteAfterUpload) {
                    segmentFile.delete()
                }
                SegmentUploadResult(true)
            } else {
                Logger.warning("[SegmentUploader] Completion notification failed: ${completeResult.error}")
                SegmentUploadResult(false, completeResult.error)
            }

        } catch (e: Exception) {
            Logger.error("[SegmentUploader] Upload failed with exception", e)
            SegmentUploadResult(false, e.message ?: "Unknown error")
        } finally {
            pendingUploadCount.decrementAndGet()
        }
    }

    /**
     * Uploads a view hierarchy snapshot to cloud storage.
     *
     * @param hierarchyData JSON data of the hierarchy snapshot
     * @param sessionId Session identifier
     * @param timestamp Snapshot timestamp in epoch milliseconds
     * @return SegmentUploadResult indicating success or failure
     */
    suspend fun uploadHierarchy(
        hierarchyData: ByteArray,
        sessionId: String,
        timestamp: Long
    ): SegmentUploadResult = withContext(Dispatchers.IO) {
        val key = apiKey
        val pid = projectId

        if (key == null || pid == null) {
            return@withContext SegmentUploadResult(false, "Missing configuration")
        }

        pendingUploadCount.incrementAndGet()

        try {
            val compressedData = gzipData(hierarchyData)
            
            val presignResult = requestPresignedURL(
                sessionId = sessionId,
                kind = "hierarchy",
                sizeBytes = compressedData.size.toLong(),
                startTime = timestamp,
                endTime = timestamp,
                frameCount = 0,
                compression = "gzip"
            )

            if (!presignResult.success || presignResult.presignedUrl == null) {
                Logger.error("[SegmentUploader] Failed to get presigned URL for hierarchy: ${presignResult.error}")
                return@withContext SegmentUploadResult(false, presignResult.error ?: "Failed to get presigned URL")
            }

            val presignedUrl = presignResult.presignedUrl
            val segmentId = presignResult.segmentId

            val uploadResult = uploadDataToS3(compressedData, presignedUrl, "application/gzip")

            if (!uploadResult.success) {
                Logger.error("[SegmentUploader] S3 upload failed for hierarchy: ${uploadResult.error}")
                return@withContext SegmentUploadResult(false, uploadResult.error)
            }

            val completeResult = notifySegmentComplete(
                segmentId = segmentId!!,
                sessionId = sessionId,
                startTime = timestamp,
                endTime = timestamp,
                frameCount = 0
            )

            if (completeResult.success) {
                Logger.debug("[SegmentUploader] Hierarchy uploaded for $sessionId at $timestamp")
            }

            SegmentUploadResult(completeResult.success, completeResult.error)

        } catch (e: Exception) {
            Logger.error("[SegmentUploader] Hierarchy upload failed", e)
            SegmentUploadResult(false, e.message)
        } finally {
            pendingUploadCount.decrementAndGet()
        }
    }

    /**
     * Cancels all pending uploads.
     */
    fun cancelAllUploads() {
        scope.coroutineContext.cancelChildren()
        pendingUploadCount.set(0)
    }

    /**
     * Cleans up any leftover segment files from previous sessions.
     */
    fun cleanupOrphanedSegments(segmentDir: File) {
        try {
            val cutoffTime = System.currentTimeMillis() - (24 * 60 * 60 * 1000)
            segmentDir.listFiles()?.forEach { file ->
                if (file.isFile && file.lastModified() < cutoffTime) {
                    file.delete()
                    Logger.debug("[SegmentUploader] Cleaned up orphaned segment: ${file.name}")
                }
            }
        } catch (e: Exception) {
            Logger.debug("[SegmentUploader] Error cleaning orphaned segments: ${e.message}")
        }
    }


    private data class PresignResult(
        val success: Boolean,
        val presignedUrl: String? = null,
        val segmentId: String? = null,
        val s3Key: String? = null,
        val error: String? = null
    )

    private suspend fun requestPresignedURL(
        sessionId: String,
        kind: String,
        sizeBytes: Long,
        startTime: Long,
        endTime: Long,
        frameCount: Int,
        compression: String? = null
    ): PresignResult = withContext(Dispatchers.IO) {
        val url = "$baseURL/api/ingest/segment/presign"

        val json = JSONObject().apply {
            put("sessionId", sessionId)
            put("kind", kind)
            put("sizeBytes", sizeBytes)
            put("startTime", startTime)
            put("endTime", endTime)
            put("frameCount", frameCount)
            if (compression != null) {
                put("compression", compression)
            }
        }

        val mediaType = "application/json; charset=utf-8".toMediaType()
        val body = json.toString().toRequestBody(mediaType)

        val requestBuilder = Request.Builder()
            .url(url)
            .post(body)
            .header("Content-Type", "application/json")

        val token = uploadToken
        val key = apiKey
        if (!token.isNullOrEmpty() && !key.isNullOrEmpty()) {
            requestBuilder.header("x-upload-token", token)
            requestBuilder.header("x-rejourney-key", key)
        } else if (!key.isNullOrEmpty()) {
            requestBuilder.header("x-api-key", key)
        }

        val request = requestBuilder.build()

        try {
            val response = client.newCall(request).execute()
            val responseBody = response.body?.string()

            if (response.isSuccessful && responseBody != null) {
                val jsonResponse = JSONObject(responseBody)
                PresignResult(
                    success = true,
                    presignedUrl = jsonResponse.optString("presignedUrl"),
                    segmentId = jsonResponse.optString("segmentId"),
                    s3Key = jsonResponse.optString("s3Key")
                )
            } else {
                PresignResult(
                    success = false,
                    error = "HTTP ${response.code}: ${responseBody ?: "No response body"}"
                )
            }
        } catch (e: Exception) {
            PresignResult(success = false, error = e.message)
        }
    }

    private suspend fun uploadFileToS3(
        file: File,
        presignedUrl: String,
        contentType: String,
        attempt: Int = 1
    ): SegmentUploadResult = withContext(Dispatchers.IO) {
        try {
            val fileData = file.readBytes()

            val mediaType = contentType.toMediaType()
            val body = fileData.toRequestBody(mediaType)

            val request = Request.Builder()
                .url(presignedUrl)
                .put(body)
                .header("Content-Type", contentType)
                .build()

            val response = client.newCall(request).execute()

            if (response.isSuccessful) {
                SegmentUploadResult(true)
            } else {
                val error = "S3 upload failed: HTTP ${response.code}"
                if (attempt < maxRetries) {
                    delay(calculateBackoff(attempt))
                    uploadFileToS3(file, presignedUrl, contentType, attempt + 1)
                } else {
                    SegmentUploadResult(false, error)
                }
            }
        } catch (e: IOException) {
            if (attempt < maxRetries) {
                delay(calculateBackoff(attempt))
                uploadFileToS3(file, presignedUrl, contentType, attempt + 1)
            } else {
                SegmentUploadResult(false, e.message)
            }
        }
    }

    private suspend fun uploadDataToS3(
        data: ByteArray,
        presignedUrl: String,
        contentType: String,
        attempt: Int = 1
    ): SegmentUploadResult = withContext(Dispatchers.IO) {
        try {
            val mediaType = contentType.toMediaType()
            val body = data.toRequestBody(mediaType)

            val request = Request.Builder()
                .url(presignedUrl)
                .put(body)
                .header("Content-Type", contentType)
                .build()

            val response = client.newCall(request).execute()

            if (response.isSuccessful) {
                SegmentUploadResult(true)
            } else {
                val error = "S3 upload failed: HTTP ${response.code}"
                if (attempt < maxRetries) {
                    delay(calculateBackoff(attempt))
                    uploadDataToS3(data, presignedUrl, contentType, attempt + 1)
                } else {
                    SegmentUploadResult(false, error)
                }
            }
        } catch (e: IOException) {
            if (attempt < maxRetries) {
                delay(calculateBackoff(attempt))
                uploadDataToS3(data, presignedUrl, contentType, attempt + 1)
            } else {
                SegmentUploadResult(false, e.message)
            }
        }
    }

    private suspend fun notifySegmentComplete(
        segmentId: String,
        sessionId: String,
        startTime: Long,
        endTime: Long,
        frameCount: Int,
        attempt: Int = 1
    ): SegmentUploadResult = withContext(Dispatchers.IO) {
        val url = "$baseURL/api/ingest/segment/complete"

        val json = JSONObject().apply {
            put("segmentId", segmentId)
            put("sessionId", sessionId)
            put("projectId", projectId)
            put("startTime", startTime)
            put("endTime", endTime)
            put("frameCount", frameCount)
        }

        val mediaType = "application/json; charset=utf-8".toMediaType()
        val body = json.toString().toRequestBody(mediaType)

        val requestBuilder = Request.Builder()
            .url(url)
            .post(body)
            .header("Content-Type", "application/json")

        val token = uploadToken
        val key = apiKey
        if (!token.isNullOrEmpty() && !key.isNullOrEmpty()) {
            requestBuilder.header("x-upload-token", token)
            requestBuilder.header("x-rejourney-key", key)
        } else if (!key.isNullOrEmpty()) {
            requestBuilder.header("x-api-key", key)
        }

        val request = requestBuilder.build()

        try {
            val response = client.newCall(request).execute()

            if (response.isSuccessful) {
                SegmentUploadResult(true)
            } else {
                val error = "Completion notification failed: HTTP ${response.code}"
                if (attempt < maxRetries) {
                    delay(calculateBackoff(attempt))
                    notifySegmentComplete(segmentId, sessionId, startTime, endTime, frameCount, attempt + 1)
                } else {
                    SegmentUploadResult(false, error)
                }
            }
        } catch (e: IOException) {
            if (attempt < maxRetries) {
                delay(calculateBackoff(attempt))
                notifySegmentComplete(segmentId, sessionId, startTime, endTime, frameCount, attempt + 1)
            } else {
                SegmentUploadResult(false, e.message)
            }
        }
    }

    private fun gzipData(data: ByteArray): ByteArray {
        val bos = ByteArrayOutputStream()
        GZIPOutputStream(bos).use { gzip ->
            gzip.write(data)
        }
        return bos.toByteArray()
    }

    private fun calculateBackoff(attempt: Int): Long {
        return (1000L * (1 shl (attempt - 1))).coerceAtMost(30000L)
    }
}
