package co.rejourney.rejourney

import android.app.Activity
import android.os.Handler
import android.os.Looper
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

class RejourneyPlugin :
    FlutterPlugin,
    MethodChannel.MethodCallHandler,
    ActivityAware {
    private lateinit var channel: MethodChannel
    private var controller: RejourneyNativeController? = null
    private var activity: Activity? = null

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel = MethodChannel(binding.binaryMessenger, CHANNEL_NAME)
        controller = RejourneyNativeController(binding.applicationContext) { event, arguments ->
            Handler(Looper.getMainLooper()).post {
                channel.invokeMethod(event, arguments)
            }
        }
        channel.setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        val native = controller ?: run {
            result.error("not_attached", "Rejourney plugin is not attached", null)
            return
        }
        val arguments = call.argumentMap()

        when (call.method) {
            "configure" -> {
                native.configure(arguments)
                native.setActivity(activity)
                result.success(null)
            }
            "start" -> native.start(result::success)
            "stop" -> native.stop(result::success)
            "getSessionId" -> result.success(native.currentSessionId())
            "setUserIdentity" -> {
                native.setUserIdentity(arguments.string("userId"))
                result.success(null)
            }
            "clearUserIdentity" -> {
                native.clearUserIdentity()
                result.success(null)
            }
            "logEvent" -> {
                native.logEvent(
                    arguments.string("name"),
                    arguments.nestedMap("properties")
                )
                result.success(null)
            }
            "setMetadata" -> {
                native.setMetadata(arguments.nestedMap("metadata"))
                result.success(null)
            }
            "trackScreen" -> {
                native.trackScreen(arguments.string("screenName"))
                result.success(null)
            }
            "markVisualChange" -> result.success(
                native.markVisualChange(arguments.string("importance", "medium"))
            )
            "onScroll" -> {
                native.onScroll()
                result.success(null)
            }
            "onOAuthStarted" -> {
                native.logEvent("oauth_started", mapOf("provider" to arguments.string("provider")))
                result.success(true)
            }
            "onOAuthCompleted" -> {
                native.logEvent(
                    "oauth_completed",
                    mapOf(
                        "provider" to arguments.string("provider"),
                        "success" to arguments.bool("success", false)
                    )
                )
                result.success(true)
            }
            "onExternalUrlOpened" -> {
                native.logEvent(
                    "external_url_opened",
                    mapOf("scheme" to arguments.string("urlScheme"))
                )
                result.success(true)
            }
            "getSdkMetrics" -> result.success(native.sdkMetrics())
            "updateMaskRegion" -> {
                native.updateMaskRegion(
                    arguments.string("id"),
                    arguments.double("left"),
                    arguments.double("top"),
                    arguments.double("width"),
                    arguments.double("height")
                )
                result.success(null)
            }
            "removeMaskRegion" -> {
                native.removeMaskRegion(arguments.string("id"))
                result.success(null)
            }
            "debugCrash" -> {
                if (BuildConfig.DEBUG) {
                    throw RuntimeException("Rejourney Flutter debug crash triggered")
                }
                result.error("debug_only", "debugCrash is available only in debug builds", null)
            }
            "debugTriggerAnr" -> {
                if (BuildConfig.DEBUG) {
                    Thread.sleep(arguments.double("durationMs").toLong().coerceAtLeast(0))
                    result.success(null)
                } else {
                    result.error("debug_only", "debugTriggerAnr is available only in debug builds", null)
                }
            }
            else -> result.notImplemented()
        }
    }

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activity = binding.activity
        controller?.setActivity(activity)
    }

    override fun onDetachedFromActivityForConfigChanges() {
        activity = null
        controller?.setActivity(null)
    }

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        onAttachedToActivity(binding)
    }

    override fun onDetachedFromActivity() {
        activity = null
        controller?.setActivity(null)
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel.setMethodCallHandler(null)
        controller?.destroy()
        controller = null
    }

    private companion object {
        const val CHANNEL_NAME = "co.rejourney.flutter/methods"
    }
}

private fun MethodCall.argumentMap(): Map<String, Any?> {
    val raw = arguments as? Map<*, *> ?: return emptyMap()
    return raw.entries.associate { (key, value) -> key.toString() to value }
}

private fun Map<String, Any?>.string(key: String, default: String = ""): String {
    return this[key] as? String ?: default
}

private fun Map<String, Any?>.bool(key: String, default: Boolean): Boolean {
    return this[key] as? Boolean ?: default
}

private fun Map<String, Any?>.double(key: String): Double {
    return (this[key] as? Number)?.toDouble() ?: 0.0
}

private fun Map<String, Any?>.nestedMap(key: String): Map<String, Any?> {
    val raw = this[key] as? Map<*, *> ?: return emptyMap()
    return raw.entries.associate { (nestedKey, value) -> nestedKey.toString() to value }
}
