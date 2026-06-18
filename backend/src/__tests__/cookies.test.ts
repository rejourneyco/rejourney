import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
    config: {
        NODE_ENV: 'development',
    },
}));

import { getCsrfCookieOptions, isLocalhostRequest } from '../utils/cookies.js';

function createRequest(input: { hostname?: string; headers?: Record<string, string> }): Request {
    return {
        hostname: input.hostname,
        headers: input.headers ?? {},
    } as Request;
}

describe('cookie utilities', () => {
    it('treats private LAN hosts as local in development', () => {
        const req = createRequest({
            hostname: '192.168.10.232',
            headers: { host: '192.168.10.232:3000' },
        });

        expect(isLocalhostRequest(req)).toBe(true);
        expect(getCsrfCookieOptions(req)).toMatchObject({
            domain: undefined,
            secure: false,
        });
    });
});
