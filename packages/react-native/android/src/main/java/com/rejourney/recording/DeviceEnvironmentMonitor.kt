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

import android.annotation.TargetApi
import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.Display
import android.view.View
import java.util.concurrent.Executor
import kotlin.math.roundToInt

/**
 * Session-scoped, permissionless device-quality telemetry.
 *
 * The monitor intentionally has no timer. It samples inexpensive system state
 * at foreground lifecycle boundaries and otherwise listens only to OS change
 * callbacks. Paused/background time is excluded from thermal-duration totals.
 */
internal class DeviceEnvironmentMonitor(private val context: Context) {
    companion object {
        private const val MIB = 1024L * 1024L
        private const val MEMORY_BUCKET_MIB = 128
        private const val MAX_MEMORY_BUCKET_MIB = 8192
    }

    private val lock = Any()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
    private val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
    private val displayManager = context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager

    @Volatile
    private var active = false
    private var receiverRegistered = false
    private var callbacksRegistered = false
    private var thermalListener: Any? = null

    private var sessionObserved = false
    private var batteryObserved = false
    private var lowPowerModeSampled = false
    private var thermalObserved = false
    private var memoryObserved = false
    private var uiEnvironmentObserved = false

    private var currentBattery: Map<String, Any> = emptyMap()
    private var batteryLevelStart: Int? = null
    private var batteryLevelEnd: Int? = null
    private var batteryPowerClassStart: String? = null
    private var batteryStateStart: String? = null
    private var batteryStateEnd: String? = null
    private var chargingStateChanged = false
    private var lowPowerModeObserved = false

    private var thermalStateStart: String? = null
    private var thermalStatePeak: String? = null
    private var thermalStateEnd: String? = null
    private var thermalThrottledDurationMs = 0L
    private var thermalThrottledSinceMs: Long? = null

    private var memoryPressureCurrent = "normal"
    private var memoryPressurePeak = "normal"
    private var memoryPressureEventCount = 0
    private var memoryHeadroomStart: Int? = null
    private var memoryHeadroomMin: Int? = null
    private var memoryHeadroomEnd: Int? = null

