/**
 * Gesture recognition and classification.
 * Android implementation aligned with iOS RJGestureClassifier.
 */
package com.rejourney.touch

import android.graphics.PointF
import com.rejourney.core.Constants
import com.rejourney.core.GestureType
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.sqrt

class GestureClassifier {
    var lastTapTime: Long = 0
    var lastTapPoint: PointF = PointF(0f, 0f)
    var tapCount: Int = 0
    var maxForce: Float = 0f
    var initialPinchDistance: Float = 0f
    var initialRotationAngle: Float = 0f

    fun resetState() {
        lastTapTime = 0
        lastTapPoint = PointF(0f, 0f)
        tapCount = 0
        maxForce = 0f
        initialPinchDistance = 0f
        initialRotationAngle = 0f
    }

    fun classifySingleTouchPath(touches: List<Map<String, Any?>>, duration: Long): String {
        if (touches.size < 2) {
            return classifyStationaryGesture(duration)
        }

        val first = touches.firstOrNull() ?: return GestureType.TAP
        val last = touches.lastOrNull() ?: return GestureType.TAP

        val dx = (numberFrom(first["x"]) - numberFrom(last["x"])) * -1f
        val dy = (numberFrom(first["y"]) - numberFrom(last["y"])) * -1f
        val distance = sqrt(dx * dx + dy * dy)

        if (distance < 10f) {
            return classifyStationaryGesture(duration)
        }

        return classifyMovementGesture(dx, dy, distance)
    }

    fun classifyMultiTouchPaths(
        touchPaths: Map<Int, List<Map<String, Any?>>>?,
        duration: Long,
        touchCount: Int
    ): String {
        if (touchPaths == null || touchCount <= 0) {
            return GestureType.TAP
        }

        return try {
            when (touchCount) {
                1 -> classifySingleTouchPath(touchPaths.values.firstOrNull() ?: emptyList(), duration)
                2 -> classifyTwoFingerGesture(touchPaths)
                3 -> GestureType.THREE_FINGER_GESTURE
                else -> GestureType.MULTI_TOUCH
            }
        } catch (_: Exception) {
            GestureType.TAP
        }
    }

    private fun classifyStationaryGesture(duration: Long): String {
        if (maxForce > Constants.FORCE_TOUCH_THRESHOLD) {
            return GestureType.FORCE_TOUCH
        }

        val currentTime = System.currentTimeMillis()
        if (checkDoubleTap(currentTime)) {
            return GestureType.DOUBLE_TAP
        }

        return if (duration > Constants.LONG_PRESS_MIN_DURATION) {
            GestureType.LONG_PRESS
        } else {
            GestureType.TAP
        }
    }

    private fun checkDoubleTap(currentTime: Long): Boolean {
        if (lastTapTime <= 0) {
            tapCount = 1
            lastTapTime = currentTime
            return false
        }

        if (currentTime - lastTapTime >= Constants.DOUBLE_TAP_MAX_INTERVAL) {
            tapCount = 1
            lastTapTime = currentTime
            return false
        }

        tapCount++
        lastTapTime = currentTime

        if (tapCount >= 2) {
            tapCount = 0
            lastTapTime = 0
            return true
        }

        return false
    }

    private fun classifyMovementGesture(dx: Float, dy: Float, distance: Float): String {
        if (abs(dy) > abs(dx) && abs(dy) > Constants.SWIPE_MIN_DISTANCE) {
            return if (dy > 0) GestureType.SCROLL_DOWN else GestureType.SCROLL_UP
        }

        if (abs(dx) > abs(dy)) {
            return if (dx > 0) GestureType.SWIPE_RIGHT else GestureType.SWIPE_LEFT
        }

        return if (dy > 0) GestureType.SWIPE_DOWN else GestureType.SWIPE_UP
    }

