package co.rejourney.rejourney

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.rejourney.RejourneySdkInfo
import com.rejourney.engine.DeviceRegistrar
import com.rejourney.engine.DiagnosticLog
import com.rejourney.platform.SessionLifecycleService
import com.rejourney.recording.AnrSentinel
import com.rejourney.recording.EventBuffer
import com.rejourney.recording.InteractionRecorder
import com.rejourney.recording.RejourneyNetworkEventFilter
import com.rejourney.recording.ReplayOrchestrator
import com.rejourney.recording.SegmentDispatcher
import com.rejourney.recording.StabilityMonitor
import com.rejourney.recording.TelemetryPipeline
import com.rejourney.recording.ViewHierarchyScanner
import com.rejourney.recording.VisualCapture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt
import kotlin.random.Random

internal class RejourneyNativeController(
    context: Context,
    private val emitEvent: (String, Map<String, Any?>) -> Unit
) : Application.ActivityLifecycleCallbacks {
    private val applicationContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val preferences = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private var activity: Activity? = null
    private var initialized = false
    private var publicKey = ""
    private var options: Map<String, Any?> = emptyMap()
    private var state: SessionState = SessionState.Idle
    private var backgroundedAt: Long? = null
    private var currentUserId: String? = preferences.getString(USER_ID_KEY, null)
    private val pendingScreens = ArrayDeque<String>()
    private val metadata = LinkedHashMap<String, Any?>()
    private val backgroundRunnable = Runnable(::handleBackground)
    private var lifecycleRegistered = false

    fun configure(arguments: Map<String, Any?>) {
        ensureInitialized()
        publicKey = arguments.string("publicKey")
        options = arguments.toMap()
        RejourneySdkInfo.sdkVersion = SDK_VERSION
        RejourneyNetworkEventFilter.configure(arguments.string("apiUrl", DEFAULT_API_URL))
        DiagnosticLog.setVerbose(arguments.bool("debug", false))
        arguments.optionalString("userId")?.let { setUserIdentity(it) }
        DiagnosticLog.notice("[Rejourney] Flutter SDK configured (version: $SDK_VERSION)")
    }

    fun setActivity(value: Activity?) {
        activity = value
        VisualCapture.shared?.setCurrentActivity(value)
        ViewHierarchyScanner.shared.setCurrentActivity(value)
        InteractionRecorder.shared?.setCurrentActivity(value)
    }

    fun start(completion: (Map<String, Any?>) -> Unit) {
        ensureInitialized()
        if (publicKey.isBlank()) {
            completion(result(false, error = "publicKey is required"))
            return
        }
        if (!options.bool("enabled", true)) {
            completion(result(false, error = "disabled"))
            return
        }

        when (val current = state) {
            is SessionState.Active -> {
                completion(result(true, current.sessionId, telemetryOnly = isTelemetryOnly()))
                return
            }
            is SessionState.Paused -> {
                completion(result(true, current.sessionId, telemetryOnly = isTelemetryOnly()))
                return
            }
            is SessionState.Starting -> {
                completion(result(false, error = "Session is still starting"))
                return
            }
            SessionState.Idle -> Unit
        }

        scope.launch {
            val apiUrl = options.string("apiUrl", DEFAULT_API_URL)
            when (val fetched = withContext(Dispatchers.IO) { fetchRemoteConfig(apiUrl, publicKey) }) {
                is ConfigFetchResult.AccessDenied -> {
                    preferences.edit().remove(remoteConfigKey(publicKey)).apply()
                    completion(result(false, error = "access_denied_" + fetched.statusCode))
                }
                is ConfigFetchResult.Success -> beginSession(fetched.config, true, completion)
                ConfigFetchResult.NetworkError -> {
                    val cached = parseRemoteConfig(preferences.getString(remoteConfigKey(publicKey), null))
                    beginSession(cached ?: RemoteConfig(), cached != null, completion)
                }
            }
        }
    }

    fun stop(completion: (Map<String, Any?>) -> Unit) {
        val sessionId = currentSessionId()
        state = SessionState.Idle
        stopLifecycleService()

        if (sessionId == null) {
            completion(result(true, uploadSuccess = true))
            return
        }

        ReplayOrchestrator.shared?.endReplayWithReason("user_initiated") { success, uploaded ->
            mainHandler.post {
                completion(result(success, sessionId, uploadSuccess = uploaded))
            }
        } ?: completion(result(true, sessionId, uploadSuccess = true))
    }

    fun currentSessionId(): String? {
        return when (val current = state) {
            is SessionState.Active -> current.sessionId
            is SessionState.Paused -> current.sessionId
            is SessionState.Starting -> ReplayOrchestrator.shared?.replayId
            SessionState.Idle -> ReplayOrchestrator.shared?.replayId
        }?.takeIf { it.isNotBlank() }
    }

    fun setUserIdentity(userId: String) {
        if (userId.isBlank() || userId == "anonymous" || userId.startsWith("anon_")) {
            clearUserIdentity()
            return
        }
        currentUserId = userId
        preferences.edit().putString(USER_ID_KEY, userId).apply()
        if (state is SessionState.Active) ReplayOrchestrator.shared?.associateUser(userId)
    }

    fun clearUserIdentity() {
        currentUserId = null
        preferences.edit().remove(USER_ID_KEY).apply()
    }

    fun logEvent(name: String, properties: Map<String, Any?>) {
        if (name.isBlank()) return
        when (name) {
            "network_request" -> TelemetryPipeline.shared?.recordNetworkEvent(properties.withoutNulls())
            "error" -> TelemetryPipeline.shared?.recordJSErrorEvent(
                properties["name"]?.toString() ?: "Error",
                properties["message"]?.toString() ?: "Unknown error",
                properties["stack"]?.toString()
            )
            "log" -> TelemetryPipeline.shared?.recordConsoleLogEvent(
                properties["level"]?.toString() ?: "log",
                properties["message"]?.toString() ?: ""
            )
            else -> ReplayOrchestrator.shared?.recordCustomEvent(name, JSONObject(properties).toString())
        }
    }

    fun setMetadata(values: Map<String, Any?>) {
        values.forEach { (key, value) ->
            if (key.isNotBlank()) {
                metadata[key] = value
                if (state is SessionState.Active) {
                    ReplayOrchestrator.shared?.attachAttribute(key, attributeString(value))
                }
            }
        }
    }

    fun trackScreen(name: String) {
        if (name.isBlank()) return
        if (state is SessionState.Active) {
            recordScreen(name)
        } else if (pendingScreens.lastOrNull() != name) {
            pendingScreens.addLast(name)
            while (pendingScreens.size > 50) pendingScreens.removeFirst()
        }
    }

    fun markVisualChange(importance: String): Boolean {
        if (importance == "high" || importance == "critical") {
            VisualCapture.shared?.snapshotNow()
        }
        return true
    }

    fun onScroll() {
        ReplayOrchestrator.shared?.logScrollAction()
    }

    fun updateMaskRegion(id: String, left: Double, top: Double, width: Double, height: Double) {
        val currentActivity = activity ?: return
        val density = currentActivity.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        val content = currentActivity.findViewById<android.view.View>(android.R.id.content)
        val origin = IntArray(2)
        content?.getLocationOnScreen(origin)
        val rect = Rect(
            origin[0] + (left * density).roundToInt(),
            origin[1] + (top * density).roundToInt(),
            origin[0] + ((left + width) * density).roundToInt(),
            origin[1] + ((top + height) * density).roundToInt()
        )
        VisualCapture.shared?.setExternalRedactionRect(id, rect)
    }

    fun removeMaskRegion(id: String) {
        VisualCapture.shared?.removeExternalRedactionRect(id)
    }

    fun sdkMetrics(): Map<String, Any?> {
        return SegmentDispatcher.shared.sdkTelemetrySnapshot(
            TelemetryPipeline.shared?.getQueueDepth() ?: 0
        )
    }

    fun destroy() {
        mainHandler.removeCallbacks(backgroundRunnable)
        if (lifecycleRegistered) {
            (applicationContext as? Application)?.unregisterActivityLifecycleCallbacks(this)
            lifecycleRegistered = false
        }
        scope.cancel()
        setActivity(null)
    }

    override fun onActivityPaused(activity: Activity) {
        // Debounce activity-to-activity and configuration transitions. If no
        // activity resumes, this is a genuine process background transition.
        mainHandler.removeCallbacks(backgroundRunnable)
        mainHandler.postDelayed(backgroundRunnable, BACKGROUND_DEBOUNCE_MS)
    }

    override fun onActivityResumed(activity: Activity) {
        mainHandler.removeCallbacks(backgroundRunnable)
        handleForeground()
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    private fun handleBackground() {
        val current = state as? SessionState.Active ?: return
        state = SessionState.Paused(current.sessionId)
        backgroundedAt = System.currentTimeMillis()
        DiagnosticLog.trace("[Rejourney] App backgrounded; pausing ${current.sessionId}")
        VisualCapture.shared?.pauseForBackground()
        ReplayOrchestrator.shared?.pauseForBackground()
        TelemetryPipeline.shared?.recordAppBackground()
        TelemetryPipeline.shared?.dispatchNow()
        SegmentDispatcher.shared.shipPending()
        TelemetryPipeline.shared?.pause()
    }

    private fun handleForeground() {
        val paused = state as? SessionState.Paused ?: return
        val duration = System.currentTimeMillis() - (backgroundedAt ?: System.currentTimeMillis())
        backgroundedAt = null
        DiagnosticLog.trace("[Rejourney] App foregrounded after ${duration}ms")
        TelemetryPipeline.shared?.resume()

        if (duration > SESSION_TIMEOUT_MS) {
            state = SessionState.Idle
            val restarted = AtomicBoolean(false)
            val restart = {
                if (restarted.compareAndSet(false, true)) {
                    start { startResult ->
                        emitEvent("sessionRolledOver", startResult + mapOf("previousSessionId" to paused.sessionId))
                    }
                }
            }
            mainHandler.postDelayed(restart, SESSION_ROLLOVER_GRACE_MS)
            ReplayOrchestrator.shared?.endReplayWithReason("background_timeout") { _, _ ->
                mainHandler.post(restart)
            }
        } else {
            val actualSession = ReplayOrchestrator.shared?.replayId
            if (actualSession.isNullOrBlank()) {
                state = SessionState.Idle
                start { startResult -> emitEvent("sessionRolledOver", startResult) }
                return
            }
            state = SessionState.Active(actualSession)
            VisualCapture.shared?.resumeFromBackground()
            ReplayOrchestrator.shared?.resumeFromBackground()
            TelemetryPipeline.shared?.recordAppForeground(duration)
            StabilityMonitor.shared?.transmitStoredReport()
        }
    }

    private fun ensureInitialized() {
        if (initialized) return
        synchronized(this) {
            if (initialized) return
            DeviceRegistrar.getInstance(applicationContext)
            SegmentDispatcher.shared
            TelemetryPipeline.getInstance(applicationContext)
            ReplayOrchestrator.getInstance(applicationContext)
            VisualCapture.getInstance(applicationContext)
            EventBuffer.getInstance(applicationContext)
            InteractionRecorder.getInstance(applicationContext)
            ViewHierarchyScanner.shared
            StabilityMonitor.getInstance(applicationContext)
            AnrSentinel.shared
            (applicationContext as? Application)?.let { application ->
                application.registerActivityLifecycleCallbacks(this)
                lifecycleRegistered = true
            }
            ReplayOrchestrator.shared?.recoverInterruptedReplay {
                StabilityMonitor.shared?.transmitStoredReport()
            }
            initialized = true
        }
    }

    private fun beginSession(
        remote: RemoteConfig,
        hasRemoteConfig: Boolean,
        completion: (Map<String, Any?>) -> Unit
    ) {
        if (!remote.rejourneyEnabled) {
            completion(result(false, error = "disabled"))
            return
        }
        if (remote.billingBlocked) {
            completion(result(false, error = remote.billingReason ?: "billing_blocked"))
            return
        }
        if (remote.sampleRate <= 0 || Random.nextDouble() * 100 >= remote.sampleRate) {
            ReplayOrchestrator.shared?.setRemoteConfig(
                true, false, remote.sampleRate, false, effectiveMaxRecordingMinutes(remote.maxRecordingMinutes)
            )
            completion(result(false, error = "sampled_out"))
            return
        }

        val observeOnly = options.bool("observeOnly", false)
        val recordingEnabled = remote.recordingEnabled &&
            !observeOnly &&
            options.bool("captureScreen", true)
        ReplayOrchestrator.shared?.setRemoteConfig(
            true,
            recordingEnabled,
            remote.sampleRate,
            true,
            effectiveMaxRecordingMinutes(remote.maxRecordingMinutes)
        )

        val apiUrl = options.string("apiUrl", DEFAULT_API_URL)
        TelemetryPipeline.shared?.projectId = remote.projectId
        SegmentDispatcher.shared.projectId = remote.projectId
        TelemetryPipeline.shared?.endpoint = apiUrl
        TelemetryPipeline.shared?.apiToken = publicKey
        SegmentDispatcher.shared.endpoint = apiUrl
        DeviceRegistrar.shared?.endpoint = apiUrl
        RejourneyNetworkEventFilter.configure(apiUrl)

        val captureSettings = mutableMapOf<String, Any>(
            "captureScreen" to recordingEnabled,
            "captureAnalytics" to options.bool("captureAnalytics", true),
            "captureCrashes" to options.bool("captureCrashes", true),
            "captureANR" to options.bool("captureANR", true),
            "wifiOnly" to options.bool("wifiOnly", false),
            "captureLogs" to options.bool("captureLogs", true),
            "collectDeviceInfo" to options.bool("collectDeviceInfo", true),
            "collectGeoLocation" to options.bool("collectGeoLocation", true),
            "captureNativeSheets" to options.bool("captureNativeSheets", true),
            "detectRageTaps" to options.bool("detectRageTaps", true),
            "rageTapThreshold" to options.int("rageTapThreshold", 3).coerceAtLeast(1),
            "rageTapTimeWindow" to options.int("rageTapTimeWindow", 500).coerceAtLeast(1),
            "rageTapRadius" to options.double("rageTapRadius", 50.0).coerceAtLeast(1.0),
            "textInputMasking" to remote.textInputMasking,
            "imageVideoMasking" to remote.imageVideoMasking,
            "observeOnly" to observeOnly
        )
        val fps = if (hasRemoteConfig) remote.recordingFps else options.optionalInt("fps")
        fps?.coerceIn(1, 30)?.let { captureSettings["captureRate"] = 1.0 / it }
        captureSettings["imgCompression"] = when (options.string("quality", "medium")) {
            "low" -> 0.4
            "high" -> 0.7
            else -> 0.5
        }

        setActivity(activity)
        val pending = "pending_" + UUID.randomUUID().toString()
        state = SessionState.Starting(pending)
        val credential = DeviceRegistrar.shared?.uploadCredential
        if (credential != null && DeviceRegistrar.shared?.credentialValid == true) {
            ReplayOrchestrator.shared?.beginReplayFast(publicKey, apiUrl, credential, captureSettings)
        } else {
            ReplayOrchestrator.shared?.beginReplay(publicKey, apiUrl, captureSettings)
        }
        startLifecycleService()
        waitForReady(0, recordingEnabled, completion)
    }

    private fun waitForReady(
        attempt: Int,
        recordingEnabled: Boolean,
        completion: (Map<String, Any?>) -> Unit
    ) {
        mainHandler.postDelayed({
            val sessionId = ReplayOrchestrator.shared?.replayId
            if (!sessionId.isNullOrBlank()) {
                state = SessionState.Active(sessionId)
                ReplayOrchestrator.shared?.activateGestureRecording()
                currentUserId?.let { ReplayOrchestrator.shared?.associateUser(it) }
                metadata.forEach { (key, value) ->
                    ReplayOrchestrator.shared?.attachAttribute(key, attributeString(value))
                }
                pendingScreens.forEach(::recordScreen)
                pendingScreens.clear()
                DiagnosticLog.replayBegan(sessionId)
                completion(result(true, sessionId, telemetryOnly = !recordingEnabled))
            } else if (attempt < 50) {
                waitForReady(attempt + 1, recordingEnabled, completion)
            } else {
                state = SessionState.Idle
                stopLifecycleService()
                completion(result(false, error = "Timed out waiting for replay session to initialize"))
            }
        }, 100)
    }

    private fun recordScreen(name: String) {
        TelemetryPipeline.shared?.recordViewTransition(name, name, true)
        ReplayOrchestrator.shared?.logScreenView(name)
    }

    private fun isTelemetryOnly(): Boolean {
        return ReplayOrchestrator.shared?.visualCaptureEnabled != true ||
            options.bool("observeOnly", false)
    }

    private fun startLifecycleService() {
        try {
            applicationContext.startService(Intent(applicationContext, SessionLifecycleService::class.java))
        } catch (_: Exception) {
        }
    }

    private fun stopLifecycleService() {
        try {
            applicationContext.stopService(Intent(applicationContext, SessionLifecycleService::class.java))
        } catch (_: Exception) {
        }
    }

    private fun fetchRemoteConfig(apiUrl: String, key: String): ConfigFetchResult {
        return try {
            val request = Request.Builder()
                .url(apiUrl.trimEnd('/') + "/api/sdk/config")
                .header("x-public-key", key)
                .header("x-platform", "android")
                .header("x-package-name", applicationContext.packageName)
                .get()
                .build()
            val client = OkHttpClient.Builder()
                .connectTimeout(1, TimeUnit.SECONDS)
                .readTimeout(1, TimeUnit.SECONDS)
                .callTimeout(2, TimeUnit.SECONDS)
                .build()
            client.newCall(request).execute().use { response ->
                if (response.code == 401 || response.code == 403 || response.code == 404) {
                    return ConfigFetchResult.AccessDenied(response.code)
                }
                if (!response.isSuccessful) return ConfigFetchResult.NetworkError
                val body = response.body?.string() ?: return ConfigFetchResult.NetworkError
                val config = parseRemoteConfig(body) ?: return ConfigFetchResult.NetworkError
                preferences.edit().putString(remoteConfigKey(key), body).apply()
                ConfigFetchResult.Success(config)
            }
        } catch (_: Exception) {
            ConfigFetchResult.NetworkError
        }
    }

    private fun parseRemoteConfig(value: String?): RemoteConfig? {
        if (value.isNullOrBlank()) return null
        return try {
            val json = JSONObject(value)
            RemoteConfig(
                projectId = json.optString("projectId", "default").ifBlank { "default" },
                rejourneyEnabled = json.optBoolean("rejourneyEnabled", true),
                recordingEnabled = json.optBoolean("recordingEnabled", true),
                textInputMasking = if (json.optString("textInputMasking") == "secure_only") "secure_only" else "all",
                imageVideoMasking = if (json.optString("imageVideoMasking") == "all") "all" else "none",
                recordingFps = json.optDouble("recordingFps", 1.0).roundToInt().coerceIn(1, 3),
                sampleRate = json.optDouble("sampleRate", 100.0).roundToInt().coerceIn(0, 100),
                maxRecordingMinutes = json.optDouble("maxRecordingMinutes", 10.0).roundToInt().coerceIn(1, 10),
                billingBlocked = json.optBoolean("billingBlocked", false),
                billingReason = json.optString("billingReason").takeIf { it.isNotBlank() }
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun effectiveMaxRecordingMinutes(remoteMinutes: Int): Int {
        val milliseconds = options.optionalInt("maxSessionDurationMs") ?: return remoteMinutes
        if (milliseconds <= 0) return remoteMinutes
        val localMinutes = ((milliseconds.toLong() + 59_999L) / 60_000L)
            .coerceAtLeast(1L)
            .coerceAtMost(Int.MAX_VALUE.toLong())
            .toInt()
        return minOf(remoteMinutes, localMinutes)
    }

    private fun remoteConfigKey(key: String) = REMOTE_CONFIG_PREFIX + key

    private fun result(
        success: Boolean,
        sessionId: String? = null,
        error: String? = null,
        uploadSuccess: Boolean? = null,
        telemetryOnly: Boolean? = null
    ): Map<String, Any?> {
        return mapOf(
            "success" to success,
            "sessionId" to sessionId,
            "error" to error,
            "uploadSuccess" to uploadSuccess,
            "telemetryOnly" to telemetryOnly
        )
    }

    private fun attributeString(value: Any?): String {
        return when (value) {
            null -> "null"
            is String -> value
            is Number, is Boolean -> value.toString()
            else -> JSONObject.wrap(value)?.toString() ?: value.toString()
        }
    }

    private sealed interface SessionState {
        data object Idle : SessionState
        data class Starting(val pendingId: String) : SessionState
        data class Active(val sessionId: String) : SessionState
        data class Paused(val sessionId: String) : SessionState
    }

    private data class RemoteConfig(
        val projectId: String = "default",
        val rejourneyEnabled: Boolean = true,
        val recordingEnabled: Boolean = true,
        val textInputMasking: String = "all",
        val imageVideoMasking: String = "none",
        val recordingFps: Int = 1,
        val sampleRate: Int = 100,
        val maxRecordingMinutes: Int = 10,
        val billingBlocked: Boolean = false,
        val billingReason: String? = null
    )

    private sealed interface ConfigFetchResult {
        data class Success(val config: RemoteConfig) : ConfigFetchResult
        data class AccessDenied(val statusCode: Int) : ConfigFetchResult
        data object NetworkError : ConfigFetchResult
    }

    private companion object {
        const val SDK_VERSION = "0.1.1"
        const val DEFAULT_API_URL = "https://api.rejourney.co"
        const val PREFS_NAME = "com.rejourney.flutter.prefs"
        const val USER_ID_KEY = "user_identity"
        const val REMOTE_CONFIG_PREFIX = "remote_config_"
        const val SESSION_TIMEOUT_MS = 60_000L
        const val SESSION_ROLLOVER_GRACE_MS = 2_000L
        const val BACKGROUND_DEBOUNCE_MS = 700L
    }
}

private fun Map<String, Any?>.string(key: String, default: String = ""): String {
    return this[key] as? String ?: default
}

private fun Map<String, Any?>.optionalString(key: String): String? {
    return (this[key] as? String)?.takeIf { it.isNotBlank() }
}

private fun Map<String, Any?>.bool(key: String, default: Boolean): Boolean {
    return this[key] as? Boolean ?: default
}

private fun Map<String, Any?>.int(key: String, default: Int): Int {
    return (this[key] as? Number)?.toInt() ?: default
}

private fun Map<String, Any?>.optionalInt(key: String): Int? {
    return (this[key] as? Number)?.toInt()
}

private fun Map<String, Any?>.double(key: String, default: Double): Double {
    return (this[key] as? Number)?.toDouble() ?: default
}

private fun Map<String, Any?>.withoutNulls(): Map<String, Any> {
    return entries.mapNotNull { (key, value) -> value?.let { key to it } }.toMap()
}
