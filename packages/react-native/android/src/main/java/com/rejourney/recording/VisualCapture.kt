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
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.EditText
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
        DiagnosticLog.trace("[VisualCapture] setCurrentActivity: ${activity?.javaClass?.simpleName ?: "null"}")
    }
    
    fun beginCapture(sessionOrigin: Long) {
        DiagnosticLog.trace("[VisualCapture] beginCapture called, currentActivity=${currentActivity?.get()?.javaClass?.simpleName ?: "null"}, state=${stateMachine.currentState}")
        if (!stateMachine.transition(CaptureState.CAPTURING)) {
            DiagnosticLog.trace("[VisualCapture] beginCapture REJECTED - state transition failed from ${stateMachine.currentState}")
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
    
    fun invalidateMaskCache() {
        redactionMask.invalidateCache()
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
        if (currentFrameNum < 3) {
            DiagnosticLog.trace("[VisualCapture] captureFrame #$currentFrameNum, state=${stateMachine.currentState}, activity=${currentActivity?.get()?.javaClass?.simpleName ?: "null"}")
        }
        
        if (stateMachine.currentState != CaptureState.CAPTURING) {
            DiagnosticLog.trace("[VisualCapture] captureFrame skipped - state=${stateMachine.currentState}")
            return
        }
        
        val activity = currentActivity?.get()
        if (activity == null) {
            DiagnosticLog.trace("[VisualCapture] captureFrame skipped - no activity")
            return
        }
        
        // Refresh map detection state (very cheap shallow walk)
        SpecialCases.shared.refreshMapState(activity)
        
        // Map stutter prevention: when a map view is visible and its camera
        // is still moving (user gesture or animation), skip decorView.draw()
        // entirely — this call triggers GPU readback on SurfaceView/TextureView
        // map tiles which causes visible stutter.  We resume capture at 1 FPS
        // once the map SDK reports idle.
        if (!force && SpecialCases.shared.mapVisible && !SpecialCases.shared.mapIdle) {
            if (currentFrameNum < 3 || currentFrameNum % 30 == 0L) {
                DiagnosticLog.trace("[VisualCapture] SKIPPING capture - map moving (mapIdle=false)")
            }
            return
        }
        
        val frameStart = SystemClock.elapsedRealtime()
        
        try {
            val window = activity.window ?: return
            val decorView = window.decorView
            val bounds = Rect()
            decorView.getWindowVisibleDisplayFrame(bounds)
            
            if (bounds.width() <= 0 || bounds.height() <= 0) return
            
            val redactRects = redactionMask.computeRects(decorView)
            
            val screenScale = 1.25f
            val scaledWidth = (bounds.width() / screenScale).toInt()
            val scaledHeight = (bounds.height() / screenScale).toInt()
            
            // 1. Draw the View tree (captures everything except GPU surfaces)
            val bitmap = Bitmap.createBitmap(scaledWidth, scaledHeight, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            canvas.scale(1f / screenScale, 1f / screenScale)
            decorView.draw(canvas)
            
            // 2. Composite GPU surfaces (TextureView/SurfaceView) on top.
            //    decorView.draw() renders these as black; we grab their pixels
            //    directly and paint them at the correct position.
            compositeGpuSurfaces(decorView, canvas, screenScale)
            
            processCapture(bitmap, redactRects, screenScale, frameStart, force)
            
        } catch (e: Exception) {
            DiagnosticLog.fault("Frame capture failed: ${e.message}")
        }
    }
    
    /**
     * Find all TextureView instances in the hierarchy and draw their GPU-rendered
     * content onto the capture canvas at the correct position.  decorView.draw()
     * renders TextureView/SurfaceView as black; this fills in the actual pixels.
     *
     * Mapbox uses SurfaceView by default, so we use MapView.snapshot() to capture
     * the map and composite it at the correct position.
     */
    private fun compositeGpuSurfaces(root: View, canvas: Canvas, screenScale: Float) {
        findTextureViews(root) { tv ->
            try {
                val tvBitmap = tv.bitmap ?: return@findTextureViews
                val loc = IntArray(2)
                tv.getLocationInWindow(loc)
                canvas.drawBitmap(tvBitmap, loc[0].toFloat(), loc[1].toFloat(), null)
                tvBitmap.recycle()
            } catch (_: Exception) {
                // Safety: never crash if TextureView.getBitmap() fails
            }
        }
        compositeMapboxSnapshot(root, canvas)
    }

    /**
     * Mapbox MapView uses SurfaceView; decorView.draw() renders it black.
     * Use MapView.snapshot() (Mapbox SDK API) to capture the map and composite it.
     */
    private fun compositeMapboxSnapshot(root: View, canvas: Canvas) {
        val mapView = SpecialCases.shared.getMapboxMapViewForSnapshot(root) ?: return
        try {
            val snapshot = mapView.javaClass.getMethod("snapshot").invoke(mapView)
            val bitmap = snapshot as? Bitmap ?: return
            val loc = IntArray(2)
            mapView.getLocationInWindow(loc)
            canvas.drawBitmap(bitmap, loc[0].toFloat(), loc[1].toFloat(), null)
            bitmap.recycle()
        } catch (e: Exception) {
            DiagnosticLog.trace("[VisualCapture] Mapbox snapshot failed: ${e.message}")
        }
    }
    
    private fun findTextureViews(view: View, action: (TextureView) -> Unit) {
        if (view is TextureView && view.isAvailable) {
            action(view)
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                findTextureViews(view.getChildAt(i), action)
            }
        }
    }
    
    private fun processCapture(
        bitmap: Bitmap,
        redactRects: List<Rect>,
        screenScale: Float,
        frameStart: Long,
        force: Boolean
    ) {
        // Apply redactions
        if (redactRects.isNotEmpty()) {
            val canvas = Canvas(bitmap)
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
        
        if (frameNum == 1L) {
            DiagnosticLog.trace("[VisualCapture] First frame captured! size=${data.size} bytes")
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
        
        DiagnosticLog.trace("[VisualCapture] sendScreenshots: sending ${images.size} frames")
        
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
    
    fun uploadPendingFrames(sessionId: String, completion: ((Boolean) -> Unit)? = null) {
        val framesPath = File(context.cacheDir, "rj_pending/$sessionId/frames")
        
        if (!framesPath.exists()) {
            completion?.invoke(true)
            return
        }
        
        val frameFiles = framesPath.listFiles()?.sortedBy { it.name } ?: run {
            completion?.invoke(true)
            return
        }
        
        val frames = mutableListOf<Pair<ByteArray, Long>>()
        for (file in frameFiles) {
            if (file.extension != "jpeg") continue
            val data = try { file.readBytes() } catch (_: Exception) { continue }
            val ts = file.nameWithoutExtension.toLongOrNull() ?: continue
            frames.add(Pair(data, ts))
        }
        
        if (frames.isEmpty()) {
            completion?.invoke(true)
            return
        }
        
        val bundle = packageFrameBundle(frames, frames.first().second) ?: run {
            completion?.invoke(false)
            return
        }
        
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
            completion?.invoke(ok)
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
    
    private val cachedAutoRects = mutableListOf<Rect>()
    private var lastScanTime = 0L
    private val scanCacheDurationMs = 500L
    
    fun add(view: View) {
        views.add(WeakReference(view))
    }
    
    fun remove(view: View) {
        views.removeIf { it.get() === view || it.get() == null }
    }
    
    fun invalidateCache() {
        lastScanTime = 0L
    }
    
    fun computeRects(decorView: View? = null): List<Rect> {
        val rects = mutableListOf<Rect>()
        views.removeIf { it.get() == null }
        
        for (ref in views) {
            val view = ref.get() ?: continue
            val rect = getViewRect(view)
            if (rect != null) rects.add(rect)
        }
        
        if (decorView != null) {
            val now = SystemClock.elapsedRealtime()
            if (now - lastScanTime >= scanCacheDurationMs) {
                cachedAutoRects.clear()
                scanForSensitiveViews(decorView, cachedAutoRects)
                lastScanTime = now
            }
            rects.addAll(cachedAutoRects)
        }
        
        return rects
    }
    
    private fun getViewRect(view: View): Rect? {
        if (!view.isShown || view.width <= 0 || view.height <= 0) return null
        val location = IntArray(2)
        view.getLocationOnScreen(location)
        val rect = Rect(
            location[0],
            location[1],
            location[0] + view.width,
            location[1] + view.height
        )
        if (rect.width() > 0 && rect.height() > 0) return rect
        return null
    }

    private fun scanForSensitiveViews(view: View, rects: MutableList<Rect>, depth: Int = 0) {
        if (depth > 20) return
        if (!view.isShown || view.alpha <= 0.01f || view.width <= 0 || view.height <= 0) return
        
        if (shouldMask(view)) {
            val rect = getViewRect(view)
            if (rect != null) {
                rects.add(rect)
                return
            }
        }
        
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                scanForSensitiveViews(view.getChildAt(i), rects, depth + 1)
            }
        }
    }

    private fun shouldMask(view: View): Boolean {
        if (view.contentDescription?.toString() == "rejourney_occlude") return true
        
        try {
            val hint = view.getTag(com.facebook.react.R.id.accessibility_hint) as? String
            if (hint == "rejourney_occlude") return true
        } catch (_: Exception) { }
        
        if (view is EditText) return true
        
        val className = view.javaClass.simpleName.lowercase(java.util.Locale.US)
        if (className.contains("camera") || (className.contains("surfaceview") && className.contains("preview"))) {
            return true
        }
        
        return false
    }
}
