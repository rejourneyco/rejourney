package com.rejourney.recording

import android.app.Activity
import android.content.Context
import android.graphics.Rect
import android.view.View
import com.rejourney.utility.gzipCompress
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantLock
import java.util.zip.CRC32
import kotlin.concurrent.withLock

/**
 * Unity is the sole capture owner. Native code only packages already-redacted JPEGs.
 *
 * Frames are bundled like the other SDKs (three by default), so one
 * presign/PUT/confirm round trip carries several frames. Each frame is also
 * written under rj_pending until its bundle is delivered or accepted by the
 * dispatcher's durable spool, so crash recovery keeps the final seconds.
 */
class VisualCapture private constructor(private val context: Context) {
    companion object {
        @Volatile var shared: VisualCapture? = null
            private set
        @Synchronized fun getInstance(context: Context): VisualCapture = shared ?: VisualCapture(context.applicationContext ?: context).also { shared = it }
    }
    var captureGeneration = 0
        private set
    val skippedFramesThrottle = AtomicInteger()
    val skippedFramesBacklog = AtomicInteger()
    val skippedFramesMapMoving = AtomicInteger()
    val skippedFramesDuplicate = AtomicInteger()
    val framesCaptured = AtomicInteger()
    var snapshotInterval = 1.0
        private set
    @Volatile private var active = false
    @Volatile private var paused = false
    @Volatile private var backgrounded = false
    @Volatile private var epoch = 0L

    private class Frame(val jpeg: ByteArray, val timestamp: Long)
    private class Batch(val session: String, val epoch: Long, val frames: List<Frame>)
    // Guarded by lock. At most MAX_IN_FLIGHT bundles are handed to the dispatcher
    // at once; beyond maxBuffered, new frames are dropped as backlog.
    private val lock = ReentrantLock()
    private var batchSize = 3
    private val buffer = ArrayList<Frame>()
    private var bufferSession: String? = null
    private var bufferEpoch = 0L
    private var lastFrameHash: Long? = null
    private var inFlight = 0
    private val maxInFlight = 2
    private val maxBuffered get() = batchSize * 3
    private val worker = Executors.newSingleThreadExecutor()

    fun configure(snapshotInterval: Double, jpegQuality: Double, uploadBatchSize: Int = 3) {
        this.snapshotInterval = snapshotInterval
        lock.withLock { batchSize = uploadBatchSize.coerceIn(1, 30) }
    }
    fun beginCapture(sessionOrigin: Long) {
        flushBufferToNetwork()
        lock.withLock { lastFrameHash = null }
        epoch = sessionOrigin; active = true; paused = false; captureGeneration++
    }
    fun halt(expectedGeneration: Int = -1) {
        if (expectedGeneration >= 0 && expectedGeneration != captureGeneration) return
        active = false; captureGeneration++
        flushBufferToNetwork()
    }
    fun pauseForUser() { paused = true; captureGeneration++; flushBufferToNetwork() }
    fun resumeFromUser() { paused = false; captureGeneration++ }
    fun pauseForBackground() { backgrounded = true; captureGeneration++; flushBufferToNetwork() }
    fun resumeFromBackground() { backgrounded = false; captureGeneration++ }

    fun accept(jpeg: ByteArray, session: String, timestamp: Long) {
        if (!active || paused || backgrounded || session != ReplayOrchestrator.shared?.replayId || timestamp < epoch || jpeg.size !in 3..4*1024*1024) return
        val hash = CRC32().apply { update(jpeg) }.value or (jpeg.size.toLong() shl 32)
        val batches = ArrayList<Batch>(2)
        lock.withLock {
            if (bufferSession != null && bufferSession != session) takeBatch(force = true)?.let(batches::add)
            when {
                // A static scene still advances the time-based flush below.
                hash == lastFrameHash -> skippedFramesDuplicate.incrementAndGet()
                buffer.size >= maxBuffered -> skippedFramesBacklog.incrementAndGet()
                else -> {
                    lastFrameHash = hash
                    if (buffer.isEmpty()) { bufferSession = session; bufferEpoch = epoch }
                    buffer.add(Frame(jpeg, timestamp))
                    persist(jpeg, timestamp, session)
                }
            }
            takeBatchIfDue(timestamp)?.let(batches::add)
        }
        batches.forEach(::ship)
    }

    // Lock held.
    private fun takeBatchIfDue(now: Long): Batch? {
        val first = buffer.firstOrNull() ?: return null
        if (inFlight >= maxInFlight) return null
        val waited = (now - first.timestamp).coerceAtLeast(0L).toDouble()
        if (buffer.size < batchSize && waited < batchSize * snapshotInterval * 1000) return null
        return takeBatch(force = false)
    }

    // Lock held.
    private fun takeBatch(force: Boolean): Batch? {
        val session = bufferSession ?: return null
        if (buffer.isEmpty() || (!force && inFlight >= maxInFlight)) return null
        val batch = Batch(session, bufferEpoch, buffer.toList())
        buffer.clear(); bufferSession = null; inFlight++
        return batch
    }

