/**
 * ANR (Application Not Responding) detection handler.
 * Uses a watchdog pattern to detect when the main thread is unresponsive.
 */
package com.rejourney.capture

import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import com.rejourney.core.Logger
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class ANRHandler private constructor(private val context: Context) {
    
    companion object {
        @Volatile
        private var instance: ANRHandler? = null
        
        private const val PREFS_NAME = "rejourney_anr"
        private const val KEY_ANR_REPORT = "pending_anr_report"
        private const val KEY_HAS_PENDING = "has_pending_anr"
        
        // Default ANR threshold: 5 seconds
        private const val DEFAULT_THRESHOLD_MS = 5000L
        // OPTIMIZATION: Watchdog check interval increased to 3 seconds (33% CPU reduction)
        // Still catches ANRs reliably while reducing background thread overhead
        private const val CHECK_INTERVAL_MS = 3000L

        fun getInstance(context: Context): ANRHandler {
            return instance ?: synchronized(this) {
                instance ?: ANRHandler(context.applicationContext).also { instance = it }
            }
        }
    }

    interface ANRListener {
        fun onANRDetected(durationMs: Long, threadState: String?)
    }

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var watchdogThread: Thread? = null
    private val isMonitoring = AtomicBoolean(false)
    private val mainThreadResponded = AtomicBoolean(true)
    private val lastPingTime = AtomicLong(0)
    
    var thresholdMs: Long = DEFAULT_THRESHOLD_MS
    var listener: ANRListener? = null

    fun startMonitoring() {
        if (isMonitoring.getAndSet(true)) {
            return
        }

        watchdogThread = Thread({
            while (isMonitoring.get()) {
                checkMainThread()
                try {
                    Thread.sleep(CHECK_INTERVAL_MS)
                } catch (e: InterruptedException) {
                    break
                }
            }
        }, "RejourneyANRWatchdog").apply {
            priority = Thread.NORM_PRIORITY
            start()
        }

        Logger.debug("ANR monitoring started (threshold: ${thresholdMs}ms, interval: ${CHECK_INTERVAL_MS}ms)")
    }

    fun stopMonitoring() {
        if (!isMonitoring.getAndSet(false)) {
            return
        }
        
        watchdogThread?.interrupt()
        watchdogThread = null
        Logger.debug("ANR monitoring stopped")
    }

    private fun checkMainThread() {
        if (!isMonitoring.get()) return

        val now = System.currentTimeMillis()

        // Check if main thread responded to the last ping
        if (!mainThreadResponded.get()) {
            val elapsed = now - lastPingTime.get()

            if (elapsed >= thresholdMs) {
                handleANR(elapsed)
                mainThreadResponded.set(true)
            }
            return
        }

        // Send new ping to main thread
        mainThreadResponded.set(false)
        lastPingTime.set(now)

        mainHandler.post {
            mainThreadResponded.set(true)
        }
    }

    private fun handleANR(durationMs: Long) {
        Logger.debug("[ANR] ANR DETECTED! Duration: ${durationMs}ms - main thread blocked")
        
        // Capture thread state
        val threadState = captureThreadState()
        Logger.debug("[ANR] Captured main thread stack (${threadState.length} chars)")
        
        // Build ANR report
        val report = buildANRReport(durationMs, threadState)
        
        // Persist to disk
        persistANRReport(report)
        
        // Notify listener handling thread safety internally
        listener?.onANRDetected(durationMs, threadState)
    }

    private fun captureThreadState(): String {
        return try {
            val mainThread = Looper.getMainLooper().thread
            mainThread.stackTrace.joinToString("\n") { element ->
                "\tat $element"
            }
        } catch (e: Exception) {
            "Unable to capture thread state: ${e.message}"
        }
    }

    private fun buildANRReport(durationMs: Long, threadState: String?): JSONObject {
        val mainPrefs = context.getSharedPreferences("rejourney", Context.MODE_PRIVATE)
        val sessionId = mainPrefs.getString("rj_current_session_id", null)

        return JSONObject().apply {
            put("timestamp", System.currentTimeMillis())
            put("durationMs", durationMs)
            put("type", "anr")
            put("sessionId", sessionId)
            put("threadState", threadState)
            put("platform", "android")
            put("sdkVersion", com.rejourney.core.Constants.SDK_VERSION)
            
            put("deviceMetadata", JSONObject().apply {
                put("manufacturer", android.os.Build.MANUFACTURER)
                put("model", android.os.Build.MODEL)
                put("osVersion", android.os.Build.VERSION.RELEASE)
                put("sdkInt", android.os.Build.VERSION.SDK_INT)
            })
        }
    }

    private fun persistANRReport(report: JSONObject) {
        try {
            prefs.edit()
                .putString(KEY_ANR_REPORT, report.toString())
                .putBoolean(KEY_HAS_PENDING, true)
                .commit()
            Logger.debug("ANR report persisted to disk")
        } catch (e: Exception) {
            Logger.error("Failed to persist ANR report", e)
        }
    }

    /**
     * Check if there's a pending ANR report from previous session.
     */
    fun hasPendingANRReport(): Boolean {
        return prefs.getBoolean(KEY_HAS_PENDING, false)
    }

    /**
     * Load and purge the pending ANR report.
     * Returns the ANR report as a map, or null if none exists.
     */
    fun loadAndPurgePendingANRReport(): Map<String, Any?>? {
        if (!hasPendingANRReport()) return null

        return try {
            val jsonString = prefs.getString(KEY_ANR_REPORT, null) ?: return null
            val json = JSONObject(jsonString)
            
            // Clear the pending report
            prefs.edit()
                .remove(KEY_ANR_REPORT)
                .putBoolean(KEY_HAS_PENDING, false)
                .apply()

            // Convert to map
            json.keys().asSequence().associateWith { key ->
                json.opt(key)
            }
        } catch (e: Exception) {
            Logger.error("Failed to load pending ANR report", e)
            prefs.edit().putBoolean(KEY_HAS_PENDING, false).apply()
            null
        }
    }
}
