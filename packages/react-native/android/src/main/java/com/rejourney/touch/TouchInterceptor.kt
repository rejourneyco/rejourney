/**
 * Global touch event interception.
 * Ported from iOS RJTouchInterceptor.
 * 
 * Matches iOS behavior:
 * - Touch path tracking with x, y, timestamp, force
 * - Coordinate normalization to density-independent pixels
 * - Motion velocity tracking for scroll/swipe events
 * - Coalesced touch processing for smooth gestures
 */
package com.rejourney.touch

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import com.facebook.react.bridge.ReactApplicationContext
import com.rejourney.core.GestureType
import com.rejourney.core.Logger
import com.rejourney.utils.WindowUtils
import kotlin.concurrent.thread
import kotlin.math.atan2
import kotlin.math.sqrt

/**
 * Touch point data matching iOS RJTouchPoint.
 */
data class TouchPoint(
    val x: Float,      
    val y: Float,    
    val timestamp: Long,
    val force: Float   // Pressure (0.0-1.0)
) {
    fun toMap(): Map<String, Any> = mapOf(
        "x" to x,
        "y" to y,
        "timestamp" to timestamp,
        "force" to force
    )
}

/**
 * Callback interface for touch interceptor events.
 */
interface TouchInterceptorDelegate {
    fun onTouchEvent(event: MotionEvent, gestureType: String?)
    fun onGestureRecognized(gestureType: String, x: Float, y: Float, details: Map<String, Any?>)
    fun onRageTap(tapCount: Int, x: Float, y: Float)
    
    /** Called when a gesture completes with full touch path data (matching iOS). */
    fun onGestureWithTouchPath(
        gestureType: String,
        touches: List<Map<String, Any>>,
        duration: Long,
        targetLabel: String?
    ) {}
    
    /** Called for motion events (scroll, swipe, pan) with velocity data (matching iOS). */
    fun onMotionEvent(
        type: String,      // "scroll", "swipe", "pan"
        t0: Long,          // Start timestamp
        t1: Long,          // End timestamp
        dx: Float,         // Delta X 
        dy: Float,         // Delta Y 
        v0: Float,         // Initial velocity
        v1: Float,         // Final velocity
        curve: String      // "linear", "exponential_decay", "ease_out"
    ) {}
    
    /** Called when interaction starts (matching iOS touchInterceptorDidDetectInteractionStart). */
    fun onInteractionStart() {}

    /** Whether the SDK is currently recording a session. */
    fun isCurrentlyRecording(): Boolean = true

    /** Whether the keyboard is visible (used to classify keyboard taps). */
    fun isKeyboardCurrentlyVisible(): Boolean = false

    /** Current keyboard height in pixels. */
    fun currentKeyboardHeight(): Int = 0
}

/**
 * Intercepts global touch events for gesture detection and recording.
 */
class TouchInterceptor private constructor(private val context: Context) {

    companion object {
        @Volatile
        private var instance: TouchInterceptor? = null
        // Store ReactApplicationContext separately for activity access
        private var reactContext: ReactApplicationContext? = null
        
        // Touch coalescing interval (matching iOS kCoalesceInterval = 50ms)
        private const val COALESCE_INTERVAL_MS = 50L

        fun getInstance(context: Context): TouchInterceptor {
            // If this is a ReactApplicationContext, store it for later use
            if (context is ReactApplicationContext) {
                reactContext = context
            }
            return instance ?: synchronized(this) {
                instance ?: TouchInterceptor(context.applicationContext).also { instance = it }
            }
        }
    }

    var delegate: TouchInterceptorDelegate? = null
    private val gestureClassifier = GestureClassifier()
    private var isEnabled: Boolean = false
    private var currentWindowCallback: Window.Callback? = null
    private var originalCallback: Window.Callback? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    
    // Screen density for coordinate normalization (iOS uses points, Android uses pixels)
    private var displayDensity: Float = 1f

