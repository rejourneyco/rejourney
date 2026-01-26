package com.rejourney.core

import android.util.Log
import com.rejourney.BuildConfig

enum class LogLevel(val priority: Int) {
    DEBUG(0),
    INFO(1),
    WARNING(2),
    ERROR(3),
    SILENT(4)
}

object Logger {
    private const val TAG = "Rejourney"
    private var debugMode = false

    var minimumLogLevel: LogLevel = if (BuildConfig.DEBUG) LogLevel.ERROR else LogLevel.SILENT
        private set

    fun setLogLevel(level: LogLevel) {
        minimumLogLevel = level
    }

    fun setDebugMode(enabled: Boolean) {
        debugMode = enabled
        minimumLogLevel = if (enabled) {
            LogLevel.DEBUG
        } else if (BuildConfig.DEBUG) {
            LogLevel.ERROR
        } else {
            LogLevel.SILENT
        }
    }

    fun debug(message: String) {
        if (minimumLogLevel.priority <= LogLevel.DEBUG.priority) {
            Log.d(TAG, message)
        }
    }

    fun info(message: String) {
        if (minimumLogLevel.priority <= LogLevel.INFO.priority) {
            Log.i(TAG, message)
        }
    }

    fun warning(message: String) {
        if (minimumLogLevel.priority <= LogLevel.WARNING.priority) {
            Log.w(TAG, message)
        }
    }

    fun error(message: String, throwable: Throwable? = null) {
        if (minimumLogLevel.priority <= LogLevel.ERROR.priority) {
            if (throwable != null) {
                Log.e(TAG, message, throwable)
            } else {
                Log.e(TAG, message)
            }
        }
    }
    
    fun logInitSuccess(version: String) {
        if (debugMode) {
            info("✓ SDK initialized (v$version)")
        }
    }

    fun logInitFailure(reason: String) {
        error("✗ Initialization failed: $reason")
    }

    fun logSessionStart(sessionId: String) {
        if (debugMode) {
            info("Session started: $sessionId")
        }
    }

    fun logSessionEnd(sessionId: String) {
        if (debugMode) {
            info("Session ended: $sessionId")
        }
    }

    fun logArchitectureInfo(isNewArch: Boolean, architectureType: String) {
        if (minimumLogLevel.priority <= LogLevel.DEBUG.priority) {
            debug("React Native Architecture: $architectureType")
            debug("New Architecture Enabled: ${if (isNewArch) "YES" else "NO"}")
            debug("Rejourney SDK Version: ${Constants.SDK_VERSION}")
        }
    }
}
