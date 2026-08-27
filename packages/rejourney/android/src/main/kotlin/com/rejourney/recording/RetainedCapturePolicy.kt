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
 * Paces retained-layer capture on the Android renderers that need it.
 *
 * A retained readback is expensive, so this exists to keep it off the critical
 * path. The balance it strikes matters though: pacing that is too coarse buys
 * performance with replay fidelity, and the replay is the product.
 *
 * The idle heartbeat stays long, because an idle scene has nothing new to show.
 * The interactive interval is what a viewer actually sees, so it is kept tight.
 */
internal object RetainedCapturePolicy {
    /**
     * Minimum spacing while the UI is actually changing. This is the interval a
     * viewer perceives as the replay's frame rate, so it is deliberately close
     * to the base capture interval rather than a performance-first number.
     */
    const val VISUAL_CHANGE_MIN_INTERVAL_MS = 1_500L

    /** Idle spacing. Nothing is changing, so there is nothing to capture. */
    const val HEARTBEAT_INTERVAL_MS = 15_000L

    /**
     * How long to let the UI settle after a change before reading back, so a
     * frame is not captured mid-transition. Long enough for a route transition
     * to land, short enough that the transition itself is not skipped over.
     */
    const val VISUAL_SETTLE_DELAY_MS = 600L

    /**
     * Ceiling on how long the settle delay may keep deferring a capture.
     *
     * Without this, continuous interaction starves capture completely: every new
     * visual change pushes the settle window forward, so while a user scrolls or
     * drags, the "wait for it to settle" branch defers indefinitely and the most
     * active part of the session is the least recorded. Past this bound the
     * capture goes ahead even though the UI is still moving.
     */
    const val MAX_SETTLE_DEFERRAL_MS = 3_000L

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

        val sinceLastCapture = if (lastCaptureStartedAtMs <= 0L) {
            Long.MAX_VALUE
        } else {
            nowMs - lastCaptureStartedAtMs
        }
        // Once capture has been deferred this long, stop waiting for quiet.
        val settleDelay = if (lastVisualChangeAtMs <= 0L || sinceLastCapture >= MAX_SETTLE_DEFERRAL_MS) {
            0L
        } else {
            (VISUAL_SETTLE_DELAY_MS - (nowMs - lastVisualChangeAtMs))
                .coerceAtLeast(0L)
        }

        return max(captureDelay, settleDelay)
    }
}