    private fun classifyTwoFingerGesture(
        touchPaths: Map<Int, List<Map<String, Any?>>>
    ): String {
        val touchIds = touchPaths.keys.toList()
        if (touchIds.size < 2) {
            return GestureType.TAP
        }

        val path1 = touchPaths[touchIds[0]]
        val path2 = touchPaths[touchIds[1]]

        if (path1 == null || path2 == null || path1.size < 2 || path2.size < 2) {
            return GestureType.TWO_FINGER_TAP
        }

        val start1 = path1.firstOrNull() ?: return GestureType.TWO_FINGER_TAP
        val start2 = path2.firstOrNull() ?: return GestureType.TWO_FINGER_TAP
        val end1 = path1.lastOrNull() ?: return GestureType.TWO_FINGER_TAP
        val end2 = path2.lastOrNull() ?: return GestureType.TWO_FINGER_TAP

        val startDx = numberFrom(start1["x"]) - numberFrom(start2["x"])
        val startDy = numberFrom(start1["y"]) - numberFrom(start2["y"])
        val startDistance = sqrt(startDx * startDx + startDy * startDy)

        if (!startDx.isFinite() || !startDy.isFinite() || startDistance < 1f) {
            return GestureType.MULTI_TOUCH
        }

        val endDx = numberFrom(end1["x"]) - numberFrom(end2["x"])
        val endDy = numberFrom(end1["y"]) - numberFrom(end2["y"])
        val endDistance = sqrt(endDx * endDx + endDy * endDy)

        checkPinchGesture(startDistance, endDistance)?.let { return it }
        checkRotationGesture(startDx, startDy, endDx, endDy)?.let { return it }
        checkPanGesture(start1, start2, end1, end2)?.let { return it }

        return GestureType.TWO_FINGER_TAP
    }

    private fun checkPinchGesture(startDistance: Float, endDistance: Float): String? {
        val distanceChange = endDistance - startDistance
        val distanceChangePercent = abs(distanceChange) / startDistance

        return if (distanceChangePercent > Constants.PINCH_MIN_CHANGE_PERCENT &&
            abs(distanceChange) > Constants.PINCH_MIN_DISTANCE
        ) {
            if (distanceChange > 0) GestureType.PINCH_OUT else GestureType.PINCH_IN
        } else {
            null
        }
    }

    private fun checkRotationGesture(
        startDx: Float,
        startDy: Float,
        endDx: Float,
        endDy: Float
    ): String? {
        val startAngle = atan2(startDy, startDx)
        val endAngle = atan2(endDy, endDx)
        var angleDiff = endAngle - startAngle

        val pi = Math.PI.toFloat()

        while (angleDiff > pi) angleDiff -= 2 * pi
        while (angleDiff < -pi) angleDiff += 2 * pi

        val rotationDegrees = angleDiff * (180f / pi)

        return if (abs(rotationDegrees) > Constants.ROTATION_MIN_ANGLE) {
            if (rotationDegrees > 0) GestureType.ROTATE_CCW else GestureType.ROTATE_CW
        } else {
            null
        }
    }

    private fun checkPanGesture(
        start1: Map<String, Any?>,
        start2: Map<String, Any?>,
        end1: Map<String, Any?>,
        end2: Map<String, Any?>
    ): String? {
        val centerStartX = (numberFrom(start1["x"]) + numberFrom(start2["x"])) / 2f
        val centerStartY = (numberFrom(start1["y"]) + numberFrom(start2["y"])) / 2f
        val centerEndX = (numberFrom(end1["x"]) + numberFrom(end2["x"])) / 2f
        val centerEndY = (numberFrom(end1["y"]) + numberFrom(end2["y"])) / 2f

        val centerDx = centerEndX - centerStartX
        val centerDy = centerEndY - centerStartY
        val centerDistance = sqrt(centerDx * centerDx + centerDy * centerDy)

        if (centerDistance > Constants.PINCH_MIN_DISTANCE) {
            return if (abs(centerDy) > abs(centerDx)) {
                if (centerDy > 0) GestureType.PAN_DOWN else GestureType.PAN_UP
            } else {
                if (centerDx > 0) GestureType.PAN_RIGHT else GestureType.PAN_LEFT
            }
        }

        return null
    }

    private fun numberFrom(value: Any?): Float {
        return when (value) {
            is Number -> value.toFloat()
            else -> 0f
        }
    }
}
