/**
 * Unified view hierarchy scanner aligned with iOS RJViewHierarchyScanner.
 */
package com.rejourney.capture

import android.graphics.Rect
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.widget.NestedScrollView
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.rejourney.core.Logger
import com.rejourney.privacy.PrivacyMask
import java.util.WeakHashMap
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

data class ViewHierarchyScanResult(
    val layoutSignature: String? = null,
    val textInputFrames: List<Rect> = emptyList(),
    val cameraFrames: List<Rect> = emptyList(),
    val webViewFrames: List<Rect> = emptyList(),
    val videoFrames: List<Rect> = emptyList(),
    val mapViewFrames: List<Rect> = emptyList(),
    val mapViewPointers: List<View> = emptyList(),
    val scrollViewPointers: List<View> = emptyList(),
    val animatedViewPointers: List<View> = emptyList(),
    val hasMapView: Boolean = false,
    val scrollActive: Boolean = false,
    val bounceActive: Boolean = false,
    val refreshActive: Boolean = false,
    val mapActive: Boolean = false,
    val hasAnyAnimations: Boolean = false,
    val animationAreaRatio: Float = 0f,
    val didBailOutEarly: Boolean = false,
    val totalViewsScanned: Int = 0,
    val scanTimestamp: Long = System.currentTimeMillis()
)

class ViewHierarchyScannerConfig {
    var detectTextInputs: Boolean = true
    var detectCameraViews: Boolean = true
    var detectWebViews: Boolean = true
    var detectVideoLayers: Boolean = true
    var maxDepth: Int = 25
    var maxViewCount: Int = 2000

    companion object {
        fun defaultConfig(): ViewHierarchyScannerConfig = ViewHierarchyScannerConfig().apply {
            maxDepth = 8
            maxViewCount = 500
        }
    }
}

class ViewHierarchyScanner(val config: ViewHierarchyScannerConfig = ViewHierarchyScannerConfig.defaultConfig()) {
    private val textInputFrames = mutableListOf<Rect>()
    private val cameraFrames = mutableListOf<Rect>()
    private val webViewFrames = mutableListOf<Rect>()
    private val videoFrames = mutableListOf<Rect>()
    private val mapViewFrames = mutableListOf<Rect>()
    private val mapViewPointers = mutableListOf<View>()
    private val scrollViewPointers = mutableListOf<View>()
    private val animatedViewPointers = mutableListOf<View>()

    private val scrollStateCache = WeakHashMap<View, ScrollState>()
    private val mapStateCache = WeakHashMap<View, MapState>()

    private var primaryWindowLocation = IntArray(2)
    private var primaryBounds = Rect()

    private var viewCount = 0
    private var didBailOutEarly = false
    private var foundMapView = false
    private var scanScrollActive = false
    private var scanBounceActive = false
    private var scanRefreshActive = false
    private var scanMapActive = false
    private var scanHasAnimations = false
    private var scanAnimatedArea = 0f
    private var scanStartTime = 0L

    private var layoutSignatureHash = FNV_OFFSET_BASIS

    private val resolvedCameraClasses = mutableListOf<Class<*>>()
    private val resolvedWebViewClasses = mutableListOf<Class<*>>()

    fun prewarmClassCaches() {
        resolveClasses(cameraClassNames, resolvedCameraClasses)
        resolveClasses(webViewClassNames, resolvedWebViewClasses)
        Logger.debug("ViewHierarchyScanner: Class caches pre-warmed")
    }

    fun scanWindow(window: Window?): ViewHierarchyScanResult? {
        val root = window?.decorView ?: return null
        return scanWindows(listOf(root), root)
    }

    fun scanAllWindowsRelativeTo(primaryWindow: Window?): ViewHierarchyScanResult? {
        val primaryRoot = primaryWindow?.decorView ?: return null
        val allRoots = getAllVisibleWindowRoots(primaryRoot)
        return scanWindows(allRoots, primaryRoot)
    }

