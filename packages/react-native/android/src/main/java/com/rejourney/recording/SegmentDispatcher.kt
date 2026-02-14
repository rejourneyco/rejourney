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
    var isSampledIn: Boolean = true  // SDK's sampling decision for server-side enforcement
    
    private var batchSeqNumber = 0
    private var billingBlocked = false
    private var consecutiveFailures = 0
    private var circuitOpen = false
    private var circuitOpenTime: Long = 0
    private val circuitBreakerThreshold = 5
    private val circuitResetTime: Long = 60_000 // 60 seconds
    
    // Per-session SDK telemetry counters
    private val metricsLock = ReentrantLock()
    private var _uploadSuccessCount = 0
    private var _uploadFailureCount = 0
    private var _retryAttemptCount = 0
    private var _circuitBreakerOpenCount = 0
    private var _memoryEvictionCount = 0
    private var _offlinePersistCount = 0
    private var _sessionStartCount = 0
    private var _crashCount = 0
    private var _totalBytesUploaded = 0L
    private var _totalBytesEvicted = 0L
    private var _totalUploadDurationMs = 0.0
    private var _uploadDurationSampleCount = 0
    private var _lastUploadTime: Long? = null
    private var _lastRetryTime: Long? = null
    
    val uploadSuccessCount: Int
        get() = metricsLock.withLock { _uploadSuccessCount }
    
    val uploadFailureCount: Int
        get() = metricsLock.withLock { _uploadFailureCount }
    
    val retryAttemptCount: Int
        get() = metricsLock.withLock { _retryAttemptCount }
    
    val circuitBreakerOpenCount: Int
        get() = metricsLock.withLock { _circuitBreakerOpenCount }
    
    val memoryEvictionCount: Int
        get() = metricsLock.withLock { _memoryEvictionCount }
    
    val offlinePersistCount: Int
        get() = metricsLock.withLock { _offlinePersistCount }
    
    val sessionStartCount: Int
        get() = metricsLock.withLock { _sessionStartCount }
    
    val crashCount: Int
        get() = metricsLock.withLock { _crashCount }
    
    val avgUploadDurationMs: Double
        get() = metricsLock.withLock {
            if (_uploadDurationSampleCount > 0) {
                _totalUploadDurationMs / _uploadDurationSampleCount.toDouble()
            } else {
                0.0
            }
        }
    
    val lastUploadTime: Long?
        get() = metricsLock.withLock { _lastUploadTime }
    
    val lastRetryTime: Long?
        get() = metricsLock.withLock { _lastRetryTime }
    
    val totalBytesUploaded: Long
        get() = metricsLock.withLock { _totalBytesUploaded }
    
    val totalBytesEvicted: Long
        get() = metricsLock.withLock { _totalBytesEvicted }
    
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
    
    fun configure(replayId: String, apiToken: String?, credential: String?, projectId: String?, isSampledIn: Boolean = true) {
        currentReplayId = replayId
        this.apiToken = apiToken
        this.credential = credential
        this.projectId = projectId
        this.isSampledIn = isSampledIn
        batchSeqNumber = 0
        billingBlocked = false
        consecutiveFailures = 0
        resetSessionTelemetry()
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
        currentQueueDepth: Int = 0,
        completion: (Boolean) -> Unit
    ) {
        val url = "$endpoint/api/ingest/session/end"
        ingestFinalizeMetrics(metrics)
        
        val body = JSONObject().apply {
            put("sessionId", replayId)
            put("endedAt", concludedAt)
            if (backgroundDurationMs > 0) put("totalBackgroundTimeMs", backgroundDurationMs)
            metrics?.let { put("metrics", JSONObject(it)) }
            put("sdkTelemetry", buildSdkTelemetry(currentQueueDepth))
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
    
    @Synchronized
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
    
    @Synchronized
    private fun registerFailure() {
        consecutiveFailures++
        metricsLock.withLock {
            _uploadFailureCount++
        }
        if (consecutiveFailures >= circuitBreakerThreshold) {
            if (!circuitOpen) {
                metricsLock.withLock {
                    _circuitBreakerOpenCount++
                }
            }
            circuitOpen = true
            circuitOpenTime = System.currentTimeMillis()
        }
    }
    
    @Synchronized
    private fun registerSuccess() {
        consecutiveFailures = 0
        metricsLock.withLock {
            _uploadSuccessCount++
            _lastUploadTime = System.currentTimeMillis()
        }
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
        
        val s3ok = uploadToS3(presignResponse.presignedUrl, upload.payload)
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
            metricsLock.withLock {
                _retryAttemptCount++
                _lastRetryTime = System.currentTimeMillis()
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
                put("batchNumber", upload.batchNumber)
                put("isSampledIn", isSampledIn)  // Server-side enforcement
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
    
    private suspend fun uploadToS3(url: String, payload: ByteArray): Boolean {
        val mediaType = "application/gzip".toMediaType()
        
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
                recordUploadStats(durationMs, true, payload.size.toLong())
                true
            } else {
                recordUploadStats(durationMs, false, payload.size.toLong())
                false
            }
        } catch (e: Exception) {
            DiagnosticLog.notice("[SegmentDispatcher] ❌ S3 upload exception: ${e.message}")
            DiagnosticLog.fault("[SegmentDispatcher] S3 upload exception: ${e.message}")
            recordUploadStats((System.currentTimeMillis() - startTime).toDouble(), false, payload.size.toLong())
            false
        }
    }
    
    private suspend fun confirmBatchComplete(batchId: String, upload: PendingUpload): Boolean {
        val urlPath = if (upload.contentType == "events") "/api/ingest/batch/complete" else "/api/ingest/segment/complete"
        val url = "$endpoint$urlPath"
        
        val body = JSONObject().apply {
            put("actualSizeBytes", upload.payload.size)
            put("timestamp", System.currentTimeMillis())
            put("sdkTelemetry", buildSdkTelemetry(0))
            
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
            attempt = 0,
            batchNumber = batchNum
        )
        
        val presignResponse = requestPresignedUrl(upload)
        if (presignResponse == null) {
            DiagnosticLog.notice("[SegmentDispatcher] ❌ requestPresignedUrl FAILED for ${upload.contentType}")
            DiagnosticLog.caution("[SegmentDispatcher] requestPresignedUrl FAILED for ${upload.contentType}")
            registerFailure()
            scheduleRetryIfNeeded(upload, completion)
            return
        }
        
        val s3ok = uploadToS3(presignResponse.presignedUrl, upload.payload)
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
    
    private fun ingestFinalizeMetrics(metrics: Map<String, Any>?) {
        val crashes = (metrics?.get("crashCount") as? Number)?.toInt() ?: return
        metricsLock.withLock {
            _crashCount = maxOf(_crashCount, crashes)
        }
    }
    
    private fun resetSessionTelemetry() {
        metricsLock.withLock {
            _uploadSuccessCount = 0
            _uploadFailureCount = 0
            _retryAttemptCount = 0
            _circuitBreakerOpenCount = 0
            _memoryEvictionCount = 0
            _offlinePersistCount = 0
            _sessionStartCount = 1
            _crashCount = 0
            _totalBytesUploaded = 0L
            _totalBytesEvicted = 0L
            _totalUploadDurationMs = 0.0
            _uploadDurationSampleCount = 0
            _lastUploadTime = null
            _lastRetryTime = null
        }
    }
    
    private fun recordUploadStats(durationMs: Double, success: Boolean, bytes: Long) {
        metricsLock.withLock {
            _uploadDurationSampleCount++
            _totalUploadDurationMs += durationMs
            if (success) {
                _totalBytesUploaded += bytes
            }
        }
    }
    
    private fun buildSdkTelemetry(currentQueueDepth: Int): JSONObject {
        val retryDepth = retryLock.withLock { retryQueue.size }
        
        val (
            successCount,
            failureCount,
            retryCount,
            breakerOpenCount,
            memoryEvictions,
            offlinePersists,
            starts,
            crashes,
            avgDurationMs,
            lastUpload,
            lastRetry,
            uploadedBytes,
            evictedBytes,
        ) = metricsLock.withLock {
            val avg = if (_uploadDurationSampleCount > 0) {
                _totalUploadDurationMs / _uploadDurationSampleCount.toDouble()
            } else {
                0.0
            }
            TelemetrySnapshot(
                uploadSuccessCount = _uploadSuccessCount,
                uploadFailureCount = _uploadFailureCount,
                retryAttemptCount = _retryAttemptCount,
                circuitBreakerOpenCount = _circuitBreakerOpenCount,
                memoryEvictionCount = _memoryEvictionCount,
                offlinePersistCount = _offlinePersistCount,
                sessionStartCount = _sessionStartCount,
                crashCount = _crashCount,
                avgUploadDurationMs = avg,
                lastUploadTime = _lastUploadTime,
                lastRetryTime = _lastRetryTime,
                totalBytesUploaded = _totalBytesUploaded,
                totalBytesEvicted = _totalBytesEvicted,
            )
        }
        
        val totalUploads = successCount + failureCount
        val successRate = if (totalUploads > 0) successCount.toDouble() / totalUploads.toDouble() else 1.0
        
        return JSONObject().apply {
            put("uploadSuccessCount", successCount)
            put("uploadFailureCount", failureCount)
            put("retryAttemptCount", retryCount)
            put("circuitBreakerOpenCount", breakerOpenCount)
            put("memoryEvictionCount", memoryEvictions)
            put("offlinePersistCount", offlinePersists)
            put("sessionStartCount", starts)
            put("crashCount", crashes)
            put("uploadSuccessRate", successRate)
            put("avgUploadDurationMs", avgDurationMs)
            put("currentQueueDepth", currentQueueDepth + retryDepth)
            put("lastUploadTime", lastUpload ?: JSONObject.NULL)
            put("lastRetryTime", lastRetry ?: JSONObject.NULL)
            put("totalBytesUploaded", uploadedBytes)
            put("totalBytesEvicted", evictedBytes)
        }
    }
    
    fun sdkTelemetrySnapshot(currentQueueDepth: Int = 0): Map<String, Any?> {
        val payload = buildSdkTelemetry(currentQueueDepth)
        return mapOf(
            "uploadSuccessCount" to payload.optInt("uploadSuccessCount", 0),
            "uploadFailureCount" to payload.optInt("uploadFailureCount", 0),
            "retryAttemptCount" to payload.optInt("retryAttemptCount", 0),
            "circuitBreakerOpenCount" to payload.optInt("circuitBreakerOpenCount", 0),
            "memoryEvictionCount" to payload.optInt("memoryEvictionCount", 0),
            "offlinePersistCount" to payload.optInt("offlinePersistCount", 0),
            "sessionStartCount" to payload.optInt("sessionStartCount", 0),
            "crashCount" to payload.optInt("crashCount", 0),
            "uploadSuccessRate" to payload.optDouble("uploadSuccessRate", 1.0),
            "avgUploadDurationMs" to payload.optDouble("avgUploadDurationMs", 0.0),
            "currentQueueDepth" to payload.optInt("currentQueueDepth", 0),
            "lastUploadTime" to (payload.opt("lastUploadTime").takeUnless { it == JSONObject.NULL } as? Number)?.toLong(),
            "lastRetryTime" to (payload.opt("lastRetryTime").takeUnless { it == JSONObject.NULL } as? Number)?.toLong(),
            "totalBytesUploaded" to payload.optLong("totalBytesUploaded", 0),
            "totalBytesEvicted" to payload.optLong("totalBytesEvicted", 0),
        )
    }
}

private data class PendingUpload(
    val sessionId: String,
    val contentType: String,
    val payload: ByteArray,
    val rangeStart: Long,
    val rangeEnd: Long,
    val itemCount: Int,
    val attempt: Int,
    val batchNumber: Int = 0
)

private data class PresignResponse(
    val presignedUrl: String,
    val batchId: String
)

private data class TelemetrySnapshot(
    val uploadSuccessCount: Int,
    val uploadFailureCount: Int,
    val retryAttemptCount: Int,
    val circuitBreakerOpenCount: Int,
    val memoryEvictionCount: Int,
    val offlinePersistCount: Int,
    val sessionStartCount: Int,
    val crashCount: Int,
    val avgUploadDurationMs: Double,
    val lastUploadTime: Long?,
    val lastRetryTime: Long?,
    val totalBytesUploaded: Long,
    val totalBytesEvicted: Long,
)
