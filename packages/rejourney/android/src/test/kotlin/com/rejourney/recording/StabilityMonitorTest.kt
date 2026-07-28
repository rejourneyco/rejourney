package com.rejourney.recording

import kotlin.test.Test
import kotlin.test.assertEquals

internal class StabilityMonitorTest {
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
}
