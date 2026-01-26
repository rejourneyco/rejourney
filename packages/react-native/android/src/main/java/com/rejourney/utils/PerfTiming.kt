/**
 * Performance timing utility aligned with iOS RJPerfTiming.
 */
package com.rejourney.utils

import android.os.Looper
import android.os.SystemClock
import com.rejourney.core.Logger
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.max

enum class PerfMetric {
    FRAME,
    SCREENSHOT,
    RENDER,
    PRIVACY_MASK,
    VIEW_SCAN,
    VIEW_SERIALIZE,
    ENCODE,
    PIXEL_BUFFER,
    DOWNSCALE,
    BUFFER_ALLOC,
    ENCODE_APPEND,
    UPLOAD
}

object PerfTiming {
    private const val PERF_ENABLED = true
    private const val DUMP_INTERVAL_MS = 5000.0
    private const val MIN_SAMPLES = 5L

    private val names = arrayOf(
        "frame_total",
        "screenshot_ui",
        "render_draw",
        "privacy_mask",
        "view_scan",
        "view_serialize",
        "encode_h264",
        "pixel_buffer",
        "downscale",
        "buffer_alloc",
        "encode_append",
        "upload_net"
    )

    private val totals = DoubleArray(PerfMetric.values().size)
    private val maxes = DoubleArray(PerfMetric.values().size)
    private val counts = LongArray(PerfMetric.values().size)
    private var lastDumpTimeNs = 0L

    private val lock = ReentrantLock()

    fun isEnabled(): Boolean = PERF_ENABLED

    fun now(): Long = SystemClock.elapsedRealtimeNanos()

    fun record(metric: PerfMetric, startNs: Long, endNs: Long) {
        if (!PERF_ENABLED) {
            return
        }

        val durationMs = (endNs - startNs).toDouble() / 1_000_000.0
        val isMain = Looper.getMainLooper().thread == Thread.currentThread()
        val threadName = if (isMain) "MAIN" else "BG"
        val name = names[metric.ordinal]

        if (isMain && durationMs > 4.0) {
            Logger.warning("[RJ-PERF] ⚠️ [$threadName] $name: ${"%.2f".format(durationMs)}ms")
        } else {
            Logger.debug("[RJ-PERF] [$threadName] $name: ${"%.2f".format(durationMs)}ms")
        }

        lock.withLock {
            counts[metric.ordinal]++
            totals[metric.ordinal] += durationMs
            maxes[metric.ordinal] = max(maxes[metric.ordinal], durationMs)
        }
    }

    fun dumpIfNeeded() {
        if (!PERF_ENABLED) {
            return
        }

        val now = now()
        if (lastDumpTimeNs != 0L && msBetween(lastDumpTimeNs, now) < DUMP_INTERVAL_MS) {
            return
        }

        lock.withLock {
            if (lastDumpTimeNs != 0L && msBetween(lastDumpTimeNs, now) < DUMP_INTERVAL_MS) {
                return
            }

            var totalSamples = 0L
            counts.forEach { totalSamples += it }
            if (totalSamples < MIN_SAMPLES) {
                return
            }

            lastDumpTimeNs = now

            val log = StringBuilder("[Rejourney PERF SUMMARY]")
            for (i in counts.indices) {
                if (counts[i] > 0) {
                    val avg = totals[i] / counts[i].toDouble()
                    log.append(" ")
                    log.append(names[i])
                    log.append("=")
                    log.append(counts[i])
                    log.append("/")
                    log.append(String.format("%.1f", avg))
                    log.append("/")
                    log.append(String.format("%.1f", maxes[i]))
                    log.append("ms")
                }
            }
            Logger.debug(log.toString())
        }
    }

    fun dump() {
        if (!PERF_ENABLED) {
            return
        }

        lock.withLock {
            var totalSamples = 0L
            counts.forEach { totalSamples += it }
            if (totalSamples == 0L) {
                Logger.debug("[Rejourney PERF] No samples collected")
                return
            }

            val log = StringBuilder()
            log.append("\n")
            log.append("╔══════════════════════════════════════════════════════════════╗\n")
            log.append("║              REJOURNEY SDK PERFORMANCE METRICS (ms)          ║\n")
            log.append("╠══════════════════════════════════════════════════════════════╣\n")
            log.append("║  METRIC           │    COUNT │    AVG (ms) │    MAX (ms)    ║\n")
            log.append("╠══════════════════════════════════════════════════════════════╣\n")

            for (i in counts.indices) {
                if (counts[i] > 0) {
                    val avg = totals[i] / counts[i].toDouble()
                    log.append(
                        String.format(
                            "║  %-16s │ %8d │ %10.2f │ %10.2f    ║\n",
                            names[i],
                            counts[i],
                            avg,
                            maxes[i]
                        )
                    )
                }
            }

            log.append("╚══════════════════════════════════════════════════════════════╝")
            lastDumpTimeNs = now()
            Logger.debug(log.toString())
        }
    }

    fun reset() {
        if (!PERF_ENABLED) {
            return
        }

        lock.withLock {
            for (i in counts.indices) {
                totals[i] = 0.0
                maxes[i] = 0.0
                counts[i] = 0
            }
            lastDumpTimeNs = 0L
        }
        Logger.debug("[Rejourney PERF] Metrics reset")
    }

    fun snapshot(): Map<String, Map<String, Number>> {
        if (!PERF_ENABLED) {
            return emptyMap()
        }

        return lock.withLock {
            val result = mutableMapOf<String, Map<String, Number>>()
            for (i in counts.indices) {
                if (counts[i] > 0) {
                    val avg = totals[i] / counts[i].toDouble()
                    result[names[i]] = mapOf(
                        "count" to counts[i],
                        "avg_us" to avg,
                        "max_us" to maxes[i],
                        "total_us" to totals[i]
                    )
                }
            }
            result
        }
    }

    fun nameForMetric(metric: PerfMetric): String {
        return names.getOrElse(metric.ordinal) { "unknown" }
    }

    fun <T> time(metric: PerfMetric, block: () -> T): T {
        if (!PERF_ENABLED) {
            return block()
        }
        val start = now()
        return try {
            block()
        } finally {
            record(metric, start, now())
        }
    }

    fun <T> measure(label: String, block: () -> T): T {
        val start = now()
        return try {
            block()
        } finally {
            val end = now()
            val durationUs = (end - start) / 1000
            val durationMs = durationUs / 1000.0
            Logger.debug("[PerfTiming] $label: ${durationUs}us (${String.format("%.3f", durationMs)}ms)")
        }
    }

    private fun msBetween(startNs: Long, endNs: Long): Double {
        return (endNs - startNs).toDouble() / 1_000_000.0
    }
}
