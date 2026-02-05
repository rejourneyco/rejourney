/**
 * Performance timing utility aligned with iOS RJPerfTiming.
 * All logging is runtime-gated by JS `debug: true` via Logger.setDebugMode(true).
 */
package com.rejourney.utils

import android.os.Debug
import android.os.Looper
import android.os.SystemClock
import com.rejourney.core.Logger
import java.io.File
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.max
import kotlin.math.min

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

data class PerfFrameContext(
    val reason: String = "unknown",
    val shouldRender: Boolean = false,
    val totalViewsScanned: Int = 0,
    val sensitiveRects: Int = 0,
    val didBailOut: Boolean = false,
    val bailOutReason: String = "none",
    val hasBlockedSurface: Boolean = false,
    val performanceLevel: String = "normal",
    val isWarmup: Boolean = false
)

object PerfTiming {
    private const val PERF_ENABLED = true
    private const val DUMP_INTERVAL_MS = 5000.0
    private const val MIN_SAMPLES = 5L
    private const val SAMPLE_CAPACITY = 256

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

    private val outlierThresholdMs = doubleArrayOf(
        80.0,  // frame_total
        60.0,  // screenshot_ui
        50.0,  // render_draw
        8.0,   // privacy_mask
        12.0,  // view_scan
        8.0,   // view_serialize
        20.0,  // encode_h264
        8.0,   // pixel_buffer
        16.0,  // downscale
        6.0,   // buffer_alloc
        12.0,  // encode_append
        120.0  // upload_net
    )

    private val totals = DoubleArray(PerfMetric.values().size)
    private val maxes = DoubleArray(PerfMetric.values().size)
    private val counts = LongArray(PerfMetric.values().size)
    private val warmupTotals = DoubleArray(PerfMetric.values().size)
    private val warmupMaxes = DoubleArray(PerfMetric.values().size)
    private val warmupCounts = LongArray(PerfMetric.values().size)
    private val peakMemMbByMetric = DoubleArray(PerfMetric.values().size)
    private val samples = Array(PerfMetric.values().size) { DoubleArray(SAMPLE_CAPACITY) }
    private var processPeakRssMb = 0.0
    private var processPeakHeapMb = 0.0
    private var processPeakPssMb = 0.0
    private var lastDumpTimeNs = 0L

    @Volatile
    private var frameContext = PerfFrameContext()

    private val lock = ReentrantLock()

    fun isEnabled(): Boolean = PERF_ENABLED && Logger.isDebugMode()

    fun now(): Long = SystemClock.elapsedRealtimeNanos()

    fun setFrameContext(context: PerfFrameContext) {
        frameContext = context
    }

    fun record(metric: PerfMetric, startNs: Long, endNs: Long) {
        if (!isEnabled()) {
            return
        }

        val durationMs = (endNs - startNs).toDouble() / 1_000_000.0
        val isMain = Looper.getMainLooper().thread == Thread.currentThread()
        val threadName = if (isMain) "MAIN" else "BG"
        val name = names[metric.ordinal]
        val memory = memorySnapshotMb()

        if (isMain && durationMs > 4.0) {
            Logger.warning(
                "[RJ-PERF] ⚠️ [$threadName]${if (frameContext.isWarmup) "[WARMUP]" else ""} " +
                    "$name: ${"%.2f".format(durationMs)}ms"
            )
        } else {
            Logger.debug(
                "[RJ-PERF] [$threadName]${if (frameContext.isWarmup) "[WARMUP]" else ""} " +
                    "$name: ${"%.2f".format(durationMs)}ms"
            )
        }

        lock.withLock {
            val idx = metric.ordinal
            val isWarmupSample = frameContext.isWarmup
            if (isWarmupSample) {
                val warmCount = warmupCounts[idx]
                warmupCounts[idx] = warmCount + 1
                warmupTotals[idx] += durationMs
                warmupMaxes[idx] = max(warmupMaxes[idx], durationMs)
            } else {
                val count = counts[idx]
                counts[idx] = count + 1
                totals[idx] += durationMs
                maxes[idx] = max(maxes[idx], durationMs)

                val sampleSlot = (count % SAMPLE_CAPACITY).toInt()
                samples[idx][sampleSlot] = durationMs
            }

            peakMemMbByMetric[idx] = max(peakMemMbByMetric[idx], memory.rssMb)
            processPeakRssMb = max(processPeakRssMb, memory.rssMb)
            processPeakHeapMb = max(processPeakHeapMb, memory.heapMb)
            processPeakPssMb = max(processPeakPssMb, memory.pssMb)
            processPeakNativeHeapMb = max(processPeakNativeHeapMb, memory.nativeHeapMb)
        }

        if (durationMs >= outlierThresholdMs[metric.ordinal]) {
            val ctx = frameContext
            Logger.warning(
                "[RJ-PERF-OUTLIER]${if (ctx.isWarmup) "[WARMUP]" else ""} " +
                    "$name=${"%.2f".format(durationMs)}ms " +
                    "(reason=${ctx.reason}, render=${ctx.shouldRender}, views=${ctx.totalViewsScanned}, " +
                    "sensitive=${ctx.sensitiveRects}, bailout=${ctx.didBailOut}/${ctx.bailOutReason}, blocked=${ctx.hasBlockedSurface}, " +
                    "perf=${ctx.performanceLevel}, rss=${"%.1f".format(memory.rssMb)}MB, " +
                    "heap=${"%.1f".format(memory.heapMb)}MB, pss=${"%.1f".format(memory.pssMb)}MB, " +
                    "native=${"%.1f".format(memory.nativeHeapMb)}MB)"
            )
        }
    }

