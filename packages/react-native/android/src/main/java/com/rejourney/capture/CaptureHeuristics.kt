package com.rejourney.capture

import com.rejourney.core.CaptureImportance


enum class CaptureAction {
    RenderNow,
    Defer,
    ReuseLast
}

enum class CaptureReason {
    RenderNow,
    DeferTouch,
    DeferScroll,
    DeferBounce,
    DeferRefresh,
    DeferTransition,
    DeferKeyboard,
    DeferMap,
    DeferBigAnimation,
    ReuseSignatureUnchanged,
    DeadlineExpired,
    RenderFailedReuse
}

data class CaptureDecision(
    val action: CaptureAction,
    val reason: CaptureReason,
    val deferUntilMs: Long = 0L
)

class CaptureHeuristics {
    val captureGraceMs: Long = CAPTURE_GRACE_MS
    val pollIntervalMs: Long = POLL_INTERVAL_MS
    val maxStaleMs: Long = MAX_STALE_MS

    var keyboardAnimating: Boolean = false
        private set
    var scrollActive: Boolean = false
        private set
    var animationBlocking: Boolean = false
        private set

    private var refreshActive: Boolean = false
    private var mapActive: Boolean = false

    private var lastTouchTime = 0L
    private var lastScrollTime = 0L
    private var lastBounceTime = 0L
    private var lastRefreshTime = 0L
    private var lastMapTime = 0L
    private var lastTransitionTime = 0L
    private var lastKeyboardTime = 0L
    private var lastAnimationTime = 0L
    private var mapSettleUntilMs = 0L

    private var lastRenderedTime = 0L
    private var lastRenderedSignature: String? = null

    private var lastObservedSignature: String? = null
    private var lastObservedSignatureTime = 0L
    private var signatureChurnCount = 0
    private var lastSignatureChurnTime = 0L
    private var churnBlocking = false

    private var hasVideoSurface = false
    private var hasWebSurface = false
    private var hasCameraSurface = false

    private var bonusCaptureTime = 0L
    private var pendingKeyframes = 0
    private var lastKeyframeRenderTime = 0L

    private var keyboardAnimatingUntil = 0L

    fun reset() {
        lastTouchTime = 0L
        lastScrollTime = 0L
        lastBounceTime = 0L
        lastRefreshTime = 0L
        lastMapTime = 0L
        lastTransitionTime = 0L
        lastKeyboardTime = 0L
        lastAnimationTime = 0L
        mapSettleUntilMs = 0L
        lastRenderedTime = 0L
        lastRenderedSignature = null
        lastObservedSignature = null
        lastObservedSignatureTime = 0L
        signatureChurnCount = 0
        lastSignatureChurnTime = 0L
        churnBlocking = false
        keyboardAnimating = false
        scrollActive = false
        animationBlocking = false
        refreshActive = false
        mapActive = false
        hasVideoSurface = false
        hasWebSurface = false
        hasCameraSurface = false
        bonusCaptureTime = 0L
        pendingKeyframes = 0
        lastKeyframeRenderTime = 0L
        keyboardAnimatingUntil = 0L
    }

    fun invalidateSignature() {
        lastRenderedSignature = null
        lastRenderedTime = 0L
    }

    fun recordTouchEventAtTime(nowMs: Long) {
        lastTouchTime = nowMs
        scheduleBonusCaptureAfterDelay(BONUS_INTERACTION_DELAY_MS, nowMs)
    }

    fun recordInteractionEventAtTime(nowMs: Long) {
        recordTouchEventAtTime(nowMs)
    }

    fun recordMapInteractionAtTime(nowMs: Long) {
        lastMapTime = nowMs
        val candidate = nowMs + MAP_SETTLE_MS
        if (candidate > mapSettleUntilMs) {
            mapSettleUntilMs = candidate
        }
    }

    fun recordNavigationEventAtTime(nowMs: Long) {
        lastTransitionTime = nowMs
        scheduleBonusCaptureAfterDelay(BONUS_TRANSITION_DELAY_MS, nowMs)
    }

