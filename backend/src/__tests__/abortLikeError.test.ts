import { describe, expect, it } from 'vitest';
import { isAbortLikeError } from '../utils/abortLikeError.js';

describe('isAbortLikeError', () => {
    it('classifies connection reset aborts as abort-like', () => {
        const err = new Error('aborted') as Error & { code?: string };
        err.code = 'ECONNRESET';

        expect(isAbortLikeError(err)).toBe(true);
    });

    it('classifies premature close errors as abort-like', () => {
        expect(isAbortLikeError(new Error('stream ended with premature close'))).toBe(true);
    });

    it('does not classify unrelated failures as abort-like', () => {
        expect(isAbortLikeError(new Error('permission denied'))).toBe(false);
    });
});
