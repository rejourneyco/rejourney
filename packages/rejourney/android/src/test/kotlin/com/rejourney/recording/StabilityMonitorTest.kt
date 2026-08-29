package com.rejourney.recording

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import java.net.HttpURLConnection
import java.net.URL

internal class StabilityMonitorTest {
    private class TrackingConnection : HttpURLConnection(URL("http://127.0.0.1")) {
        var wasDisconnected = false

        override fun disconnect() {
            wasDisconnected = true
        }

        override fun usingProxy(): Boolean = false

        override fun connect() = Unit
    }

    @Test
    fun incidentConnection_disconnectsWhenUploadThrows() {
        val connection = TrackingConnection()

        runCatching {
            StabilityMonitor.withDisconnectedConnection(connection) {
                throw IllegalStateException("synthetic upload failure")
            }
        }

        assertTrue(connection.wasDisconnected)
    }

    @Test
    fun recoveryTimer_onlyRunsForActiveForegroundUnpausedSession() {
        assertTrue(ReplayOrchestrator.shouldRunRecoveryCheckpointTimer(true, false, false))
        assertFalse(ReplayOrchestrator.shouldRunRecoveryCheckpointTimer(false, false, false))
        assertFalse(ReplayOrchestrator.shouldRunRecoveryCheckpointTimer(true, true, false))
        assertFalse(ReplayOrchestrator.shouldRunRecoveryCheckpointTimer(true, false, true))
    }

    @Test
    fun activityResume_doesNotRestartAnrCaptureDuringUserPauseOrBackgroundTransition() {
        assertTrue(ReplayOrchestrator.shouldActivateResponsivenessWatcher(true, true, false, false))
        assertFalse(ReplayOrchestrator.shouldActivateResponsivenessWatcher(false, true, false, false))
        assertFalse(ReplayOrchestrator.shouldActivateResponsivenessWatcher(true, false, false, false))
        assertFalse(ReplayOrchestrator.shouldActivateResponsivenessWatcher(true, true, true, false))
        assertFalse(ReplayOrchestrator.shouldActivateResponsivenessWatcher(true, true, false, true))
    }

    @Test
    fun networkDuration_usesNonnegativeMonotonicDelta() {
        assertEquals(45L, RejourneyNetworkInterceptor.elapsedDurationMs(100, 145))
        assertEquals(0L, RejourneyNetworkInterceptor.elapsedDurationMs(145, 100))
    }

    @Test
    fun anrWatchdog_reportsOnlyOnceUntilMainThreadResponds() {
        assertFalse(AnrSentinel.shouldReportAnr(10_000, 0, 5_000, false))
        assertFalse(AnrSentinel.shouldReportAnr(4_999, 1, 5_000, false))
        assertTrue(AnrSentinel.shouldReportAnr(5_000, 1, 5_000, false))
        assertFalse(AnrSentinel.shouldReportAnr(30_000, 20, 5_000, true))
    }

    @Test
    fun incidentRecord_jsonRoundTrip_preservesCrashFramesAndIncidentId() {
        val record = IncidentRecord(
            incidentId = "incident-123",
            sessionId = "session-456",
            timestampMs = 42,
            category = "exception",
            identifier = "java.lang.RuntimeException",
            detail = "Intentional crash",
            frames = listOf(
                "at example.Crash.trigger(Crash.kt:10)",
                "at example.Main.run(Main.kt:20)"
            ),
            context = mapOf("threadName" to "main")
        )

        val json = record.toJson()
        val restored = IncidentRecord.fromJson(json)

        assertEquals("incident-123", json.getString("incidentId"))
        assertEquals(2, json.getJSONArray("frames").length())
        assertEquals(record.frames, restored.frames)
    }

    @Test
    fun incidentQueue_readsLegacyObjectAndPreservesMultipleRecords() {
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
    fun incidentRouteMatching_skipsOtherProjectsButAllowsLegacyRecords() {
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
