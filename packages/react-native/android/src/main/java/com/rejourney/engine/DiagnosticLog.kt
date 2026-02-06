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

package com.rejourney.engine

import android.os.Debug
import android.os.SystemClock
import android.util.Log
import java.text.SimpleDateFormat
import java.util.*

/**
 * Severity tiers for SDK diagnostic messages
 */
enum class LogLevel(val value: Int) {
    TRACE(0),
    NOTICE(1),
    CAUTION(2),
    FAULT(3)
}

/**
 * Captures point-in-time performance metrics
 */
data class PerformanceSnapshot(
    val wallTimeMs: Double,
    val cpuTimeMs: Double,
    val mainThreadTimeMs: Double,
    val timestamp: Long,
    val isMainThread: Boolean,
    val threadName: String
) {
    companion object {
        fun capture(): PerformanceSnapshot {
            val isMain = Thread.currentThread() == android.os.Looper.getMainLooper().thread
            val threadName = if (isMain) {
                "main"
            } else {
                Thread.currentThread().name.ifEmpty { 
                    "bg-${Thread.currentThread().id.toString(16).takeLast(4)}"
                }
            }
            
            return PerformanceSnapshot(
                wallTimeMs = SystemClock.elapsedRealtime().toDouble(),
                cpuTimeMs = Debug.threadCpuTimeNanos() / 1_000_000.0,
                mainThreadTimeMs = if (isMain) SystemClock.elapsedRealtime().toDouble() else 0.0,
                timestamp = System.currentTimeMillis(),
                isMainThread = isMain,
                threadName = threadName
            )
        }
    }
    
    fun elapsed(since: PerformanceSnapshot): Triple<Double, Double, String> {
        return Triple(
            wallTimeMs - since.wallTimeMs,
            cpuTimeMs - since.cpuTimeMs,
            if (isMainThread) "🟢 MAIN" else "🔵 BG($threadName)"
        )
    }
}

/**
 * Centralized logging facility for SDK diagnostics
 * Android implementation aligned with iOS DiagnosticLog.swift
 */
object DiagnosticLog {
    
    private const val TAG = "RJ"
    
    // Configuration
    @JvmStatic var minimumLevel: Int = 1
    @JvmStatic var includeTimestamp: Boolean = true
    @JvmStatic var detailedOutput: Boolean = false
    @JvmStatic var performanceTracing: Boolean = false
    
