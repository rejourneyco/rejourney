/**
 * Crash detection and reporting handler.
 * Ported from iOS RJCrashHandler.
 */
package com.rejourney.capture

import android.content.Context
import android.content.SharedPreferences
import com.rejourney.core.Logger
import org.json.JSONObject
import java.io.PrintWriter
import java.io.StringWriter

class CrashHandler private constructor(private val context: Context) : Thread.UncaughtExceptionHandler {
    
    companion object {
        @Volatile
        private var instance: CrashHandler? = null
        
        private const val PREFS_NAME = "rejourney_crash"
        private const val KEY_CRASH_REPORT = "pending_crash_report"
        private const val KEY_HAS_PENDING = "has_pending_crash"

        fun getInstance(context: Context): CrashHandler {
            return instance ?: synchronized(this) {
                instance ?: CrashHandler(context.applicationContext).also { instance = it }
            }
        }
    }

    private var defaultHandler: Thread.UncaughtExceptionHandler? = null
    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun startMonitoring() {
        defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler(this)
        Logger.debug("Crash monitoring started")
    }

    override fun uncaughtException(thread: Thread, throwable: Throwable) {
        try {
            Logger.debug("[CRASH] EXCEPTION DETECTED: ${throwable.javaClass.name} - ${throwable.message}")
            
            // Get session info from main prefs
            val mainPrefs = context.getSharedPreferences("rejourney", Context.MODE_PRIVATE)
            val sessionId = mainPrefs.getString("rj_current_session_id", null)

            // Build crash report
            val crashReport = buildCrashReport(thread, throwable, sessionId)
            
            // Persist to SharedPreferences (synchronous write for reliability)
            prefs.edit()
                .putString(KEY_CRASH_REPORT, crashReport.toString())
                .putBoolean(KEY_HAS_PENDING, true)
                .commit()

            Logger.debug("[CRASH] Report persisted (sessionId=$sessionId)")
        } catch (e: Exception) {
            // Don't let crash handling cause another crash
            Logger.error("Failed to capture crash", e)
        } finally {
            // Call the default handler to continue normal crash behavior
            defaultHandler?.uncaughtException(thread, throwable)
        }
    }

    private fun buildCrashReport(thread: Thread, throwable: Throwable, sessionId: String?): JSONObject {
        val sw = StringWriter()
        throwable.printStackTrace(PrintWriter(sw))
        val stackTrace = sw.toString()
        
        // Generate fingerprint for crash deduplication (industry standard)
        val fingerprint = generateFingerprint(throwable, stackTrace)

        return JSONObject().apply {
            put("timestamp", System.currentTimeMillis())
            put("sessionId", sessionId)
            put("threadName", thread.name)
            put("exceptionType", throwable.javaClass.name)
            put("exceptionMessage", throwable.message)
            put("stackTrace", stackTrace)
            put("fingerprint", fingerprint)
            put("platform", "android")
            put("sdkVersion", com.rejourney.core.Constants.SDK_VERSION)
            
            // Add device info
            put("deviceInfo", JSONObject().apply {
                put("manufacturer", android.os.Build.MANUFACTURER)
                put("model", android.os.Build.MODEL)
                put("osVersion", android.os.Build.VERSION.RELEASE)
                put("sdkInt", android.os.Build.VERSION.SDK_INT)
            })
        }
    }
    
    /**
     * Generate a fingerprint for crash deduplication (industry standard).
     * Based on exception type + top stack frames.
     */
    private fun generateFingerprint(throwable: Throwable, stackTrace: String): String {
        val input = StringBuilder(throwable.javaClass.name)
        
        // Use top 5 stack trace lines for fingerprint
        val lines = stackTrace.lines().take(6) // First line is message, next 5 are frames
        for (line in lines) {
            // Remove memory addresses and hash codes (they change between runs)
            val cleaned = line.replace(Regex("@[0-9a-fA-F]+"), "")
            input.append(cleaned)
        }
        
        // Create SHA256 hash
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(input.toString().toByteArray())
        
        // Return first 16 chars of hex
        return hash.take(8).joinToString("") { "%02x".format(it) }
    }

    /**
     * Check if there's a pending crash report from previous session.
     */
    fun hasPendingCrashReport(): Boolean {
        return prefs.getBoolean(KEY_HAS_PENDING, false)
    }

    /**
     * Load and purge the pending crash report.
     * Returns the crash report as a map, or null if none exists.
     */
    fun loadAndPurgePendingCrashReport(): Map<String, Any?>? {
        if (!hasPendingCrashReport()) return null

        return try {
            val jsonString = prefs.getString(KEY_CRASH_REPORT, null) ?: return null
            val json = JSONObject(jsonString)
            
            // Clear the pending report
            prefs.edit()
                .remove(KEY_CRASH_REPORT)
                .putBoolean(KEY_HAS_PENDING, false)
                .apply()

            // Convert to map
            json.keys().asSequence().associateWith { key ->
                json.opt(key)
            }
        } catch (e: Exception) {
            Logger.error("Failed to load pending crash report", e)
            prefs.edit().putBoolean(KEY_HAS_PENDING, false).apply()
            null
        }
    }
}
