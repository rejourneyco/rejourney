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
import android.content.Context
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import java.lang.ref.WeakReference
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Touch and gesture recording
 * Android implementation aligned with iOS InteractionRecorder.swift
 */
class InteractionRecorder private constructor(private val context: Context) {
    
    companion object {
        @Volatile
        private var instance: InteractionRecorder? = null
        
        fun getInstance(context: Context): InteractionRecorder {
            return instance ?: synchronized(this) {
                instance ?: InteractionRecorder(context.applicationContext).also { instance = it }
            }
        }
        
        val shared: InteractionRecorder?
            get() = instance
    }
    
    var isTracking = false
        private set
    
    private var gestureAggregator: GestureAggregator? = null
    private val inputObservers = CopyOnWriteArrayList<WeakReference<EditText>>()
    private val navigationStack = mutableListOf<String>()
    private val coalesceWindow: Long = 300 // ms
    
    internal var currentActivity: WeakReference<Activity>? = null
    
    fun setCurrentActivity(activity: Activity?) {
        val oldActivity = currentActivity?.get()
        currentActivity = if (activity != null) WeakReference(activity) else null
        // Re-install the touch listener when the activity changes while tracking
        if (isTracking && activity != null && activity !== oldActivity) {
            removeGlobalTouchListener()
            installGlobalTouchListener()
        }
    }
    
    fun activate() {
        if (isTracking) return
        isTracking = true
        gestureAggregator = GestureAggregator(this, context)
        installGlobalTouchListener()
    }
    
    fun deactivate() {
        if (!isTracking) return
        isTracking = false
        removeGlobalTouchListener()
        gestureAggregator = null
        inputObservers.clear()
        navigationStack.clear()
    }
    
    fun observeTextField(field: EditText) {
        if (inputObservers.any { it.get() === field }) return
        inputObservers.add(WeakReference(field))
    }
    
    fun pushScreen(identifier: String) {
        navigationStack.add(identifier)
        TelemetryPipeline.shared?.recordViewTransition(identifier, identifier, true)
        ReplayOrchestrator.shared?.logScreenView(identifier)
    }
    
    fun popScreen() {
        val last = navigationStack.removeLastOrNull() ?: return
        TelemetryPipeline.shared?.recordViewTransition(last, last, false)
    }
    
    private var originalWindowCallback: Window.Callback? = null
    private var installedWindow: WeakReference<Window>? = null
    
    private fun installGlobalTouchListener() {
        val activity = currentActivity?.get() ?: return
        val window = activity.window ?: return
        val original = window.callback ?: return
        
        // Don't double-install on the same window
        if (installedWindow?.get() === window && originalWindowCallback != null) return
        
        originalWindowCallback = original
        installedWindow = WeakReference(window)
        val agg = gestureAggregator ?: return
        
        window.callback = object : Window.Callback by original {
            override fun dispatchTouchEvent(event: MotionEvent?): Boolean {
                if (event != null) {
                    agg.processTouchEvent(event)
                }
                return original.dispatchTouchEvent(event)
            }
        }
    }
    
    private fun removeGlobalTouchListener() {
        val window = installedWindow?.get()
        if (window != null) {
            originalWindowCallback?.let { window.callback = it }
        }
        originalWindowCallback = null
        installedWindow = null
    }
    
    // Report methods (called by GestureAggregator)
    
    internal fun reportTap(location: PointF, target: String) {
        TelemetryPipeline.shared?.recordTapEvent(target, location.x.toLong().coerceAtLeast(0), location.y.toLong().coerceAtLeast(0))
        ReplayOrchestrator.shared?.incrementTapTally()
    }
    
    internal fun reportSwipe(location: PointF, direction: SwipeDirection, target: String) {
        TelemetryPipeline.shared?.recordSwipeEvent(
            target,
            location.x.toLong().coerceAtLeast(0),
            location.y.toLong().coerceAtLeast(0),
            direction.label
        )
        ReplayOrchestrator.shared?.incrementGestureTally()
    }
    
    internal fun reportScroll(location: PointF, target: String) {
        TelemetryPipeline.shared?.recordScrollEvent(
            target,
            location.x.toLong().coerceAtLeast(0),
            location.y.toLong().coerceAtLeast(0),
            "vertical"
        )
        ReplayOrchestrator.shared?.incrementGestureTally()
    }
    
    internal fun reportPan(location: PointF, target: String) {
        TelemetryPipeline.shared?.recordPanEvent(
            target,
            location.x.toLong().coerceAtLeast(0),
            location.y.toLong().coerceAtLeast(0)
        )
    }
    
