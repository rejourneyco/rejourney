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

import kotlin.math.max

/**
 * Cadence for the expensive retained-layer compatibility capture.
 *
 * Normal Android Flutter capture continues to use PixelCopy at the configured
 * snapshot interval. These longer delays apply only after PixelCopy has
 * returned an unusable black Flutter frame.
 */
internal object RetainedCapturePolicy {
    const val VISUAL_CHANGE_MIN_INTERVAL_MS = 5_000L
    const val HEARTBEAT_INTERVAL_MS = 15_000L
    const val VISUAL_SETTLE_DELAY_MS = 2_500L

    fun remainingDelayMs(
        nowMs: Long,
        lastCaptureStartedAtMs: Long,
        lastVisualChangeAtMs: Long,
        explicitVisualChange: Boolean
    ): Long {
        val minimumInterval = if (explicitVisualChange) {
            VISUAL_CHANGE_MIN_INTERVAL_MS
        } else {
            HEARTBEAT_INTERVAL_MS
        }
        val captureDelay = if (lastCaptureStartedAtMs <= 0L) {
            0L
        } else {
            (minimumInterval - (nowMs - lastCaptureStartedAtMs)).coerceAtLeast(0L)
        }
        val settleDelay = if (lastVisualChangeAtMs <= 0L) {
            0L
        } else {
            (VISUAL_SETTLE_DELAY_MS - (nowMs - lastVisualChangeAtMs))
                .coerceAtLeast(0L)
        }
        return max(captureDelay, settleDelay)
    }
}
