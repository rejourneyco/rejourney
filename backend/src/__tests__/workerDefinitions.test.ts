import { describe, expect, it } from 'vitest';
import {
    INGEST_ARTIFACT_WORKER,
    REPLAY_ARTIFACT_WORKER,
    SESSION_LIFECYCLE_WORKER,
} from '../worker/workerDefinitions.js';

describe('workerDefinitions', () => {
    it('keeps ingest and replay as artifact-only workers', () => {
        expect(INGEST_ARTIFACT_WORKER.mode).toBe('artifact');
        expect(INGEST_ARTIFACT_WORKER.allowedKinds).toEqual(['events', 'crashes', 'anrs']);
        expect(INGEST_ARTIFACT_WORKER.ownedResponsibilities).not.toContain('session-reconciliation');

        expect(REPLAY_ARTIFACT_WORKER.mode).toBe('artifact');
        expect(REPLAY_ARTIFACT_WORKER.allowedKinds).toEqual(['screenshots', 'hierarchy']);
        expect(REPLAY_ARTIFACT_WORKER.ownedResponsibilities).not.toContain('session-reconciliation');
    });

    it('keeps lifecycle ownership out of artifact workers', () => {
        expect(SESSION_LIFECYCLE_WORKER.mode).toBe('lifecycle');
        expect(SESSION_LIFECYCLE_WORKER.workerName).toBe('sessionLifecycleWorker');
        expect(SESSION_LIFECYCLE_WORKER.ownedResponsibilities).toContain('session-reconciliation');
        expect('allowedKinds' in SESSION_LIFECYCLE_WORKER).toBe(false);
    });
});
