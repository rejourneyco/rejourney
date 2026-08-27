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

import kotlin.test.Test
import kotlin.test.assertEquals

internal class RetainedCapturePolicyTest {
    @Test
    fun periodicFallbackUsesLowFrequencyHeartbeat() {
        assertEquals(
            11_000L,
            RetainedCapturePolicy.remainingDelayMs(
                nowMs = 14_000L,
                lastCaptureStartedAtMs = 10_000L,
                lastVisualChangeAtMs = 0L,
                explicitVisualChange = false
            )
        )
    }

    @Test
    fun explicitVisualChangeCanCaptureSoonerThanHeartbeat() {
        assertEquals(
            0L,
            RetainedCapturePolicy.remainingDelayMs(
                nowMs = 14_000L,
                lastCaptureStartedAtMs = 10_000L,
                lastVisualChangeAtMs = 12_500L,
                explicitVisualChange = true
            )
        )
    }

    @Test
    fun explicitVisualChangeWaitsForUiToSettle() {
        // Capture ran 1.4s ago (interval leaves 100ms) but the UI changed just
        // now, so the 600ms settle window is the binding constraint.
        assertEquals(
            600L,
            RetainedCapturePolicy.remainingDelayMs(
                nowMs = 20_000L,
                lastCaptureStartedAtMs = 18_600L,
                lastVisualChangeAtMs = 20_000L,
                explicitVisualChange = true
            )
        )
    }

    @Test
    fun continuousInteractionDoesNotStarveCapture() {
        // A change landed 1ms ago and they keep coming, so the settle window
        // would defer forever. Past MAX_SETTLE_DEFERRAL_MS since the last
        // capture, capture goes ahead anyway.
        assertEquals(
            0L,
            RetainedCapturePolicy.remainingDelayMs(
                nowMs = 20_000L,
                lastCaptureStartedAtMs = 16_000L,
                lastVisualChangeAtMs = 19_999L,
                explicitVisualChange = true
            )
        )
    }

    @Test
    fun minimumIntervalStillFloorsCaptureRate() {
        // Capture ran 500ms ago, so the 1.5s interval governs and outweighs the
        // shorter settle window -- pacing is never faster than the interval.
        assertEquals(
            1_000L,
            RetainedCapturePolicy.remainingDelayMs(
                nowMs = 20_000L,
                lastCaptureStartedAtMs = 19_500L,
                lastVisualChangeAtMs = 19_999L,
                explicitVisualChange = true
            )
        )
    }
}