    fun dumpIfNeeded() {
        if (!isEnabled()) {
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
            var totalWarmupSamples = 0L
            counts.forEach { totalSamples += it }
            warmupCounts.forEach { totalWarmupSamples += it }
            if (totalSamples < MIN_SAMPLES && totalWarmupSamples < MIN_SAMPLES) {
                return
            }

            lastDumpTimeNs = now

            val log = StringBuilder("[Rejourney PERF SUMMARY]")
            for (i in counts.indices) {
                if (counts[i] > 0) {
                    val avg = totals[i] / counts[i].toDouble()
                    val p95 = percentileForMetricLocked(i, 95.0)
                    log.append(" ")
                    log.append(names[i])
                    log.append("=")
                    log.append(counts[i])
                    log.append("/")
                    log.append(String.format("%.1f", avg))
                    log.append("/")
                    log.append(String.format("%.1f", p95))
                    log.append("/")
                    log.append(String.format("%.1f", maxes[i]))
                    log.append("ms")
                }
            }
            if (totalWarmupSamples > 0) {
                log.append(" warmup(")
                var hasWarmupMetric = false
                for (i in warmupCounts.indices) {
                    if (warmupCounts[i] == 0L) continue
                    if (hasWarmupMetric) log.append(" ")
                    hasWarmupMetric = true
                    val avg = warmupTotals[i] / warmupCounts[i].toDouble()
                    log.append(
                        "${names[i]}=${warmupCounts[i]}/${String.format("%.1f", avg)}/${String.format("%.1f", warmupMaxes[i])}ms"
                    )
                }
                log.append(")")
            }
            log.append(
                " mem_peak(rss/heap/pss/native)=" +
                    String.format("%.1f/%.1f/%.1f/%.1fMB", processPeakRssMb, processPeakHeapMb, processPeakPssMb, processPeakNativeHeapMb)
            )
            val currentMemory = memorySnapshotMb()
            val sys = systemSnapshot()
            log.append(
                " mem_now(rss/heap/pss/native)=" +
                    String.format(
                        "%.1f/%.1f/%.1f/%.1fMB",
                        currentMemory.rssMb,
                        currentMemory.heapMb,
                        currentMemory.pssMb,
                        currentMemory.nativeHeapMb
                    )
            )
            log.append(" sys(threads/fds)=${sys.threadCount}/${sys.openFdCount}")
            Logger.debug(log.toString())
        }
    }

