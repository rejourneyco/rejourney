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

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import com.rejourney.engine.DiagnosticLog
import com.rejourney.utility.gzipCompress
import java.io.ByteArrayOutputStream
import java.io.File
import java.lang.ref.WeakReference
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Screen capture and frame packaging
 * Android implementation aligned with iOS VisualCapture.swift
 */
class VisualCapture private constructor(private val context: Context) {
    
    companion object {
        @Volatile
        private var instance: VisualCapture? = null
        
        fun getInstance(context: Context): VisualCapture {
            return instance ?: synchronized(this) {
                instance ?: VisualCapture(context.applicationContext).also { instance = it }
            }
        }
        
        val shared: VisualCapture?
            get() = instance
    }
    
    var snapshotInterval: Double = 1.0
    var quality: Float = 0.5f
    
    val isCapturing: Boolean
        get() = stateMachine.currentState == CaptureState.CAPTURING
    
    private val stateMachine = CaptureStateMachine()
    private val screenshots = CopyOnWriteArrayList<Pair<ByteArray, Long>>()
    private val stateLock = ReentrantLock()
    private var captureRunnable: Runnable? = null
    private val frameCounter = AtomicLong(0)
    private var sessionEpoch: Long = 0
    private val redactionMask = RedactionMask()
    private var deferredUntilCommit = false
    private var framesDiskPath: File? = null
    private var currentSessionId: String? = null
    
    private val mainHandler = Handler(Looper.getMainLooper())
    
    // Use single thread executor for encoding (industry standard)
    private val encodeExecutor = Executors.newSingleThreadExecutor()
    
    // Backpressure limits to prevent stutter
    private val maxPendingBatches = 50
    private val maxBufferedScreenshots = 500
    
    // Industry standard batch size (20 frames per batch)
    private val batchSize = 20
    
    // Current activity reference
    private var currentActivity: WeakReference<Activity>? = null

    
    fun setCurrentActivity(activity: Activity?) {
        currentActivity = if (activity != null) WeakReference(activity) else null
        DiagnosticLog.notice("[VisualCapture] setCurrentActivity: ${activity?.javaClass?.simpleName ?: "null"}")
    }
    
    fun beginCapture(sessionOrigin: Long) {
        DiagnosticLog.notice("[VisualCapture] beginCapture called, currentActivity=${currentActivity?.get()?.javaClass?.simpleName ?: "null"}, state=${stateMachine.currentState}")
        DiagnosticLog.trace("[VisualCapture] beginCapture called, currentActivity=${currentActivity?.get()?.javaClass?.simpleName ?: "null"}")
        if (!stateMachine.transition(CaptureState.CAPTURING)) {
            DiagnosticLog.notice("[VisualCapture] beginCapture REJECTED - state transition failed from ${stateMachine.currentState}")
            DiagnosticLog.trace("[VisualCapture] beginCapture failed - state transition rejected")
            return
        }
        sessionEpoch = sessionOrigin
        frameCounter.set(0)
        
        // Set up disk persistence for frames
        currentSessionId = TelemetryPipeline.shared?.currentReplayId
        currentSessionId?.let { sid ->
            framesDiskPath = File(context.cacheDir, "rj_pending/$sid/frames").also {
                it.mkdirs()
            }
        }
        
        DiagnosticLog.notice("[VisualCapture] Starting capture timer with interval=${snapshotInterval}s")
        DiagnosticLog.trace("[VisualCapture] Starting capture timer with interval=${snapshotInterval}s")
        startCaptureTimer()
    }
    
    fun halt() {
        if (!stateMachine.transition(CaptureState.HALTED)) return
        stopCaptureTimer()
        
        // Flush any remaining frames to disk before halting
        flushBufferToDisk()
        flushBuffer()
        
        stateLock.withLock {
            screenshots.clear()
        }
    }
    
    fun flushToDisk() {
        flushBufferToDisk()
    }
    
    /** Submit any buffered frames to the upload pipeline immediately
     *  (regardless of batch size threshold). Packages synchronously to
     *  avoid race conditions during backgrounding. */
    fun flushBufferToNetwork() {
        // Take frames from buffer synchronously (not via async sendScreenshots)
        val images = stateLock.withLock {
            val copy = screenshots.toList()
            screenshots.clear()
            copy
        }
        if (images.isEmpty()) return
        // Package and submit synchronously on this thread
        packageAndShip(images, sessionEpoch)
    }
    
    fun activateDeferredMode() {
        deferredUntilCommit = true
    }
    
    fun commitDeferredData() {
        deferredUntilCommit = false
        flushBuffer()
    }
    
    fun registerRedaction(view: View) {
        redactionMask.add(view)
    }
    
    fun unregisterRedaction(view: View) {
        redactionMask.remove(view)
    }
    
    fun configure(snapshotInterval: Double, jpegQuality: Double) {
        this.snapshotInterval = snapshotInterval
        this.quality = jpegQuality.toFloat()
        if (stateMachine.currentState == CaptureState.CAPTURING) {
            stopCaptureTimer()
            startCaptureTimer()
        }
    }
    
