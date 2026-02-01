/**
 * High-level capture orchestrator using H.264 video segments.
 * Ported from iOS RJCaptureEngine.
 * 
 * Captures screenshots and encodes them into video segments for upload.
 * Uses event-driven capture model with adaptive quality based on system conditions.
 * 
 * The capture engine is responsible for:
 * - Deciding when to capture frames based on events and throttling rules
 * - Encoding frames into H.264 video segments via VideoEncoder
 * - Capturing view hierarchy snapshots periodically for click/hover maps
 * - Adapting to system conditions (memory, thermal, battery)
 * - Coordinating with SegmentUploader for upload
 *
 * Licensed under the Apache License, Version 2.0
 * Copyright (c) 2026 Rejourney
 */
package com.rejourney.capture

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.MessageQueue
import android.os.PowerManager
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.TextureView
import android.graphics.Canvas
import android.opengl.GLSurfaceView
import android.view.View
import android.view.ViewGroup
import android.view.Window
import com.facebook.react.bridge.ReactApplicationContext
import com.rejourney.core.CaptureImportance
import com.rejourney.core.Constants
import com.rejourney.core.Logger
import com.rejourney.core.PerformanceLevel
import com.rejourney.privacy.PrivacyMask
import com.rejourney.utils.PerfMetric
import com.rejourney.utils.PerfTiming
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max

/**
 * Delegate for receiving segment completion notifications.
 */
interface CaptureEngineDelegate {
    /**
     * Called when a video segment is ready for upload.
     */
    fun onSegmentReady(segmentFile: File, startTime: Long, endTime: Long, frameCount: Int)

    /**
     * Called when capture encounters an error.
     */
    fun onCaptureError(error: Exception)
    
    /**
     * Called when hierarchy snapshots need to be uploaded.
     */
    fun onHierarchySnapshotsReady(snapshotsJson: ByteArray, timestamp: Long) {}
}

class CaptureEngine(private val context: Context) : VideoEncoderDelegate {

    private data class PendingCapture(
        val wantedAt: Long,
        var deadline: Long,
        val reason: String,
        val importance: CaptureImportance,
        val generation: Int,
        var scanResult: ViewHierarchyScanResult? = null,
        var layoutSignature: String? = null,
        var lastScanTime: Long = 0L
    )

    var captureScale: Float = Constants.DEFAULT_CAPTURE_SCALE
    var minFrameInterval: Double = Constants.DEFAULT_MIN_FRAME_INTERVAL
    var maxFramesPerMinute: Int = Constants.DEFAULT_MAX_FRAMES_PER_MINUTE
    var framesPerSegment: Int = Constants.DEFAULT_FRAMES_PER_SEGMENT
    var targetBitrate: Int = Constants.DEFAULT_VIDEO_BITRATE
    var targetFps: Int = Constants.DEFAULT_VIDEO_FPS
    var hierarchyCaptureInterval: Int = 5
    var adaptiveQualityEnabled: Boolean = true
    var thermalThrottleEnabled: Boolean = true
    var batteryAwareEnabled: Boolean = true
    var privacyMaskTextInputs: Boolean = true
        set(value) {
            field = value
            PrivacyMask.maskTextInputs = value
            viewScanner?.config?.detectTextInputs = value
        }
    var privacyMaskCameraViews: Boolean = true
        set(value) {
            field = value
            PrivacyMask.maskCameraViews = value
            viewScanner?.config?.detectCameraViews = value
        }
    var privacyMaskWebViews: Boolean = true
        set(value) {
            field = value
            PrivacyMask.maskWebViews = value
            viewScanner?.config?.detectWebViews = value
        }
    var privacyMaskVideoLayers: Boolean = true
        set(value) {
            field = value
            PrivacyMask.maskVideoLayers = value
            viewScanner?.config?.detectVideoLayers = value
        }

    var delegate: CaptureEngineDelegate? = null

    var currentPerformanceLevel: PerformanceLevel = PerformanceLevel.NORMAL
        private set
    val frameCount: Int
        get() = videoEncoder?.currentFrameCount ?: 0
    
    val isRecording: Boolean
    get() {
        return _isRecording && !isShuttingDown.get()
    }
    
    private var framesSinceHierarchy: Int = 0
    
    private val hierarchySnapshots = mutableListOf<Map<String, Any?>>()

    private var videoEncoder: VideoEncoder? = null
    private val segmentDir: File by lazy {
        File(context.filesDir, "rejourney/segments").apply { mkdirs() }
    }

    private val motionTracker = MotionTracker()

    private val captureHeuristics = CaptureHeuristics()

    private val mainHandler = Handler(Looper.getMainLooper())

    private val processingExecutor = Executors.newSingleThreadExecutor()

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var captureRunnable: Runnable? = null
    private val captureIntervalMs: Long
        get() = (1000L / targetFps).coerceAtLeast(100)

    private val bitmapPool = ConcurrentLinkedQueue<Bitmap>()
    private val MAX_POOL_SIZE = 8

    var onFrameCaptured: (() -> Unit)? = null

    private val isShuttingDown = AtomicBoolean(false)
    private var _isRecording: Boolean = false
    private val captureInProgress = AtomicBoolean(false)
    private val isWarmingUp = AtomicBoolean(false)
    private var sessionId: String? = null
    private var currentScreenName: String? = null
    private var viewScanner: ViewHierarchyScanner? = null
    private var viewSerializer: ViewSerializer? = null
    private var lastSerializedSignature: String? = null
    private var pendingCapture: PendingCapture? = null
    private var pendingCaptureGeneration = 0
    private var pendingDefensiveCaptureTime = 0L
    private var pendingDefensiveCaptureGeneration = 0
    private var idleCapturePending = false
    private var idleCaptureGeneration = 0
    private val cacheLock = Any()
    private var lastCapturedBitmap: Bitmap? = null
    private var lastSafeBitmap: Bitmap? = null
    private var lastCapturedHadBlockedSurface = false
    
    private var framesSinceSessionStart = 0
    private var framesThisMinute = 0
    private var minuteStartTime: Long = 0
    private var lastCaptureTime: Long = 0
    private var consecutiveCaptureCount = 0
    private var cooldownUntil: Long = 0
    private var didPrewarmViewCaches = false
    
