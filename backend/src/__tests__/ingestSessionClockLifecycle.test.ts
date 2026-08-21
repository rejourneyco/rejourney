import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
    db: {
        select: vi.fn(),
        update: vi.fn(),
    },
    projects: { id: 'projects.id', teamId: 'projects.team_id' } as any,
    recordingArtifacts: { sessionId: 'recording_artifacts.session_id' } as any,
    sessions: {
        id: 'sessions.id',
        metadata: 'sessions.metadata',
        startedAt: 'sessions.started_at',
    } as any,
    sessionMetrics: { sessionId: 'session_metrics.session_id' } as any,
    teams: { id: 'teams.id', retentionTier: 'teams.retention_tier' } as any,
    setIngestSessionCache: vi.fn(async () => undefined),
    setSessionExistsCache: vi.fn(async () => undefined),
}));

vi.mock('drizzle-orm', () => ({
    eq: mocks.eq,
    inArray: vi.fn(),
    sql: mocks.sql,
}));

vi.mock('../db/client.js', () => ({
    db: mocks.db,
    projects: mocks.projects,
    recordingArtifacts: mocks.recordingArtifacts,
    retentionPolicies: { tier: 'retention_policies.tier', retentionDays: 'retention_policies.retention_days' },
    sessions: mocks.sessions,
    sessionMetrics: mocks.sessionMetrics,
    teams: mocks.teams,
}));

vi.mock('../middleware/index.js', () => ({
    ApiError: class ApiError extends Error {
        static conflict(message: string) {
            return new ApiError(message);
        }
    },
}));

vi.mock('../utils/requestIp.js', () => ({
    getRequestIp: vi.fn(() => null),
}));

vi.mock('../db/redis.js', () => ({
    setIngestSessionCache: mocks.setIngestSessionCache,
    setSessionExistsCache: mocks.setSessionExistsCache,
}));

vi.mock('../logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('../services/recording.js', () => ({
    lookupGeoIp: vi.fn(async () => undefined),
}));

import {
    ingestSessionSelection,
    isSessionIdFresh,
    maybeBackfillSessionStartedAt,
} from '../services/ingestSessionLifecycle.js';
import {
    MAX_FUTURE_CLIENT_CLOCK_SKEW_MS,
    SESSION_CLOCK_METADATA_KEY,
} from '../services/sessionClock.js';

const SERVER_NOW = new Date('2026-06-12T18:00:00.000Z');
const RAW_SESSION_STARTED_AT_MS = Date.UTC(2026, 5, 27, 12, 15, 14, 606);

describe('ingest session lifecycle clock guard', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('keeps large event payloads out of the ingest hot-path projection', () => {
        expect(ingestSessionSelection).not.toHaveProperty('events');
        expect(ingestSessionSelection).toHaveProperty('metadata');
        expect(ingestSessionSelection).toHaveProperty('status');
    });

    it('treats a far-future timestamp session id as fresh after server-time normalization', () => {
        vi.useFakeTimers();
        vi.setSystemTime(SERVER_NOW);

        expect(isSessionIdFresh(`session_${RAW_SESSION_STARTED_AT_MS}_future`)).toBe(true);
    });

    it('does not backfill a clamped session into the future from artifact client time', async () => {
        const session = {
            id: `session_${RAW_SESSION_STARTED_AT_MS}_future`,
            projectId: 'project_1',
            startedAt: SERVER_NOW,
            metadata: {
                [SESSION_CLOCK_METADATA_KEY]: {
                    ruleVersion: 'future-client-clock-v1',
                    clamped: true,
                    rawSessionStartedAtMs: RAW_SESSION_STARTED_AT_MS,
                    normalizedStartedAtMs: SERVER_NOW.getTime(),
                    serverObservedAtMs: SERVER_NOW.getTime(),
                    futureSkewMs: RAW_SESSION_STARTED_AT_MS - SERVER_NOW.getTime(),
                    maxFutureSkewMs: MAX_FUTURE_CLIENT_CLOCK_SKEW_MS,
                },
            },
        };

        const result = await maybeBackfillSessionStartedAt(
            session.id,
            RAW_SESSION_STARTED_AT_MS + 1000,
            session,
            SERVER_NOW,
        );

        expect(result).toBe(session);
        expect(mocks.db.update).not.toHaveBeenCalled();
    });
});
