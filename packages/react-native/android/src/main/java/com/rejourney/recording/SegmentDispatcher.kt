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

import com.rejourney.engine.DiagnosticLog
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Handles segment uploads with presigned URLs and circuit breaker
 * Android implementation aligned with iOS SegmentDispatcher.swift
 */
class SegmentDispatcher private constructor() {
    
    companion object {
        @Volatile
        private var instance: SegmentDispatcher? = null
        
        val shared: SegmentDispatcher
            get() = instance ?: synchronized(this) {
                instance ?: SegmentDispatcher().also { instance = it }
            }
    }
    
    var endpoint: String = "https://api.rejourney.co"
    var currentReplayId: String? = null
    var apiToken: String? = null
    var credential: String? = null
    var projectId: String? = null
    
    private var batchSeqNumber = 0
    private var billingBlocked = false
    private var consecutiveFailures = 0
    private var circuitOpen = false
    private var circuitOpenTime: Long = 0
    private val circuitBreakerThreshold = 5
    private val circuitResetTime: Long = 60_000 // 60 seconds
    
    // Metrics
    var uploadSuccessCount = 0
    var uploadFailureCount = 0
    var totalBytesUploaded = 0L
    var circuitBreakerOpenCount = 0
    
    private val workerExecutor = Executors.newFixedThreadPool(2)
    private val scope = CoroutineScope(workerExecutor.asCoroutineDispatcher() + SupervisorJob())
    
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS) // Short timeout for debugging
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()
    
    private val retryQueue = mutableListOf<PendingUpload>()
    private val retryLock = ReentrantLock()
    private var active = true
    
    fun configure(replayId: String, apiToken: String?, credential: String?, projectId: String?) {
        currentReplayId = replayId
        this.apiToken = apiToken
        this.credential = credential
        this.projectId = projectId
        batchSeqNumber = 0
        billingBlocked = false
        consecutiveFailures = 0
    }
    
    fun activate() {
        active = true
        consecutiveFailures = 0
        circuitOpen = false
    }
    
    fun halt() {
        active = false
    }
    
    fun shipPending() {
        scope.launch {
            drainRetryQueue()
        }
    }
    
    fun transmitFrameBundle(
        payload: ByteArray,
        startMs: Long,
        endMs: Long,
        frameCount: Int,
        completion: ((Boolean) -> Unit)? = null
    ) {
        val sid = currentReplayId
        val canUpload = canUploadNow()
        DiagnosticLog.notice("[SegmentDispatcher] transmitFrameBundle: sid=${sid?.take(12) ?: "null"}, canUpload=$canUpload, frames=$frameCount, bytes=${payload.size}")
        
        if (sid != null) {
            DiagnosticLog.debugPresignRequest(endpoint, sid, "screenshots", payload.size)
        }
        
        if (sid == null || !canUpload) {
            DiagnosticLog.caution("[SegmentDispatcher] transmitFrameBundle: rejected - sid=${sid != null}, canUpload=$canUpload")
            completion?.invoke(false)
            return
        }
        
        val upload = PendingUpload(
            sessionId = sid,
            contentType = "screenshots",
            payload = payload,
            rangeStart = startMs,
            rangeEnd = endMs,
            itemCount = frameCount,
            attempt = 0
        )
        scheduleUpload(upload, completion)
    }
    
    fun transmitHierarchy(
        replayId: String,
        hierarchyPayload: ByteArray,
        timestampMs: Long,
        completion: ((Boolean) -> Unit)? = null
    ) {
        if (!canUploadNow()) {
            completion?.invoke(false)
            return
        }
        
        val upload = PendingUpload(
            sessionId = replayId,
            contentType = "hierarchy",
            payload = hierarchyPayload,
            rangeStart = timestampMs,
            rangeEnd = timestampMs,
            itemCount = 1,
            attempt = 0
        )
        scheduleUpload(upload, completion)
    }
    
    fun transmitEventBatch(
        payload: ByteArray,
        batchNumber: Int,
        eventCount: Int,
        completion: ((Boolean) -> Unit)? = null
    ) {
        val sid = currentReplayId
        if (sid == null || !canUploadNow()) {
            completion?.invoke(false)
            return
        }
        
        scope.launch {
            executeEventBatchUpload(sid, payload, batchNumber, eventCount, completion)
        }
    }
    
    fun transmitEventBatchAlternate(
        replayId: String,
        eventPayload: ByteArray,
        eventCount: Int,
        completion: ((Boolean) -> Unit)? = null
    ) {
        if (!canUploadNow()) {
            completion?.invoke(false)
            return
        }
        
        batchSeqNumber++
        val seq = batchSeqNumber
        
        scope.launch {
            executeEventBatchUpload(replayId, eventPayload, seq, eventCount, completion)
        }
    }
    
    fun concludeReplay(
        replayId: String,
        concludedAt: Long,
        backgroundDurationMs: Long,
        metrics: Map<String, Any>?,
        completion: (Boolean) -> Unit
    ) {
        val url = "$endpoint/api/ingest/session/end"
        
        val body = JSONObject().apply {
            put("sessionId", replayId)
            put("endedAt", concludedAt)
            if (backgroundDurationMs > 0) put("totalBackgroundTimeMs", backgroundDurationMs)
            metrics?.let { put("metrics", JSONObject(it)) }
        }
        
        val request = buildRequest(url, body)
        
        scope.launch {
            try {
                val response = httpClient.newCall(request).execute()
                completion(response.code == 200)
            } catch (e: Exception) {
                completion(false)
            }
        }
    }
    
    fun evaluateReplayRetention(
        replayId: String,
        metrics: Map<String, Any>,
        completion: (Boolean, String) -> Unit
    ) {
        val url = "$endpoint/api/ingest/replay/evaluate"
        
        val body = JSONObject().apply {
            put("sessionId", replayId)
            metrics.forEach { (key, value) -> put(key, value) }
        }
        
        val request = buildRequest(url, body)
        
        scope.launch {
            try {
                val response = httpClient.newCall(request).execute()
                val responseBody = response.body?.string()
                
                if (response.code == 200 && responseBody != null) {
                    val json = JSONObject(responseBody)
                    val retained = json.optBoolean("promoted", false)
                    val reason = json.optString("reason", "unknown")
                    completion(retained, reason)
                } else {
                    completion(false, "request_failed")
                }
            } catch (e: Exception) {
                completion(false, "request_failed")
            }
        }
    }
    
    private fun canUploadNow(): Boolean {
        if (billingBlocked) return false
        if (circuitOpen) {
            if (System.currentTimeMillis() - circuitOpenTime > circuitResetTime) {
                circuitOpen = false
            } else {
                return false
            }
        }
        return true
    }
    
    private fun registerFailure() {
        consecutiveFailures++
        uploadFailureCount++
        if (consecutiveFailures >= circuitBreakerThreshold) {
            if (!circuitOpen) circuitBreakerOpenCount++
            circuitOpen = true
            circuitOpenTime = System.currentTimeMillis()
        }
    }
    
    private fun registerSuccess() {
        consecutiveFailures = 0
        uploadSuccessCount++
    }
    
    private fun scheduleUpload(upload: PendingUpload, completion: ((Boolean) -> Unit)?) {
        DiagnosticLog.notice("[SegmentDispatcher] scheduleUpload: active=$active, type=${upload.contentType}, items=${upload.itemCount}")
        if (!active) {
            DiagnosticLog.caution("[SegmentDispatcher] scheduleUpload: rejected - not active")
            completion?.invoke(false)
            return
        }
        scope.launch {
            executeSegmentUpload(upload, completion)
        }
    }
    
    private suspend fun executeSegmentUpload(upload: PendingUpload, completion: ((Boolean) -> Unit)?) {
        if (!active) {
            completion?.invoke(false)
            return
        }
        
        val presignResponse = requestPresignedUrl(upload)
        if (presignResponse == null) {
            DiagnosticLog.notice("[SegmentDispatcher] ❌ requestPresignedUrl FAILED for ${upload.contentType}")
            DiagnosticLog.caution("[SegmentDispatcher] requestPresignedUrl FAILED for ${upload.contentType}")
            registerFailure()
            scheduleRetryIfNeeded(upload, completion)
            return
        }
        
        val s3ok = uploadToS3(presignResponse.presignedUrl, upload.payload, upload.contentType)
        if (!s3ok) {
            DiagnosticLog.notice("[SegmentDispatcher] ❌ uploadToS3 FAILED for ${upload.contentType}")
            DiagnosticLog.caution("[SegmentDispatcher] uploadToS3 FAILED for ${upload.contentType}")
            registerFailure()
            scheduleRetryIfNeeded(upload, completion)
            return
        }
        
        val confirmOk = confirmBatchComplete(presignResponse.batchId, upload)
        if (confirmOk) {
            registerSuccess()
        } else {
            DiagnosticLog.notice("[SegmentDispatcher] ❌ confirmBatchComplete FAILED for ${upload.contentType}")
            DiagnosticLog.caution("[SegmentDispatcher] confirmBatchComplete FAILED for ${upload.contentType}")
            registerFailure()
        }
        completion?.invoke(confirmOk)
    }
    
    private fun scheduleRetryIfNeeded(upload: PendingUpload, completion: ((Boolean) -> Unit)?) {
        if (upload.attempt < 3) {
            val retry = upload.copy(attempt = upload.attempt + 1)
            retryLock.withLock {
                retryQueue.add(retry)
            }
        }
        completion?.invoke(false)
    }
    
    private fun drainRetryQueue() {
        val items = retryLock.withLock {
            val copy = retryQueue.toList()
            retryQueue.clear()
            copy
        }
        items.forEach { 
            scope.launch { executeSegmentUpload(it, null) }
        }
    }
    
    private suspend fun requestPresignedUrl(upload: PendingUpload): PresignResponse? {
        val urlPath = if (upload.contentType == "events") "/api/ingest/presign" else "/api/ingest/segment/presign"
        val url = "$endpoint$urlPath"
        
        val body = JSONObject().apply {
            put("sessionId", upload.sessionId)
            put("sizeBytes", upload.payload.size)
            
            if (upload.contentType == "events") {
                put("contentType", "events")
                put("batchNumber", batchSeqNumber)
            } else {
                put("kind", upload.contentType)
                put("startTime", upload.rangeStart)
                put("endTime", upload.rangeEnd)
                put("frameCount", upload.itemCount)
                put("compression", "gzip")
            }
        }
        
        val request = buildRequest(url, body)
        val startTime = System.currentTimeMillis()
        
        return try {
            val response = httpClient.newCall(request).execute()
            val durationMs = (System.currentTimeMillis() - startTime).toDouble()
            val responseBody = response.body?.string()
            
            DiagnosticLog.debugPresignResponse(response.code, null, null, durationMs)
            
            if (response.code == 402) {
                DiagnosticLog.notice("[SegmentDispatcher] ❌ presign: 402 Payment Required - billing blocked")
                billingBlocked = true
                return null
            }
            
            if (response.code != 200 || responseBody == null) {
                val bodyPreview = responseBody?.take(300) ?: "null"
                DiagnosticLog.notice("[SegmentDispatcher] ❌ presign failed: status=${response.code} body=$bodyPreview")
                return null
            }
            
            val json = JSONObject(responseBody)
            
            if (json.optBoolean("skipUpload", false)) {
                return null
            }
            
            val presignedUrl = json.optString("presignedUrl", null) ?: return null
            val batchId = json.optString("batchId", null) 
                ?: json.optString("segmentId", "") 
                ?: ""
            
            DiagnosticLog.debugPresignResponse(response.code, batchId, presignedUrl, durationMs)
            PresignResponse(presignedUrl, batchId)
        } catch (e: Exception) {
            val durationMs = (System.currentTimeMillis() - startTime).toDouble()
            DiagnosticLog.notice("[SegmentDispatcher] ❌ presign exception (${durationMs.toLong()}ms): ${e.javaClass.simpleName}: ${e.message}")
            DiagnosticLog.fault("[SegmentDispatcher] presign exception: ${e.message}")
            null
        }
    }
    
    private suspend fun uploadToS3(url: String, payload: ByteArray, contentType: String): Boolean {
        val mediaType = when (contentType) {
            "video" -> "video/mp4".toMediaType()
            else -> "application/gzip".toMediaType()
        }
        
        val request = Request.Builder()
            .url(url)
            .put(payload.toRequestBody(mediaType))
            .header("Content-Type", mediaType.toString())
            .build()
        
        val startTime = System.currentTimeMillis()
        return try {
            val response = httpClient.newCall(request).execute()
            val durationMs = (System.currentTimeMillis() - startTime).toDouble()
            DiagnosticLog.debugUploadComplete("", response.code, durationMs, 0.0)
            
            if (response.code in 200..299) {
                totalBytesUploaded += payload.size
                true
            } else {
                false
            }
        } catch (e: Exception) {
            DiagnosticLog.notice("[SegmentDispatcher] ❌ S3 upload exception: ${e.message}")
            DiagnosticLog.fault("[SegmentDispatcher] S3 upload exception: ${e.message}")
            false
        }
    }
    
    private suspend fun confirmBatchComplete(batchId: String, upload: PendingUpload): Boolean {
        val urlPath = if (upload.contentType == "events") "/api/ingest/batch/complete" else "/api/ingest/segment/complete"
        val url = "$endpoint$urlPath"
        
        val body = JSONObject().apply {
            put("actualSizeBytes", upload.payload.size)
            put("timestamp", System.currentTimeMillis())
            
            if (upload.contentType == "events") {
                put("batchId", batchId)
                put("eventCount", upload.itemCount)
            } else {
                put("segmentId", batchId)
                put("frameCount", upload.itemCount)
            }
        }
        
        val request = buildRequest(url, body)
        
        return try {
            val response = httpClient.newCall(request).execute()
            response.code == 200
        } catch (e: Exception) {
            false
        }
    }
    
    private suspend fun executeEventBatchUpload(
        sessionId: String,
        payload: ByteArray,
        batchNum: Int,
        eventCount: Int,
        completion: ((Boolean) -> Unit)?
    ) {
        val upload = PendingUpload(
            sessionId = sessionId,
            contentType = "events",
            payload = payload,
            rangeStart = 0,
            rangeEnd = 0,
            itemCount = eventCount,
            attempt = 0
        )
        
        val presignResponse = requestPresignedUrl(upload)
        if (presignResponse == null) {
            DiagnosticLog.notice("[SegmentDispatcher] ❌ requestPresignedUrl FAILED for ${upload.contentType}")
            DiagnosticLog.caution("[SegmentDispatcher] requestPresignedUrl FAILED for ${upload.contentType}")
            registerFailure()
            scheduleRetryIfNeeded(upload, completion)
            return
        }
        
        val s3ok = uploadToS3(presignResponse.presignedUrl, upload.payload, upload.contentType)
        if (!s3ok) {
            DiagnosticLog.notice("[SegmentDispatcher] ❌ uploadToS3 FAILED for ${upload.contentType}")
            DiagnosticLog.caution("[SegmentDispatcher] uploadToS3 FAILED for ${upload.contentType}")
            registerFailure()
            scheduleRetryIfNeeded(upload, completion)
            return
        }
        
        val confirmOk = confirmBatchComplete(presignResponse.batchId, upload)
        if (confirmOk) {
            registerSuccess()
        } else {
            DiagnosticLog.caution("[SegmentDispatcher] confirmBatchComplete FAILED for ${upload.contentType} (batchId=${presignResponse.batchId})")
            registerFailure()
        }
        completion?.invoke(confirmOk)
    }
    
    private fun buildRequest(url: String, body: JSONObject): Request {
        // Log auth state before building request
        DiagnosticLog.notice("[SegmentDispatcher] buildRequest: apiToken=${apiToken?.take(15) ?: "NULL"}, credential=${credential?.take(15) ?: "NULL"}, replayId=${currentReplayId?.take(20) ?: "NULL"}")
        
        val requestBody = body.toString().toRequestBody("application/json".toMediaType())
        
        val request = Request.Builder()
            .url(url)
            .post(requestBody)
            .header("Content-Type", "application/json")
            .apply {
                apiToken?.let { 
                    header("x-rejourney-key", it)
                } ?: DiagnosticLog.fault("[SegmentDispatcher] ⚠️ apiToken is NULL - auth will fail!")
                credential?.let { header("x-upload-token", it) }
                currentReplayId?.let { header("x-session-id", it) }
            }
            .build()
            
        DiagnosticLog.debugNetworkRequest("POST", url, request.headers.toMultimap().mapValues { it.value.first() })
        return request
    }
}

private data class PendingUpload(
    val sessionId: String,
    val contentType: String,
    val payload: ByteArray,
    val rangeStart: Long,
    val rangeEnd: Long,
    val itemCount: Int,
    val attempt: Int
)

private data class PresignResponse(
    val presignedUrl: String,
    val batchId: String
)