    private data class CoalescedTouch(
        val pointerId: Int,
        val x: Float,
        val y: Float,
        val timestamp: Long,
        val force: Float,
        val onKeyboard: Boolean
    )
    
    init {
        displayDensity = context.resources.displayMetrics.density
    }
    
    /**
     * Enable global touch tracking by installing a Window.Callback wrapper.
     * Matches iOS enableGlobalTracking behavior.
     */
    fun enableGlobalTracking() {
        if (isEnabled) return
        
        try {
            val activity = reactContext?.currentActivity
            if (activity == null) {
                Logger.debug("TouchInterceptor: No current activity, cannot enable tracking")
                return
            }
            
            val window = activity.window
            originalCallback = window.callback
            
            currentWindowCallback = object : Window.Callback by originalCallback!! {
                override fun dispatchTouchEvent(event: MotionEvent?): Boolean {
                    event?.let { handleTouchEvent(it) }
                    return originalCallback?.dispatchTouchEvent(event) ?: false
                }
            }
            
            window.callback = currentWindowCallback
            isEnabled = true
            Logger.debug("TouchInterceptor: Global tracking enabled")
        } catch (e: Exception) {
            Logger.error("Failed to enable global touch tracking", e)
        }
    }
    
    /**
     * Disable global touch tracking by restoring original Window.Callback.
     * Matches iOS disableGlobalTracking behavior.
     */
    fun disableGlobalTracking() {
        if (!isEnabled) return
        
        try {
            val activity = reactContext?.currentActivity
            if (activity != null && originalCallback != null) {
                activity.window.callback = originalCallback
            }
            
            currentWindowCallback = null
            originalCallback = null
            isEnabled = false
            resetTouchState()
            Logger.debug("TouchInterceptor: Global tracking disabled")
        } catch (e: Exception) {
            Logger.error("Failed to disable global touch tracking", e)
        }
    }
    
    /**
     * Handle incoming touch events and route to appropriate handlers.
     */
    private fun handleTouchEvent(event: MotionEvent) {
        if (!isEnabled) return

        val delegate = delegate ?: return
        if (!delegate.isCurrentlyRecording()) return

        val windowContext = reactContext ?: context
        val window = WindowUtils.keyWindow(windowContext) ?: return
        val timestamp = System.currentTimeMillis()
        val keyboardVisible = delegate.isKeyboardCurrentlyVisible()
        val keyboardHeight = if (keyboardVisible) delegate.currentKeyboardHeight() else 0

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                activeTouchCount = 1
                touchStartTime = timestamp
                touchPaths.clear()

                val pointerId = event.getPointerId(0)
                val rawPoint = rawCoordinates(event, 0)
                val windowPoint = windowPointFor(rawPoint, window)
                val x = windowPoint.first
                val y = windowPoint.second
                val force = event.getPressure(0).coerceIn(0f, 1f)
                gestureClassifier.maxForce = force
                gestureClassifier.initialPinchDistance = 0f
                gestureClassifier.initialRotationAngle = 0f

                touchStartX = x
                touchStartY = y
                lastMotionX = x
                lastMotionY = y
                lastMotionTimestamp = timestamp

                delegate.onInteractionStart()

                val touchOnKeyboard = isTouchOnKeyboard(rawPoint.second, window, keyboardVisible, keyboardHeight)
                val path = mutableListOf<TouchPoint>()
                if (!touchOnKeyboard) {
                    path.add(TouchPoint(x, y, timestamp, force))
                }
                touchPaths[pointerId] = path
            }

            MotionEvent.ACTION_POINTER_DOWN -> {
                activeTouchCount = event.pointerCount
                val actionIndex = event.actionIndex
                val pointerId = event.getPointerId(actionIndex)
                val rawPoint = rawCoordinates(event, actionIndex)
                val windowPoint = windowPointFor(rawPoint, window)
                val x = windowPoint.first
                val y = windowPoint.second
                val force = event.getPressure(actionIndex).coerceIn(0f, 1f)
                gestureClassifier.maxForce = maxOf(gestureClassifier.maxForce, force)

                val touchOnKeyboard = isTouchOnKeyboard(rawPoint.second, window, keyboardVisible, keyboardHeight)
                val path = mutableListOf<TouchPoint>()
                if (!touchOnKeyboard) {
                    path.add(TouchPoint(x, y, timestamp, force))
                }
                touchPaths[pointerId] = path

                if (activeTouchCount == 2) {
                    calculateInitialPinchState()
                }
            }

