export type SessionIdentityChange =
    | { type: 'missing' }
    | { type: 'clear' }
    | { type: 'anonymous'; anonymousDisplayId: string }
    | { type: 'user'; userDisplayId: string };

const MAX_USER_ID_LENGTH = 512;

function hasOwnUserId(value: unknown): value is { userId: unknown } {
    return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'userId'));
}

function normalizeIdentityValue(value: unknown): SessionIdentityChange {
    if (value === null || value === undefined) return { type: 'clear' };

    const raw = typeof value === 'number' && Number.isFinite(value)
        ? String(value)
        : typeof value === 'string'
            ? value
            : null;
    if (raw === null) return { type: 'missing' };

    const normalized = raw.trim().slice(0, MAX_USER_ID_LENGTH);
    if (!normalized || normalized === 'anonymous') return { type: 'clear' };
    if (normalized.startsWith('anon_')) return { type: 'anonymous', anonymousDisplayId: normalized };
    return { type: 'user', userDisplayId: normalized };
}

export function extractSessionIdentityChange(event: any): SessionIdentityChange {
    if (!event || typeof event !== 'object') return { type: 'missing' };

    if (hasOwnUserId(event)) return normalizeIdentityValue(event.userId);
    if (hasOwnUserId(event.details)) return normalizeIdentityValue(event.details.userId);
    if (hasOwnUserId(event.properties)) return normalizeIdentityValue(event.properties.userId);
    if (event.payload && typeof event.payload === 'object' && hasOwnUserId(event.payload)) {
        return normalizeIdentityValue(event.payload.userId);
    }

    return { type: 'missing' };
}
