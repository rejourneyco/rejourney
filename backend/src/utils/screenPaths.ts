export type ScreenPathOptions = {
    maxLength?: number;
};

const NOISE_SCREEN_VALUES = new Set(['unknown', 'undefined', 'null', 'none', 'n/a']);

function normalizeScreenName(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (NOISE_SCREEN_VALUES.has(trimmed.toLowerCase())) return null;
    return trimmed;
}

export function normalizeScreenPath(
    screens: Array<string | null | undefined>,
    options: ScreenPathOptions = {}
): string[] {
    const normalized: string[] = [];

    for (const screen of screens) {
        const cleaned = normalizeScreenName(screen);
        if (!cleaned) continue;
        if (normalized.length === 0 || normalized[normalized.length - 1] !== cleaned) {
            normalized.push(cleaned);
        }
        if (options.maxLength && normalized.length >= options.maxLength) {
            break;
        }
    }

    return normalized;
}

export function mergeScreenPaths(
    existing: string[],
    incoming: string[],
    maxLength?: number
): string[] {
    const merged: string[] = [...existing];

    for (const screen of incoming) {
        if (!screen) continue;
        if (merged.length === 0 || merged[merged.length - 1] !== screen) {
            merged.push(screen);
        }
        if (maxLength && merged.length >= maxLength) {
            break;
        }
    }

    return merged;
}

export function getUniqueScreenCount(screens: string[]): number {
    return new Set(screens).size;
}