    private fun scanWindows(windowRoots: List<View>, primaryRoot: View): ViewHierarchyScanResult {
        resetState(primaryRoot)

        for (root in windowRoots) {
            scanView(root, primaryRoot, 0)
            if (needsPrivacyFallback() && (viewCount >= config.maxViewCount || didBailOutEarly)) {
                scanSensitiveViewsOnly(root, primaryRoot)
            }
        }

        if (didBailOutEarly && needsPrivacyFallback()) {
            for (root in windowRoots) {
                scanSensitiveViewsOnly(root, primaryRoot)
            }
        }

        val signature = if (layoutSignatureHash != FNV_OFFSET_BASIS) {
            java.lang.Long.toUnsignedString(layoutSignatureHash, 16).padStart(16, '0')
        } else {
            null
        }

        val screenArea = max(1f, (primaryBounds.width() * primaryBounds.height()).toFloat())
        return ViewHierarchyScanResult(
            layoutSignature = signature,
            textInputFrames = textInputFrames.map { Rect(it) },
            cameraFrames = cameraFrames.map { Rect(it) },
            webViewFrames = webViewFrames.map { Rect(it) },
            videoFrames = videoFrames.map { Rect(it) },
            mapViewFrames = mapViewFrames.map { Rect(it) },
            mapViewPointers = mapViewPointers.toList(),
            scrollViewPointers = scrollViewPointers.toList(),
            animatedViewPointers = animatedViewPointers.toList(),
            hasMapView = foundMapView,
            scrollActive = scanScrollActive,
            bounceActive = scanBounceActive,
            refreshActive = scanRefreshActive,
            mapActive = scanMapActive,
            hasAnyAnimations = scanHasAnimations,
            animationAreaRatio = min(scanAnimatedArea / screenArea, 1f),
            didBailOutEarly = didBailOutEarly,
            totalViewsScanned = viewCount,
            scanTimestamp = System.currentTimeMillis()
        )
    }

    private fun scanView(view: View, primaryRoot: View, depth: Int) {
        if (viewCount >= config.maxViewCount || depth > config.maxDepth) {
            didBailOutEarly = true
            return
        }

        if (viewCount > 0 && viewCount % VIEW_TIME_CHECK_INTERVAL == 0) {
            val elapsed = SystemClock.elapsedRealtime() - scanStartTime
            if (elapsed > MAX_SCAN_TIME_MS) {
                didBailOutEarly = true
                return
            }
        }

        if (!isViewVisible(view) && depth > 0) return

        viewCount++

        val isWebView = config.detectWebViews && isWebView(view)
        val isCamera = config.detectCameraViews && isCameraPreview(view)
        val isVideo = config.detectVideoLayers && isVideoLayerView(view)
        val isBlockedSurface = isWebView || isCamera || isVideo

        checkSensitiveView(view, primaryRoot, isWebView, isCamera, isVideo)
        trackScrollView(view)

        if (isBlockedSurface) {
            appendBlockedSurfaceInfoToSignature(view, depth)
            return
        }

        appendViewInfoToSignature(view, depth)
        trackAnimationsForView(view)

        if (view is ViewGroup) {
            for (i in view.childCount - 1 downTo 0) {
                scanView(view.getChildAt(i), primaryRoot, depth + 1)
            }
        }
    }

    private fun checkSensitiveView(
        view: View,
        primaryRoot: View,
        isWebView: Boolean,
        isCamera: Boolean,
        isVideo: Boolean
    ) {
        val isTextInput = config.detectTextInputs && isActualTextInput(view)
        val isManuallyMasked = PrivacyMask.isManuallyMasked(view)
        val isMapView = isMapView(view)

        if (isMapView) {
            foundMapView = true
            if (isMapViewActive(view)) {
                scanMapActive = true
            }
            addFrame(view, primaryRoot, mapViewFrames)
            mapViewPointers.add(view)
        }

        if (!isTextInput && !isCamera && !isWebView && !isVideo && !isManuallyMasked) {
            return
        }

        val targetList = when {
            isCamera -> cameraFrames
            isWebView -> webViewFrames
            isVideo -> videoFrames
            else -> textInputFrames
        }
        addFrame(view, primaryRoot, targetList)
    }

    private fun addFrame(view: View, primaryRoot: View, target: MutableList<Rect>) {
        val location = IntArray(2)
        view.getLocationOnScreen(location)
        val left = location[0] - primaryWindowLocation[0]
        val top = location[1] - primaryWindowLocation[1]
        val right = left + view.width
        val bottom = top + view.height
        val rect = Rect(left, top, right, bottom)
        if (!Rect.intersects(rect, primaryBounds)) return

        val clipped = Rect(rect)
        clipped.intersect(primaryBounds)
        if (clipped.width() > MIN_FRAME_SIZE && clipped.height() > MIN_FRAME_SIZE) {
            target.add(clipped)
        }
    }

