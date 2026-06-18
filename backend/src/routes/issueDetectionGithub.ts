/**
 * Rejourney → issue-detection GitHub-link proxy (Slice 5). Mirrors the Leaks
 * proxy (sessionAuth + project-access + HMAC-signed upstream calls) and adds the
 * install/setup flow:
 *
 *   GET    /automations/github/link            link status (gates the inbox)
 *   GET    /automations/github/install-url      signed-state install URL
 *   GET    /automations/github/setup/callback   GitHub Setup URL → verify → redirect
 *   GET    /automations/github/installations    installed App candidates + repos
 *   GET    /automations/github/installation/repos  repo + folder picker source
 *   POST   /automations/github/link             bind installation+repo+globs
 *   PATCH  /automations/github/link             update sourceGlobs
 *   DELETE /automations/github/link             unlink
 *
 * Security: the setup callback never trusts the redirect — it verifies the
 * signed+TTL'd state from the query or short-lived cookie fallback, requires
 * `state.userId === the session user`, and checks project access before
 * redirecting the browser to the folder picker. Any failure redirects to the
 * dashboard with `?error=github_link_failed` (never a 500 mid-redirect).
 */

import { Router } from 'express';
import { config } from '../config.js';
import { sessionAuth, asyncHandler, ApiError } from '../middleware/index.js';
import {
    callIssueDetection,
    ensureIssueDetectionEnabled,
    requireProjectAccess,
} from '../services/issueDetectionClient.js';
import { userCanAccessProject } from '../services/projectAccess.js';
import { createSetupState, verifySetupState } from '../services/githubAppState.js';
import { getOAuthStateCookieOptions } from '../utils/cookies.js';

const router = Router();

const STATE_TTL_MS = 10 * 60 * 1000;
const GITHUB_APP_SETUP_STATE_COOKIE = 'github_app_setup_state';

function dashboardBaseUrl(): string {
    return config.PUBLIC_DASHBOARD_URL || 'https://rejourney.co';
}

function requireProjectIdQuery(value: unknown): string {
    const projectId = typeof value === 'string' ? value : '';
    if (!projectId) throw ApiError.badRequest('projectId is required');
    return projectId;
}

router.use(sessionAuth);

router.get(
    '/link',
    asyncHandler(async (req, res) => {
        ensureIssueDetectionEnabled();
        const projectId = requireProjectIdQuery(req.query.projectId);
        await requireProjectAccess(req.user!.id, projectId);
        const data = await callIssueDetection<unknown>({
            pathWithQuery: `/v1/projects/${encodeURIComponent(projectId)}/github/link`,
        });
        res.json(data);
    }),
);

router.get(
    '/install-url',
    asyncHandler(async (req, res) => {
        ensureIssueDetectionEnabled();
        const projectId = requireProjectIdQuery(req.query.projectId);
        await requireProjectAccess(req.user!.id, projectId);
        if (!config.GITHUB_APP_SLUG || !config.GITHUB_APP_STATE_SECRET) {
            throw ApiError.serviceUnavailable('GitHub App is not configured');
        }
        const state = createSetupState({
            projectId,
            userId: req.user!.id,
            secret: config.GITHUB_APP_STATE_SECRET,
        });
        res.cookie(GITHUB_APP_SETUP_STATE_COOKIE, state, getOAuthStateCookieOptions(req));
        const installUrl =
            `https://github.com/apps/${encodeURIComponent(config.GITHUB_APP_SLUG)}` +
            `/installations/new?state=${encodeURIComponent(state)}`;
        res.json({ installUrl });
    }),
);

