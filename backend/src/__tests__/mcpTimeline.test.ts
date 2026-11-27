/**
 * Timeline normalisation (ported from routes/sessions.ts), condensation and
 * moment detection. All pure functions.
 */
import { describe, expect, it } from 'vitest';
import { SLOW_REQUEST_MS, TIMELINE_EVENT_TYPES, condenseTimeline } from '../mcp/timeline/condense.js';
import type { CondensedTimelineEvent } from '../mcp/timeline/condense.js';
import {
    ABANDON_AFTER_ERROR_SECONDS,
    MAX_MOMENTS,
    MOMENT_CONTEXT_SECONDS,
    RAGE_CLUSTER_GAP_SECONDS,
    STUCK_LOOP_MIN_VISITS,
    STUCK_LOOP_WINDOW_SECONDS,
    STUCK_TAP_MIN_REPEATS,
    STUCK_TAP_WINDOW_SECONDS,
    computeCommonLeadUp,
    detectMoments,
    leadUpWindow,
    screenVisits,
    trimTimeline,
} from '../mcp/timeline/moments.js';
import {
    buildFaultEvents,
    createTimestampCoercer,
    faultDedupeSignature,
    filterDisplayAnrs,
    mergeEventsWithFaults,
    normalizeTimelineEvents,
    selectExtraCustomSessionEvents,
} from '../mcp/timeline/normalize.js';

const START = Date.UTC(2026, 10, 18, 12, 0, 0);
const END = START + 120_000;
const tapAt = (ms: number, x = 100, y = 100, extra: Record<string, unknown> = {}) => ({
    type: 'touch', gestureType: 'tap', timestamp: START + ms, touches: [{ x, y, timestamp: START + ms }], ...extra,
});

describe('timestamp coercion', () => {
    const coerce = createTimestampCoercer(START, END);
    it('keeps epoch milliseconds and accepts numeric strings', () => {
        expect(coerce(START + 5000, 0)).toBe(START + 5000);
        expect(coerce(String(START + 5000), 0)).toBe(START + 5000);
    });
    it('reads epoch seconds and milliseconds since session start', () => {
        expect(coerce((START + 7000) / 1000, 0)).toBe(START + 7000);
        expect(coerce(7000, 0)).toBe(START + 7000);
        // As in the route: a small number is taken as milliseconds since start
        // before it is tried as seconds since start, so 7.5 means 7.5 ms.
        expect(coerce(7.5, 0)).toBe(START + 8);
    });
    it('falls back for missing, zero, negative and non-numeric values', () => {
        for (const bad of [undefined, null, 0, -5, 'soon', Number.NaN]) expect(coerce(bad, 1234)).toBe(1234);
    });
    it('treats a small number outside the session as epoch seconds', () => {
        expect(coerce(999_999, 0)).toBe(999_999_000);
    });
});

