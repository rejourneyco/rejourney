import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three presign routes answer a capped session with the `skipUpload` body
 * the SDKs already treat as "drop this chunk, do not retry", and never register
 * an artifact for it. The real cap service runs against mocked Redis helpers.
 */

const mocks = vi.hoisted(() => ({
    incrementSessionArtifactCount: vi.fn(),
    claimSessionArtifactCapLog: vi.fn(),
    ensureIngestSession: vi.fn(),
    registerPendingArtifact: vi.fn(),
    prepareReplayArtifactForUpload: vi.fn(),
    setIdempotencyStatus: vi.fn(async () => undefined),
    session: null as any,
    logger: { child: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../db/client.js', () => ({
    db: {},
    projects: { id: 'projects.id' },
    sessionMetrics: { sessionId: 'session_metrics.session_id' },
    sessions: { id: 'sessions.id', projectId: 'sessions.project_id' },
}));

vi.mock('../logger.js', () => ({ logger: mocks.logger }));

vi.mock('../db/redis.js', () => ({
    claimSessionArtifactCapLog: mocks.claimSessionArtifactCapLog,
    incrementSessionArtifactCount: mocks.incrementSessionArtifactCount,
    getIngestProjectCache: vi.fn(async () => ({
        id: 'project-1',
        teamId: 'team-1',
        rejourneyEnabled: true,
        recordingEnabled: true,
        sampleRate: 100,
        maxRecordingMinutes: 10,
        webMaxObservabilityMinutes: 30,
    })),
    getIngestSessionCache: vi.fn(async () => mocks.session),
    getIdempotencyStatus: vi.fn(async () => null),
    setIdempotencyStatus: mocks.setIdempotencyStatus,
    getSessionExistsCache: vi.fn(async () => true),
    invalidateSessionExistsCache: vi.fn(async () => undefined),
    setIngestProjectCache: vi.fn(async () => undefined),
    setIngestSessionCache: vi.fn(async () => undefined),
    setSessionExistsCache: vi.fn(async () => undefined),
    getRedisDiagnosticsForLog: () => ({ redisReportedConnected: true, redisClientStatus: 'ready' }),
}));

vi.mock('../db/s3.js', () => ({
    generateS3Key: vi.fn(() => 's3/key'),
    getEndpointForSession: vi.fn(async () => ({ id: 'endpoint-1' })),
}));

vi.mock('../middleware/index.js', () => {
    class ApiError extends Error {
        static badRequest(message: string) { return new ApiError(message); }
        static notFound(message: string) { return new ApiError(message); }
        static forbidden(message: string) { return new ApiError(message); }
        static paymentRequired(message: string) { return new ApiError(message); }
        static conflict(message: string) { return new ApiError(message); }
    }
    const pass = (_req: unknown, _res: unknown, next: () => void) => next();
    return {
        ApiError,
        apiKeyAuth: pass,
        asyncHandler: (handler: unknown) => handler,
        requireScope: () => pass,
    };
});

vi.mock('../middleware/rateLimit.js', () => {
    const pass = (_req: unknown, _res: unknown, next: () => void) => next();
    return {
        ingestBatchDeviceRateLimiter: pass,
        ingestBatchProjectRateLimiter: pass,
        ingestSegmentDeviceRateLimiter: pass,
        ingestSegmentProjectRateLimiter: pass,
    };
});

vi.mock('../services/recording.js', () => ({ updateDeviceUsage: vi.fn(async () => undefined) }));

vi.mock('../services/ingestSessionLifecycle.js', () => ({
    ensureIngestSession: mocks.ensureIngestSession,
    ingestSessionSelection: {},
    maybeBackfillSessionStartedAt: vi.fn(async () => null),
    setSessionUserDisplayIdIfChanged: vi.fn(async () => false),
}));

vi.mock('../services/quotaCheck.js', () => ({
    checkBillingStatus: vi.fn(async () => ({ canRecord: true })),
    getTeamSessionUsage: vi.fn(async () => ({ isReplayAtLimit: false })),
    incrementProjectSessionCount: vi.fn(async () => undefined),
}));

vi.mock('../services/ingestByteBudget.js', () => ({ enforceIngestByteBudget: vi.fn(async () => undefined) }));

vi.mock('../services/ingestArtifactLifecycle.js', () => ({
    completeArtifactUpload: vi.fn(),
    prepareReplayArtifactForUpload: mocks.prepareReplayArtifactForUpload,
    registerPendingArtifact: mocks.registerPendingArtifact,
}));

vi.mock('../services/ingestUploadRelay.js', () => ({
    ARTIFACT_UPLOAD_URL_TTL_SECONDS: 3600,
    buildArtifactUploadRelayUrl: vi.fn(() => 'https://relay.example/upload/artifacts/artifact-1'),
    getUploadRelayBuildContext: vi.fn(() => ({ relayHost: 'relay.example', relayBaseUrl: 'https://relay.example', publicBaseSource: 'test' })),
}));

vi.mock('../services/visitorLedger.js', () => ({ assignSessionVisitorById: vi.fn(async () => undefined) }));

import router from '../routes/ingestUploads.js';
import { MAX_ARTIFACTS_PER_SESSION, MAX_SESSION_INGEST_AGE_MS } from '../services/ingestSessionArtifactCap.js';

type RouteStack = { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> };

async function post(path: string, body: Record<string, unknown>) {
    const layer = (router as unknown as RouteStack).stack.find((candidate) => candidate.route?.path === path && candidate.route.methods.post);
    if (!layer?.route) throw new Error(`route ${path} not found`);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const res = {
        statusCode: 200,
        body: undefined as any,
        status(code: number) { this.statusCode = code; return this; },
        json(payload: unknown) { this.body = payload; return this; },
    };
    await handler({ body, headers: {}, project: { id: 'project-1', teamId: 'team-1' }, ip: '8.8.8.8', socket: {} }, res, () => undefined);
    return res;
}

const SESSION_START = Date.now() - 60_000;
const SESSION_ID = `session_${SESSION_START}_abc`;

function makeSession(overrides: Record<string, unknown> = {}) {
    return {
        id: SESSION_ID,
        projectId: 'project-1',
        status: 'processing',
        platform: 'ios',
        startedAt: new Date(SESSION_START),
        createdAt: new Date(SESSION_START + 500),
        endedAt: null,
        isSampledIn: true,
        recordingDeleted: false,
        isReplayExpired: false,
        replayQuotaBillingExhausted: false,
        metadata: {},
        ...overrides,
    };
}

const requests: Array<[string, string, Record<string, unknown>]> = [
    ['events', '/presign', { sessionId: SESSION_ID, contentType: 'events', batchNumber: 3, sizeBytes: 512 }],
    ['screenshots', '/segment/presign', { sessionId: SESSION_ID, kind: 'screenshots', startTime: SESSION_START + 1_000, endTime: SESSION_START + 2_000, sizeBytes: 512 }],
    ['hierarchy', '/segment/presign', { sessionId: SESSION_ID, kind: 'hierarchy', startTime: SESSION_START + 1_000, endTime: SESSION_START + 2_000, sizeBytes: 512 }],
    ['rrweb', '/rrweb/presign', { sessionId: SESSION_ID, sequence: 1, startTime: SESSION_START + 1_000, endTime: SESSION_START + 2_000, sizeBytes: 512 }],
];

describe('presign per-session cap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.session = makeSession();
        mocks.ensureIngestSession.mockImplementation(async () => ({ session: mocks.session, created: false }));
        mocks.incrementSessionArtifactCount.mockResolvedValue(42);
        mocks.claimSessionArtifactCapLog.mockResolvedValue(true);
        mocks.registerPendingArtifact.mockResolvedValue({ id: 'artifact-1' });
        mocks.prepareReplayArtifactForUpload.mockResolvedValue({ artifact: { id: 'artifact-1' }, action: 'created', alreadyCompleted: false });
    });

    it.each(requests)('issues an upload URL for %s while the session is under the cap, counting it once', async (_kind, path, body) => {
        const res = await post(path, body);

        expect(res.body).toMatchObject({ presignedUrl: expect.any(String), sessionId: SESSION_ID });
        expect(res.body.skipUpload).toBeUndefined();
        expect(mocks.incrementSessionArtifactCount).toHaveBeenCalledTimes(1);
        expect(mocks.incrementSessionArtifactCount).toHaveBeenCalledWith('project-1', SESSION_ID, 172_800);
        expect(mocks.registerPendingArtifact.mock.calls.length + mocks.prepareReplayArtifactForUpload.mock.calls.length).toBe(1);
    });

    it.each(requests)('answers a capped %s presign with skipUpload and registers nothing', async (kind, path, body) => {
        mocks.incrementSessionArtifactCount.mockResolvedValue(MAX_ARTIFACTS_PER_SESSION + 1);

        const res = await post(path, body);

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            skipUpload: true,
            sessionId: SESSION_ID,
            reason: expect.stringContaining('Session upload limit reached'),
        });
        expect(mocks.registerPendingArtifact).not.toHaveBeenCalled();
        expect(mocks.prepareReplayArtifactForUpload).not.toHaveBeenCalled();
        expect(mocks.setIdempotencyStatus).not.toHaveBeenCalled();
        expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
        expect(mocks.logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'ingest.session_artifact_cap_tripped', kind, sessionId: SESSION_ID }),
            'ingest.session_artifact_cap_tripped',
        );
        // Rejected presigns are not logged one by one.
        expect(mocks.logger.info).not.toHaveBeenCalledWith(expect.anything(), 'ingest.presign_skip');
    });

    it.each(requests)('answers a %s presign for a session first stored more than 48 hours ago with skipUpload', async (_kind, path, body) => {
        mocks.session = makeSession({ createdAt: new Date(Date.now() - MAX_SESSION_INGEST_AGE_MS - 60_000) });

        const res = await post(path, body);

        expect(res.body).toMatchObject({ skipUpload: true, sessionId: SESSION_ID });
        expect(res.body.reason).toContain('Session upload window exceeded');
        expect(mocks.incrementSessionArtifactCount).not.toHaveBeenCalled();
        expect(mocks.registerPendingArtifact).not.toHaveBeenCalled();
        expect(mocks.prepareReplayArtifactForUpload).not.toHaveBeenCalled();
    });

    it('does not judge age by the client clock: an old started_at with a fresh row still uploads', async () => {
        const oldStart = Date.now() - 5 * 24 * 60 * 60 * 1000;
        mocks.session = makeSession({ startedAt: new Date(oldStart), createdAt: new Date(Date.now() - 1_000) });

        const res = await post('/presign', { sessionId: SESSION_ID, contentType: 'events', batchNumber: 1, sizeBytes: 512 });

        expect(res.body).toMatchObject({ presignedUrl: expect.any(String) });
        expect(mocks.registerPendingArtifact).toHaveBeenCalledTimes(1);
    });

    it.each(requests)('fails open for %s when Redis cannot count', async (_kind, path, body) => {
        mocks.incrementSessionArtifactCount.mockResolvedValue(null);

        const res = await post(path, body);

        expect(res.body).toMatchObject({ presignedUrl: expect.any(String) });
        expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('does not count presigns that are skipped for another reason', async () => {
        mocks.session = makeSession({ isSampledIn: false });

        const res = await post('/segment/presign', requests[1][2]);

        expect(res.body).toMatchObject({ skipUpload: true });
        expect(mocks.incrementSessionArtifactCount).not.toHaveBeenCalled();
    });
});
