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
import android.os.SystemClock
import androidx.core.os.HandlerCompat
import com.rejourney.engine.DiagnosticLog
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.UUID
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

        internal fun shouldReportAnr(
            elapsedMs: Long,
            missedPongs: Int,
            thresholdMs: Long,
            alreadyReported: Boolean
        ): Boolean = elapsedMs >= thresholdMs && missedPongs > 0 && !alreadyReported
    }

    var currentSessionId: String? = null
    var anrThresholdMs: Long = 5000L

    private var watchdogThread: Thread? = null
    private val isActive = AtomicBoolean(false)
    private val lastResponseTime = AtomicLong(SystemClock.uptimeMillis())
    private val pingSequence = AtomicInteger(0)
    private val pongSequence = AtomicInteger(0)
    private val reportedCurrentStall = AtomicBoolean(false)

    // A synchronous Handler can sit behind a display-vsync synchronization
    // barrier while the main Looper is otherwise responsive. The watchdog is
    // an input-responsiveness signal, so its ping must bypass those barriers.
    private val mainHandler: Handler = HandlerCompat.createAsync(Looper.getMainLooper())

    fun activate() {
        if (isActive.getAndSet(true)) return

        // Reset watchdog state on each activation to avoid stale timings from
        // previous app background periods.
        lastResponseTime.set(SystemClock.uptimeMillis())
        pongSequence.set(pingSequence.get())
        reportedCurrentStall.set(false)

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
                        lastResponseTime.set(SystemClock.uptimeMillis())
                        reportedCurrentStall.set(false)
                    }

                    Thread.sleep(checkInterval)

                    // Check if main thread responded
                    val elapsed = SystemClock.uptimeMillis() - lastResponseTime.get()
                    val missedPongs = pingSequence.get() - pongSequence.get()

                    if (shouldReportAnr(
                            elapsedMs = elapsed,
                            missedPongs = missedPongs,
                            thresholdMs = anrThresholdMs,
                            alreadyReported = reportedCurrentStall.get()
                        ) && reportedCurrentStall.compareAndSet(false, true)
                    ) {
                        captureAnr(elapsed)
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
            val threadState = mainThread.state.name.lowercase()

            val frames = stackTrace.map { element ->
                "${element.className}.${element.methodName}(${element.fileName}:${element.lineNumber})"
            }

            ReplayOrchestrator.shared?.incrementStalledTally()

            // Route ANR through TelemetryPipeline so it arrives in the events
            // batch and the backend ingest worker can insert it into the anrs table
            val stackStr = frames.joinToString("\n")
            val incidentId = UUID.randomUUID().toString()
            TelemetryPipeline.shared?.recordAnrEvent(
                durationMs,
                stackStr,
                incidentId,
                threadState
            )

            // Persist ANR incident and send through /api/ingest/fault so ANRs survive
            // process termination/background upload loss, similar to crash recovery.
            val sessionId = StabilityMonitor.shared?.currentSessionId
                ?: ReplayOrchestrator.shared?.replayId
                ?: "unknown"
            val incident = IncidentRecord(
                incidentId = incidentId,
                sessionId = sessionId,
                timestampMs = System.currentTimeMillis(),
                category = "anr",
                identifier = "MainThreadFrozen",
                detail = "Main thread unresponsive for ${durationMs}ms",
                frames = frames,
                context = mapOf(
                    "durationMs" to durationMs.toString(),
                    "threadState" to threadState
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
