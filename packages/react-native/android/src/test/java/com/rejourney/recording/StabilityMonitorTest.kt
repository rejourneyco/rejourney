package com.rejourney.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL

class StabilityMonitorTest {
    private class TrackingConnection : HttpURLConnection(URL("http://127.0.0.1")) {
        var wasDisconnected = false

        override fun disconnect() {
            wasDisconnected = true
        }

        override fun usingProxy(): Boolean = false

        override fun connect() = Unit
    }

    @Test
    fun incidentConnectionDisconnectsWhenUploadThrows() {
        val connection = TrackingConnection()

        runCatching {
            StabilityMonitor.withDisconnectedConnection(connection) {
                throw IllegalStateException("synthetic upload failure")
            }
        }

        assertTrue(connection.wasDisconnected)
    }

    @Test
    fun recoveryTimerOnlyRunsForActiveForegroundUnpausedSession() {
        assertTrue(ReplayOrchestrator.shouldRunRecoveryCheckpointTimer(true, false, false))
        assertFalse(ReplayOrchestrator.shouldRunRecoveryCheckpointTimer(false, false, false))
        assertFalse(ReplayOrchestrator.shouldRunRecoveryCheckpointTimer(true, true, false))
        assertFalse(ReplayOrchestrator.shouldRunRecoveryCheckpointTimer(true, false, true))
    }

    @Test
    fun activityResumeDoesNotRestartAnrCaptureDuringUserPauseOrBackgroundTransition() {
        assertTrue(ReplayOrchestrator.shouldActivateResponsivenessWatcher(true, true, false, false))
        assertFalse(ReplayOrchestrator.shouldActivateResponsivenessWatcher(false, true, false, false))
        assertFalse(ReplayOrchestrator.shouldActivateResponsivenessWatcher(true, false, false, false))
        assertFalse(ReplayOrchestrator.shouldActivateResponsivenessWatcher(true, true, true, false))
        assertFalse(ReplayOrchestrator.shouldActivateResponsivenessWatcher(true, true, false, true))
    }

    @Test
    fun mapCaptureIsSuppressedOnlyWhileTheCameraMoves() {
        // No map on screen: the heuristic never applies.
        assertTrue(shouldCaptureMapBackedContent(false, false, false))
        // A settled map still records at the normal cadence -- a map screen is
        // mostly not map, and suppressing it loses all of that chrome.
        assertTrue(shouldCaptureMapBackedContent(true, true, false))
        // An explicit request is never dropped, even mid-gesture.
        assertTrue(shouldCaptureMapBackedContent(true, false, true))
        assertTrue(shouldCaptureMapBackedContent(true, true, true))
        // The one real skip: a periodic tick while the camera is moving.
        assertFalse(shouldCaptureMapBackedContent(true, false, false))
    }

    @Test
    fun networkDurationUsesNonnegativeMonotonicDelta() {
        assertEquals(45L, RejourneyNetworkInterceptor.elapsedDurationMs(100, 145))
        assertEquals(0L, RejourneyNetworkInterceptor.elapsedDurationMs(145, 100))
    }

    @Test
    fun anrWatchdogReportsOnlyOnceUntilMainThreadResponds() {
        assertFalse(AnrSentinel.shouldReportAnr(10_000, 0, 5_000, false))
        assertFalse(AnrSentinel.shouldReportAnr(4_999, 1, 5_000, false))
        assertTrue(AnrSentinel.shouldReportAnr(5_000, 1, 5_000, false))
        assertFalse(AnrSentinel.shouldReportAnr(30_000, 20, 5_000, true))
    }

    @Test
    fun incidentJsonRoundTripPreservesFrames() {
        val incident = IncidentRecord(
            incidentId = "incident-123",
            sessionId = "session-456",
            timestampMs = 1_785_190_032_712,
            category = "exception",
            identifier = "java.lang.RuntimeException",
            detail = "Rejourney debug crash triggered",
            frames = listOf(
                "at com.rejourney.RejourneyModuleImpl.debugCrash(RejourneyModuleImpl.kt:1010)",
                "at android.os.Handler.handleCallback(Handler.java:995)"
            ),
            context = mapOf("threadName" to "main", "isMain" to "true")
        )

        val decoded = IncidentRecord.fromJson(incident.toJson())

        assertEquals(incident, decoded)
    }

    @Test
    fun incidentQueueReadsLegacyObjectAndPreservesMultipleRecords() {
        val first = IncidentRecord(
            incidentId = "first",
            sessionId = "session-1",
            timestampMs = 1,
            category = "exception",
            identifier = "Crash",
            detail = "first",
            frames = listOf("App.crash()"),
            context = emptyMap()
        )
        val second = first.copy(
            incidentId = "second",
            sessionId = "session-2",
            timestampMs = 2,
            category = "anr",
            identifier = "ANR"
        )

        val legacy = IncidentRecord.listFromJson(first.toJson().toString())
        assertEquals(listOf(first), legacy)

        val queued = IncidentRecord.mergeStoredIncidents(legacy, second)
        assertEquals(listOf(first, second), queued)
        assertEquals(queued, IncidentRecord.listFromJson(IncidentRecord.listToJson(queued)))
    }

    @Test
    fun incidentRouteMatchingSkipsOtherProjectsButAllowsLegacyRecords() {
        val current = IncidentRecord(
            sessionId = "current",
            timestampMs = 1,
            category = "crash",
            identifier = "Current",
            detail = "",
            frames = emptyList(),
            context = emptyMap(),
            routeEndpoint = "https://api.rejourney.co",
            routeProjectId = "project-current"
        )
        val other = current.copy(routeProjectId = "project-other")
        val legacy = current.copy(routeEndpoint = null, routeProjectId = null)

        assertTrue(StabilityMonitor.routeMatches(current, "https://api.rejourney.co", "project-current"))
        assertFalse(StabilityMonitor.routeMatches(other, "https://api.rejourney.co", "project-current"))
        assertTrue(StabilityMonitor.routeMatches(legacy, "https://api.rejourney.co", "project-current"))
    }
}