    private var cachedBatteryLevel: Float = 1.0f
    private var lastBatteryCheckTime: Long = 0L

    private var deviceWidth: Int = 0
    private var deviceHeight: Int = 0
    private var lastMapPresenceTimeMs: Long = 0L

    init {
        try {
            VideoEncoder.prewarmEncoderAsync()
        } catch (e: Exception) {
            Logger.warning("[CaptureEngine] Encoder prewarm failed (non-critical): ${e.message}")
        }
        
        mainHandler.post {
            prewarmRenderServer()
        }
    }

    /**
     * Start a new capture session.
     */
    fun startSession(sessionId: String) {
        if (isShuttingDown.get()) return
        
        if (_isRecording) {
            Logger.warning("[CaptureEngine] Session already active, stopping previous")
            stopSession()
        }
        
        this.sessionId = sessionId
        _isRecording = true
        framesThisMinute = 0
        minuteStartTime = System.currentTimeMillis()
        lastCaptureTime = 0
        consecutiveCaptureCount = 0
        cooldownUntil = 0
        lastMapPresenceTimeMs = 0L
        framesSinceHierarchy = 0
        framesSinceSessionStart = 0
        hierarchySnapshots.clear()
        viewScanner = null
        viewSerializer = null
        lastSerializedSignature = null
        motionTracker.reset()
        lastSerializedSignature = null
        pendingCapture = null
        pendingCaptureGeneration = 0
        pendingDefensiveCaptureTime = 0L
        pendingDefensiveCaptureGeneration = 0
        idleCapturePending = false
        idleCaptureGeneration = 0
        captureHeuristics.reset()
        resetCachedFrames()
        viewScanner = ViewHierarchyScanner().apply {
            config.detectTextInputs = privacyMaskTextInputs
            config.detectCameraViews = privacyMaskCameraViews
            config.detectWebViews = privacyMaskWebViews
            config.detectVideoLayers = privacyMaskVideoLayers
        }
        viewSerializer = ViewSerializer(context.resources.displayMetrics.density)

        PrivacyMask.maskTextInputs = privacyMaskTextInputs
        PrivacyMask.maskCameraViews = privacyMaskCameraViews
        PrivacyMask.maskWebViews = privacyMaskWebViews
        PrivacyMask.maskVideoLayers = privacyMaskVideoLayers

        if (!didPrewarmViewCaches) {
            viewScanner?.prewarmClassCaches()
            PrivacyMask.prewarmClassCaches()
            didPrewarmViewCaches = true
        }

        videoEncoder = VideoEncoder(segmentDir).apply {
            this.targetBitrate = this@CaptureEngine.targetBitrate
            this.framesPerSegment = this@CaptureEngine.framesPerSegment
            this.fps = this@CaptureEngine.targetFps
            this.captureScale = this@CaptureEngine.captureScale
            this.displayDensity = context.resources.displayMetrics.density
            this.maxDimension = Constants.MAX_VIDEO_DIMENSION
            this.keyframeInterval = Constants.DEFAULT_KEYFRAME_INTERVAL
            this.delegate = this@CaptureEngine
            setSessionId(sessionId)
            prewarm()
        }

        cleanupOldSegments()
        
        mainHandler.post {
            val window = getCurrentWindow()
            if (window != null) {
                val decorView = window.decorView
                if (decorView.width > 0 && decorView.height > 0) {
                    videoEncoder?.startSegment(decorView.width, decorView.height)
                    Logger.debug("[CaptureEngine] Started first segment: ${decorView.width}x${decorView.height}")
                } else {
                    Logger.debug("[CaptureEngine] Deferring segment start - waiting for valid dimensions")
                }
            }
        }

        startCaptureTimer()

        Logger.debug("[CaptureEngine] Session started: $sessionId")
    }

    /**
     * Stop the current capture session.
     */
    fun stopSession() {
        if (!_isRecording && sessionId == null) return
        
        Logger.info("[CaptureEngine] Stopping session: $sessionId")
        
        _isRecording = false
        stopCaptureTimer()

        videoEncoder?.finishSegment()
        
        uploadCurrentHierarchySnapshots()

        cleanup()
        
        Logger.debug("[CaptureEngine] Session stopped")
    }
    
    /**
     * OPTIMIZATION: Comprehensive cleanup to prevent memory leaks.
     */
    private fun cleanup() {
        videoEncoder = null
        
        hierarchySnapshots.clear()
        
        framesSinceSessionStart = 0
        framesSinceHierarchy = 0
        sessionId = null
        currentScreenName = "Unknown"
        pendingCapture = null
        pendingCaptureGeneration = 0
        pendingDefensiveCaptureTime = 0L
        pendingDefensiveCaptureGeneration = 0
        idleCapturePending = false
        idleCaptureGeneration = 0
        lastMapPresenceTimeMs = 0L
        captureHeuristics.reset()
        resetCachedFrames()
        
        scope.coroutineContext.cancelChildren()
    }
    
    /**
     * Pause video capture (e.g., when app goes to background).
     * Finishes current segment but keeps session alive.
     */
    fun pauseVideoCapture() {
        if (!_isRecording) return
        
        Logger.info("[CaptureEngine] Pausing video capture")

        pendingCapture = null
        pendingCaptureGeneration = 0
        pendingDefensiveCaptureTime = 0L
        pendingDefensiveCaptureGeneration = 0
        idleCapturePending = false
        idleCaptureGeneration = 0
        
        stopCaptureTimer()
        
        videoEncoder?.finishSegment()
        
        uploadCurrentHierarchySnapshots()
    }
    
