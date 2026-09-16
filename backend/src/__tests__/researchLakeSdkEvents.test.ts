import { gzipSync } from 'node:zlib';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    buildSdkEventTimeline,
    buildSdkFlowEdges,
    sdkEventTimelineQualityFields,
    sdkLifecycleEvidence,
    unavailableSdkEventTimeline,
    type SdkEventArtifact,
    type SdkPositionBuckets,
} from '../services/researchLakeSdkEvents.js';
import { __researchLakeTestInternals } from '../services/researchLake.js';

const hash = (value: string, length = 24): string => createHmac('sha256', 'test-secret').update(value).digest('hex').slice(0, length);
const positionBuckets = (x: number, y: number, width: number | null, height: number | null): SdkPositionBuckets => ({
    x_norm_bucket: width ? Math.round((x / width) * 1000) : null,
    y_norm_bucket: height ? Math.round((y / height) * 1000) : null,
    x_cell: width ? Math.floor((x / width) * 64) : null,
    y_cell: height ? Math.floor((y / height) * 128) : null,
});

const startedAt = new Date('2026-08-10T07:18:17.588Z');
const t = (offsetMs: number): number => startedAt.getTime() + offsetMs;

function artifact(id: string, startTime: number | null = null): SdkEventArtifact {
    return { id, kind: 'events', s3ObjectKey: `sessions/s1/${id}.json`, start_time: startTime, size_bytes: 1000, declared_size_bytes: 1000 };
}

function envelope(events: unknown[], deviceInfo: Record<string, unknown> | null = { screenWidth: 414, screenHeight: 896 }): Buffer {
    return Buffer.from(JSON.stringify({ version: 1, sessionId: 'session_abcdefghijklmnopqrst', sdk: { name: 'rn', version: '1.1.0' }, deviceInfo, events }), 'utf8');
}

const baseEvents = [
    { type: 'custom', name: 'onboarding_step', payload: { secret: 'user@example.com' }, timestamp: t(25) },
    { type: 'navigation', screen: 'Intro', screenName: 'Intro', viewId: 'view-1', entering: true, timestamp: t(300) },
    { type: 'touch', gestureType: 'tap', label: 'Next', x: 319.4, y: 716.2, touches: [{ x: 319.4, y: 716.2, timestamp: t(2531) }], timestamp: t(2531) },
    { type: 'touch', gestureType: 'tap', label: 'UIKeyboardLayoutStar', x: 100, y: 800, timestamp: t(2600) },
    { type: 'gesture', gestureType: 'dead_tap', frustrationKind: 'dead_tap', label: 'Next', x: 319, y: 716, timestamp: t(3202) },
    { type: 'rage_tap', label: 'Next', x: 319, y: 716, count: 3, timestamp: t(3497) },
    { type: 'gesture', gestureType: 'swipe', direction: 'left', x: 10, y: 10, timestamp: t(4000) },
    { type: 'network_request', method: 'get', url: 'https://api.example.com/users/12345/profile?x=1', statusCode: 500, duration: 812, success: false, errorMessage: 'boom', requestBodySize: 0, responseBodySize: 2048, timestamp: t(5000) },
    { type: 'log', level: 'WARN', message: 'session_abcdefghijklmnop leaked 10.0.0.1', timestamp: t(5100) },
    { type: 'navigation', screen: 'Register', entering: true, timestamp: t(6572) },
    { type: 'app_background', timestamp: t(8000) },
    { type: 'app_foreground', totalBackgroundTime: 1500, timestamp: t(9500) },
    { type: 'user_identity_changed', userId: 'u-1', timestamp: t(9600) },
    { type: 'motion', timestamp: t(9700) },
    { type: 'something_new', timestamp: t(9800) },
    { type: 'keyboard_show', timestamp: t(9900) },
    { type: 'anr', durationMs: 5000, timestamp: t(10000) },
];

async function buildFixture(options: { gzip?: boolean; bare?: boolean; missing?: string[] } = {}) {
    const artifacts = [artifact('b', t(3000)), artifact('a', t(0))];
    const payloads: Record<string, Buffer> = {
        a: options.bare ? Buffer.from(JSON.stringify(baseEvents.slice(0, 9))) : envelope(baseEvents.slice(0, 9)),
        b: envelope(baseEvents.slice(9), null),
    };
    return buildSdkEventTimeline({
        session: { started_at: startedAt, ended_at: new Date(t(10_500)) },
        artifacts,
        projectKey: 'projkey',
        hash,
        positionBuckets,
        download: async (a) => {
            if (options.missing?.includes(a.id)) return null;
            const body = payloads[a.id];
            return options.gzip === false ? body : gzipSync(body);
        },
    });
}

