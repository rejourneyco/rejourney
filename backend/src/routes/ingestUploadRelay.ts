import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, recordingArtifacts, sessions } from '../db/client.js';
import { getObjectSizeBytesForArtifact, uploadStreamToS3ForArtifact } from '../db/s3.js';
import { config } from '../config.js';
import { ApiError, asyncHandler } from '../middleware/index.js';
import { logger } from '../logger.js';
import {
    markArtifactUploadInterrupted,
    markArtifactUploadStored,
} from '../services/ingestArtifactLifecycle.js';
import {
    verifyArtifactUploadRelayTokenResult,
} from '../services/ingestUploadRelay.js';
import { getRedisDiagnosticsForLog } from '../db/redis.js';
import { assertSessionAcceptsNewIngestWork } from '../services/sessionIngestImmutability.js';

const router = Router();

function parseContentLength(value: string | undefined): number | null {
    if (!value) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.floor(parsed);
}

router.put(
    '/artifacts/:artifactId',
    asyncHandler(async (req, res) => {
        const artifactId = req.params.artifactId;
        const token = typeof req.query.token === 'string' ? req.query.token : undefined;
        const tokenResult = verifyArtifactUploadRelayTokenResult(token, artifactId);

        if (!tokenResult.ok) {
            logger.warn(
                {
                    event: 'ingest.relay_auth_failed',
                    artifactId,
                    reason: tokenResult.reason,
                    hasToken: Boolean(token),
                    ...getRedisDiagnosticsForLog(),
                },
                'ingest.relay_auth_failed',
            );
            throw ApiError.forbidden('Invalid or expired upload token');
        }
        const payload = tokenResult.payload;

        const [artifactResult] = await db.select({
            artifact: recordingArtifacts,
            session: sessions,
        })
            .from(recordingArtifacts)
            .innerJoin(sessions, eq(recordingArtifacts.sessionId, sessions.id))
            .where(eq(recordingArtifacts.id, artifactId))
            .limit(1);

        if (!artifactResult) {
            logger.warn(
                {
                    event: 'ingest.relay_artifact_not_found',
                    artifactId,
                    projectIdFromToken: payload.projectId,
                    sessionIdFromToken: payload.sessionId,
                    ...getRedisDiagnosticsForLog(),
                },
                'ingest.relay_artifact_not_found',
            );
            throw ApiError.notFound('Artifact not found');
        }

        const { artifact, session } = artifactResult;
        if (session.projectId !== payload.projectId || session.id !== payload.sessionId) {
            logger.warn(
                {
                    event: 'ingest.relay_token_scope_mismatch',
                    artifactId,
                    sessionProjectId: session.projectId,
                    tokenProjectId: payload.projectId,
                    sessionId: session.id,
                    tokenSessionId: payload.sessionId,
                    ...getRedisDiagnosticsForLog(),
                },
                'ingest.relay_token_scope_mismatch',
            );
            throw ApiError.forbidden('Upload token scope mismatch');
        }

        try {
            assertSessionAcceptsNewIngestWork(session);
        } catch (err) {
            logger.warn(
                {
                    event: 'ingest.relay_rejected_session_immutable',
                    sessionId: session.id,
                    artifactId,
                    projectId: session.projectId,
                },
                'ingest.relay_rejected_session_immutable',
            );
            throw err;
        }

        const contentLength = parseContentLength(req.header('content-length') || undefined);
        if (contentLength && contentLength > config.INGEST_MAX_OBJECT_BYTES) {
            logger.warn(
                {
                    event: 'ingest.relay_payload_too_large',
                    artifactId,
                    contentLength,
                    maxObjectBytes: config.INGEST_MAX_OBJECT_BYTES,
                    ...getRedisDiagnosticsForLog(),
                },
                'ingest.relay_payload_too_large',
            );
            throw ApiError.badRequest('Artifact exceeds ingest max object size');
        }

        const contentType = req.header('content-type') || 'application/octet-stream';
        const log = logger.child({
            route: '/upload/artifacts/:artifactId',
            artifactId,
            sessionId: session.id,
            projectId: session.projectId,
            kind: artifact.kind,
            endpointId: artifact.endpointId ?? null,
            s3ObjectKey: artifact.s3ObjectKey,
        });

        log.info({
            contentLength,
            contentType,
            previousStatus: artifact.status,
        }, 'artifact.upload_received');

        let requestInterrupted = Boolean(req.aborted);
        const markInterrupted = () => {
            requestInterrupted = true;
        };
        req.once('aborted', markInterrupted);
        req.once('error', markInterrupted);
        req.once('close', () => {
            if (!res.writableEnded) {
                requestInterrupted = true;
            }
        });

        const uploadResult = await uploadStreamToS3ForArtifact(
            session.projectId,
            artifact.s3ObjectKey,
            req,
            contentType,
            artifact.endpointId,
            contentLength ?? undefined,
            {
                artifact_id: artifact.id,
                session_id: session.id,
                kind: artifact.kind,
            },
        );

        if (!uploadResult.success) {
            const wasInterrupted = requestInterrupted || uploadResult.errorType === 'aborted';
            log.error(
                {
                    event: 'ingest.relay_s3_upload_failed',
                    wasInterrupted,
                    errorType: uploadResult.errorType,
                    errorMessage: uploadResult.error,
                    contentLength,
                    ...getRedisDiagnosticsForLog(),
                },
                'ingest.relay_s3_upload_failed',
            );
            await markArtifactUploadInterrupted({
                artifactId: artifact.id,
                reason: wasInterrupted ? 'relay_upload_aborted' : 'relay_upload_failed',
                errorMsg: uploadResult.error ?? 'Failed to store artifact upload',
            });

            if (!res.headersSent && !res.writableEnded && !res.destroyed) {
                const statusCode = wasInterrupted ? 499 : 503;
                res.status(statusCode).json({
                    error: wasInterrupted ? 'CLIENT_CLOSED_REQUEST' : 'SERVICE_UNAVAILABLE',
                    message: wasInterrupted
                        ? 'Artifact upload interrupted before storage completed'
                        : 'Failed to store artifact upload',
                });
            }
            return;
        }

        const resolvedSizeBytes = contentLength
            ?? artifact.declaredSizeBytes
            ?? await getObjectSizeBytesForArtifact(
                session.projectId,
                artifact.s3ObjectKey,
                artifact.endpointId,
            );

        await markArtifactUploadStored({
            artifactId: artifact.id,
            sizeBytes: resolvedSizeBytes,
            contentType,
        });

        res.status(204).end();
    })
);

export default router;
