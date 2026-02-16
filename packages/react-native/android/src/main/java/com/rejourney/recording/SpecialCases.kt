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
                hookedMapView = WeakReference(mapView)
                hookIdleCallbacks(mapView, sdk)
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
    // GoogleMap.setOnCameraIdleListener   -> idle
    // GoogleMap.setOnCameraMoveStartedListener -> not idle

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
                    attachGoogleMapListeners(googleMap)
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

    private fun attachGoogleMapListeners(googleMap: Any) {
        try {
            // setOnCameraIdleListener
            val idleListenerClass = Class.forName(
                "com.google.android.gms.maps.GoogleMap\$OnCameraIdleListener"
            )
            val idleProxy = java.lang.reflect.Proxy.newProxyInstance(
                googleMap.javaClass.classLoader,
                arrayOf(idleListenerClass)
            ) { _, method, _ ->
                if (method.name == "onCameraIdle") {
                    setMapIdle(true)
                }
                null
            }
            googleMap.javaClass.getMethod("setOnCameraIdleListener", idleListenerClass)
                .invoke(googleMap, idleProxy)

            // setOnCameraMoveStartedListener
            val moveListenerClass = Class.forName(
                "com.google.android.gms.maps.GoogleMap\$OnCameraMoveStartedListener"
            )
            val moveProxy = java.lang.reflect.Proxy.newProxyInstance(
                googleMap.javaClass.classLoader,
                arrayOf(moveListenerClass)
            ) { _, method, _ ->
                if (method.name == "onCameraMoveStarted") {
                    setMapIdle(false)
                }
                null
            }
            googleMap.javaClass.getMethod("setOnCameraMoveStartedListener", moveListenerClass)
                .invoke(googleMap, moveProxy)

            DiagnosticLog.trace("[SpecialCases] Google Maps idle/move listeners attached")
        } catch (e: Exception) {
            DiagnosticLog.trace("[SpecialCases] Google Maps listener attach failed: ${e.message}")
            mapIdle = true
        }
    }

    // ---- Mapbox ------------------------------------------------------------
    // v10+: MapboxMap.subscribeMapIdle / subscribeCameraChanged
    // v9:   MapboxMap.addOnMapIdleListener / addOnCameraMoveStartedListener

    private fun hookMapbox(mapView: View) {
        // Try v10 first, then fall back to v9
        if (!tryHookMapboxV10(mapView)) {
            tryHookMapboxV9(mapView)
        }
    }

    /**
     * Mapbox Maps SDK v10+
     * MapView.getMapboxMap() -> MapboxMap
     * MapboxMap.subscribeMapIdle { ... }
     * MapboxMap.subscribeCameraChanged { ... }
     */
    private fun tryHookMapboxV10(mapView: View): Boolean {
        return try {
            val getMapboxMap = mapView.javaClass.getMethod("getMapboxMap")
            val mapboxMap = getMapboxMap.invoke(mapView) ?: return false

            // subscribeMapIdle -> idle
            try {
                val subscribeIdle = mapboxMap.javaClass.getMethod(
                    "subscribeMapIdle",
                    Class.forName("com.mapbox.maps.plugin.delegates.listeners.OnMapIdleListener")
                )
                val idleListenerClass = Class.forName(
                    "com.mapbox.maps.plugin.delegates.listeners.OnMapIdleListener"
                )
                val idleProxy = java.lang.reflect.Proxy.newProxyInstance(
                    mapboxMap.javaClass.classLoader,
                    arrayOf(idleListenerClass)
                ) { _, method, _ ->
                    if (method.name == "onMapIdle") {
                        setMapIdle(true)
                    }
                    null
                }
                subscribeIdle.invoke(mapboxMap, idleProxy)
            } catch (_: Exception) {
                // v11 uses a different API shape — try lambda-based subscribe
                tryHookMapboxV11Idle(mapboxMap)
            }

            // subscribeCameraChanged -> not idle
            try {
                val subscribeCam = mapboxMap.javaClass.getMethod(
                    "subscribeCameraChanged",
                    Class.forName("com.mapbox.maps.plugin.delegates.listeners.OnCameraChangeListener")
                )
                val camListenerClass = Class.forName(
                    "com.mapbox.maps.plugin.delegates.listeners.OnCameraChangeListener"
                )
                val camProxy = java.lang.reflect.Proxy.newProxyInstance(
                    mapboxMap.javaClass.classLoader,
                    arrayOf(camListenerClass)
                ) { _, method, _ ->
                    if (method.name == "onCameraChanged") {
                        setMapIdle(false)
                    }
                    null
                }
                subscribeCam.invoke(mapboxMap, camProxy)
            } catch (_: Exception) {
                // Camera-changed hook is best-effort; idle hook is enough
            }

            DiagnosticLog.trace("[SpecialCases] Mapbox v10 idle hooks attached")
            true
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Mapbox v11+ uses addOnMapIdleListener instead of subscribeMapIdle.
     */
    private fun tryHookMapboxV11Idle(mapboxMap: Any) {
        try {
            val addIdleListener = mapboxMap.javaClass.getMethod(
                "addOnMapIdleListener",
                Class.forName("com.mapbox.maps.plugin.delegates.listeners.OnMapIdleListener")
            )
            val idleListenerClass = Class.forName(
                "com.mapbox.maps.plugin.delegates.listeners.OnMapIdleListener"
            )
            val idleProxy = java.lang.reflect.Proxy.newProxyInstance(
                mapboxMap.javaClass.classLoader,
                arrayOf(idleListenerClass)
            ) { _, method, _ ->
                if (method.name == "onMapIdle") {
                    setMapIdle(true)
                }
                null
            }
            addIdleListener.invoke(mapboxMap, idleProxy)
            DiagnosticLog.trace("[SpecialCases] Mapbox v11 idle listener attached")
        } catch (e: Exception) {
            DiagnosticLog.trace("[SpecialCases] Mapbox v11 idle hook failed: ${e.message}")
        }
    }

    /**
     * Mapbox Maps SDK v9 (legacy)
     * MapView.getMapAsync(OnMapReadyCallback) -> MapboxMap
     * MapboxMap.addOnMapIdleListener(...)
     * MapboxMap.addOnCameraMoveStartedListener(...)
     */
    private fun tryHookMapboxV9(mapView: View) {
        try {
            val callbackClassName = "com.mapbox.mapboxsdk.maps.OnMapReadyCallback"
            val callbackClass = Class.forName(callbackClassName)
            val getMapAsync = mapView.javaClass.getMethod("getMapAsync", callbackClass)

            val proxy = java.lang.reflect.Proxy.newProxyInstance(
                mapView.javaClass.classLoader,
                arrayOf(callbackClass)
            ) { _, method, args ->
                if (method.name == "onMapReady" && args != null && args.isNotEmpty()) {
                    val mapboxMap = args[0] ?: return@newProxyInstance null
                    attachMapboxV9Listeners(mapboxMap)
                }
                null
            }
            getMapAsync.invoke(mapView, proxy)
            DiagnosticLog.trace("[SpecialCases] Mapbox v9 getMapAsync invoked")
        } catch (e: Exception) {
            DiagnosticLog.trace("[SpecialCases] Mapbox v9 hook failed: ${e.message}")
        }
    }

    private fun attachMapboxV9Listeners(mapboxMap: Any) {
        try {
            // addOnMapIdleListener -> idle
            val idleListenerClass = Class.forName(
                "com.mapbox.mapboxsdk.maps.MapboxMap\$OnMapIdleListener"
            )
            val idleProxy = java.lang.reflect.Proxy.newProxyInstance(
                mapboxMap.javaClass.classLoader,
                arrayOf(idleListenerClass)
            ) { _, method, _ ->
                if (method.name == "onMapIdle") {
                    setMapIdle(true)
                }
                null
            }
            mapboxMap.javaClass.getMethod("addOnMapIdleListener", idleListenerClass)
                .invoke(mapboxMap, idleProxy)

            // addOnCameraMoveStartedListener -> not idle
            val moveListenerClass = Class.forName(
                "com.mapbox.mapboxsdk.maps.MapboxMap\$OnCameraMoveStartedListener"
            )
            val moveProxy = java.lang.reflect.Proxy.newProxyInstance(
                mapboxMap.javaClass.classLoader,
                arrayOf(moveListenerClass)
            ) { _, method, _ ->
                if (method.name == "onCameraMoveStarted") {
                    setMapIdle(false)
                }
                null
            }
            mapboxMap.javaClass.getMethod("addOnCameraMoveStartedListener", moveListenerClass)
                .invoke(mapboxMap, moveProxy)

            DiagnosticLog.trace("[SpecialCases] Mapbox v9 idle/move listeners attached")
        } catch (e: Exception) {
            DiagnosticLog.trace("[SpecialCases] Mapbox v9 listener attach failed: ${e.message}")
            mapIdle = true
        }
    }

    // -- Cleanup -------------------------------------------------------------

    private fun clearMapState() {
        mapVisible = false
        mapIdle = true
        detectedSDK = null
        hookedMapView = null
    }
}
