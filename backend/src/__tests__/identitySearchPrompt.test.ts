import { describe, expect, it } from 'vitest';
import { identitySearchFromPrompt } from '../services/identitySearchPrompt.js';
describe('deterministic identity queries', () => {
    it.each([
        ['user ID: 42', '42'], ['show recordings for user abc', 'abc'],
        ['Find all sessions for user ID user_123', 'user_123'],
        ['user_id = "user_123"', 'user_123'],
        [' "9f73c1e0-5b6a-4f22-9c1e-54f6c8d7b0aa" ', '9f73c1e0-5b6a-4f22-9c1e-54f6c8d7b0aa'],
        ['person@example.com', 'person@example.com'], ['user_123456', 'user_123456'],
    ])('resolves %s without inference', (prompt, id) => expect(identitySearchFromPrompt(prompt)).toBe(id));
    it.each(['users with crashes', 'user abc with crashes', 'show iOS crashes today', 'last 7 days'])('preserves richer filters: %s', prompt => expect(identitySearchFromPrompt(prompt)).toBeNull());
});
