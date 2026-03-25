import { describe, expect, it } from 'vitest';
import {
    buildArtifactUploadRelayUrl,
    verifyArtifactUploadRelayToken,
} from '../services/ingestUploadRelay.js';

describe('ingestUploadRelay', () => {
    it('builds a relay URL with a verifiable artifact token', () => {
        const url = buildArtifactUploadRelayUrl({
            artifactId: 'artifact_123',
            projectId: 'project_123',
            sessionId: 'session_123',
            kind: 'screenshots',
        });

        const parsed = new URL(url);
        const token = parsed.searchParams.get('token') || undefined;
        const payload = verifyArtifactUploadRelayToken(token, 'artifact_123');

        expect(parsed.pathname).toBe('/upload/artifacts/artifact_123');
        expect(payload).toMatchObject({
            artifactId: 'artifact_123',
            projectId: 'project_123',
            sessionId: 'session_123',
            kind: 'screenshots',
        });
    });

    it('rejects a token for the wrong artifact id', () => {
        const url = buildArtifactUploadRelayUrl({
            artifactId: 'artifact_abc',
            projectId: 'project_123',
            sessionId: 'session_123',
            kind: 'events',
        });

        const parsed = new URL(url);
        const token = parsed.searchParams.get('token') || undefined;

        expect(verifyArtifactUploadRelayToken(token, 'artifact_xyz')).toBeNull();
    });
});
