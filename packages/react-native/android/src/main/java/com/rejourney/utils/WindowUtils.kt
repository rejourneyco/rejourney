/**
 * Window and view utilities.
 * Android implementation aligned with iOS RJWindowUtils.
 */
package com.rejourney.utils

import android.app.Activity
import android.content.Context
import android.view.View
import android.view.Window
import com.facebook.react.bridge.ReactApplicationContext
import java.security.SecureRandom

object WindowUtils {
    private val random = SecureRandom()

    /**
     * Returns the current key window.
     */
    fun keyWindow(context: Context): Window? {
        return try {
            when (context) {
                is ReactApplicationContext -> context.currentActivity?.window
                is Activity -> context.window
                else -> null
            }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Get the current activity's window.
     */
    fun getCurrentWindow(context: Context): Window? = keyWindow(context)

    /**
     * Get the current activity.
     */
    fun getCurrentActivity(context: Context): Activity? {
        return try {
            when (context) {
                is ReactApplicationContext -> context.currentActivity
                is Activity -> context
                else -> null
            }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Finds the accessibility label for a view or its ancestors.
     */
    fun accessibilityLabelForView(view: View?): String? {
        var current = view
        while (current != null) {
            val label = current.contentDescription?.toString()?.trim()
            if (!label.isNullOrEmpty()) {
                return label
            }
            val parent = current.parent
            current = if (parent is View) parent else null
        }
        return null
    }

    /**
     * Generates a unique session ID.
     * Format: session_{timestamp}_{random_hex}
     */
    fun generateSessionId(): String {
        val timestamp = System.currentTimeMillis()
        val bytes = ByteArray(4)
        random.nextBytes(bytes)
        val hex = bytes.joinToString("") { "%02X".format(it) }
        return "session_${timestamp}_$hex"
    }

    /**
     * Returns the current timestamp in milliseconds.
     */
    fun currentTimestampMillis(): Long = System.currentTimeMillis()
}
