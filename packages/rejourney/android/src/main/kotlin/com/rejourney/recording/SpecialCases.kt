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

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import com.rejourney.engine.DiagnosticLog
import java.lang.ref.WeakReference

/**
 * Detected map SDK type on Android.
 */
enum class MapSDKType {
    GOOGLE_MAPS,   // com.google.android.gms.maps.MapView / SupportMapFragment
    MAPBOX         // com.mapbox.maps.MapView (v10+) / com.mapbox.mapboxsdk.maps.MapView (v9)
}

/**
 * Centralised map-view detection and idle-state management for Android.
 *
 * All map class name checks and SDK-specific idle hooks live here so the
 * rest of the recording pipeline only calls into this module.
 *
 * Safety: every reflective call is wrapped in try/catch.  We never throw,
 * never crash the host app.  If any hook fails we fall back to
 * [mapIdle] = true so capture is never permanently blocked.
 */
class SpecialCases private constructor() {

    companion object {
        @JvmStatic
        val shared = SpecialCases()

        // Expo Router + React Navigation nests navigators 3+ levels deep,
        // each adding ~8 depth levels.  The deepest screen content can be
        // at depth 25+ before the actual map view.  40 handles any
        // reasonable nesting.  The walk is cheap (~200 views) at 1 Hz.
        private const val MAX_SCAN_DEPTH = 40

        // Fully-qualified class names we look for
        private val GOOGLE_MAP_VIEW_CLASSES = setOf(
            "com.google.android.gms.maps.MapView",
            "com.google.android.gms.maps.SupportMapFragment"
        )
        private val MAPBOX_V10_CLASS = "com.mapbox.maps.MapView"
        private val MAPBOX_V9_CLASS = "com.mapbox.mapboxsdk.maps.MapView"

        // @rnmapbox/maps React Native wrapper (FrameLayout, not a MapView subclass)
        private val RNMBX_MAPVIEW_CLASS = "com.rnmapbox.rnmbx.components.mapview.RNMBXMapView"

        // Touch-based idle debounce delay (ms).
        // Mapbox uses UIScrollView.DecelerationRate.normal (0.998/ms).
        // At 2s after a 500pt/s flick, residual velocity is ~9pt/s (barely visible).
        private const val TOUCH_DEBOUNCE_MS = 2000L
        private const val CAMERA_SETTLE_SAMPLE_MS = 500L
    }

    // -- Public state --------------------------------------------------------

    /** True when the current activity's decor view contains a known map view. */
    @Volatile
    var mapVisible: Boolean = false
        private set

    /** True when the map camera has settled (no gesture, no animation).
     *  Defaults to true so if hooking fails capture is never blocked. */
    @Volatile
    var mapIdle: Boolean = true
        private set

    /** Set mapIdle and trigger an immediate frame capture on idle transition. */
    private fun setMapIdle(idle: Boolean) {
        val wasIdle = mapIdle
        mapIdle = idle
        if (!idle && wasIdle) MapboxSnapshotCache.invalidate()
        DiagnosticLog.trace("[SpecialCases] mapIdle=$idle (was $wasIdle)")
        if (idle && !wasIdle) {
            // Map just settled — capture a frame immediately instead of
            // waiting up to 1s for the next timer tick.
            try { VisualCapture.shared?.snapshotNow() } catch (_: Exception) {}
        }
    }

    /** The detected SDK, or null if no map is present. */
    @Volatile
    var detectedSDK: MapSDKType? = null
        private set

    // -- Internals -----------------------------------------------------------

    private val mainHandler = Handler(Looper.getMainLooper())
    private var hookedMapView: WeakReference<View>? = null
    private var mapController: WeakReference<Any>? = null
    private var lastCameraSignature: String? = null
    private var cameraSettleRunnable: Runnable? = null

    /** When true, idle detection is driven by touch events from
     *  InteractionRecorder rather than SDK listener hooks.
     *  Used as a fallback when reflection-based hooking fails. */
    @Volatile
    private var usesTouchBasedIdle = false

    /** Runnable posted with TOUCH_DEBOUNCE_MS delay for touch-based idle. */
    private var touchDebounceRunnable: Runnable? = null
    private var activeMapTouch = false

    // -- Map detection (shallow walk) ----------------------------------------