router.get(
    '/setup/callback',
    asyncHandler(async (req, res) => {
        const failureUrl = `${dashboardBaseUrl()}/dashboard/leaks?error=github_link_failed`;
        try {
            ensureIssueDetectionEnabled();
            if (!config.GITHUB_APP_STATE_SECRET) {
                res.redirect(failureUrl);
                return;
            }
            const queryState =
                typeof req.query.state === 'string' && req.query.state.trim() ? req.query.state : '';
            const cookieState =
                typeof req.cookies?.[GITHUB_APP_SETUP_STATE_COOKIE] === 'string'
                    ? req.cookies[GITHUB_APP_SETUP_STATE_COOKIE]
                    : '';
            const stateRaw = queryState || cookieState;
            const installationId =
                typeof req.query.installation_id === 'string' ? req.query.installation_id : '';
            res.clearCookie(GITHUB_APP_SETUP_STATE_COOKIE, getOAuthStateCookieOptions(req));

            const verified = verifySetupState(stateRaw, config.GITHUB_APP_STATE_SECRET, {
                maxAgeMs: STATE_TTL_MS,
            });
            // All three must hold: valid+unexpired state, the session user IS the
            // user who started the install, and they can access the target project.
            if (!verified.ok || verified.payload.userId !== req.user!.id) {
                res.redirect(failureUrl);
                return;
            }
            const allowed = await userCanAccessProject(req.user!.id, verified.payload.projectId);
            if (!allowed) {
                res.redirect(failureUrl);
                return;
            }

            const successUrl = new URL(
                `/dashboard/settings/${encodeURIComponent(verified.payload.projectId)}/github`,
                dashboardBaseUrl(),
            );
            if (installationId) {
                successUrl.searchParams.set('installation_id', installationId);
            }
            res.redirect(successUrl.toString());
        } catch {
            res.redirect(failureUrl);
        }
    }),
);

router.get(
    '/installations',
    asyncHandler(async (req, res) => {
        ensureIssueDetectionEnabled();
        const projectId = requireProjectIdQuery(req.query.projectId);
        await requireProjectAccess(req.user!.id, projectId);
        const data = await callIssueDetection<unknown>({
            pathWithQuery: `/v1/projects/${encodeURIComponent(projectId)}/github/installations`,
        });
        res.json(data);
    }),
);

router.get(
    '/installation/repos',
    asyncHandler(async (req, res) => {
        ensureIssueDetectionEnabled();
        const projectId = requireProjectIdQuery(req.query.projectId);
        await requireProjectAccess(req.user!.id, projectId);

        const params = new URLSearchParams();
        for (const key of ['installationId', 'withFolders', 'repoId']) {
            const value = req.query[key];
            if (typeof value === 'string' && value.trim()) params.set(key, value);
        }
        const query = params.toString();
        const data = await callIssueDetection<unknown>({
            pathWithQuery:
                `/v1/projects/${encodeURIComponent(projectId)}/github/installation/repos` +
                `${query ? `?${query}` : ''}`,
        });
        res.json(data);
    }),
);

router.post(
    '/link',
    asyncHandler(async (req, res) => {
        ensureIssueDetectionEnabled();
        const projectId = requireProjectIdQuery(req.body?.projectId);
        await requireProjectAccess(req.user!.id, projectId);
        const { installationId, repoId, sourceGlobs } = req.body ?? {};
        const data = await callIssueDetection<unknown>({
            method: 'POST',
            pathWithQuery: `/v1/projects/${encodeURIComponent(projectId)}/github/link`,
            body: {
                installationId,
                repoId,
                ...(sourceGlobs !== undefined ? { sourceGlobs } : {}),
                actorUserId: req.user!.id,
            },
        });
        res.json(data);
    }),
);

router.patch(
    '/link',
    asyncHandler(async (req, res) => {
        ensureIssueDetectionEnabled();
        const projectId = requireProjectIdQuery(req.body?.projectId);
        const sourceGlobs = req.body?.sourceGlobs;
        if (
            !Array.isArray(sourceGlobs) ||
            sourceGlobs.length === 0 ||
            !sourceGlobs.every((g) => typeof g === 'string' && g.length > 0)
        ) {
            throw ApiError.badRequest('sourceGlobs must be a non-empty array of strings');
        }
        await requireProjectAccess(req.user!.id, projectId);
        const data = await callIssueDetection<unknown>({
            method: 'PATCH',
            pathWithQuery: `/v1/projects/${encodeURIComponent(projectId)}/github/link`,
            body: { sourceGlobs, actorUserId: req.user!.id },
        });
        res.json(data);
    }),
);

router.delete(
    '/link',
    asyncHandler(async (req, res) => {
        ensureIssueDetectionEnabled();
        const projectId = requireProjectIdQuery(req.query.projectId);
        await requireProjectAccess(req.user!.id, projectId);
        const data = await callIssueDetection<unknown>({
            method: 'DELETE',
            pathWithQuery: `/v1/projects/${encodeURIComponent(projectId)}/github/link`,
        });
        res.json(data);
    }),
);

export default router;
