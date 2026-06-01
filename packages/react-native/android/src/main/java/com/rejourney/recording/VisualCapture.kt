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
import android.graphics.RectF
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.ImageView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.rejourney.engine.DiagnosticLog
import com.rejourney.utility.gzipCompress
import java.io.ByteArrayOutputStream
import java.io.File
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.max
import kotlin.math.min

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
    private var framesDiskPath: File? = null
    private var currentSessionId: String? = null
    @Volatile var captureGeneration: Int = 0
        private set
    
    private val mainHandler = Handler(Looper.getMainLooper())
    private val pixelCopyThread = HandlerThread("rejourney-pixel-copy").apply { start() }
    private val pixelCopyHandler = Handler(pixelCopyThread.looper)
    private val placeholderFillColor = Color.WHITE
    private val placeholderForegroundColor = Color.rgb(15, 23, 42)
    private val maxGpuSurfaceScanDepth = 120
    
    // Use single thread executor for encoding (industry standard)
    private val encodeExecutor = Executors.newSingleThreadExecutor()
    
    // Backpressure limits to prevent stutter
    private val maxPendingBatches = 50
    private val maxBufferedScreenshots = 500
    
    /** Flush to the network after this many frames (smaller = more frequent uploads). */
    private var uploadBatchSize = 3
    
    // Current activity reference
    private var currentActivity: WeakReference<Activity>? = null

    
    fun setCurrentActivity(activity: Activity?) {
        currentActivity = if (activity != null) WeakReference(activity) else null
        DiagnosticLog.trace("[VisualCapture] setCurrentActivity: ${activity?.javaClass?.simpleName ?: "null"}")
    }
    
    fun beginCapture(sessionOrigin: Long) {
        DiagnosticLog.trace("[VisualCapture] beginCapture called, currentActivity=${currentActivity?.get()?.javaClass?.simpleName ?: "null"}, state=${stateMachine.currentState}")

        // If we're still in CAPTURING state (halt() from previous session hasn't
        // run yet due to async mainHandler.post), force-halt first to prevent the
        // stale halt from stopping the new session's capture later.
        if (stateMachine.currentState == CaptureState.CAPTURING) {
            DiagnosticLog.trace("[VisualCapture] Force-halting stale capture before starting new session")
            stopCaptureTimer()
            stateMachine.transition(CaptureState.HALTED)
        }

        if (!stateMachine.transition(CaptureState.CAPTURING)) {
            DiagnosticLog.trace("[VisualCapture] beginCapture REJECTED - state transition failed from ${stateMachine.currentState}")
            return
        }

        // Bump generation so any stale halt() posted by the previous session
        // (via mainHandler.post) becomes a no-op and doesn't stop this capture.
        captureGeneration++

        // Discard any frames left over from a previous session to prevent
        // cross-session frame leakage (frames from session A appearing in session B).
        stateLock.withLock {
            val staleCount = screenshots.size
            if (staleCount > 0) {
                DiagnosticLog.trace("[VisualCapture] Clearing $staleCount stale frames from previous session")
                screenshots.clear()
            }
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
        mainHandler.post { captureFrame(force = true) }
    }
    
    fun halt(expectedGeneration: Int = -1) {
        // If a specific generation is expected (async/posted halt from a previous
        // session), skip if a new session has already started capture.
        if (expectedGeneration >= 0 && expectedGeneration != captureGeneration) {
            DiagnosticLog.trace("[VisualCapture] Skipping stale halt (gen=$expectedGeneration, current=$captureGeneration)")
            return
        }
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
        val (images, captureSessionId) = stateLock.withLock {
            val copy = screenshots.toList()
            screenshots.clear()
            Pair(copy, currentSessionId)
        }
        if (images.isEmpty()) return
        // Package and submit synchronously on this thread
        packageAndShip(images, sessionEpoch, captureSessionId)
    }

    fun pauseForBackground() {
        if (stateMachine.currentState != CaptureState.CAPTURING) return
        stopCaptureTimer()
        flushBufferToNetwork()
    }

    fun resumeFromBackground() {
        if (stateMachine.currentState == CaptureState.CAPTURING && captureRunnable == null) {
            startCaptureTimer()
        }
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
    
    fun configure(snapshotInterval: Double, jpegQuality: Double, uploadBatchSize: Int = 3) {
        this.snapshotInterval = snapshotInterval
        this.quality = jpegQuality.toFloat()
        this.uploadBatchSize = uploadBatchSize.coerceIn(1, 100)
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
            val captureRoots = captureRoots(activity, decorView)
            if (!activity.hasWindowFocus() && !hasCapturableNativeSheetRoot(decorView, captureRoots)) {
                DiagnosticLog.trace("[VisualCapture] captureFrame skipped - activity not in foreground")
                return
            }
            val bounds = captureBounds(decorView)
            
            if (bounds.width() <= 0 || bounds.height() <= 0) return
            
            val redactionRegions = if (ReplayOrchestrator.shared?.maskImagesAndVideosByDefault == true) {
                redactionMask.computeRegions(decorViews = captureRoots) +
                    redactionMask.computeMediaRegions(decorViews = captureRoots)
            } else {
                redactionMask.computeRegions(decorViews = captureRoots)
            }
            val keyboardPlaceholderRect = keyboardPlaceholderRect(decorView, bounds)
            
            val pixelDensity = activity.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
            val screenScale = 1.25f * pixelDensity
            val scaledWidth = max(1, (bounds.width() / screenScale).toInt())
            val scaledHeight = max(1, (bounds.height() / screenScale).toInt())
            
            // 1. Draw the View tree (captures everything except GPU surfaces)
            val bitmap = Bitmap.createBitmap(scaledWidth, scaledHeight, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            canvas.scale(1f / screenScale, 1f / screenScale)
            decorView.draw(canvas)
            for (root in captureRoots) {
                if (root === decorView) continue
                val offset = rootOffsetFromDecor(decorView, root)
                canvas.save()
                canvas.translate(offset.first.toFloat(), offset.second.toFloat())
                root.draw(canvas)
                canvas.restore()
            }
            
            // 2. Composite GPU surfaces (TextureView/SurfaceView) on top.
            //    decorView.draw() renders these as black; we grab their pixels
            //    directly and paint them at the correct position.
            if (ReplayOrchestrator.shared?.maskImagesAndVideosByDefault != true) {
                for (root in captureRoots) {
                    val offset = rootOffsetFromDecor(decorView, root)
                    compositeGpuSurfaces(root, canvas, bitmap, screenScale, offset.first, offset.second)
                }
            }
            
            processCapture(bitmap, redactionRegions, keyboardPlaceholderRect, screenScale, frameStart, force)
            
        } catch (e: Exception) {
            DiagnosticLog.fault("Frame capture failed: ${e.message}")
        }
    }

    private fun captureRoots(activity: Activity, decorView: View): List<View> {
        val orchestrator = ReplayOrchestrator.shared
        if (orchestrator?.captureNativeSheets == false) return listOf(decorView)

        val roots = mutableListOf(decorView)
        try {
            val globalClass = Class.forName("android.view.WindowManagerGlobal")
            val instance = globalClass.getMethod("getInstance").invoke(null)
            val viewsField = globalClass.getDeclaredField("mViews")
            viewsField.isAccessible = true
            val views = viewsField.get(instance) as? List<*> ?: return roots
            for (candidate in views) {
                val root = candidate as? View ?: continue
                if (root === decorView || !root.isShown || root.width <= 0 || root.height <= 0) continue
                if (root.context?.packageName != activity.packageName) continue
                if (isKeyboardRoot(root)) continue
                roots.add(root)
            }
        } catch (e: Exception) {
            DiagnosticLog.trace("[VisualCapture] Native sheet root discovery unavailable: ${e.message}")
        }
        return roots.distinct()
    }

    private fun captureBounds(decorView: View): Rect {
        val root = decorView.rootView ?: decorView
        val width = when {
            root.width > 0 -> root.width
            decorView.width > 0 -> decorView.width
            else -> 0
        }
        val height = when {
            root.height > 0 -> root.height
            decorView.height > 0 -> decorView.height
            else -> 0
        }
        if (width > 0 && height > 0) {
            return Rect(0, 0, width, height)
        }

        val visibleFrame = Rect()
        decorView.getWindowVisibleDisplayFrame(visibleFrame)
        return Rect(0, 0, visibleFrame.width(), visibleFrame.height())
    }

    private fun keyboardPlaceholderRect(decorView: View, captureBounds: Rect): Rect? {
        val width = captureBounds.width()
        val height = captureBounds.height()
        if (width <= 0 || height <= 0) return null

        ViewCompat.getRootWindowInsets(decorView)?.let { insets ->
            if (insets.isVisible(WindowInsetsCompat.Type.ime())) {
                val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
                val keyboardHeight = imeInsets.bottom.coerceIn(0, height)
                if (keyboardHeight > height * 0.05f) {
                    return Rect(
                        captureBounds.left,
                        captureBounds.bottom - keyboardHeight,
                        captureBounds.right,
                        captureBounds.bottom
                    )
                }
            }
        }

        val visibleFrame = Rect()
        decorView.getWindowVisibleDisplayFrame(visibleFrame)
        val decorLocation = IntArray(2)
        decorView.getLocationOnScreen(decorLocation)
        val visibleBottom = (visibleFrame.bottom - decorLocation[1]).coerceIn(0, height)
        val obscuredHeight = height - visibleBottom
        if (obscuredHeight > height * 0.15f) {
            return Rect(0, visibleBottom, width, height)
        }

        return null
    }

    private fun hasCapturableNativeSheetRoot(decorView: View, roots: List<View>): Boolean {
        return roots.any { root ->
            root !== decorView && root.isShown && root.width > 0 && root.height > 0
        }
    }

    private fun isKeyboardRoot(view: View): Boolean {
        val name = view.javaClass.name.lowercase(java.util.Locale.US)
        return name.contains("inputmethod") ||
            name.contains("keyboard") ||
            name.contains("ime")
    }

    private fun rootOffsetFromDecor(decorView: View, root: View): Pair<Int, Int> {
        if (root === decorView) return 0 to 0
        val decorLoc = IntArray(2)
        val rootLoc = IntArray(2)
        decorView.getLocationOnScreen(decorLoc)
        root.getLocationOnScreen(rootLoc)
        return (rootLoc[0] - decorLoc[0]) to (rootLoc[1] - decorLoc[1])
    }
    
    /**
     * Find all TextureView instances in the hierarchy and draw their GPU-rendered
     * content onto the capture canvas at the correct position.  decorView.draw()
     * renders TextureView/SurfaceView as black; this fills in the actual pixels.
     *
     * Mapbox uses SurfaceView by default, so we use MapView.snapshot() to capture
     * the map and composite it at the correct position.
     */
    private fun compositeGpuSurfaces(
        root: View,
        canvas: Canvas,
        bitmap: Bitmap,
        screenScale: Float,
        offsetX: Int = 0,
        offsetY: Int = 0
    ) {
        findTextureViews(root, action = { tv ->
            try {
                val tvBitmap = tv.bitmap ?: return@findTextureViews
                val loc = IntArray(2)
                tv.getLocationInWindow(loc)
                val left = offsetX + loc[0]
                val top = offsetY + loc[1]
                if (regionLooksMostlyBlack(bitmap, left, top, tv.width, tv.height, screenScale)) {
                    canvas.drawBitmap(tvBitmap, left.toFloat(), top.toFloat(), null)
                }
                tvBitmap.recycle()
            } catch (_: Exception) {
                // Safety: never crash if TextureView.getBitmap() fails
            }
        })
        findSurfaceViews(root, action = { sv ->
            if (!isVideoSurfaceView(sv)) return@findSurfaceViews
            try {
                val loc = IntArray(2)
                sv.getLocationInWindow(loc)
                val left = offsetX + loc[0]
                val top = offsetY + loc[1]
                if (!regionLooksMostlyBlack(bitmap, left, top, sv.width, sv.height, screenScale)) {
                    return@findSurfaceViews
                }
                val svBitmap = copySurfaceViewBitmap(sv) ?: return@findSurfaceViews
                canvas.drawBitmap(svBitmap, left.toFloat(), top.toFloat(), null)
                svBitmap.recycle()
            } catch (_: Exception) {
                // Safety: never crash if PixelCopy fails
            }
        })
        compositeMapboxSnapshot(root, canvas, offsetX, offsetY)
    }

    /**
     * Mapbox MapView uses SurfaceView; decorView.draw() renders it black.
     * Use MapView.snapshot() (Mapbox SDK API) to capture the map and composite it.
     */
    private fun compositeMapboxSnapshot(root: View, canvas: Canvas, offsetX: Int = 0, offsetY: Int = 0) {
        val mapView = SpecialCases.shared.getMapboxMapViewForSnapshot(root) ?: return
        try {
            val snapshot = mapView.javaClass.getMethod("snapshot").invoke(mapView)
            val bitmap = snapshot as? Bitmap ?: return
            val loc = IntArray(2)
            mapView.getLocationInWindow(loc)
            canvas.drawBitmap(bitmap, (offsetX + loc[0]).toFloat(), (offsetY + loc[1]).toFloat(), null)
            bitmap.recycle()
        } catch (e: Exception) {
            DiagnosticLog.trace("[VisualCapture] Mapbox snapshot failed: ${e.message}")
        }
    }
    
    private fun findTextureViews(view: View, action: (TextureView) -> Unit, depth: Int = 0) {
        if (depth > maxGpuSurfaceScanDepth) return
        if (view is TextureView && view.isAvailable) {
            action(view)
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                findTextureViews(view.getChildAt(i), action, depth + 1)
            }
        }
    }

    private fun findSurfaceViews(view: View, action: (SurfaceView) -> Unit, depth: Int = 0) {
        if (depth > maxGpuSurfaceScanDepth) return
        if (view is SurfaceView && view.isShown && view.width > 0 && view.height > 0) {
            action(view)
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                findSurfaceViews(view.getChildAt(i), action, depth + 1)
            }
        }
    }

    private fun isVideoSurfaceView(view: SurfaceView): Boolean {
        var current: View? = view
        var depth = 0
        while (current != null && depth < 8) {
            val name = current.javaClass.name.lowercase(java.util.Locale.US)
            if (name.contains("video") || name.contains("player") || name.contains("media3") || name.contains("exoplayer")) {
                return true
            }
            current = current.parent as? View
            depth++
        }
        return false
    }

    private fun copySurfaceViewBitmap(view: SurfaceView): Bitmap? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || view.width <= 0 || view.height <= 0) {
            return null
        }
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        val latch = CountDownLatch(1)
        var success = false
        try {
            PixelCopy.request(view, bitmap, { result ->
                success = result == PixelCopy.SUCCESS
                latch.countDown()
            }, pixelCopyHandler)
            if (!latch.await(80, TimeUnit.MILLISECONDS) || !success) {
                bitmap.recycle()
                return null
            }
            return bitmap
        } catch (_: Exception) {
            bitmap.recycle()
            return null
        }
    }

    private fun regionLooksMostlyBlack(
        bitmap: Bitmap,
        left: Int,
        top: Int,
        width: Int,
        height: Int,
        screenScale: Float
    ): Boolean {
        if (width <= 1 || height <= 1) return true
        val sampleSide = 16
        var visibleCount = 0
        var blackCount = 0
        for (y in 0 until sampleSide) {
            val sourceY = ((top + (height * (y + 0.5f) / sampleSide)) / screenScale).toInt()
                .coerceIn(0, bitmap.height - 1)
            for (x in 0 until sampleSide) {
                val sourceX = ((left + (width * (x + 0.5f) / sampleSide)) / screenScale).toInt()
                    .coerceIn(0, bitmap.width - 1)
                val pixel = bitmap.getPixel(sourceX, sourceY)
                val alpha = Color.alpha(pixel)
                if (alpha <= 16) continue
                visibleCount++
                if (Color.red(pixel) < 28 && Color.green(pixel) < 28 && Color.blue(pixel) < 28) {
                    blackCount++
                }
            }
        }
        return visibleCount == 0 || blackCount.toDouble() / visibleCount.toDouble() > 0.82
    }
    
    private fun processCapture(
        bitmap: Bitmap,
        redactionRegions: List<RedactionRegion>,
        keyboardPlaceholderRect: Rect?,
        screenScale: Float,
        frameStart: Long,
        force: Boolean
    ) {
        // Apply overlays while the bitmap is still mutable.
        if (redactionRegions.isNotEmpty() || keyboardPlaceholderRect != null) {
            val canvas = Canvas(bitmap)

            if (redactionRegions.isNotEmpty()) {
                val placeholderPaint = Paint().apply {
                    color = placeholderFillColor
                    style = Paint.Style.FILL
                }
                for (region in redactionRegions) {
                    val rect = region.rect
                    if (rect.width() > 0 && rect.height() > 0) {
                        val scaledRect = RectF(
                            rect.left / screenScale,
                            rect.top / screenScale,
                            rect.right / screenScale,
                            rect.bottom / screenScale
                        )
                        canvas.drawRect(scaledRect, placeholderPaint)
                        when (region.kind) {
                            RedactionMaskKind.CAMERA -> drawCameraMaskIndicator(canvas, scaledRect)
                            RedactionMaskKind.IMAGE -> drawMediaMaskIndicator(canvas, scaledRect, RedactionMaskKind.IMAGE)
                            RedactionMaskKind.VIDEO -> drawMediaMaskIndicator(canvas, scaledRect, RedactionMaskKind.VIDEO)
                            RedactionMaskKind.TEXT_INPUT -> drawTextInputMaskIndicator(canvas, scaledRect)
                            RedactionMaskKind.GENERIC -> drawGenericMaskIndicator(canvas, scaledRect)
                        }
                    }
                }
            }

            keyboardPlaceholderRect?.let {
                drawKeyboardPlaceholder(canvas, it, screenScale)
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
            val count = screenshots.size
            val shouldSend = force || count >= uploadBatchSize
            // Time-based flush: if frames have been sitting for longer than one full
            // batch interval, send regardless of count. This ensures sessions that end
            // before reaching uploadBatchSize frames (very short sessions) still ship
            // their frames promptly rather than waiting for shutdown.
            val shouldFlushByTime = !shouldSend && count > 0 &&
                (captureTs - screenshots[0].second) >= (uploadBatchSize * snapshotInterval * 1_000).toLong()

            if (shouldSend || shouldFlushByTime) {
                sendScreenshots()
            }
        }
    }

    private fun drawCameraMaskIndicator(canvas: Canvas, rect: RectF) {
        val minSide = min(rect.width(), rect.height())
        if (minSide < 36f) return

        val iconSize = min(64f, max(28f, minSide * 0.24f))
        val bodyWidth = iconSize
        val bodyHeight = iconSize * 0.62f
        val body = RectF(
            rect.centerX() - bodyWidth / 2f,
            rect.centerY() - bodyHeight / 2f,
            rect.centerX() + bodyWidth / 2f,
            rect.centerY() + bodyHeight / 2f
        )
        val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = placeholderForeground(220)
            style = Paint.Style.STROKE
            strokeWidth = max(2f, iconSize * 0.06f)
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = placeholderForeground(220)
            style = Paint.Style.FILL
        }

        val radius = max(4f, iconSize * 0.1f)
        canvas.drawRoundRect(body, radius, radius, strokePaint)

        val bump = RectF(
            body.left + iconSize * 0.18f,
            body.top - iconSize * 0.13f,
            body.left + iconSize * 0.42f,
            body.top + iconSize * 0.05f
        )
        canvas.drawRoundRect(bump, max(2f, iconSize * 0.04f), max(2f, iconSize * 0.04f), strokePaint)

        canvas.drawCircle(rect.centerX(), rect.centerY(), iconSize * 0.16f, strokePaint)
        canvas.drawCircle(
            body.right - iconSize * 0.2f,
            body.top + iconSize * 0.16f,
            max(1.6f, iconSize * 0.035f),
            fillPaint
        )
    }

    private fun drawMediaMaskIndicator(canvas: Canvas, rect: RectF, kind: RedactionMaskKind) {
        if (rect.width() < 56f || rect.height() < 36f) return

        val minSide = min(rect.width(), rect.height())
        val iconSize = min(34f, max(18f, minSide * 0.22f))
        val textSize = min(18f, max(11f, minSide * 0.12f))
        val text = if (kind == RedactionMaskKind.VIDEO) "Video masked" else "Image masked"
        val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = placeholderForeground(220)
            style = Paint.Style.STROKE
            strokeWidth = max(1.8f, iconSize * 0.08f)
            strokeJoin = Paint.Join.ROUND
        }
        val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = placeholderForeground(220)
            style = Paint.Style.FILL
        }
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = placeholderForeground(220)
            this.textSize = textSize
            typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
        }
        val textWidth = textPaint.measureText(text)
        val showText = rect.width() >= iconSize + 8f + textWidth + 16f
        val totalWidth = if (showText) iconSize + 8f + textWidth else iconSize
        val startX = rect.centerX() - totalWidth / 2f
        val iconRect = RectF(
            startX,
            rect.centerY() - iconSize / 2f,
            startX + iconSize,
            rect.centerY() + iconSize / 2f
        )
        if (kind == RedactionMaskKind.VIDEO) {
            drawVideoIcon(canvas, iconRect, strokePaint, fillPaint)
        } else {
            drawImageIcon(canvas, iconRect, strokePaint, fillPaint)
        }

        if (showText) {
            val textBaseline = rect.centerY() - (textPaint.descent() + textPaint.ascent()) / 2f
            canvas.drawText(text, iconRect.right + 8f, textBaseline, textPaint)
        }
    }

    private fun drawTextInputMaskIndicator(canvas: Canvas, rect: RectF) {
        if (rect.width() < 48f || rect.height() < 24f) return

        val text = "Txt Input"
        val horizontalPadding = 8f
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = min(18f, max(10f, rect.height() * 0.34f))
            typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
        }
        while (textPaint.measureText(text) > rect.width() - horizontalPadding * 2f && textPaint.textSize > 8f) {
            textPaint.textSize = textPaint.textSize - 1f
        }
        if (textPaint.measureText(text) > rect.width() - horizontalPadding * 2f) return

        val baseline = rect.centerY() - (textPaint.ascent() + textPaint.descent()) / 2f
        canvas.drawText(text, rect.centerX() - textPaint.measureText(text) / 2f, baseline, textPaint)
    }

    private fun drawGenericMaskIndicator(canvas: Canvas, rect: RectF) {
        if (rect.width() < 36f || rect.height() < 20f) return

        val text = "Mask"
        val horizontalPadding = 8f
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = min(18f, max(10f, rect.height() * 0.34f))
            typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
        }
        while (textPaint.measureText(text) > rect.width() - horizontalPadding * 2f && textPaint.textSize > 8f) {
            textPaint.textSize = textPaint.textSize - 1f
        }
        if (textPaint.measureText(text) > rect.width() - horizontalPadding * 2f) return

        val baseline = rect.centerY() - (textPaint.ascent() + textPaint.descent()) / 2f
        canvas.drawText(text, rect.centerX() - textPaint.measureText(text) / 2f, baseline, textPaint)
    }

    private fun drawImageIcon(canvas: Canvas, rect: RectF, strokePaint: Paint, fillPaint: Paint) {
        val radius = max(3f, rect.width() * 0.12f)
        canvas.drawRoundRect(rect, radius, radius, strokePaint)
        canvas.drawCircle(
            rect.left + rect.width() * 0.72f,
            rect.top + rect.height() * 0.28f,
            max(1.8f, rect.width() * 0.08f),
            fillPaint
        )
        val mountainPath = android.graphics.Path().apply {
            moveTo(rect.left + rect.width() * 0.18f, rect.bottom - rect.height() * 0.2f)
            lineTo(rect.left + rect.width() * 0.42f, rect.top + rect.height() * 0.52f)
            lineTo(rect.left + rect.width() * 0.55f, rect.top + rect.height() * 0.66f)
            lineTo(rect.left + rect.width() * 0.72f, rect.top + rect.height() * 0.46f)
            lineTo(rect.right - rect.width() * 0.14f, rect.bottom - rect.height() * 0.2f)
        }
        canvas.drawPath(mountainPath, strokePaint)
    }

    private fun drawVideoIcon(canvas: Canvas, rect: RectF, strokePaint: Paint, fillPaint: Paint) {
        val body = RectF(
            rect.left,
            rect.top + rect.height() * 0.18f,
            rect.left + rect.width() * 0.66f,
            rect.bottom - rect.height() * 0.18f
        )
        val radius = max(3f, rect.width() * 0.1f)
        canvas.drawRoundRect(body, radius, radius, strokePaint)
        val lensPath = android.graphics.Path().apply {
            moveTo(body.right, rect.centerY() - rect.height() * 0.18f)
            lineTo(rect.right, rect.top + rect.height() * 0.26f)
            lineTo(rect.right, rect.bottom - rect.height() * 0.26f)
            lineTo(body.right, rect.centerY() + rect.height() * 0.18f)
            close()
        }
        canvas.drawPath(lensPath, fillPaint)
    }

    private fun drawKeyboardPlaceholder(canvas: Canvas, rect: Rect, screenScale: Float) {
        if (rect.width() <= 0 || rect.height() <= 0) return

        val scaledRect = RectF(
            rect.left / screenScale,
            rect.top / screenScale,
            rect.right / screenScale,
            rect.bottom / screenScale
        )
        if (scaledRect.width() <= 0f || scaledRect.height() <= 0f) return

        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = placeholderFillColor
            style = Paint.Style.FILL
        }
        canvas.drawRect(scaledRect, fill)

        if (scaledRect.width() < 56f || scaledRect.height() < 32f) return

        // Product parity with iOS/Swift: keyboard placeholders are text-only,
        // while camera/image/video placeholders carry icons.
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = placeholderForeground(224)
            textSize = min(34f, max(16f, scaledRect.height() * 0.12f))
            typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
        }
        val text = "Keyboard"
        val baseline = scaledRect.centerY() - (textPaint.ascent() + textPaint.descent()) / 2f
        canvas.drawText(text, scaledRect.centerX() - textPaint.measureText(text) / 2f, baseline, textPaint)
    }

    private fun placeholderForeground(alpha: Int): Int {
        return Color.argb(alpha, Color.red(placeholderForegroundColor), Color.green(placeholderForegroundColor), Color.blue(placeholderForegroundColor))
    }
    
    private fun enforceScreenshotCaps() {
        while (screenshots.size > maxBufferedScreenshots) {
            screenshots.removeAt(0)
        }
    }
    
    private fun sendScreenshots() {
        // Check backpressure
        // Copy and clear under lock
        val (images, captureEpoch, captureSessionId) = stateLock.withLock {
            val copy = screenshots.toList()
            screenshots.clear()
            Triple(copy, sessionEpoch, currentSessionId)
        }
        
        if (images.isEmpty()) {
            DiagnosticLog.trace("[VisualCapture] sendScreenshots: no images to send")
            return
        }
        
        DiagnosticLog.trace("[VisualCapture] sendScreenshots: sending ${images.size} frames")
        
        // All heavy work happens in background
        encodeExecutor.execute {
            packageAndShip(images, captureEpoch, captureSessionId)
        }
    }
    
    private fun packageAndShip(images: List<Pair<ByteArray, Long>>, sessionEpoch: Long, sessionId: String?) {
        val batchStart = SystemClock.elapsedRealtime()
        
        val bundle = packageFrameBundle(images, sessionEpoch) ?: return
        
        val rid = sessionId ?: "unknown"
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
            frameCount = images.size,
            sessionId = sessionId
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

    /**
     * Blocks the calling thread until all pending encode operations finish.
     * Used by the shutdown drain path to ensure frame bundles are enqueued
     * in TelemetryPipeline.frameQueue before shipPendingFrames runs.
     */
    fun waitForEncodingToComplete() {
        encodeExecutor.submit {}.get()
    }
    
    fun uploadPendingFrames(sessionId: String, sessionEpochOverride: Long? = null, completion: ((Boolean) -> Unit)? = null) {
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
        
        val recoveryEpoch = sessionEpochOverride?.takeIf { it > 0 } ?: frames.first().second
        val bundle = packageFrameBundle(frames, recoveryEpoch) ?: run {
            completion?.invoke(false)
            return
        }
        
        SegmentDispatcher.shared.transmitFrameBundleForSession(
            sessionId = sessionId,
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

private enum class RedactionMaskKind {
    GENERIC,
    TEXT_INPUT,
    CAMERA,
    IMAGE,
    VIDEO
}

private data class RedactionRegion(
    val rect: Rect,
    val kind: RedactionMaskKind
)

private class RedactionMask {
    private val views = CopyOnWriteArrayList<WeakReference<View>>()
    
    private val cachedAutoRegions = mutableListOf<RedactionRegion>()
    private var lastScanTime = 0L
    private val scanCacheDurationMs = 500L
    private val maxSensitiveScanDepth = 120
    private val minimumMediaMaskSide = 44
    private val minimumMediaMaskArea = 2_500
    
    fun add(view: View) {
        views.add(WeakReference(view))
    }
    
    fun remove(view: View) {
        views.removeIf { it.get() === view || it.get() == null }
    }
    
    fun invalidateCache() {
        lastScanTime = 0L
    }
    
    fun computeRegions(decorView: View? = null, decorViews: List<View>? = null): List<RedactionRegion> {
        val regions = mutableListOf<RedactionRegion>()
        views.removeIf { it.get() == null }
        
        for (ref in views) {
            val view = ref.get() ?: continue
            val rect = getViewRect(view)
            if (rect != null) regions.add(RedactionRegion(rect, RedactionMaskKind.GENERIC))
        }
        
        val roots = decorViews ?: decorView?.let { listOf(it) }
        if (roots != null) {
            val now = SystemClock.elapsedRealtime()
            if (now - lastScanTime >= scanCacheDurationMs) {
                cachedAutoRegions.clear()
                for (root in roots) {
                    scanForSensitiveViews(root, cachedAutoRegions)
                }
                lastScanTime = now
            }
            regions.addAll(cachedAutoRegions)
        }
        
        return regions
    }

    fun computeMediaRegions(decorViews: List<View>): List<RedactionRegion> {
        val regions = mutableListOf<RedactionRegion>()
        for (root in decorViews) {
            scanForMediaViews(root, regions)
        }
        return regions
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

    private fun scanForSensitiveViews(view: View, regions: MutableList<RedactionRegion>, depth: Int = 0) {
        // Expo Router + React Navigation stack/tab navigators create 25+ levels before
        // reaching screen content, and nested RNGH + Expo media wrappers can push
        // content deeper still.
        if (depth > maxSensitiveScanDepth) return
        if (!view.isShown || view.alpha <= 0.01f || view.width <= 0 || view.height <= 0) return

        // IMPORTANT: always stop recursing into a masked view's children regardless
        // of whether we can compute its rect — we never want to expose child content
        // of a Mask wrapper (mirrors the iOS fix for map-page animation cases).
        val maskKind = maskKind(view)
        if (maskKind != null) {
            val rect = getViewRect(view)
            if (rect != null) regions.add(RedactionRegion(rect, maskKind))
            return // Always stop — never recurse into children of a masked view
        }

        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                scanForSensitiveViews(view.getChildAt(i), regions, depth + 1)
            }
        }
    }

    private fun scanForMediaViews(view: View, regions: MutableList<RedactionRegion>, depth: Int = 0) {
        if (depth > maxSensitiveScanDepth) return
        if (!view.isShown || view.alpha <= 0.01f || view.width <= 0 || view.height <= 0) return

        val className = view.javaClass.simpleName.lowercase(java.util.Locale.US)
        val regionCountBeforeChildren = regions.size
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                scanForMediaViews(view.getChildAt(i), regions, depth + 1)
            }
        }
        if (regions.size > regionCountBeforeChildren) return

        mediaMaskKind(view, className)?.let { kind ->
            val rect = getViewRect(view)
            if (rect != null) {
                // Expo Video/Image can be nested under several RN/Gesture Handler
                // wrappers. This media-only pass keeps the poster/player covered if
                // the general sensitive-view cache misses a newly-mounted subtree.
                regions.add(RedactionRegion(rect, kind))
                return
            }
        }
    }

    private fun maskKind(view: View): RedactionMaskKind? {
        // contentDescription is set by React Native's accessibilityLabel prop.
        // We check it first and also check for our explicit Mask signal below.
        if (view.contentDescription?.toString() == "rejourney_occlude") return RedactionMaskKind.GENERIC

        // React Native stores accessibilityHint as a view tag.
        // Try the known RN resource ID first, then fall back to a string-keyed tag
        // lookup for RN versions that use a different internal mechanism.
        try {
            val hint = view.getTag(com.facebook.react.R.id.accessibility_hint) as? String
            if (hint == "rejourney_occlude") return RedactionMaskKind.GENERIC
        } catch (_: Exception) { }

        // Extra fallback: iterate all known integer tag slots RN might use.
        // view.getTag() with an unknown key returns null (never throws on API 21+),
        // so this is safe. Covers RN versions that store the hint under a different id.
        try {
            // nativeID tag — set by Mask component as a secondary signal
            val nativeId = view.getTag(com.facebook.react.R.id.view_tag_native_id) as? String
            if (nativeId?.startsWith("rj_occlude") == true) return RedactionMaskKind.GENERIC
        } catch (_: Exception) { }
        
        if (view is EditText) {
            return if (isPasswordInput(view) || (ReplayOrchestrator.shared?.maskTextInputsByDefault ?: true)) {
                RedactionMaskKind.TEXT_INPUT
            } else {
                null
            }
        }

        if ((ReplayOrchestrator.shared?.maskTextInputsByDefault ?: true) && isTextInputClass(view)) {
            return RedactionMaskKind.TEXT_INPUT
        }
        
        val className = view.javaClass.simpleName.lowercase(java.util.Locale.US)
        if (isCameraClassName(className)) {
            return RedactionMaskKind.CAMERA
        }

        if (ReplayOrchestrator.shared?.maskImagesAndVideosByDefault == true) {
            mediaMaskKind(view, className)?.let { return it }
        }
        
        return null
    }

    private fun isCameraClassName(className: String): Boolean {
        return className.contains("camera") ||
            (className.contains("surfaceview") && className.contains("preview"))
    }

    private fun isImageOrVideoView(view: View, className: String): Boolean {
        return mediaMaskKind(view, className) != null
    }

    private fun mediaMaskKind(view: View, className: String): RedactionMaskKind? {
        if (isCameraClassName(className)) return null
        if (!isContentSizedMediaView(view)) return null
        if (view is ImageView) return RedactionMaskKind.IMAGE
        if (view is TextureView && hasMediaNameInAncestry(view)) return RedactionMaskKind.VIDEO
        if (view is SurfaceView && hasMediaNameInAncestry(view)) return RedactionMaskKind.VIDEO
        if (className == "videoview" || className.endsWith("videoview") || className.endsWith("playerview")) {
            return RedactionMaskKind.VIDEO
        }
        if (className == "imageview" || className.endsWith("imageview")) {
            return RedactionMaskKind.IMAGE
        }
        return null
    }

    private fun isContentSizedMediaView(view: View): Boolean {
        if (view.width <= 0 || view.height <= 0) return false
        val minSide = min(view.width, view.height)
        val area = view.width * view.height
        return minSide >= minimumMediaMaskSide && area >= minimumMediaMaskArea
    }

    private fun hasMediaNameInAncestry(view: View): Boolean {
        var current: View? = view
        var depth = 0
        while (current != null && depth < 8) {
            val name = current.javaClass.name.lowercase(java.util.Locale.US)
            if (name.contains("video") || name.contains("player") || name.contains("media3") || name.contains("exoplayer")) {
                return true
            }
            current = current.parent as? View
            depth++
        }
        return false
    }

    private fun isPasswordInput(view: EditText): Boolean {
        val inputType = view.inputType
        return inputType and android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD != 0 ||
            inputType and android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD != 0 ||
            inputType and android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD != 0
    }

    private fun isTextInputClass(view: View): Boolean {
        val className = view.javaClass.simpleName
        return className == "ReactEditText" ||
            className == "RCTEditText" ||
            className.contains("TextInput", ignoreCase = true)
    }
}