    fun snapshotNow() {
        mainHandler.post { captureFrame(force = true) }
    }
    
    private fun startCaptureTimer() {
        stopCaptureTimer()
        captureRunnable = object : Runnable {
            override fun run() {
                captureFrame(force = false)
                mainHandler.postDelayed(this, (snapshotInterval * 1000).toLong())
            }
        }
        mainHandler.postDelayed(captureRunnable!!, (snapshotInterval * 1000).toLong())
    }
    
    private fun stopCaptureTimer() {
        captureRunnable?.let { mainHandler.removeCallbacks(it) }
        captureRunnable = null
    }
    
    private fun captureFrame(force: Boolean = false) {
        val currentFrameNum = frameCounter.get()
        // Log first 3 frames at notice level
        if (currentFrameNum < 3) {
            DiagnosticLog.notice("[VisualCapture] captureFrame #$currentFrameNum, state=${stateMachine.currentState}, activity=${currentActivity?.get()?.javaClass?.simpleName ?: "null"}")
        }
        
        if (stateMachine.currentState != CaptureState.CAPTURING) {
            DiagnosticLog.notice("[VisualCapture] captureFrame skipped - state=${stateMachine.currentState}")
            DiagnosticLog.trace("[VisualCapture] captureFrame skipped - state=${stateMachine.currentState}")
            return
        }
        
        val activity = currentActivity?.get()
        if (activity == null) {
            if (currentFrameNum < 3) {
                DiagnosticLog.notice("[VisualCapture] captureFrame skipped - NO ACTIVITY")
            }
            DiagnosticLog.trace("[VisualCapture] captureFrame skipped - no activity")
            return
        }
        
        val frameStart = SystemClock.elapsedRealtime()
        
        try {
            val decorView = activity.window?.decorView ?: return
            val bounds = Rect()
            decorView.getWindowVisibleDisplayFrame(bounds)
            
            if (bounds.width() <= 0 || bounds.height() <= 0) return
            
            val redactRects = redactionMask.computeRects()
            
            val screenScale = 1.25f
            val scaledWidth = (bounds.width() / screenScale).toInt()
            val scaledHeight = (bounds.height() / screenScale).toInt()
            
            val bitmap = Bitmap.createBitmap(scaledWidth, scaledHeight, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            canvas.scale(1f / screenScale, 1f / screenScale)
            
            decorView.draw(canvas)
            
            // Apply redactions
            if (redactRects.isNotEmpty()) {
                val paint = Paint().apply {
                    color = Color.BLACK
                    style = Paint.Style.FILL
                }
                for (rect in redactRects) {
                    if (rect.width() > 0 && rect.height() > 0) {
                        canvas.drawRect(
                            rect.left / screenScale,
                            rect.top / screenScale,
                            rect.right / screenScale,
                            rect.bottom / screenScale,
                            paint
                        )
                    }
                }
            }
            
            // Compress to JPEG
            val stream = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, (quality * 100).toInt(), stream)
            bitmap.recycle()
            
            val data = stream.toByteArray()
            val captureTs = System.currentTimeMillis()
            val frameNum = frameCounter.incrementAndGet()
            
            // Log first frame and every 30 frames
            if (frameNum == 1L) {
                DiagnosticLog.notice("[VisualCapture] First frame captured! size=${data.size} bytes")
            }
            if (frameNum % 30 == 0L) {
                val frameDurationMs = (SystemClock.elapsedRealtime() - frameStart).toDouble()
                val isMainThread = Looper.myLooper() == Looper.getMainLooper()
                DiagnosticLog.perfFrame("screenshot", frameDurationMs, frameNum.toInt(), isMainThread)
            }
            
            // Store in buffer
            stateLock.withLock {
                screenshots.add(Pair(data, captureTs))
                enforceScreenshotCaps()
                val shouldSend = !deferredUntilCommit && screenshots.size >= batchSize
                
                if (shouldSend) {
                    sendScreenshots()
                }
            }
            
        } catch (e: Exception) {
            DiagnosticLog.fault("Frame capture failed: ${e.message}")
        }
    }
    

    
    private fun enforceScreenshotCaps() {
        while (screenshots.size > maxBufferedScreenshots) {
            screenshots.removeAt(0)
        }
    }
    
    private fun sendScreenshots() {
        // Check backpressure
        // Copy and clear under lock
        val images = stateLock.withLock {
            val copy = screenshots.toList()
            screenshots.clear()
            copy
        }
        
        if (images.isEmpty()) {
            DiagnosticLog.trace("[VisualCapture] sendScreenshots: no images to send")
            return
        }
        
        DiagnosticLog.notice("[VisualCapture] sendScreenshots: sending ${images.size} frames")
        
        // All heavy work happens in background
        encodeExecutor.execute {
            packageAndShip(images, sessionEpoch)
        }
    }
    