    fun dump() {
        if (!isEnabled()) {
            return
        }

        lock.withLock {
            var totalSamples = 0L
            var warmupSamples = 0L
            counts.forEach { totalSamples += it }
            warmupCounts.forEach { warmupSamples += it }
            if (totalSamples == 0L && warmupSamples == 0L) {
                Logger.debug("[Rejourney PERF] No samples collected")
                return
            }

            val log = StringBuilder()
            log.append("\n")
            log.append("╔════════════════════════════════════════════════════════════════════════════════════════════════╗\n")
            log.append("║                      REJOURNEY SDK PERFORMANCE METRICS (ms)                                  ║\n")
            log.append("╠════════════════════════════════════════════════════════════════════════════════════════════════╣\n")
            log.append("║ METRIC           │ COUNT    │ AVG      │ P50      │ P95      │ P99      │ MAX      │ RSS PEAK ║\n")
            log.append("╠════════════════════════════════════════════════════════════════════════════════════════════════╣\n")

            for (i in counts.indices) {
                if (counts[i] > 0) {
                    val avg = totals[i] / counts[i].toDouble()
                    val p50 = percentileForMetricLocked(i, 50.0)
                    val p95 = percentileForMetricLocked(i, 95.0)
                    val p99 = percentileForMetricLocked(i, 99.0)
                    log.append(
                        String.format(
                            "║ %-16s │ %-8d │ %-8.2f │ %-8.2f │ %-8.2f │ %-8.2f │ %-8.2f │ %-8.1f ║\n",
                            names[i],
                            counts[i],
                            avg,
                            p50,
                            p95,
                            p99,
                            maxes[i],
                            peakMemMbByMetric[i]
                        )
                    )
                }
            }
            if (warmupSamples > 0L) {
                log.append("╠════════════════════════════════════════════════════════════════════════════════════════════════╣\n")
                log.append("║ Warmup Samples (avg/max):                                                                    ║\n")
                for (i in warmupCounts.indices) {
                    if (warmupCounts[i] == 0L) continue
                    val avg = warmupTotals[i] / warmupCounts[i].toDouble()
                    log.append(
                        String.format(
                            "║ %-16s │ warmup=%-4d avg=%-8.2f max=%-8.2f                                     ║\n",
                            names[i],
                            warmupCounts[i],
                            avg,
                            warmupMaxes[i]
                        )
                    )
                }
            }

            log.append("╠════════════════════════════════════════════════════════════════════════════════════════════════╣\n")
            val currentMemory = memorySnapshotMb()
            val sys = systemSnapshot()
            log.append(
                String.format(
                    "║ Process Memory Peak: rss=%6.1fMB heap=%6.1fMB pss=%6.1fMB native=%6.1fMB                     ║\n",
                    processPeakRssMb,
                    processPeakHeapMb,
                    processPeakPssMb,
                    processPeakNativeHeapMb
                )
            )
            log.append(
                String.format(
                    "║ Process Memory Now : rss=%6.1fMB heap=%6.1fMB pss=%6.1fMB native=%6.1fMB threads=%4d fds=%4d ║\n",
                    currentMemory.rssMb,
                    currentMemory.heapMb,
                    currentMemory.pssMb,
                    currentMemory.nativeHeapMb,
                    sys.threadCount,
                    sys.openFdCount
                )
            )
            log.append("╚════════════════════════════════════════════════════════════════════════════════════════════════╝")

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
                warmupTotals[i] = 0.0
                warmupMaxes[i] = 0.0
                warmupCounts[i] = 0
                peakMemMbByMetric[i] = 0.0
                for (j in 0 until SAMPLE_CAPACITY) {
                    samples[i][j] = 0.0
                }
            }
            processPeakRssMb = 0.0
            processPeakHeapMb = 0.0
            processPeakPssMb = 0.0
            processPeakNativeHeapMb = 0.0
            lastDumpTimeNs = 0L
        }
        if (Logger.isDebugMode()) {
            Logger.debug("[Rejourney PERF] Metrics reset")
        }
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
                        "avg_ms" to avg,
                        "p95_ms" to percentileForMetricLocked(i, 95.0),
                        "p99_ms" to percentileForMetricLocked(i, 99.0),
                        "max_ms" to maxes[i],
                        "peak_rss_mb" to peakMemMbByMetric[i],
                        "peak_native_heap_mb" to processPeakNativeHeapMb
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
        if (!isEnabled()) {
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
        if (!isEnabled()) {
            return block()
        }
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

    private fun percentileForMetricLocked(metricIndex: Int, percentile: Double): Double {
        val count = counts[metricIndex]
        if (count <= 0) {
            return 0.0
        }
        val sampleCount = min(count.toInt(), SAMPLE_CAPACITY)
        val bucket = samples[metricIndex]
        val values = DoubleArray(sampleCount)

        val latestCount = count
        if (latestCount <= SAMPLE_CAPACITY) {
            for (i in 0 until sampleCount) {
                values[i] = bucket[i]
            }
        } else {
            val start = (latestCount % SAMPLE_CAPACITY).toInt()
            for (i in 0 until sampleCount) {
                values[i] = bucket[(start + i) % SAMPLE_CAPACITY]
            }
        }

        values.sort()
        val rank = ((percentile / 100.0) * (sampleCount - 1)).toInt().coerceIn(0, sampleCount - 1)
        return values[rank]
    }

    private fun msBetween(startNs: Long, endNs: Long): Double {
        return (endNs - startNs).toDouble() / 1_000_000.0
    }

    private data class MemorySnapshot(
        val rssMb: Double,
        val heapMb: Double,
        val pssMb: Double,
        val nativeHeapMb: Double
    )

    private data class SystemSnapshot(
        val threadCount: Int,
        val openFdCount: Int
    )

    private var processPeakNativeHeapMb = 0.0

    private fun memorySnapshotMb(): MemorySnapshot {
        val runtime = Runtime.getRuntime()
        val usedHeapMb = (runtime.totalMemory() - runtime.freeMemory()).toDouble() / (1024.0 * 1024.0)
        val nativeHeapMb = Debug.getNativeHeapAllocatedSize().toDouble() / (1024.0 * 1024.0)

        return try {
            val memoryInfo = Debug.MemoryInfo()
            Debug.getMemoryInfo(memoryInfo)
            val pssMb = memoryInfo.totalPss.toDouble() / 1024.0
            val rssMb = memoryInfo.totalPrivateDirty.toDouble() / 1024.0
            MemorySnapshot(
                rssMb = rssMb,
                heapMb = usedHeapMb,
                pssMb = pssMb,
                nativeHeapMb = nativeHeapMb
            )
        } catch (_: Exception) {
            MemorySnapshot(
                rssMb = usedHeapMb,
                heapMb = usedHeapMb,
                pssMb = usedHeapMb,
                nativeHeapMb = nativeHeapMb
            )
        }
    }

    private fun systemSnapshot(): SystemSnapshot {
        val threads = try {
            Thread.getAllStackTraces().size
        } catch (_: Exception) {
            -1
        }

        val openFdCount = try {
            File("/proc/self/fd").list()?.size ?: -1
        } catch (_: Exception) {
            -1
        }

        return SystemSnapshot(threadCount = threads, openFdCount = openFdCount)
    }
}
