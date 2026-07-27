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

/**
 * Classifies sampled pixels without relying on Android graphics APIs so the
 * detector can be covered by ordinary JVM unit tests.
 */
internal object FrameContentAnalyzer {
    fun isEffectivelyBlack(sampledArgb: IntArray): Boolean {
        var visible = 0
        var nearBlack = 0
        var nonBlack = 0
        var minimumLuma = 255
        var maximumLuma = 0

        for (pixel in sampledArgb) {
            val alpha = pixel ushr 24 and 0xff
            if (alpha <= 16) continue

            val red = pixel ushr 16 and 0xff
            val green = pixel ushr 8 and 0xff
            val blue = pixel and 0xff
            val luma = (red * 54 + green * 183 + blue * 19) ushr 8

            visible++
            minimumLuma = minOf(minimumLuma, luma)
            maximumLuma = maxOf(maximumLuma, luma)
            if (red < 28 && green < 28 && blue < 28) {
                nearBlack++
            } else {
                nonBlack++
            }
        }

        if (visible == 0) return true

        val nearBlackRatio = nearBlack.toDouble() / visible.toDouble()
        val meaningfulSignalFloor = maxOf(2, (visible * 0.01).toInt())
        return (nearBlackRatio >= 0.985 && maximumLuma < 48) ||
            (nonBlack <= meaningfulSignalFloor && maximumLuma - minimumLuma < 12)
    }
}