describe('normalizeTimelineEvents', () => {
    it('lower-cases the type, falls back to the name, then to "unknown", and sorts by time', () => {
        const { normalizedEvents } = normalizeTimelineEvents(
            [{ type: 'Navigation', timestamp: START + 3000, screen: 'B' }, { name: 'Purchase', ts: START + 1000 }, { time: START + 2000 }],
            START, END,
        );
        expect(normalizedEvents.map((event) => [event.type, event.timestamp - START])).toEqual([['purchase', 1000], ['unknown', 2000], ['navigation', 3000]]);
    });

    it('gives events without an id a deterministic one and keeps existing ids', () => {
        const input = [{ type: 'custom', name: 'a', timestamp: START }, { id: 'given', type: 'custom', name: 'b', timestamp: START + 1 }];
        const first = normalizeTimelineEvents(input, START, END).normalizedEvents;
        const second = normalizeTimelineEvents(input, START, END).normalizedEvents;
        expect(first.map((event) => event.id)).toEqual(['evt_0', 'given']);
        expect(second.map((event) => event.id)).toEqual(first.map((event) => event.id));
    });

    it('parses JSON-string payloads and reads label, screen, gesture and touches from any of the three places', () => {
        const { normalizedEvents } = normalizeTimelineEvents(
            [
                { type: 'custom', name: 'x', timestamp: START, payload: JSON.stringify({ screenName: 'FromPayload', label: 'L1', gestureType: 'tap' }) },
                { type: 'touch', timestamp: START + 1, label: 'Legacy label', properties: { screen: 'FromProps', touches: [{ x: 1, y: 2 }] } },
                { type: 'touch', timestamp: START + 2, targetLabel: 'New label', screenName: 'TopLevel', frustrationKind: 'dead_tap' },
                { type: 'custom', name: 'y', timestamp: START + 3, payload: 'not json' },
            ],
            START, END,
        );
        expect(normalizedEvents[0]).toMatchObject({ screen: 'FromPayload', targetLabel: 'L1', gestureType: 'tap', properties: { label: 'L1' } });
        expect(normalizedEvents[1]).toMatchObject({ screen: 'FromProps', targetLabel: 'Legacy label', touches: [{ x: 1, y: 2 }] });
        expect(normalizedEvents[2]).toMatchObject({ screen: 'TopLevel', targetLabel: 'New label', frustrationKind: 'dead_tap' });
        expect(normalizedEvents[3]).toMatchObject({ payload: 'not json', properties: null, screen: null, targetLabel: null });
    });

    it('infers a rage tap from three nearby taps within a second', () => {
        const { normalizedEvents } = normalizeTimelineEvents([tapAt(0), tapAt(300, 102, 101), tapAt(600, 101, 99)], START, END);
        const rage = normalizedEvents.filter((event) => event.type === 'rage_tap');
        expect(rage).toHaveLength(1);
        expect(rage[0]).toMatchObject({ gestureType: 'rage_tap', frustrationKind: 'rage_tap', timestamp: START + 600, properties: { inferred: true } });
    });

    it('does not infer one from taps that are too slow or too far apart', () => {
        const slow = normalizeTimelineEvents([tapAt(0), tapAt(600), tapAt(1200)], START, END).normalizedEvents;
        const far = normalizeTimelineEvents([tapAt(0, 0, 0), tapAt(200, 100, 0), tapAt(400, 200, 0)], START, END).normalizedEvents;
        expect(slow.some((event) => event.type === 'rage_tap')).toBe(false);
        expect(far.some((event) => event.type === 'rage_tap')).toBe(false);
    });

    it('does not infer one from keyboard taps, gameplay input, or taps marked not rage-eligible', () => {
        const cases = [
            { label: 'UIKeyboardLayoutStar' },
            { gameplayId: 'level-1' },
            { rageEligible: false },
        ];
        for (const extra of cases) {
            const events = normalizeTimelineEvents([tapAt(0, 100, 100, extra), tapAt(300, 100, 100, extra), tapAt(600, 100, 100, extra)], START, END).normalizedEvents;
            expect(events.some((event) => event.type === 'rage_tap'), JSON.stringify(extra)).toBe(false);
        }
    });

    it('does not duplicate a rage tap the SDK already reported at the same place and time', () => {
        const explicit = { type: 'gesture', gestureType: 'rage_tap', timestamp: START + 700, touches: [{ x: 101, y: 100, timestamp: START + 700 }] };
        const { normalizedEvents } = normalizeTimelineEvents([tapAt(0), tapAt(300), tapAt(600), explicit], START, END);
        expect(normalizedEvents.filter((event) => event.gestureType === 'rage_tap')).toHaveLength(1);
    });
});

