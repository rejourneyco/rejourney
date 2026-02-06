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

/**
 * SDK telemetry and metrics collection.
 * Android implementation aligned with iOS telemetry.
 */
package com.rejourney.platform

import com.rejourney.engine.DiagnosticLog
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

enum class TelemetryEventType {
    UPLOAD_SUCCESS,
    UPLOAD_FAILURE,
    RETRY_ATTEMPT,
    CIRCUIT_BREAKER_OPEN,
    CIRCUIT_BREAKER_CLOSE,
    MEMORY_PRESSURE_EVICTION,
    OFFLINE_QUEUE_PERSIST,
    OFFLINE_QUEUE_RESTORE,
    SESSION_START,
    SESSION_END,
    CRASH_DETECTED,
    TOKEN_REFRESH
}

data class SDKMetrics(
    val uploadSuccessCount: Int = 0,
    val uploadFailureCount: Int = 0,
    val retryAttemptCount: Int = 0,
    val circuitBreakerOpenCount: Int = 0,
    val memoryEvictionCount: Int = 0,
    val offlinePersistCount: Int = 0,
    val sessionStartCount: Int = 0,
    val crashCount: Int = 0,
    val anrCount: Int = 0,
    val uploadSuccessRate: Float = 1.0f,
    val avgUploadDurationMs: Long = 0,
    val currentQueueDepth: Int = 0,
    val lastUploadTime: Long? = null,
    val lastRetryTime: Long? = null,
    val totalBytesUploaded: Long = 0,
    val totalBytesEvicted: Long = 0
)

class Telemetry private constructor() {

    companion object {
        @Volatile
        private var instance: Telemetry? = null

        fun getInstance(): Telemetry {
            return instance ?: synchronized(this) {
                instance ?: Telemetry().also { instance = it }
            }
        }
    }

    private val lock = ReentrantLock()

    private var uploadSuccessCount = 0
    private var uploadFailureCount = 0
    private var retryAttemptCount = 0
    private var circuitBreakerOpenCount = 0
    private var memoryEvictionCount = 0
    private var offlinePersistCount = 0
    private var sessionStartCount = 0
    private var crashCount = 0
    private var anrCount = 0
    private var uploadSuccessRate = 1.0
    private var avgUploadDurationMs = 0.0
    private var currentQueueDepth = 0
    private var lastUploadTime: Long? = null
    private var lastRetryTime: Long? = null

    private var totalUploadCount = 0
    private var totalUploadDurationMs = 0L
    private var totalBytesUploaded = 0L
    private var totalBytesEvicted = 0L

    fun recordEvent(eventType: TelemetryEventType, metadata: Map<String, Any?>? = null) {
        lock.withLock {
            when (eventType) {
                TelemetryEventType.UPLOAD_SUCCESS -> {
                    uploadSuccessCount++
                    lastUploadTime = System.currentTimeMillis()
                }
                TelemetryEventType.UPLOAD_FAILURE -> {
                    uploadFailureCount++
                }
                TelemetryEventType.RETRY_ATTEMPT -> {
                    retryAttemptCount++
                    lastRetryTime = System.currentTimeMillis()
                }
                TelemetryEventType.CIRCUIT_BREAKER_OPEN -> {
                    circuitBreakerOpenCount++
                    DiagnosticLog.caution("[Telemetry] Circuit breaker opened (total: $circuitBreakerOpenCount)")
                }
                TelemetryEventType.CIRCUIT_BREAKER_CLOSE -> {
                    DiagnosticLog.trace("[Telemetry] Circuit breaker closed")
                }
                TelemetryEventType.MEMORY_PRESSURE_EVICTION -> {
                    memoryEvictionCount++
                }
                TelemetryEventType.OFFLINE_QUEUE_PERSIST -> {
                    offlinePersistCount++
                    DiagnosticLog.trace("[Telemetry] Offline queue persisted (total: $offlinePersistCount)")
                }
                TelemetryEventType.OFFLINE_QUEUE_RESTORE -> {
                    DiagnosticLog.trace("[Telemetry] Offline queue restored")
                }
                TelemetryEventType.SESSION_START -> {
                    sessionStartCount++
                }
                TelemetryEventType.SESSION_END -> {
                    logCurrentMetricsInternal()
                }
                TelemetryEventType.CRASH_DETECTED -> {
                    crashCount++
                    DiagnosticLog.caution("[Telemetry] Crash detected (total: $crashCount)")
                }
                TelemetryEventType.TOKEN_REFRESH -> {
                    DiagnosticLog.trace("[Telemetry] Token refresh triggered")
                }
            }

            updateSuccessRate()
        }

        if (metadata != null) {
            DiagnosticLog.trace("[Telemetry] Event metadata: $metadata")
        }
    }

    fun recordUploadDuration(durationMs: Long, success: Boolean, byteCount: Long) {
        lock.withLock {
            totalUploadCount++
            totalUploadDurationMs += durationMs
            avgUploadDurationMs = totalUploadDurationMs.toDouble() / totalUploadCount.toDouble()

            if (success) {
                totalBytesUploaded += byteCount
                uploadSuccessCount++
                lastUploadTime = System.currentTimeMillis()
            } else {
                uploadFailureCount++
            }

            updateSuccessRate()
        }
    }

    fun recordFrameEviction(bytesEvicted: Long, frameCount: Int) {
        lock.withLock {
            memoryEvictionCount += frameCount
            totalBytesEvicted += bytesEvicted
            DiagnosticLog.caution(
                "[Telemetry] Memory eviction: $frameCount frames, ${totalBytesEvicted / 1024.0} KB total evicted"
            )
        }
    }