            MotionEvent.ACTION_MOVE -> {
                handleTouchMoved(event, timestamp, window, keyboardVisible, keyboardHeight)
            }

            MotionEvent.ACTION_UP -> {
                val pointerId = event.getPointerId(0)
                val rawPoint = rawCoordinates(event, 0)
                val windowPoint = windowPointFor(rawPoint, window)
                val x = windowPoint.first
                val y = windowPoint.second
                val force = event.getPressure(0).coerceIn(0f, 1f)
                val touchOnKeyboard = isTouchOnKeyboard(rawPoint.second, window, keyboardVisible, keyboardHeight)
                handleTouchEnded(pointerId, x, y, rawPoint, timestamp, force, touchOnKeyboard, window)
            }

            MotionEvent.ACTION_POINTER_UP -> {
                handlePointerUp(event, timestamp, window, keyboardVisible, keyboardHeight)
            }

            MotionEvent.ACTION_CANCEL -> {
                resetTouchState()
                gestureClassifier.resetState()
            }
        }

        delegate.onTouchEvent(event, null)
    }
    
    // Touch path tracking (matching iOS touchPaths)
    private val touchPaths = mutableMapOf<Int, MutableList<TouchPoint>>()
    private var touchStartTime: Long = 0
    private var touchStartX: Float = 0f
    private var touchStartY: Float = 0f
    private var activeTouchCount: Int = 0

    // Motion velocity tracking (matching iOS)
    private var lastMotionX: Float = 0f
    private var lastMotionY: Float = 0f
    private var lastMotionTimestamp: Long = 0
    private var motionVelocityX: Float = 0f
    private var motionVelocityY: Float = 0f

    // Touch coalescing (matching iOS coalescedTouches)
    private val coalescedTouches = mutableListOf<CoalescedTouch>()
    private var lastCoalescedProcessTime: Long = 0

    private fun handleTouchMoved(
        event: MotionEvent,
        timestamp: Long,
        window: Window,
        keyboardVisible: Boolean,
        keyboardHeight: Int
    ) {
        for (i in 0 until event.pointerCount) {
            val pointerId = event.getPointerId(i)
            val rawPoint = rawCoordinates(event, i)
            val windowPoint = windowPointFor(rawPoint, window)
            val x = windowPoint.first
            val y = windowPoint.second
            val force = event.getPressure(i).coerceIn(0f, 1f)

            gestureClassifier.maxForce = maxOf(gestureClassifier.maxForce, force)
            val touchOnKeyboard = isTouchOnKeyboard(rawPoint.second, window, keyboardVisible, keyboardHeight)

            coalescedTouches.add(CoalescedTouch(pointerId, x, y, timestamp, force, touchOnKeyboard))
        }

        if (timestamp - lastCoalescedProcessTime >= COALESCE_INTERVAL_MS) {
            processCoalescedTouches()
            lastCoalescedProcessTime = timestamp
        }
    }

    private fun processCoalescedTouches() {
        if (coalescedTouches.isEmpty()) return

        val latestTouches = mutableMapOf<Int, CoalescedTouch>()
        for (touch in coalescedTouches) {
            latestTouches[touch.pointerId] = touch
        }

        for (touch in latestTouches.values) {
            if (touch.onKeyboard) continue

            val path = touchPaths.getOrPut(touch.pointerId) { mutableListOf() }
            val point = TouchPoint(touch.x, touch.y, touch.timestamp, touch.force)
            path.add(point)

            if (lastMotionTimestamp > 0) {
                val dt = (touch.timestamp - lastMotionTimestamp) / 1000f
                if (dt > 0 && dt < 1f) {
                    motionVelocityX = (touch.x - lastMotionX) / dt
                    motionVelocityY = (touch.y - lastMotionY) / dt
                }
            }
            lastMotionX = touch.x
            lastMotionY = touch.y
            lastMotionTimestamp = touch.timestamp
        }

        coalescedTouches.clear()
    }

    private fun handleTouchEnded(
        pointerId: Int,
        x: Float,
        y: Float,
        rawPoint: Pair<Float, Float>,
        timestamp: Long,
        force: Float,
        touchOnKeyboard: Boolean,
        window: Window
    ) {
        processCoalescedTouches()

        if (!touchOnKeyboard) {
            touchPaths[pointerId]?.add(TouchPoint(x, y, timestamp, force))
        }

        activeTouchCount = maxOf(0, activeTouchCount - 1)

        if (activeTouchCount == 0) {
            if (touchOnKeyboard) {
                delegate?.onGestureWithTouchPath(GestureType.KEYBOARD_TAP, emptyList(), 0, null)
            } else {
                finalizeGesture(timestamp, x, y, rawPoint, window)
            }
            resetTouchState()
        }
    }

    private fun handlePointerUp(
        event: MotionEvent,
        timestamp: Long,
        window: Window,
        keyboardVisible: Boolean,
        keyboardHeight: Int
    ) {
        processCoalescedTouches()

        val actionIndex = event.actionIndex
        val pointerId = event.getPointerId(actionIndex)
        val rawPoint = rawCoordinates(event, actionIndex)
        val windowPoint = windowPointFor(rawPoint, window)
        val x = windowPoint.first
        val y = windowPoint.second
        val force = event.getPressure(actionIndex).coerceIn(0f, 1f)
        gestureClassifier.maxForce = maxOf(gestureClassifier.maxForce, force)

        val touchOnKeyboard = isTouchOnKeyboard(rawPoint.second, window, keyboardVisible, keyboardHeight)
        if (!touchOnKeyboard) {
            touchPaths[pointerId]?.add(TouchPoint(x, y, timestamp, force))
        }

        activeTouchCount = maxOf(0, activeTouchCount - 1)
    }

    private fun finalizeGesture(
        timestamp: Long,
        endX: Float,
        endY: Float,
        rawPoint: Pair<Float, Float>,
        window: Window
    ) {
        val duration = maxOf(0, timestamp - touchStartTime)
        val touchPathsCopy = touchPaths.mapValues { entry -> entry.value.map { it.toMap() } }
        val touchCount = touchPathsCopy.size
        val targetLabel = findTargetLabel(window, rawPoint)
        val delegate = delegate ?: return

        thread {
            val allTouches = mutableListOf<Map<String, Any>>()
            for (path in touchPathsCopy.values) {
                allTouches.addAll(path)
            }

            val gestureType = try {
                gestureClassifier.classifyMultiTouchPaths(touchPathsCopy, duration, touchCount)
            } catch (e: Exception) {
                Logger.warning("Gesture classification failed: ${e.message}")
                GestureType.TAP
            }

            mainHandler.post {
                delegate.onGestureWithTouchPath(gestureType, allTouches, duration, targetLabel)
                emitMotionEventIfNeeded(gestureType, duration, endX, endY)
            }
        }

        lastMotionX = 0f
        lastMotionY = 0f
        lastMotionTimestamp = 0
        motionVelocityX = 0f
        motionVelocityY = 0f
    }

    private fun emitMotionEventIfNeeded(gestureType: String, duration: Long, endX: Float, endY: Float) {
        // Only emit for scroll/swipe/pan gestures (matching iOS)
        if (!gestureType.startsWith("scroll") && 
            !gestureType.startsWith("swipe") && 
            !gestureType.startsWith("pan")) {
            return
        }
        
        val motionType = when {
            gestureType.startsWith("scroll") -> "scroll"
            gestureType.startsWith("swipe") -> "swipe"
            else -> "pan"
        }
        
        val dx = endX - touchStartX
        val dy = endY - touchStartY
        val velocity = kotlin.math.sqrt(motionVelocityX * motionVelocityX + motionVelocityY * motionVelocityY)
        
        // Determine curve type (matching iOS)
        val curve = when (motionType) {
            "scroll" -> "exponential_decay"
            "swipe" -> "ease_out"
            else -> "linear"
        }
        
        delegate?.onMotionEvent(
            type = motionType,
            t0 = touchStartTime,
            t1 = touchStartTime + duration,
            dx = dx,
            dy = dy,
            v0 = velocity,
            v1 = 0f,
            curve = curve
        )
    }
    
    private fun resetTouchState() {
        touchPaths.clear()
        coalescedTouches.clear()
        activeTouchCount = 0
        lastMotionX = 0f
        lastMotionY = 0f
        lastMotionTimestamp = 0
        motionVelocityX = 0f
        motionVelocityY = 0f
        lastCoalescedProcessTime = 0
    }

    private fun rawCoordinates(event: MotionEvent, index: Int): Pair<Float, Float> {
        val offsetX = event.rawX - event.getX(0)
        val offsetY = event.rawY - event.getY(0)
        val rawX = event.getX(index) + offsetX
        val rawY = event.getY(index) + offsetY
        return rawX to rawY
    }

    private fun windowPointFor(rawPoint: Pair<Float, Float>, window: Window): Pair<Float, Float> {
        val rootView = window.decorView?.rootView ?: window.decorView
        val location = IntArray(2)
        if (rootView != null) {
            rootView.getLocationOnScreen(location)
        }
        val density = if (displayDensity.isFinite() && displayDensity > 0f) {
            displayDensity
        } else {
            1f
        }
        val x = (rawPoint.first - location[0]) / density
        val y = (rawPoint.second - location[1]) / density
        return x to y
    }

    private fun isTouchOnKeyboard(
        rawY: Float,
        window: Window,
        keyboardVisible: Boolean,
        keyboardHeight: Int
    ): Boolean {
        if (!keyboardVisible || keyboardHeight <= 0) return false

        val rootView = window.decorView?.rootView ?: return false
        if (rootView.height <= 0) return false

        val location = IntArray(2)
        rootView.getLocationOnScreen(location)
        val windowBottom = location[1] + rootView.height
        val keyboardTop = windowBottom - keyboardHeight
        return rawY >= keyboardTop
    }

    private fun findTargetLabel(window: Window, rawPoint: Pair<Float, Float>): String? {
        val rootView = window.decorView?.rootView ?: return null
        val targetView = findViewAt(rootView, rawPoint.first, rawPoint.second)
        return WindowUtils.accessibilityLabelForView(targetView)
    }

    private fun findViewAt(view: View, rawX: Float, rawY: Float): View? {
        if (view.visibility != View.VISIBLE) return null

        val location = IntArray(2)
        view.getLocationOnScreen(location)
        val left = location[0]
        val top = location[1]
        val right = left + view.width
        val bottom = top + view.height

        if (rawX < left || rawX > right || rawY < top || rawY > bottom) return null

        if (view is ViewGroup) {
            for (i in view.childCount - 1 downTo 0) {
                val child = view.getChildAt(i)
                val candidate = findViewAt(child, rawX, rawY)
                if (candidate != null) {
                    return candidate
                }
            }
        }

        return view
    }

    private fun calculateInitialPinchState() {
        val touchIds = touchPaths.keys.toList()
        if (touchIds.size < 2) return

        val path1 = touchPaths[touchIds[0]]
        val path2 = touchPaths[touchIds[1]]
        val point1 = path1?.lastOrNull() ?: return
        val point2 = path2?.lastOrNull() ?: return

        val dx = point1.x - point2.x
        val dy = point1.y - point2.y
        gestureClassifier.initialPinchDistance = sqrt(dx * dx + dy * dy)
        gestureClassifier.initialRotationAngle = atan2(dy, dx)
    }
}