    private var fontScaleBucket: String? = null
    private var uiStyle: String? = null
    private var layoutDirection: String? = null
    private var orientationStart: String? = null
    private var orientationEnd: String? = null
    private var lastOrientation: String? = null
    private var orientationChangeCount = 0
    private var displayMaxRefreshRateHz: Int? = null

    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(receiverContext: Context?, intent: Intent?) {
            if (!active || intent == null) return
            when (intent.action) {
                Intent.ACTION_BATTERY_CHANGED -> updateBattery(readBattery(intent))
                PowerManager.ACTION_POWER_SAVE_MODE_CHANGED -> {
                    val snapshot = synchronized(lock) { currentBattery.toMutableMap() }
                    powerManager?.let { snapshot["lowPowerModeEnabled"] = it.isPowerSaveMode }
                    updateBattery(snapshot)
                }
            }
        }
    }

    // Retained for pre-Android 14 low-memory delivery. Newer Android releases
    // limit these callbacks, so boundary MemoryInfo.lowMemory/headroom remains
    // the primary signal there.
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    private val componentCallbacks = object : ComponentCallbacks2 {
        override fun onConfigurationChanged(newConfig: Configuration) {
            if (!active) return
            updateUiEnvironment(readUiEnvironment(newConfig), countOrientationChange = true)
        }

        override fun onLowMemory() {
            if (!active) return
            updateMemoryPressure("critical")
        }

        override fun onTrimMemory(level: Int) {
            if (!active) return
            // UI_HIDDEN/BACKGROUND indicate lifecycle priority, not memory
            // pressure. Treating all numerically larger levels as critical
            // would falsely label every background transition as a crisis.
            val pressure = when (level) {
                ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL,
                ComponentCallbacks2.TRIM_MEMORY_COMPLETE -> "critical"
                ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE,
                ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW,
                ComponentCallbacks2.TRIM_MEMORY_MODERATE -> "warning"
                else -> return
            }
            updateMemoryPressure(pressure)
        }
    }

    fun start(resetSession: Boolean) {
        if (resetSession) resetSessionState()
        val alreadyActive = synchronized(lock) {
            sessionObserved = true
            val wasActive = active
            active = true
            wasActive
        }

        sampleBoundary(countOrientationChange = false)
        synchronized(lock) {
            val state = thermalStateEnd
            if (state != null && isMateriallyThrottled(state)) {
                thermalThrottledSinceMs = SystemClock.elapsedRealtime()
            }
        }
        if (alreadyActive) return

        runOnMain {
            if (!active) return@runOnMain
            if (!receiverRegistered) {
                val filter = IntentFilter().apply {
                    addAction(Intent.ACTION_BATTERY_CHANGED)
                    addAction(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)
                }
                var registered = false
                val sticky = try {
                    if (Build.VERSION.SDK_INT >= 33) {
                        context.registerReceiver(batteryReceiver, filter, Context.RECEIVER_NOT_EXPORTED).also {
                            registered = true
                        }
                    } else {
                        @Suppress("DEPRECATION")
                        context.registerReceiver(batteryReceiver, filter).also {
                            registered = true
                        }
                    }
                } catch (_: Exception) {
                    null
                }
                receiverRegistered = registered
                if (sticky != null) updateBattery(readBattery(sticky))
            }
            if (!callbacksRegistered) {
                try {
                    @Suppress("DEPRECATION")
                    context.registerComponentCallbacks(componentCallbacks)
                    callbacksRegistered = true
                } catch (_: Exception) {
                    callbacksRegistered = false
                }
            }
            if (Build.VERSION.SDK_INT >= 29 && thermalListener == null) {
                registerThermalListenerApi29()
            }
        }
    }

    /** Drop cached values when a new session has device collection disabled. */
    fun clearSession() {
        pause()
        resetSessionState()
    }

    fun pause() {
        if (!active) return
        sampleBoundary(countOrientationChange = false)
        synchronized(lock) {
            accumulateThermalDurationLocked(SystemClock.elapsedRealtime())
            thermalThrottledSinceMs = null
        }
        active = false

        runOnMain {
            if (receiverRegistered) {
                try { context.unregisterReceiver(batteryReceiver) } catch (_: Exception) { }
                receiverRegistered = false
            }
            if (callbacksRegistered) {
                @Suppress("DEPRECATION")
                context.unregisterComponentCallbacks(componentCallbacks)
                callbacksRegistered = false
            }
            if (Build.VERSION.SDK_INT >= 29 && thermalListener != null) {
                unregisterThermalListenerApi29()
            }
        }
    }

    /** Current low-cardinality values for ordinary deviceInfo envelopes. */
    fun currentSnapshot(): Map<String, Any> {
        synchronized(lock) {
            if (!sessionObserved) return emptyMap()
            val result = linkedMapOf<String, Any>()
            result.putAll(currentBattery)
            thermalStateEnd?.let { result["thermalState"] = it }
            if (memoryObserved) result["memoryPressure"] = memoryPressureCurrent
            memoryHeadroomEnd?.let { result["memoryHeadroomMbBucket"] = it }
            fontScaleBucket?.let { result["fontScaleBucket"] = it }
            uiStyle?.let { result["uiStyle"] = it }
            layoutDirection?.let { result["layoutDirection"] = it }
            orientationEnd?.let { result["orientation"] = it }
            displayMaxRefreshRateHz?.let { result["displayMaxRefreshRateHz"] = it }
            return result
        }
    }

    /** Compatibility accessor used by public getDeviceInfo bridges. */
    fun currentBatterySnapshot(): Map<String, Any> {
        if (!active) return readBattery(readStickyBatteryIntent())
        return synchronized(lock) { currentBattery.toMap() }
    }

    /** Final session summary, sampled only at the explicit finalization boundary. */
    fun sessionSummary(): Map<String, Any> {
        if (synchronized(lock) { !sessionObserved }) return emptyMap()
        if (active) sampleBoundary(countOrientationChange = false)
        synchronized(lock) {
            if (active) {
                accumulateThermalDurationLocked(SystemClock.elapsedRealtime())
                if (thermalStateEnd?.let(::isMateriallyThrottled) == true) {
                    thermalThrottledSinceMs = SystemClock.elapsedRealtime()
                }
            }

            val result = linkedMapOf<String, Any>()
            thermalStateStart?.let { result["thermalStateStart"] = it }
            thermalStatePeak?.let { result["thermalStatePeak"] = it }
            thermalStateEnd?.let { result["thermalStateEnd"] = it }
            if (thermalObserved) {
                result["thermalThrottledDurationMs"] = thermalThrottledDurationMs.coerceAtLeast(0L)
            }
            if (memoryObserved) {
                result["memoryPressurePeak"] = memoryPressurePeak
                result["memoryPressureEventCount"] = memoryPressureEventCount.coerceAtLeast(0)
            }
            memoryHeadroomStart?.let { result["memoryHeadroomMbBucketStart"] = it }
            memoryHeadroomMin?.let { result["memoryHeadroomMbBucketMin"] = it }
            memoryHeadroomEnd?.let { result["memoryHeadroomMbBucketEnd"] = it }
            fontScaleBucket?.let { result["fontScaleBucket"] = it }
            uiStyle?.let { result["uiStyle"] = it }
            layoutDirection?.let { result["layoutDirection"] = it }
            orientationStart?.let { result["orientationStart"] = it }
            orientationEnd?.let { result["orientationEnd"] = it }
            if (uiEnvironmentObserved) {
                result["orientationChangeCount"] = orientationChangeCount.coerceAtLeast(0)
            }
            displayMaxRefreshRateHz?.let { result["displayMaxRefreshRateHz"] = it }
            batteryLevelStart?.let { result["batteryLevelStartPercent"] = it }
            batteryLevelEnd?.let { result["batteryLevelEndPercent"] = it }
            if (batteryLevelStart != null && batteryLevelEnd != null) {
                result["batteryDeltaPercent"] = batteryLevelEnd!! - batteryLevelStart!!
            }
            batteryStateStart?.let { result["batteryStateStart"] = it }
            batteryStateEnd?.let { result["batteryStateEnd"] = it }
            if (batteryObserved) result["chargingStateChanged"] = chargingStateChanged
            if (lowPowerModeSampled) result["lowPowerModeObserved"] = lowPowerModeObserved
            return result
        }
    }

    private fun resetSessionState() {
        synchronized(lock) {
            sessionObserved = false
            batteryObserved = false
            lowPowerModeSampled = false
            thermalObserved = false
            memoryObserved = false
            uiEnvironmentObserved = false
            currentBattery = emptyMap()
            batteryLevelStart = null
            batteryLevelEnd = null
            batteryPowerClassStart = null
            batteryStateStart = null
            batteryStateEnd = null
            chargingStateChanged = false
            lowPowerModeObserved = false
            thermalStateStart = null
            thermalStatePeak = null
            thermalStateEnd = null
            thermalThrottledDurationMs = 0
            thermalThrottledSinceMs = null
            memoryPressurePeak = "normal"
            memoryPressureCurrent = "normal"
            memoryPressureEventCount = 0
            memoryHeadroomStart = null
            memoryHeadroomMin = null
            memoryHeadroomEnd = null
            fontScaleBucket = null
            uiStyle = null
            layoutDirection = null
            orientationStart = null
            orientationEnd = null
            lastOrientation = null
            orientationChangeCount = 0
            displayMaxRefreshRateHz = null
        }
    }

    private fun sampleBoundary(countOrientationChange: Boolean) {
        updateBattery(readBattery(readStickyBatteryIntent()))
        updateThermal(readThermalState())
        updateMemoryHeadroom(readMemoryHeadroom())
        updateUiEnvironment(readUiEnvironment(context.resources.configuration), countOrientationChange)
    }

    private fun readStickyBatteryIntent(): Intent? {
        return try { context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) } catch (_: Exception) { null }
    }

    private fun readBattery(intent: Intent?): Map<String, Any> {
        val snapshot = linkedMapOf<String, Any>()
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        if (level >= 0 && scale > 0 && level <= scale) {
            snapshot["batteryLevelPercent"] = ((level * 100.0) / scale).roundToInt().coerceIn(0, 100)
        }
        val plugged = intent?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
        snapshot["batteryState"] = when (
            intent?.getIntExtra(BatteryManager.EXTRA_STATUS, BatteryManager.BATTERY_STATUS_UNKNOWN)
        ) {
            BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
            BatteryManager.BATTERY_STATUS_FULL -> "full"
            BatteryManager.BATTERY_STATUS_DISCHARGING,
            BatteryManager.BATTERY_STATUS_NOT_CHARGING -> if (plugged == 0) "unplugged" else "unknown"
            else -> "unknown"
        }
        powerManager?.let { snapshot["lowPowerModeEnabled"] = it.isPowerSaveMode }
        return snapshot
    }

    private fun updateBattery(snapshot: Map<String, Any>) {
        if (snapshot.isEmpty()) return
        synchronized(lock) {
            currentBattery = snapshot.toMap()
            val level = (snapshot["batteryLevelPercent"] as? Number)?.toInt()?.coerceIn(0, 100)
            if (level != null) {
                batteryObserved = true
                if (batteryLevelStart == null) batteryLevelStart = level
                batteryLevelEnd = level
            }
            val state = snapshot["batteryState"] as? String
            if (state != null) {
                if (state != "unknown") batteryObserved = true
                if (batteryStateStart == null) batteryStateStart = state
                batteryStateEnd = state
                val powerClass = when (state) {
                    "charging", "full" -> "plugged"
                    "unplugged" -> "unplugged"
                    else -> null
                }
                if (batteryPowerClassStart == null && powerClass != null) batteryPowerClassStart = powerClass
                if (powerClass != null && batteryPowerClassStart != null && powerClass != batteryPowerClassStart) {
                    chargingStateChanged = true
                }
            }
            if (snapshot["lowPowerModeEnabled"] is Boolean) lowPowerModeSampled = true
            if (snapshot["lowPowerModeEnabled"] == true) lowPowerModeObserved = true
        }
    }

    private fun readThermalState(): String? {
        if (Build.VERSION.SDK_INT < 29) return null
        return thermalStateName(powerManager?.currentThermalStatus ?: return null)
    }

    private fun updateThermal(state: String?) {
        if (state == null) return
        synchronized(lock) {
            thermalObserved = true
            val now = SystemClock.elapsedRealtime()
            accumulateThermalDurationLocked(now)
            if (thermalStateStart == null) thermalStateStart = state
            thermalStateEnd = state
            if (thermalStatePeak == null || thermalRank(state) > thermalRank(thermalStatePeak!!)) {
                thermalStatePeak = state
            }
            thermalThrottledSinceMs = if (active && isMateriallyThrottled(state)) now else null
        }
    }

    private fun accumulateThermalDurationLocked(now: Long) {
        val started = thermalThrottledSinceMs ?: return
        thermalThrottledDurationMs += (now - started).coerceAtLeast(0L)
    }

    private fun updateMemoryPressure(pressure: String) {
        synchronized(lock) {
            memoryObserved = true
            memoryPressureCurrent = pressure
            if (pressure != "normal") memoryPressureEventCount += 1
            if (memoryPressureRank(pressure) > memoryPressureRank(memoryPressurePeak)) {
                memoryPressurePeak = pressure
            }
        }
        updateMemoryHeadroom(readMemoryHeadroom())
    }

    private fun readMemoryHeadroom(): Pair<Int?, Boolean> {
        val info = ActivityManager.MemoryInfo()
        return try {
            activityManager?.getMemoryInfo(info)
            bucketMemoryBytes(info.availMem) to info.lowMemory
        } catch (_: Exception) {
            null to false
        }
    }

    private fun updateMemoryHeadroom(sample: Pair<Int?, Boolean>) {
        val (bucket, lowMemory) = sample
        synchronized(lock) {
            if (bucket != null || lowMemory) memoryObserved = true
            if (lowMemory && memoryPressureRank("warning") > memoryPressureRank(memoryPressurePeak)) {
                memoryPressurePeak = "warning"
            }
            if (bucket != null) {
                if (memoryHeadroomStart == null) memoryHeadroomStart = bucket
                memoryHeadroomEnd = bucket
                memoryHeadroomMin = memoryHeadroomMin?.let { minOf(it, bucket) } ?: bucket
            }
        }
    }

    private data class UiEnvironment(
        val fontScaleBucket: String,
        val uiStyle: String,
        val layoutDirection: String,
        val orientation: String,
        val maxRefreshRateHz: Int?
    )

    private fun readUiEnvironment(configuration: Configuration): UiEnvironment {
        val fontBucket = when {
            configuration.fontScale < 0.90f -> "compact"
            configuration.fontScale <= 1.10f -> "standard"
            configuration.fontScale < 1.30f -> "large"
            else -> "accessibility"
        }
        val style = when (configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) {
            Configuration.UI_MODE_NIGHT_YES -> "dark"
            Configuration.UI_MODE_NIGHT_NO -> "light"
            else -> "unspecified"
        }
        val direction = if (configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL) "rtl" else "ltr"
        val orientation = when (configuration.orientation) {
            Configuration.ORIENTATION_PORTRAIT -> "portrait"
            Configuration.ORIENTATION_LANDSCAPE -> "landscape"
            else -> "unknown"
        }
        return UiEnvironment(fontBucket, style, direction, orientation, readMaxRefreshRateHz())
    }

    private fun updateUiEnvironment(sample: UiEnvironment, countOrientationChange: Boolean) {
        synchronized(lock) {
            uiEnvironmentObserved = true
            fontScaleBucket = sample.fontScaleBucket
            uiStyle = sample.uiStyle
            layoutDirection = sample.layoutDirection
            if (orientationStart == null) orientationStart = sample.orientation
            if (countOrientationChange && lastOrientation != null &&
                lastOrientation != "unknown" && sample.orientation != "unknown" &&
                lastOrientation != sample.orientation
            ) {
                orientationChangeCount += 1
            }
            lastOrientation = sample.orientation
            orientationEnd = sample.orientation
            sample.maxRefreshRateHz?.let { displayMaxRefreshRateHz = it }
        }
    }

    private fun readMaxRefreshRateHz(): Int? {
        val display = displayManager?.getDisplay(Display.DEFAULT_DISPLAY) ?: return null
        val maxRate = if (Build.VERSION.SDK_INT >= 23) {
            display.supportedModes.maxOfOrNull { it.refreshRate } ?: display.refreshRate
        } else {
            @Suppress("DEPRECATION")
            display.refreshRate
        }
        return maxRate.takeIf { it.isFinite() && it > 0f }?.roundToInt()
    }

    private fun bucketMemoryBytes(bytes: Long): Int? {
        if (bytes <= 0) return null
        val mib = bytes / MIB
        return ((mib / MEMORY_BUCKET_MIB) * MEMORY_BUCKET_MIB)
            .coerceAtMost(MAX_MEMORY_BUCKET_MIB.toLong())
            .toInt()
    }

    @TargetApi(29)
    private fun registerThermalListenerApi29() {
        val manager = powerManager ?: return
        val listener = PowerManager.OnThermalStatusChangedListener { status ->
            if (active) updateThermal(thermalStateName(status))
        }
        try {
            manager.addThermalStatusListener(Executor { command -> command.run() }, listener)
            thermalListener = listener
        } catch (_: Exception) {
            thermalListener = null
        }
    }

    @TargetApi(29)
    private fun unregisterThermalListenerApi29() {
        val listener = thermalListener as? PowerManager.OnThermalStatusChangedListener
        if (listener != null) {
            try { powerManager?.removeThermalStatusListener(listener) } catch (_: Exception) { }
        }
        thermalListener = null
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
    }

    private fun thermalStateName(status: Int): String = when {
        status <= PowerManager.THERMAL_STATUS_NONE -> "nominal"
        status <= PowerManager.THERMAL_STATUS_MODERATE -> "fair"
        status == PowerManager.THERMAL_STATUS_SEVERE -> "serious"
        else -> "critical"
    }

    private fun thermalRank(state: String): Int = when (state) {
        "nominal" -> 0
        "fair" -> 1
        "serious" -> 2
        "critical" -> 3
        else -> -1
    }

    private fun isMateriallyThrottled(state: String): Boolean = thermalRank(state) >= 2

    private fun memoryPressureRank(state: String): Int = when (state) {
        "normal" -> 0
        "warning" -> 1
        "critical" -> 2
        else -> -1
    }
}
