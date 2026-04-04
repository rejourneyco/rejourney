/**
 * Shared request context for ingest / session / upload-relay troubleshooting.
 */

import type { Request } from 'express';
import { getRedisDiagnosticsForLog } from '../db/redis.js';

const PREFIXES = ['/api/ingest', '/api/sessions', '/upload'] as const;

export function isIngestOrSessionRelatedPath(path: string): boolean {
    return PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

export function buildIngestSessionRequestContext(req: Request): Record<string, unknown> {
    const proj = (req as { project?: { id?: string; teamId?: string } }).project;
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const sessionFromParams = typeof req.params?.sessionId === 'string' ? req.params.sessionId : undefined;
    const sessionFromBody = typeof body.sessionId === 'string' ? body.sessionId : undefined;
    return {
        logDomain: 'ingest_session',
        path: req.path,
        method: req.method,
        projectId: proj?.id,
        teamId: proj?.teamId,
        sessionId: sessionFromParams ?? sessionFromBody,
        artifactId: typeof req.params?.artifactId === 'string' ? req.params.artifactId : undefined,
        ...getRedisDiagnosticsForLog(),
    };
}