    /**
     * Resume video capture (e.g., when app returns to foreground).
     */
    fun resumeVideoCapture() {
        if (!_isRecording) return
        
        Logger.info("[CaptureEngine] Resuming video capture")

        isWarmingUp.set(true)
        Logger.debug("[CaptureEngine] Warmup started (1000ms)")
        
        mainHandler.postDelayed({
            if (isShuttingDown.get()) return@postDelayed
            isWarmingUp.set(false)
            Logger.debug("[CaptureEngine] Warmup complete")
            
            if (_isRecording) {
                 requestCapture(CaptureImportance.MEDIUM, "warmup_complete", forceCapture = false)
            }
        }, 1000)

        captureHeuristics.reset()
        resetCachedFrames()
        pendingCapture = null
        pendingCaptureGeneration = 0
        pendingDefensiveCaptureTime = 0L
        pendingDefensiveCaptureGeneration = 0
        idleCapturePending = false
        idleCaptureGeneration = 0
        
        mainHandler.post {
            val window = getCurrentWindow()
            if (window != null && videoEncoder != null) {
                val decorView = window.decorView
                videoEncoder?.startSegment(decorView.width, decorView.height)
                startCaptureTimer()
            }
        }
    }

    /**
     * Notify navigation to a new screen.
     * Triggers a delayed capture to allow render.
     */
    fun notifyNavigationToScreen(screenName: String) {
        if (!_isRecording) return

        if (screenName == currentScreenName) return

        currentScreenName = screenName
        lastSerializedSignature = null

        val now = android.os.SystemClock.elapsedRealtime()
        captureHeuristics.invalidateSignature()
        captureHeuristics.recordNavigationEventAtTime(now)
        requestDefensiveCaptureAfterDelay(DEFENSIVE_CAPTURE_DELAY_NAVIGATION_MS, "navigation")
    }

    /**
     * Notify a gesture occurred.
     */
    fun notifyGesture(gestureType: String) {
        if (!_isRecording) return
        val now = android.os.SystemClock.elapsedRealtime()
        val normalized = gestureType.lowercase()
        val isScroll = normalized.startsWith("scroll")
        val mapGesture = isMapGestureType(normalized) && hasRecentMapPresence(now)

        if (isScroll) {
            captureHeuristics.recordTouchEventAtTime(now)
        } else {
            captureHeuristics.recordInteractionEventAtTime(now)
        }

        if (mapGesture) {
            captureHeuristics.recordMapInteractionAtTime(now)
            requestDefensiveCaptureAfterDelay(DEFENSIVE_CAPTURE_DELAY_MAP_MS, "map")
            return
        }

        if (isScroll) {
            requestDefensiveCaptureAfterDelay(DEFENSIVE_CAPTURE_DELAY_SCROLL_MS, "scroll")
        } else {
            requestDefensiveCaptureAfterDelay(DEFENSIVE_CAPTURE_DELAY_INTERACTION_MS, "interaction")
        }
    }

    private fun isMapGestureType(gestureType: String): Boolean {
        return gestureType.startsWith("scroll") ||
            gestureType.startsWith("pan") ||
            gestureType.startsWith("pinch") ||
            gestureType.startsWith("zoom") ||
            gestureType.startsWith("rotate") ||
            gestureType.startsWith("swipe") ||
            gestureType.startsWith("drag")
    }

    private fun hasRecentMapPresence(now: Long): Boolean {
        return lastMapPresenceTimeMs > 0 && (now - lastMapPresenceTimeMs) <= MAP_PRESENCE_WINDOW_MS
    }

    /**
     * Notify interaction started (touch down).
     */
    fun notifyInteractionStart() {
        if (!_isRecording) return
        val now = android.os.SystemClock.elapsedRealtime()
        captureHeuristics.recordTouchEventAtTime(now)
        requestDefensiveCaptureAfterDelay(DEFENSIVE_CAPTURE_DELAY_INTERACTION_MS, "interaction_start")
    }

    /**
     * Notify scroll offset change.
     */
    fun notifyScrollOffset(offset: Float) {
        if (!_isRecording) return

        val event = motionTracker.recordScrollOffset(offsetY = offset)
        if (event != null) {
            val now = android.os.SystemClock.elapsedRealtime()
            captureHeuristics.recordTouchEventAtTime(now)
            requestDefensiveCaptureAfterDelay(DEFENSIVE_CAPTURE_DELAY_SCROLL_MS, "scroll")
        }
    }

    /**
     * Notify a visual change.
     */
    fun notifyVisualChange(reason: String, importance: CaptureImportance) {
        if (!_isRecording) return
        notifyReactNativeCommit()
    }

    fun notifyReactNativeCommit() {
        if (!_isRecording) return

        val now = android.os.SystemClock.elapsedRealtime()
        captureHeuristics.invalidateSignature()
        captureHeuristics.recordInteractionEventAtTime(now)
        requestDefensiveCaptureAfterDelay(DEFENSIVE_CAPTURE_DELAY_INTERACTION_MS, "rn_commit")
    }

    fun notifyKeyboardEvent(reason: String) {
        if (!_isRecording) return
        val now = android.os.SystemClock.elapsedRealtime()
        captureHeuristics.recordKeyboardEventAtTime(now)
        requestDefensiveCaptureAfterDelay(DEFENSIVE_CAPTURE_DELAY_INTERACTION_MS, reason)
    }

    /**
     * Force an immediate capture regardless of throttling.
     */
    fun forceCaptureWithReason(reason: String) {
        if (!_isRecording) return
        requestCapture(CaptureImportance.CRITICAL, reason, forceCapture = true)
    }

    /**
     * Handle memory warning.
     */
    fun handleMemoryWarning() {
        Logger.warning("[CaptureEngine] Memory warning received")
        currentPerformanceLevel = PerformanceLevel.MINIMAL
    }

    /**
     * Emergency flush for crash handling.
     */
    fun emergencyFlush(): Boolean {
        return videoEncoder?.emergencyFlushSync() ?: false
    }

    override fun onSegmentFinished(segmentFile: File, startTime: Long, endTime: Long, frameCount: Int) {
        Logger.info("[CaptureEngine] Segment ready: ${segmentFile.name} ($frameCount frames, ${(endTime - startTime) / 1000.0}s)")
        
        delegate?.onSegmentReady(segmentFile, startTime, endTime, frameCount)
        
        uploadCurrentHierarchySnapshots()
    }

    override fun onEncodingError(error: Exception) {
        Logger.error("[CaptureEngine] Encoding error", error)
        delegate?.onCaptureError(error)
    }

