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
import android.util.Base64
import com.rejourney.RejourneySdkInfo
import com.rejourney.engine.DiagnosticLog
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
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
    /** When false, the backend is instructed to skip IP geolocation lookup for this session */
    var collectGeoLocation: Boolean = true
    /** When true, signals the backend that no visual artifacts will ever arrive for this session */
    var observeOnly: Boolean = false

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
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        // Intentionally NO RejourneyNetworkInterceptor here: intercepting our
        // own upload traffic creates redundant network events, wastes bandwidth,
        // and can cause circular upload→intercept→upload chains.
        .build()

    private val retryQueue = mutableListOf<PendingUpload>()
    private val retryLock = ReentrantLock()
    private val maxRetryQueueSize = 64
    private val maxPersistedRetryBytes = 32L * 1024L * 1024L
    private val persistenceLock = ReentrantLock()
    private var retryDirectory: File? = null
    private val persistedUploadKeys = mutableSetOf<String>()
    private val persistedUploadSizes = mutableMapOf<String, Long>()
    private var persistedUploadBytes = 0L
    @Volatile
    private var active = true

    // Tracks coroutines with in-flight uploads so awaitPendingUploads() can block
    // until all network calls complete before the shutdown drain finishes.
    private val pendingUploadsCount = AtomicInteger(0)

    fun configurePersistence(context: Context) {
        persistenceLock.withLock {
            if (retryDirectory != null) return
            retryDirectory = File(context.filesDir, "rejourney_upload_retry").also { it.mkdirs() }
            loadPersistedRetriesLocked()
        }
    }

    @Synchronized
    fun configure(replayId: String, apiToken: String?, credential: String?, projectId: String?, isSampledIn: Boolean = true) {
        currentReplayId = replayId
        this.apiToken = apiToken
        this.credential = credential
        this.projectId = projectId
        this.isSampledIn = isSampledIn
        batchSeqNumber = 0
        billingBlocked = false
        consecutiveFailures = 0
        circuitOpen = false
        circuitOpenTime = 0
        active = true
        resetSessionTelemetry()
        // Each pending upload carries its original session ID. Preserve and
        // drain it across an in-process session rollover instead of discarding
        // valid offline work when the next session starts.
        shipPending()
    }

    @Synchronized
    fun activate() {
        active = true
        consecutiveFailures = 0
        circuitOpen = false
    }

    @Synchronized
    fun halt() {
        active = false
    }

    fun shipPending() {
        scope.launch {
            drainRetryQueue()
        }
    }

    /**
     * Blocks the calling thread until all in-flight upload coroutines complete,
     * or until [timeoutMs] milliseconds elapse. Called by TelemetryPipeline during
     * shutdown to ensure frames are delivered before the process is killed.
     */
    fun awaitPendingUploads(timeoutMs: Long = 10_000): Boolean {
        // Pull queued retries into tracked coroutines before checking the
        // counter; otherwise a fire-and-forget shipPending() can race this
        // method and make shutdown believe there is nothing left to upload.
        drainRetryQueue()
        val deadline = System.currentTimeMillis() + timeoutMs
        while (pendingUploadsCount.get() > 0 && System.currentTimeMillis() < deadline) {
            Thread.sleep(100)
        }
        return pendingUploadsCount.get() == 0
    }

    fun transmitFrameBundle(
        payload: ByteArray,
        startMs: Long,
        endMs: Long,
        frameCount: Int,
        completion: ((Boolean) -> Unit)? = null
    ) {
        transmitFrameBundleForSession(currentReplayId, payload, startMs, endMs, frameCount, completion)
    }

    fun transmitFrameBundleForSession(
        sessionId: String?,
        payload: ByteArray,
        startMs: Long,
        endMs: Long,
        frameCount: Int,
        completion: ((Boolean) -> Unit)? = null
    ) {
        val sid = sessionId
        DiagnosticLog.trace("[SegmentDispatcher] transmitFrameBundle: sid=${sid?.take(12) ?: "null"}, frames=$frameCount, bytes=${payload.size}")

        if (sid != null) {
            DiagnosticLog.debugPresignRequest(endpoint, sid, "screenshots", payload.size)
        }

        if (sid == null) {
            DiagnosticLog.trace("[SegmentDispatcher] transmitFrameBundle: rejected - missing session")
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
            attempt = 0,
            isSampledIn = isSampledIn
        )
        scheduleUpload(upload, completion)
    }

    fun transmitHierarchy(
        replayId: String,
        hierarchyPayload: ByteArray,
        timestampMs: Long,
        completion: ((Boolean) -> Unit)? = null
    ) {
        val upload = PendingUpload(
            sessionId = replayId,
            contentType = "hierarchy",
            payload = hierarchyPayload,
            rangeStart = timestampMs,
            rangeEnd = timestampMs,
            itemCount = 1,
            attempt = 0,
            isSampledIn = isSampledIn
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
        if (sid == null) {
            completion?.invoke(false)
            return
        }

        scheduleUpload(
            PendingUpload(
                sessionId = sid,
                contentType = "events",
                payload = payload,
                rangeStart = 0,
                rangeEnd = 0,
                itemCount = eventCount,
                attempt = 0,
                batchNumber = batchNumber,
                isSampledIn = isSampledIn
            ),
            completion
        )
    }

    fun transmitEventBatchAlternate(
        replayId: String,
        eventPayload: ByteArray,
        eventCount: Int,
        completion: ((Boolean) -> Unit)? = null
    ) {
        batchSeqNumber++
        val seq = batchSeqNumber

        scheduleUpload(
            PendingUpload(
                sessionId = replayId,
                contentType = "events",
                payload = eventPayload,
                rangeStart = 0,
                rangeEnd = 0,
                itemCount = eventCount,
                attempt = 0,
                batchNumber = seq,
                isSampledIn = isSampledIn
            ),
            completion
        )
    }

    fun concludeReplay(
        replayId: String,
        concludedAt: Long,
        backgroundDurationMs: Long,
        metrics: Map<String, Any>?,
        currentQueueDepth: Int = 0,
        endReason: String? = null,
        lifecycleVersion: Int? = null,
        closeAnchorAtMs: Long? = null,
        completion: (Boolean) -> Unit
    ) {
        val url = "$endpoint/api/ingest/session/end"
        ingestFinalizeMetrics(metrics)

        val body = JSONObject().apply {
            put("sessionId", replayId)
            put("endedAt", concludedAt)
            put("sdkVersion", RejourneySdkInfo.sdkVersion)
            put("isSampledIn", isSampledIn)
            if (backgroundDurationMs > 0) put("totalBackgroundTimeMs", backgroundDurationMs)
            metrics?.let { put("metrics", JSONObject(it)) }
            put("sdkTelemetry", buildSdkTelemetry(currentQueueDepth))
            if (!endReason.isNullOrBlank()) put("endReason", endReason)
            if ((lifecycleVersion ?: 0) > 0) put("lifecycleVersion", lifecycleVersion)
            if ((closeAnchorAtMs ?: 0) > 0) put("closeAnchorAtMs", closeAnchorAtMs)
        }

        val request = buildRequest(url, body, replayId)

        scope.launch {
            try {
                // Every response here goes through use{}, which closes the body.
                // Reading only response.code closes nothing, and an unclosed body
                // holds its connection until the pool evicts it -- OkHttp reports
                // those as leaked connections. use{} is inline over try/finally,
                // so the non-local returns further down still close the response.
                httpClient.newCall(request).execute().use { response ->
                    completion(response.code == 200)
                }
            } catch (e: Exception) {
                completion(false)
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

    @Synchronized
    private fun markBillingBlocked() {
        billingBlocked = true
    }

    private fun scheduleUpload(upload: PendingUpload, completion: ((Boolean) -> Unit)?) {
        DiagnosticLog.trace("[SegmentDispatcher] scheduleUpload: active=$active, type=${upload.contentType}, items=${upload.itemCount}")
        if (!active) {
            DiagnosticLog.trace("[SegmentDispatcher] scheduleUpload: rejected - not active")
            completion?.invoke(false)
            return
        }
        pendingUploadsCount.incrementAndGet()
        scope.launch {
            try {
                persistUpload(upload)
                executeSegmentUpload(upload, completion)
            } finally {
                pendingUploadsCount.decrementAndGet()
            }
        }
    }

    private suspend fun executeSegmentUpload(upload: PendingUpload, completion: ((Boolean) -> Unit)?) {
        if (!canUploadNow()) {
            deferUploadWithoutAttempt(upload, completion)
            return
        }
        val presignResponse = requestPresignedUrl(upload)
        if (presignResponse == null) {
            DiagnosticLog.caution("[SegmentDispatcher] requestPresignedUrl FAILED for ${upload.contentType}")
            registerFailure()
            scheduleRetryIfNeeded(upload, completion)
            return
        }

        if (presignResponse.skipUpload) {
            registerSuccess()
            removePersistedUpload(upload)
            completion?.invoke(true)
            return
        }

        val s3ok = uploadToS3(presignResponse.presignedUrl, upload.payload)
        if (!s3ok) {
            DiagnosticLog.caution("[SegmentDispatcher] uploadToS3 FAILED for ${upload.contentType}")
            registerFailure()
            scheduleRetryIfNeeded(upload, completion)
            return
        }

        val confirmOk = confirmBatchComplete(presignResponse.batchId, upload)
        if (confirmOk) {
            registerSuccess()
            removePersistedUpload(upload)
        } else {
            DiagnosticLog.caution("[SegmentDispatcher] confirmBatchComplete FAILED for ${upload.contentType}")
            registerFailure()
            scheduleRetryIfNeeded(upload, completion)
            return
        }
        completion?.invoke(confirmOk)
    }

    private fun scheduleRetryIfNeeded(upload: PendingUpload, completion: ((Boolean) -> Unit)?) {
        if (upload.attempt < 3) {
            val retry = upload.copy(attempt = upload.attempt + 1)
            val persisted = persistUpload(retry)
            var evicted: PendingUpload? = null
            retryLock.withLock {
                if (retryQueue.size >= maxRetryQueueSize) {
                    evicted = retryQueue.removeAt(0)
                }
                retryQueue.add(retry)
            }
            evicted?.let {
                removePersistedUpload(it)
                metricsLock.withLock {
                    _memoryEvictionCount++
                    _totalBytesEvicted += it.payload.size
                }
            }
            metricsLock.withLock {
                _retryAttemptCount++
                if (persisted) _offlinePersistCount++
                _lastRetryTime = System.currentTimeMillis()
            }
            // Ownership transfers to the bounded retry queue; callers should
            // not retain a duplicate in their own in-memory buffers.
            completion?.invoke(true)
            return
        }
        removePersistedUpload(upload)
        completion?.invoke(false)
    }

    private fun deferUploadWithoutAttempt(upload: PendingUpload, completion: ((Boolean) -> Unit)?) {
        val persisted = persistUpload(upload)
        var evicted: PendingUpload? = null
        val acceptedInMemory = retryLock.withLock {
            if (retryQueue.none { it.persistenceKey == upload.persistenceKey }) {
                if (retryQueue.size >= maxRetryQueueSize) {
                    evicted = retryQueue.removeAt(0)
                }
                retryQueue.add(upload)
            }
            retryQueue.any { it.persistenceKey == upload.persistenceKey }
        }
        evicted?.let {
            removePersistedUpload(it)
            metricsLock.withLock {
                _memoryEvictionCount++
                _totalBytesEvicted += it.payload.size
            }
        }
        completion?.invoke(persisted || acceptedInMemory)
    }

    private fun drainRetryQueue() {
        val items = retryLock.withLock {
            val copy = retryQueue.toList()
            retryQueue.clear()
            copy
        }
        items.forEach {
            pendingUploadsCount.incrementAndGet()
            scope.launch {
                try {
                    executeSegmentUpload(it, null)
                } finally {
                    pendingUploadsCount.decrementAndGet()
                }
            }
        }
    }

    private fun persistUpload(upload: PendingUpload): Boolean = persistenceLock.withLock {
        val directory = retryDirectory ?: return false
        val file = File(directory, "${upload.persistenceKey}.json")
        val payload = JSONObject().apply {
            put("persistenceKey", upload.persistenceKey)
            put("sessionId", upload.sessionId)
            put("contentType", upload.contentType)
            put("payload", Base64.encodeToString(upload.payload, Base64.NO_WRAP))
            put("rangeStart", upload.rangeStart)
            put("rangeEnd", upload.rangeEnd)
            put("itemCount", upload.itemCount)
            put("attempt", upload.attempt)
            put("batchNumber", upload.batchNumber)
            put("isSampledIn", upload.isSampledIn)
        }.toString().toByteArray(Charsets.UTF_8)

        return try {
            val atomicFile = AtomicFile(file)
            val stream = atomicFile.startWrite()
            try {
                stream.write(payload)
                atomicFile.finishWrite(stream)
            } catch (error: Exception) {
                atomicFile.failWrite(stream)
                throw error
            }
            persistedUploadKeys.add(upload.persistenceKey)
            val previousSize = persistedUploadSizes.put(upload.persistenceKey, file.length()) ?: 0L
            persistedUploadBytes = (persistedUploadBytes - previousSize + file.length()).coerceAtLeast(0L)
            if (persistedUploadKeys.size > maxRetryQueueSize || persistedUploadBytes > maxPersistedRetryBytes) {
                trimPersistedRetriesLocked(directory)
            }
            true
        } catch (error: Exception) {
            DiagnosticLog.caution("[SegmentDispatcher] Could not persist upload retry: ${error.message}")
            false
        }
    }

    private fun removePersistedUpload(upload: PendingUpload) {
        persistenceLock.withLock {
            val directory = retryDirectory ?: return@withLock
            val file = File(directory, "${upload.persistenceKey}.json")
            val removedSize = persistedUploadSizes.remove(upload.persistenceKey) ?: file.length()
            try { AtomicFile(file).delete() } catch (_: Exception) { }
            persistedUploadKeys.remove(upload.persistenceKey)
            persistedUploadBytes = (persistedUploadBytes - removedSize).coerceAtLeast(0L)
        }
    }

    private fun loadPersistedRetriesLocked() {
        val directory = retryDirectory ?: return
        val uploads = retryBaseFiles(directory)
            ?.asSequence()
            ?.sortedBy { it.lastModified() }
            ?.mapNotNull { file ->
                try {
                    val json = JSONObject(AtomicFile(file).openRead().bufferedReader().use { it.readText() })
                    val upload = PendingUpload(
                        persistenceKey = json.getString("persistenceKey"),
                        sessionId = json.getString("sessionId"),
                        contentType = json.getString("contentType"),
                        payload = Base64.decode(json.getString("payload"), Base64.DEFAULT),
                        rangeStart = json.getLong("rangeStart"),
                        rangeEnd = json.getLong("rangeEnd"),
                        itemCount = json.getInt("itemCount"),
                        attempt = json.getInt("attempt"),
                        batchNumber = json.optInt("batchNumber", 0),
                        isSampledIn = json.optBoolean("isSampledIn", true)
                    )
                    val recoveredFile = File(directory, "${upload.persistenceKey}.json")
                    upload to (recoveredFile.length().takeIf { it > 0L } ?: file.length())
                } catch (_: Exception) {
                    try { AtomicFile(file).delete() } catch (_: Exception) { }
                    null
                }
            }
            ?.toList()
            .orEmpty()

        val retained = uploads.takeLast(maxRetryQueueSize)
        retryLock.withLock {
            retryQueue.clear()
            retryQueue.addAll(retained.map { it.first })
        }
        persistedUploadKeys.clear()
        persistedUploadKeys.addAll(retained.map { it.first.persistenceKey })
        persistedUploadSizes.clear()
        retained.forEach { (upload, size) -> persistedUploadSizes[upload.persistenceKey] = size }
        persistedUploadBytes = retained.sumOf { it.second }
        if (uploads.size > maxRetryQueueSize || persistedUploadBytes > maxPersistedRetryBytes) {
            trimPersistedRetriesLocked(directory)
            val retainedKeys = persistedUploadKeys.toSet()
            retryLock.withLock {
                retryQueue.removeAll { it.persistenceKey !in retainedKeys }
            }
        }
    }

    private fun trimPersistedRetriesLocked(directory: File) {
        val files = retryBaseFiles(directory)
            ?.sortedBy { it.lastModified() }
            .orEmpty()
        var retainedCount = files.size
        var retainedBytes = files.sumOf { it.length() }
        val removedKeys = mutableSetOf<String>()
        for (file in files) {
            if (retainedCount <= maxRetryQueueSize && retainedBytes <= maxPersistedRetryBytes) break
            val size = file.length()
            try { AtomicFile(file).delete() } catch (_: Exception) { }
            val key = file.nameWithoutExtension
            removedKeys.add(key)
            persistedUploadKeys.remove(key)
            persistedUploadSizes.remove(key)
            retainedCount -= 1
            retainedBytes = (retainedBytes - size).coerceAtLeast(0L)
        }
        persistedUploadBytes = retainedBytes
        if (removedKeys.isNotEmpty()) {
            val evicted = retryLock.withLock {
                val removed = retryQueue.filter { it.persistenceKey in removedKeys }
                retryQueue.removeAll(removed.toSet())
                removed
            }
            if (evicted.isNotEmpty()) {
                metricsLock.withLock {
                    _memoryEvictionCount += evicted.size
                    _totalBytesEvicted += evicted.sumOf { it.payload.size.toLong() }
                }
            }
        }
    }

    /**
     * AtomicFile may leave only the .bak side of a transaction after process
     * death. Feed the base path back to AtomicFile so openRead() can recover it.
     */
    private fun retryBaseFiles(directory: File): List<File>? = directory.listFiles()
        ?.asSequence()
        ?.filter { it.isFile && (it.name.endsWith(".json") || it.name.endsWith(".json.bak")) }
        ?.map { file ->
            if (file.name.endsWith(".bak")) File(directory, file.name.removeSuffix(".bak")) else file
        }
        ?.distinctBy { it.absolutePath }
        ?.toList()

    private suspend fun requestPresignedUrl(upload: PendingUpload): PresignResponse? {
        val urlPath = if (upload.contentType == "events") "/api/ingest/presign" else "/api/ingest/segment/presign"
        val url = "$endpoint$urlPath"

        val body = JSONObject().apply {
            put("sessionId", upload.sessionId)
            put("sizeBytes", upload.payload.size)
            put("sdkVersion", RejourneySdkInfo.sdkVersion)
            put("isSampledIn", upload.isSampledIn)

            if (upload.contentType == "events") {
                put("contentType", "events")
                put("batchNumber", upload.batchNumber)
            } else {
                put("kind", upload.contentType)
                put("startTime", upload.rangeStart)
                put("endTime", upload.rangeEnd)
                put("frameCount", upload.itemCount)
                put("compression", "gzip")
            }
        }

        val request = buildRequest(url, body, upload.sessionId)
        val startTime = System.currentTimeMillis()

        return try {
            httpClient.newCall(request).execute().use { response ->
                val durationMs = (System.currentTimeMillis() - startTime).toDouble()
                val responseBody = response.body?.string()

                DiagnosticLog.debugPresignResponse(response.code, null, null, durationMs)

                if (response.code == 402) {
                    DiagnosticLog.caution("[SegmentDispatcher] presign: 402 Payment Required - billing blocked")
                    markBillingBlocked()
                    return null
                }

                if (response.code != 200 || responseBody == null) {
                    val bodyPreview = responseBody?.take(300) ?: "null"
                    DiagnosticLog.caution("[SegmentDispatcher] presign failed: status=${response.code} body=$bodyPreview")
                    return null
                }

                val json = JSONObject(responseBody)

                if (json.optBoolean("skipUpload", false)) {
                    return PresignResponse(skipUpload = true)
                }

                val presignedUrl =
                    json.optString("presignedUrl", "").takeIf { it.isNotBlank() }
                        ?: return null
                val batchId = json.optString("batchId", "").takeIf { it.isNotBlank() }
                    ?: json.optString("segmentId", "")

                DiagnosticLog.debugPresignResponse(response.code, batchId, presignedUrl, durationMs)
                PresignResponse(presignedUrl, batchId)
            }
        } catch (e: Exception) {
            val durationMs = (System.currentTimeMillis() - startTime).toDouble()
            DiagnosticLog.trace("[SegmentDispatcher] presign exception (${durationMs.toLong()}ms): ${e.javaClass.simpleName}: ${e.message}")
            DiagnosticLog.fault("[SegmentDispatcher] presign exception: ${e.message}")
            null
        }
    }

    private suspend fun uploadToS3(url: String, payload: ByteArray): Boolean {
        RejourneyNetworkEventFilter.registerInternalUrl(url)
        val mediaType = "application/gzip".toMediaType()

        val request = Request.Builder()
            .url(url)
            .put(payload.toRequestBody(mediaType))
            .header("Content-Type", mediaType.toString())
            .build()

        val startTime = System.currentTimeMillis()
        return try {
            httpClient.newCall(request).execute().use { response ->
                val durationMs = (System.currentTimeMillis() - startTime).toDouble()
                DiagnosticLog.debugUploadComplete("", response.code, durationMs, 0.0)

                if (response.code in 200..299) {
                    recordUploadStats(durationMs, true, payload.size.toLong())
                    true
                } else {
                    recordUploadStats(durationMs, false, payload.size.toLong())
                    false
                }
            }
        } catch (e: Exception) {
            DiagnosticLog.trace("[SegmentDispatcher] S3 upload exception: ${e.message}")
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

        val request = buildRequest(url, body, upload.sessionId)

        return try {
            httpClient.newCall(request).execute().use { response ->
                response.code == 200
            }
        } catch (e: Exception) {
            false
        }
    }

    private fun buildRequest(url: String, body: JSONObject, sessionId: String? = null): Request {
        val requestSessionId = sessionId?.takeIf { it.isNotBlank() } ?: currentReplayId
        // Log auth state before building request
        DiagnosticLog.trace("[SegmentDispatcher] buildRequest: apiToken=${apiToken?.take(15) ?: "NULL"}, credential=${credential?.take(15) ?: "NULL"}, replayId=${requestSessionId?.take(20) ?: "NULL"}")

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
                requestSessionId?.let { header("x-session-id", it) }
                if (!collectGeoLocation) { header("x-rj-no-geo", "1") }
                if (observeOnly) { header("x-rj-observe-only", "1") }
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
    val persistenceKey: String = UUID.randomUUID().toString(),
    val sessionId: String,
    val contentType: String,
    val payload: ByteArray,
    val rangeStart: Long,
    val rangeEnd: Long,
    val itemCount: Int,
    val attempt: Int,
    val batchNumber: Int = 0,
    val isSampledIn: Boolean
)

private data class PresignResponse(
    val presignedUrl: String = "",
    val batchId: String = "",
    val skipUpload: Boolean = false
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
