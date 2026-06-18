import { Router } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { sessionAuth, asyncHandler, ApiError } from '../middleware/index.js';
import { alertHistory, dbRead } from '../db/client.js';
import {
    callIssueDetection,
    ensureIssueDetectionEnabled,
    requireProjectAccess,
} from '../services/issueDetectionClient.js';

const router = Router();

const ALLOWED_LEAK_STATUSES = new Set(['queued', 'researching', 'ready', 'resolved', 'ignored', 'budget_exhausted', 'failed']);

type LeakLike = {
    id?: string;
    projectId?: string;
    project_id?: string;
};

type ScanRunEmail = {
    status?: string;
    reason?: string | null;
    issueCount?: number | null;
    recipientCount?: number | null;
    sentAt?: string | null;
};

type ScanRunLike = {
    id?: string;
    email?: ScanRunEmail | null;
};

type ScanRunHistoryLike = {
    runs?: ScanRunLike[];
    stats?: unknown;
};

function getLeakProjectId(leak: LeakLike): string | null {
    return leak.projectId ?? leak.project_id ?? null;
}

async function fetchLeakForAccessCheck(leakId: string): Promise<LeakLike> {
    const leak = await callIssueDetection<LeakLike>({
        pathWithQuery: `/v1/leaks/${encodeURIComponent(leakId)}`,
    });
    const projectId = getLeakProjectId(leak);
    if (!projectId) throw ApiError.serviceUnavailable('Issue detection returned an invalid leak');
    return leak;
}

router.use(sessionAuth);

router.get('/leaks', asyncHandler(async (req, res) => {
    ensureIssueDetectionEnabled();
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
    if (!projectId) throw ApiError.badRequest('projectId is required');
    await requireProjectAccess(req.user!.id, projectId);

    const params = new URLSearchParams();
    for (const key of ['status', 'q', 'cursor', 'limit', 'severity', 'type']) {
        const value = req.query[key];
        if (typeof value === 'string' && value.trim()) params.set(key, value);
    }

    const query = params.toString();
    const data = await callIssueDetection<unknown>({
        pathWithQuery: `/v1/projects/${encodeURIComponent(projectId)}/leaks${query ? `?${query}` : ''}`,
    });
    res.json(data);
}));

router.get('/leaks/runs', asyncHandler(async (req, res) => {
    ensureIssueDetectionEnabled();
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
    if (!projectId) throw ApiError.badRequest('projectId is required');
    await requireProjectAccess(req.user!.id, projectId);

    const params = new URLSearchParams();
    const limit = typeof req.query.limit === 'string' ? req.query.limit : '';
    if (limit.trim()) params.set('limit', limit);

    const query = params.toString();
    let data: ScanRunHistoryLike & { unavailableReason?: string };
    try {
        data = await callIssueDetection<ScanRunHistoryLike>({
            pathWithQuery: `/v1/projects/${encodeURIComponent(projectId)}/scan-runs${query ? `?${query}` : ''}`,
        });
    } catch (err) {
        if (err instanceof ApiError && (err.statusCode === 404 || err.statusCode === 503)) {
            res.json({
                runs: [],
                stats: {
                    total: 0,
                    lastRunAt: null,
                    lastSuccessAt: null,
                    recentFailures: 0,
                },
                unavailableReason: err.statusCode === 404
                    ? 'run_history_endpoint_not_deployed'
                    : 'issue_detection_service_unavailable',
            });
            return;
        }
        throw err;
    }
    const runs = Array.isArray(data.runs) ? data.runs : [];
    const runIds = runs.map((run) => run.id).filter((id): id is string => Boolean(id));

    if (runIds.length === 0) {
        res.json({ ...data, runs });
        return;
    }

    const sentRows = await dbRead
        .select({
            fingerprint: alertHistory.fingerprint,
            recipientCount: alertHistory.recipientCount,
            sentAt: alertHistory.sentAt,
        })
        .from(alertHistory)
        .where(and(
            eq(alertHistory.projectId, projectId),
            eq(alertHistory.alertType, 'leak_scan'),
            inArray(alertHistory.fingerprint, runIds),
        ));
    const sentByRunId = new Map(sentRows
        .filter((row) => row.fingerprint)
        .map((row) => [row.fingerprint!, row]));

    res.json({
        ...data,
        runs: runs.map((run) => {
            if (!run.id) return run;
            const sent = sentByRunId.get(run.id);
            if (!sent) return run;
            return {
                ...run,
                email: {
                    ...(run.email ?? {}),
                    status: 'sent',
                    recipientCount: sent.recipientCount,
                    sentAt: sent.sentAt.toISOString(),
                },
            };
        }),
    });
}));

router.get('/leaks/:leakId', asyncHandler(async (req, res) => {
    ensureIssueDetectionEnabled();
    const leak = await fetchLeakForAccessCheck(req.params.leakId);
    await requireProjectAccess(req.user!.id, getLeakProjectId(leak)!);
    res.json(leak);
}));

router.post('/leaks/:leakId/context', asyncHandler(async (req, res) => {
    ensureIssueDetectionEnabled();
    const leak = await fetchLeakForAccessCheck(req.params.leakId);
    await requireProjectAccess(req.user!.id, getLeakProjectId(leak)!);

    const data = await callIssueDetection<unknown>({
        method: 'POST',
        pathWithQuery: `/v1/leaks/${encodeURIComponent(req.params.leakId)}/context`,
        body: {
            actorUserId: req.user!.id,
        },
    });
    res.json(data);
}));

router.get('/leaks/:leakId/context/raw.md', asyncHandler(async (req, res) => {
    ensureIssueDetectionEnabled();
    const leak = await fetchLeakForAccessCheck(req.params.leakId);
    await requireProjectAccess(req.user!.id, getLeakProjectId(leak)!);

    const response = await callIssueDetection<Response>({
        pathWithQuery: `/v1/leaks/${encodeURIComponent(req.params.leakId)}/context/raw.md`,
        raw: true,
    });
    const markdown = await response.text();
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(markdown);
}));

router.patch('/leaks/:leakId', asyncHandler(async (req, res) => {
    ensureIssueDetectionEnabled();
    const status = req.body?.status;
    if (status !== undefined && (!ALLOWED_LEAK_STATUSES.has(status))) {
        throw ApiError.badRequest('Invalid leak status');
    }

    const leak = await fetchLeakForAccessCheck(req.params.leakId);
    await requireProjectAccess(req.user!.id, getLeakProjectId(leak)!);

    const data = await callIssueDetection<unknown>({
        method: 'PATCH',
        pathWithQuery: `/v1/leaks/${encodeURIComponent(req.params.leakId)}`,
        body: {
            ...req.body,
            actorUserId: req.user!.id,
        },
    });
    res.json(data);
}));

export default router;