    private fun captureFrame(importance: CaptureImportance, reason: String) {
        requestCapture(importance, reason, forceCapture = false)
    }
    private fun requestCapture(importance: CaptureImportance, reason: String, forceCapture: Boolean) {
        if (!_isRecording || isShuttingDown.get()) return

        if (isWarmingUp.get()) {
            return
        }

        if (!forceCapture && !shouldCapture(importance)) {
            Logger.debug("[CaptureEngine] Capture throttled: $reason (importance: $importance)")
            return
        }

        val now = android.os.SystemClock.elapsedRealtime()

        pendingCapture?.let {
            it.deadline = now
            scheduleIdleCaptureAttempt(0L)
        }

        var graceMs = captureHeuristics.captureGraceMs
        if (captureHeuristics.animationBlocking || captureHeuristics.scrollActive || captureHeuristics.keyboardAnimating) {
            graceMs = minOf(graceMs, 300L)
        }

        val pending = PendingCapture(
            wantedAt = now,
            deadline = now + graceMs,
            reason = reason,
            importance = importance,
            generation = ++pendingCaptureGeneration
        )
        pendingCapture = pending
        scheduleIdleCaptureAttempt(0L)
    }

    private fun requestDefensiveCaptureAfterDelay(delayMs: Long, reason: String) {
        if (!_isRecording || isShuttingDown.get()) return

        val now = android.os.SystemClock.elapsedRealtime()
        val target = now + max(0L, delayMs)
        if (pendingDefensiveCaptureTime > 0 && target >= pendingDefensiveCaptureTime - 10L) {
            return
        }

        pendingDefensiveCaptureTime = target
        val generation = ++pendingDefensiveCaptureGeneration

        mainHandler.postDelayed({
            if (!_isRecording || isShuttingDown.get()) return@postDelayed
            if (pendingDefensiveCaptureGeneration != generation) return@postDelayed
            pendingDefensiveCaptureTime = 0L
            requestCapture(CaptureImportance.HIGH, reason, forceCapture = true)
        }, max(0L, delayMs))
    }

    private fun attemptPendingCapture(pending: PendingCapture) {
        if (pendingCapture?.generation != pending.generation) return
        if (!_isRecording || isShuttingDown.get()) return

        val now = android.os.SystemClock.elapsedRealtime()
        if (now > pending.deadline) {
            emitFrameForPendingCapture(pending, shouldRender = false)
            return
        }

        if (captureInProgress.get()) {
            scheduleIdleCaptureAttempt(captureHeuristics.pollIntervalMs)
            return
        }

        val currentWindow = getCurrentWindow() ?: run {
            pendingCapture = null
            return
        }
        val decorView = currentWindow.decorView
        if (decorView.width <= 0 || decorView.height <= 0) {
            pendingCapture = null
            return
        }

        val scanResult = try {
            viewScanner?.scanAllWindowsRelativeTo(currentWindow)
        } catch (e: Exception) {
            Logger.warning("[CaptureEngine] View scan failed: ${e.message}")
            null
        }

        pending.scanResult = scanResult
        pending.layoutSignature = scanResult?.layoutSignature
        pending.lastScanTime = now

        if (scanResult?.hasMapView == true || scanResult?.mapViewFrames?.isNotEmpty() == true) {
            lastMapPresenceTimeMs = now
        }

        captureHeuristics.updateWithScanResult(scanResult, now)

        val decision = captureHeuristics.decisionForSignature(
            pending.layoutSignature,
            now,
            hasLastFrame = lastCapturedBitmap != null,
            importance = pending.importance
        )

        if (decision.action == CaptureAction.Defer) {
            val deferUntil = max(decision.deferUntilMs, now + captureHeuristics.pollIntervalMs)
            if (deferUntil > pending.deadline) {
                emitFrameForPendingCapture(pending, shouldRender = false)
                return
            }
            scheduleIdleCaptureAttempt(deferUntil - now)
            return
        }

        emitFrameForPendingCapture(
            pending,
            shouldRender = decision.action == CaptureAction.RenderNow
        )
    }

    private fun scheduleIdleCaptureAttempt(delayMs: Long) {
        val generation = pendingCapture?.generation ?: return
        if (idleCapturePending && idleCaptureGeneration == generation) return
        idleCapturePending = true
        idleCaptureGeneration = generation
        mainHandler.postDelayed({
            val pending = pendingCapture
            if (pending == null || pending.generation != generation) {
                idleCapturePending = false
                return@postDelayed
            }
            Looper.getMainLooper().queue.addIdleHandler(MessageQueue.IdleHandler {
                idleCapturePending = false
                val currentPending = pendingCapture
                if (currentPending != null && currentPending.generation == generation) {
                    attemptPendingCapture(currentPending)
                }
                false
            })
        }, max(0L, delayMs))
    }

    private fun emitFrameForPendingCapture(
        pending: PendingCapture,
        shouldRender: Boolean
    ) {
        if (pendingCapture?.generation != pending.generation) return
        if (!_isRecording || isShuttingDown.get()) return

        pendingCapture = null

        val currentWindow = getCurrentWindow() ?: return
        val decorView = currentWindow.decorView
        if (decorView.width <= 0 || decorView.height <= 0) {
            return
        }

        val scanResult = pending.scanResult
        val hasBlockedSurface = scanResult?.let {
            it.cameraFrames.isNotEmpty() || it.webViewFrames.isNotEmpty() || it.videoFrames.isNotEmpty()
        } ?: false

        if (captureInProgress.getAndSet(true)) {
            return
        }

        if (shouldRender) {
            val sensitiveRects = resolveSensitiveRects(scanResult, decorView)
            captureFrameInternal(pending.reason, scanResult, sensitiveRects, currentWindow, decorView, hasBlockedSurface)
        } else {
            appendCachedFrame(pending.reason, scanResult, hasBlockedSurface)
        }
    }

    private fun resolveSensitiveRects(
        scanResult: ViewHierarchyScanResult?,
        decorView: View
    ): List<Rect> {
        val shouldMask =
            privacyMaskTextInputs || privacyMaskCameraViews || privacyMaskWebViews || privacyMaskVideoLayers
        if (!shouldMask) return emptyList()

        return try {
            scanResult?.let { collectSensitiveRects(it) } ?: run {
                val activity = (context as? ReactApplicationContext)?.currentActivity
                if (activity != null) {
                    PrivacyMask.findSensitiveRectsInAllWindows(activity, decorView)
                } else {
                    PrivacyMask.findSensitiveRects(decorView)
                }
            }
        } catch (e: Exception) {
            Logger.warning("[CaptureEngine] Sensitive rect scan failed: ${e.message}")
            emptyList()
        }
    }

