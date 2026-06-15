import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
    config: {
        NODE_ENV: 'production',
        PUBLIC_DASHBOARD_URL: 'https://dashboard.example.com',
        DASHBOARD_ORIGIN: '',
        ADDITIONAL_DASHBOARD_ORIGINS: '',
    },
}));

vi.mock('../logger.js', () => ({
    logger: {
        debug: vi.fn(),
    },
}));

import { csrfProtection, originValidation } from '../middleware/csrf.js';

function createRequest(input: {
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
    method?: string;
    path: string;
}): Request {
    return {
        cookies: input.cookies ?? {},
        headers: input.headers ?? {},
        method: input.method ?? 'POST',
        path: input.path,
    } as Request;
}

function createResponse() {
    const res = {
        cookie: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
    };
    return res as unknown as Response & typeof res;
}

describe('CSRF middleware', () => {
    it('skips CSRF for issue-detection metrics batch POSTs', () => {
        const req = createRequest({ path: '/api/internal/issue-detection/metrics:batch' });
        const res = createResponse();
        const next = vi.fn() as unknown as NextFunction;

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });

    it('skips CSRF for issue-detection digest batch POSTs', () => {
        const req = createRequest({ path: '/api/internal/issue-detection/digest:batch' });
        const res = createResponse();
        const next = vi.fn() as unknown as NextFunction;

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });

    it('keeps CSRF protection for normal state-changing API routes', () => {
        const req = createRequest({ path: '/api/projects/project_1' });
        const res = createResponse();
        const next = vi.fn() as unknown as NextFunction;

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Forbidden',
            message: 'Invalid CSRF token',
        });
    });

    it('skips origin validation for issue-detection internal POSTs', () => {
        const req = createRequest({
            headers: { origin: 'https://not-dashboard.example.com' },
            path: '/api/internal/issue-detection/metrics:batch',
        });
        const res = createResponse();
        const next = vi.fn() as unknown as NextFunction;

        originValidation(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });

    it('keeps origin validation for normal state-changing API routes', () => {
        const req = createRequest({
            headers: { origin: 'https://evil.invalid' },
            path: '/api/projects/project_1',
        });
        const res = createResponse();
        const next = vi.fn() as unknown as NextFunction;

        originValidation(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Forbidden',
            message: 'Invalid origin',
        });
    });
});
