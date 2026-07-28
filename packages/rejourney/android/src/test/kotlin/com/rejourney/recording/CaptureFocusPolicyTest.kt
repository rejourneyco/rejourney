package com.rejourney.recording

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

internal class CaptureFocusPolicyTest {
    @Test
    fun productionCaptureRequiresForegroundWindowOrNativeSheet() {
        assertFalse(
            shouldAttemptCapture(
                hasWindowFocus = false,
                allowUnfocusedCaptureForTesting = false,
                hasCapturableNativeSheet = false
            )
        )
        assertTrue(
            shouldAttemptCapture(
                hasWindowFocus = true,
                allowUnfocusedCaptureForTesting = false,
                hasCapturableNativeSheet = false
            )
        )
        assertTrue(
            shouldAttemptCapture(
                hasWindowFocus = false,
                allowUnfocusedCaptureForTesting = false,
                hasCapturableNativeSheet = true
            )
        )
    }

    @Test
    fun debugCaptureCanRunOnHeadlessTestActivity() {
        assertTrue(
            shouldAttemptCapture(
                hasWindowFocus = false,
                allowUnfocusedCaptureForTesting = true,
                hasCapturableNativeSheet = false
            )
        )
    }
}