    private fun scanSensitiveViewsOnly(windowRoot: View, primaryRoot: View) {
        val queue = ArrayDeque<View>()
        queue.add(windowRoot)
        val start = SystemClock.elapsedRealtime()
        var scanned = 0

        while (queue.isNotEmpty()) {
            if (scanned >= PRIVACY_FALLBACK_MAX_VIEWS) break
            if (SystemClock.elapsedRealtime() - start > PRIVACY_FALLBACK_MAX_MS) break

            val current = queue.removeFirst()
            if (isViewVisible(current)) {
                val isWebView = config.detectWebViews && isWebView(current)
                val isCamera = config.detectCameraViews && isCameraPreview(current)
                val isVideo = config.detectVideoLayers && isVideoLayerView(current)
                checkSensitiveView(current, primaryRoot, isWebView, isCamera, isVideo)
            }

            if (current is ViewGroup) {
                for (i in current.childCount - 1 downTo 0) {
                    queue.add(current.getChildAt(i))
                }
            }
            scanned++
        }
    }

    private fun trackScrollView(view: View) {
        when (view) {
            is ScrollView, is HorizontalScrollView, is NestedScrollView, is RecyclerView -> {
                scrollViewPointers.add(view)
                val state = scrollStateCache[view] ?: ScrollState()
                val (offsetX, offsetY, contentWidth, contentHeight) = scrollMetricsFor(view)

                val offsetMoved = state.initialized &&
                    (abs(offsetX - state.offsetX) > SCROLL_EPSILON ||
                        abs(offsetY - state.offsetY) > SCROLL_EPSILON)
                if (offsetMoved || (view is RecyclerView && view.scrollState != RecyclerView.SCROLL_STATE_IDLE)) {
                    scanScrollActive = true
                }

                if (isOverscrolling(view, offsetX, offsetY, contentWidth, contentHeight)) {
                    scanBounceActive = true
                }

                val refreshActive = (view as? SwipeRefreshLayout)?.isRefreshing ?: false
                if (refreshActive) {
                    scanRefreshActive = true
                }

                state.offsetX = offsetX
                state.offsetY = offsetY
                state.contentWidth = contentWidth
                state.contentHeight = contentHeight
                state.initialized = true
                scrollStateCache[view] = state
            }
            is SwipeRefreshLayout -> {
                if (view.isRefreshing) {
                    scanRefreshActive = true
                }
            }
        }
    }

    private fun trackAnimationsForView(view: View) {
        val animation = view.animation
        val hasAnimation = (animation != null && animation.hasStarted() && !animation.hasEnded()) || view.hasTransientState()
        if (!hasAnimation) return

        scanHasAnimations = true
        animatedViewPointers.add(view)

        val location = IntArray(2)
        view.getLocationOnScreen(location)
        val left = location[0] - primaryWindowLocation[0]
        val top = location[1] - primaryWindowLocation[1]
        val right = left + view.width
        val bottom = top + view.height
        val rect = Rect(left, top, right, bottom)
        if (!Rect.intersects(rect, primaryBounds)) return

        val clipped = Rect(rect)
        clipped.intersect(primaryBounds)
        scanAnimatedArea += clipped.width() * clipped.height()
    }

    private fun appendViewInfoToSignature(view: View, depth: Int) {
        mixInt(depth)
        mixInt(System.identityHashCode(view.javaClass))

        mixInt(view.left)
        mixInt(view.top)
        mixInt(view.width)
        mixInt(view.height)

        if (view is ScrollView || view is HorizontalScrollView || view is NestedScrollView || view is RecyclerView) {
            val (offsetX, offsetY, _, _) = scrollMetricsFor(view)
            mixInt(offsetX)
            mixInt(offsetY)
        }

        if (view is TextView) {
            val text = view.text?.toString().orEmpty()
            if (view is EditText) {
                mixInt(text.length)
            } else if (text.isNotEmpty()) {
                mixInt(text.hashCode())
            }
        }

        val label = view.contentDescription?.toString()
        if (!label.isNullOrEmpty()) {
            mixInt(label.hashCode())
        }

        if (view is android.widget.ImageView) {
            view.drawable?.let { mixInt(System.identityHashCode(it)) }
        }

        val background = view.background
        if (background != null) {
            mixInt(background.hashCode())
        }

        mixInt((view.alpha * 100).toInt())
        mixInt(if (view.visibility == View.VISIBLE) 0 else 1)
    }

