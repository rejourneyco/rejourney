/**
 * CSRF Protection Middleware
 */

import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getCsrfCookieOptions } from '../utils/cookies.js';
import { getBaseDomain } from '../utils/domain.js';

const CSRF_COOKIE = 'csrf';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_TOKEN_LENGTH = 32;

// Methods that require CSRF protection
const PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Paths that skip CSRF (API key auth, ingest, webhooks, SDK attestation, device auth, login flows)
const SKIP_CSRF_PATHS = ['/api/ingest', '/api/webhooks', '/api/attest', '/api/sdk', '/api/devices', '/api/auth/otp', '/health'];

/**
 * Generate CSRF token
 */
function generateToken(): string {
    return randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/**
 * CSRF protection middleware
 * 
 * Sets a CSRF token cookie and validates the token header on state-changing requests
 */
export function csrfProtection(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    // Skip CSRF for certain paths
    if (SKIP_CSRF_PATHS.some((path) => req.path.startsWith(path))) {
        next();
        return;
    }

    // Skip CSRF for SDK requests (identified by project key header)
    if (req.headers['x-rejourney-key'] || req.headers['x-api-key']) {
        next();
        return;
    }

    // For GET/HEAD/OPTIONS, just ensure a CSRF token is set
    if (!PROTECTED_METHODS.has(req.method)) {
        if (!req.cookies?.[CSRF_COOKIE]) {
            const token = generateToken();
            res.cookie(CSRF_COOKIE, token, getCsrfCookieOptions(req));
        }
        next();
        return;
    }

    // For state-changing methods, verify the CSRF token
    const cookieToken = req.cookies?.[CSRF_COOKIE];
    const headerToken = req.headers[CSRF_HEADER] as string;

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        // Only log minimal info in development (never log actual tokens in production)
        if (config.NODE_ENV === 'development') {
            logger.debug({ path: req.path, method: req.method }, 'CSRF check failed');
        }

        res.status(403).json({
            error: 'Forbidden',
            message: 'Invalid CSRF token',
        });
        return;
    }

    next();
}

/**
 * Origin/Referer validation middleware
 */
export function originValidation(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    // Skip for non-state-changing methods
    if (!PROTECTED_METHODS.has(req.method)) {
        next();
        return;
    }

    // Skip for SDK requests (identified by project key header)
    if (req.headers['x-rejourney-key'] || req.headers['x-api-key']) {
        next();
        return;
    }

    // Skip for allowed paths
    if (SKIP_CSRF_PATHS.some((path) => req.path.startsWith(path))) {
        next();
        return;
    }

    const origin = req.headers.origin;
    const referer = req.headers.referer;

    // In production, validate origin against allowed origins
    if (config.NODE_ENV === 'production') {
        const dashboardUrl = config.PUBLIC_DASHBOARD_URL;

        if (dashboardUrl) {
            const allowedUrl = new URL(dashboardUrl);
            const allowedOrigin = allowedUrl.origin;
            const allowedBaseDomain = getBaseDomain(allowedUrl.hostname);

            // Also allow localhost for local docker development
            const isLocalhostOrigin = origin === 'http://localhost:8080' || origin === 'http://127.0.0.1:8080';

            if (origin) {
                try {
                    const originUrl = new URL(origin);
                    const originBaseDomain = getBaseDomain(originUrl.hostname);

                    if (origin !== allowedOrigin && !isLocalhostOrigin && originBaseDomain !== allowedBaseDomain) {
                        res.status(403).json({
                            error: 'Forbidden',
                            message: 'Invalid origin',
                        });
                        return;
                    }
                } catch (e) {
                    // Invalid URL in origin header
                    res.status(403).json({
                        error: 'Forbidden',
                        message: 'Invalid origin format',
                    });
                    return;
                }
            }

            if (!origin && referer) {
                try {
                    const refererUrl = new URL(referer);
                    const refererOrigin = refererUrl.origin;
                    const refererBaseDomain = getBaseDomain(refererUrl.hostname);

                    const isLocalhostReferer = refererOrigin === 'http://localhost:8080' || refererOrigin === 'http://127.0.0.1:8080';

                    if (refererOrigin !== allowedOrigin && !isLocalhostReferer && refererBaseDomain !== allowedBaseDomain) {
                        res.status(403).json({
                            error: 'Forbidden',
                            message: 'Invalid referer',
                        });
                        return;
                    }
                } catch (e) {
                    // Invalid URL in referer header
                }
            }
        }
    }

    next();
}
