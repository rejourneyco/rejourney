import { eq } from 'drizzle-orm';
import { db, projects } from '../db/client.js';
import { setBoundedMapEntry } from '../utils/boundedMap.js';

/**
 * Small in-process cache of the per-project settings row read on the ingest
 * write path (every session reconcile and every /session/end).
 *
 * The projects table is tiny, so Postgres answers each lookup with a sequential
 * scan; at one lookup per reconcile that scan ran hundreds of millions of times.
 *
 * Freshness: a process that changes project settings invalidates its own entry
 * (invalidateProjectSettingsCache). Other processes (workers, other API pods)
 * pick the change up when their entry expires, at most
 * PROJECT_SETTINGS_CACHE_TTL_MS later.
 */
export const PROJECT_SETTINGS_CACHE_TTL_MS = 60_000;
export const PROJECT_SETTINGS_CACHE_MAX_ENTRIES = 2_000;

const projectSettingsSelection = {
    id: projects.id,
    teamId: projects.teamId,
    maxRecordingMinutes: projects.maxRecordingMinutes,
    webMaxObservabilityMinutes: projects.webMaxObservabilityMinutes,
    smartCaptureEnabled: projects.smartCaptureEnabled,
    smartCaptureMode: projects.smartCaptureMode,
    smartCapturePreset: projects.smartCapturePreset,
    smartCaptureRules: projects.smartCaptureRules,
    smartCaptureDecisionWindowHours: projects.smartCaptureDecisionWindowHours,
    sampleRate: projects.sampleRate,
};

export type CachedProjectSettings = Pick<
    typeof projects.$inferSelect,
    | 'id'
    | 'teamId'
    | 'maxRecordingMinutes'
    | 'webMaxObservabilityMinutes'
    | 'smartCaptureEnabled'
    | 'smartCaptureMode'
    | 'smartCapturePreset'
    | 'smartCaptureRules'
    | 'smartCaptureDecisionWindowHours'
    | 'sampleRate'
>;

type CacheEntry = { value: CachedProjectSettings; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CachedProjectSettings | null>>();
// Bumped by every invalidation so a lookup that started before a settings
// change cannot store its (possibly pre-change) row afterwards.
let invalidationEpoch = 0;

async function loadProjectSettings(projectId: string): Promise<CachedProjectSettings | null> {
    const epochAtStart = invalidationEpoch;
    const [row] = await db
        .select(projectSettingsSelection)
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    // A missing project is never cached, and neither is a row read across an invalidation.
    if (row && epochAtStart === invalidationEpoch) {
        setBoundedMapEntry(
            cache,
            projectId,
            { value: row, expiresAt: Date.now() + PROJECT_SETTINGS_CACHE_TTL_MS },
            PROJECT_SETTINGS_CACHE_MAX_ENTRIES,
        );
    }
    return row ?? null;
}

/**
 * Settings row for a project, at most PROJECT_SETTINGS_CACHE_TTL_MS old.
 * Returns null when the project does not exist. Callers must treat the returned
 * object as read-only: it is shared between callers until it expires.
 */
export async function getCachedProjectSettings(projectId: string): Promise<CachedProjectSettings | null> {
    const cached = cache.get(projectId);
    if (cached) {
        if (cached.expiresAt > Date.now()) return cached.value;
        cache.delete(projectId);
    }

    // Concurrent misses for one project share a single query.
    const pending = inFlight.get(projectId);
    if (pending) return pending;

    const load = loadProjectSettings(projectId).finally(() => {
        if (inFlight.get(projectId) === load) inFlight.delete(projectId);
    });
    inFlight.set(projectId, load);
    return load;
}

/** Drop a project's entry. Call after this process changes or deletes the project. */
export function invalidateProjectSettingsCache(projectId: string): void {
    invalidationEpoch += 1;
    cache.delete(projectId);
    inFlight.delete(projectId);
}

/** Test hook: forget everything. */
export function clearProjectSettingsCache(): void {
    invalidationEpoch += 1;
    cache.clear();
    inFlight.clear();
}

/** Test hook: number of cached projects. */
export function projectSettingsCacheSize(): number {
    return cache.size;
}
