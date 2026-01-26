/**
 * Common type definitions used throughout the SDK.
 * Ported from iOS RJTypes.h/m
 */
package com.rejourney.core

/**
 * Represents the importance level of a capture event.
 * Higher importance events are less likely to be skipped during throttling.
 */
enum class CaptureImportance(val value: Int) {
    /** Low importance - can be freely skipped (e.g., heartbeat) */
    LOW(0),
    
    /** Medium importance - skip only under heavy load (e.g., tap gestures) */
    MEDIUM(1),
    
    /** High importance - rarely skip (e.g., scroll events) */
    HIGH(2),
    
    /** Critical importance - never skip (e.g., navigation, app lifecycle) */
    CRITICAL(3)
}

/**
 * Represents the current performance level of the capture engine.
 * The engine adjusts its behavior based on system conditions.
 */
enum class PerformanceLevel(val value: Int) {
    /** Normal operation - full capture rate */
    NORMAL(0),
    
    /** Reduced rate due to low battery or thermal throttling */
    REDUCED(1),
    
    /** Minimal captures due to memory pressure */
    MINIMAL(2),
    
    /** All non-critical captures paused */
    PAUSED(3)
}

/**
 * Represents recognized gesture types.
 */
object GestureType {
    const val TAP = "tap"
    const val DOUBLE_TAP = "double_tap"
    const val LONG_PRESS = "long_press"
    const val FORCE_TOUCH = "force_touch"
    const val SWIPE_LEFT = "swipe_left"
    const val SWIPE_RIGHT = "swipe_right"
    const val SWIPE_UP = "swipe_up"
    const val SWIPE_DOWN = "swipe_down"
    const val SCROLL_UP = "scroll_up"
    const val SCROLL_DOWN = "scroll_down"
    const val PINCH_IN = "pinch_in"
    const val PINCH_OUT = "pinch_out"
    const val ROTATE_CW = "rotate_cw"
    const val ROTATE_CCW = "rotate_ccw"
    const val PAN_UP = "pan_up"
    const val PAN_DOWN = "pan_down"
    const val PAN_LEFT = "pan_left"
    const val PAN_RIGHT = "pan_right"
    const val TWO_FINGER_TAP = "two_finger_tap"
    const val THREE_FINGER_GESTURE = "three_finger_gesture"
    const val MULTI_TOUCH = "multi_touch"
    const val KEYBOARD_TAP = "keyboard_tap"
}

/**
 * Represents session event types for logging.
 */
object EventType {
    const val SESSION_START = "session_start"
    const val SESSION_END = "session_end"
    const val SESSION_TIMEOUT = "session_timeout"
    const val NAVIGATION = "navigation"
    const val GESTURE = "gesture"
    const val VISUAL_CHANGE = "visual_change"
    const val KEYBOARD_SHOW = "keyboard_show"
    const val KEYBOARD_HIDE = "keyboard_hide"
    const val KEYBOARD_TYPING = "keyboard_typing"
    const val APP_BACKGROUND = "app_background"
    const val APP_FOREGROUND = "app_foreground"
    const val APP_TERMINATED = "app_terminated"
    const val EXTERNAL_URL_OPENED = "external_url_opened"
    const val OAUTH_STARTED = "oauth_started"
    const val OAUTH_COMPLETED = "oauth_completed"
    const val OAUTH_RETURNED = "oauth_returned"
}

/**
 * Result type for session operations
 */
data class SessionResult(
    val success: Boolean,
    val sessionId: String = "",
    val error: String? = null,
    val uploadSuccess: Boolean? = null,
    val warning: String? = null
)

/**
 * SDK telemetry metrics for observability
 */
data class SDKMetrics(
    val uploadSuccessCount: Int = 0,
    val uploadFailureCount: Int = 0,
    val retryAttemptCount: Int = 0,
    val circuitBreakerOpenCount: Int = 0,
    val memoryEvictionCount: Int = 0,
    val offlinePersistCount: Int = 0,
    val sessionStartCount: Int = 0,
    val crashCount: Int = 0,
    val anrCount: Int = 0,
    val uploadSuccessRate: Float = 0f,
    val avgUploadDurationMs: Long = 0,
    val currentQueueDepth: Int = 0,
    val lastUploadTime: Long? = null,
    val lastRetryTime: Long? = null,
    val totalBytesUploaded: Long = 0,
    val totalBytesEvicted: Long = 0
)
