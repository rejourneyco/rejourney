import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    incrementSessionArtifactCount: vi.fn(),
    claimSessionArtifactCapLog: vi.fn(),
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../db/redis.js', () => ({
    incrementSessionArtifactCount: mocks.incrementSessionArtifactCount,
    claimSessionArtifactCapLog: mocks.claimSessionArtifactCapLog,
}));

vi.mock('../logger.js', () => ({ logger: mocks.logger }));

import {
    MAX_ARTIFACTS_PER_SESSION,
    MAX_SESSION_INGEST_AGE_MS,
    SESSION_ARTIFACT_COUNTER_TTL_SECONDS,
    checkSessionArtifactCap,
} from '../services/ingestSessionArtifactCap.js';

const NOW = new Date('2026-11-27T12:00:00.000Z');
const params = (overrides: Record<string, unknown> = {}) => ({
    projectId: 'project-1',
    sessionId: 'session_1',
    sessionCreatedAt: new Date(NOW.getTime() - 5 * 60_000),
    route: '/api/ingest/presign',
    kind: 'events',
    now: NOW,
    ...overrides,
});

describe('per-session artifact cap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.incrementSessionArtifactCount.mockResolvedValue(1);
        mocks.claimSessionArtifactCapLog.mockResolvedValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses named limits far above a normal session and a counter TTL equal to the age limit', () => {
        expect(MAX_ARTIFACTS_PER_SESSION).toBe(20_000);
        expect(MAX_SESSION_INGEST_AGE_MS).toBe(48 * 60 * 60 * 1000);
        expect(SESSION_ARTIFACT_COUNTER_TTL_SECONDS).toBe(48 * 60 * 60);
    });

    it('counts every allowed presign with a TTL', async () => {
        mocks.incrementSessionArtifactCount.mockResolvedValue(600);

        await expect(checkSessionArtifactCap(params())).resolves.toEqual({ allowed: true, count: 600 });

        expect(mocks.incrementSessionArtifactCount).toHaveBeenCalledTimes(1);
        expect(mocks.incrementSessionArtifactCount).toHaveBeenCalledWith('project-1', 'session_1', 172_800);
        expect(mocks.claimSessionArtifactCapLog).not.toHaveBeenCalled();
        expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('allows exactly MAX_ARTIFACTS_PER_SESSION and rejects the next one', async () => {
        mocks.incrementSessionArtifactCount.mockResolvedValueOnce(MAX_ARTIFACTS_PER_SESSION);
        await expect(checkSessionArtifactCap(params())).resolves.toEqual({ allowed: true, count: MAX_ARTIFACTS_PER_SESSION });

        mocks.incrementSessionArtifactCount.mockResolvedValueOnce(MAX_ARTIFACTS_PER_SESSION + 1);
        await expect(checkSessionArtifactCap(params())).resolves.toEqual({
            allowed: false,
            reason: 'session_artifact_cap_exceeded',
            count: MAX_ARTIFACTS_PER_SESSION + 1,
            message: expect.stringContaining('Session upload limit reached'),
        });
    });

    it('logs the trip once per session, however many presigns are rejected afterwards', async () => {
        mocks.incrementSessionArtifactCount.mockResolvedValue(MAX_ARTIFACTS_PER_SESSION + 1);
        mocks.claimSessionArtifactCapLog
            .mockResolvedValueOnce(true)
            .mockResolvedValue(false);

        for (let attempt = 0; attempt < 5; attempt += 1) {
            const decision = await checkSessionArtifactCap(params({ kind: 'screenshots', route: '/api/ingest/segment/presign' }));
            expect(decision.allowed).toBe(false);
        }

        expect(mocks.claimSessionArtifactCapLog).toHaveBeenCalledTimes(5);
        expect(mocks.claimSessionArtifactCapLog).toHaveBeenCalledWith('project-1', 'session_1', 172_800);
        expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
        expect(mocks.logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'ingest.session_artifact_cap_tripped',
                projectId: 'project-1',
                sessionId: 'session_1',
                reason: 'session_artifact_cap_exceeded',
                artifactCount: MAX_ARTIFACTS_PER_SESSION + 1,
                kind: 'screenshots',
                route: '/api/ingest/segment/presign',
            }),
            'ingest.session_artifact_cap_tripped',
        );
    });

    it('fails open when Redis cannot count', async () => {
        mocks.incrementSessionArtifactCount.mockResolvedValue(null);

        await expect(checkSessionArtifactCap(params())).resolves.toEqual({ allowed: true, count: null });
        expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('rejects a session the server first stored more than 48 hours ago without counting it', async () => {
        const decision = await checkSessionArtifactCap(params({
            sessionCreatedAt: new Date(NOW.getTime() - MAX_SESSION_INGEST_AGE_MS - 1),
        }));

        expect(decision).toEqual({
            allowed: false,
            reason: 'session_max_age_exceeded',
            count: null,
            message: expect.stringContaining('Session upload window exceeded'),
        });
        expect(mocks.incrementSessionArtifactCount).not.toHaveBeenCalled();
        expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
        expect(mocks.logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ reason: 'session_max_age_exceeded', sessionAgeMs: MAX_SESSION_INGEST_AGE_MS + 1 }),
            'ingest.session_artifact_cap_tripped',
        );
    });

    it('still enforces the age limit (silently) when Redis is down', async () => {
        mocks.claimSessionArtifactCapLog.mockResolvedValue(false);

        const decision = await checkSessionArtifactCap(params({
            sessionCreatedAt: new Date(NOW.getTime() - MAX_SESSION_INGEST_AGE_MS - 60_000),
        }));

        expect(decision.allowed).toBe(false);
        expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('accepts a session exactly at the age limit, as an ISO string from the row cache, or with no creation time', async () => {
        await expect(checkSessionArtifactCap(params({
            sessionCreatedAt: new Date(NOW.getTime() - MAX_SESSION_INGEST_AGE_MS),
        }))).resolves.toMatchObject({ allowed: true });
        await expect(checkSessionArtifactCap(params({
            sessionCreatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        }))).resolves.toMatchObject({ allowed: true });
        await expect(checkSessionArtifactCap(params({ sessionCreatedAt: null }))).resolves.toMatchObject({ allowed: true });
        await expect(checkSessionArtifactCap(params({ sessionCreatedAt: 'not-a-date' }))).resolves.toMatchObject({ allowed: true });

        expect(mocks.incrementSessionArtifactCount).toHaveBeenCalledTimes(4);
    });
});
