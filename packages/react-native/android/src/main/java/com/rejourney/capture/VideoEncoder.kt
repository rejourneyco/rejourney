/**
 * H.264 video segment encoder using MediaCodec/MediaMuxer.
 * Ported from iOS RJVideoEncoder.
 *
 * Provides continuous 2 FPS video capture with predictable CPU usage.
 * Each segment is a self-contained .mp4 file that can be uploaded independently.
 *
 * ## Features
 * - H.264 Baseline profile for maximum compatibility
 * - Configurable bitrate (default 1.2 Mbps for quality)
 * - Automatic segment rotation after N frames
 * - Thread-safe frame appending
 * - Emergency flush for crash handling
 *
 * Licensed under the Apache License, Version 2.0
 * Copyright (c) 2026 Rejourney
 */
package com.rejourney.capture

import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import com.rejourney.core.Logger
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Delegate interface for receiving completed video segment notifications.
 */
interface VideoEncoderDelegate {
    /**
     * Called when a video segment has been finalized and is ready for upload.
     *
     * @param segmentFile Local file path of the completed .mp4 segment.
     * @param startTime Segment start time in epoch milliseconds.
     * @param endTime Segment end time in epoch milliseconds.
     * @param frameCount Number of frames encoded in this segment.
     */
    fun onSegmentFinished(segmentFile: File, startTime: Long, endTime: Long, frameCount: Int)

    /**
     * Called when encoding fails.
     *
     * @param error The error that occurred during encoding.
     */
    fun onEncodingError(error: Exception)
}

class VideoEncoder(private val segmentDir: File) {

    /** Target video bitrate in bits per second. Default: 1.5 Mbps - matches iOS */
    var targetBitrate: Int = 1_500_000

    /** Number of frames per segment before auto-rotation. Default: 60 (4s at 15 FPS) */
    var framesPerSegment: Int = 60

    /** Target frames per second for video timing. Default: 15 */
    var fps: Int = 15

    /** Scale factor for capturing (0.0-1.0). Default: 0.35 (35% scale) - matches iOS */
    var captureScale: Float = 0.35f

    /** Maximum dimension in pixels (longest edge). Default: 1920 - matches iOS */
    var maxDimension: Int = 1920

    /** Keyframe interval in seconds. Default: 10 - matches iOS (fewer keyframes = smaller files) */
    var keyframeInterval: Int = 10

    /** Display density used to normalize pixel sizes (dp parity with iOS points). */
    var displayDensity: Float = 1f

    /** Delegate for receiving segment completion notifications */
    var delegate: VideoEncoderDelegate? = null

    private var encoder: MediaCodec? = null
    private var muxer: MediaMuxer? = null
    private var inputSurface: Surface? = null
    private var trackIndex: Int = -1
    private var muxerStarted = AtomicBoolean(false)

    private var currentSegmentFile: File? = null
    private var frameCount = AtomicInteger(0)
    private var segmentStartTime = AtomicLong(0)
    private var segmentFirstFrameTimestamp = AtomicLong(0)
    private var lastFrameTimestamp = AtomicLong(0)
    private var currentFrameWidth = 0
    private var currentFrameHeight = 0
    private val presentationTimesUs = ArrayDeque<Long>()
    private var lastPresentationTimeUs = 0L
    
    private var originalRequestedWidth = 0
    private var originalRequestedHeight = 0

    private var sessionId: String? = null

    private var encodingThread: HandlerThread? = null
    private var encodingHandler: Handler? = null

    private val bufferInfo = MediaCodec.BufferInfo()
    
    private val encoderLock = ReentrantLock()

    val isRecording: Boolean
        get() = encoder != null && inputSurface != null

    val currentFrameCount: Int
        get() = frameCount.get()

    private var isPrewarmed = false

    init {
        segmentDir.mkdirs()
    }