    internal fun reportPinch(location: PointF, scale: Double, target: String) {
        TelemetryPipeline.shared?.recordPinchEvent(
            target,
            location.x.toLong().coerceAtLeast(0),
            location.y.toLong().coerceAtLeast(0),
            scale
        )
        ReplayOrchestrator.shared?.incrementGestureTally()
    }
    
    internal fun reportRotation(location: PointF, angle: Double, target: String) {
        TelemetryPipeline.shared?.recordRotationEvent(
            target,
            location.x.toLong().coerceAtLeast(0),
            location.y.toLong().coerceAtLeast(0),
            angle
        )
        ReplayOrchestrator.shared?.incrementGestureTally()
    }
    
    internal fun reportLongPress(location: PointF, target: String) {
        TelemetryPipeline.shared?.recordLongPressEvent(
            target,
            location.x.toLong().coerceAtLeast(0),
            location.y.toLong().coerceAtLeast(0)
        )
        ReplayOrchestrator.shared?.incrementGestureTally()
    }
    
    internal fun reportRageTap(location: PointF, count: Int, target: String) {
        TelemetryPipeline.shared?.recordRageTapEvent(
            target,
            location.x.toLong().coerceAtLeast(0),
            location.y.toLong().coerceAtLeast(0),
            count
        )
        ReplayOrchestrator.shared?.incrementRageTapTally()
    }
    
    internal fun reportDeadTap(location: PointF, target: String) {
        TelemetryPipeline.shared?.recordDeadTapEvent(
            target,
            location.x.toLong().coerceAtLeast(0),
            location.y.toLong().coerceAtLeast(0)
        )
        ReplayOrchestrator.shared?.incrementDeadTapTally()
    }
    
    internal fun reportInput(value: String, masked: Boolean, hint: String) {
        TelemetryPipeline.shared?.recordInputEvent(value, masked, hint)
    }
}

data class PointF(val x: Float, val y: Float) {
    fun distance(to: PointF): Float {
        val dx = x - to.x
        val dy = y - to.y
        return sqrt(dx * dx + dy * dy)
    }
}

enum class SwipeDirection(val label: String) {
    UP("up"),
    DOWN("down"),
    LEFT("left"),
    RIGHT("right")
}

