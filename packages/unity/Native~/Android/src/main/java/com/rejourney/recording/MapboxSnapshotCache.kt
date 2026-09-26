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
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import com.rejourney.engine.DiagnosticLog
import java.lang.ref.WeakReference
import java.lang.reflect.Proxy

/**
 * Non-blocking Mapbox snapshot bridge.
 *
 * Mapbox documents snapshot() as synchronous and UI-thread blocking, while
 * snapshot(OnSnapshotReady) is asynchronous. The capture path therefore draws
 * the most recent idle snapshot and requests at most one refresh for each map
 * idle epoch. It never waits for renderer readback on the main thread.
 */
internal object MapboxSnapshotCache {
    private const val REQUEST_TIMEOUT_MS = 5_000L
    private const val RETRY_DELAY_MS = 5_000L
    private val lock = Any()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var inFlightRequestId: Long? = null
    private var nextRequestId = 0L
    private var mapView = WeakReference<View>(null)
    private var bitmap: Bitmap? = null
    private var needsRefresh = true
    private var generation = 0L
    private var asyncSnapshotUnsupportedClass: Class<*>? = null
    private var retryAfterUptimeMs = 0L

    fun invalidate() {
        synchronized(lock) {
            needsRefresh = true
            generation += 1
            // The old callback is stale for the new camera epoch. Do not let a
            // slow or lost renderer callback block the next settled snapshot.
            inFlightRequestId = null
            retryAfterUptimeMs = 0L
        }
    }

    fun clear() {
        synchronized(lock) {
            generation += 1
            needsRefresh = true
            mapView.clear()
            bitmap?.recycle()
            bitmap = null
            asyncSnapshotUnsupportedClass = null
            inFlightRequestId = null
            nextRequestId = 0L
            retryAfterUptimeMs = 0L
        }
    }

    /** Returns false only when a Mapbox view exists but no stable snapshot is ready. */
    fun composite(map: View, canvas: Canvas, left: Float, top: Float): Boolean {
        var shouldRequest = false
        var requestGeneration = 0L
        var requestId = 0L
        synchronized(lock) {
            if (mapView.get() !== map) {
                generation += 1
                needsRefresh = true
                bitmap?.recycle()
                bitmap = null
                mapView = WeakReference(map)
                asyncSnapshotUnsupportedClass = null
                inFlightRequestId = null
                retryAfterUptimeMs = 0L
            }
            if (!needsRefresh) {
                bitmap?.takeIf { !it.isRecycled }?.let { canvas.drawBitmap(it, left, top, null) }
            }
            if (
                needsRefresh &&
                asyncSnapshotUnsupportedClass !== map.javaClass &&
                inFlightRequestId == null &&
                SystemClock.uptimeMillis() >= retryAfterUptimeMs
            ) {
                shouldRequest = true
                requestGeneration = generation
                requestId = ++nextRequestId
                inFlightRequestId = requestId
            }
        }
        if (shouldRequest) requestAsync(map, requestGeneration, requestId)
        // Older Mapbox generations may not expose an async listener overload.
        // Preserve capture (possibly with the platform's base rendering) rather
        // than permanently suppressing every frame on those versions.
        return synchronized(lock) {
            (!needsRefresh && bitmap?.isRecycled == false) || asyncSnapshotUnsupportedClass === map.javaClass
        }
    }

    private fun requestAsync(map: View, requestGeneration: Long, requestId: Long) {
        try {
            val snapshotMethod = map.javaClass.methods.firstOrNull { method ->
                (method.name == "snapshot" || method.name == "getSnapshot") &&
                    method.parameterTypes.size == 1 &&
                    method.parameterTypes[0].isInterface
            } ?: run {
                markUnsupported(map, requestId)
                return
            }
            val callbackType = snapshotMethod.parameterTypes[0]
            val callback = Proxy.newProxyInstance(
                map.javaClass.classLoader,
                arrayOf(callbackType)
            ) { _, method, args ->
                when (method.name) {
                    "hashCode" -> System.identityHashCode(callbackType)
                    "toString" -> "RejourneyMapboxSnapshotCallback"
                    "equals" -> false
                    else -> {
                        if (method.name.contains("snapshot", ignoreCase = true)) {
                            complete(map, requestGeneration, requestId, args?.firstOrNull { it is Bitmap } as? Bitmap)
                        }
                        null
                    }
                }
            }
            snapshotMethod.invoke(map, callback)
            mainHandler.postDelayed(
                { expireRequest(map, requestGeneration, requestId) },
                REQUEST_TIMEOUT_MS
            )
        } catch (error: Exception) {
            DiagnosticLog.trace("[VisualCapture] Async Mapbox snapshot unavailable: ${error.message}")
            markFailed(map, requestGeneration, requestId)
        }
    }

    private fun markUnsupported(map: View, requestId: Long) {
        synchronized(lock) {
            if (mapView.get() === map) asyncSnapshotUnsupportedClass = map.javaClass
            if (inFlightRequestId == requestId) inFlightRequestId = null
        }
    }

    private fun markFailed(map: View, requestGeneration: Long, requestId: Long) {
        synchronized(lock) {
            if (mapView.get() === map && generation == requestGeneration) {
                retryAfterUptimeMs = SystemClock.uptimeMillis() + RETRY_DELAY_MS
            }
            if (inFlightRequestId == requestId) inFlightRequestId = null
        }
    }

    private fun expireRequest(map: View, requestGeneration: Long, requestId: Long) {
        var timedOut = false
        synchronized(lock) {
            if (inFlightRequestId != requestId) return
            inFlightRequestId = null
            if (mapView.get() === map && generation == requestGeneration) {
                retryAfterUptimeMs = SystemClock.uptimeMillis() + RETRY_DELAY_MS
                timedOut = true
            }
        }
        if (timedOut) DiagnosticLog.trace("[VisualCapture] Async Mapbox snapshot timed out")
    }

    private fun complete(map: View, requestGeneration: Long, requestId: Long, snapshot: Bitmap?) {
        var accepted = false
        synchronized(lock) {
            val requestIsCurrent = inFlightRequestId == requestId
            val timedOutWithoutReplacement = needsRefresh && inFlightRequestId == null
            if (
                snapshot != null && !snapshot.isRecycled &&
                mapView.get() === map && generation == requestGeneration &&
                (requestIsCurrent || timedOutWithoutReplacement)
            ) {
                bitmap?.takeIf { it !== snapshot }?.recycle()
                bitmap = snapshot
                needsRefresh = false
                retryAfterUptimeMs = 0L
                accepted = true
            } else if (snapshot != null && !snapshot.isRecycled) {
                snapshot.recycle()
            } else if (requestIsCurrent && mapView.get() === map && generation == requestGeneration) {
                // A null result means the renderer was not ready. Back off so
                // repeated capture ticks cannot turn that into request churn.
                retryAfterUptimeMs = SystemClock.uptimeMillis() + RETRY_DELAY_MS
            }
            // A late callback from a timed-out request must never clear a
            // newer request for the same settled camera generation.
            if (inFlightRequestId == requestId) inFlightRequestId = null
        }
        if (accepted) {
            mainHandler.post {
                if (SpecialCases.shared.mapVisible && SpecialCases.shared.mapIdle) {
                    VisualCapture.shared?.snapshotNow()
                }
            }
        }
    }
}