describe('fault rows', () => {
    const coerce = createTimestampCoercer(START, END);
    const crash = { id: 'c1', timestamp: new Date(START + 95_000), exceptionName: 'Boom', reason: 'bad', stackTrace: 'frame one\nframe two' };
    const anr = { id: 'a1', timestamp: new Date(START + 50_000), durationMs: 6200, threadState: 'blocked', deviceMetadata: { stack: 'at Db.query' } };
    const error = { id: 'e1', timestamp: new Date(START + 20_000), errorType: 'js_error', errorName: 'TypeError', message: 'x is undefined', stack: 'at f', screenName: 'Cart' };

    it('become crash, ANR and error events carrying the row id', () => {
        const events = buildFaultEvents([crash], [anr], [error], START, coerce);
        expect(events.map((event) => [event.type, event.faultId, event.timestamp - START])).toEqual([['crash', 'c1', 95_000], ['anr', 'a1', 50_000], ['error', 'e1', 20_000]]);
        expect(events[0]).toMatchObject({ name: 'Boom', message: 'Boom: bad', stack: 'frame one\nframe two' });
        // A placeholder thread state falls back to the stack in the device metadata.
        expect(events[1]).toMatchObject({ name: 'ANR', message: 'ANR detected (6200 ms blocked)', stack: 'at Db.query' });
        expect(events[2]).toMatchObject({ name: 'TypeError', message: 'x is undefined', screen: 'Cart' });
    });

    it('are merged in time order and skipped when the event stream already has them', () => {
        const fromStream = normalizeTimelineEvents([{ type: 'error', name: 'TypeError', message: 'x is undefined', stack: 'at f', timestamp: START + 20_050 }], START, END).normalizedEvents;
        const merged = mergeEventsWithFaults(fromStream, buildFaultEvents([crash], [], [error], START, coerce));
        expect(merged.map((event) => event.type)).toEqual(['error', 'crash']);
        expect(merged[0].faultId).toBeUndefined();
    });

    it('dedupe on type, time rounded to 250 ms, name, message and first stack line', () => {
        const base = { type: 'error', timestamp: START + 1000, name: 'E', message: 'm', stack: 'l1\nl2' };
        expect(faultDedupeSignature(base)).toBe(faultDedupeSignature({ ...base, timestamp: START + 1100, stack: 'l1\nother' }));
        expect(faultDedupeSignature(base)).not.toBe(faultDedupeSignature({ ...base, timestamp: START + 1400 }));
        expect(faultDedupeSignature(base)).not.toBe(faultDedupeSignature({ ...base, message: 'different' }));
    });

    it('web long-task ANR rows are hidden, on web only', () => {
        const rows = [{ threadState: 'main_thread_long_task 120ms' }, { threadState: 'at real.Stack' }, { threadState: null, deviceMetadata: { stack: 'MAIN_THREAD_LONG_TASK' } }];
        expect(filterDisplayAnrs('web', rows)).toEqual([rows[1]]);
        expect(filterDisplayAnrs('ios', rows)).toEqual(rows);
    });

    it('stored custom events are added unless the stream has the same name and timestamp', () => {
        const stream = [{ type: 'custom', name: 'a', timestamp: 1 }, { type: 'touch', name: 'b', timestamp: 2 }];
        const stored = [{ type: 'custom', name: 'a', timestamp: 1 }, { type: 'custom', name: 'a', timestamp: 5 }, { type: 'gameplay', name: 'g', timestamp: 6 }, { type: 'Custom', name: 'b', timestamp: 2 }];
        expect(selectExtraCustomSessionEvents(stream, stored)).toEqual([stored[1], stored[3]]);
        expect(selectExtraCustomSessionEvents(stream, 'not an array')).toEqual([]);
    });
});

const normalize = (events: unknown[]) => normalizeTimelineEvents(events, START, END).normalizedEvents;
const condense = (events: unknown[], options: Partial<Parameters<typeof condenseTimeline>[1]> = {}) =>
    condenseTimeline(normalize(events), { sessionStartMs: START, ...options });