    /**
     * Pre-warm the encoder to eliminate first-frame encoding spike.
     * Call this during SDK initialization before first capture.
     * Matches iOS prewarmPixelBufferPool behavior.
     */
    fun prewarm() {
        if (isPrewarmed) return
        
        try {
            val codecInfo = findEncoder(MediaFormat.MIMETYPE_VIDEO_AVC)
            if (codecInfo != null) {
                Logger.debug("[VideoEncoder] Prewarm: found encoder ${codecInfo.name}")
                isPrewarmed = true
            } else {
                Logger.warning("[VideoEncoder] Prewarm: no H.264 encoder found")
            }
        } catch (e: Exception) {
            Logger.warning("[VideoEncoder] Prewarm failed: ${e.message}")
        }
    }

    /**
     * Sets the session ID for the current recording session.
     */
    fun setSessionId(id: String) {
        sessionId = id
    }

    /**
     * Starts a new video segment with the specified frame size.
     * If a segment is already in progress, it will be finished first.
     *
     * @param width Frame width in pixels (will be scaled by captureScale)
     * @param height Frame height in pixels (will be scaled by captureScale)
     * @return true if segment started successfully, false otherwise
     */
    fun startSegment(width: Int, height: Int): Boolean {
        Logger.debug("[VideoEncoder] startSegment: ${width}x${height}")

        if (isRecording) {
            Logger.debug("[VideoEncoder] Already recording, finishing previous segment")
            finishSegment()
        }

        originalRequestedWidth = width
        originalRequestedHeight = height

        var scaledWidth = (width * captureScale).toInt()
        var scaledHeight = (height * captureScale).toInt()

        val maxDim = maxOf(scaledWidth, scaledHeight)
        if (maxDim > maxDimension) {
            val scale = maxDimension.toFloat() / maxDim.toFloat()
            scaledWidth = (scaledWidth * scale).toInt()
            scaledHeight = (scaledHeight * scale).toInt()
            Logger.debug("[VideoEncoder] Applied max dimension cap: ${scaledWidth}x${scaledHeight}")
        }

        scaledWidth = (scaledWidth / 2) * 2
        scaledHeight = (scaledHeight / 2) * 2

        if (scaledWidth < 100 || scaledHeight < 100) {
            Logger.warning("[VideoEncoder] Frame size too small, using minimum 100x100")
            scaledWidth = 100
            scaledHeight = 100
        }

        currentFrameWidth = scaledWidth
        currentFrameHeight = scaledHeight

        frameCount.set(0)
        lastFrameTimestamp.set(0)
        segmentFirstFrameTimestamp.set(0)
        presentationTimesUs.clear()
        lastPresentationTimeUs = 0L
        segmentStartTime.set(System.currentTimeMillis())

        val sessionPrefix = sessionId ?: "unknown"
        val filename = "seg_${sessionPrefix}_${segmentStartTime.get()}.mp4"
        currentSegmentFile = File(segmentDir, filename)

        currentSegmentFile?.delete()

        Logger.debug("[VideoEncoder] Creating segment: $filename (${scaledWidth}x${scaledHeight})")

        return try {
            startEncodingThread()

            configureEncoder(scaledWidth, scaledHeight)

            true
        } catch (e: Exception) {
            Logger.error("[VideoEncoder] Failed to start segment", e)
            cleanup()
            delegate?.onEncodingError(e)
            false
        }
    }