    fun recordKeyboardEventAtTime(nowMs: Long) {
        lastKeyboardTime = nowMs
        keyboardAnimating = true
        keyboardAnimatingUntil = nowMs + QUIET_KEYBOARD_MS
        scheduleBonusCaptureAfterDelay(BONUS_KEYBOARD_DELAY_MS, nowMs)
    }

    fun recordRenderedSignature(signature: String?, nowMs: Long) {
        lastRenderedSignature = signature?.takeIf { it.isNotEmpty() }
        lastRenderedTime = nowMs
        if (pendingKeyframes > 0) {
            pendingKeyframes -= 1
            lastKeyframeRenderTime = nowMs
            if (pendingKeyframes > 0) {
                bonusCaptureTime = nowMs + KEYFRAME_SPACING_MS
                return
            }
        }
        bonusCaptureTime = 0L
    }

    fun updateWithScanResult(scanResult: ViewHierarchyScanResult?, nowMs: Long) {
        if (scanResult == null) {
            updateKeyboardState(nowMs)
            return
        }

        updateKeyboardState(nowMs)

        val currentSignature = scanResult.layoutSignature.orEmpty()
        val lastSignature = lastObservedSignature.orEmpty()
        val signatureChanged = currentSignature != lastSignature
        if (signatureChanged) {
            val delta = nowMs - lastObservedSignatureTime
            signatureChurnCount = if (delta < SIGNATURE_CHURN_WINDOW_MS) {
                signatureChurnCount + 1
            } else {
                1
            }
            lastObservedSignatureTime = nowMs
            lastSignatureChurnTime = nowMs
            lastObservedSignature = currentSignature.takeIf { it.isNotEmpty() }
        } else if (lastSignatureChurnTime > 0 &&
            (nowMs - lastSignatureChurnTime) > SIGNATURE_CHURN_WINDOW_MS
        ) {
            signatureChurnCount = 0
        }
        churnBlocking = signatureChurnCount >= 2 &&
            (nowMs - lastSignatureChurnTime) < SIGNATURE_CHURN_WINDOW_MS

        hasVideoSurface = scanResult.videoFrames.isNotEmpty()
        hasWebSurface = scanResult.webViewFrames.isNotEmpty()
        hasCameraSurface = scanResult.cameraFrames.isNotEmpty()

        if (scanResult.scrollActive) {
            lastScrollTime = nowMs
        }
        if (scanResult.bounceActive) {
            lastBounceTime = nowMs
        }
        if (scanResult.refreshActive) {
            lastRefreshTime = nowMs
        }
        if (scanResult.mapActive) {
            recordMapInteractionAtTime(nowMs)
        }

        updateScrollActiveState(scanResult.scrollActive, scanResult.refreshActive, scanResult.mapActive, nowMs)

        val blockingAnimation = scanResult.hasAnyAnimations &&
            scanResult.animationAreaRatio >= ANIMATION_SMALL_AREA_ALLOWED

        val recentSignatureChange = signatureChanged ||
            (signatureChurnCount > 0 && (nowMs - lastSignatureChurnTime) < SIGNATURE_CHURN_WINDOW_MS)
        val bailoutBlocking = scanResult.didBailOutEarly && recentSignatureChange
        val shouldBlock = blockingAnimation || churnBlocking || bailoutBlocking

        val wasBlocking = animationBlocking
        animationBlocking = shouldBlock
        if (shouldBlock) {
            lastAnimationTime = nowMs
        } else if (wasBlocking) {
            scheduleBonusCaptureAfterDelay(BONUS_ANIMATION_DELAY_MS, nowMs)
        }
    }