    private fun packageAndShip(images: List<Pair<ByteArray, Long>>, sessionEpoch: Long) {
        val batchStart = SystemClock.elapsedRealtime()
        
        val bundle = packageFrameBundle(images, sessionEpoch) ?: return
        
        val rid = TelemetryPipeline.shared?.currentReplayId ?: "unknown"
        val endTs = images.lastOrNull()?.second ?: sessionEpoch
        val fname = "$rid-$endTs.tar.gz"
        
        val packDurationMs = (SystemClock.elapsedRealtime() - batchStart).toDouble()
        val isMainThread = Looper.myLooper() == Looper.getMainLooper()
        DiagnosticLog.perfBatch("package-frames", images.size, packDurationMs, isMainThread)
        
        TelemetryPipeline.shared?.submitFrameBundle(
            payload = bundle,
            filename = fname,
            startMs = images.firstOrNull()?.second ?: sessionEpoch,
            endMs = endTs,
            frameCount = images.size
        )
    }
    
    private fun packageFrameBundle(images: List<Pair<ByteArray, Long>>, sessionEpoch: Long): ByteArray? {
        // Create simple tar-like format and gzip it
        val tarStream = ByteArrayOutputStream()
        
        for ((jpeg, timestamp) in images) {
            // Simple frame header: timestamp (8 bytes) + size (4 bytes) + data
            val ts = timestamp - sessionEpoch
            tarStream.write(longToBytes(ts))
            tarStream.write(intToBytes(jpeg.size))
            tarStream.write(jpeg)
        }
        
        return tarStream.toByteArray().gzipCompress()
    }
    
    private fun longToBytes(value: Long): ByteArray {
        return ByteArray(8) { i -> (value shr (56 - 8 * i)).toByte() }
    }
    
    private fun intToBytes(value: Int): ByteArray {
        return ByteArray(4) { i -> (value shr (24 - 8 * i)).toByte() }
    }
    
    private fun flushBufferToDisk() {
        val frames = stateLock.withLock { screenshots.toList() }
        
        val path = framesDiskPath ?: return
        
        for ((jpeg, timestamp) in frames) {
            val framePath = File(path, "$timestamp.jpeg")
            if (!framePath.exists()) {
                try {
                    framePath.writeBytes(jpeg)
                } catch (_: Exception) { }
            }
        }
    }
    
    private fun flushBuffer() {
        sendScreenshots()
    }
    
    fun uploadPendingFrames(sessionId: String) {
        val framesPath = File(context.cacheDir, "rj_pending/$sessionId/frames")
        
        if (!framesPath.exists()) return
        
        val frameFiles = framesPath.listFiles()?.sortedBy { it.name } ?: return
        
        val frames = mutableListOf<Pair<ByteArray, Long>>()
        for (file in frameFiles) {
            if (file.extension != "jpeg") continue
            val data = try { file.readBytes() } catch (_: Exception) { continue }
            val ts = file.nameWithoutExtension.toLongOrNull() ?: continue
            frames.add(Pair(data, ts))
        }
        
        if (frames.isEmpty()) return
        
        val bundle = packageFrameBundle(frames, frames.first().second) ?: return
        
        SegmentDispatcher.shared.transmitFrameBundle(
            payload = bundle,
            startMs = frames.first().second,
            endMs = frames.last().second,
            frameCount = frames.size
        ) { ok ->
            if (ok) {
                // Clean up files on success
                frameFiles.forEach { it.delete() }
                framesPath.delete()
            }
        }
    }
}

private enum class CaptureState {
    IDLE,
    CAPTURING,
    HALTED
}

private class CaptureStateMachine {
    var currentState: CaptureState = CaptureState.IDLE
        private set
    
    private val lock = ReentrantLock()
    
    fun transition(to: CaptureState): Boolean {
        lock.withLock {
            val allowed = when (currentState) {
                CaptureState.IDLE -> to == CaptureState.CAPTURING
                CaptureState.CAPTURING -> to == CaptureState.HALTED
                CaptureState.HALTED -> to == CaptureState.IDLE || to == CaptureState.CAPTURING
            }
            if (allowed) {
                currentState = to
            }
            return allowed
        }
    }
}

private class RedactionMask {
    private val views = CopyOnWriteArrayList<WeakReference<View>>()
    
    fun add(view: View) {
        views.add(WeakReference(view))
    }
    
    fun remove(view: View) {
        views.removeIf { it.get() === view || it.get() == null }
    }
    
    fun computeRects(): List<Rect> {
        val rects = mutableListOf<Rect>()
        views.removeIf { it.get() == null }
        
        for (ref in views) {
            val view = ref.get() ?: continue
            if (!view.isShown) continue
            
            val location = IntArray(2)
            view.getLocationOnScreen(location)
            
            val rect = Rect(
                location[0],
                location[1],
                location[0] + view.width,
                location[1] + view.height
            )
            
            if (rect.width() > 0 && rect.height() > 0) {
                rects.add(rect)
            }
        }
        
        return rects
    }
}
