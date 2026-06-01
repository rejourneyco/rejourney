import { describe, expect, it } from 'vitest';
import {
    INGEST_ARTIFACT_WORKER,
    REPLAY_ARTIFACT_WORKER,
    SESSION_LIFECYCLE_WORKER,
    resolveArtifactJobProcessConcurrency,
} from '../worker/workerDefinitions.js';

describe('workerDefinitions', () => {
    it('keeps ingest and replay as artifact-only workers', () => {
        expect(INGEST_ARTIFACT_WORKER.mode).toBe('artifact');
        expect(INGEST_ARTIFACT_WORKER.allowedKinds).toEqual(['events', 'crashes', 'anrs']);
        expect(INGEST_ARTIFACT_WORKER.ownedResponsibilities).not.toContain('session-reconciliation');

        expect(REPLAY_ARTIFACT_WORKER.mode).toBe('artifact');
        expect(REPLAY_ARTIFACT_WORKER.allowedKinds).toEqual(['screenshots', 'hierarchy', 'rrweb']);
        expect(REPLAY_ARTIFACT_WORKER.ownedResponsibilities).not.toContain('session-reconciliation');
    });

    it('keeps lifecycle ownership out of artifact workers', () => {
        expect(SESSION_LIFECYCLE_WORKER.mode).toBe('lifecycle');
        expect(SESSION_LIFECYCLE_WORKER.workerName).toBe('sessionLifecycleWorker');
        expect(SESSION_LIFECYCLE_WORKER.ownedResponsibilities).toContain('session-reconciliation');
        expect('allowedKinds' in SESSION_LIFECYCLE_WORKER).toBe(false);
    });

    it('uses ingest env concurrency with an 8-job fallback', () => {
        expect(INGEST_ARTIFACT_WORKER.defaultJobProcessConcurrency).toBe(8);
        expect(resolveArtifactJobProcessConcurrency(INGEST_ARTIFACT_WORKER, undefined)).toBe(8);
        expect(resolveArtifactJobProcessConcurrency(INGEST_ARTIFACT_WORKER, '8')).toBe(8);
        expect(resolveArtifactJobProcessConcurrency(INGEST_ARTIFACT_WORKER, '12')).toBe(12);
        expect(resolveArtifactJobProcessConcurrency(INGEST_ARTIFACT_WORKER, 'bad')).toBe(8);
        expect(resolveArtifactJobProcessConcurrency(INGEST_ARTIFACT_WORKER, '0')).toBe(8);
    });

    it('does not let the ingest env override replay worker concurrency', () => {
        expect(resolveArtifactJobProcessConcurrency(REPLAY_ARTIFACT_WORKER, '12')).toBe(8);
    });
});