describe('condenseTimeline', () => {
    it('maps SDK event types onto the documented set', () => {
        const events = condense([
            { type: 'navigation', timestamp: START + 1000, screen: 'Home' },
            { type: 'touch', timestamp: START + 2000, targetLabel: 'Buy' },
            { type: 'gesture', gestureType: 'dead_tap', timestamp: START + 3000, targetLabel: 'Buy' },
            { type: 'text_input', timestamp: START + 4000, value: 'secret typed text' },
            { type: 'scroll', timestamp: START + 5000 },
            { type: 'network_request', timestamp: START + 6000, method: 'post', url: 'https://api.example.com/pay?token=abc', statusCode: 500 },
            { type: 'network_request', timestamp: START + 6500, method: 'GET', url: 'https://api.example.com/ok', statusCode: 200, duration: 100 },
            { type: 'api_call', timestamp: START + 6800, method: 'GET', url: 'https://api.example.com/slow', statusCode: 200, duration: SLOW_REQUEST_MS },
            { type: 'error', name: 'TypeError', message: 'boom', timestamp: START + 7000 },
            { type: 'custom', name: 'purchase', timestamp: START + 8000 },
            { type: 'level_up', timestamp: START + 8500 },
            { type: 'app_background', timestamp: START + 9000 },
            { type: 'log', level: 'WARN', message: 'careful', timestamp: START + 9500 },
            { type: 'custom', name: '$user_property', timestamp: START + 9600, payload: '{"key":"email","value":"a@b.c"}' },
            { type: 'user_identity_changed', timestamp: START + 9700, userId: 'u1' },
        ]);
        expect(events.map((event) => [event.type, event.name])).toEqual([
            ['screen', 'Home'], ['tap', 'Buy'], ['dead_tap', 'Buy'], ['input', 'text_input'], ['scroll', 'scroll'],
            ['network_error', 'POST api.example.com/pay'], ['slow_request', 'GET api.example.com/slow'], ['error', 'TypeError'],
            ['custom', 'purchase'], ['custom', 'level_up'], ['app_state', 'app_background'], ['log', 'warn'],
        ]);
        expect(events.every((event) => (TIMELINE_EVENT_TYPES as readonly string[]).includes(event.type))).toBe(true);
        expect(JSON.stringify(events)).not.toMatch(/secret typed text|token=abc|a@b\.c|u1/);
        expect(events.find((event) => event.type === 'network_error')?.detail).toBe('status 500');
        expect(events.find((event) => event.type === 'slow_request')?.detail).toBe(`${SLOW_REQUEST_MS} ms`);
    });

    it('reports times in seconds since session start and carries the current screen', () => {
        const events = condense([{ type: 'navigation', timestamp: START + 1000, screen: 'Home' }, { type: 'touch', timestamp: START + 2340, targetLabel: 'A' }]);
        expect(events).toEqual([{ t: 1, type: 'screen', name: 'Home', count: 1 }, { t: 2.3, type: 'tap', name: 'A', screen: 'Home', count: 1 }]);
    });

    it('collapses consecutive identical events with a count and the time of the last', () => {
        const events = condense([
            { type: 'scroll', timestamp: START + 1000 }, { type: 'scroll', timestamp: START + 1500 }, { type: 'scroll', timestamp: START + 2000 },
            { type: 'touch', timestamp: START + 3000, targetLabel: 'A' }, { type: 'scroll', timestamp: START + 4000 },
        ]);
        expect(events).toEqual([
            { t: 1, type: 'scroll', name: 'scroll', count: 3, tEnd: 2 },
            { t: 3, type: 'tap', name: 'A', count: 1 },
            { t: 4, type: 'scroll', name: 'scroll', count: 1 },
        ]);
    });

    it('filters by window and by type', () => {
        const input = [
            { type: 'navigation', timestamp: START + 1000, screen: 'Home' },
            { type: 'touch', timestamp: START + 5000, targetLabel: 'A' },
            { type: 'touch', timestamp: START + 15_000, targetLabel: 'B' },
        ];
        expect(condense(input, { fromSeconds: 4, toSeconds: 10 }).map((event) => event.name)).toEqual(['A']);
        // The screen before the window still labels events inside it.
        expect(condense(input, { fromSeconds: 4, toSeconds: 10 })[0].screen).toBe('Home');
        expect(condense(input, { types: ['screen'] }).map((event) => event.name)).toEqual(['Home']);
    });
});