    private fun appendCachedFrame(
        reason: String,
        scanResult: ViewHierarchyScanResult?,
        hasBlockedSurface: Boolean
    ) {
        val cachedBitmap = synchronized(cacheLock) {
            if (!hasBlockedSurface && lastCapturedHadBlockedSurface && lastSafeBitmap != null) {
                lastSafeBitmap
            } else {
                lastCapturedBitmap
            }
        }

        if (cachedBitmap == null || cachedBitmap.isRecycled) {
            captureInProgress.set(false)
            return
        }

        val timestamp = System.currentTimeMillis()
        processingExecutor.submit {
            val encoder = videoEncoder
            if (encoder == null) {
                captureInProgress.set(false)
                return@submit
            }
            val success = try {
                encoder.appendFrame(cachedBitmap, timestamp)
            } catch (e: Exception) {
                Logger.error("[CaptureEngine] Failed to append cached frame", e)
                false
            }

            if (success) {
                handleFrameAppended(scanResult, timestamp, didRender = false, hasBlockedSurface = hasBlockedSurface,
                    cachedBitmap = cachedBitmap)
            }
            captureInProgress.set(false)
        }
    }

    private fun captureFrameInternal(
        reason: String,
        scanResult: ViewHierarchyScanResult?,
        sensitiveRects: List<Rect>,
        currentWindow: Window,
        decorView: View,
        hasBlockedSurface: Boolean
    ) {
        if (!_isRecording || isShuttingDown.get()) {
            captureInProgress.set(false)
            return
        }

        if (videoEncoder == null) {
            captureInProgress.set(false)
            return
        }

        val nowMs = System.currentTimeMillis()
        if (nowMs < cooldownUntil) {
            captureInProgress.set(false)
            return
        }

        deviceWidth = decorView.width
        deviceHeight = decorView.height

        var effectiveScale = captureScale
        if (!effectiveScale.isFinite() || effectiveScale <= 0f) {
            effectiveScale = Constants.DEFAULT_CAPTURE_SCALE
        }

        if (adaptiveQualityEnabled) {
            if (currentPerformanceLevel == PerformanceLevel.REDUCED) {
                effectiveScale = minOf(effectiveScale, 0.25f)
            } else if (currentPerformanceLevel == PerformanceLevel.MINIMAL) {
                effectiveScale = minOf(effectiveScale, 0.15f)
            }
        }

        val scaledWidth = (decorView.width * effectiveScale).toInt().coerceAtLeast(1)
        val scaledHeight = (decorView.height * effectiveScale).toInt().coerceAtLeast(1)

        try {
            val bitmap = getBitmap(scaledWidth, scaledHeight)
            val requiresPixelCopy = requiresPixelCopyCapture(decorView)

            if (requiresPixelCopy) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    try {
                        PixelCopy.request(
                            currentWindow,
                            bitmap,
                            { copyResult ->
                                if (copyResult == PixelCopy.SUCCESS) {
                                    processingExecutor.submit {
                                        processCapture(
                                            bitmap,
                                            reason,
                                            sensitiveRects,
                                            decorView.width,
                                            decorView.height,
                                            scanResult,
                                            hasBlockedSurface
                                        )
                                    }
                                } else {
                                    Logger.debug("[CaptureEngine] PixelCopy failed with result: $copyResult")
                                    captureInProgress.set(false)
                                    returnBitmap(bitmap)
                                }
                            },
                            mainHandler
                        )
                    } catch (e: Exception) {
                        Logger.debug("[CaptureEngine] PixelCopy request failed: ${e.message}")
                        captureInProgress.set(false)
                        returnBitmap(bitmap)
                    }
                } else {
                    captureInProgress.set(false)
                    returnBitmap(bitmap)
                }
            } else {
                try {
                    val canvas = Canvas(bitmap)

                    val scaleX = bitmap.width.toFloat() / decorView.width.toFloat()
                    val scaleY = bitmap.height.toFloat() / decorView.height.toFloat()
                    if (!scaleX.isFinite() || !scaleY.isFinite() || scaleX <= 0f || scaleY <= 0f) {
                        captureInProgress.set(false)
                        returnBitmap(bitmap)
                        return
                    }
                    canvas.scale(scaleX, scaleY)

                    decorView.draw(canvas)

                    processingExecutor.submit {
                        processCapture(
                            bitmap,
                            reason,
                            sensitiveRects,
                            decorView.width,
                            decorView.height,
                            scanResult,
                            hasBlockedSurface
                        )
                    }
                } catch (e: Exception) {
                    Logger.debug("[CaptureEngine] Direct draw failed: ${e.message}")
                    captureInProgress.set(false)
                    returnBitmap(bitmap)
                }
            }
        } catch (e: Exception) {
            Logger.error("[CaptureEngine] Capture failed", e)
            captureInProgress.set(false)
        }
    }

    private fun processCapture(
        bitmap: Bitmap,
        reason: String,
        sensitiveRects: List<Rect>,
        rootWidth: Int,
        rootHeight: Int,
        scanResult: ViewHierarchyScanResult?,
        hasBlockedSurface: Boolean
    ) {
        if (isShuttingDown.get()) {
            returnBitmap(bitmap)
            captureInProgress.set(false)
            return
        }
        
        val encoder = videoEncoder ?: run {
            returnBitmap(bitmap)
            captureInProgress.set(false)
            return
        }

        try {
            PerfTiming.time(PerfMetric.FRAME) {
                val now = System.currentTimeMillis()

                val shouldMask = privacyMaskTextInputs || privacyMaskCameraViews ||
                    privacyMaskWebViews || privacyMaskVideoLayers
                val maskedBitmap = if (sensitiveRects.isNotEmpty() && shouldMask) {
                    PrivacyMask.applyMasksToBitmap(bitmap, sensitiveRects, rootWidth, rootHeight)
                } else {
                    bitmap
                }

                val timestamp = System.currentTimeMillis()

                val success = encoder.appendFrame(maskedBitmap, timestamp)

                if (success) {
                    Logger.debug("[CaptureEngine] Frame captured ($reason) - ${maskedBitmap.width}x${maskedBitmap.height}")
                    handleFrameAppended(
                        scanResult = scanResult,
                        timestamp = timestamp,
                        didRender = true,
                        hasBlockedSurface = hasBlockedSurface,
                        cachedBitmap = maskedBitmap
                    )

                    try {
                        onFrameCaptured?.invoke()
                    } catch (_: Exception) {
                    }
                }

                captureInProgress.set(false)

                if (!success) {
                    if (maskedBitmap !== bitmap) {
                        maskedBitmap.recycle()
                    }
                    returnBitmap(bitmap)
                    return@time
                }

                if (maskedBitmap !== bitmap) {
                    returnBitmap(bitmap)
                }
            }

        } catch (e: Exception) {
            Logger.error("[CaptureEngine] Failed to process capture", e)
            captureInProgress.set(false)
            returnBitmap(bitmap)
        }
    }

    private fun handleFrameAppended(
        scanResult: ViewHierarchyScanResult?,
        timestamp: Long,
        didRender: Boolean,
        hasBlockedSurface: Boolean,
        cachedBitmap: Bitmap
    ) {
        if (didRender) {
            captureHeuristics.recordRenderedSignature(
                scanResult?.layoutSignature,
                android.os.SystemClock.elapsedRealtime()
            )
            updateCachedFrames(cachedBitmap, hasBlockedSurface)
        }

        lastCaptureTime = timestamp
        consecutiveCaptureCount++
        updateFrameRateTracking()
        if (consecutiveCaptureCount >= Constants.MAX_CONSECUTIVE_CAPTURES) {
            cooldownUntil = System.currentTimeMillis() +
                (Constants.CAPTURE_COOLDOWN_SECONDS * 1000).toLong()
            consecutiveCaptureCount = 0
        }

        framesSinceSessionStart++
        framesSinceHierarchy++
        val layoutSignature = scanResult?.layoutSignature
        val layoutChanged = layoutSignature != null && layoutSignature != lastSerializedSignature
        val shouldSerialize = scanResult?.scrollActive != true

        val shouldCaptureHierarchy = if (scanResult == null) {
            framesSinceHierarchy == 1 || framesSinceHierarchy >= hierarchyCaptureInterval
        } else {
            shouldSerialize && (
                framesSinceHierarchy == 1 ||
                    (layoutChanged && framesSinceHierarchy >= hierarchyCaptureInterval) ||
                    framesSinceHierarchy >= 30
            )
        }

        if (shouldCaptureHierarchy) {
            captureHierarchySnapshot(timestamp, scanResult)
            framesSinceHierarchy = 0
            if (layoutSignature != null) {
                lastSerializedSignature = layoutSignature
            }
        }
    }

    private fun updateCachedFrames(bitmap: Bitmap, hasBlockedSurface: Boolean) {
        val toRelease = mutableListOf<Bitmap>()
        synchronized(cacheLock) {
            val previousCaptured = lastCapturedBitmap
            val previousSafe = lastSafeBitmap

            lastCapturedBitmap = bitmap
            lastCapturedHadBlockedSurface = hasBlockedSurface
            if (!hasBlockedSurface) {
                lastSafeBitmap = bitmap
            }

            if (previousCaptured != null && previousCaptured !== lastCapturedBitmap &&
                previousCaptured !== lastSafeBitmap) {
                toRelease.add(previousCaptured)
            }
            if (previousSafe != null && previousSafe !== lastCapturedBitmap &&
                previousSafe !== lastSafeBitmap) {
                toRelease.add(previousSafe)
            }
        }
        toRelease.forEach { returnBitmap(it) }
    }

    private fun collectSensitiveRects(scanResult: ViewHierarchyScanResult): List<Rect> {
        val rects = mutableListOf<Rect>()
        if (privacyMaskTextInputs) {
            rects.addAll(scanResult.textInputFrames)
        }
        if (privacyMaskWebViews) {
            rects.addAll(scanResult.webViewFrames)
        }
        if (privacyMaskCameraViews) {
            rects.addAll(scanResult.cameraFrames)
        }
        if (privacyMaskVideoLayers) {
            rects.addAll(scanResult.videoFrames)
        }
        return rects
    }
    
    /**
     * OPTIMIZATION 4: Render Server Pre-warming
     * Performs a dummy render to initialize the graphics subsystem/driver
     * before the actual recording starts.
     */
    private fun prewarmRenderServer() {
        try {
            val window = getCurrentWindow() ?: return
            val bitmap = getBitmap(1, 1)
            val canvas = Canvas(bitmap)
            window.decorView.draw(canvas)
            returnBitmap(bitmap)
            Logger.debug("[CaptureEngine] Render server pre-warmed")
        } catch (e: Exception) {
            Logger.debug("[CaptureEngine] Render server pre-warm failed (non-critical): ${e.message}")
        }
    }
    
    /**
     * Capture the current view hierarchy for click/hover maps.
     */
    private fun captureHierarchySnapshot(timestamp: Long, scanResult: ViewHierarchyScanResult?) {
        try {
            mainHandler.post {
                try {
                    val window = getCurrentWindow() ?: return@post
                    val serializer = viewSerializer ?: return@post

                    val hierarchy = PerfTiming.time(PerfMetric.VIEW_SERIALIZE) {
                        serializer.serializeWindow(window, scanResult, timestamp)
                    }

                    if (hierarchy.isNotEmpty()) {
                        val snapshot = hierarchy.toMutableMap()
                        currentScreenName?.let { snapshot["screenName"] = it }
                        if (snapshot["root"] != null && snapshot["rootElement"] == null) {
                            snapshot["rootElement"] = snapshot["root"]
                        }

                        synchronized(hierarchySnapshots) {
                            hierarchySnapshots.add(snapshot)
                        }

                        Logger.debug("[CaptureEngine] Hierarchy snapshot captured (${hierarchySnapshots.size} accumulated)")
                    } else {
                        Logger.warning("[CaptureEngine] Hierarchy serialization returned empty")
                    }
                } catch (e: Exception) {
                    Logger.warning("[CaptureEngine] Hierarchy snapshot failed: ${e.message}")
                }
            }
        } catch (e: Exception) {
            Logger.error("[CaptureEngine] Failed to capture hierarchy snapshot", e)
        }
    }
    
    /**
     * Upload accumulated hierarchy snapshots.
     */
    private fun uploadCurrentHierarchySnapshots() {
        Logger.debug("[CaptureEngine] uploadCurrentHierarchySnapshots: START (sessionId=$sessionId)")
        
        val snapshotsToUpload: List<Map<String, Any?>>
        synchronized(hierarchySnapshots) {
            Logger.debug("[CaptureEngine] uploadCurrentHierarchySnapshots: hierarchySnapshots.size=${hierarchySnapshots.size}")
            if (hierarchySnapshots.isEmpty()) {
                Logger.debug("[CaptureEngine] uploadCurrentHierarchySnapshots: No hierarchy snapshots to upload, returning")
                return
            }
            snapshotsToUpload = hierarchySnapshots.toList()
            hierarchySnapshots.clear()
            Logger.debug("[CaptureEngine] uploadCurrentHierarchySnapshots: Copied ${snapshotsToUpload.size} snapshots, cleared buffer")
        }
        
        try {
            Logger.debug("[CaptureEngine] uploadCurrentHierarchySnapshots: Converting ${snapshotsToUpload.size} snapshots to JSON")
            
            val jsonArray = JSONArray()
            for (snapshot in snapshotsToUpload) {
                try {
                    jsonArray.put(mapToJson(snapshot))
                } catch (e: Exception) {
                    Logger.warning("[CaptureEngine] Skipping snapshot JSON entry: ${e.message}")
                }
            }
            
            val jsonData = jsonArray.toString().toByteArray(Charsets.UTF_8)
            val timestamp = System.currentTimeMillis()
            
            Logger.debug("[CaptureEngine] uploadCurrentHierarchySnapshots: JSON created, size=${jsonData.size} bytes, timestamp=$timestamp")
            Logger.debug("[CaptureEngine] uploadCurrentHierarchySnapshots: Calling delegate.onHierarchySnapshotsReady (delegate=${delegate != null})")
            
            delegate?.onHierarchySnapshotsReady(jsonData, timestamp) ?: run {
                Logger.error("[CaptureEngine] uploadCurrentHierarchySnapshots: ❌ Delegate is NULL, cannot upload hierarchy!")
            }
            
            Logger.debug("[CaptureEngine] uploadCurrentHierarchySnapshots: ✅ Delegate callback completed")
            
        } catch (e: Exception) {
            Logger.error("[CaptureEngine] uploadCurrentHierarchySnapshots: ❌ Exception: ${e.message}", e)
        }
    }
    
    /**
     * Convert a map to JSONObject recursively.
     */
    @Suppress("UNCHECKED_CAST")
    private fun mapToJson(map: Map<String, Any?>): JSONObject {
        val json = JSONObject()
        for ((key, value) in map) {
            when (value) {
                null -> json.put(key, JSONObject.NULL)
                is Map<*, *> -> json.put(key, mapToJson(value as Map<String, Any?>))
                is List<*> -> {
                    val arr = JSONArray()
                    for (item in value) {
                        when (item) {
                            is Map<*, *> -> arr.put(mapToJson(item as Map<String, Any?>))
                            else -> arr.put(item)
                        }
                    }
                    json.put(key, arr)
                }
                else -> json.put(key, value)
            }
        }
        return json
    }

    private fun getCurrentWindow(): Window? {
        return try {
            (context as? ReactApplicationContext)?.currentActivity?.window
        } catch (e: Exception) {
            Logger.error("[CaptureEngine] Failed to get current window", e)
            null
        }
    }

    private fun updatePerformanceLevel() {
        if (thermalThrottleEnabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val thermalLevel = getThermalStatus()
            when (thermalLevel) {
                PowerManager.THERMAL_STATUS_CRITICAL,
                PowerManager.THERMAL_STATUS_EMERGENCY,
                PowerManager.THERMAL_STATUS_SHUTDOWN -> {
                    currentPerformanceLevel = PerformanceLevel.PAUSED
                    return
                }
                PowerManager.THERMAL_STATUS_SEVERE -> {
                    currentPerformanceLevel = PerformanceLevel.MINIMAL
                    return
                }
                PowerManager.THERMAL_STATUS_MODERATE -> {
                    currentPerformanceLevel = PerformanceLevel.REDUCED
                    return
                }
            }
        }
        
        currentPerformanceLevel = when {
            isLowBattery() && batteryAwareEnabled -> {
                if (cachedBatteryLevel < 0.15f) PerformanceLevel.MINIMAL
                else if (cachedBatteryLevel < 0.30f) PerformanceLevel.REDUCED
                else PerformanceLevel.NORMAL
            }
            else -> PerformanceLevel.NORMAL
        }
    }
    
    /**
     * Get current thermal status (Android Q+).
     * Returns THERMAL_STATUS_NONE for older devices.
     */
    private fun getThermalStatus(): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return PowerManager.THERMAL_STATUS_NONE
        }
        return try {
            val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            powerManager?.currentThermalStatus ?: PowerManager.THERMAL_STATUS_NONE
        } catch (e: Exception) {
            Logger.debug("[CaptureEngine] Error getting thermal status: ${e.message}")
            PowerManager.THERMAL_STATUS_NONE
        }
    }

    private fun isLowBattery(): Boolean {
        val now = System.currentTimeMillis()
        if (now - lastBatteryCheckTime > 15000) {
            lastBatteryCheckTime = now
            try {
                val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
                cachedBatteryLevel = batteryManager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.let {
                    it / 100f
                } ?: 1.0f
            } catch (e: Exception) {
                cachedBatteryLevel = 1.0f
            }
        }
        return cachedBatteryLevel < 0.15f
    }

    private fun shouldCapture(importance: CaptureImportance): Boolean {
        val now = System.currentTimeMillis()

        if (importance == CaptureImportance.CRITICAL) {
            return true
        }

        val elapsed = (now - lastCaptureTime) / 1000.0
        if (elapsed < minFrameInterval) {
            return false
        }

        if (framesThisMinute >= maxFramesPerMinute) {
            return importance.value >= CaptureImportance.HIGH.value
        }

        return when (currentPerformanceLevel) {
            PerformanceLevel.PAUSED -> importance == CaptureImportance.CRITICAL
            PerformanceLevel.MINIMAL -> importance.value >= CaptureImportance.HIGH.value
            PerformanceLevel.REDUCED -> importance.value >= CaptureImportance.MEDIUM.value
            PerformanceLevel.NORMAL -> true
        }
    }

    private fun updateFrameRateTracking() {
        val now = System.currentTimeMillis()
        if (now - minuteStartTime >= 60_000) {
            minuteStartTime = now
            framesThisMinute = 0
        }
        framesThisMinute++
    }

    /**
     * Detect whether we need PixelCopy to capture GPU-backed content.
     * SurfaceView/TextureView/GLSurfaceView (MapView, video, camera) require PixelCopy.
     * Falls back to direct draw otherwise for better CPU performance.
     */
    private fun requiresPixelCopyCapture(view: View, depth: Int = 0): Boolean {
        if (depth > 12) return false

        if (view is SurfaceView || view is TextureView || view is GLSurfaceView) {
            return true
        }

        val className = view.javaClass.name.lowercase()
        val simpleName = view.javaClass.simpleName.lowercase()

        if (className.contains("mapview") || simpleName.contains("mapview") ||
            className.contains("airmap") || simpleName.contains("airmap") ||
            className.contains("googlemap") || simpleName.contains("googlemap") ||
            className.contains("cameraview") || simpleName.contains("cameraview") ||
            className.contains("previewview") || simpleName.contains("previewview") ||
            className.contains("playerview") || simpleName.contains("playerview") ||
            className.contains("exoplayer") || simpleName.contains("exoplayer") ||
            className.contains("videoview") || simpleName.contains("videoview")) {
            return true
        }

        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                if (requiresPixelCopyCapture(view.getChildAt(i), depth + 1)) {
                    return true
                }
            }
        }

        return false
    }
    
    private fun startCaptureTimer() {
        stopCaptureTimer()
        captureRunnable = object : Runnable {
            override fun run() {
                if (_isRecording) {
                    captureFrame(CaptureImportance.LOW, "timer")
                    mainHandler.postDelayed(this, captureIntervalMs)
                }
            }
        }
        mainHandler.postDelayed(captureRunnable!!, captureIntervalMs)
    }

    private fun stopCaptureTimer() {
        captureRunnable?.let { mainHandler.removeCallbacks(it) }
        captureRunnable = null
    }

    private fun getBitmap(width: Int, height: Int): Bitmap {
        val pooled = bitmapPool.poll()
        if (pooled != null && !pooled.isRecycled) {
            if (pooled.width >= width && pooled.height >= height) {
                if (pooled.width == width && pooled.height == height) {
                    return pooled
                } else {
                    bitmapPool.offer(pooled)
                }
            } else {
                pooled.recycle()
            }
        }
        
        return try {
            Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        } catch (e: OutOfMemoryError) {
            clearBitmapPool()
            System.gc()
            Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)
        }
    }

    /**
     * OPTIMIZATION: Aggressive bitmap pool management to reduce GC pressure.
     * Recycles bitmaps immediately when pool is full instead of keeping them in memory.
     */
    private fun returnBitmap(bitmap: Bitmap) {
        if (bitmap.isRecycled) return
        
        val maxPoolSize = when (currentPerformanceLevel) {
            PerformanceLevel.MINIMAL, PerformanceLevel.PAUSED -> 2
            PerformanceLevel.REDUCED -> 4
            PerformanceLevel.NORMAL -> MAX_POOL_SIZE
        }
        
        if (bitmapPool.size < maxPoolSize) {
            val bitmapBytes = bitmap.byteCount
            if (bitmapBytes < 2 * 1024 * 1024) {
                bitmapPool.offer(bitmap)
                return
            }
        }
        
        bitmap.recycle()
    }
    
    /**
     * OPTIMIZATION: Clear bitmap pool and suggest GC.
     * Called during memory pressure or cleanup.
     */
    private fun clearBitmapPool() {
        var recycledCount = 0
        while (bitmapPool.isNotEmpty()) {
            bitmapPool.poll()?.recycle()
            recycledCount++
        }
        if (recycledCount > 0) {
            Logger.debug("[CaptureEngine] Recycled $recycledCount pooled bitmaps")
            System.gc()
        }
    }

    private fun resetCachedFrames() {
        val toRelease = mutableListOf<Bitmap>()
        synchronized(cacheLock) {
            lastCapturedBitmap?.let { toRelease.add(it) }
            lastSafeBitmap?.let { safe ->
                if (safe !== lastCapturedBitmap) {
                    toRelease.add(safe)
                }
            }
            lastCapturedBitmap = null
            lastSafeBitmap = null
            lastCapturedHadBlockedSurface = false
        }
        toRelease.forEach { returnBitmap(it) }
    }

    private fun cleanupOldSegments() {
        scope.launch {
            try {
                val cutoffTime = System.currentTimeMillis() - (24 * 60 * 60 * 1000)
                segmentDir.listFiles()?.forEach { file ->
                    if (file.isFile && file.name.endsWith(".mp4") && file.lastModified() < cutoffTime) {
                        file.delete()
                        Logger.debug("[CaptureEngine] Cleaned up old segment: ${file.name}")
                    }
                }
            } catch (e: Exception) {
                Logger.debug("[CaptureEngine] Error cleaning old segments: ${e.message}")
            }
        }
    }

    fun shutdown() {
        isShuttingDown.set(true)
        stopSession()
        processingExecutor.shutdown()
        scope.cancel()
    }

    private companion object {
        private const val DEFENSIVE_CAPTURE_DELAY_NAVIGATION_MS = 200L
        private const val DEFENSIVE_CAPTURE_DELAY_INTERACTION_MS = 150L
        private const val DEFENSIVE_CAPTURE_DELAY_SCROLL_MS = 200L
        private const val DEFENSIVE_CAPTURE_DELAY_MAP_MS = 550L
        private const val MAP_PRESENCE_WINDOW_MS = 2000L
    }
}