    private fun appendBlockedSurfaceInfoToSignature(view: View, depth: Int) {
        mixInt(depth)
        mixInt(System.identityHashCode(view.javaClass))

        mixInt(view.left)
        mixInt(view.top)
        mixInt(view.width)
        mixInt(view.height)

        mixInt((view.alpha * 100).toInt())
        mixInt(if (view.visibility == View.VISIBLE) 0 else 1)
    }

    private fun isOverscrolling(view: View, offsetX: Int, offsetY: Int, contentWidth: Int, contentHeight: Int): Boolean {
        return when (view) {
            is ScrollView, is NestedScrollView -> {
                val maxY = max(0, contentHeight - view.height).toFloat()
                offsetY.toFloat() < -SCROLL_EPSILON || offsetY.toFloat() > maxY + SCROLL_EPSILON
            }
            is HorizontalScrollView -> {
                val maxX = max(0, contentWidth - view.width).toFloat()
                offsetX.toFloat() < -SCROLL_EPSILON || offsetX.toFloat() > maxX + SCROLL_EPSILON
            }
            else -> false
        }
    }

    private fun scrollMetricsFor(view: View): ScrollMetrics {
        return when (view) {
            is RecyclerView -> ScrollMetrics(
                view.computeHorizontalScrollOffset(),
                view.computeVerticalScrollOffset(),
                view.computeHorizontalScrollRange(),
                view.computeVerticalScrollRange()
            )
            is ScrollView -> ScrollMetrics(
                view.scrollX,
                view.scrollY,
                view.getChildAt(0)?.width ?: view.width,
                view.getChildAt(0)?.height ?: view.height
            )
            is NestedScrollView -> ScrollMetrics(
                view.scrollX,
                view.scrollY,
                view.getChildAt(0)?.width ?: view.width,
                view.getChildAt(0)?.height ?: view.height
            )
            is HorizontalScrollView -> ScrollMetrics(
                view.scrollX,
                view.scrollY,
                view.getChildAt(0)?.width ?: view.width,
                view.getChildAt(0)?.height ?: view.height
            )
            else -> ScrollMetrics(view.scrollX, view.scrollY, view.width, view.height)
        }
    }

    private fun isActualTextInput(view: View): Boolean {
        if (view is EditText) return true
        val className = view.javaClass.simpleName
        return className.contains("TextInput") ||
            className.contains("TextField") ||
            className.contains("EditText")
    }

    private fun isCameraPreview(view: View): Boolean {
        for (cls in resolvedCameraClasses) {
            if (cls.isInstance(view)) return true
        }
        val className = view.javaClass.simpleName
        return className.contains("Camera") || className.contains("Preview") || className.contains("Scanner")
    }

    private fun isWebView(view: View): Boolean {
        for (cls in resolvedWebViewClasses) {
            if (cls.isInstance(view)) return true
        }
        val className = view.javaClass.simpleName
        return className.contains("WebView") || className.contains("WKContentView")
    }

    private fun isVideoLayerView(view: View): Boolean {
        val className = view.javaClass.simpleName
        return className.contains("Video") || className.contains("PlayerView")
    }

    private fun isMapView(view: View): Boolean {
        val className = view.javaClass.simpleName
        return mapViewClassNames.any { className.contains(it) }
    }

    private fun isMapViewActive(view: View): Boolean {
        val state = mapStateCache[view] ?: MapState()
        val drawingTime = view.drawingTime
        val animation = view.animation
        val hasAnimation = animation != null && animation.hasStarted() && !animation.hasEnded()
        val hasTransient = view.hasTransientState()
        val isPressed = view.isPressed
        val drawingChanged = state.initialized && drawingTime != state.drawingTime

        state.drawingTime = drawingTime
        state.initialized = true
        mapStateCache[view] = state

        return hasAnimation || hasTransient || isPressed || drawingChanged
    }

    private fun needsPrivacyFallback(): Boolean {
        return (config.detectTextInputs && textInputFrames.isEmpty()) ||
            (config.detectCameraViews && cameraFrames.isEmpty()) ||
            (config.detectWebViews && webViewFrames.isEmpty()) ||
            (config.detectVideoLayers && videoFrames.isEmpty())
    }

    private fun isViewVisible(view: View): Boolean {
        return view.visibility == View.VISIBLE && view.alpha > 0.01f && view.width > 0 && view.height > 0
    }

