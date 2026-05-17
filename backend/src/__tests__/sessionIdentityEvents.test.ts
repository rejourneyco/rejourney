import { describe, expect, it } from 'vitest';
import { extractSessionIdentityChange } from '../services/sessionIdentityEvents.js';

describe('session identity events', () => {
    it('extracts real user identity from top-level events', () => {
        expect(extractSessionIdentityChange({ userId: ' user_123 ' })).toEqual({
            type: 'user',
            userDisplayId: 'user_123',
        });
    });

    it('extracts numeric user ids used by plain JavaScript apps', () => {
        expect(extractSessionIdentityChange({ properties: { userId: 42 } })).toEqual({
            type: 'user',
            userDisplayId: '42',
        });
    });

    it('treats explicit null, empty, and anonymous values as identity clears', () => {
        expect(extractSessionIdentityChange({ userId: null })).toEqual({ type: 'clear' });
        expect(extractSessionIdentityChange({ properties: { userId: '   ' } })).toEqual({ type: 'clear' });
        expect(extractSessionIdentityChange({ payload: { userId: 'anonymous' } })).toEqual({ type: 'clear' });
    });

    it('keeps anonymous identity separate from real user identity', () => {
        expect(extractSessionIdentityChange({ details: { userId: 'anon_fixture' } })).toEqual({
            type: 'anonymous',
            anonymousDisplayId: 'anon_fixture',
        });
    });
});