    /**
     * Appends a frame to the current video segment.
     * If the segment reaches framesPerSegment, it auto-rotates to a new segment.
     *
     * @param bitmap The screenshot bitmap to encode
     * @param timestamp The capture timestamp in epoch milliseconds
     * @return true if frame was appended successfully, false otherwise
     */
    fun appendFrame(bitmap: Bitmap, timestamp: Long): Boolean {
        if (frameCount.get() % 10 == 0) {
            Logger.debug("[VideoEncoder] appendFrame: count=${frameCount.get()}, isRecording=$isRecording")
        }

        if (!isRecording) {
            Logger.warning("[VideoEncoder] Cannot append frame, not recording")
            return false
        }

        val surface = inputSurface ?: run {
            Logger.warning("[VideoEncoder] Cannot append frame, no input surface")
            return false
        }

        try {
            val scaledBitmap = if (bitmap.width != currentFrameWidth || bitmap.height != currentFrameHeight) {
                Bitmap.createScaledBitmap(bitmap, currentFrameWidth, currentFrameHeight, true)
            } else {
                bitmap
            }

            if (frameCount.get() == 0) {
                segmentFirstFrameTimestamp.set(timestamp)
            }


            val canvas = surface.lockHardwareCanvas()
            try {
                canvas.drawBitmap(scaledBitmap, 0f, 0f, null)
            } finally {
                surface.unlockCanvasAndPost(canvas)
            }

            if (scaledBitmap != bitmap) {
                scaledBitmap.recycle()
            }

            encoderLock.withLock {
                val presentationTimeUs = computePresentationTimeUs(timestamp)
                presentationTimesUs.add(presentationTimeUs)
                drainEncoder(false)
            }

            frameCount.incrementAndGet()
            lastFrameTimestamp.set(timestamp)

            if (frameCount.get() % 10 == 0) {
                Logger.debug("[VideoEncoder] Frame appended: ${frameCount.get()}/$framesPerSegment")
            }

            if (frameCount.get() >= framesPerSegment) {
                Logger.info("[VideoEncoder] Segment full (${frameCount.get()} frames), rotating")
                finishSegmentAndContinue()
            }

            return true
        } catch (e: Exception) {
            Logger.error("[VideoEncoder] Failed to append frame", e)
            return false
        }
    }

    /**
     * Finishes the current segment and notifies the delegate.
     */
    fun finishSegment() {
        finishSegmentInternal(shouldContinue = false)
    }

    /**
     * Finishes the current segment and starts a new one (rotation).
     */
    private fun finishSegmentAndContinue() {
        finishSegmentInternal(shouldContinue = true)
    }

    private fun finishSegmentInternal(shouldContinue: Boolean) {
        Logger.debug("[VideoEncoder] finishSegment: continue=$shouldContinue, frames=${frameCount.get()}")

        val enc = encoder ?: run {
            Logger.debug("[VideoEncoder] No encoder, nothing to finish")
            return
        }

        val count = frameCount.get()
        val segmentFile = currentSegmentFile
        val startTime = if (segmentFirstFrameTimestamp.get() > 0) {
            segmentFirstFrameTimestamp.get()
        } else {
            segmentStartTime.get()
        }
        val endTime = if (lastFrameTimestamp.get() > 0) {
            lastFrameTimestamp.get()
        } else {
            System.currentTimeMillis()
        }
        val width = currentFrameWidth
        val height = currentFrameHeight

        if (count == 0) {
            Logger.debug("[VideoEncoder] No frames in segment, canceling")
            cancelSegment()
            return
        }

        try {
            encoderLock.withLock {
                enc.signalEndOfInputStream()
                
                drainEncoder(true)
            }

            if (muxerStarted.get()) {
                muxer?.stop()
            }

            val fileSize = segmentFile?.length() ?: 0
            Logger.info("[VideoEncoder] Segment complete - $count frames, ${fileSize / 1024.0} KB, ${(endTime - startTime) / 1000.0}s")

            segmentFile?.let {
                delegate?.onSegmentFinished(it, startTime, endTime, count)
            }

        } catch (e: Exception) {
            Logger.error("[VideoEncoder] Failed to finish segment", e)
            delegate?.onEncodingError(e)
        } finally {
            cleanup()

            if (shouldContinue && sessionId != null) {
                Logger.debug("[VideoEncoder] Starting new segment after rotation")
                startSegment(originalRequestedWidth, originalRequestedHeight)
            }
        }
    }

    /**
     * Cancels the current segment without saving.
     */
    fun cancelSegment() {
        cleanup()
        currentSegmentFile?.delete()
        currentSegmentFile = null
        frameCount.set(0)
        lastFrameTimestamp.set(0)
        segmentFirstFrameTimestamp.set(0)
        presentationTimesUs.clear()
        lastPresentationTimeUs = 0L
        Logger.debug("[VideoEncoder] Segment canceled")
    }

