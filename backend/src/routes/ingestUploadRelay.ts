import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, recordingArtifacts, sessions } from '../db/client.js';
import { getObjectSizeBytesForArtifact, uploadStreamToS3ForArtifact } from '../db/s3.js';
import { config } from '../config.js';
import { ApiError, asyncHandler } from '../middleware/index.js';
import { logger } from '../logger.js';
import { markArtifactUploadStored } from '../services/ingestArtifactLifecycle.js';
import { verifyArtifactUploadRelayToken } from '../services/ingestUploadRelay.js';

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
        const payload = verifyArtifactUploadRelayToken(token, artifactId);

        if (!payload) {
            throw ApiError.forbidden('Invalid or expired upload token');
        }

        const [artifactResult] = await db.select({
            artifact: recordingArtifacts,
            session: sessions,
        })
            .from(recordingArtifacts)
            .innerJoin(sessions, eq(recordingArtifacts.sessionId, sessions.id))
            .where(eq(recordingArtifacts.id, artifactId))
            .limit(1);

        if (!artifactResult) {
            throw ApiError.notFound('Artifact not found');
        }

        const { artifact, session } = artifactResult;
        if (session.projectId !== payload.projectId || session.id !== payload.sessionId) {
            throw ApiError.forbidden('Upload token scope mismatch');
        }

        const contentLength = parseContentLength(req.header('content-length') || undefined);
        if (contentLength && contentLength > config.INGEST_MAX_OBJECT_BYTES) {
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
            throw ApiError.serviceUnavailable('Failed to store artifact upload');
        }

        const resolvedSizeBytes = contentLength ?? await getObjectSizeBytesForArtifact(
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