    /**
     * Scan the activity's decor view for a supported map view.
     * Call from the capture timer (~1 Hz, main thread).
     */
    fun refreshMapState(activity: Activity?) {
        if (activity == null) {
            clearMapState()
            return
        }
        val decorView = try { activity.window?.decorView } catch (_: Exception) { null }
        if (decorView == null) {
            clearMapState()
            return
        }
        refreshMapState(decorView)
    }

    fun refreshMapState(root: View) {
        val result = findMapView(root, depth = 0)
        if (result != null) {
            val (mapView, sdk) = result
            val wasVisible = mapVisible
            mapVisible = true
            detectedSDK = sdk

            // Only hook once per map view instance
            val prev = hookedMapView?.get()
            if (prev == null || prev !== mapView) {
                clearControllerState()
                hookedMapView = WeakReference(mapView)
                hookIdleCallbacks(mapView, sdk)
            } else {
                sampleCameraMotion()
            }

            if (!wasVisible) {
                // Capture an initial frame the moment we detect the map so
                // the replay always has a starting frame of the map screen.
                try { VisualCapture.shared?.snapshotNow() } catch (_: Exception) {}
            }
        } else {
            clearMapState()
        }
    }

    // -- Hierarchy search ----------------------------------------------------

    private fun findMapView(view: View, depth: Int): Pair<View, MapSDKType>? {
        if (depth >= MAX_SCAN_DEPTH) return null

        // Walk the entire class inheritance chain — react-native-maps uses
        // AirMapView (subclass of com.google.android.gms.maps.MapView) and
        // similar wrappers for Mapbox.  Checking only the runtime class misses these.
        val sdk = classifyByInheritance(view)
        if (sdk != null) {
            return Pair(view, sdk)
        }

        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                try {
                    val child = view.getChildAt(i) ?: continue
                    val found = findMapView(child, depth + 1)
                    if (found != null) return found
                } catch (_: Exception) {
                    // ViewGroup.getChildAt may throw in rare concurrent-modification scenarios
                }
            }
        }
        return null
    }

    /**
     * Walk the superclass chain and return the map SDK type if any
     * ancestor is a known map base class.
     */
    private fun classifyByInheritance(view: View): MapSDKType? {
        var cls: Class<*>? = view.javaClass
        while (cls != null && cls != View::class.java && cls != Any::class.java) {
            val name = cls.name
            if (name in GOOGLE_MAP_VIEW_CLASSES) return MapSDKType.GOOGLE_MAPS
            if (name == MAPBOX_V10_CLASS) return MapSDKType.MAPBOX
            if (name == MAPBOX_V9_CLASS) return MapSDKType.MAPBOX
            // @rnmapbox/maps wrapper (FrameLayout subclass, not a MapView subclass)
            if (name == RNMBX_MAPVIEW_CLASS) return MapSDKType.MAPBOX
            cls = cls.superclass
        }
        return null
    }

    // -- Idle hooks ----------------------------------------------------------

    private fun hookIdleCallbacks(mapView: View, sdk: MapSDKType) {
        // Reset to safe default before attempting hook
        mapIdle = true

        when (sdk) {
            MapSDKType.GOOGLE_MAPS -> hookGoogleMaps(mapView)
            MapSDKType.MAPBOX -> hookMapbox(mapView)
        }
    }

    // ---- Google Maps -------------------------------------------------------
    // GoogleMap exposes only setter-style camera callbacks. Taking ownership
    // of those would replace the host application's listeners, so Rejourney
    // observes camera position non-invasively and combines that with touch
    // state instead.

    private fun hookGoogleMaps(mapView: View) {
        try {
            // MapView.getMapAsync(OnMapReadyCallback) gives us the GoogleMap instance
            val getMapAsync = mapView.javaClass.getMethod(
                "getMapAsync",
                Class.forName("com.google.android.gms.maps.OnMapReadyCallback")
            )

            // Create an OnMapReadyCallback via a dynamic proxy
            val callbackClass = Class.forName("com.google.android.gms.maps.OnMapReadyCallback")
            val proxy = java.lang.reflect.Proxy.newProxyInstance(
                mapView.javaClass.classLoader,
                arrayOf(callbackClass)
            ) { _, method, args ->
                if (method.name == "onMapReady" && args != null && args.isNotEmpty()) {
                    val googleMap = args[0] ?: return@newProxyInstance null
                    mapController = WeakReference(googleMap)
                    lastCameraSignature = cameraSignature(googleMap, MapSDKType.GOOGLE_MAPS)
                    usesTouchBasedIdle = true
                }
                null
            }
            getMapAsync.invoke(mapView, proxy)
            DiagnosticLog.trace("[SpecialCases] Google Maps getMapAsync invoked")
        } catch (e: Exception) {
            DiagnosticLog.trace("[SpecialCases] Google Maps hook failed: ${e.message}")
            // Leave mapIdle = true so capture is never blocked
        }
    }

    // ---- Mapbox ------------------------------------------------------------
    // v10+: MapboxMap.subscribeMapIdle / subscribeCameraChanged
    // v9:   MapboxMap.addOnMapIdleListener / addOnCameraMoveStartedListener

    private fun hookMapbox(mapView: View) {
        // The detected view might be the RNMBXMapView wrapper (FrameLayout),
        // not the actual com.mapbox.maps.MapView.  Find the real MapView child.
        val actualMapView = findActualMapboxMapView(mapView) ?: mapView

        // Mapbox subscriptions retain their observer and return cancellation
        // handles. Reflection makes version-correct ownership brittle, so use
        // the same non-invasive camera-state sampling as Google Maps.
        usesTouchBasedIdle = true
        try {
            val getMapboxMap = actualMapView.javaClass.getMethod("getMapboxMap")
            val controller = getMapboxMap.invoke(actualMapView)
            if (controller != null) {
                mapController = WeakReference(controller)
                lastCameraSignature = cameraSignature(controller, MapSDKType.MAPBOX)
            }
        } catch (_: Exception) {
            // Mapbox v9 exposes its controller asynchronously. Keep the
            // callback read-only: it stores the controller for sampling and
            // never installs camera listeners on the host object.
            try {
                val callbackClass = Class.forName("com.mapbox.mapboxsdk.maps.OnMapReadyCallback")
                val getMapAsync = actualMapView.javaClass.getMethod("getMapAsync", callbackClass)
                val proxy = java.lang.reflect.Proxy.newProxyInstance(
                    actualMapView.javaClass.classLoader,
                    arrayOf(callbackClass)
                ) { _, method, args ->
                    if (method.name == "onMapReady" && !args.isNullOrEmpty()) {
                        args[0]?.let { controller ->
                            mapController = WeakReference(controller)
                            lastCameraSignature = cameraSignature(controller, MapSDKType.MAPBOX)
                        }
                    }
                    null
                }
                getMapAsync.invoke(actualMapView, proxy)
            } catch (_: Exception) {
                // Wrapper variants still retain touch-based idle handling.
            }
        }
        DiagnosticLog.trace("[SpecialCases] Mapbox: using non-invasive camera sampling")
    }

    /**
     * Returns the actual Mapbox MapView for snapshot capture, or null.
     * Used by VisualCapture to call MapView.snapshot() and composite the result
     * (decorView.draw() renders SurfaceView as black).
     */
    fun getMapboxMapViewForSnapshot(root: View): View? {
        val result = findMapView(root, depth = 0) ?: return null
        if (result.second != MapSDKType.MAPBOX) return null
        return findActualMapboxMapView(result.first)
    }

    /**
     * If the detected view is the RNMBXMapView wrapper, find the actual
     * com.mapbox.maps.MapView inside it (bounded recursive search).
     */
    private fun findActualMapboxMapView(view: View, depth: Int = 0): View? {
        if (depth > 8) return null
        // If this view itself is a com.mapbox.maps.MapView, use it directly
        var cls: Class<*>? = view.javaClass
        while (cls != null && cls != View::class.java) {
            if (cls.name == MAPBOX_V10_CLASS || cls.name == MAPBOX_V9_CLASS) return view
            cls = cls.superclass
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                val child = try { view.getChildAt(i) } catch (_: Exception) { null } ?: continue
                findActualMapboxMapView(child, depth + 1)?.let { return it }
            }
        }
        return null
    }

    /**
     * Observe public camera state without registering or replacing SDK
     * listeners. Sampling happens at the existing map refresh cadence and only
     * increases to 2 Hz while a camera change is settling.
     */
    private fun sampleCameraMotion() {
        val controller = mapController?.get() ?: return
        val sdk = detectedSDK ?: return
        val signature = cameraSignature(controller, sdk) ?: return
        val previous = lastCameraSignature
        lastCameraSignature = signature
        if (previous != null && previous != signature) {
            setMapIdle(false)
            scheduleCameraSettleCheck()
        }
    }

    private fun cameraSignature(controller: Any, sdk: MapSDKType): String? {
        return try {
            val state = when (sdk) {
                MapSDKType.GOOGLE_MAPS -> controller.javaClass.getMethod("getCameraPosition").invoke(controller)
                MapSDKType.MAPBOX -> try {
                    controller.javaClass.getMethod("getCameraState").invoke(controller)
                } catch (_: Exception) {
                    controller.javaClass.getMethod("getCameraPosition").invoke(controller)
                }
            } ?: return null
            state.toString()
        } catch (_: Exception) {
            null
        }
    }

    private fun scheduleCameraSettleCheck() {
        cameraSettleRunnable?.let { mainHandler.removeCallbacks(it) }
        val runnable = object : Runnable {
            override fun run() {
                cameraSettleRunnable = null
                val controller = mapController?.get()
                val sdk = detectedSDK
                if (controller == null || sdk == null) {
                    setMapIdle(true)
                    return
                }
                val signature = cameraSignature(controller, sdk)
                if (signature == null) {
                    setMapIdle(true)
                    return
                }
                if (signature == lastCameraSignature) {
                    setMapIdle(true)
                } else {
                    lastCameraSignature = signature
                    cameraSettleRunnable = this
                    mainHandler.postDelayed(this, CAMERA_SETTLE_SAMPLE_MS)
                }
            }
        }
        cameraSettleRunnable = runnable
        mainHandler.postDelayed(runnable, CAMERA_SETTLE_SAMPLE_MS)
    }

    // -- Touch-based idle detection (fallback) --------------------------------

    /**
     * Called by InteractionRecorder when a touch begins while a map is visible.
     * Sets mapIdle to false immediately.  Always used for "map moving" detection
     * because SDK camera-change hooks (subscribeCameraChanged etc.) often fail
     * or use different APIs across Mapbox v10/v11.
     */
    fun notifyTouchBegan(rawX: Float, rawY: Float) {
        activeMapTouch = false
        if (!mapVisible) return
        activeMapTouch = pointInsideHookedMap(rawX, rawY)
        if (!activeMapTouch) return
        touchDebounceRunnable?.let { mainHandler.removeCallbacks(it) }
        touchDebounceRunnable = null
        if (mapIdle) {
            setMapIdle(false)
        }
    }

    /**
     * Called by InteractionRecorder when a touch ends/cancels while a map is visible.
     * Starts a debounce timer and then confirms a stable camera signature,
     * accounting for momentum after the finger lifts.
     */
    fun notifyTouchEnded() {
        val endedMapTouch = activeMapTouch
        activeMapTouch = false
        if (!endedMapTouch || !usesTouchBasedIdle || !mapVisible) return
        touchDebounceRunnable?.let { mainHandler.removeCallbacks(it) }
        val runnable = Runnable {
            touchDebounceRunnable = null
            if (!mapIdle) {
                // Do not let a fixed debounce race a still-decelerating or
                // programmatically animated camera. Confirm a stable public
                // camera state before the idle transition captures a frame.
                scheduleCameraSettleCheck()
            }
        }
        touchDebounceRunnable = runnable
        mainHandler.postDelayed(runnable, TOUCH_DEBOUNCE_MS)
    }

    private fun pointInsideHookedMap(rawX: Float, rawY: Float): Boolean {
        val map = hookedMapView?.get() ?: return false
        if (!map.isShown || map.width <= 0 || map.height <= 0) return false
        return try {
            val location = IntArray(2)
            map.getLocationOnScreen(location)
            rawX >= location[0] && rawX < location[0] + map.width &&
                rawY >= location[1] && rawY < location[1] + map.height
        } catch (_: Exception) {
            // If window coordinates are temporarily unavailable, retaining the
            // conservative behavior avoids recording a moving map frame.
            true
        }
    }

    // -- Cleanup -------------------------------------------------------------

    /** Release map references and timers when recording stops. */
    fun reset() {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            clearMapState()
        } else {
            mainHandler.post { clearMapState() }
        }
    }

    private fun clearControllerState() {
        mapController = null
        lastCameraSignature = null
        cameraSettleRunnable?.let { mainHandler.removeCallbacks(it) }
        cameraSettleRunnable = null
    }

    private fun clearMapState() {
        mapVisible = false
        mapIdle = true
        detectedSDK = null
        hookedMapView = null
        clearControllerState()
        usesTouchBasedIdle = false
        touchDebounceRunnable?.let { mainHandler.removeCallbacks(it) }
        touchDebounceRunnable = null
        activeMapTouch = false
        MapboxSnapshotCache.clear()
    }
}