    private fun resetState(primaryRoot: View) {
        textInputFrames.clear()
        cameraFrames.clear()
        webViewFrames.clear()
        videoFrames.clear()
        mapViewFrames.clear()
        mapViewPointers.clear()
        scrollViewPointers.clear()
        animatedViewPointers.clear()

        viewCount = 0
        didBailOutEarly = false
        foundMapView = false
        scanScrollActive = false
        scanBounceActive = false
        scanRefreshActive = false
        scanMapActive = false
        scanHasAnimations = false
        scanAnimatedArea = 0f
        scanStartTime = SystemClock.elapsedRealtime()
        layoutSignatureHash = FNV_OFFSET_BASIS

        primaryRoot.getLocationOnScreen(primaryWindowLocation)
        primaryBounds = Rect(0, 0, primaryRoot.width, primaryRoot.height)
    }

    private fun mixInt(value: Int) {
        layoutSignatureHash = fnv1a(layoutSignatureHash, value.toLong(), INT_BYTES)
    }

    private fun fnv1a(hash: Long, value: Long, bytes: Int): Long {
        var h = hash
        var v = value
        repeat(bytes) {
            val byte = (v and 0xFF).toInt()
            h = (h xor byte.toLong()) * FNV_PRIME
            v = v ushr 8
        }
        return h
    }

    private fun resolveClasses(names: List<String>, target: MutableList<Class<*>>) {
        target.clear()
        for (name in names) {
            try {
                target.add(Class.forName(name))
            } catch (_: Exception) {
            }
        }
    }

    private fun getAllVisibleWindowRoots(primaryRoot: View): List<View> {
        val roots = mutableListOf<View>()
        roots.add(primaryRoot)
        try {
            val wmgClass = Class.forName("android.view.WindowManagerGlobal")
            val wmgInstance = wmgClass.getMethod("getInstance").invoke(null)
            val viewsField = wmgClass.getDeclaredField("mViews")
            viewsField.isAccessible = true
            val views = viewsField.get(wmgInstance)
            when (views) {
                is ArrayList<*> -> {
                    for (view in views) {
                        if (view is View && view.isShown && view.visibility == View.VISIBLE) {
                            if (view != primaryRoot) roots.add(view)
                        }
                    }
                }
                is Array<*> -> {
                    for (view in views) {
                        if (view is View && view.isShown && view.visibility == View.VISIBLE) {
                            if (view != primaryRoot) roots.add(view)
                        }
                    }
                }
            }
        } catch (_: Exception) {
            // Best-effort only
        }
        return roots
    }

    private data class ScrollState(
        var offsetX: Int = 0,
        var offsetY: Int = 0,
        var contentWidth: Int = 0,
        var contentHeight: Int = 0,
        var initialized: Boolean = false
    )

    private data class ScrollMetrics(
        val offsetX: Int,
        val offsetY: Int,
        val contentWidth: Int,
        val contentHeight: Int
    )

    private data class MapState(
        var drawingTime: Long = 0L,
        var initialized: Boolean = false
    )

    companion object {
        private const val MAX_SCAN_TIME_MS = 30L
        private const val VIEW_TIME_CHECK_INTERVAL = 200
        private const val PRIVACY_FALLBACK_MAX_MS = 10L
        private const val PRIVACY_FALLBACK_MAX_VIEWS = 2000
        private const val MIN_FRAME_SIZE = 10
        private const val SCROLL_EPSILON = 1f

        private const val FNV_OFFSET_BASIS = -3750763034362895579L
        private const val FNV_PRIME = 1099511628211L
        private const val INT_BYTES = 4

        private val cameraClassNames = listOf(
            "androidx.camera.view.PreviewView",
            "com.google.android.cameraview.CameraView",
            "org.reactnative.camera.RNCameraView",
            "com.mrousavy.camera.CameraView",
            "com.mrousavy.camera.RNCameraView",
            "expo.modules.camera.CameraView"
        )

        private val webViewClassNames = listOf(
            "android.webkit.WebView",
            "com.reactnativecommunity.webview.RNCWebView",
            "com.facebook.react.views.webview.ReactWebView"
        )

        private val mapViewClassNames = listOf(
            "MapView",
            "AIRMap",
            "AIRMapView",
            "RNMMapView",
            "GMSMapView",
            "Mapbox",
            "MGLMapView"
        )
    }
}
