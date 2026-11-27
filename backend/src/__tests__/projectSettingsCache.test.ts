import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    rows: new Map<string, any>(),
    queries: [] as string[],
    gate: null as null | Promise<void>,
    failNext: false,
}));

vi.mock('drizzle-orm', () => ({
    eq: (_column: unknown, value: unknown) => ({ projectId: value }),
}));

vi.mock('../db/client.js', () => ({
    db: {
        select: () => ({
            from: () => ({
                where: (condition: { projectId: string }) => ({
                    limit: async () => {
                        state.queries.push(condition.projectId);
                        if (state.gate) await state.gate;
                        if (state.failNext) {
                            state.failNext = false;
                            throw new Error('connection reset');
                        }
                        const row = state.rows.get(condition.projectId);
                        return row ? [{ ...row }] : [];
                    },
                }),
            }),
        }),
    },
    projects: {
        id: 'projects.id',
        teamId: 'projects.team_id',
        maxRecordingMinutes: 'projects.max_recording_minutes',
        webMaxObservabilityMinutes: 'projects.web_max_observability_minutes',
        smartCaptureEnabled: 'projects.smart_capture_enabled',
        smartCaptureMode: 'projects.smart_capture_mode',
        smartCapturePreset: 'projects.smart_capture_preset',
        smartCaptureRules: 'projects.smart_capture_rules',
        smartCaptureDecisionWindowHours: 'projects.smart_capture_decision_window_hours',
        sampleRate: 'projects.sample_rate',
    },
}));

import {
    PROJECT_SETTINGS_CACHE_MAX_ENTRIES,
    PROJECT_SETTINGS_CACHE_TTL_MS,
    clearProjectSettingsCache,
    getCachedProjectSettings,
    invalidateProjectSettingsCache,
    projectSettingsCacheSize,
} from '../services/projectSettingsCache.js';

const project = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    teamId: 'team-1',
    maxRecordingMinutes: 10,
    webMaxObservabilityMinutes: 30,
    smartCaptureEnabled: false,
    smartCaptureMode: 'record_all',
    smartCapturePreset: 'none',
    smartCaptureRules: [],
    smartCaptureDecisionWindowHours: 168,
    sampleRate: 100,
    ...overrides,
});

describe('project settings cache', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-27T12:00:00.000Z'));
        clearProjectSettingsCache();
        state.rows.clear();
        state.queries.length = 0;
        state.gate = null;
        state.failNext = false;
        state.rows.set('project-1', project('project-1'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('is a small, short-lived cache', () => {
        expect(PROJECT_SETTINGS_CACHE_TTL_MS).toBe(60_000);
        expect(PROJECT_SETTINGS_CACHE_MAX_ENTRIES).toBe(2_000);
    });

    it('queries once and then serves repeat lookups from memory', async () => {
        const first = await getCachedProjectSettings('project-1');
        for (let index = 0; index < 50; index += 1) {
            expect(await getCachedProjectSettings('project-1')).toBe(first);
        }

        expect(first).toEqual(project('project-1'));
        expect(state.queries).toEqual(['project-1']);
    });

    it('picks up another process\'s change once the TTL has passed', async () => {
        await getCachedProjectSettings('project-1');
        state.rows.set('project-1', project('project-1', { maxRecordingMinutes: 3, smartCaptureEnabled: true }));

        vi.advanceTimersByTime(PROJECT_SETTINGS_CACHE_TTL_MS - 1);
        expect((await getCachedProjectSettings('project-1'))?.maxRecordingMinutes).toBe(10);
        expect(state.queries).toHaveLength(1);

        vi.advanceTimersByTime(1);
        const refreshed = await getCachedProjectSettings('project-1');
        expect(refreshed).toMatchObject({ maxRecordingMinutes: 3, smartCaptureEnabled: true });
        expect(state.queries).toHaveLength(2);
    });

    it('serves a same-process change immediately after explicit invalidation', async () => {
        await getCachedProjectSettings('project-1');
        state.rows.set('project-1', project('project-1', { webMaxObservabilityMinutes: 5 }));

        invalidateProjectSettingsCache('project-1');

        expect((await getCachedProjectSettings('project-1'))?.webMaxObservabilityMinutes).toBe(5);
        expect(state.queries).toHaveLength(2);
    });

    it('only invalidates the named project', async () => {
        state.rows.set('project-2', project('project-2'));
        await getCachedProjectSettings('project-1');
        await getCachedProjectSettings('project-2');

        invalidateProjectSettingsCache('project-1');
        await getCachedProjectSettings('project-2');
        await getCachedProjectSettings('project-1');

        expect(state.queries).toEqual(['project-1', 'project-2', 'project-1']);
    });

    it('does not cache a row whose lookup straddled an invalidation', async () => {
        let release!: () => void;
        state.gate = new Promise<void>((resolve) => { release = resolve; });

        const pending = getCachedProjectSettings('project-1');
        // Settings change and invalidate while the first lookup is still in flight.
        invalidateProjectSettingsCache('project-1');
        release();
        state.gate = null;
        await pending;

        expect(projectSettingsCacheSize()).toBe(0);
        await getCachedProjectSettings('project-1');
        expect(state.queries).toHaveLength(2);
        expect(projectSettingsCacheSize()).toBe(1);
    });

    it('shares one query between concurrent misses', async () => {
        const results = await Promise.all(Array.from({ length: 20 }, () => getCachedProjectSettings('project-1')));

        expect(state.queries).toEqual(['project-1']);
        expect(new Set(results).size).toBe(1);
    });

    it('never caches a missing project or a failed lookup', async () => {
        expect(await getCachedProjectSettings('project-missing')).toBeNull();
        expect(await getCachedProjectSettings('project-missing')).toBeNull();
        expect(state.queries).toEqual(['project-missing', 'project-missing']);
        expect(projectSettingsCacheSize()).toBe(0);

        state.failNext = true;
        await expect(getCachedProjectSettings('project-1')).rejects.toThrow('connection reset');
        expect((await getCachedProjectSettings('project-1'))?.id).toBe('project-1');
        expect(state.queries).toHaveLength(4);
    });

    it('holds at most PROJECT_SETTINGS_CACHE_MAX_ENTRIES projects, evicting the oldest', async () => {
        for (let index = 0; index <= PROJECT_SETTINGS_CACHE_MAX_ENTRIES; index += 1) {
            state.rows.set(`p-${index}`, project(`p-${index}`));
            await getCachedProjectSettings(`p-${index}`);
        }

        expect(projectSettingsCacheSize()).toBe(PROJECT_SETTINGS_CACHE_MAX_ENTRIES);
        state.queries.length = 0;

        // The newest entry is still cached; the first one was evicted and is re-read.
        await getCachedProjectSettings(`p-${PROJECT_SETTINGS_CACHE_MAX_ENTRIES}`);
        expect(state.queries).toEqual([]);
        await getCachedProjectSettings('p-0');
        expect(state.queries).toEqual(['p-0']);
        expect(projectSettingsCacheSize()).toBe(PROJECT_SETTINGS_CACHE_MAX_ENTRIES);
    });
});
