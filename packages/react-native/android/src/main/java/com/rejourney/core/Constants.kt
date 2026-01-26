/**
 * SDK-wide constants and configuration defaults.
 * Ported from iOS RJConstants.h/m
 */
package com.rejourney.core

object Constants {
    // SDK Version
    const val SDK_VERSION = "1.0.0"

    // Video Capture Configuration (H.264 Segment Mode)
    // These match iOS RJCaptureEngine defaults for performance
    
    /** Default capture scale factor (0.25 = 25% of original size) - matches iOS */
    const val DEFAULT_CAPTURE_SCALE = 0.25f

    /** Target video bitrate in bits per second (1.0 Mbps) - matches iOS */
    const val DEFAULT_VIDEO_BITRATE = 1_000_000

    /** Maximum video dimension in pixels (longest edge) - matches iOS */
    const val MAX_VIDEO_DIMENSION = 1920

    /** Target frames per second for video capture (15 FPS) - matches iOS */
    const val DEFAULT_VIDEO_FPS = 15

    /** Number of frames per segment before auto-rotation (60 frames = 60 seconds at 1 FPS) */
    const val DEFAULT_FRAMES_PER_SEGMENT = 60

    /** Keyframe interval in seconds (10s for better compression) - matches iOS */
    const val DEFAULT_KEYFRAME_INTERVAL = 10

    /** Minimum frame interval in seconds (1/15 ~= 0.0667) */
    const val DEFAULT_MIN_FRAME_INTERVAL = 0.0667

    /** Maximum frames allowed per minute (15 FPS * 60s) */
    const val DEFAULT_MAX_FRAMES_PER_MINUTE = 900

    /** Segment duration in seconds (for planning purposes) */
    const val DEFAULT_SEGMENT_DURATION_SECONDS = 60

    // Motion Event Configuration
    /** Minimum interval between motion events (0.016 = 60 FPS motion capture) */
    const val DEFAULT_MOTION_EVENT_INTERVAL = 0.016
    
    /** Minimum velocity to record scroll motion (points/second) */
    const val MOTION_VELOCITY_THRESHOLD = 10f
    
    /** Scroll distance threshold for motion events (points) */
    const val DEFAULT_SCROLL_THRESHOLD = 5f
    
    /** Time after last scroll event to consider scroll ended (seconds) */
    const val SCROLL_END_DELAY = 0.15

    // Memory Thresholds
    /** Memory warning threshold in bytes (100MB) */
    const val MEMORY_WARNING_THRESHOLD_BYTES = 100L * 1024 * 1024
    
    /** Maximum frame data bytes to keep in memory */
    // Frames are sparse but can be large (data URIs). Too low causes aggressive eviction
    // before the upload timer drains, especially during crashes/offline.
    const val MAX_FRAME_BYTES_IN_MEMORY = 4L * 1024 * 1024
    
    /** Default maximum frames to keep in memory */
    const val DEFAULT_MAX_FRAMES_IN_MEMORY = 20

    // Performance Thresholds
    /** Battery level threshold for low-power mode (15%) */
    const val LOW_BATTERY_THRESHOLD = 0.15f
    
    /** Maximum consecutive captures before cooldown */
    const val MAX_CONSECUTIVE_CAPTURES = 5
    
    /** Cooldown duration after max consecutive captures (seconds) */
    const val CAPTURE_COOLDOWN_SECONDS = 1.0

    // Upload Configuration
    /** Batch upload interval in seconds */
    const val BATCH_UPLOAD_INTERVAL = 5.0
    
    /** Initial upload delay for short sessions (seconds) */
    const val INITIAL_UPLOAD_DELAY = 1.0
    
    /** Network request timeout (seconds) */
    const val NETWORK_REQUEST_TIMEOUT = 60.0
    
    /** Network resource timeout (seconds) */
    const val NETWORK_RESOURCE_TIMEOUT = 120.0

    // Session Configuration
    /** Background duration threshold for new session (seconds) - 60 seconds matches iOS */
    const val BACKGROUND_SESSION_TIMEOUT = 60.0

    // Gesture Detection
    /** Maximum time between taps for double-tap detection (milliseconds) */
    const val DOUBLE_TAP_MAX_INTERVAL = 300.0
    
    /** Maximum distance between taps for double-tap detection (points) */
    const val DOUBLE_TAP_MAX_DISTANCE = 50f
    
    /** Minimum duration for long press detection (milliseconds) */
    const val LONG_PRESS_MIN_DURATION = 500.0
    
    /** Minimum distance for swipe gesture detection (points) */
    const val SWIPE_MIN_DISTANCE = 50f
    
    /** Force touch threshold (normalized force value) */
    const val FORCE_TOUCH_THRESHOLD = 2.0f

    /** Minimum distance for pinch gesture detection (points) */
    const val PINCH_MIN_DISTANCE = 30f
    
    /** Minimum distance change percentage for pinch detection */
    const val PINCH_MIN_CHANGE_PERCENT = 0.2f
    
    /** Minimum rotation angle for rotation gesture detection (degrees) */
    const val ROTATION_MIN_ANGLE = 15f
}