    fun decisionForSignature(signature: String?, nowMs: Long, hasLastFrame: Boolean, importance: CaptureImportance): CaptureDecision {
        var earliestSafeTime = nowMs
        var blockerReason = CaptureReason.RenderNow

        // Check importance to potentially bypass heuristics
        val isUrgent = importance == CaptureImportance.HIGH || importance == CaptureImportance.CRITICAL

        // Touch - Usually want smooth input, but CRITICAL updates (like navigation) take precedence
        if (!isUrgent) {
            considerBlockerSince(lastTouchTime, QUIET_TOUCH_MS, nowMs, earliestSafeTime)?.let {
                earliestSafeTime = it
                blockerReason = CaptureReason.DeferTouch
            }
        }

        // Scroll - High jank risk
        // Even urgent captures should respect scroll to avoid visible hitching, unless CRITICAL
        if (importance != CaptureImportance.CRITICAL) {
            considerBlockerSince(lastScrollTime, QUIET_SCROLL_MS, nowMs, earliestSafeTime)?.let {
                earliestSafeTime = it
                blockerReason = CaptureReason.DeferScroll
            }
        }

        // Bounce/Rubber-banding
        if (!isUrgent) {
            considerBlockerSince(lastBounceTime, QUIET_BOUNCE_MS, nowMs, earliestSafeTime)?.let {
                earliestSafeTime = it
                blockerReason = CaptureReason.DeferBounce
            }
        }

        // Refresh
        if (!isUrgent) {
            considerBlockerSince(lastRefreshTime, QUIET_REFRESH_MS, nowMs, earliestSafeTime)?.let {
                earliestSafeTime = it
                blockerReason = CaptureReason.DeferRefresh
            }
        }

        // Transition - KEY FIX: Urgent captures (NAVIGATION) must bypass this!
        if (!isUrgent) {
            considerBlockerSince(lastTransitionTime, QUIET_TRANSITION_MS, nowMs, earliestSafeTime)?.let {
                earliestSafeTime = it
                blockerReason = CaptureReason.DeferTransition
            }
        }

        if (keyboardAnimating) {
            lastKeyboardTime = nowMs
        }
        // Keyboard animations can be jerky
        if (!isUrgent) {
            considerBlockerSince(lastKeyboardTime, QUIET_KEYBOARD_MS, nowMs, earliestSafeTime)?.let {
                earliestSafeTime = it
                blockerReason = CaptureReason.DeferKeyboard
            }
        }

        // Map - Always defer map motion as it's very expensive and glitchy
        // Maps are special; even CRITICAL captures might want to wait for map settle if possible,
        // but we'll allow CRITICAL to force it if absolutely needed.
        if (importance != CaptureImportance.CRITICAL) {
             considerBlockerSince(lastMapTime, QUIET_MAP_MS, nowMs, earliestSafeTime)?.let {
                earliestSafeTime = it
                blockerReason = CaptureReason.DeferMap
            }

            if (mapSettleUntilMs > nowMs && mapSettleUntilMs > earliestSafeTime) {
                earliestSafeTime = mapSettleUntilMs
                blockerReason = CaptureReason.DeferMap
            }
        }

        if (animationBlocking) {
            // Big animations (Lottie etc).
            // If urgent, we might want to capture the final state of an animation or screen change
            // regardless of the animation loop.
            if (!isUrgent) {
                considerBlockerSince(lastAnimationTime, QUIET_ANIMATION_MS, nowMs, earliestSafeTime)?.let {
                    earliestSafeTime = it
                    blockerReason = CaptureReason.DeferBigAnimation
                }
            }
        }

        if (earliestSafeTime > nowMs) {
            return CaptureDecision(CaptureAction.Defer, blockerReason, earliestSafeTime)
        }

        val signatureChanged = signature.isNullOrEmpty() || signature != lastRenderedSignature
        val stale = lastRenderedTime <= 0 || (nowMs - lastRenderedTime) > MAX_STALE_MS
        val bonusDue = bonusCaptureTime > 0 && nowMs >= bonusCaptureTime
        val keyframeDue = bonusDue && pendingKeyframes > 0 &&
            (nowMs - lastKeyframeRenderTime) >= KEYFRAME_SPACING_MS
        val staleOnly = stale && hasLastFrame && !signatureChanged && !keyframeDue
        val suppressStaleRender = staleOnly && (hasVideoSurface || hasWebSurface || hasCameraSurface)

        if (suppressStaleRender && !isUrgent) {
            return CaptureDecision(CaptureAction.ReuseLast, CaptureReason.ReuseSignatureUnchanged)
        }

        if (!hasLastFrame || signatureChanged || stale || keyframeDue || isUrgent) {
            return CaptureDecision(CaptureAction.RenderNow, CaptureReason.RenderNow)
        }

        return CaptureDecision(CaptureAction.ReuseLast, CaptureReason.ReuseSignatureUnchanged)
    }

