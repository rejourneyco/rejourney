package com.rejourney.recording

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.json.JSONObject

internal class TelemetryBufferTest {
    @Test
    fun overlappingDrainsCompleteOnlyTheirOwnLifecycle() {
        val registry = DrainCompletionRegistry()
        var firstCompletions = 0
        var secondCompletions = 0
        val first = registry.begin { firstCompletions += 1 }
        val second = registry.begin { secondCompletions += 1 }

        registry.finish(first)?.forEach { it() }
        assertEquals(1, firstCompletions)
        assertEquals(0, secondCompletions)
        assertNull(registry.finish(first))

        registry.finish(second)?.forEach { it() }
        assertEquals(1, firstCompletions)
        assertEquals(1, secondCompletions)
    }

    @Test
    fun pauseStatePayloadIsSmallAndSessionOwned() {
        val payload = SegmentDispatcher.pauseStatePayload(
            replayId = "session-1",
            pauseId = "pause-1",
            paused = true,
            occurredAt = 1_777_000_001_000,
            isSampledIn = false
        )

        assertEquals("session-1", payload["sessionId"])
        assertEquals("pause-1", payload["pauseId"])
        assertEquals(true, payload["paused"])
        assertEquals(1_777_000_001_000, payload["occurredAt"])
        assertEquals(false, payload["isSampledIn"])
        assertEquals(6, payload.size)
    }

    @Test
    fun deadTapCandidate_mustStillBeCurrentAndUnanswered() {
        assertTrue(TelemetryPipeline.shouldEmitDeadTap(3, 3, 99, 100))
        assertFalse(TelemetryPipeline.shouldEmitDeadTap(3, 4, 0, 100))
        assertFalse(TelemetryPipeline.shouldEmitDeadTap(3, 3, 101, 100))
    }

    @Test
    fun attributePayload_escapesUserControlledMetadata() {
        val key = "checkout\"step\\name"
        val value = "line one\nline two \"quoted\""

        val payload = JSONObject(TelemetryPipeline.attributePayload(key, value))

        assertEquals(key, payload.getString("key"))
        assertEquals(value, payload.getString("value"))
    }

    private fun event(label: String, session: String = "session") = EventEntry(
        data = label.toByteArray(),
        size = label.length,
        sessionId = session
    )

    @Test
    fun eventRing_keepsSessionsSeparateAndRetryOrderStable() {
        val ring = EventRingBuffer(4)
        ring.push(event("a1", "session-a"))
        ring.push(event("a2", "session-a"))
        ring.push(event("b1", "session-b"))

        val firstAttempt = ring.drain(100)
        assertEquals(listOf("session-a", "session-a"), firstAttempt.map { it.sessionId })
        assertEquals(listOf("a1", "a2"), firstAttempt.map { it.data.decodeToString() })

        ring.prepend(firstAttempt)
        assertEquals(listOf("a1", "a2"), ring.drain(100).map { it.data.decodeToString() })
        assertEquals(listOf("b1"), ring.drain(100).map { it.data.decodeToString() })
    }

    @Test
    fun eventRetryAtCapacity_evictsNewestInsteadOfFailedOldestBatch() {
        val ring = EventRingBuffer(3)
        listOf("a", "b", "c").forEach { ring.push(event(it)) }
        val failed = ring.drain(2)
        ring.push(event("d"))
        ring.push(event("e"))
        ring.prepend(failed)

        assertEquals(listOf("a", "b", "c"), ring.drain(100).map { it.data.decodeToString() })
    }

    @Test
    fun frameRetryAtCapacity_preservesFailedAndOlderBundles() {
        fun bundle(tag: String) = PendingFrameBundle(
            tag = tag,
            payload = tag.toByteArray(),
            rangeStart = 0,
            rangeEnd = 1,
            count = 1,
            sessionId = "session"
        )

        val queue = FrameBundleQueue(2)
        queue.enqueue(bundle("old"))
        queue.enqueue(bundle("middle"))
        val failed = requireNotNull(queue.dequeue())
        queue.enqueue(bundle("newest"))
        queue.requeue(failed)

        assertEquals("old", queue.dequeue()?.tag)
        assertEquals("middle", queue.dequeue()?.tag)
        assertNull(queue.dequeue())
    }

    @Test
    fun sessionUploadBinding_survivesLaterProjectConfiguration() {
        val dispatcher = SegmentDispatcher.shared
        try {
            dispatcher.endpoint = "https://old.example"
            dispatcher.collectGeoLocation = false
            dispatcher.observeOnly = true
            dispatcher.configure(
                replayId = "session-old-route",
                apiToken = "old-key",
                credential = null,
                projectId = "project-old",
                isSampledIn = false
            )

            dispatcher.endpoint = "https://new.example"
            dispatcher.collectGeoLocation = true
            dispatcher.observeOnly = false
            dispatcher.configure(
                replayId = "session-new-route",
                apiToken = "new-key",
                credential = null,
                projectId = "project-new",
                isSampledIn = true
            )

            assertEquals(
                SessionUploadBinding(
                    endpoint = "https://old.example",
                    projectId = "project-old",
                    isSampledIn = false,
                    collectGeoLocation = false,
                    observeOnly = true
                ),
                dispatcher.uploadBinding("session-old-route")
            )
            assertEquals("project-new", dispatcher.uploadBinding("session-new-route").projectId)
            assertFalse(dispatcher.matchesCurrentUploadRoute("https://old.example", "project-old"))
            assertTrue(dispatcher.matchesCurrentUploadRoute("https://new.example", "project-new"))
        } finally {
            dispatcher.endpoint = "https://api.rejourney.co"
            dispatcher.collectGeoLocation = true
            dispatcher.observeOnly = false
        }
    }
}
