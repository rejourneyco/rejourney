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
            1_000L,
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
        assertEquals(
            2_000L,
            RetainedCapturePolicy.remainingDelayMs(
                nowMs = 20_500L,
                lastCaptureStartedAtMs = 10_000L,
                lastVisualChangeAtMs = 20_000L,
                explicitVisualChange = true
            )
        )
    }
}
