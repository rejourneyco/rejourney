/**
 * Shared implementation for Rejourney React Native module.
 * 
 * This class contains all the business logic shared between:
 * - Old Architecture (Bridge) module
 * - New Architecture (TurboModules) module
 * 
 * The actual RejourneyModule classes in oldarch/ and newarch/ are thin wrappers
 * that delegate to this implementation.
 */
package com.rejourney

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.provider.Settings
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.rejourney.lifecycle.SessionLifecycleService
import com.rejourney.lifecycle.TaskRemovedListener
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.rejourney.capture.CaptureEngine
import com.rejourney.capture.CaptureEngineDelegate
import com.rejourney.capture.CrashHandler
import com.rejourney.capture.ANRHandler
import com.rejourney.core.Constants
import com.rejourney.core.EventType
import com.rejourney.core.Logger
import com.rejourney.core.SDKMetrics
import com.rejourney.network.AuthFailureListener
import com.rejourney.network.DeviceAuthManager
import com.rejourney.network.NetworkMonitor
import com.rejourney.network.NetworkMonitorListener
import com.rejourney.network.UploadManager
import com.rejourney.network.UploadWorker
import com.rejourney.touch.KeyboardTracker
import com.rejourney.touch.KeyboardTrackerListener
import com.rejourney.touch.TextInputTracker
import com.rejourney.touch.TextInputTrackerListener
import com.rejourney.touch.TouchInterceptor
import com.rejourney.touch.TouchInterceptorDelegate
import com.rejourney.utils.EventBuffer
import com.rejourney.utils.OEMDetector
import com.rejourney.utils.Telemetry
import com.rejourney.utils.WindowUtils
import kotlinx.coroutines.*
import java.security.MessageDigest
import java.io.File
import java.util.*
import java.util.concurrent.CopyOnWriteArrayList

enum class EndReason {
    SESSION_TIMEOUT,
    MANUAL_STOP,
    DURATION_LIMIT,
    REMOTE_DISABLE
}