    private fun updateScrollActiveState(scrollActive: Boolean, refreshActive: Boolean, mapActive: Boolean, nowMs: Long) {
        if (this.scrollActive && !scrollActive) {
            scheduleBonusCaptureAfterDelay(BONUS_SCROLL_DELAY_MS, nowMs)
        }
        if (this.refreshActive && !refreshActive) {
            scheduleBonusCaptureAfterDelay(BONUS_REFRESH_DELAY_MS, nowMs)
        }
        if (this.mapActive && !mapActive) {
            scheduleBonusCaptureAfterDelay(BONUS_MAP_DELAY_MS, nowMs)
            val candidate = nowMs + MAP_SETTLE_MS
            if (candidate > mapSettleUntilMs) {
                mapSettleUntilMs = candidate
            }
        }

        this.scrollActive = scrollActive
        this.refreshActive = refreshActive
        this.mapActive = mapActive
    }

    private fun scheduleBonusCaptureAfterDelay(delayMs: Long, nowMs: Long) {
        if (pendingKeyframes < MAX_PENDING_KEYFRAMES) {
            pendingKeyframes += 1
        }
        val candidate = nowMs + delayMs
        if (bonusCaptureTime <= 0 || candidate < bonusCaptureTime) {
            bonusCaptureTime = candidate
        }
    }

    private fun updateKeyboardState(nowMs: Long) {
        if (keyboardAnimating && nowMs >= keyboardAnimatingUntil) {
            keyboardAnimating = false
        }
    }

    private fun considerBlockerSince(
        timestamp: Long,
        quietInterval: Long,
        nowMs: Long,
        currentEarliest: Long
    ): Long? {
        if (timestamp <= 0L) return null

        val readyTime = timestamp + quietInterval
        return if (readyTime > nowMs && readyTime > currentEarliest) {
            readyTime
        } else {
            null
        }
    }

    companion object {
        private const val CAPTURE_GRACE_MS = 900L
        private const val POLL_INTERVAL_MS = 80L
        private const val MAX_STALE_MS = 5_000L

        private const val QUIET_TOUCH_MS = 120L
        private const val QUIET_SCROLL_MS = 200L
        private const val QUIET_BOUNCE_MS = 200L
        private const val QUIET_REFRESH_MS = 220L
        private const val QUIET_MAP_MS = 550L
        private const val QUIET_TRANSITION_MS = 100L
        private const val QUIET_KEYBOARD_MS = 250L
        private const val QUIET_ANIMATION_MS = 250L

        private const val MAP_SETTLE_MS = 800L

        private const val SIGNATURE_CHURN_WINDOW_MS = 250L

        private const val BONUS_SCROLL_DELAY_MS = 120L
        private const val BONUS_MAP_DELAY_MS = 350L
        private const val BONUS_REFRESH_DELAY_MS = 200L
        private const val BONUS_INTERACTION_DELAY_MS = 150L
        private const val BONUS_TRANSITION_DELAY_MS = 200L
        private const val BONUS_KEYBOARD_DELAY_MS = 200L
        private const val BONUS_ANIMATION_DELAY_MS = 200L

        private const val ANIMATION_SMALL_AREA_ALLOWED = 0.03f

        private const val KEYFRAME_SPACING_MS = 250L
        private const val MAX_PENDING_KEYFRAMES = 3
    }
}