    fun recordQueueDepth(depth: Int) {
        lock.withLock {
            currentQueueDepth = depth
        }
    }

    fun recordANR() {
        lock.withLock {
            anrCount++
            DiagnosticLog.caution("[Telemetry] ANR detected (total: $anrCount)")
        }
    }

    fun currentMetrics(): SDKMetrics {
        return lock.withLock {
            SDKMetrics(
                uploadSuccessCount = uploadSuccessCount,
                uploadFailureCount = uploadFailureCount,
                retryAttemptCount = retryAttemptCount,
                circuitBreakerOpenCount = circuitBreakerOpenCount,
                memoryEvictionCount = memoryEvictionCount,
                offlinePersistCount = offlinePersistCount,
                sessionStartCount = sessionStartCount,
                crashCount = crashCount,
                anrCount = anrCount,
                uploadSuccessRate = uploadSuccessRate.toFloat(),
                avgUploadDurationMs = avgUploadDurationMs.toLong(),
                currentQueueDepth = currentQueueDepth,
                lastUploadTime = lastUploadTime,
                lastRetryTime = lastRetryTime,
                totalBytesUploaded = totalBytesUploaded,
                totalBytesEvicted = totalBytesEvicted
            )
        }
    }

    fun metricsAsMap(): Map<String, Any?> {
        val metrics = currentMetrics()
        return mapOf(
            "uploadSuccessCount" to metrics.uploadSuccessCount,
            "uploadFailureCount" to metrics.uploadFailureCount,
            "retryAttemptCount" to metrics.retryAttemptCount,
            "circuitBreakerOpenCount" to metrics.circuitBreakerOpenCount,
            "memoryEvictionCount" to metrics.memoryEvictionCount,
            "offlinePersistCount" to metrics.offlinePersistCount,
            "sessionStartCount" to metrics.sessionStartCount,
            "crashCount" to metrics.crashCount,
            "anrCount" to metrics.anrCount,
            "uploadSuccessRate" to metrics.uploadSuccessRate,
            "avgUploadDurationMs" to metrics.avgUploadDurationMs,
            "currentQueueDepth" to metrics.currentQueueDepth,
            "lastUploadTime" to metrics.lastUploadTime,
            "lastRetryTime" to metrics.lastRetryTime,
            "totalBytesUploaded" to metrics.totalBytesUploaded,
            "totalBytesEvicted" to metrics.totalBytesEvicted
        )
    }

    fun reset() {
        lock.withLock {
            uploadSuccessCount = 0
            uploadFailureCount = 0
            retryAttemptCount = 0
            circuitBreakerOpenCount = 0
            memoryEvictionCount = 0
            offlinePersistCount = 0
            sessionStartCount = 0
            crashCount = 0
            anrCount = 0
            uploadSuccessRate = 1.0
            avgUploadDurationMs = 0.0
            currentQueueDepth = 0
            lastUploadTime = null
            lastRetryTime = null
            totalUploadCount = 0
            totalUploadDurationMs = 0
            totalBytesUploaded = 0
            totalBytesEvicted = 0
        }
    }

    fun logCurrentMetrics() {
        lock.withLock {
            logCurrentMetricsInternal()
        }
    }

    private fun logCurrentMetricsInternal() {
        DiagnosticLog.notice("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        DiagnosticLog.notice(" SDK Telemetry Summary")
        DiagnosticLog.notice(
            "   Uploads: $uploadSuccessCount success, $uploadFailureCount failed (${uploadSuccessRate * 100}% success rate)"
        )
        DiagnosticLog.notice("   Avg upload latency: ${"%.1f".format(avgUploadDurationMs)} ms")
        DiagnosticLog.notice("   Retries: $retryAttemptCount attempts")
        DiagnosticLog.notice("   Circuit breaker opens: $circuitBreakerOpenCount")
        DiagnosticLog.notice(
            "   Memory evictions: $memoryEvictionCount frames (${totalBytesEvicted / 1024.0} KB)"
        )
        DiagnosticLog.notice("   Offline persists: $offlinePersistCount")
        DiagnosticLog.notice("   Data uploaded: ${totalBytesUploaded / 1024.0} KB")
        DiagnosticLog.notice("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    }

    private fun updateSuccessRate() {
        val total = uploadSuccessCount + uploadFailureCount
        uploadSuccessRate = if (total > 0) {
            uploadSuccessCount.toDouble() / total.toDouble()
        } else {
            1.0
        }
    }

    // Convenience methods
    fun recordUploadSuccess(durationMs: Long, bytes: Long = 0) = recordUploadDuration(durationMs, true, bytes)
    fun recordUploadFailure() = recordEvent(TelemetryEventType.UPLOAD_FAILURE)
    fun recordRetryAttempt() = recordEvent(TelemetryEventType.RETRY_ATTEMPT)
    fun recordCircuitBreakerOpen() = recordEvent(TelemetryEventType.CIRCUIT_BREAKER_OPEN)
    fun recordCircuitBreakerClose() = recordEvent(TelemetryEventType.CIRCUIT_BREAKER_CLOSE)
    fun recordOfflinePersist() = recordEvent(TelemetryEventType.OFFLINE_QUEUE_PERSIST)
    fun recordSessionStart() = recordEvent(TelemetryEventType.SESSION_START)
    fun recordCrash() = recordEvent(TelemetryEventType.CRASH_DETECTED)
    fun updateQueueDepth(depth: Int) = recordQueueDepth(depth)
}
