/**
 * Motion event tracking for scroll/pan reconstruction.
 * Ported from iOS RJMotionEvent.
 * 
 * Provides full motion event data matching iOS:
 * - Start/end timestamps (t0, t1)
 * - Displacement (dx, dy)
 * - Velocity (v0, v1)
 * - Animation curve type
 * - Computed properties (duration, distance, direction)
 */
package com.rejourney.capture

import com.rejourney.core.Constants
import kotlin.math.atan2
import kotlin.math.sqrt

/**
 * Motion curve types matching iOS RJMotionCurve.
 */
object MotionCurve {
    const val LINEAR = "linear"
    const val EXPONENTIAL_DECAY = "exponential_decay"
    const val EASE_OUT = "ease_out"
    const val BOUNCE = "bounce"
    const val SPRING = "spring"
}

/**
 * Motion types matching iOS RJMotionType.
 */
object MotionType {
    const val SCROLL = "scroll"
    const val PAN = "pan"
    const val SWIPE = "swipe"
    const val FLING = "fling"
}

/**
 * Full motion event data matching iOS RJMotionEvent.
 */
data class MotionEventData(
    val type: String,           // MotionType constant
    val t0: Long,               // Start timestamp (ms)
    val t1: Long,               // End timestamp (ms)
    val dx: Float,              // Delta X (dp)
    val dy: Float,              // Delta Y (dp)
    val v0: Float,              // Initial velocity
    val v1: Float = 0f,         // Final velocity (usually 0 for ended gestures)
    val curve: String = MotionCurve.LINEAR,  // Animation curve
    val targetId: String? = null  // Target element ID
) {
    /** Duration in milliseconds */
    val duration: Long
        get() = t1 - t0
    
    /** Total distance traveled (dp) */
    val distance: Float
        get() = sqrt(dx * dx + dy * dy)
    
    /** Average velocity (dp/s) */
    val averageVelocity: Float
        get() = if (duration > 0) distance / (duration / 1000f) else 0f
    
    /** Direction in radians */
    val direction: Float
        get() = atan2(dy, dx)
    
    /** Convert to dictionary matching iOS toDictionary format */
    fun toDictionary(): Map<String, Any?> = mapOf(
        "type" to type,
        "t0" to t0,
        "t1" to t1,
        "dx" to dx,
        "dy" to dy,
        "v0" to v0,
        "v1" to v1,
        "curve" to curve,
        "duration" to duration,
        "distance" to distance,
        "targetId" to targetId
    )
}

/**
 * Tracks motion events and calculates velocities.
 * Used for scroll event tracking and threshold-based emission.
 */
class MotionTracker {
    private var lastOffsetX: Float = 0f
    private var lastOffsetY: Float = 0f
    private var lastTimestamp: Long = 0
    private var accumulatedScrollDistance: Float = 0f
    
    // Start position for motion event creation
    private var scrollStartX: Float = 0f
    private var scrollStartY: Float = 0f
    private var scrollStartTime: Long = 0
    private var isScrolling: Boolean = false

    /**
     * Record a scroll offset and compute velocity.
     * @return MotionEventData if threshold exceeded, null otherwise
     */
    fun recordScrollOffset(offsetX: Float = 0f, offsetY: Float): MotionEventData? {
        val now = System.currentTimeMillis()
        val deltaTime = (now - lastTimestamp) / 1000f
        
        if (lastTimestamp == 0L) {
            lastOffsetX = offsetX
            lastOffsetY = offsetY
            lastTimestamp = now
            scrollStartX = offsetX
            scrollStartY = offsetY
            scrollStartTime = now
            isScrolling = true
            return null
        }

        val deltaX = offsetX - lastOffsetX
        val deltaY = offsetY - lastOffsetY
        val distance = sqrt(deltaX * deltaX + deltaY * deltaY)
        accumulatedScrollDistance += distance

        // Check if we should emit an event
        if (accumulatedScrollDistance >= Constants.DEFAULT_SCROLL_THRESHOLD) {
            val velocityX = if (deltaTime > 0) deltaX / deltaTime else 0f
            val velocityY = if (deltaTime > 0) deltaY / deltaTime else 0f
            val velocity = sqrt(velocityX * velocityX + velocityY * velocityY)
            
            // Determine scroll direction for type
            val scrollType = when {
                kotlin.math.abs(deltaY) > kotlin.math.abs(deltaX) -> 
                    if (deltaY > 0) "scroll_down" else "scroll_up"
                else -> 
                    if (deltaX > 0) "scroll_right" else "scroll_left"
            }
            
            val event = MotionEventData(
                type = scrollType,
                t0 = scrollStartTime,
                t1 = now,
                dx = offsetX - scrollStartX,
                dy = offsetY - scrollStartY,
                v0 = velocity,
                v1 = 0f,
                curve = MotionCurve.EXPONENTIAL_DECAY
            )

            accumulatedScrollDistance = 0f
            lastOffsetX = offsetX
            lastOffsetY = offsetY
            lastTimestamp = now
            scrollStartX = offsetX
            scrollStartY = offsetY
            scrollStartTime = now

            return event
        }

        lastOffsetX = offsetX
        lastOffsetY = offsetY
        lastTimestamp = now
        return null
    }

    /**
     * Reset tracking state (e.g., on new session).
     */
    fun reset() {
        lastOffsetX = 0f
        lastOffsetY = 0f
        lastTimestamp = 0
        accumulatedScrollDistance = 0f
        scrollStartX = 0f
        scrollStartY = 0f
        scrollStartTime = 0
        isScrolling = false
    }

    /**
     * Check if scroll has recently ended (no updates in SCROLL_END_DELAY).
     */
    fun isScrollEnded(): Boolean {
        if (lastTimestamp == 0L) return true
        val elapsed = (System.currentTimeMillis() - lastTimestamp) / 1000.0
        return elapsed > Constants.SCROLL_END_DELAY
    }
    
    /**
     * Create a motion event for the current scroll (used when scroll ends).
     */
    fun createScrollEndEvent(): MotionEventData? {
        if (!isScrolling) return null
        
        val now = System.currentTimeMillis()
        val dx = lastOffsetX - scrollStartX
        val dy = lastOffsetY - scrollStartY
        
        if (dx == 0f && dy == 0f) return null
        
        isScrolling = false
        
        return MotionEventData(
            type = MotionType.SCROLL,
            t0 = scrollStartTime,
            t1 = now,
            dx = dx,
            dy = dy,
            v0 = 0f,
            v1 = 0f,
            curve = MotionCurve.EXPONENTIAL_DECAY
        )
    }
}