const row = (t: number, type: CondensedTimelineEvent['type'], name: string, extra: Partial<CondensedTimelineEvent> = {}): CondensedTimelineEvent => ({ t, type, name, count: 1, ...extra });

describe('detectMoments', () => {
    it('groups rage taps on one screen no more than the gap apart into one cluster', () => {
        const events = [
            row(10, 'rage_tap', 'Pay', { screen: 'Checkout', count: 2, tEnd: 11 }),
            row(11 + RAGE_CLUSTER_GAP_SECONDS, 'rage_tap', 'Pay', { screen: 'Checkout' }),
            row(11 + RAGE_CLUSTER_GAP_SECONDS * 2 + 0.1, 'rage_tap', 'Pay', { screen: 'Checkout' }),
            row(40, 'rage_tap', 'Pay', { screen: 'Other' }),
        ];
        const clusters = detectMoments(events).moments.filter((moment) => moment.kind === 'rage_tap_cluster');
        expect(clusters.map((moment) => [moment.t, moment.tEnd, moment.count, moment.screen])).toEqual([
            [10, 11 + RAGE_CLUSTER_GAP_SECONDS, 3, 'Checkout'],
            [11 + RAGE_CLUSTER_GAP_SECONDS * 2 + 0.1, 11 + RAGE_CLUSTER_GAP_SECONDS * 2 + 0.1, 1, 'Checkout'],
            [40, 40, 1, 'Other'],
        ]);
    });

    it('reports every dead tap, failed request, slow request, error, crash and ANR', () => {
        const events = [
            row(1, 'dead_tap', 'Buy'), row(2, 'network_error', 'POST api/pay', { detail: 'status 500' }), row(3, 'slow_request', 'GET api/x'),
            row(4, 'error', 'TypeError'), row(5, 'anr', 'ANR'), row(6, 'crash', 'Boom', { faultId: 'f1' }),
        ];
        const { moments } = detectMoments(events);
        expect(moments.map((moment) => moment.kind)).toEqual(['dead_tap', 'failed_request', 'slow_request', 'error', 'anr', 'crash']);
        expect(moments[5].faultId).toBe('f1');
    });

    it('lists the events of the 10 seconds before a moment, and nearby logs separately', () => {
        const events = [
            row(1, 'tap', 'Old'), row(30 - MOMENT_CONTEXT_SECONDS, 'tap', 'Edge'), row(25, 'log', 'warn', { detail: 'retrying' }),
            row(28, 'tap', 'Pay'), row(30, 'error', 'Boom'), row(31, 'log', 'error', { detail: 'after' }), row(40, 'log', 'info', { detail: 'late' }),
        ];
        const [moment] = detectMoments(events).moments;
        expect(moment.before.map((event) => event.name)).toEqual(['Edge', 'Pay']);
        expect(moment.logs.map((event) => event.detail)).toEqual(['retrying', 'after']);
    });

    it('stuck loop: a screen entered the minimum number of times inside the window', () => {
        const visits = (gap: number) => Array.from({ length: STUCK_LOOP_MIN_VISITS }, (_unused, index) => [row(index * gap, 'screen', 'Login'), row(index * gap + 1, 'screen', `Other${index}`)]).flat();
        const inside = detectMoments(visits(STUCK_LOOP_WINDOW_SECONDS / (STUCK_LOOP_MIN_VISITS - 1))).moments.filter((moment) => moment.kind === 'stuck_loop');
        expect(inside).toHaveLength(1);
        expect(inside[0]).toMatchObject({ name: 'Login', count: STUCK_LOOP_MIN_VISITS, t: 0 });
        const outside = detectMoments(visits(STUCK_LOOP_WINDOW_SECONDS / (STUCK_LOOP_MIN_VISITS - 1) + 1)).moments;
        expect(outside.some((moment) => moment.kind === 'stuck_loop')).toBe(false);
        // One fewer visit is not a loop.
        expect(detectMoments(visits(5).slice(0, (STUCK_LOOP_MIN_VISITS - 1) * 2)).moments.some((moment) => moment.kind === 'stuck_loop')).toBe(false);
    });

    it('stuck loop: one target tapped the minimum number of times inside the window', () => {
        const taps = (count: number, gap: number) => Array.from({ length: count }, (_unused, index) => [row(index * gap, 'tap', 'Retry', { screen: 'Pay' }), row(index * gap + 0.5, 'scroll', 'scroll', { screen: 'Pay' })]).flat();
        const hit = detectMoments(taps(STUCK_TAP_MIN_REPEATS, STUCK_TAP_WINDOW_SECONDS / STUCK_TAP_MIN_REPEATS)).moments.filter((moment) => moment.kind === 'stuck_loop');
        expect(hit).toHaveLength(1);
        expect(hit[0]).toMatchObject({ name: 'Retry', screen: 'Pay', count: STUCK_TAP_MIN_REPEATS });
        expect(detectMoments(taps(STUCK_TAP_MIN_REPEATS - 1, 2)).moments).toEqual([]);
        expect(detectMoments(taps(STUCK_TAP_MIN_REPEATS, STUCK_TAP_WINDOW_SECONDS)).moments).toEqual([]);
        // A collapsed row counts all its taps; unlabeled taps are ignored.
        expect(detectMoments([row(0, 'tap', 'Retry', { count: STUCK_TAP_MIN_REPEATS, tEnd: 3 })]).moments.map((moment) => moment.kind)).toEqual(['stuck_loop']);
        expect(detectMoments([row(0, 'tap', 'tap', { count: 50, tEnd: 3 })]).moments).toEqual([]);
    });

    it('abandon after error: the session ends within the limit after a failure', () => {
        const ending = (gap: number) => [row(1, 'screen', 'Checkout'), row(50, 'network_error', 'POST api/pay', { screen: 'Checkout' }), row(50 + gap, 'scroll', 'scroll', { screen: 'Checkout' })];
        const hit = detectMoments(ending(ABANDON_AFTER_ERROR_SECONDS)).moments.find((moment) => moment.kind === 'abandon_after_error');
        expect(hit).toMatchObject({ t: 50 + ABANDON_AFTER_ERROR_SECONDS, screen: 'Checkout', name: 'POST api/pay' });
        expect(detectMoments(ending(ABANDON_AFTER_ERROR_SECONDS + 0.5)).moments.some((moment) => moment.kind === 'abandon_after_error')).toBe(false);
    });

    it('abandon after error: not when the session ends in a crash or ANR, and not without a failure', () => {
        expect(detectMoments([row(50, 'error', 'E'), row(52, 'crash', 'Boom')]).moments.map((moment) => moment.kind)).toEqual(['error', 'crash']);
        expect(detectMoments([row(50, 'tap', 'A'), row(52, 'scroll', 'scroll')]).moments).toEqual([]);
        expect(detectMoments([]).moments).toEqual([]);
    });

    it('is deterministic and caps the number of moments, reporting how many were dropped', () => {
        const events = Array.from({ length: MAX_MOMENTS + 7 }, (_unused, index) => row(index * 20, 'error', `E${index}`));
        const first = detectMoments(events);
        expect(first.moments).toHaveLength(MAX_MOMENTS);
        // +1: the last error is also an abandon_after_error.
        expect(first.dropped).toBe(8);
        expect(detectMoments(events)).toEqual(first);
    });
});

