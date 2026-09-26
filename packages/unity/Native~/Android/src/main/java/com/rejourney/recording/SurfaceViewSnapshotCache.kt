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

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.PixelCopy
import android.view.SurfaceView
import com.rejourney.engine.DiagnosticLog
import java.util.WeakHashMap
import kotlin.math.max

/**
 * Non-blocking PixelCopy cache for video SurfaceViews.
 *
 * PixelCopy delivers its result asynchronously. Waiting for that callback from
 * the main-thread capture loop can stall interaction for several frames, so a
 * capture draws the last completed copy and starts at most one refresh. The
 * first capture is deferred until pixels are available.
 */
internal object SurfaceViewSnapshotCache {
    private const val RETRY_DELAY_MS = 1_000L

    private data class Entry(
        var bitmap: Bitmap? = null,
        var spareBitmap: Bitmap? = null,
        var inFlight: Boolean = false,
        var retryAfterUptimeMs: Long = 0L,
        var requestId: Long = 0L,
    )

    private val lock = Any()
    private val entries = WeakHashMap<SurfaceView, Entry>()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var generation = 0L

    fun clear() {
        synchronized(lock) {
            generation += 1
            entries.values.forEach { entry ->
                entry.bitmap?.takeIf { !it.isRecycled }?.recycle()
                entry.spareBitmap
                    ?.takeIf { it !== entry.bitmap && !it.isRecycled }
                    ?.recycle()
            }
            entries.clear()
        }
    }

    /** Returns false only while a visible surface has no completed copy yet. */
    fun composite(
        view: SurfaceView,
        canvas: Canvas,
        left: Float,
        top: Float,
        screenScale: Float,
    ): Boolean {
        if (view.width <= 0 || view.height <= 0) return true

        var request: Request? = null
        var ready = false
        synchronized(lock) {
            val entry = entries.getOrPut(view) { Entry() }
            entry.bitmap?.takeIf { !it.isRecycled }?.let { cached ->
                canvas.drawBitmap(
                    cached,
                    null,
                    RectF(left, top, left + view.width, top + view.height),
                    null,
                )
                ready = true
            }

            if (!entry.inFlight && SystemClock.uptimeMillis() >= entry.retryAfterUptimeMs) {
                val divisor = screenScale.takeIf { it.isFinite() && it > 0f } ?: 1f
                val destinationWidth = max(1, (view.width / divisor).toInt())
                val destinationHeight = max(1, (view.height / divisor).toInt())
                val reusable = entry.spareBitmap?.takeIf {
                    !it.isRecycled && it.width == destinationWidth && it.height == destinationHeight
                }
                if (reusable != null) {
                    entry.spareBitmap = null
                } else {
                    entry.spareBitmap?.takeIf { !it.isRecycled }?.recycle()
                    entry.spareBitmap = null
                }
                val destination = reusable ?: Bitmap.createBitmap(
                    destinationWidth,
                    destinationHeight,
                    Bitmap.Config.ARGB_8888,
                )
                entry.inFlight = true
                entry.requestId += 1
                request = Request(view, destination, generation, entry.requestId, ready)
            }
        }

        request?.let(::requestCopy)
        return ready
    }

    private data class Request(
        val view: SurfaceView,
        val destination: Bitmap,
        val generation: Long,
        val requestId: Long,
        val hadCachedFrame: Boolean,
    )

    private fun requestCopy(request: Request) {
        try {
            PixelCopy.request(
                request.view,
                request.destination,
                { result -> complete(request, result) },
                mainHandler,
            )
        } catch (error: Exception) {
            DiagnosticLog.trace("[VisualCapture] SurfaceView PixelCopy request failed: ${error.message}")
            complete(request, PixelCopy.ERROR_UNKNOWN)
        }
    }

    private fun complete(request: Request, result: Int) {
        var requestImmediateCapture = false
        synchronized(lock) {
            val entry = entries[request.view]
            val isCurrent =
                request.generation == generation &&
                    entry != null &&
                    entry.requestId == request.requestId

            if (!isCurrent) {
                request.destination.recycle()
                return
            }

            entry.inFlight = false
            if (result == PixelCopy.SUCCESS) {
                val previous = entry.bitmap
                entry.bitmap = request.destination
                entry.spareBitmap = previous?.takeIf {
                    it !== request.destination && !it.isRecycled
                }
                entry.retryAfterUptimeMs = 0L
                requestImmediateCapture = !request.hadCachedFrame
            } else {
                entry.spareBitmap?.takeIf {
                    it !== request.destination && !it.isRecycled
                }?.recycle()
                entry.spareBitmap = request.destination.takeIf { !it.isRecycled }
                entry.retryAfterUptimeMs = SystemClock.uptimeMillis() + RETRY_DELAY_MS
            }
        }

        if (requestImmediateCapture) {
            VisualCapture.shared?.snapshotWhenSafe()
        }
    }
}