    /**
     * Cleans up encoder resources and pending segments.
     */
    fun cleanup() {
        try {
            inputSurface?.release()
            inputSurface = null
        } catch (e: Exception) {
            Logger.debug("[VideoEncoder] Error releasing input surface: ${e.message}")
        }

        try {
            encoder?.stop()
        } catch (e: Exception) {
            Logger.debug("[VideoEncoder] Error stopping encoder: ${e.message}")
        }

        try {
            encoder?.release()
        } catch (e: Exception) {
            Logger.debug("[VideoEncoder] Error releasing encoder: ${e.message}")
        }
        encoder = null

        try {
            if (muxerStarted.get()) {
                muxer?.release()
            }
        } catch (e: Exception) {
            Logger.debug("[VideoEncoder] Error releasing muxer: ${e.message}")
        }
        muxer = null
        muxerStarted.set(false)
        trackIndex = -1
        presentationTimesUs.clear()
        lastPresentationTimeUs = 0L

        stopEncodingThread()
    }

    /**
     * Emergency synchronous flush for crash handling.
     * Attempts to finalize the current segment so it can be recovered.
     *
     * @return true if segment was successfully finalized, false otherwise
     */
    fun emergencyFlushSync(): Boolean {
        if (!isRecording || frameCount.get() == 0) {
            return false
        }

        Logger.warning("[VideoEncoder] Emergency flush - attempting to save ${frameCount.get()} frames")

        return try {
            saveCrashSegmentMetadata()

            encoderLock.withLock {
                encoder?.signalEndOfInputStream()
                drainEncoder(true)
            }

            if (muxerStarted.get()) {
                muxer?.stop()
            }

            Logger.info("[VideoEncoder] Emergency flush succeeded")
            true
        } catch (e: Exception) {
            Logger.error("[VideoEncoder] Emergency flush failed", e)
            false
        } finally {
            cleanup()
        }
    }

    private fun saveCrashSegmentMetadata() {
        try {
            val metaFile = File(segmentDir, "pending_crash_segment.json")
            val meta = """
                {
                    "sessionId": "${sessionId ?: ""}",
                    "segmentFile": "${currentSegmentFile?.absolutePath ?: ""}",
                    "startTime": ${segmentFirstFrameTimestamp.get()},
                    "endTime": ${lastFrameTimestamp.get()},
                    "frameCount": ${frameCount.get()}
                }
            """.trimIndent()
            metaFile.writeText(meta)
        } catch (e: Exception) {
            Logger.error("[VideoEncoder] Failed to save crash segment metadata", e)
        }
    }

