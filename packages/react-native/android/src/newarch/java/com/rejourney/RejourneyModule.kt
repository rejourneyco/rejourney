/**
 * New Architecture (TurboModules) module wrapper for Rejourney SDK.
 * 
 * This thin wrapper extends the Codegen-generated NativeRejourneySpec for the New Architecture
 * and delegates all method implementations to RejourneyModuleImpl.
 * 
 * This file is compiled when newArchEnabled=true in gradle.properties.
 */
package com.rejourney

import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.facebook.proguard.annotations.DoNotStrip
import com.rejourney.engine.DiagnosticLog

@ReactModule(name = RejourneyModule.NAME)
class RejourneyModule(reactContext: ReactApplicationContext) : 
    NativeRejourneySpec(reactContext) {

    companion object {
        const val NAME = RejourneyModuleImpl.NAME
    }

    private var initError: Throwable? = null

    // Lazy initialization to avoid constructor crashes blocking module creation
    private val impl: RejourneyModuleImpl? by lazy {
        try {
            RejourneyModuleImpl(reactContext, isNewArchitecture = true)
        } catch (e: Throwable) {
            initError = e
            DiagnosticLog.fault("✗ CRITICAL: Failed to create RejourneyModuleImpl: ${e.message}")
            null
        }
    }

    private fun getImplOrReject(promise: Promise): RejourneyModuleImpl? {
        val instance = impl
        if (instance == null) {
            val message = initError?.message ?: "Module initialization failed"
            promise.resolve(createErrorMap(message))
            return null
        }
        return instance
    }

    override fun getName(): String = NAME

   @ReactMethod
   @DoNotStrip
   override fun debugTriggerANR(durationMs: Double) {
          val instance = impl
          if (instance == null) {
                 DiagnosticLog.fault("debugTriggerANR failed: module not initialized")
                 return
          }
          instance.debugTriggerANR(durationMs)
   }

    override fun invalidate() {
          impl?.invalidate()
        super.invalidate()
    }

    @ReactMethod
    @DoNotStrip
    override fun setSDKVersion(version: String) {
        impl?.setSDKVersion(version)
    }

    @ReactMethod
    @DoNotStrip
    override fun startSession(userId: String, apiUrl: String, publicKey: String, promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.startSession(userId, apiUrl, publicKey, promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun stopSession(promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.stopSession(promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun logEvent(eventType: String, details: ReadableMap, promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.logEvent(eventType, details, promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun screenChanged(screenName: String, promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.screenChanged(screenName, promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun onScroll(offsetY: Double, promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.onScroll(offsetY, promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun markVisualChange(reason: String, importance: String, promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.markVisualChange(reason, importance, promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun onExternalURLOpened(urlScheme: String, promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.onExternalURLOpened(urlScheme, promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun onOAuthStarted(provider: String, promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.onOAuthStarted(provider, promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun onOAuthCompleted(provider: String, success: Boolean, promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.onOAuthCompleted(provider, success, promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun getSDKMetrics(promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.getSDKMetrics(promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun getDeviceInfo(promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.getDeviceInfo(promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun debugCrash() {
           val instance = impl
           if (instance == null) {
              DiagnosticLog.fault("debugCrash failed: module not initialized")
              return
           }
           instance.debugCrash()
    }

    @ReactMethod
    @DoNotStrip
    override fun getSessionId(promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.getSessionId(promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun maskViewByNativeID(nativeID: String, promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.maskViewByNativeID(nativeID, promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun unmaskViewByNativeID(nativeID: String, promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.unmaskViewByNativeID(nativeID, promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun setUserIdentity(userId: String, promise: Promise) {
            val instance = getImplOrReject(promise) ?: return
            instance.setUserIdentity(userId, promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun getUserIdentity(promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.getUserIdentity(promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun setAnonymousId(anonymousId: String, promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.setAnonymousId(anonymousId, promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun getAnonymousId(promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.getAnonymousId(promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun setDebugMode(enabled: Boolean, promise: Promise) {
           val instance = getImplOrReject(promise) ?: return
           instance.setDebugMode(enabled, promise)
    }

    @ReactMethod
    @DoNotStrip
    override fun setRemoteConfig(
        rejourneyEnabled: Boolean,
        recordingEnabled: Boolean,
        sampleRate: Double,
        maxRecordingMinutes: Double,
        promise: Promise
    ) {
           val instance = getImplOrReject(promise) ?: return
           instance.setRemoteConfig(rejourneyEnabled, recordingEnabled, sampleRate, maxRecordingMinutes, promise)
    }

        private fun createErrorMap(error: String): WritableMap {
            return Arguments.createMap().apply {
                putBoolean("success", false)
                putString("error", error)
            }
        }

    @ReactMethod
    @DoNotStrip
    fun addListener(eventName: String) {
        try { impl?.addListener(eventName) } catch (_: Exception) {}
    }

    @ReactMethod
    @DoNotStrip
    fun removeListeners(count: Double) {
        try { impl?.removeListeners(count) } catch (_: Exception) {}
    }
}