describe('timeline helpers', () => {
    const long = Array.from({ length: 1000 }, (_unused, index) => row(index, 'tap', `T${index}`));

    it('trimTimeline keeps the start, the end and every moment window, and says what it left out', () => {
        const trimmed = trimTimeline(long, [{ t: 500 }], { maxEvents: 100, head: 10, tail: 10 });
        const names = trimmed.events.map((event) => event.name);
        expect(names.slice(0, 10)).toEqual(long.slice(0, 10).map((event) => event.name));
        expect(names.slice(-10)).toEqual(long.slice(-10).map((event) => event.name));
        for (let t = 500 - MOMENT_CONTEXT_SECONDS; t <= 500; t += 1) expect(names).toContain(`T${t}`);
        expect(names).not.toContain('T400');
        expect(trimmed).toMatchObject({ total: 1000, omitted: 1000 - trimmed.events.length });
        expect(trimTimeline(long.slice(0, 50), [], { maxEvents: 100, head: 10, tail: 10 })).toMatchObject({ omitted: 0, total: 50 });
    });

    it('trimTimeline never exceeds the limit, even with moments everywhere', () => {
        const everywhere = long.map((event) => ({ t: event.t }));
        expect(trimTimeline(long, everywhere, { maxEvents: 100, head: 10, tail: 10 }).events).toHaveLength(100);
    });

    it('screenVisits gives the time on each screen', () => {
        expect(screenVisits([row(1, 'screen', 'A'), row(5, 'tap', 'x'), row(20, 'screen', 'B'), row(26, 'tap', 'y', { tEnd: 30 })])).toEqual([
            { name: 'A', t: 1, seconds: 19 }, { name: 'B', t: 20, seconds: 10 },
        ]);
        expect(screenVisits([])).toEqual([]);
    });

    it('leadUpWindow keeps the window before an instant, newest first when over the limit', () => {
        expect(leadUpWindow(long, 500, 30, 100).events.map((event) => event.t)).toEqual(Array.from({ length: 31 }, (_unused, index) => 470 + index));
        const capped = leadUpWindow(long, 500, 30, 5);
        expect(capped).toMatchObject({ dropped: true });
        expect(capped.events.map((event) => event.t)).toEqual([496, 497, 498, 499, 500]);
    });

    it('computeCommonLeadUp keeps what a strict majority of sessions share and states n', () => {
        const a = [row(1, 'screen', 'Cart'), row(2, 'tap', 'Pay', { screen: 'Cart' }), row(3, 'crash', 'Boom', { screen: 'Cart' })];
        const b = [row(1, 'screen', 'Cart'), row(2, 'network_error', 'POST pay', { screen: 'Cart' }), row(3, 'crash', 'Boom', { screen: 'Cart' })];
        const c = [row(1, 'screen', 'Home'), row(2, 'tap', 'Pay', { screen: 'Home' }), row(3, 'crash', 'Boom', { screen: 'Home' })];
        const common = computeCommonLeadUp([a, b, c]);
        expect(common.sessionsSampled).toBe(3);
        expect(common.screens).toEqual([{ name: 'Cart', sessions: 2 }]);
        expect(common.eventTypes).toEqual([{ type: 'crash', sessions: 3 }, { type: 'screen', sessions: 3 }, { type: 'tap', sessions: 2 }]);
        expect(common.events).toEqual([{ type: 'crash', name: 'Boom', sessions: 3 }, { type: 'tap', name: 'Pay', sessions: 2 }]);
        // Half is not a majority.
        expect(computeCommonLeadUp([a, c]).screens).toEqual([]);
        expect(computeCommonLeadUp([])).toEqual({ sessionsSampled: 0, screens: [], eventTypes: [], events: [] });
    });
});