    private fun configureEncoder(width: Int, height: Int) {
        val codecInfo = findEncoder(MediaFormat.MIMETYPE_VIDEO_AVC)
            ?: throw IllegalStateException("No H.264 encoder available")

        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, targetBitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, keyframeInterval)

            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline)
                setInteger(MediaFormat.KEY_LEVEL, MediaCodecInfo.CodecProfileLevel.AVCLevel31)
            }
        }

        encoder = MediaCodec.createByCodecName(codecInfo.name).apply {
            configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            inputSurface = createInputSurface()
            start()
        }

        muxer = MediaMuxer(currentSegmentFile!!.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

        Logger.debug("[VideoEncoder] Encoder configured: ${codecInfo.name} ${width}x${height} @ ${targetBitrate}bps")
    }

    private fun findEncoder(mimeType: String): MediaCodecInfo? {
        val codecList = MediaCodecList(MediaCodecList.REGULAR_CODECS)
        for (codecInfo in codecList.codecInfos) {
            if (!codecInfo.isEncoder) continue
            for (type in codecInfo.supportedTypes) {
                if (type.equals(mimeType, ignoreCase = true)) {
                    return codecInfo
                }
            }
        }
        return null
    }

    private fun computePresentationTimeUs(timestamp: Long): Long {
        val firstTimestamp = segmentFirstFrameTimestamp.get().takeIf { it > 0 } ?: timestamp
        var presentationTimeUs = ((timestamp - firstTimestamp).coerceAtLeast(0L)) * 1000L
        if (presentationTimeUs <= lastPresentationTimeUs) {
            presentationTimeUs = lastPresentationTimeUs + 1
        }
        lastPresentationTimeUs = presentationTimeUs
        return presentationTimeUs
    }

    private fun drainEncoder(endOfStream: Boolean) {
        val enc = encoder ?: return
        val mux = muxer ?: return

        while (true) {
            val outputBufferIndex = enc.dequeueOutputBuffer(bufferInfo, 10000)

            when {
                outputBufferIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                    if (!endOfStream) break
                }

                outputBufferIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    if (muxerStarted.get()) {
                        Logger.warning("[VideoEncoder] Format changed after muxer started")
                    }
                    val newFormat = enc.outputFormat
                    trackIndex = mux.addTrack(newFormat)
                    mux.start()
                    muxerStarted.set(true)
                    Logger.debug("[VideoEncoder] Muxer started with track $trackIndex")
                }

                outputBufferIndex >= 0 -> {
                    val encodedData = enc.getOutputBuffer(outputBufferIndex)
                        ?: throw RuntimeException("Encoder output buffer $outputBufferIndex was null")

                    if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                        bufferInfo.size = 0
                    }

                    if (bufferInfo.size > 0 && muxerStarted.get()) {
                        encodedData.position(bufferInfo.offset)
                        encodedData.limit(bufferInfo.offset + bufferInfo.size)

                        val presentationTimeUs = if (presentationTimesUs.isNotEmpty()) {
                            presentationTimesUs.removeFirst()
                        } else {
                            (frameCount.get() * 1_000_000L) / fps
                        }
                        bufferInfo.presentationTimeUs = presentationTimeUs

                        mux.writeSampleData(trackIndex, encodedData, bufferInfo)
                    }

                    enc.releaseOutputBuffer(outputBufferIndex, false)

                    if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                        Logger.debug("[VideoEncoder] End of stream reached")
                        break
                    }
                }

                else -> {
                    Logger.warning("[VideoEncoder] Unexpected output buffer result: $outputBufferIndex")
                }
            }
        }
    }

    private fun startEncodingThread() {
        if (encodingThread != null) return

        encodingThread = HandlerThread("VideoEncoderThread").apply {
            start()
        }
        encodingHandler = Handler(encodingThread!!.looper)
    }

    private fun stopEncodingThread() {
        encodingThread?.quitSafely()
        try {
            encodingThread?.join(100)
        } catch (e: InterruptedException) {
            Logger.debug("[VideoEncoder] Interrupted waiting for encoding thread")
        }
        encodingThread = null
        encodingHandler = null
    }

    companion object {
        @Volatile
        private var staticPrewarmed = false
        
        /**
         * Class-level encoder pre-warm to eliminate first-frame encoding spike.
         * Call this during CaptureEngine initialization before first session.
         * 
         * This matches iOS +[RJVideoEncoder prewarmEncoderAsync] behavior:
         * - Runs on background thread to avoid blocking main thread
         * - Uses dispatch_once equivalent (synchronized + flag) to run only once
         * - Front-loads ~50-100ms of MediaCodec initialization cost
         */
        fun prewarmEncoderAsync() {
            if (staticPrewarmed) return
            
            Thread {
                synchronized(this) {
                    if (staticPrewarmed) return@Thread
                    staticPrewarmed = true
                }
                
                try {
                    val startTime = System.nanoTime()
                    
                    val codecList = MediaCodecList(MediaCodecList.REGULAR_CODECS)
                    val codecInfos = codecList.codecInfos
                    
                    var encoderName: String? = null
                    for (info in codecInfos) {
                        if (!info.isEncoder) continue
                        try {
                            val types = info.supportedTypes
                            if (types.any { it.equals(MediaFormat.MIMETYPE_VIDEO_AVC, ignoreCase = true) }) {
                                encoderName = info.name
                                val caps = info.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC)
                                caps.videoCapabilities
                                caps.encoderCapabilities
                                break
                            }
                        } catch (_: Exception) {
                            continue
                        }
                    }

                    if (encoderName != null) {
                        try {
                            var warmSurface: Surface? = null
                            val codec = MediaCodec.createByCodecName(encoderName)
                            val warmFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, 128, 128).apply {
                                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                                setInteger(MediaFormat.KEY_BIT_RATE, 250_000)
                                setInteger(MediaFormat.KEY_FRAME_RATE, 15)
                                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
                            }
                            codec.configure(warmFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                            warmSurface = codec.createInputSurface()
                            codec.start()
                            codec.signalEndOfInputStream()
                            val info = MediaCodec.BufferInfo()
                            val timeoutUs = 10_000L
                            while (true) {
                                val index = codec.dequeueOutputBuffer(info, timeoutUs)
                                if (index >= 0) {
                                    codec.releaseOutputBuffer(index, false)
                                    if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                                        break
                                    }
                                } else if (index == MediaCodec.INFO_TRY_AGAIN_LATER) {
                                    break
                                }
                            }
                            try { codec.stop() } catch (_: Exception) {}
                            try { warmSurface?.release() } catch (_: Exception) {}
                            try { codec.release() } catch (_: Exception) {}
                        } catch (e: Exception) {
                            Logger.warning("[VideoEncoder] Class prewarm codec path failed: ${e.message}")
                        }
                    }
                    
                    val elapsed = (System.nanoTime() - startTime) / 1_000_000.0
                    Logger.info("[VideoEncoder] H.264 class prewarm completed in ${elapsed}ms (encoder: $encoderName)")
                    
                } catch (e: Exception) {
                    Logger.warning("[VideoEncoder] Class prewarm failed: ${e.message}")
                }
            }.start()
        }
        
        /**
         * Checks if there is a pending video segment from a crash.
         *
         * @param segmentDir The segment directory to check
         * @return Segment metadata if a pending segment exists, null otherwise
         */
        fun getPendingCrashSegmentMetadata(segmentDir: File): Map<String, Any>? {
            val metaFile = File(segmentDir, "pending_crash_segment.json")
            if (!metaFile.exists()) return null

            return try {
                val json = metaFile.readText()
                val result = mutableMapOf<String, Any>()
                json.lines().forEach { line ->
                    val trimmed = line.trim().removeSuffix(",")
                    when {
                        trimmed.contains("\"sessionId\"") -> {
                            result["sessionId"] = trimmed.substringAfter(":").trim().removeSurrounding("\"")
                        }
                        trimmed.contains("\"segmentFile\"") -> {
                            result["segmentFile"] = trimmed.substringAfter(":").trim().removeSurrounding("\"")
                        }
                        trimmed.contains("\"startTime\"") -> {
                            result["startTime"] = trimmed.substringAfter(":").trim().toLongOrNull() ?: 0L
                        }
                        trimmed.contains("\"endTime\"") -> {
                            result["endTime"] = trimmed.substringAfter(":").trim().toLongOrNull() ?: 0L
                        }
                        trimmed.contains("\"frameCount\"") -> {
                            result["frameCount"] = trimmed.substringAfter(":").trim().toIntOrNull() ?: 0
                        }
                    }
                }
                result.ifEmpty { null }
            } catch (e: Exception) {
                Logger.error("[VideoEncoder] Failed to read crash segment metadata", e)
                null
            }
        }

        /**
         * Clears the pending crash segment metadata after recovery.
         */
        fun clearPendingCrashSegmentMetadata(segmentDir: File) {
            try {
                File(segmentDir, "pending_crash_segment.json").delete()
            } catch (e: Exception) {
                Logger.debug("[VideoEncoder] Failed to clear crash segment metadata: ${e.message}")
            }
        }
    }
}
