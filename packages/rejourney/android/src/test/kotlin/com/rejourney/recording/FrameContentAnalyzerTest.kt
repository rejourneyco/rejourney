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
import kotlin.test.assertFalse
import kotlin.test.assertTrue

internal class FrameContentAnalyzerTest {
    @Test
    fun classifiesOpaqueAndTransparentBlackFrames() {
        assertTrue(
            FrameContentAnalyzer.isEffectivelyBlack(
                IntArray(576) { 0xff000000.toInt() }
            )
        )
        assertTrue(FrameContentAnalyzer.isEffectivelyBlack(IntArray(576)))
    }

    @Test
    fun toleratesSmallReadbackNoiseInAnOtherwiseBlackFrame() {
        val samples = IntArray(576) { 0xff050505.toInt() }
        samples[20] = 0xff111111.toInt()
        samples[300] = 0xff151515.toInt()

        assertTrue(FrameContentAnalyzer.isEffectivelyBlack(samples))
    }

    @Test
    fun preservesIntentionallyDarkInterfacesWithVisibleContent() {
        val samples = IntArray(576) { 0xff080d12.toInt() }
        repeat(18) { index ->
            samples[index * 23] = if (index % 2 == 0) {
                0xfff8fafc.toInt()
            } else {
                0xff22d3ee.toInt()
            }
        }

        assertFalse(FrameContentAnalyzer.isEffectivelyBlack(samples))
    }

    @Test
    fun classifiesNormalColorFramesAsVisible() {
        val samples = IntArray(576) { index ->
            when (index % 4) {
                0 -> 0xff2563eb.toInt()
                1 -> 0xfff97316.toInt()
                2 -> 0xff16a34a.toInt()
                else -> 0xfff8fafc.toInt()
            }
        }

        assertFalse(FrameContentAnalyzer.isEffectivelyBlack(samples))
    }
}