    private fun archive(frames: List<Frame>, origin: Long): ByteArray? {
        val out = ByteBuffer.allocate(frames.sumOf { 12 + it.jpeg.size })
        for (frame in frames) out.putLong((frame.timestamp - origin).coerceAtLeast(0L)).putInt(frame.jpeg.size).put(frame.jpeg)
        return out.array().gzipCompress()
    }

    private fun ship(batch: Batch) {
        worker.execute {
            try {
                val payload = archive(batch.frames, batch.epoch)
                if (payload == null) { finish(batch, false); return@execute }
                SegmentDispatcher.shared.transmitFrameBundleForSession(batch.session, payload, batch.frames.first().timestamp,
                    batch.frames.last().timestamp, batch.frames.size) { ok -> finish(batch, ok) }
            } catch (_: Exception) { finish(batch, false) }
        }
    }

    /** [accepted] means delivered or durably queued for retry; otherwise frame files remain for recovery. */
    private fun finish(batch: Batch, accepted: Boolean) {
        if (accepted) worker.execute { val directory = framesDirectory(batch.session); batch.frames.forEach { File(directory, "${it.timestamp}.jpeg").delete() } }
        val next = lock.withLock {
            inFlight--
            if (accepted) framesCaptured.addAndGet(batch.frames.size)
            takeBatchIfDue(buffer.lastOrNull()?.timestamp ?: 0L)
        }
        next?.let(::ship)
    }

    private fun framesDirectory(sessionId: String) = File(context.cacheDir, "rj_pending/$sessionId/frames")

    private fun persist(jpeg: ByteArray, timestamp: Long, session: String) { worker.execute { write(jpeg, timestamp, session) } }

    private fun write(jpeg: ByteArray, timestamp: Long, session: String) {
        try {
            val directory = framesDirectory(session)
            val file = File(directory, "$timestamp.jpeg")
            if (file.exists()) return
            directory.mkdirs()
            // The crash path and the worker may write the same frame concurrently.
            val temporary = File(directory, "$timestamp.${Thread.currentThread().id}.tmp")
            temporary.writeBytes(jpeg)
            temporary.renameTo(file)
        } catch (_: Exception) { }
    }

    fun captureMetrics(): Map<String, Any?> = mapOf("framesCaptured" to framesCaptured.get(), "framesSkippedBacklog" to skippedFramesBacklog.get(),
        "framesSkippedDuplicate" to skippedFramesDuplicate.get())

    /** Recovery after a crash: ship the frames that never reached the durable spool. */
    fun uploadPendingFrames(sessionId: String, sessionEpochOverride: Long? = null, completion: ((Boolean) -> Unit)? = null) {
        worker.execute {
            try {
                val directory = framesDirectory(sessionId)
                val frames = directory.listFiles { file -> file.name.endsWith(".jpeg") }.orEmpty().mapNotNull { file ->
                    val timestamp = file.name.removeSuffix(".jpeg").toLongOrNull()?.takeIf { it > 0 } ?: return@mapNotNull null
                    Frame(file.readBytes(), timestamp)
                }.sortedBy { it.timestamp }
                if (frames.isEmpty()) { completion?.invoke(true); return@execute }
                val payload = archive(frames, sessionEpochOverride ?: frames.first().timestamp)
                if (payload == null) { completion?.invoke(false); return@execute }
                SegmentDispatcher.shared.transmitFrameBundleForSession(sessionId, payload, frames.first().timestamp, frames.last().timestamp, frames.size) { ok ->
                    if (ok) directory.deleteRecursively()
                    completion?.invoke(ok)
                }
            } catch (_: Exception) { completion?.invoke(false) }
        }
    }
    /** Hand every buffered frame to the dispatcher now, regardless of batch size. */
    fun afterPendingFrames(completion: () -> Unit) {
        flushBufferToNetwork()
        worker.execute { android.os.Handler(android.os.Looper.getMainLooper()).post { completion() } }
    }
    fun clearPendingFrames(sessionId: String) { worker.execute { framesDirectory(sessionId).deleteRecursively() } }
    /** Frames are persisted as they arrive; only the buffer's hand-off is pending. */
    fun flushToDisk() {}
    /** Crash handlers cannot wait for the worker. Write unshipped frames inline, never blocking on the lock. */
    fun flushToDiskForCrash() {
        if (!lock.tryLock()) return
        val frames: List<Frame>; val session: String?
        try { frames = buffer.toList(); session = bufferSession } finally { lock.unlock() }
        session ?: return
        frames.forEach { write(it.jpeg, it.timestamp, session) }
    }
    fun flushBufferToNetwork() { lock.withLock { takeBatch(force = true) }?.let(::ship) }
    fun waitForEncodingToComplete() { worker.submit {}.get() }
    fun setCurrentActivity(activity: Activity?) {}
    fun registerRedaction(view: View) {}
    fun unregisterRedaction(view: View) {}
    fun invalidateMaskCache() {}
    fun setExternalRedactionRect(id: String, rect: Rect) {}
    fun removeExternalRedactionRect(id: String) {}
    fun snapshotNow() {}
    fun snapshotWhenSafe() {}
}
