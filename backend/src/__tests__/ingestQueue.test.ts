import { describe, expect, it } from 'vitest';
import { applyPerSessionRunnableLimit, sortArtifactJobsByPriority } from '../services/ingestQueue.js';

describe('ingestQueue', () => {
    it('sorts jobs by configured kind priority before createdAt', () => {
        const jobs = [
            { id: 'job-events-newer', kind: 'events', createdAt: new Date('2026-03-29T12:00:03Z'), sessionId: 's1' },
            { id: 'job-screenshot-older', kind: 'screenshots', createdAt: new Date('2026-03-29T12:00:02Z'), sessionId: 's2' },
            { id: 'job-events-older', kind: 'events', createdAt: new Date('2026-03-29T12:00:01Z'), sessionId: 's3' },
        ] as any[];

        const sorted = sortArtifactJobsByPriority(jobs as any, {
            kindPriority: new Map([
                ['screenshots', 0],
                ['events', 1],
            ]),
        });

        expect(sorted.map((job) => job.id)).toEqual([
            'job-screenshot-older',
            'job-events-older',
            'job-events-newer',
        ]);
    });

    it('enforces the per-session runnable cap while preserving cross-session jobs', () => {
        const jobs = [
            { id: 'job-1', sessionId: 'session-a' },
            { id: 'job-2', sessionId: 'session-a' },
            { id: 'job-3', sessionId: 'session-b' },
            { id: 'job-4', sessionId: 'session-a' },
            { id: 'job-5', sessionId: 'session-c' },
        ] as any[];

        const runnable = applyPerSessionRunnableLimit(jobs as any, 2);

        expect(runnable.map((job) => job.id)).toEqual(['job-1', 'job-2', 'job-3', 'job-5']);
    });
});