class RejourneyModuleImpl(
    private val reactContext: ReactApplicationContext,
    private val isNewArchitecture: Boolean
) : Application.ActivityLifecycleCallbacks, 
    TouchInterceptorDelegate, 
    NetworkMonitorListener, 
    DefaultLifecycleObserver,
    KeyboardTrackerListener,
    TextInputTrackerListener,
    ANRHandler.ANRListener,
    CaptureEngineDelegate,
    AuthFailureListener {

    companion object {
        const val NAME = "Rejourney"
        const val BACKGROUND_RESUME_TIMEOUT_MS = 30_000L
        
        private const val MAX_AUTH_RETRIES = 5
        private const val AUTH_RETRY_BASE_DELAY_MS = 2000L
        private const val AUTH_RETRY_MAX_DELAY_MS = 60000L
        private const val AUTH_BACKGROUND_RETRY_DELAY_MS = 300000L
        
        @JvmStatic
        private val processStartTimeMs: Long = run {
            try {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
                    val startElapsed = android.os.Process.getStartElapsedRealtime()
                    val nowElapsed = android.os.SystemClock.elapsedRealtime()
                    System.currentTimeMillis() - (nowElapsed - startElapsed)
                } else {
                    System.currentTimeMillis()
                }
            } catch (e: Exception) {
                System.currentTimeMillis()
            }
        }
    }

    private var captureEngine: CaptureEngine? = null
    private var uploadManager: UploadManager? = null
    private var touchInterceptor: TouchInterceptor? = null
    private var deviceAuthManager: DeviceAuthManager? = null
    private var networkMonitor: NetworkMonitor? = null
    private var keyboardTracker: KeyboardTracker? = null
    private var textInputTracker: TextInputTracker? = null

    private var currentSessionId: String? = null
    private var userId: String? = null
    @Volatile private var isRecording: Boolean = false
    @Volatile private var remoteRejourneyEnabled: Boolean = true
    @Volatile private var remoteRecordingEnabled: Boolean = true
    @Volatile private var recordingEnabledByConfig: Boolean = true
    @Volatile private var sessionSampled: Boolean = true
    @Volatile private var hasSampleDecision: Boolean = false
    @Volatile private var hasProjectConfig: Boolean = false
    private var projectSampleRate: Int = 100
    private var sessionStartTime: Long = 0
    private var totalBackgroundTimeMs: Long = 0
    private var backgroundEntryTime: Long = 0
    private var wasInBackground: Boolean = false
    private var maxRecordingMinutes: Int = 10
    @Volatile private var sessionEndSent: Boolean = false
    
    private var keyPressCount: Int = 0
    private var isKeyboardVisible: Boolean = false
    private var lastKeyboardHeight: Int = 0
    
    private var savedApiUrl: String = ""
    private var savedPublicKey: String = ""
    private var savedDeviceHash: String = ""

    private val sessionEvents = CopyOnWriteArrayList<Map<String, Any?>>()

    @Volatile private var lastImmediateUploadKickMs: Long = 0
    
    private var eventBuffer: EventBuffer? = null

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    
    private val backgroundScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var batchUploadJob: Job? = null
    private var durationLimitJob: Job? = null
    
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

    private var scheduledBackgroundRunnable: Runnable? = null
    private var backgroundScheduled: Boolean = false

    @Volatile private var isShuttingDown = false

    private var authRetryCount = 0
    private var authPermanentlyFailed = false
    private var authRetryJob: Job? = null

    init {
        Logger.debug("RejourneyModuleImpl constructor completed")
    }
    
    @Volatile
    private var isInitialized = false
    private val initLock = Any()
    
    /**
     * Lazy initialization - called on first method invocation.
     * This ensures the module constructor completes successfully for React Native.
     */
    private fun ensureInitialized() {
        if (isInitialized) return
        
        synchronized(initLock) {
            if (isInitialized) return
            
            try {
                logReactNativeArchitecture()
                setupComponents()
                registerActivityLifecycleCallbacks()
                registerProcessLifecycleObserver()
                
                try {
                    CrashHandler.getInstance(reactContext).startMonitoring()
                } catch (e: Exception) {
                    Logger.error("Failed to start crash handler (non-critical)", e)
                }
                
                try {
                    ANRHandler.getInstance(reactContext).apply {
                        listener = this@RejourneyModuleImpl
                        startMonitoring()
                    }
                } catch (e: Exception) {
                    Logger.error("Failed to start ANR handler (non-critical)", e)
                }
                
                try {
                    NetworkMonitor.getInstance(reactContext).startMonitoring()
                } catch (e: Exception) {
                    Logger.error("Failed to start network monitor (non-critical)", e)
                }
                
                try {
                    UploadWorker.scheduleRecoveryUpload(reactContext)
                } catch (e: Exception) {
                    Logger.error("Failed to schedule recovery upload (non-critical)", e)
                }
                
                try {
                    checkPreviousAppKill()
                } catch (e: Exception) {
                    Logger.error("Failed to check previous app kill (non-critical)", e)
                }
                
                try {
                    checkForUnclosedSessions()
                } catch (e: Exception) {
                    Logger.error("Failed to check for unclosed sessions (non-critical)", e)
                }
                
                val oem = OEMDetector.getOEM()
                Logger.debug("Device OEM: $oem")
                Logger.debug("OEM Recommendations: ${OEMDetector.getRecommendations()}")
                Logger.debug("onTaskRemoved() reliable: ${OEMDetector.isTaskRemovedReliable()}")
                
                try {
                    SessionLifecycleService.taskRemovedListener = object : TaskRemovedListener {
                        override fun onTaskRemoved() {
                            Logger.debug("[Rejourney] App terminated via swipe-away - SYNCHRONOUS session end (OEM: $oem)")
                            
                            Logger.debug("[Rejourney] App terminated via swipe-away. Relying on next-launch recovery.")
                            // CRITICAL: Do NOT attempt synchronous network calls here.
                            // It causes ANRs. The UploadWorker and checkForUnclosedSessions
                            // will handle the session close on next launch.
                        }
                    }
                } catch (e: Exception) {
                    Logger.error("Failed to set up task removed listener (non-critical)", e)
                }
                
                Logger.logInitSuccess(Constants.SDK_VERSION)
                
                isInitialized = true
            } catch (e: Exception) {
                Logger.logInitFailure("${e.javaClass.simpleName}: ${e.message}")
                isInitialized = true
            }
        }
    }
    
    /**
     * Adds an event with immediate disk persistence for crash safety.
     * This is the industry-standard approach for volume control.
     */
    /**
     * Adds an event with immediate disk persistence for crash safety.
     * This is the industry-standard approach for volume control.
     * 2026-02-01: Updated to launch in backgroundScope to avoid blocking main thread.
     */
    private fun addEventWithPersistence(event: Map<String, Any?>) {
        val eventType = event["type"]?.toString() ?: "unknown"
        val sessionId = currentSessionId ?: "no-session"
        
        Logger.debug("[Rejourney] addEventWithPersistence: type=$eventType, sessionId=$sessionId, inMemoryCount=${sessionEvents.size + 1}")
        
        // Add to in-memory list immediately for "session end" aggregation
        sessionEvents.add(event)
        
        // Persist to disk in background
        backgroundScope.launch {
            try {
                val bufferSuccess = eventBuffer?.appendEvent(event) ?: false
                if (!bufferSuccess) {
                    Logger.warning("[Rejourney] addEventWithPersistence: Failed to append event to buffer: type=$eventType")
                } else {
                    Logger.debug("[Rejourney] addEventWithPersistence: Event appended to buffer: type=$eventType")
                }
            } catch (e: Exception) {
                Logger.error("[Rejourney] Failed to persist event asynchronously", e)
            }
        }

        Logger.debug("[Rejourney] addEventWithPersistence: Event added to in-memory list: type=$eventType, totalInMemory=${sessionEvents.size}")
    }
    
    /**
     * Register with ProcessLifecycleOwner for reliable app foreground/background detection.
     * This is more reliable than Activity lifecycle callbacks.
     */
    private fun registerProcessLifecycleObserver() {
        Handler(Looper.getMainLooper()).post {
            try {
                ProcessLifecycleOwner.get().lifecycle.addObserver(this)
                Logger.debug("ProcessLifecycleOwner observer registered")
            } catch (e: Exception) {
                Logger.error("Failed to register ProcessLifecycleOwner observer (non-critical)", e)
            }
        }
    }

    /**
     * Log which React Native architecture is being used.
     */
    private fun logReactNativeArchitecture() {
        val archType = if (isNewArchitecture) "New Architecture (TurboModules)" else "Old Architecture (Bridge)"
        Logger.logArchitectureInfo(isNewArchitecture, archType)
    }

    private fun setupComponents() {
        try {
            captureEngine = CaptureEngine(reactContext).apply {
                captureScale = Constants.DEFAULT_CAPTURE_SCALE
                minFrameInterval = Constants.DEFAULT_MIN_FRAME_INTERVAL
                maxFramesPerMinute = Constants.DEFAULT_MAX_FRAMES_PER_MINUTE
                targetBitrate = Constants.DEFAULT_VIDEO_BITRATE
                targetFps = Constants.DEFAULT_VIDEO_FPS
                framesPerSegment = Constants.DEFAULT_FRAMES_PER_SEGMENT
                delegate = this@RejourneyModuleImpl
            }
            Logger.debug("CaptureEngine initialized")
        } catch (e: Exception) {
            Logger.error("Failed to initialize CaptureEngine", e)
            captureEngine = null
        }

        try {
            uploadManager = UploadManager(reactContext, "https://api.rejourney.co")
            Logger.debug("UploadManager initialized")
        } catch (e: Exception) {
            Logger.error("Failed to initialize UploadManager", e)
            uploadManager = null
        }

        try {
            touchInterceptor = TouchInterceptor.getInstance(reactContext).apply {
                delegate = this@RejourneyModuleImpl
            }
            Logger.debug("TouchInterceptor initialized")
        } catch (e: Exception) {
            Logger.error("Failed to initialize TouchInterceptor", e)
            touchInterceptor = null
        }

        try {
            deviceAuthManager = DeviceAuthManager.getInstance(reactContext).apply {
                authFailureListener = this@RejourneyModuleImpl
            }
            Logger.debug("DeviceAuthManager initialized")
        } catch (e: Exception) {
            Logger.error("Failed to initialize DeviceAuthManager", e)
            deviceAuthManager = null
        }

        try {
            networkMonitor = NetworkMonitor.getInstance(reactContext).apply {
                listener = this@RejourneyModuleImpl
            }
            Logger.debug("NetworkMonitor initialized")
        } catch (e: Exception) {
            Logger.error("Failed to initialize NetworkMonitor", e)
            networkMonitor = null
        }
        
        try {
            keyboardTracker = KeyboardTracker.getInstance(reactContext).apply {
                listener = this@RejourneyModuleImpl
            }
            Logger.debug("KeyboardTracker initialized")
        } catch (e: Exception) {
            Logger.error("Failed to initialize KeyboardTracker", e)
            keyboardTracker = null
        }
        
        try {
            textInputTracker = TextInputTracker.getInstance(reactContext).apply {
                listener = this@RejourneyModuleImpl
            }
            Logger.debug("TextInputTracker initialized")
        } catch (e: Exception) {
            Logger.error("Failed to initialize TextInputTracker", e)
            textInputTracker = null
        }
    }

    private fun registerActivityLifecycleCallbacks() {
        try {
            val application = reactContext.applicationContext as? Application
            if (application != null) {
                application.registerActivityLifecycleCallbacks(this)
                Logger.debug("Activity lifecycle callbacks registered")
            } else {
                Logger.error("Failed to register activity lifecycle callbacks - application context is not Application type")
            }
        } catch (e: Exception) {
            Logger.error("Failed to register activity lifecycle callbacks", e)
        }
    }

    fun invalidate() {
        isShuttingDown = true
        scope.cancel()
        stopBatchUploadTimer()
        stopDurationLimitTimer()
        touchInterceptor?.disableGlobalTracking()
        keyboardTracker?.stopTracking()
        textInputTracker?.stopTracking()
        networkMonitor?.stopMonitoring()
        
        val application = reactContext.applicationContext as? Application
        application?.unregisterActivityLifecycleCallbacks(this)
        
        Handler(Looper.getMainLooper()).post {
            try {
                ProcessLifecycleOwner.get().lifecycle.removeObserver(this)
            } catch (e: Exception) {
            }
        }
    }

    fun getDeviceInfo(promise: Promise) {
        try {
            val map = Arguments.createMap()
            map.putString("model", android.os.Build.MODEL)
            map.putString("brand", android.os.Build.MANUFACTURER)
            map.putString("systemName", "Android")
            map.putString("systemVersion", android.os.Build.VERSION.RELEASE)
            map.putString("bundleId", reactContext.packageName)
            
            try {
                val pInfo = reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
                map.putString("appVersion", pInfo.versionName)
                if (android.os.Build.VERSION.SDK_INT >= 28) {
                    map.putString("buildNumber", pInfo.longVersionCode.toString())
                } else {
                    @Suppress("DEPRECATION")
                    map.putString("buildNumber", pInfo.versionCode.toString())
                }
            } catch (e: Exception) {
                map.putString("appVersion", "unknown")
            }
            
            map.putBoolean("isTablet", isTablet())
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("DEVICE_INFO_ERROR", e)
        }
    }

    private fun isTablet(): Boolean {
        val configuration = reactContext.resources.configuration
        return (configuration.screenLayout and android.content.res.Configuration.SCREENLAYOUT_SIZE_MASK) >= 
                android.content.res.Configuration.SCREENLAYOUT_SIZE_LARGE
    }

    fun startSession(userId: String, apiUrl: String, publicKey: String, promise: Promise) {
        ensureInitialized()
        
        if (isShuttingDown) {
            promise.resolve(createResultMap(false, "", "Module is shutting down"))
            return
        }

        remoteRejourneyEnabled = true

        scope.launch {
            try {
                if (isRecording) {
                    promise.resolve(createResultMap(true, currentSessionId ?: ""))
                    return@launch
                }

                val safeUserId = userId.ifEmpty { "anonymous" }
                val safeApiUrl = apiUrl.ifEmpty { "https://api.rejourney.co" }
                val safePublicKey = publicKey.ifEmpty { "" }

                val androidId = Settings.Secure.getString(
                    reactContext.contentResolver,
                    Settings.Secure.ANDROID_ID
                ) ?: "unknown"
                val deviceHash = generateSHA256Hash(androidId)

                this@RejourneyModuleImpl.userId = safeUserId
                currentSessionId = WindowUtils.generateSessionId()
                sessionStartTime = System.currentTimeMillis()
                totalBackgroundTimeMs = 0
                sessionEndSent = false
                sessionEvents.clear()

                remoteRecordingEnabled = true
                recordingEnabledByConfig = true
                projectSampleRate = 100
                hasProjectConfig = false
                resetSamplingDecision()

                reactContext.getSharedPreferences("rejourney", 0)
                    .edit()
                    .putString("rj_current_session_id", currentSessionId)
                    .apply()

                uploadManager?.apply {
                    this.apiUrl = safeApiUrl
                    this.publicKey = safePublicKey
                    this.deviceHash = deviceHash
                    setActiveSessionId(currentSessionId!!)
                    this.userId = safeUserId
                    this.sessionStartTime = this@RejourneyModuleImpl.sessionStartTime
                    resetForNewSession()
                }

                currentSessionId?.let { sid ->
                    uploadManager?.markSessionActive(sid, sessionStartTime)
                    
                    reactContext.getSharedPreferences("rejourney", 0)
                        .edit()
                        .putString("rj_current_session_id", sid)
                        .putLong("rj_session_start_time", sessionStartTime)
                        .apply()
                }
                
                val pendingDir = java.io.File(reactContext.cacheDir, "rj_pending")
                currentSessionId?.let { sid ->
                    eventBuffer = EventBuffer(reactContext, sid, pendingDir)
                }
                
                savedApiUrl = safeApiUrl
                savedPublicKey = safePublicKey
                savedDeviceHash = deviceHash

                if (remoteRecordingEnabled) {
                    captureEngine?.startSession(currentSessionId!!)
                }

                touchInterceptor?.enableGlobalTracking()
                
                keyboardTracker?.startTracking()
                textInputTracker?.startTracking()

                isRecording = true
                
                try {
                    val serviceIntent = Intent(reactContext, SessionLifecycleService::class.java)
                    reactContext.startService(serviceIntent)
                    Logger.debug("SessionLifecycleService started")
                } catch (e: Exception) {
                    Logger.warning("Failed to start SessionLifecycleService: ${e.message}")
                }

                startBatchUploadTimer()
                startDurationLimitTimer()
                
                val nowMs = System.currentTimeMillis()
                val startupDurationMs = nowMs - processStartTimeMs
                if (startupDurationMs > 0 && startupDurationMs < 60000) {
                    val startupEvent = mapOf(
                        "type" to "app_startup",
                        "timestamp" to nowMs,
                        "durationMs" to startupDurationMs,
                        "platform" to "android"
                    )
                    addEventWithPersistence(startupEvent)
                    Logger.debug("Recorded app startup time: ${startupDurationMs}ms")
                }

                fetchProjectConfig(safePublicKey, safeApiUrl)

                registerDevice(safePublicKey, safeApiUrl)

                Logger.logSessionStart(currentSessionId ?: "")

                promise.resolve(createResultMap(true, currentSessionId ?: ""))
            } catch (e: Exception) {
                Logger.error("Failed to start session", e)
                isRecording = false
                promise.resolve(createResultMap(false, "", e.message))
            }
        }
    }

    fun stopSession(promise: Promise) {
        if (isShuttingDown) {
            promise.resolve(createStopResultMap(false, "", false, null, "Module is shutting down"))
            return
        }

        scope.launch {
            try {
                if (!isRecording) {
                    promise.resolve(createStopResultMap(false, "", false, "Not recording", null))
                    return@launch
                }

                val sessionId = currentSessionId ?: ""

                stopBatchUploadTimer()
                stopDurationLimitTimer()

                if (remoteRecordingEnabled) {
                    captureEngine?.forceCaptureWithReason("session_end")
                }

                captureEngine?.stopSession()

                touchInterceptor?.disableGlobalTracking()

                var crashCount = 0
                var anrCount = 0
                var errorCount = 0
                for (event in sessionEvents) {
                    when (event["type"]) {
                        "crash" -> crashCount++
                        "anr" -> anrCount++
                        "error" -> errorCount++
                    }
                }
                val durationSeconds = ((System.currentTimeMillis() - sessionStartTime) / 1000).toInt()
                
                val metrics = mapOf(
                    "crashCount" to crashCount,
                    "anrCount" to anrCount,
                    "errorCount" to errorCount,
                    "durationSeconds" to durationSeconds
                )

                val promotionResult = uploadManager?.evaluateReplayPromotion(metrics)
                val isPromoted = promotionResult?.first ?: false
                val reason = promotionResult?.second ?: "unknown"

                if (isPromoted) {
                    Logger.debug("Session promoted (reason: $reason)")
                } else {
                    Logger.debug("Session not promoted (reason: $reason)")
                }

                val uploadSuccess = uploadManager?.uploadBatch(sessionEvents.toList(), isFinal = true) ?: false

                var endSessionSuccess = sessionEndSent
                if (!sessionEndSent) {
                    sessionEndSent = true
                    endSessionSuccess = uploadManager?.endSession() ?: false
                    if (!endSessionSuccess) {
                        Logger.warning("Session end signal may have failed")
                    }
                }

                if (endSessionSuccess) {
                    currentSessionId?.let { sid ->
                        uploadManager?.clearSessionRecovery(sid)
                        
                        reactContext.getSharedPreferences("rejourney", 0)
                            .edit()
                            .putLong("rj_session_end_time_$sid", System.currentTimeMillis())
                            .remove("rj_current_session_id")
                            .remove("rj_session_start_time")
                            .apply()
                    }
                }

                isRecording = false
                currentSessionId = null
                this@RejourneyModuleImpl.userId = null
                sessionEvents.clear()
                
                try {
                    val serviceIntent = Intent(reactContext, SessionLifecycleService::class.java)
                    reactContext.stopService(serviceIntent)
                    Logger.debug("SessionLifecycleService stopped")
                } catch (e: Exception) {
                    Logger.warning("Failed to stop SessionLifecycleService: ${e.message}")
                }

                Logger.logSessionEnd(sessionId)

                promise.resolve(createStopResultMap(true, sessionId, uploadSuccess && endSessionSuccess, null, null))
            } catch (e: Exception) {
                Logger.error("Failed to stop session", e)
                isRecording = false
                promise.resolve(createStopResultMap(false, currentSessionId ?: "", false, null, e.message))
            }
        }
    }

    fun logEvent(eventType: String, details: ReadableMap, promise: Promise) {
        if (!isRecording || isShuttingDown) {
            promise.resolve(createSuccessMap(false))
            return
        }

        try {
            val event = mapOf(
                "type" to eventType,
                "timestamp" to System.currentTimeMillis(),
                "details" to details.toHashMap()
            )
            addEventWithPersistence(event)
            promise.resolve(createSuccessMap(true))
        } catch (e: Exception) {
            Logger.error("Failed to log event", e)
            promise.resolve(createSuccessMap(false))
        }
    }

    fun screenChanged(screenName: String, promise: Promise) {
        if (!isRecording || isShuttingDown) {
            promise.resolve(createSuccessMap(false))
            return
        }

        try {
            Logger.debug("Screen changed to: $screenName")
            
            val event = mapOf(
                "type" to EventType.NAVIGATION,
                "timestamp" to System.currentTimeMillis(),
                "screenName" to screenName
            )
            addEventWithPersistence(event)

            scope.launch {
                delay(100)
                captureEngine?.notifyNavigationToScreen(screenName)
                captureEngine?.notifyReactNativeCommit()
            }

            promise.resolve(createSuccessMap(true))
        } catch (e: Exception) {
            Logger.error("Failed to handle screen change", e)
            promise.resolve(createSuccessMap(false))
        }
    }

    fun onScroll(offsetY: Double, promise: Promise) {
        if (!isRecording || isShuttingDown) {
            promise.resolve(createSuccessMap(false))
            return
        }

        try {
            captureEngine?.notifyScrollOffset(offsetY.toFloat())
            promise.resolve(createSuccessMap(true))
        } catch (e: Exception) {
            promise.resolve(createSuccessMap(false))
        }
    }

    fun markVisualChange(reason: String, importance: String, promise: Promise) {
        if (!isRecording || isShuttingDown) {
            promise.resolve(false)
            return
        }

        try {
            val importanceLevel = when (importance.lowercase()) {
                "low" -> com.rejourney.core.CaptureImportance.LOW
                "medium" -> com.rejourney.core.CaptureImportance.MEDIUM
                "high" -> com.rejourney.core.CaptureImportance.HIGH
                "critical" -> com.rejourney.core.CaptureImportance.CRITICAL
                else -> com.rejourney.core.CaptureImportance.MEDIUM
            }
            captureEngine?.notifyVisualChange(reason, importanceLevel)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    fun onExternalURLOpened(urlScheme: String, promise: Promise) {
        if (!isRecording || isShuttingDown) {
            promise.resolve(createSuccessMap(false))
            return
        }

        try {
            val event = mapOf(
                "type" to EventType.EXTERNAL_URL_OPENED,
                "timestamp" to System.currentTimeMillis(),
                "urlScheme" to urlScheme
            )
            addEventWithPersistence(event)
            promise.resolve(createSuccessMap(true))
        } catch (e: Exception) {
            promise.resolve(createSuccessMap(false))
        }
    }

    fun onOAuthStarted(provider: String, promise: Promise) {
        if (!isRecording || isShuttingDown) {
            promise.resolve(createSuccessMap(false))
            return
        }

        try {
            val event = mapOf(
                "type" to EventType.OAUTH_STARTED,
                "timestamp" to System.currentTimeMillis(),
                "provider" to provider
            )
            addEventWithPersistence(event)
            promise.resolve(createSuccessMap(true))
        } catch (e: Exception) {
            promise.resolve(createSuccessMap(false))
        }
    }

    fun onOAuthCompleted(provider: String, success: Boolean, promise: Promise) {
        if (!isRecording || isShuttingDown) {
            promise.resolve(createSuccessMap(false))
            return
        }

        try {
            val event = mapOf(
                "type" to EventType.OAUTH_COMPLETED,
                "timestamp" to System.currentTimeMillis(),
                "provider" to provider,
                "success" to success
            )
            addEventWithPersistence(event)
            promise.resolve(createSuccessMap(true))
        } catch (e: Exception) {
            promise.resolve(createSuccessMap(false))
        }
    }

    fun getSDKMetrics(promise: Promise) {
        try {
            val metrics = Telemetry.getInstance().currentMetrics()
            val map = Arguments.createMap().apply {
                putInt("uploadSuccessCount", metrics.uploadSuccessCount)
                putInt("uploadFailureCount", metrics.uploadFailureCount)
                putInt("retryAttemptCount", metrics.retryAttemptCount)
                putInt("circuitBreakerOpenCount", metrics.circuitBreakerOpenCount)
                putInt("memoryEvictionCount", metrics.memoryEvictionCount)
                putInt("offlinePersistCount", metrics.offlinePersistCount)
                putInt("sessionStartCount", metrics.sessionStartCount)
                putInt("crashCount", metrics.crashCount)
                putInt("anrCount", metrics.anrCount)
                putDouble("uploadSuccessRate", metrics.uploadSuccessRate.toDouble())
                putDouble("avgUploadDurationMs", metrics.avgUploadDurationMs.toDouble())
                putInt("currentQueueDepth", metrics.currentQueueDepth)
                metrics.lastUploadTime?.let { value -> putDouble("lastUploadTime", value.toDouble()) }
                metrics.lastRetryTime?.let { value -> putDouble("lastRetryTime", value.toDouble()) }
                putDouble("totalBytesUploaded", metrics.totalBytesUploaded.toDouble())
                putDouble("totalBytesEvicted", metrics.totalBytesEvicted.toDouble())
            }
            promise.resolve(map)
        } catch (e: Exception) {
            Logger.error("Failed to get SDK metrics", e)
            promise.resolve(Arguments.createMap())
        }
    }

    fun setDebugMode(enabled: Boolean, promise: Promise) {
        try {
            Logger.setDebugMode(enabled)
            promise.resolve(createSuccessMap(true))
        } catch (e: Exception) {
            promise.resolve(createSuccessMap(false))
        }
    }

    fun debugCrash() {
        Logger.debug("Triggering debug crash...")
        scope.launch(Dispatchers.Main) {
            throw RuntimeException("This is a test crash triggered from React Native")
        }
    }

    fun debugTriggerANR(durationMs: Double) {
        Logger.debug("Triggering debug ANR for ${durationMs.toLong()}ms...")
        Handler(Looper.getMainLooper()).post {
            try {
                Thread.sleep(durationMs.toLong())
            } catch (e: InterruptedException) {
                e.printStackTrace()
            }
        }
    }

    fun getSessionId(promise: Promise) {
        promise.resolve(currentSessionId)
    }

    fun maskViewByNativeID(nativeID: String, promise: Promise) {
        if (nativeID.isEmpty()) {
            promise.resolve(createSuccessMap(false))
            return
        }

        try {
            com.rejourney.privacy.PrivacyMask.addMaskedNativeID(nativeID)
            Logger.debug("Masked nativeID: $nativeID")
            promise.resolve(createSuccessMap(true))
        } catch (e: Exception) {
            Logger.warning("maskViewByNativeID failed: ${e.message}")
            promise.resolve(createSuccessMap(false))
        }
    }

    fun unmaskViewByNativeID(nativeID: String, promise: Promise) {
        if (nativeID.isEmpty()) {
            promise.resolve(createSuccessMap(false))
            return
        }

        try {
            com.rejourney.privacy.PrivacyMask.removeMaskedNativeID(nativeID)
            Logger.debug("Unmasked nativeID: $nativeID")
            promise.resolve(createSuccessMap(true))
        } catch (e: Exception) {
            Logger.warning("unmaskViewByNativeID failed: ${e.message}")
            promise.resolve(createSuccessMap(false))
        }
    }

    /**
     * Recursively find a view with a given nativeID.
     * In React Native, nativeID is typically stored in the view's tag or as a resource ID.
     */
    private fun findViewByNativeID(view: android.view.View, nativeID: String): android.view.View? {
        val viewTag = view.getTag(com.facebook.react.R.id.view_tag_native_id)
        if (viewTag is String && viewTag == nativeID) {
            return view
        }

        if (view is android.view.ViewGroup) {
            for (i in 0 until view.childCount) {
                val child = view.getChildAt(i)
                val found = findViewByNativeID(child, nativeID)
                if (found != null) return found
            }
        }

        return null
    }


    fun setUserIdentity(userId: String, promise: Promise) {
        try {
            val safeUserId = userId.ifEmpty { "anonymous" }
            
            reactContext.getSharedPreferences("rejourney", 0)
                .edit()
                .putString("rj_user_identity", safeUserId)
                .apply()
            
            this.userId = safeUserId
            
            uploadManager?.userId = safeUserId
            
            Logger.debug("User identity updated: $safeUserId")
            
            if (isRecording) {
                val event = mapOf(
                    "type" to "user_identity_changed",
                    "timestamp" to System.currentTimeMillis(),
                    "userId" to safeUserId
                )
                addEventWithPersistence(event)
            }
            
            promise.resolve(createSuccessMap(true))
        } catch (e: Exception) {
            Logger.warning("setUserIdentity failed: ${e.message}")
            promise.resolve(createSuccessMap(false))
        }
    }

    fun getUserIdentity(promise: Promise) {
        promise.resolve(userId)
    }


    private fun createResultMap(success: Boolean, sessionId: String, error: String? = null): WritableMap {
        return Arguments.createMap().apply {
            putBoolean("success", success)
            putString("sessionId", sessionId)
            error?.let { putString("error", it) }
        }
    }

    private fun createStopResultMap(
        success: Boolean, 
        sessionId: String, 
        uploadSuccess: Boolean,
        warning: String?,
        error: String?
    ): WritableMap {
        return Arguments.createMap().apply {
            putBoolean("success", success)
            putString("sessionId", sessionId)
            putBoolean("uploadSuccess", uploadSuccess)
            warning?.let { putString("warning", it) }
            error?.let { putString("error", it) }
        }
    }

    private fun createSuccessMap(success: Boolean): WritableMap {
        return Arguments.createMap().apply {
            putBoolean("success", success)
        }
    }

    private fun generateSHA256Hash(input: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(input.toByteArray())
        return hash.joinToString("") { "%02x".format(it) }
    }

    private fun resetSamplingDecision() {
        sessionSampled = true
        hasSampleDecision = false
    }

    private fun shouldSampleSession(sampleRate: Int): Boolean {
        val clampedRate = sampleRate.coerceIn(0, 100)
        if (clampedRate >= 100) return true
        if (clampedRate <= 0) return false
        return Random().nextInt(100) < clampedRate
    }

    private fun updateRecordingEligibility(sampleRate: Int = projectSampleRate): Boolean {
        val clampedRate = sampleRate.coerceIn(0, 100)
        projectSampleRate = clampedRate

        val decidedSample = if (!hasSampleDecision) {
            sessionSampled = shouldSampleSession(clampedRate)
            hasSampleDecision = true
            true
        } else {
            false
        }

        val shouldRecordVideo = recordingEnabledByConfig && sessionSampled
        remoteRecordingEnabled = shouldRecordVideo

        if (!shouldRecordVideo && captureEngine?.isRecording == true) {
            captureEngine?.stopSession()
        }

        if (decidedSample && recordingEnabledByConfig && !sessionSampled) {
            Logger.info("Session sampled out for video (${clampedRate}%) - entering Data-Only Mode (Events enabled, Video disabled)")
        }

        return shouldRecordVideo
    }

    private fun startBatchUploadTimer() {
        stopBatchUploadTimer()
        batchUploadJob = scope.launch {
            delay((Constants.INITIAL_UPLOAD_DELAY * 1000).toLong())
            while (isActive && isRecording) {
                performBatchUpload()
                delay((Constants.BATCH_UPLOAD_INTERVAL * 1000).toLong())
            }
        }
    }

    /**
     * Best-effort: trigger an upload/persist attempt soon after a keyframe is captured.
     * This materially improves crash sessions (more frames make it to disk quickly).
     */
    private fun scheduleImmediateUploadKick() {
        if (!isRecording || isShuttingDown) return

        val now = System.currentTimeMillis()
        if (now - lastImmediateUploadKickMs < 1_000L) return
        lastImmediateUploadKickMs = now

        scope.launch {
            try {
                performBatchUpload()
            } catch (_: Exception) {
            }
        }
    }

    private fun stopBatchUploadTimer() {
        batchUploadJob?.cancel()
        batchUploadJob = null
    }

    private fun startDurationLimitTimer() {
        stopDurationLimitTimer()
        val maxMs = maxRecordingMinutes * 60 * 1000L
        val elapsed = System.currentTimeMillis() - sessionStartTime
        val remaining = maxMs - elapsed
        
        if (remaining > 0) {
            durationLimitJob = scope.launch {
                delay(remaining)
                if (isRecording) {
                    Logger.warning("Recording duration limit reached, stopping session")
                    stopSessionInternal()
                }
            }
        }
    }

    private fun stopDurationLimitTimer() {
        durationLimitJob?.cancel()
        durationLimitJob = null
    }

    private suspend fun performBatchUpload() {
        if (!isRecording || isShuttingDown) return

        try {
            val eventsToUpload = sessionEvents.toList()

            if (eventsToUpload.isEmpty()) return

            val ok = uploadManager?.uploadBatch(eventsToUpload) ?: false

            if (ok) {
                sessionEvents.clear()
            }
        } catch (e: CancellationException) {
            Logger.debug("Batch upload cancelled (coroutine cancelled)")
            throw e
        } catch (e: Exception) {
            Logger.error("Batch upload failed", e)
        }
    }

    private suspend fun stopSessionInternal() {
        if (!isRecording) return

        try {
            stopBatchUploadTimer()
            stopDurationLimitTimer()
            captureEngine?.stopSession()
            isRecording = false
            currentSessionId = null
            userId = null
            sessionEvents.clear()
        } catch (e: Exception) {
            Logger.error("Failed to stop session internally", e)
        }
    }

    /**
     * End the current session with a specific reason.
     */
    private fun endSession(reason: EndReason, promise: Promise?) {
        scope.launch {
            try {
                if (!isRecording) {
                    promise?.resolve(createStopResultMap(false, "", false, "Not recording", null))
                    return@launch
                }

                val sessionId = currentSessionId ?: ""
                Logger.debug("Ending session due to: $reason")

                stopBatchUploadTimer()
                stopDurationLimitTimer()

                if (remoteRecordingEnabled) {
                    captureEngine?.forceCaptureWithReason("session_end_${reason.name.lowercase()}")
                }

                captureEngine?.stopSession()

                touchInterceptor?.disableGlobalTracking()
                keyboardTracker?.stopTracking()
                textInputTracker?.stopTracking()

                var crashCount = 0
                var anrCount = 0
                var errorCount = 0
                for (event in sessionEvents) {
                    when (event["type"]) {
                        "crash" -> crashCount++
                        "anr" -> anrCount++
                        "error" -> errorCount++
                    }
                }
                val durationSeconds = ((System.currentTimeMillis() - sessionStartTime) / 1000).toInt()
                
                val metrics = mapOf(
                    "crashCount" to crashCount,
                    "anrCount" to anrCount,
                    "errorCount" to errorCount,
                    "durationSeconds" to durationSeconds
                )

                val promotionResult = uploadManager?.evaluateReplayPromotion(metrics)
                val isPromoted = promotionResult?.first ?: false
                val promotionReason = promotionResult?.second ?: "unknown"

                if (isPromoted) {
                    Logger.debug("Session promoted (reason: $promotionReason)")
                }

                val uploadSuccess = uploadManager?.uploadBatch(sessionEvents.toList(), isFinal = true) ?: false

                var endSessionSuccess = sessionEndSent
                if (!sessionEndSent) {
                    sessionEndSent = true
                    endSessionSuccess = uploadManager?.endSession() ?: false
                }

                if (endSessionSuccess) {
                    currentSessionId?.let { sid ->
                        uploadManager?.clearSessionRecovery(sid)
                        
                        reactContext.getSharedPreferences("rejourney", 0)
                            .edit()
                            .putLong("rj_session_end_time_$sid", System.currentTimeMillis())
                            .remove("rj_current_session_id")
                            .remove("rj_session_start_time")
                            .apply()
                    }
                }

                isRecording = false
                currentSessionId = null
                userId = null
                sessionEvents.clear()
                
                try {
                    val serviceIntent = Intent(reactContext, SessionLifecycleService::class.java)
                    reactContext.stopService(serviceIntent)
                    Logger.debug("SessionLifecycleService stopped")
                } catch (e: Exception) {
                    Logger.warning("Failed to stop SessionLifecycleService: ${e.message}")
                }

                Logger.logSessionEnd(sessionId)
                promise?.resolve(createStopResultMap(true, sessionId, uploadSuccess && endSessionSuccess, null, null))
            } catch (e: Exception) {
                Logger.error("Failed to end session", e)
                isRecording = false
                promise?.resolve(createStopResultMap(false, currentSessionId ?: "", false, null, e.message))
            }
        }
    }

    /**


    /**
     * Internal method to start recording with options.
     */
    private suspend fun startRecordingInternal(
        options: Map<String, Any?>?,
        sessionId: String,
        source: String
    ) {
        if (isRecording) {
            Logger.debug("Already recording, ignoring start request from $source")
            return
        }

        val safeUserId = userId ?: "anonymous"
        val safeApiUrl = savedApiUrl.ifEmpty { "https://api.rejourney.co" }
        val safePublicKey = savedPublicKey.ifEmpty { "" }
        val deviceHash = savedDeviceHash

        this.userId = safeUserId
        currentSessionId = sessionId
        sessionStartTime = System.currentTimeMillis()
        totalBackgroundTimeMs = 0
        sessionEndSent = false
        sessionEvents.clear()
        resetSamplingDecision()
        remoteRecordingEnabled = recordingEnabledByConfig
        if (hasProjectConfig) {
            updateRecordingEligibility(projectSampleRate)
        }

        reactContext.getSharedPreferences("rejourney", 0)
            .edit()
            .putString("rj_current_session_id", currentSessionId)
            .apply()

        uploadManager?.apply {
            this.apiUrl = safeApiUrl
            this.publicKey = safePublicKey
            this.deviceHash = deviceHash
            setActiveSessionId(currentSessionId!!)
            this.userId = safeUserId
            this.sessionStartTime = this@RejourneyModuleImpl.sessionStartTime
            resetForNewSession()
        }

        currentSessionId?.let { sid ->
            uploadManager?.markSessionActive(sid, sessionStartTime)
        }

        val pendingDir = File(reactContext.cacheDir, "rj_pending")
        currentSessionId?.let { sid ->
            eventBuffer = EventBuffer(reactContext, sid, pendingDir)
        }

        if (remoteRecordingEnabled) {
            captureEngine?.startSession(currentSessionId!!)
        }

        touchInterceptor?.enableGlobalTracking()
        keyboardTracker?.startTracking()
        textInputTracker?.startTracking()

        isRecording = true
        startBatchUploadTimer()
        startDurationLimitTimer()

        Logger.logSessionStart(currentSessionId ?: "")
    }

    private fun fetchProjectConfig(publicKey: String, apiUrl: String) {
        scope.launch(Dispatchers.IO) {
            try {
                uploadManager?.fetchProjectConfig { success, config ->
                    if (success && config != null) {
                        hasProjectConfig = true

                        config["maxRecordingMinutes"]?.let { maxMinutes ->
                            scope.launch(Dispatchers.Main) {
                                maxRecordingMinutes = (maxMinutes as? Number)?.toInt() ?: 10
                                startDurationLimitTimer()
                            }
                        }

                        val sampleRate = (config["sampleRate"] as? Number)?.toInt()
                        if (sampleRate != null) {
                            projectSampleRate = sampleRate.coerceIn(0, 100)
                        }

                        val recordingEnabled = (config["recordingEnabled"] as? Boolean) != false
                        scope.launch(Dispatchers.Main) {
                            recordingEnabledByConfig = recordingEnabled
                            if (!recordingEnabled) {
                                Logger.warning("Recording disabled by remote config, stopping capture only")
                            }
                            updateRecordingEligibility(projectSampleRate)
                        }
                         
                        config["rejourneyEnabled"]?.let { enabled ->
                            if (enabled == false) {
                                scope.launch(Dispatchers.Main) {
                                    Logger.warning("Rejourney disabled by remote config, stopping session")
                                    remoteRejourneyEnabled = false
                                    stopSessionInternal()
                                }
                            } else {
                                remoteRejourneyEnabled = true
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Logger.error("Failed to fetch project config", e)
            }
        }
    }

    private fun registerDevice(publicKey: String, apiUrl: String) {
        scope.launch(Dispatchers.IO) {
            try {
                val bundleId = reactContext.packageName
                deviceAuthManager?.registerDevice(
                    projectKey = publicKey,
                    bundleId = bundleId,
                    platform = "android",
                    sdkVersion = Constants.SDK_VERSION,
                    apiUrl = apiUrl
                ) { success, credentialId, error ->
                    if (success) {
                        Logger.debug("Device registered: $credentialId")
                        
                        resetAuthRetryState()
                        
                        deviceAuthManager?.getUploadToken { tokenSuccess, token, expiresIn, tokenError ->
                            if (tokenSuccess) {

                                val crashHandler = CrashHandler.getInstance(reactContext)
                                if (crashHandler.hasPendingCrashReport()) {
                                    crashHandler.loadAndPurgePendingCrashReport()?.let { crashReport ->
                                        scope.launch(Dispatchers.IO) {
                                            uploadManager?.uploadCrashReport(crashReport)
                                        }
                                    }
                                }
                                
                                val anrHandler = ANRHandler.getInstance(reactContext)
                                if (anrHandler.hasPendingANRReport()) {
                                    anrHandler.loadAndPurgePendingANRReport()?.let { anrReport ->
                                        scope.launch(Dispatchers.IO) {
                                            uploadManager?.uploadANRReport(anrReport)
                                        }
                                    }
                                }
                            } else {
                                Logger.warning("Failed to get upload token: $tokenError")
                            }
                        }
                    } else {
                        Logger.warning("Device registration failed: $error")
                    }
                }
            } catch (e: Exception) {
                Logger.error("Device registration error", e)
            }
        }
    }


    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}

    override fun onActivityResumed(activity: Activity) {
        try {
            Logger.debug("Activity resumed")
            cancelScheduledBackground()
            if (wasInBackground) {
                handleAppForeground("Activity.onResume")
            }
        } catch (e: Exception) {
            Logger.error("SDK error in onActivityResumed (non-fatal)", e)
        }
    }
    
    override fun onActivityPaused(activity: Activity) {
        try {
            Logger.debug("Activity paused (isFinishing=${activity.isFinishing})")
            
            if (remoteRecordingEnabled) {
                try {
                    captureEngine?.forceCaptureWithReason("app_pausing")
                } catch (e: Exception) {
                    Logger.warning("Pre-background capture failed: ${e.message}")
                }
            }
            
            if (!wasInBackground && isRecording) {
                Logger.debug("[BG] Activity.onPause: Setting background entry time (capture engine still running)")
                backgroundEntryTime = System.currentTimeMillis()
                
                eventBuffer?.flush()
                Logger.debug("[BG] Activity.onPause: Events flushed to disk, backgroundEntryTime=$backgroundEntryTime")
            }
        } catch (e: Exception) {
            Logger.error("SDK error in onActivityPaused (non-fatal)", e)
        }
    }

    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}

    
    override fun onStart(owner: LifecycleOwner) {
        try {
            Logger.debug("ProcessLifecycleOwner: onStart")
            cancelScheduledBackground()
            if (wasInBackground) {
                handleAppForeground("ProcessLifecycle.onStart")
            }
        } catch (e: Exception) {
            Logger.error("SDK error in ProcessLifecycleOwner.onStart", e)
        }
    }

    override fun onStop(owner: LifecycleOwner) {
        try {
            Logger.debug("ProcessLifecycleOwner: onStop")
            if (isRecording && !wasInBackground) {
                handleAppBackground("ProcessLifecycle.onStop")
            }
        } catch (e: Exception) {
            Logger.error("SDK error in ProcessLifecycleOwner.onStop", e)
        }
    }


    override fun onActivityStarted(activity: Activity) {
        try {
            Logger.debug("Activity started")
            cancelScheduledBackground()
            if (wasInBackground) {
                handleAppForeground("Activity.onStart")
            }
        } catch (e: Exception) {
            Logger.error("SDK error in onActivityStarted (non-fatal)", e)
        }
    }

    override fun onActivityStopped(activity: Activity) {
        try {
            if (activity.isChangingConfigurations) {
                Logger.debug("Activity stopped but changing configurations - skipping background")
                return
            }

            if (activity.isFinishing) {
                Logger.debug("Activity stopped and finishing - triggering IMMEDIATE background and ENDING SESSION")
                cancelScheduledBackground()
                handleAppBackground("Activity.onStop:finishing", shouldEndSession = true)
            } else {
                Logger.debug("Activity stopped - triggering IMMEDIATE background")
                cancelScheduledBackground()
                handleAppBackground("Activity.onStop", shouldEndSession = false)
            }

        } catch (e: Exception) {
            Logger.error("SDK error in onActivityStopped (non-fatal)", e)
        }
    }
    
    override fun onActivityDestroyed(activity: Activity) {
        try {
            if (activity.isChangingConfigurations) return

            Logger.debug("Activity destroyed (isFinishing=${activity.isFinishing}) - triggering IMMEDIATE background")
            handleAppBackground("Activity.onDestroy", shouldEndSession = true)
            
        } catch (e: Exception) {
            Logger.error("SDK error in onActivityDestroyed (non-fatal)", e)
        }
    }

    private fun scheduleBackground(source: String) {
        if (wasInBackground || backgroundScheduled) return

        backgroundScheduled = true
        backgroundEntryTime = System.currentTimeMillis()

        Logger.debug("Scheduling background in 50ms (source=$source)")

        val runnable = Runnable {
            backgroundScheduled = false
            handleAppBackground("$source:debounced")
        }

        scheduledBackgroundRunnable = runnable
        mainHandler.postDelayed(runnable, 50L)
    }

    private fun cancelScheduledBackground() {
        if (!backgroundScheduled) return
        scheduledBackgroundRunnable?.let { mainHandler.removeCallbacks(it) }
        scheduledBackgroundRunnable = null
        backgroundScheduled = false
        if (!wasInBackground) {
            backgroundEntryTime = 0L
        }
    }

    /**
     * Foreground handler - handles return from background with session timeout logic.
     *
     * Session Behavior (matching iOS):
     * - Background < 60s: Resume same session, accumulate background time for billing exclusion
     * - Background >= 60s: End old session, start new session
     * - App killed in background: Auto-finalized by backend worker after 60s
     */
    private fun handleAppForeground(source: String) {
        if (!wasInBackground || backgroundEntryTime == 0L) {
            Logger.debug("[FG] Not returning from background, skipping")
            return
        }
        
        val bgDurationMs = System.currentTimeMillis() - backgroundEntryTime
        val bgDurationSec = bgDurationMs / 1000.0
        val sessionTimeoutMs = (Constants.BACKGROUND_SESSION_TIMEOUT * 1000).toLong()
        val thresholdSec = Constants.BACKGROUND_SESSION_TIMEOUT
        
        Logger.debug("[FG] === APP FOREGROUND ($source) ===")
        Logger.debug("[FG] Was in background for ${String.format("%.1f", bgDurationSec)}s")
        Logger.debug("[FG] Session timeout threshold: ${thresholdSec}s")
        Logger.debug("[FG] Current totalBackgroundTimeMs: $totalBackgroundTimeMs")
        
        wasInBackground = false
        backgroundEntryTime = 0
        
        if (bgDurationMs >= sessionTimeoutMs) {
            Logger.debug("[FG] TIMEOUT: ${bgDurationSec}s >= ${thresholdSec}s → Creating NEW session")
            handleSessionTimeoutOnForeground(bgDurationMs, source)
        } else {
            Logger.debug("[FG] SHORT BACKGROUND: ${bgDurationSec}s < ${thresholdSec}s → Resuming SAME session")
            handleShortBackgroundResume(bgDurationMs, source)
        }
    }
    
    /**
     * Handle session timeout after extended background (>= 60s).
     * Ends the old session and starts a fresh one.
     * 
     * CRITICAL: Uses backgroundScope + NonCancellable to ensure recovery completes
     * even if the app goes to background again during this process.
     */
    private fun handleSessionTimeoutOnForeground(bgDurationMs: Long, source: String) {
        val oldSessionId = currentSessionId ?: return
        val wasRecording = isRecording
        
        if (!wasRecording) {
            Logger.debug("Session timeout but wasn't recording - ignoring")
            return
        }
        
        Logger.debug("SESSION TIMEOUT: Ending session $oldSessionId after ${bgDurationMs/1000}s in background")
        
        totalBackgroundTimeMs += bgDurationMs
        uploadManager?.totalBackgroundTimeMs = totalBackgroundTimeMs
        
        try {
            stopBatchUploadTimer()
            stopDurationLimitTimer()
            captureEngine?.stopSession()
            touchInterceptor?.disableGlobalTracking()
            keyboardTracker?.stopTracking()
            textInputTracker?.stopTracking()
        } catch (e: Exception) {
            Logger.warning("Error stopping capture during session timeout: ${e.message}")
        }
        
        isRecording = false
        
        backgroundScope.launch {
            withContext(NonCancellable) {
                try {
                    try {
                        DeviceAuthManager.getInstance(reactContext).ensureValidToken()
                    } catch (e: Exception) {
                        Logger.warning("Failed to refresh auth token during session timeout: ${e.message}")
                    }
                    
                    val timeoutEvent = mapOf(
                        "type" to EventType.SESSION_TIMEOUT,
                        "timestamp" to System.currentTimeMillis(),
                        "backgroundDuration" to bgDurationMs,
                        "timeoutThreshold" to (Constants.BACKGROUND_SESSION_TIMEOUT * 1000).toLong(),
                        "reason" to "background_timeout"
                    )
                    sessionEvents.add(timeoutEvent)
                    
                    val finalEvents = sessionEvents.toList()
                    sessionEvents.clear()
                    
                    if (finalEvents.isNotEmpty()) {
                        try {
                            uploadManager?.uploadBatch(finalEvents, isFinal = true)
                        } catch (e: Exception) {
                            Logger.warning("Failed to upload final events during session timeout: ${e.message}")
                        }
                    }
                    
                    var endSessionSuccess = false
                    if (!sessionEndSent) {
                        sessionEndSent = true
                        try {
                            endSessionSuccess = uploadManager?.endSession(sessionIdOverride = oldSessionId) ?: false
                        } catch (e: Exception) {
                            Logger.warning("Failed to end old session: ${e.message}")
                        }
                    }
                    
                    try {
                        uploadManager?.clearSessionRecovery(oldSessionId)
                    } catch (e: Exception) {
                        Logger.warning("Failed to clear session recovery: ${e.message}")
                    }
                    
                    if (endSessionSuccess) {
                        Logger.debug("Old session $oldSessionId ended successfully")
                    } else {
                        Logger.warning("Old session $oldSessionId end signal failed - will be recovered on next launch")
                    }
                    
                    val timestamp = System.currentTimeMillis()
                    val shortUuid = UUID.randomUUID().toString().take(8).uppercase()
                    val newSessionId = "session_${timestamp}_$shortUuid"
                    
                    currentSessionId = newSessionId
                    sessionStartTime = timestamp
                    totalBackgroundTimeMs = 0
                    sessionEndSent = false
                    
                    uploadManager?.let { um ->
                        um.setActiveSessionId(newSessionId)
                        
                        um.sessionStartTime = timestamp
                        um.totalBackgroundTimeMs = 0
                        
                        um.userId = userId ?: "anonymous"
                        
                        if (savedDeviceHash.isNotEmpty()) um.deviceHash = savedDeviceHash
                        if (savedPublicKey.isNotEmpty()) um.publicKey = savedPublicKey
                        if (savedApiUrl.isNotEmpty()) um.apiUrl = savedApiUrl

                        um.markSessionActive(newSessionId, timestamp)
                    }
                    
                    reactContext.getSharedPreferences("rejourney", 0)
                        .edit()
                        .putString("rj_current_session_id", newSessionId)
                        .putLong("rj_session_start_time", timestamp)
                        .commit()
                    
                    val pendingDir = java.io.File(reactContext.cacheDir, "rj_pending")
                    eventBuffer = EventBuffer(reactContext, newSessionId, pendingDir)
                    
                    withContext(Dispatchers.Main) {
                        try {
                            resetSamplingDecision()
                            remoteRecordingEnabled = recordingEnabledByConfig
                            if (hasProjectConfig) {
                                updateRecordingEligibility(projectSampleRate)
                            }

                            if (remoteRecordingEnabled) {
                                captureEngine?.startSession(newSessionId)
                            }
                            
                            touchInterceptor?.enableGlobalTracking()
                            keyboardTracker?.startTracking()
                            textInputTracker?.startTracking()
                            
                            try {
                                val serviceIntent = Intent(reactContext, SessionLifecycleService::class.java)
                                reactContext.startService(serviceIntent)
                                Logger.debug("SessionLifecycleService restarted for new session after timeout")
                            } catch (e: Exception) {
                                Logger.warning("Failed to restart SessionLifecycleService: ${e.message}")
                            }
                        } catch (e: Exception) {
                            Logger.warning("Error starting capture for new session: ${e.message}")
                        }
                    }
                    
                    isRecording = true
                    
                    val sessionStartEvent = mapOf(
                        "type" to EventType.SESSION_START,
                        "timestamp" to System.currentTimeMillis(),
                        "previousSessionId" to oldSessionId,
                        "backgroundDuration" to bgDurationMs,
                        "reason" to "resumed_after_background_timeout",
                        "userId" to (userId ?: "anonymous")
                    )
                    addEventWithPersistence(sessionStartEvent)
                    
                    startBatchUploadTimer()
                    startDurationLimitTimer()
                    
                    delay(100)
                    try {
                        performBatchUpload()
                    } catch (e: Exception) {
                        Logger.warning("Failed to perform immediate batch upload: ${e.message}")
                    }
                    
                    Logger.debug("New session $newSessionId started (previous: $oldSessionId)")
                    
                } catch (e: CancellationException) {
                    Logger.warning("Session timeout recovery interrupted: ${e.message}")
                    isRecording = true
                    startBatchUploadTimer()
                } catch (e: Exception) {
                    Logger.error("Failed to handle session timeout", e)
                    isRecording = true
                    startBatchUploadTimer()
                }
            }
        }
    }
    
    /**
     * Handle short background return (< 60s) - resume same session.
     */
    private fun handleShortBackgroundResume(bgDurationMs: Long, source: String) {
        val previousBgTime = totalBackgroundTimeMs
        totalBackgroundTimeMs += bgDurationMs
        uploadManager?.totalBackgroundTimeMs = totalBackgroundTimeMs
        currentSessionId?.let { sid ->
            uploadManager?.updateSessionRecoveryMeta(sid)
        }
        
        Logger.debug("[FG] Background time: $previousBgTime + $bgDurationMs = $totalBackgroundTimeMs ms")
        Logger.debug("[FG] Resuming session: $currentSessionId")
        
        if (!isRecording || currentSessionId.isNullOrEmpty()) {
            Logger.debug("[FG] Not recording or no session - skipping resume")
            return
        }
        
        addEventWithPersistence(
            mapOf(
                "type" to EventType.APP_FOREGROUND,
                "timestamp" to System.currentTimeMillis(),
                "backgroundDurationMs" to bgDurationMs,
                "totalBackgroundTimeMs" to totalBackgroundTimeMs,
                "source" to source
            )
        )
        
        if (remoteRecordingEnabled) {
            try {
                captureEngine?.startSession(currentSessionId!!)
                captureEngine?.forceCaptureWithReason("app_foreground")
            } catch (e: Exception) {
                Logger.warning("Foreground capture resume failed: ${e.message}")
            }
        }
        
        touchInterceptor?.enableGlobalTracking()
        keyboardTracker?.startTracking()
        textInputTracker?.startTracking()
        
        startBatchUploadTimer()
        startDurationLimitTimer()
    }

    /**
     * Background handler (aligned with iOS + replay player expectations).
     *
     * We treat background as a pause:
     * - log app_background
     * - flush pending data (NOT final)
     * - stop capture/tracking while backgrounded
     *
     * If the process is killed (shouldEndSession=true), crash-safe persistence + next-launch recovery will
     * upload remaining pending data and close the session via session/end.
     */
    private fun handleAppBackground(source: String, shouldEndSession: Boolean = false) {
        if (wasInBackground && !shouldEndSession) {
            Logger.debug("[BG] Already in background, skipping duplicate handling")
            return
        }
        
        Logger.debug("[BG] === APP BACKGROUND ($source) ===")
        Logger.debug("[BG] isRecording=$isRecording, isShuttingDown=$isShuttingDown, sessionId=$currentSessionId, shouldEndSession=$shouldEndSession")
        
        if (isRecording && !isShuttingDown) {
            wasInBackground = true
            if (backgroundEntryTime == 0L) {
                backgroundEntryTime = System.currentTimeMillis()
            }
            Logger.debug("[BG] backgroundEntryTime set to $backgroundEntryTime")
            Logger.debug("[BG] Current totalBackgroundTimeMs=$totalBackgroundTimeMs")
            
            stopBatchUploadTimer()
            stopDurationLimitTimer()
            
            keyboardTracker?.stopTracking()
            textInputTracker?.stopTracking()
            touchInterceptor?.disableGlobalTracking()
            
            val event = mapOf(
                "type" to EventType.APP_BACKGROUND,
                "timestamp" to System.currentTimeMillis()
            )
            addEventWithPersistence(event)
            
            Logger.debug("[BG] ===== ENSURING ALL EVENTS ARE PERSISTED TO DISK =====")
            Logger.debug("[BG] In-memory events count: ${sessionEvents.size}")
            Logger.debug("[BG] Event types in memory: ${sessionEvents.map { it["type"] }.joinToString(", ")}")
            
            eventBuffer?.let { buffer ->
                Logger.debug("[BG] EventBuffer state: eventCount=${buffer.eventCount}, fileExists=${File(reactContext.cacheDir, "rj_pending/$currentSessionId/events.jsonl").exists()}")
            } ?: Logger.warning("[BG] EventBuffer is NULL - cannot flush events!")
            
            val flushStartTime = System.currentTimeMillis()
            val flushSuccess = eventBuffer?.flush() ?: false
            val flushDuration = System.currentTimeMillis() - flushStartTime
            
            if (flushSuccess) {
                Logger.debug("[BG] ✅ Events flushed to disk successfully in ${flushDuration}ms")
                Logger.debug("[BG] In-memory events: ${sessionEvents.size}, EventBuffer eventCount: ${eventBuffer?.eventCount ?: 0}")
                
                val eventsFile = File(reactContext.cacheDir, "rj_pending/$currentSessionId/events.jsonl")
                if (eventsFile.exists()) {
                    val fileSize = eventsFile.length()
                    Logger.debug("[BG] Events file exists: size=$fileSize bytes, path=${eventsFile.absolutePath}")
                } else {
                    Logger.error("[BG] ⚠️ Events file does NOT exist after flush! path=${eventsFile.absolutePath}")
                }
            } else {
                Logger.error("[BG] ❌ FAILED to flush events to disk - some events may be lost!")
                Logger.error("[BG] Flush duration: ${flushDuration}ms")
            }
            Logger.debug("[BG] ===== EVENT PERSISTENCE CHECK COMPLETE =====")
            
            if (remoteRecordingEnabled) {
                Logger.debug("[BG] ===== STOPPING CAPTURE ENGINE =====")
                
                if (shouldEndSession) {
                    Logger.debug("[BG] Force kill detected - using emergency flush")
                    captureEngine?.emergencyFlush()
                }
                
                Logger.debug("[BG] Stopping capture engine for background (sessionId=$currentSessionId)")
                captureEngine?.stopSession()
                Logger.debug("[BG] Capture engine stopSession() called")
            }
            
            currentSessionId?.let { sid ->
                uploadManager?.updateSessionRecoveryMeta(sid)
                Logger.debug("[BG] Session recovery metadata updated for: $sid")
            }
            
            currentSessionId?.let { sid ->
                Logger.debug("[BG] ===== SCHEDULING WORKMANAGER UPLOAD =====")
                Logger.debug("[BG] Session: $sid, Events persisted: ${eventBuffer?.eventCount ?: 0}, isFinal: $shouldEndSession")
                
                sessionEvents.clear()
                
                UploadWorker.scheduleUpload(
                    context = reactContext,
                    sessionId = sid,
                    isFinal = shouldEndSession,
                    expedited = true
                )
                Logger.debug("[BG] ✅ WorkManager upload scheduled for session: $sid")

                scope.launch(Dispatchers.IO) {
                    try {
                        Logger.debug("[BG] 🚀 Attempting immediate best-effort upload for $sid")
                        
                        val authManager = DeviceAuthManager.getInstance(reactContext)
                        val apiUrl = authManager.getCurrentApiUrl() ?: "https://api.rejourney.co"
                        
                        val bgUploader = com.rejourney.network.UploadManager(reactContext, apiUrl).apply {
                            this.sessionId = sid
                            this.setActiveSessionId(sid)
                            this.publicKey = authManager.getCurrentPublicKey() ?: ""
                            this.deviceHash = authManager.getCurrentDeviceHash() ?: ""
                            this.sessionStartTime = uploadManager?.sessionStartTime ?: 0L
                            this.totalBackgroundTimeMs = uploadManager?.totalBackgroundTimeMs ?: 0L
                        }
                        
                        val eventBufferDir = File(reactContext.cacheDir, "rj_pending/$sid")
                        val eventsFile = File(eventBufferDir, "events.jsonl")
                        
                        if (eventsFile.exists()) {
                            val events = mutableListOf<Map<String, Any?>>()
                            eventsFile.bufferedReader().useLines { lines ->
                                lines.forEach { line ->
                                    if (line.isNotBlank()) {
                                        try {
                                            val json = org.json.JSONObject(line)
                                            val map = mutableMapOf<String, Any?>()
                                            json.keys().forEach { key ->
                                                map[key] = json.opt(key)
                                            }
                                            events.add(map)
                                        } catch (e: Exception) { }
                                    }
                                }
                            }
                            
                            if (events.isNotEmpty()) {
                                Logger.debug("[BG] Immediate upload: found ${events.size} events")
                                val success = bgUploader.uploadBatch(events, isFinal = shouldEndSession)
                                if (success) {
                                    Logger.debug("[BG] ✅ Immediate upload SUCCESS! Cleaning up disk...")
                                    eventsFile.delete()
                                    File(eventBufferDir, "buffer_meta.json").delete()
                                    
                                    if (shouldEndSession) {
                                         Logger.debug("[BG] Immediate upload was final, ending session...")
                                         bgUploader.endSession()
                                    }
                                } else {
                                    Logger.warning("[BG] Immediate upload failed - leaving for WorkManager")
                                }
                            } else if (shouldEndSession) {
                                Logger.debug("[BG] No events but shouldEndSession=true, ending session...")
                                bgUploader.endSession()
                            }
                        } else if (shouldEndSession) {
                             Logger.debug("[BG] No event file but shouldEndSession=true, ending session...")
                             bgUploader.endSession()
                        }
                    } catch (e: Exception) {
                        Logger.error("[BG] Immediate upload error: ${e.message} - WorkManager will handle it")
                    }
                }
            }
        } else {
            Logger.debug("[BG] Skipping background handling (isRecording=$isRecording, isShuttingDown=$isShuttingDown)")
        }
    }


    override fun onTouchEvent(event: MotionEvent, gestureType: String?) {
    }

    override fun onGestureRecognized(gestureType: String, x: Float, y: Float, details: Map<String, Any?>) {
        if (!isRecording) return

        try {
            val timestamp = System.currentTimeMillis()
            
            val touchPoint = mapOf(
                "x" to x,
                "y" to y,
                "timestamp" to timestamp,
                "force" to (details["force"] ?: 0f)
            )
            
            val eventMap = mapOf(
                "type" to EventType.GESTURE,
                "timestamp" to timestamp,
                "gestureType" to gestureType,
                "touches" to listOf(touchPoint),
                "duration" to (details["duration"] ?: 0),
                "targetLabel" to details["targetLabel"],
                "x" to x,
                "y" to y,
                "details" to details
            )
            
            Logger.debug("[TOUCH] Gesture recorded: type=$gestureType, x=$x, y=$y, touches=${listOf(touchPoint)}")
            
            addEventWithPersistence(eventMap)
        } catch (e: Exception) {
            Logger.error("Failed to record gesture", e)
        }
    }

    override fun onGestureWithTouchPath(
        gestureType: String,
        touches: List<Map<String, Any>>,
        duration: Long,
        targetLabel: String?
    ) {
        if (!isRecording) return

        try {
            val timestamp = System.currentTimeMillis()
            val firstTouch = touches.firstOrNull()
            val x = (firstTouch?.get("x") as? Number)?.toFloat() ?: 0f
            val y = (firstTouch?.get("y") as? Number)?.toFloat() ?: 0f

            val eventMap = mapOf(
                "type" to EventType.GESTURE,
                "timestamp" to timestamp,
                "gestureType" to gestureType,
                "touches" to touches,
                "duration" to duration,
                "targetLabel" to targetLabel,
                "x" to x,
                "y" to y,
                "details" to mapOf(
                    "duration" to duration,
                    "targetLabel" to targetLabel
                )
            )

            Logger.debug("[TOUCH] Gesture recorded: type=$gestureType, touches=${touches.size}")
            addEventWithPersistence(eventMap)
        } catch (e: Exception) {
            Logger.error("Failed to record gesture", e)
        }
    }

    override fun onRageTap(tapCount: Int, x: Float, y: Float) {
        if (!isRecording) return

        try {
            val timestamp = System.currentTimeMillis()
            
            val touchPoint = mapOf(
                "x" to x,
                "y" to y,
                "timestamp" to timestamp,
                "force" to 0f
            )
            
            val eventMap = mapOf(
                "type" to EventType.GESTURE,
                "timestamp" to timestamp,
                "gestureType" to "rage_tap",
                "touches" to listOf(touchPoint),
                "tapCount" to tapCount,
                "x" to x,
                "y" to y
            )
            addEventWithPersistence(eventMap)
        } catch (e: Exception) {
            Logger.error("Failed to record rage tap", e)
        }
    }

    override fun isCurrentlyRecording(): Boolean = isRecording

    override fun isKeyboardCurrentlyVisible(): Boolean = isKeyboardVisible

    override fun currentKeyboardHeight(): Int = lastKeyboardHeight


    override fun onNetworkChanged(quality: com.rejourney.network.NetworkQuality) {
        if (!isRecording) return

        val qualityMap = quality.toMap()
        val networkType = qualityMap["networkType"] as? String ?: "none"
        val cellularGeneration = qualityMap["cellularGeneration"] as? String ?: "unknown"

        val eventMap = mutableMapOf<String, Any?>(
            "type" to "network_change",
            "timestamp" to System.currentTimeMillis(),
            "status" to if (networkType == "none") "disconnected" else "connected",
            "networkType" to networkType,
            "isConstrained" to (qualityMap["isConstrained"] as? Boolean ?: false),
            "isExpensive" to (qualityMap["isExpensive"] as? Boolean ?: false)
        )

        if (cellularGeneration != "unknown") {
            eventMap["cellularGeneration"] = cellularGeneration
        }

        addEventWithPersistence(eventMap)
    }
    
    
    override fun onKeyboardShown(keyboardHeight: Int) {
        if (!isRecording) return
        
        Logger.debug("[KEYBOARD] Keyboard shown (height=$keyboardHeight)")
        isKeyboardVisible = true
        lastKeyboardHeight = keyboardHeight
        
        val eventMap = mapOf(
            "type" to EventType.KEYBOARD_SHOW,
            "timestamp" to System.currentTimeMillis(),
            "keyboardHeight" to keyboardHeight
        )
        addEventWithPersistence(eventMap)
        
        captureEngine?.notifyKeyboardEvent("keyboard_shown")
    }
    
    override fun onKeyboardHidden() {
        if (!isRecording) return
        
        Logger.debug("[KEYBOARD] Keyboard hidden (keyPresses=$keyPressCount)")
        isKeyboardVisible = false

        if (keyPressCount > 0) {
            addEventWithPersistence(
                mapOf(
                    "type" to EventType.KEYBOARD_TYPING,
                    "timestamp" to System.currentTimeMillis(),
                    "keyPressCount" to keyPressCount
                )
            )
        }
        
        val eventMap = mapOf(
            "type" to EventType.KEYBOARD_HIDE,
            "timestamp" to System.currentTimeMillis(),
            "keyPressCount" to keyPressCount
        )
        addEventWithPersistence(eventMap)
        
        keyPressCount = 0
        
        captureEngine?.notifyKeyboardEvent("keyboard_hidden")
    }
    
    override fun onKeyPress() {
        keyPressCount++
    }
    
    
    override fun onTextChanged(characterCount: Int) {
        if (!isRecording) return
        if (characterCount <= 0) return

        keyPressCount += characterCount

        if (isKeyboardVisible) {
            addEventWithPersistence(
                mapOf(
                    "type" to EventType.KEYBOARD_TYPING,
                    "timestamp" to System.currentTimeMillis(),
                    "keyPressCount" to characterCount
                )
            )
        }
    }
    
    
    override fun onANRDetected(durationMs: Long, threadState: String?) {
        try {
            if (!isRecording) return
            
            Logger.debug("ANR callback: duration=${durationMs}ms")
            
            val eventMap = mutableMapOf<String, Any?>(
                "type" to "anr",
                "timestamp" to System.currentTimeMillis(),
                "durationMs" to durationMs
            )
            threadState?.let { eventMap["threadState"] = it }
            addEventWithPersistence(eventMap)
            
            Telemetry.getInstance().recordANR()
        } catch (e: Exception) {
            Logger.error("SDK error in onANRDetected (non-fatal)", e)
        }
    }
    
    
    override fun onSegmentReady(segmentFile: File, startTime: Long, endTime: Long, frameCount: Int) {
        if (!isRecording && !isShuttingDown) {
            try {
                segmentFile.delete()
            } catch (_: Exception) {}
            return
        }
        
        if (isShuttingDown) {
            Logger.debug("Segment ready during shutdown - preserving file for recovery: ${segmentFile.name}")
            return
        }

        if (!remoteRecordingEnabled) {
            try {
                segmentFile.delete()
            } catch (_: Exception) {}
            Logger.debug("Segment upload skipped - recording disabled")
            return
        }
        
        Logger.debug("Segment ready: frames=$frameCount, file=${segmentFile.absolutePath}")
        
        scope.launch(Dispatchers.IO) {
            try {
                val success = uploadManager?.uploadVideoSegment(
                    segmentFile = segmentFile,
                    startTime = startTime,
                    endTime = endTime,
                    frameCount = frameCount
                ) ?: false
                
                if (success) {
                    Logger.debug("Segment uploaded successfully")
                } else {
                    Logger.warning("Segment upload failed")
                }
            } catch (e: Exception) {
                Logger.error("Failed to upload segment", e)
            }
        }
    }
    
    override fun onCaptureError(error: Exception) {
        Logger.error("Capture error: ${error.message}", error)
        
        val eventMap = mutableMapOf<String, Any?>(
            "type" to "capture_error",
            "timestamp" to System.currentTimeMillis(),
            "error" to error.message
        )
        addEventWithPersistence(eventMap)
    }
    
    override fun onHierarchySnapshotsReady(snapshotsJson: ByteArray, timestamp: Long) {
        Logger.debug("[HIERARCHY] onHierarchySnapshotsReady: START (size=${snapshotsJson.size} bytes, timestamp=$timestamp)")
        Logger.debug("[HIERARCHY] isRecording=$isRecording, isShuttingDown=$isShuttingDown, currentSessionId=$currentSessionId")
        
        if (!isRecording || isShuttingDown) {
            Logger.warning("[HIERARCHY] onHierarchySnapshotsReady: Skipping - isRecording=$isRecording, isShuttingDown=$isShuttingDown")
            return
        }

        if (!remoteRecordingEnabled) {
            Logger.debug("[HIERARCHY] Skipping upload - recording disabled")
            return
        }
        
        val sid = currentSessionId ?: run {
            Logger.error("[HIERARCHY] onHierarchySnapshotsReady: No current session ID, cannot upload hierarchy")
            return
        }
        
        Logger.debug("[HIERARCHY] onHierarchySnapshotsReady: Hierarchy snapshots ready for session: $sid")
        Logger.debug("[HIERARCHY] JSON size: ${snapshotsJson.size} bytes, uploadManager=${uploadManager != null}")
        
        scope.launch(Dispatchers.IO) {
            try {
                Logger.debug("[HIERARCHY] Starting hierarchy upload (sessionId=$sid)")
                val uploadStartTime = System.currentTimeMillis()
                
                val success = uploadManager?.uploadHierarchy(
                    hierarchyData = snapshotsJson,
                    timestamp = timestamp,
                    sessionId = sid
                ) ?: false
                
                val uploadDuration = System.currentTimeMillis() - uploadStartTime
                
                if (success) {
                    Logger.debug("[HIERARCHY] ✅ Hierarchy snapshots uploaded successfully in ${uploadDuration}ms (sessionId=$sid)")
                } else {
                    Logger.error("[HIERARCHY] ❌ Hierarchy snapshots upload FAILED after ${uploadDuration}ms (sessionId=$sid)")
                }
            } catch (e: Exception) {
                Logger.error("[HIERARCHY] ❌ Exception during hierarchy upload (sessionId=$sid): ${e.message}", e)
            }
        }
    }
    
    
    /**
     * Called when authentication fails due to security errors (403/404).
     * 
     * - 403 (security): Stop immediately and permanently (package name mismatch)
     * - 404 (not found): Retry with exponential backoff (could be temporary)
     */
    override fun onAuthenticationFailure(errorCode: Int, errorMessage: String, domain: String) {
        Logger.error("Authentication failure: code=$errorCode, message=$errorMessage, domain=$domain")
        
        when (errorCode) {
            403 -> {
                Logger.error("SECURITY: Access forbidden - stopping recording permanently")
                authPermanentlyFailed = true
                handleAuthenticationFailurePermanent(errorCode, errorMessage, domain)
            }
            else -> {
                scheduleAuthRetry(errorCode, errorMessage, domain)
            }
        }
    }
    
    /**
     * Schedule auth retry with exponential backoff.
     * Recording continues locally while retrying.
     */
    private fun scheduleAuthRetry(errorCode: Int, errorMessage: String, domain: String) {
        if (authPermanentlyFailed || isShuttingDown) {
            return
        }
        
        authRetryCount++
        
        if (authRetryCount > MAX_AUTH_RETRIES) {
            Logger.error("Auth failed after $MAX_AUTH_RETRIES retries. Recording continues locally.")
            
            emitAuthWarningEvent(errorCode, "Auth failed after max retries. Recording locally.", authRetryCount)
            
            scheduleBackgroundAuthRetry(AUTH_BACKGROUND_RETRY_DELAY_MS)
            return
        }
        
        val delay = minOf(
            AUTH_RETRY_BASE_DELAY_MS * (1L shl (authRetryCount - 1)),
            AUTH_RETRY_MAX_DELAY_MS
        )
        
        Logger.info("Auth failed (attempt $authRetryCount/$MAX_AUTH_RETRIES), retrying in ${delay}ms. " +
                   "Recording continues locally. Error: $errorMessage")
        
        if (authRetryCount >= 2) {
            Logger.info("Clearing cached auth data and re-registering fresh...")
            deviceAuthManager?.clearCredentials()
        }
        
        scheduleBackgroundAuthRetry(delay)
    }
    
    /**
     * Schedule a background auth retry after specified delay.
     */
    private fun scheduleBackgroundAuthRetry(delayMs: Long) {
        authRetryJob?.cancel()
        
        authRetryJob = scope.launch {
            delay(delayMs)
            if (!authPermanentlyFailed && !isShuttingDown) {
                Logger.info("Retrying auth (attempt ${authRetryCount + 1})...")
                performAuthRetry()
            }
        }
    }
    
    /**
     * Perform the auth retry - re-initialize device auth.
     */
    private fun performAuthRetry() {
        if (savedApiUrl.isNotEmpty() && savedPublicKey.isNotEmpty()) {
            deviceAuthManager?.registerDevice(
                projectKey = savedPublicKey,
                bundleId = reactContext.packageName,
                platform = "android",
                sdkVersion = Constants.SDK_VERSION,
                apiUrl = savedApiUrl
            ) { success, credentialId, error ->
                if (success) {
                    Logger.debug("Auth retry successful: device registered: $credentialId")
                    resetAuthRetryState()
                    deviceAuthManager?.getUploadToken { tokenSuccess, token, expiresIn, tokenError ->
                        if (tokenSuccess) {
                            Logger.debug("Upload token obtained after auth retry")
                        } else {
                            Logger.warning("Failed to get upload token after auth retry: $tokenError")
                        }
                    }
                } else {
                    Logger.warning("Auth retry failed: $error")
                }
            }
        }
    }
    
    /**
     * Reset auth retry state (called when auth succeeds).
     */
    private fun resetAuthRetryState() {
        authRetryCount = 0
        authPermanentlyFailed = false
        authRetryJob?.cancel()
        authRetryJob = null
    }
    
    /**
     * Handle PERMANENT authentication failure (403 security errors only).
     * Stops recording, clears credentials, and emits error event to JS.
     */
    private fun handleAuthenticationFailurePermanent(errorCode: Int, errorMessage: String, domain: String) {
        Handler(Looper.getMainLooper()).post {
            try {
                if (isRecording) {
                    Logger.warning("Stopping recording due to security authentication failure")
                    
                    captureEngine?.stopSession()
                    
                    touchInterceptor?.disableGlobalTracking()
                    
                    keyboardTracker?.stopTracking()
                    textInputTracker?.stopTracking()
                    
                    stopBatchUploadTimer()
                    stopDurationLimitTimer()
                    
                    isRecording = false
                    currentSessionId = null
                    userId = null
                    sessionEvents.clear()
                }
                
                deviceAuthManager?.clearCredentials()
                
                emitAuthErrorEvent(errorCode, errorMessage, domain)
                
            } catch (e: Exception) {
                Logger.error("Error handling authentication failure", e)
            }
        }
    }
    
    /**
     * Emit auth warning event (for retryable failures).
     */
    private fun emitAuthWarningEvent(errorCode: Int, errorMessage: String, retryCount: Int) {
        try {
            val params = Arguments.createMap().apply {
                putInt("code", errorCode)
                putString("message", errorMessage)
                putInt("retryCount", retryCount)
            }
            
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("rejourneyAuthWarning", params)
                
            Logger.debug("Emitted rejourneyAuthWarning event to JS: code=$errorCode, retryCount=$retryCount")
        } catch (e: Exception) {
            Logger.error("Failed to emit auth warning event", e)
        }
    }
    
    /**
     * Emit rejourneyAuthError event to JavaScript layer.
     */
    private fun emitAuthErrorEvent(errorCode: Int, errorMessage: String, domain: String) {
        try {
            val params = Arguments.createMap().apply {
                putInt("code", errorCode)
                putString("message", errorMessage)
                putString("domain", domain)
            }
            
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("rejourneyAuthError", params)
                
            Logger.debug("Emitted rejourneyAuthError event to JS: code=$errorCode")
        } catch (e: Exception) {
            Logger.error("Failed to emit auth error event", e)
        }
    }
    
    /**
     * Check if the app was killed in the previous session using ApplicationExitInfo (Android 11+).
     * This is a fallback mechanism when onTaskRemoved() doesn't fire.
     */
    private fun checkPreviousAppKill() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return
        }
        
        try {
            val activityManager = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as? android.app.ActivityManager
            if (activityManager == null) {
                Logger.debug("ActivityManager not available for exit info check")
                return
            }
            
            val exitReasons = activityManager.getHistoricalProcessExitReasons(null, 0, 1)
            
            if (exitReasons.isNotEmpty()) {
                val exitInfo = exitReasons[0]
                val reason = exitInfo.reason
                val timestamp = exitInfo.timestamp
                
                Logger.debug("Previous app exit: reason=$reason, timestamp=$timestamp")
                
                if (reason == android.app.ApplicationExitInfo.REASON_USER_REQUESTED) {
                    Logger.debug("App was killed by user (likely swipe-away) - checking for unclosed session")
                }
            }
        } catch (e: Exception) {
            Logger.warning("Failed to check previous app kill: ${e.message}")
        }
    }
    
    /**
     * Check for unclosed sessions from previous app launch.
     * If a session was active but never properly ended, end it now.
     */
    private fun checkForUnclosedSessions() {
        try {
            val prefs = reactContext.getSharedPreferences("rejourney", Context.MODE_PRIVATE)
            val lastSessionId = prefs.getString("rj_current_session_id", null)
            val lastSessionStartTime = prefs.getLong("rj_session_start_time", 0)
            
            if (lastSessionId != null && lastSessionStartTime > 0) {
                val sessionEndTime = prefs.getLong("rj_session_end_time_$lastSessionId", 0)
                
                if (sessionEndTime == 0L) {
                    Logger.debug("Found unclosed session: $lastSessionId (started at $lastSessionStartTime)")
                    
                    backgroundScope.launch {
                        try {
                            uploadManager?.let { um ->
                                val originalSessionId = um.sessionId
                                um.sessionId = lastSessionId
                                
                                val estimatedEndTime = System.currentTimeMillis() - 1000
                                
                                Logger.debug("Ending unclosed session: $lastSessionId at $estimatedEndTime")
                                
                                val success = um.endSession(endedAtOverride = estimatedEndTime)
                                
                                um.sessionId = originalSessionId
                                
                                if (success) {
                                    Logger.debug("Successfully ended unclosed session: $lastSessionId")
                                    um.clearSessionRecovery(lastSessionId)
                                    
                                    prefs.edit()
                                        .putLong("rj_session_end_time_$lastSessionId", estimatedEndTime)
                                        .remove("rj_current_session_id")
                                        .remove("rj_session_start_time")
                                        .apply()
                                } else {
                                    Logger.warning("Failed to end unclosed session: $lastSessionId")
                                }
                            }
                        } catch (e: Exception) {
                            Logger.error("Error ending unclosed session: ${e.message}", e)
                        }
                    }
                } else {
                    prefs.edit()
                        .remove("rj_current_session_id")
                        .remove("rj_session_start_time")
                        .apply()
                }
            }
        } catch (e: Exception) {
            Logger.error("Failed to check for unclosed sessions: ${e.message}", e)
        }
    }
}