    private val dateFormatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US)
    
    // Level-Based Emission
    
    @JvmStatic
    fun emit(level: LogLevel, message: String) {
        if (level.value < minimumLevel) return
        
        val prefix = when (level) {
            LogLevel.TRACE -> "TRACE"
            LogLevel.NOTICE -> "INFO"
            LogLevel.CAUTION -> "WARN"
            LogLevel.FAULT -> "ERROR"
        }
        
        writeLog(prefix, message)
    }
    
    // Convenience Methods
    
    @JvmStatic
    fun trace(message: String) {
        if (minimumLevel > 0) return
        writeLog("VERBOSE", message)
    }
    
    @JvmStatic
    fun notice(message: String) {
        if (minimumLevel > 1) return
        writeLog("INFO", message)
    }
    
    @JvmStatic
    fun caution(message: String) {
        if (minimumLevel > 2) return
        writeLog("WARN", message)
    }
    
    @JvmStatic
    fun fault(message: String) {
        if (minimumLevel > 3) return
        writeLog("ERROR", message)
    }
    
    // Lifecycle Events
    
    @JvmStatic
    fun sdkReady(version: String) {
        notice("[Rejourney] SDK initialized v$version")
    }
    
    @JvmStatic
    fun sdkFailed(reason: String) {
        fault("[Rejourney] Initialization failed: $reason")
    }
    
    @JvmStatic
    fun replayBegan(sessionId: String) {
        notice("[Rejourney] Recording started: $sessionId")
    }
    
    @JvmStatic
    fun replayEnded(sessionId: String) {
        notice("[Rejourney] Recording ended: $sessionId")
    }
    
    // Debug-Only Session Logs
    
    @JvmStatic
    fun debugSessionCreate(phase: String, details: String, perf: PerformanceSnapshot? = null) {
        if (!detailedOutput) return
        var msg = "📍 [SESSION] $phase: $details"
        if (perf != null && performanceTracing) {
            val threadIcon = if (perf.isMainThread) "🟢 MAIN" else "🔵 BG"
            msg += " | $threadIcon wall=${"%.2f".format(perf.wallTimeMs)}ms cpu=${"%.2f".format(perf.cpuTimeMs)}ms"
        }
        writeLog("DEBUG", msg)
    }
    
    @JvmStatic
    fun debugSessionTiming(operation: String, startPerf: PerformanceSnapshot, endPerf: PerformanceSnapshot) {
        if (!detailedOutput || !performanceTracing) return
        val (wall, cpu, thread) = endPerf.elapsed(startPerf)
        writeLog("PERF", "⏱️ [$operation] $thread | wall=${"%.2f".format(wall)}ms cpu=${"%.2f".format(cpu)}ms")
    }
    
    // Enhanced Performance Logging
    
    @JvmStatic
    inline fun perfOperation(name: String, category: String = "OP", block: () -> Unit) {
        if (!detailedOutput || !performanceTracing) {
            block()
            return
        }
        
        val start = PerformanceSnapshot.capture()
        block()
        val end = PerformanceSnapshot.capture()
        val (wall, cpu, thread) = end.elapsed(start)
        
        val warningThreshold = 16.67 // One frame at 60fps
        val icon = when {
            wall > warningThreshold -> "🔴"
            wall > 8 -> "🟡"
            else -> "🟢"
        }
        
        writeLog("PERF", "$icon [$category] $name | $thread | ⏱️ ${"%.2f".format(wall)}ms wall, ${"%.2f".format(cpu)}ms cpu")
    }
    
    @JvmStatic
    fun perfStart(name: String, category: String = "ASYNC"): Long {
        val start = System.currentTimeMillis()
        if (detailedOutput && performanceTracing) {
            val threadInfo = if (Thread.currentThread() == android.os.Looper.getMainLooper().thread) "🟢 MAIN" else "🔵 BG"
            writeLog("PERF", "▶️ [$category] $name started | $threadInfo")
        }
        return start
    }
    
    @JvmStatic
    fun perfEnd(name: String, startTime: Long, category: String = "ASYNC", success: Boolean = true) {
        if (!detailedOutput || !performanceTracing) return
        val elapsed = System.currentTimeMillis() - startTime
        val threadInfo = if (Thread.currentThread() == android.os.Looper.getMainLooper().thread) "🟢 MAIN" else "🔵 BG"
        val icon = if (success) "✅" else "❌"
        
        val warningThreshold = 100.0 // 100ms for async ops
        val timeIcon = when {
            elapsed > warningThreshold -> "🔴"
            elapsed > 50 -> "🟡"
            else -> "🟢"
        }
        
        writeLog("PERF", "$icon [$category] $name finished | $threadInfo | $timeIcon ${elapsed}ms")
    }
    
    @JvmStatic
    fun perfFrame(operation: String, durationMs: Double, frameNumber: Int, isMainThread: Boolean) {
        if (!detailedOutput || !performanceTracing) return
        val threadInfo = if (isMainThread) "🟢 MAIN" else "🔵 BG"
        val budget = 33.33 // 30fps budget
        val icon = when {
            durationMs > budget -> "🔴 DROPPED"
            durationMs > 16.67 -> "🟡 SLOW"
            else -> "🟢 OK"
        }
        
        writeLog("FRAME", "🎬 [$operation] #$frameNumber | $threadInfo | $icon ${"%.2f".format(durationMs)}ms (budget: ${"%.1f".format(budget)}ms)")
    }
    
    @JvmStatic
    fun perfBatch(operation: String, itemCount: Int, totalMs: Double, isMainThread: Boolean) {
        if (!detailedOutput || !performanceTracing) return
        val threadInfo = if (isMainThread) "🟢 MAIN" else "🔵 BG"
        val avgMs = if (itemCount > 0) totalMs / itemCount else 0.0
        
        writeLog("BATCH", "📦 [$operation] $itemCount items | $threadInfo | total=${"%.2f".format(totalMs)}ms avg=${"%.3f".format(avgMs)}ms/item")
    }
    
    @JvmStatic
    fun perfNetwork(operation: String, url: String, durationMs: Double, bytesTransferred: Int, success: Boolean) {
        if (!detailedOutput || !performanceTracing) return
        val threadInfo = if (Thread.currentThread() == android.os.Looper.getMainLooper().thread) "🟢 MAIN" else "🔵 BG"
        val throughputKBps = if (durationMs > 0) bytesTransferred / durationMs else 0.0
        val icon = if (success) "✅" else "❌"
        val shortUrl = url.split("/").takeLast(2).joinToString("/")
        
        writeLog("NET", "$icon [$operation] $shortUrl | $threadInfo | ${"%.2f".format(durationMs)}ms, ${bytesTransferred}B @ ${"%.1f".format(throughputKBps)}KB/s")
    }
    
    // Debug-Only Presign Logs
    
    @JvmStatic
    fun debugPresignRequest(url: String, sessionId: String, kind: String, sizeBytes: Int) {
        if (!detailedOutput) return
        writeLog("DEBUG", "🔐 [PRESIGN-REQ] url=$url sessionId=$sessionId kind=$kind size=${sizeBytes}B")
    }
    
    @JvmStatic
    fun debugPresignResponse(status: Int, segmentId: String?, uploadUrl: String?, durationMs: Double) {
        if (!detailedOutput) return
        if (segmentId != null && uploadUrl != null) {
            val truncUrl = if (uploadUrl.length > 80) uploadUrl.take(80) + "..." else uploadUrl
            writeLog("DEBUG", "✅ [PRESIGN-OK] status=$status segmentId=$segmentId uploadUrl=$truncUrl took=${"%.1f".format(durationMs)}ms")
        } else {
            writeLog("DEBUG", "❌ [PRESIGN-FAIL] status=$status took=${"%.1f".format(durationMs)}ms")
        }
    }
    
    @JvmStatic
    fun debugUploadProgress(phase: String, segmentId: String, bytesWritten: Long, totalBytes: Long) {
        if (!detailedOutput) return
        val pct = if (totalBytes > 0) bytesWritten.toDouble() / totalBytes * 100 else 0.0
        writeLog("DEBUG", "📤 [UPLOAD] $phase segmentId=$segmentId progress=${"%.1f".format(pct)}% ($bytesWritten/${totalBytes}B)")
    }
    
    @JvmStatic
    fun debugUploadComplete(segmentId: String, status: Int, durationMs: Double, throughputKBps: Double) {
        if (!detailedOutput) return
        writeLog("DEBUG", "📤 [UPLOAD-DONE] segmentId=$segmentId status=$status took=${"%.1f".format(durationMs)}ms throughput=${"%.1f".format(throughputKBps)}KB/s")
    }
    
    // Debug-Only Network Logs
    
    @JvmStatic
    fun debugNetworkRequest(method: String, url: String, headers: Map<String, String>?) {
        if (!detailedOutput) return
        var msg = "🌐 [NET-REQ] $method $url"
        if (headers != null) {
            val sanitized = headers.mapValues { if (it.value.length > 20) it.value.take(8) + "..." else it.value }
            msg += " headers=$sanitized"
        }
        writeLog("DEBUG", msg)
    }
    
    @JvmStatic
    fun debugNetworkResponse(url: String, status: Int, bodySize: Int, durationMs: Double) {
        if (!detailedOutput) return
        val shortUrl = url.split("/").lastOrNull() ?: url
        writeLog("DEBUG", "🌐 [NET-RSP] $shortUrl status=$status size=${bodySize}B took=${"%.1f".format(durationMs)}ms")
    }
    
    // Debug-Only Credential Logs
    
    @JvmStatic
    fun debugCredentialFlow(phase: String, fingerprint: String?, success: Boolean, detail: String = "") {
        if (!detailedOutput) return
        val fp = fingerprint?.take(12)?.plus("...") ?: "nil"
        val icon = if (success) "✅" else "❌"
        writeLog("DEBUG", "$icon [CRED] $phase fingerprint=$fp $detail")
    }
    
    // Debug-Only Storage Logs
    
    @JvmStatic
    fun debugStorage(op: String, key: String, success: Boolean, detail: String = "") {
        if (!detailedOutput) return
        val icon = if (success) "✅" else "❌"
        writeLog("DEBUG", "$icon [STORAGE] $op key=$key $detail")
    }
    
    // Debug-Only Memory Logs
    
    @JvmStatic
    fun debugMemoryUsage(context: String) {
        if (!detailedOutput || !performanceTracing) return
        val runtime = Runtime.getRuntime()
        val usedMB = (runtime.totalMemory() - runtime.freeMemory()) / 1_048_576.0
        val maxMB = runtime.maxMemory() / 1_048_576.0
        val warningIcon = when {
            usedMB > maxMB * 0.8 -> "🔴"
            usedMB > maxMB * 0.5 -> "🟡"
            else -> "🟢"
        }
        writeLog("MEM", "$warningIcon [$context] used=${"%.1f".format(usedMB)}MB max=${"%.1f".format(maxMB)}MB")
    }
    
    // Configuration
    
    @JvmStatic
    fun setVerbose(enabled: Boolean) {
        detailedOutput = enabled
        performanceTracing = enabled
        minimumLevel = if (enabled) 0 else 1
        if (enabled) {
            writeLog("INFO", "🔧 [CONFIG] Debug mode ENABLED: detailedOutput=$detailedOutput, performanceTracing=$performanceTracing, minimumLevel=$minimumLevel")
        }
    }
    
    // Internal Implementation - @PublishedApi allows inline functions to access
    
    @PublishedApi
    internal fun writeLog(prefix: String, message: String) {
        val output = buildString {
            append("[RJ]")
            if (includeTimestamp) {
                append(" ")
                append(dateFormatter.format(Date()))
            }
            append(" [$prefix] $message")
        }
        
        when (prefix) {
            "ERROR" -> Log.e(TAG, output)
            "WARN" -> Log.w(TAG, output)
            "INFO", "NOTICE" -> Log.i(TAG, output)
            "DEBUG", "PERF", "FRAME", "BATCH", "NET", "MEM" -> Log.d(TAG, output)
            else -> Log.v(TAG, output)
        }
    }
}

// Type alias for backward compatibility
typealias Logger = DiagnosticLog