private class GestureAggregator(
    private val recorder: InteractionRecorder,
    context: Context
) {
    private val gestureDetector: GestureDetector
    private val scaleDetector: ScaleGestureDetector
    
    private val recentTaps = mutableListOf<Pair<PointF, Long>>()
    private val rageTapThreshold = 3
    private val rageTapWindow: Long = 1000
    private val rageTapRadius: Float = 50f
    
    // Throttle pan/pinch/rotation events
    private var lastThrottleTime: Long = 0
    private val throttleInterval: Long = 100
    
    // Track scroll → swipe classification on ACTION_UP
    private var isScrolling = false
    private var lastScrollLocation: PointF? = null
    private var flingDetected = false
    
    // Track multi-touch for rotation
    private var previousAngle: Double? = null
    private var isMultiTouch = false
    
    init {
        gestureDetector = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent): Boolean {
                // Must return true so onSingleTapUp / onFling / etc. fire
                isScrolling = false
                flingDetected = false
                return true
            }
            
            override fun onSingleTapUp(e: MotionEvent): Boolean {
                val loc = PointF(e.rawX, e.rawY)
                val target = resolveTarget(loc)
                handleTap(loc, target)
                return true
            }
            
            override fun onLongPress(e: MotionEvent) {
                val loc = PointF(e.rawX, e.rawY)
                val target = resolveTarget(loc)
                recorder.reportLongPress(loc, target)
            }
            
            override fun onScroll(
                e1: MotionEvent?,
                e2: MotionEvent,
                distanceX: Float,
                distanceY: Float
            ): Boolean {
                isScrolling = true
                val loc = PointF(e2.rawX, e2.rawY)
                lastScrollLocation = loc
                val now = System.currentTimeMillis()
                if (now - lastThrottleTime >= throttleInterval) {
                    lastThrottleTime = now
                    val target = resolveTarget(loc)
                    recorder.reportPan(loc, target)
                }
                return true
            }
            
            override fun onFling(
                e1: MotionEvent?,
                e2: MotionEvent,
                velocityX: Float,
                velocityY: Float
            ): Boolean {
                flingDetected = true
                val loc = PointF(e2.rawX, e2.rawY)
                val target = resolveTarget(loc)
                val direction = classifyDirection(velocityX, velocityY)
                recorder.reportSwipe(loc, direction, target)
                return true
            }
        })
        gestureDetector.setIsLongpressEnabled(true)
        
        scaleDetector = ScaleGestureDetector(context,
            object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(detector: ScaleGestureDetector): Boolean {
                    val loc = PointF(detector.focusX, detector.focusY)
                    val now = System.currentTimeMillis()
                    if (now - lastThrottleTime >= throttleInterval) {
                        lastThrottleTime = now
                        val target = resolveTarget(loc)
                        recorder.reportPinch(loc, detector.scaleFactor.toDouble(), target)
                    }
                    return true
                }
                
                override fun onScaleEnd(detector: ScaleGestureDetector) {
                    val loc = PointF(detector.focusX, detector.focusY)
                    val target = resolveTarget(loc)
                    recorder.reportPinch(loc, detector.scaleFactor.toDouble(), target)
                }
            }
        )
    }
    
    fun processTouchEvent(event: MotionEvent) {
        scaleDetector.onTouchEvent(event)
        gestureDetector.onTouchEvent(event)
        processRotation(event)
        
        when (event.actionMasked) {
            MotionEvent.ACTION_UP -> {
                // If we were scrolling but no fling (swipe) was detected, emit scroll
                if (isScrolling && !flingDetected) {
                    val loc = lastScrollLocation ?: PointF(event.rawX, event.rawY)
                    val target = resolveTarget(loc)
                    recorder.reportScroll(loc, target)
                }
                resetState()
            }
            MotionEvent.ACTION_CANCEL -> resetState()
        }
    }
    
    private fun resetState() {
        isScrolling = false
        flingDetected = false
        lastScrollLocation = null
        previousAngle = null
        isMultiTouch = false
    }
    
    // --- Multi-touch rotation (no built-in Android detector) ---
    
    private fun processRotation(event: MotionEvent) {
        when (event.actionMasked) {
            MotionEvent.ACTION_POINTER_DOWN -> {
                if (event.pointerCount == 2) {
                    isMultiTouch = true
                    previousAngle = computeAngle(event)
                }
            }
            MotionEvent.ACTION_MOVE -> {
                if (isMultiTouch && event.pointerCount >= 2) {
                    val angle = computeAngle(event)
                    val prev = previousAngle
                    if (prev != null) {
                        val delta = angle - prev
                        if (abs(delta) > 0.01) {
                            val cx = (event.getX(0) + event.getX(1)) / 2
                            val cy = (event.getY(0) + event.getY(1)) / 2
                            val loc = PointF(cx, cy)
                            val now = System.currentTimeMillis()
                            if (now - lastThrottleTime >= throttleInterval) {
                                lastThrottleTime = now
                                val target = resolveTarget(loc)
                                recorder.reportRotation(loc, delta, target)
                            }
                        }
                    }
                    previousAngle = angle
                }
            }
            MotionEvent.ACTION_POINTER_UP -> {
                if (event.pointerCount <= 2) {
                    isMultiTouch = false
                    previousAngle = null
                }
            }
        }
    }
    
    private fun computeAngle(event: MotionEvent): Double {
        val dx = event.getX(1) - event.getX(0)
        val dy = event.getY(1) - event.getY(0)
        return Math.atan2(dy.toDouble(), dx.toDouble())
    }
    
    // --- Tap / rage-tap ---
    
    private fun handleTap(location: PointF, target: String) {
        val now = System.currentTimeMillis()
        recentTaps.add(Pair(location, now))
        pruneOldTaps()
        
        val nearby = recentTaps.filter { it.first.distance(location) < rageTapRadius }
        if (nearby.size >= rageTapThreshold) {
            recorder.reportRageTap(location, nearby.size, target)
            recentTaps.clear()
        } else {
            recorder.reportTap(location, target)
            // Dead tap detection moved to JS side — native view hierarchy inspection
            // is unreliable in React Native since touch handling is JS-based.
        }
    }
    
    private fun pruneOldTaps() {
        val cutoff = System.currentTimeMillis() - rageTapWindow
        recentTaps.removeIf { it.second < cutoff }
    }
    
    // --- Helpers ---
    
    private fun classifyDirection(velocityX: Float, velocityY: Float): SwipeDirection {
        return if (abs(velocityX) > abs(velocityY)) {
            if (velocityX > 0) SwipeDirection.RIGHT else SwipeDirection.LEFT
        } else {
            if (velocityY > 0) SwipeDirection.DOWN else SwipeDirection.UP
        }
    }
    
    private fun resolveTarget(location: PointF): String {
        return "view_${location.x.toInt()}_${location.y.toInt()}"
    }
}
