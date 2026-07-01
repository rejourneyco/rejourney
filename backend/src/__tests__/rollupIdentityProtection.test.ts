import { describe, expect, it } from 'vitest';
import { protectUniqueUserCountAfterIdentityScrub } from '../services/rollupIdentityProtection.js';

describe('rollup identity protection', () => {
    it('keeps computed unique users when no scrubbed sessions are present', () => {
        expect(protectUniqueUserCountAfterIdentityScrub({
            computedUniqueUserCount: 7,
            existingUniqueUserCount: 10,
            identityScrubbedSessionCount: 0,
        })).toEqual({
            uniqueUserCount: 7,
            preservedExisting: false,
        });
    });

    it('preserves an existing higher rollup when identity scrub would lower uniqueness', () => {
        expect(protectUniqueUserCountAfterIdentityScrub({
            computedUniqueUserCount: 0,
            existingUniqueUserCount: 42,
            identityScrubbedSessionCount: 100,
        })).toEqual({
            uniqueUserCount: 42,
            preservedExisting: true,
        });
    });

    it('does not inflate a scrubbed-day rollup without an existing higher count', () => {
        expect(protectUniqueUserCountAfterIdentityScrub({
            computedUniqueUserCount: 5,
            existingUniqueUserCount: 3,
            identityScrubbedSessionCount: 10,
        })).toEqual({
            uniqueUserCount: 5,
            preservedExisting: false,
        });
    });
});
