/**
 * Old Architecture (Bridge) module wrapper for Rejourney SDK.
 * 
 * This thin wrapper extends ReactContextBaseJavaModule for the Old Architecture
 * and delegates all method implementations to RejourneyModuleImpl.
 * 
 * This file is compiled when newArchEnabled=false in gradle.properties.
 */
package com.rejourney

import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.rejourney.engine.DiagnosticLog

@ReactModule(name = RejourneyModule.NAME)
class RejourneyModule(reactContext: ReactApplicationContext) : 
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = RejourneyModuleImpl.NAME
    }

    // Lazy initialization - create impl only when first method is called
    // This ensures the module constructor completes successfully for React Native
    private val impl: RejourneyModuleImpl by lazy {
        try {
            RejourneyModuleImpl(reactContext, isNewArchitecture = false)
        } catch (e: Throwable) {
            DiagnosticLog.fault("✗ CRITICAL: Failed to create RejourneyModuleImpl: ${e.message}")
            throw e // Re-throw to make the error visible
        }
    }

    override fun getName(): String = NAME

    override fun invalidate() {
        impl?.invalidate()
        super.invalidate()
    }

    @ReactMethod
    fun startSession(userId: String, apiUrl: String, publicKey: String, promise: Promise) {
        try {
            impl.startSession(userId, apiUrl, publicKey, promise)
        } catch (e: Exception) {
            promise.resolve(createErrorMap("Module initialization failed: ${e.message}"))
        }
    }

    @ReactMethod
    fun stopSession(promise: Promise) {
        try {
            impl.stopSession(promise)
        } catch (e: Exception) {
            promise.resolve(createErrorMap("Module initialization failed: ${e.message}"))
        }
    }

    @ReactMethod
    fun logEvent(eventType: String, details: ReadableMap, promise: Promise) {
        try {
            impl.logEvent(eventType, details, promise)
        } catch (e: Exception) {
            promise.resolve(createErrorMap("Module initialization failed: ${e.message}"))
        }
    }

    @ReactMethod
    fun screenChanged(screenName: String, promise: Promise) {
        try {
            impl.screenChanged(screenName, promise)
        } catch (e: Exception) {
            promise.resolve(createErrorMap("Module initialization failed: ${e.message}"))
        }
    }

    @ReactMethod
    fun onScroll(offsetY: Double, promise: Promise) {
        try {
            impl.onScroll(offsetY, promise)
        } catch (e: Exception) {
            promise.resolve(createErrorMap("Module initialization failed: ${e.message}"))
        }
    }

    @ReactMethod
    fun markVisualChange(reason: String, importance: String, promise: Promise) {
        try {
            impl.markVisualChange(reason, importance, promise)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun onExternalURLOpened(urlScheme: String, promise: Promise) {
        try {
            impl.onExternalURLOpened(urlScheme, promise)
        } catch (e: Exception) {
            promise.resolve(createErrorMap("Module initialization failed: ${e.message}"))
        }
    }

    @ReactMethod
    fun onOAuthStarted(provider: String, promise: Promise) {
        try {
            impl.onOAuthStarted(provider, promise)
        } catch (e: Exception) {
            promise.resolve(createErrorMap("Module initialization failed: ${e.message}"))
        }
    }

    @ReactMethod
    fun onOAuthCompleted(provider: String, success: Boolean, promise: Promise) {
        try {
            impl.onOAuthCompleted(provider, success, promise)
        } catch (e: Exception) {
            promise.resolve(createErrorMap("Module initialization failed: ${e.message}"))
        }
    }

    @ReactMethod
    fun getSDKMetrics(promise: Promise) {
        try {
            impl.getSDKMetrics(promise)
        } catch (e: Exception) {
            promise.resolve(Arguments.createMap())
        }
    }

    @ReactMethod
    fun getDeviceInfo(promise: Promise) {
        try {
            impl.getDeviceInfo(promise)
        } catch (e: Exception) {
            promise.resolve(Arguments.createMap())
        }
    }

    @ReactMethod
    fun debugCrash() {
        try {
            impl.debugCrash()
        } catch (e: Exception) {
            Logger.error("debugCrash failed", e)
        }
    }

    @ReactMethod
    fun debugTriggerANR(durationMs: Double) {
        try {
            impl.debugTriggerANR(durationMs)
        } catch (e: Exception) {
            Logger.error("debugTriggerANR failed", e)
        }
    }

    @ReactMethod
    fun getSessionId(promise: Promise) {
        try {
            impl.getSessionId(promise)
        } catch (e: Exception) {
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun maskViewByNativeID(nativeID: String, promise: Promise) {
        try {
            impl.maskViewByNativeID(nativeID, promise)
        } catch (e: Exception) {
            promise.resolve(createErrorMap("Module initialization failed: ${e.message}"))
        }
    }

    @ReactMethod
    fun unmaskViewByNativeID(nativeID: String, promise: Promise) {
        try {
            impl.unmaskViewByNativeID(nativeID, promise)
        } catch (e: Exception) {
            promise.resolve(createErrorMap("Module initialization failed: ${e.message}"))
        }
    }

    @ReactMethod
    fun setUserIdentity(userId: String, promise: Promise) {
        try {
            impl.setUserIdentity(userId, promise)
        } catch (e: Exception) {
            promise.resolve(createErrorMap("Module initialization failed: ${e.message}"))
        }
    }

    @ReactMethod
    fun setDebugMode(enabled: Boolean, promise: Promise) {
        try {
            impl.setDebugMode(enabled, promise)
        } catch (e: Exception) {
            promise.resolve(createErrorMap("Module initialization failed: ${e.message}"))
        }
    }
    
    @ReactMethod
    fun setLogLevel(level: String, promise: Promise) {
        try {
            val logLevel = when (level.uppercase()) {
                "DEBUG" -> com.rejourney.core.LogLevel.DEBUG
                "INFO" -> com.rejourney.core.LogLevel.INFO
                "WARNING" -> com.rejourney.core.LogLevel.WARNING
                "ERROR" -> com.rejourney.core.LogLevel.ERROR
                "SILENT" -> com.rejourney.core.LogLevel.SILENT
                else -> com.rejourney.core.LogLevel.ERROR
            }
            com.rejourney.core.Logger.setLogLevel(logLevel)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }
    
    private fun createErrorMap(error: String): WritableMap {
        return Arguments.createMap().apply {
            putBoolean("success", false)
            putString("error", error)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        try { impl.addListener(eventName) } catch (_: Exception) {}
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        try { impl.removeListeners(count) } catch (_: Exception) {}
    }
}