describe('SDK event timeline builder', () => {
    it('reads gzipped envelopes without a .gz key and orders rows across artifacts', async () => {
        const timeline = await buildFixture();
        expect(timeline.summary.sdk_event_timeline).toBe('observed');
        expect(timeline.summary.sdk_event_artifact_count).toBe(2);
        expect(timeline.summary.sdk_event_artifact_missing_count).toBe(0);
        const types = timeline.rows.map((row) => row.type);
        expect(types).toEqual([
            'custom', 'navigation', 'touch', 'touch', 'gesture', 'gesture', 'gesture', 'network_request', 'log',
            'navigation', 'app_background', 'app_foreground', 'keyboard', 'anr',
        ]);
        expect(timeline.rows.map((row) => row.index)).toEqual(timeline.rows.map((_, index) => index));
        // Artifact "a" starts first even though it was listed second.
        expect(timeline.rows[0].source_artifact_index).toBe(0);
        expect(timeline.rows[9].source_artifact_index).toBe(1);
        expect(timeline.summary.sdk_event_unrecognized_count).toBe(1);
        expect(timeline.summary.sdk_event_type_counts.touch).toBe(2);
    });

    it('accepts plain JSON and bare arrays', async () => {
        const plain = await buildFixture({ gzip: false });
        expect(plain.rows).toHaveLength(14);
        const bare = await buildFixture({ bare: true });
        expect(bare.rows).toHaveLength(14);
        // Bare arrays carry no device info, so coordinates stay unbucketed.
        expect(bare.rows[2].screen_width).toBeNull();
        expect(bare.rows[2].x_cell).toBeNull();
    });

    it('maps taps, detectors, coordinates and keyboard surfaces', async () => {
        const { rows } = await buildFixture();
        const tap = rows[2];
        expect(tap.gesture_kind).toBe('tap');
        expect(tap.frustration_kind).toBeNull();
        expect(tap.x).toBe(319);
        expect(tap.y).toBe(716);
        expect(tap.screen_width).toBe(414);
        expect(tap.x_cell).toBe(49);
        expect(tap.target_key).toBe(hash('projkey:sdk-target:Next', 20));
        expect(tap.is_keyboard_surface).toBe(false);
        expect(tap.screen_key).toBe(hash('projkey:screen:Intro', 20));
        expect(tap.elapsed_ms).toBe(2531);
        expect(rows[3].is_keyboard_surface).toBe(true);
        expect(rows[4].frustration_kind).toBe('dead_tap');
        expect(rows[4].gesture_kind).toBe('dead_tap');
        expect(rows[5].frustration_kind).toBe('rage_tap');
        expect(rows[5].type).toBe('gesture');
        expect(rows[5].tap_count).toBe(3);
        expect(rows[6].gesture_kind).toBe('swipe');
        expect(rows[6].direction).toBe('left');
    });

    it('carries navigation screen keys forward and hashes view ids', async () => {
        const { rows } = await buildFixture();
        expect(rows[1].screen_key).toBe(hash('projkey:screen:Intro', 20));
        expect(rows[1].view_key).toBe(hash('projkey:sdk-view:view-1', 20));
        expect(rows[1].entering).toBe(true);
        expect(rows[9].screen_key).toBe(hash('projkey:screen:Register', 20));
        expect(rows[10].screen_key).toBe(hash('projkey:screen:Register', 20));
        expect(rows[11].total_background_ms).toBe(1500);
    });

    it('reduces network requests and logs to privacy-safe fields', async () => {
        const { rows } = await buildFixture();
        const request = rows[7];
        expect(request.method).toBe('GET');
        expect(request.host_key).toBe(hash('projkey:host:api.example.com', 20));
        expect(request.path_key).toBe(hash('projkey:path:/users/:id/profile', 20));
        expect(request.status_code).toBe(500);
        expect(request.status_class).toBe('5xx');
        expect(request.duration_ms).toBe(812);
        expect(request.success).toBe(false);
        expect(request.has_error_message).toBe(true);
        expect(request.response_bytes_bucket).toBe(2048);
        expect(rows[8].log_level).toBe('warn');
        expect(rows[0].event_name_key).toBe(hash('projkey:event-name:onboarding_step', 20));
        expect(rows[12].keyboard_action).toBe('show');
    });

    it('never emits identifier-risk keys or values', async () => {
        const { rows } = await buildFixture();
        expect(__researchLakeTestInternals.containsIdentifierRisk({ sdkEvents: rows })).toBe(false);
        const serialized = JSON.stringify(rows);
        expect(serialized).not.toContain('example.com');
        expect(serialized).not.toContain('Next');
        expect(serialized).not.toContain('boom');
        expect(serialized).not.toContain('u-1');
        expect(serialized).not.toContain('session_abcdefghijklmnop');
    });

    it('records clock relation for events outside the session window', async () => {
        const timeline = await buildSdkEventTimeline({
            session: { started_at: startedAt },
            artifacts: [artifact('a')],
            projectKey: 'projkey',
            hash,
            positionBuckets,
            download: async () => envelope([
                { type: 'touch', x: 1, y: 1, timestamp: t(-2000) },
                { type: 'touch', x: 1, y: 1, timestamp: t(1000) },
                { type: 'touch', x: 1, y: 1, timestamp: t(90_000_000) },
                { type: 'touch', x: 1, y: 1 },
            ]),
        });
        expect(timeline.rows.map((row) => row.clock_relation)).toEqual(['before_session_start', 'in_session', 'after_24h', 'unavailable']);
        expect(timeline.rows[0].elapsed_ms).toBe(-2000);
        expect(timeline.summary.sdk_event_clock_out_of_range_count).toBe(2);
        expect(timeline.warnings).toContain('sdk_event_clock_out_of_range');
    });

    it('reports partial and unavailable timelines', async () => {
        const partial = await buildFixture({ missing: ['b'] });
        expect(partial.summary.sdk_event_timeline).toBe('partial');
        expect(partial.summary.sdk_event_artifact_missing_count).toBe(1);
        expect(partial.warnings).toContain('sdk_event_artifacts_partially_unavailable');
        expect(partial.rows).toHaveLength(9);

        const unavailable = await buildFixture({ missing: ['a', 'b'] });
        expect(unavailable.summary.sdk_event_timeline).toBe('unavailable');
        expect(unavailable.warnings).toContain('sdk_event_timeline_unavailable');

        const none = await buildSdkEventTimeline({
            session: { started_at: startedAt }, artifacts: [{ id: 'x', kind: 'screenshots', s3ObjectKey: 'k', start_time: null }],
            projectKey: 'projkey', hash, positionBuckets, download: async () => null,
        });
        expect(none.summary.sdk_event_timeline).toBe('unavailable');
        expect(none.summary.sdk_event_artifact_count).toBe(0);

        const withheld = unavailableSdkEventTimeline([artifact('a')], 'identifier_risk');
        expect(withheld.warnings).toContain('sdk_event_timeline_identifier_risk_detected');
        expect(withheld.summary.sdk_event_artifact_missing_count).toBe(1);
    });

    it('caps rows and flags the limit', async () => {
        const timeline = await buildSdkEventTimeline({
            session: { started_at: startedAt }, artifacts: [artifact('a')], projectKey: 'projkey', hash, positionBuckets, maxRows: 3,
            download: async () => envelope(Array.from({ length: 10 }, (_, i) => ({ type: 'touch', x: 1, y: 1, timestamp: t(i * 10) }))),
        });
        expect(timeline.rows).toHaveLength(3);
        expect(timeline.summary.sdk_event_row_limit_reached).toBe(true);
        expect(timeline.warnings).toContain('sdk_event_row_limit_reached');
    });

    it('derives quality fields, flow edges and lifecycle evidence', async () => {
        const timeline = await buildFixture();
        const quality = sdkEventTimelineQualityFields(timeline.summary, false);
        expect(quality).toMatchObject({
            sdk_event_timeline: 'observed',
            touch_timeline_present: true,
            navigation_timeline_present: true,
            lifecycle_timeline_present: true,
            network_timeline_present: true,
            sdk_events_zip_entry_present: false,
            sdk_event_count: 14,
        });

        const edges = buildSdkFlowEdges(timeline.rows);
        expect(edges).toHaveLength(1);
        expect(edges[0]).toMatchObject({
            from_screen_key: hash('projkey:screen:Intro', 20),
            to_screen_key: hash('projkey:screen:Register', 20),
            action_kind: 'swipe',
            action_event_index: 6,
            transition_elapsed_ms: 6572,
            transition_elapsed_ms_bucket: 6500,
            evidence_source: 'observed_navigation_event',
        });

        const lifecycle = sdkLifecycleEvidence(timeline.rows, { started_at: startedAt, ended_at: new Date(t(10_500)) });
        expect(lifecycle.background_count).toBe(1);
        expect(lifecycle.foreground_count).toBe(1);
        expect(lifecycle.ended_in_background).toBe(false);

        const backgrounded = sdkLifecycleEvidence(timeline.rows.filter((row) => row.type !== 'app_foreground'), { started_at: startedAt, ended_at: new Date(t(9_000)) });
        expect(backgrounded.ended_in_background).toBe(true);
        const stale = sdkLifecycleEvidence(timeline.rows.filter((row) => row.type !== 'app_foreground'), { started_at: startedAt, ended_at: new Date(t(20 * 60 * 1000)) });
        expect(stale.ended_in_background).toBe(false);
    });
});
