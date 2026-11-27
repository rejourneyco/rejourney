import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * reconcileSessionState wiring for two ingest write-path changes:
 *  - project settings come from the per-process cache, not a `projects` query;
 *  - idle finalization waits for live window + touch interval of stored silence.
 */

const state = vi.hoisted(() => ({
    session: null as any,
    sessionUpdates: [] as Record<string, unknown>[],
    selectedTables: [] as string[],
    getCachedProjectSettings: null as any,
    incrementProjectSessionReplayIfNeeded: null as any,
    updateDeviceUsage: null as any,
}));

vi.mock('../db/client.js', async () => {
    const schema = await import('../db/schema.js');
    const { getTableName } = await import('drizzle-orm');
    const db = {
        select: () => ({
            from: (table: any) => {
                const name = getTableName(table);
                state.selectedTables.push(name);
                const rows = name === 'sessions' ? [state.session] : name === 'session_metrics' ? [{ sessionId: state.session.id }] : [];
                const chain: any = {};
                chain.where = () => chain;
                chain.limit = async () => rows;
                return chain;
            },
        }),
        insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
        transaction: async (run: any) => run({
            execute: async () => undefined,
            update: (table: any) => ({
                set: (values: Record<string, unknown>) => ({
                    where: async () => {
                        if (getTableName(table) === 'sessions') state.sessionUpdates.push(values);
                    },
                }),
            }),
        }),
    };
    return { ...schema, db, dbRead: db, pool: {} };
});

vi.mock('../logger.js', () => {
    const log: any = { child: () => log, debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    return { logger: log };
});

vi.mock('../services/projectSettingsCache.js', () => {
    state.getCachedProjectSettings = vi.fn();
    return { getCachedProjectSettings: state.getCachedProjectSettings };
});

vi.mock('../services/sessionEvidence.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/sessionEvidence.js')>();
    return {
        ...actual,
        loadSessionWorkAggregate: vi.fn(async () => ({
            readyScreenshotCount: 2,
            readyScreenshotBytes: 2048,
            readyWebReplayCount: 0,
            readyWebReplayBytes: 0,
            readyHierarchyCount: 1,
            openArtifactCount: 0,
            activeJobCount: 0,
            openReplayArtifactCount: 0,
            activeReplayJobCount: 0,
            latestReplayArtifactEndMs: null,
            latestEventArtifactEndMs: null,
            latestReadyAt: null,
            pendingEventEvidenceCount: 0,
            readyEventArtifactMissingDerivedCount: 0,
            hasPendingProcessingWork: false,
            hasPendingWork: false,
            hasPendingReplayWork: false,
        })),
    };
});

vi.mock('../services/sessionTimingQuery.js', () => ({ loadSuccessorSessionStartedAt: vi.fn(async () => null) }));

vi.mock('../services/smartCapture.js', () => ({
    discardSmartCaptureVisualArtifacts: vi.fn(async () => undefined),
    isSmartCaptureEntitled: vi.fn(async () => false),
    isSmartCaptureBufferAtLimit: vi.fn(async () => false),
    resolveSmartCaptureDecision: vi.fn(async () => ({
        status: 'kept',
        reason: 'record_all',
        ruleId: null,
        decidedAt: null,
        shouldExposeReplay: true,
        shouldDiscardVisualArtifacts: false,
    })),
}));

vi.mock('../services/quotaCheck.js', () => {
    state.incrementProjectSessionReplayIfNeeded = vi.fn(async () => true);
    return {
        getTeamSessionUsage: vi.fn(async () => ({ isReplayAtLimit: false })),
        incrementProjectSessionReplayIfNeeded: state.incrementProjectSessionReplayIfNeeded,
    };
});

vi.mock('../services/recording.js', () => {
    state.updateDeviceUsage = vi.fn(async () => undefined);
    return { updateDeviceUsage: state.updateDeviceUsage };
});

vi.mock('../services/researchLakeV2Lifecycle.js', () => ({
    prepareResearchLakeV2Session: vi.fn(async () => ({ preserveVisualArtifacts: false })),
}));

import {
    SESSION_FINALIZE_IDLE_MS,
    reconcileSessionState,
} from '../services/sessionReconciliation.js';
import { SESSION_LIVE_INGEST_WINDOW_MS } from '../services/sessionEvidence.js';

