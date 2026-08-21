import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compare opaque tokens without leaking a useful prefix or length timing signal.
 * Empty or non-string values are never valid secrets.
 */
export function constantTimeEqualStrings(left: unknown, right: unknown): boolean {
    if (typeof left !== 'string' || typeof right !== 'string' || left.length === 0 || right.length === 0) {
        return false;
    }

    const leftDigest = createHash('sha256').update(left, 'utf8').digest();
    const rightDigest = createHash('sha256').update(right, 'utf8').digest();
    return timingSafeEqual(leftDigest, rightDigest);
}

/** Fail closed when an optional operational secret is absent or implausibly weak. */
export function configuredSecretMatches(
    provided: unknown,
    configured: unknown,
    minimumLength = 32,
): boolean {
    if (typeof configured !== 'string' || configured.length < minimumLength) {
        return false;
    }
    return constantTimeEqualStrings(provided, configured);
}

/** Compare two SHA-256/HMAC-SHA256 hex digests after strict decoding. */
export function constantTimeEqualSha256Hex(left: unknown, right: unknown): boolean {
    if (
        typeof left !== 'string'
        || typeof right !== 'string'
        || !/^[0-9a-f]{64}$/i.test(left)
        || !/^[0-9a-f]{64}$/i.test(right)
    ) {
        return false;
    }

    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
