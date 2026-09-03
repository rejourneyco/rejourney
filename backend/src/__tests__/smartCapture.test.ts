import { describe, expect, it } from 'vitest';

import {
    getSmartCaptureBufferMaxReplays,
    getSmartCapturePresetRules,
    normalizeDecisionWindowHours,
    resolveSmartCaptureDecision,
    type SmartCaptureProjectConfig,
} from '../services/smartCapture.js';

const baseProject: SmartCaptureProjectConfig = {
    id: 'project_123',
    teamId: 'team_123',
    smartCaptureEnabled: true,
    smartCaptureMode: 'smart_capture',
    smartCapturePreset: 'none',
    smartCaptureRules: [],
    smartCaptureDecisionWindowHours: 168,
};

const baseSession = {
    id: 'session_123',
    projectId: 'project_123',
    deviceId: 'device_123',
    startedAt: new Date('2026-06-01T00:00:00.000Z'),
    durationSeconds: 120,
    events: [],
    metadata: {},
};

describe('smartCapture decisions', () => {
    it('matches the new_user signal from the scrub-surviving ledger ordinal without querying sessions', async () => {
        const newUserProject = {
            ...baseProject,
            smartCaptureRules: [
                { id: 'new-users', type: 'signal', signal: 'new_user', label: 'New users', condition: { maxVisits: 3 } },
            ],
        };

        const firstVisit = await resolveSmartCaptureDecision({
            project: newUserProject,
            session: { ...baseSession, visitorKey: 'vk_1', visitorSessionOrdinal: 1 },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });
        expect(firstVisit.status).toBe('kept');
        expect(firstVisit.ruleId).toBe('new-users');

        // Fourth lifetime visit: the ordinal (not a count over still-identifiable rows)
        // says this visitor is no longer new, even if earlier sessions were scrubbed.
        const fourthVisit = await resolveSmartCaptureDecision({
            project: newUserProject,
            session: { ...baseSession, visitorKey: 'vk_1', visitorSessionOrdinal: 4 },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });
        expect(fourthVisit.status).toBe('discarded');
        expect(fourthVisit.reason).toBe('no_rules_matched');
    });

    it('keeps replay artifacts when Scale Smart Capture is in record all mode', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: { ...baseProject, smartCaptureMode: 'record_all' },
            session: baseSession,
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(decision.status).toBe('kept');
        expect(decision.reason).toBe('record_all');
        expect(decision.shouldExposeReplay).toBe(true);
        expect(decision.shouldDiscardVisualArtifacts).toBe(false);
    });

    it('normalizes disabled Smart Capture to record all behavior', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: { ...baseProject, smartCaptureEnabled: false, smartCaptureMode: 'smart_capture' },
            session: baseSession,
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(decision.status).toBe('kept');
        expect(decision.reason).toBe('record_all');
        expect(decision.shouldExposeReplay).toBe(true);
        expect(decision.shouldDiscardVisualArtifacts).toBe(false);
    });

    it('discards visual artifacts in analytics only mode while preserving analytics', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: { ...baseProject, smartCaptureMode: 'analytics_only' },
            session: baseSession,
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(decision.status).toBe('discarded');
        expect(decision.reason).toBe('analytics_only');
        expect(decision.shouldExposeReplay).toBe(false);
        expect(decision.shouldDiscardVisualArtifacts).toBe(true);
    });

    it('keeps sessions matching immediate high-friction preset rules', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: {
                ...baseProject,
                smartCapturePreset: 'high_friction',
                smartCaptureRules: getSmartCapturePresetRules('high_friction'),
            },
            session: baseSession,
            metrics: { rageTapCount: 1 },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(decision.status).toBe('kept');
        expect(decision.ruleId).toContain('preset_high_friction');
        expect(decision.shouldExposeReplay).toBe(true);
    });

    it('keeps sessions matching detailed crash count thresholds', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: {
                ...baseProject,
                smartCaptureRules: [
                    { id: 'crash-threshold', type: 'metric', signal: 'crashes', label: 'Crashes >= 2', operator: 'gte', value: 2 },
                ],
            },
            session: baseSession,
            metrics: { crashCount: 2 },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(decision.status).toBe('kept');
        expect(decision.ruleId).toBe('crash-threshold');
    });

    it('keeps sessions matching API error rate thresholds', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: {
                ...baseProject,
                smartCaptureRules: [
                    { id: 'api-rate', type: 'metric', signal: 'api_error_rate', name: 'Checkout API loss', label: 'API error rate >= 10%', color: 'rose', operator: 'gte', value: 10 },
                ],
            },
            session: baseSession,
            metrics: { apiErrorCount: 2, apiTotalCount: 10 },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(decision.status).toBe('kept');
        expect(decision.ruleId).toBe('api-rate');
        expect(decision.reason).toBe('Checkout API loss');
    });

    it('keeps sessions matching engagement score thresholds', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: {
                ...baseProject,
                smartCaptureRules: [
                    { id: 'engaged', type: 'metric', signal: 'engagement_score', name: 'Highly engaged', label: 'Engagement score >= 70/100', operator: 'gte', value: 70 },
                ],
            },
            session: baseSession,
            metrics: { interactionScore: 72 },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(decision.status).toBe('kept');
        expect(decision.ruleId).toBe('engaged');
        expect(decision.reason).toBe('Highly engaged');
    });

    it('keeps bouncer sessions under ten seconds', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: {
                ...baseProject,
                smartCaptureRules: [
                    { id: 'bouncer', type: 'lifecycle', signal: 'bouncer', name: 'Bouncer', label: 'Bouncer session under 10 seconds' },
                ],
            },
            session: { ...baseSession, durationSeconds: 8 },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(decision.status).toBe('kept');
        expect(decision.ruleId).toBe('bouncer');
    });

    it('keeps sessions matching route and screen attributes', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: {
                ...baseProject,
                smartCaptureRules: [
                    { id: 'checkout-route', type: 'attribute', signal: 'url_path', label: 'Route contains checkout', operator: 'contains', value: '/checkout' },
                ],
            },
            session: { ...baseSession, metadata: { webLandingRoute: '/checkout/payment' } },
            metrics: { screensVisited: ['/products', '/checkout/payment'] },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(decision.status).toBe('kept');
        expect(decision.ruleId).toBe('checkout-route');
    });

    it('keeps sessions matching configured custom events', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: {
                ...baseProject,
                smartCaptureRules: [
                    {
                        id: 'payment-event',
                        type: 'event',
                        signal: 'custom_event',
                        name: 'Payment failed',
                        label: 'Custom event contains payment_failed',
                        operator: 'contains',
                        value: 'payment_failed',
                        condition: { attribute: 'event_name', operator: 'contains', value: 'payment_failed' },
                    },
                ],
            },
            session: { ...baseSession, events: [{ name: 'payment_failed', properties: { provider: 'stripe' } }] },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(decision.status).toBe('kept');
        expect(decision.ruleId).toBe('payment-event');
        expect(decision.reason).toBe('Payment failed');
    });

    it('keeps sessions matching configured user metadata', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: {
                ...baseProject,
                smartCaptureRules: [
                    {
                        id: 'enterprise-plan',
                        type: 'attribute',
                        signal: 'user_metadata',
                        name: 'Enterprise users',
                        label: 'User metadata planTier equals Enterprise',
                        operator: 'eq',
                        value: 'Enterprise',
                        condition: { attribute: 'planTier', operator: 'eq', value: 'Enterprise' },
                    },
                ],
            },
            session: { ...baseSession, metadata: { planTier: 'Enterprise' } },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(decision.status).toBe('kept');
        expect(decision.ruleId).toBe('enterprise-plan');
        expect(decision.reason).toBe('Enterprise users');
    });

    it('requires every clause in compound Smart Capture rules to match', async () => {
        const project = {
            ...baseProject,
            smartCaptureRules: [
                {
                    id: 'rage-add-post-os',
                    type: 'metric',
                    signal: 'rage_clicks',
                    name: 'Rage taps on Add-post with OS metadata',
                    label: 'Rage taps AND Add-post AND os',
                    condition: {
                        all: [
                            { type: 'metric', signal: 'rage_clicks', metric: 'rage_tap_count', operator: 'gte', value: 3 },
                            { type: 'attribute', signal: 'screen_name', attribute: 'screen_name', operator: 'contains', value: 'Add-post' },
                            { type: 'attribute', signal: 'user_metadata', attribute: 'os', operator: 'exists' },
                        ],
                    },
                },
            ],
        };

        const matchingDecision = await resolveSmartCaptureDecision({
            project,
            session: { ...baseSession, metadata: { os: 'iOS' } },
            metrics: { rageTapCount: 3, screensVisited: ['Home', 'Add-post'] },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        const partialDecision = await resolveSmartCaptureDecision({
            project,
            session: { ...baseSession, metadata: {} },
            metrics: { rageTapCount: 3, screensVisited: ['Home', 'Add-post'] },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(matchingDecision.status).toBe('kept');
        expect(matchingDecision.ruleId).toBe('rage-add-post-os');
        expect(partialDecision.status).toBe('discarded');
        expect(partialDecision.reason).toBe('no_rules_matched');
    });

    it('counts scoped rage taps only when the tap event happened on the matching screen', async () => {
        const project = {
            ...baseProject,
            smartCaptureRules: [
                {
                    id: 'rage-on-add-post',
                    type: 'metric',
                    signal: 'rage_clicks',
                    name: 'Rage taps on Add-post',
                    label: 'Rage taps >= 1 on Add-post',
                    condition: {
                        metric: 'rage_tap_count',
                        operator: 'gte',
                        value: 1,
                        scope: { attribute: 'screen_name', operator: 'contains', value: 'Add-post' },
                    },
                },
            ],
        };

        const matchingDecision = await resolveSmartCaptureDecision({
            project,
            session: {
                ...baseSession,
                events: [
                    { type: 'rage_tap', screenName: 'Add-post', timestamp: 1000 },
                    { type: 'tap', screenName: 'Home', timestamp: 1500 },
                ],
            },
            metrics: { rageTapCount: 1, screensVisited: ['Home', 'Add-post'] },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        const wrongScreenDecision = await resolveSmartCaptureDecision({
            project,
            session: {
                ...baseSession,
                events: [
                    { type: 'rage_tap', screenName: 'Home', timestamp: 1000 },
                    { type: 'tap', screenName: 'Add-post', timestamp: 1500 },
                ],
            },
            metrics: { rageTapCount: 1, screensVisited: ['Home', 'Add-post'] },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        const aggregateOnlyDecision = await resolveSmartCaptureDecision({
            project,
            session: { ...baseSession, events: [] },
            metrics: { rageTapCount: 3, screensVisited: ['Home', 'Add-post'] },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(matchingDecision.status).toBe('kept');
        expect(matchingDecision.ruleId).toBe('rage-on-add-post');
        expect(wrongScreenDecision.status).toBe('discarded');
        expect(wrongScreenDecision.reason).toBe('no_rules_matched');
        expect(aggregateOnlyDecision.status).toBe('kept');
        expect(aggregateOnlyDecision.ruleId).toBe('rage-on-add-post');
    });

    it('keeps unmatched immediate rules buffered while session evidence is still settling', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: {
                ...baseProject,
                smartCaptureRules: [
                    { id: 'rage-threshold', type: 'metric', signal: 'rage_clicks', label: 'Rage taps >= 3', operator: 'gte', value: 3 },
                ],
            },
            session: baseSession,
            metrics: { rageTapCount: 0 },
            hasReplayArtifacts: true,
            entitled: true,
            canDiscardUnmatched: false,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(decision.status).toBe('pending');
        expect(decision.reason).toBe('waiting_for_session_evidence');
        expect(decision.shouldExposeReplay).toBe(true);
        expect(decision.shouldDiscardVisualArtifacts).toBe(false);
    });

    it('respects per-rule capture rates after a rule matches', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: {
                ...baseProject,
                smartCaptureRules: [
                    { id: 'sampled-crashes', type: 'metric', signal: 'crashes', label: 'Sampled crashes', operator: 'gte', value: 1, captureRate: 0 },
                ],
            },
            session: baseSession,
            metrics: { crashCount: 1 },
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(decision.status).toBe('discarded');
        expect(decision.reason).toBe('no_rules_matched');
    });

    it('holds delayed churn rules as pending until the decision window elapses', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: {
                ...baseProject,
                smartCapturePreset: 'churn_risk',
                smartCaptureRules: getSmartCapturePresetRules('churn_risk'),
            },
            session: baseSession,
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-02T00:00:00.000Z'),
        });

        expect(decision.status).toBe('pending');
        expect(decision.reason).toBe('waiting_for_decision_window');
        expect(decision.shouldExposeReplay).toBe(true);
        expect(decision.shouldDiscardVisualArtifacts).toBe(false);
    });

    it('keeps sessions when Smart Capture has no preset or rules configured', async () => {
        const decision = await resolveSmartCaptureDecision({
            project: baseProject,
            session: baseSession,
            hasReplayArtifacts: true,
            entitled: true,
            now: new Date('2026-06-01T00:03:00.000Z'),
        });

        expect(decision.status).toBe('kept');
        expect(decision.reason).toBe('no_rules_configured');
        expect(decision.shouldExposeReplay).toBe(true);
        expect(decision.shouldDiscardVisualArtifacts).toBe(false);
    });

    it('caps delayed decision windows at 7 days', () => {
        expect(normalizeDecisionWindowHours(999)).toBe(168);
        expect(normalizeDecisionWindowHours(72)).toBe(72);
    });

    it('uses a 200k replay Smart Capture buffer limit by default', () => {
        const original = process.env.RJ_SMART_CAPTURE_BUFFER_MAX_REPLAYS;
        try {
            delete process.env.RJ_SMART_CAPTURE_BUFFER_MAX_REPLAYS;
            expect(getSmartCaptureBufferMaxReplays()).toBe(200_000);
            process.env.RJ_SMART_CAPTURE_BUFFER_MAX_REPLAYS = '12345';
            expect(getSmartCaptureBufferMaxReplays()).toBe(12_345);
        } finally {
            if (original === undefined) {
                delete process.env.RJ_SMART_CAPTURE_BUFFER_MAX_REPLAYS;
            } else {
                process.env.RJ_SMART_CAPTURE_BUFFER_MAX_REPLAYS = original;
            }
        }
    });
});