const NOW = new Date('2026-11-27T12:10:00.000Z');
const PROJECT = {
    id: 'project-1',
    teamId: 'team-1',
    maxRecordingMinutes: 10,
    webMaxObservabilityMinutes: 30,
    smartCaptureEnabled: false,
    smartCaptureMode: 'record_all',
    smartCapturePreset: 'none',
    smartCaptureRules: [],
    smartCaptureDecisionWindowHours: 168,
    sampleRate: 100,
};

function seedSession(lastIngestAgeMs: number, overrides: Record<string, unknown> = {}) {
    state.session = {
        id: 'session_1',
        projectId: 'project-1',
        deviceId: 'device-1',
        platform: 'ios',
        status: 'processing',
        startedAt: new Date('2026-11-27T12:05:00.000Z'),
        endedAt: null,
        durationSeconds: null,
        backgroundTimeSeconds: 0,
        lastIngestActivityAt: new Date(NOW.getTime() - lastIngestAgeMs),
        sdkPausedAt: null,
        replayAvailable: true,
        replayRetentionState: 'saved',
        replayQuotaBillingExhausted: false,
        replayQuotaCountedAt: new Date('2026-11-27T12:05:30.000Z'),
        recordingDeleted: false,
        isReplayExpired: false,
        ...overrides,
    };
}

describe('reconcileSessionState', () => {
    beforeEach(() => {
        state.sessionUpdates.length = 0;
        state.selectedTables.length = 0;
        state.getCachedProjectSettings.mockReset();
        state.getCachedProjectSettings.mockResolvedValue(PROJECT);
        state.updateDeviceUsage.mockClear();
    });

    it('reads project settings from the cache instead of querying the projects table', async () => {
        seedSession(5_000);

        await reconcileSessionState('session_1', NOW);
        await reconcileSessionState('session_1', NOW);

        expect(state.getCachedProjectSettings).toHaveBeenCalledTimes(2);
        expect(state.getCachedProjectSettings).toHaveBeenCalledWith('project-1');
        expect(state.selectedTables).not.toContain('projects');
        expect(state.selectedTables.filter((name) => name === 'sessions')).toHaveLength(2);
    });

    it('still reconciles when the project row is missing', async () => {
        state.getCachedProjectSettings.mockResolvedValue(null);
        seedSession(5_000);

        const result = await reconcileSessionState('session_1', NOW);

        expect(result).toMatchObject({ status: 'processing', finalized: false, replayAvailable: true });
    });

    it('does not finalize an idle session whose stored clock is only one live window old', async () => {
        // 61 s of stored silence can be as little as 46 s of real silence.
        seedSession(SESSION_LIVE_INGEST_WINDOW_MS + 1_000);

        const result = await reconcileSessionState('session_1', NOW);

        expect(result).toMatchObject({ finalized: false, status: 'processing' });
        expect(state.sessionUpdates).toHaveLength(1);
        expect(state.sessionUpdates[0]).toMatchObject({ status: 'processing', replaySegmentCount: 2 });
        expect(state.sessionUpdates[0]).not.toHaveProperty('endedAt');
        expect(state.updateDeviceUsage).not.toHaveBeenCalled();
    });

    it('finalizes once stored silence reaches live window + touch interval', async () => {
        seedSession(SESSION_FINALIZE_IDLE_MS);

        const result = await reconcileSessionState('session_1', NOW);

        expect(result).toMatchObject({ finalized: true, status: 'ready' });
        expect(state.sessionUpdates[0]).toMatchObject({
            status: 'ready',
            endedAt: state.session.lastIngestActivityAt,
        });
        expect(state.updateDeviceUsage).toHaveBeenCalledTimes(1);
    });

    it('finalizes immediately on an explicit close regardless of the idle window', async () => {
        const endedAt = new Date(NOW.getTime() - 2_000);
        seedSession(2_000, { endedAt, durationSeconds: 298 });

        const result = await reconcileSessionState('session_1', NOW);

        expect(result).toMatchObject({ finalized: true, status: 'ready' });
        expect(state.sessionUpdates[0]).toMatchObject({ status: 'ready', endedAt, durationSeconds: 298 });
    });
});
