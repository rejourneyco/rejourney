import { describe, expect, it, vi } from 'vitest';
import { IssueReadCache } from '../services/issueReadCache.js';

describe('issue read cache', () => {
    it('coalesces concurrent reads and expires measured from completion', async () => {
        let now = 0;
        const cache = new IssueReadCache(10, 2, () => now);
        let finish!: (value: string) => void;
        const load = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
        const first = cache.read('project-a', load);
        const second = cache.read('project-a', load);
        await Promise.resolve();
        now = 100;
        finish('data');
        expect(await Promise.all([first, second])).toEqual(['data', 'data']);
        expect(await cache.read('project-a', load)).toBe('data');
        expect(load).toHaveBeenCalledTimes(1);
        now = 111;
        expect(await cache.read('project-a', async () => 'new')).toBe('new');
    });

    it('separates projects and filters and evicts at its capacity', async () => {
        const cache = new IssueReadCache(10, 2, () => 0);
        await cache.read('project-a?status=ready', async () => 'a');
        await cache.read('project-a?status=queued', async () => 'b');
        await cache.read('project-b?status=ready', async () => 'c');
        expect(await cache.read('project-a?status=ready', async () => 'fresh')).toBe('fresh');
    });

    it('does not retain failures', async () => {
        const cache = new IssueReadCache();
        await expect(cache.read('a', async () => { throw new Error('upstream'); })).rejects.toThrow('upstream');
        expect(await cache.read('a', async () => 'recovered')).toBe('recovered');
    });

    it('does not resurrect an in-flight read after a mutation invalidates it', async () => {
        const cache = new IssueReadCache();
        let finish!: (value: string) => void;
        const old = cache.read('a', () => new Promise<string>((resolve) => { finish = resolve; }));
        await Promise.resolve();
        cache.clear();
        expect(await cache.read('a', async () => 'updated')).toBe('updated');
        finish('old');
        expect(await old).toBe('old');
        expect(await cache.read('a', async () => 'wrong')).toBe('updated');
    });
});
