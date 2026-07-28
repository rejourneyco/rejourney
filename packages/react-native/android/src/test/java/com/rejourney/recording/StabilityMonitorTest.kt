package com.rejourney.recording

import org.junit.Assert.assertEquals
import org.junit.Test

class StabilityMonitorTest {
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
}
