import { describe, expect, it } from 'vitest';

import {
    configuredSecretMatches,
    constantTimeEqualSha256Hex,
    constantTimeEqualStrings,
} from '../utils/secureCompare.js';

describe('secure comparison helpers', () => {
    it('compares opaque strings without requiring equal input lengths', () => {
        expect(constantTimeEqualStrings('token-value', 'token-value')).toBe(true);
        expect(constantTimeEqualStrings('token-value', 'token-valuf')).toBe(false);
        expect(constantTimeEqualStrings('short', 'a-much-longer-value')).toBe(false);
    });

    it('fails closed for absent or empty secrets', () => {
        expect(constantTimeEqualStrings('', '')).toBe(false);
        expect(constantTimeEqualStrings(undefined, undefined)).toBe(false);
        expect(constantTimeEqualStrings('token', undefined)).toBe(false);
    });

    it('requires a configured operational secret of the minimum strength', () => {
        const configured = 'a'.repeat(32);
        expect(configuredSecretMatches(configured, configured)).toBe(true);
        expect(configuredSecretMatches(undefined, undefined)).toBe(false);
        expect(configuredSecretMatches('short', 'short')).toBe(false);
        expect(configuredSecretMatches(configured, 'b'.repeat(32))).toBe(false);
    });

    it('strictly decodes and compares SHA-256 hex digests', () => {
        const digest = 'a'.repeat(64);
        expect(constantTimeEqualSha256Hex(digest, digest)).toBe(true);
        expect(constantTimeEqualSha256Hex(digest, 'b'.repeat(64))).toBe(false);
        expect(constantTimeEqualSha256Hex(digest, 'a'.repeat(63))).toBe(false);
        expect(constantTimeEqualSha256Hex(digest, 'not-hex'.padEnd(64, 'x'))).toBe(false);
    });
});
