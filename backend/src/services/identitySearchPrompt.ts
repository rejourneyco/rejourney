import { normalizeArchiveSearchQuery } from './sessionArchiveListSort.js';

/** IDs do not need model inference or a scan of available project metadata. */
export function identitySearchFromPrompt(prompt: string): string | null {
    if (prompt.trim().length > 256) return null;
    const value = normalizeArchiveSearchQuery(prompt);
    const explicit = value.match(/^(?:(?:show|find|get|search)(?:\s+(?:me|all|the))?\s+)?(?:(?:sessions|recordings|replays)\s+(?:for|from|of)\s+)?(?:user|device|session)(?:[\s_-]*id)?\s*(?:[:=]\s*|\s+)(.+)$/i);
    if (explicit) {
        const id = normalizeArchiveSearchQuery(explicit[1]);
        // Do not discard other requested conditions by mistaking prose for an ID.
        return id && !/\s/.test(id) ? id : null;
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
        || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        || (/^[\w:|/-]{8,}$/.test(value) && /\d/.test(value))) return value;
    return null;
}
