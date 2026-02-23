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

import android.os.Handler
import android.os.Looper
import com.rejourney.engine.DiagnosticLog
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

/**
 * ANR (Application Not Responding) detection sentinel
 * Android implementation aligned with iOS AnrSentinel.swift
 * 
 * Uses a watchdog thread to detect main thread hangs > threshold
 */
class AnrSentinel private constructor() {
    
    companion object {
        @Volatile
        private var instance: AnrSentinel? = null
        
        val shared: AnrSentinel
            get() = instance ?: synchronized(this) {
                instance ?: AnrSentinel().also { instance = it }
            }
    }
    
    var currentSessionId: String? = null
    var anrThresholdMs: Long = 5000L
    
    private var watchdogThread: Thread? = null
    private val isActive = AtomicBoolean(false)
    private val lastResponseTime = AtomicLong(System.currentTimeMillis())
    private val pingSequence = AtomicInteger(0)
    private val pongSequence = AtomicInteger(0)
    
    private val mainHandler = Handler(Looper.getMainLooper())
    
    fun activate() {
        if (isActive.getAndSet(true)) return

        // Reset watchdog state on each activation to avoid stale timings from
        // previous app background periods.
        lastResponseTime.set(System.currentTimeMillis())
        pongSequence.set(pingSequence.get())
        
        startWatchdog()
    }
    
    fun deactivate() {
        if (!isActive.getAndSet(false)) return
        
        watchdogThread?.interrupt()
        watchdogThread = null
    }
    
    private fun startWatchdog() {
        watchdogThread = thread(name = "RJ-ANR-Watchdog", isDaemon = true) {
            val checkInterval = 1000L // 1 second
            
            while (isActive.get() && !Thread.currentThread().isInterrupted) {
                try {
                    // Send ping to main thread
                    val currentPing = pingSequence.incrementAndGet()
                    
                    mainHandler.post {
                        // Main thread is responsive, update pong
                        pongSequence.set(currentPing)
                        lastResponseTime.set(System.currentTimeMillis())
                    }
                    
                    Thread.sleep(checkInterval)
                    
                    // Check if main thread responded
                    val elapsed = System.currentTimeMillis() - lastResponseTime.get()
                    val missedPongs = pingSequence.get() - pongSequence.get()
                    
                    if (elapsed >= anrThresholdMs && missedPongs > 0) {
                        captureAnr(elapsed)
                        
                        // Reset to avoid duplicate reports
                        lastResponseTime.set(System.currentTimeMillis())
                        pongSequence.set(pingSequence.get())
                    }
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                } catch (e: Exception) {
                    DiagnosticLog.fault("ANR watchdog error: ${e.message}")
                }
            }
        }
    }
    
    private fun captureAnr(durationMs: Long) {
        try {
            val mainThread = Looper.getMainLooper().thread
            val stackTrace = mainThread.stackTrace
            
            val frames = stackTrace.map { element ->
                "${element.className}.${element.methodName}(${element.fileName}:${element.lineNumber})"
            }
            
            ReplayOrchestrator.shared?.incrementStalledTally()
            
            // Route ANR through TelemetryPipeline so it arrives in the events
            // batch and the backend ingest worker can insert it into the anrs table
            val stackStr = frames.joinToString("\n")
            TelemetryPipeline.shared?.recordAnrEvent(durationMs, stackStr)

            // Persist ANR incident and send through /api/ingest/fault so ANRs survive
            // process termination/background upload loss, similar to crash recovery.
            val sessionId = StabilityMonitor.shared?.currentSessionId
                ?: ReplayOrchestrator.shared?.replayId
                ?: "unknown"
            val incident = IncidentRecord(
                sessionId = sessionId,
                timestampMs = System.currentTimeMillis(),
                category = "anr",
                identifier = "MainThreadFrozen",
                detail = "Main thread unresponsive for ${durationMs}ms",
                frames = frames,
                context = mapOf(
                    "durationMs" to durationMs.toString(),
                    "threadState" to "blocked"
                )
            )
            StabilityMonitor.shared?.persistIncidentSync(incident)
            StabilityMonitor.shared?.transmitStoredReport()
            
            DiagnosticLog.fault("ANR detected: ${durationMs}ms hang")
            
        } catch (e: Exception) {
            DiagnosticLog.fault("Failed to capture ANR: ${e.message}")
        }
    }
}
