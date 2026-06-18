/**
 * Cookie Utilities
 * 
 * Centralized cookie configuration for consistent security settings.
 * Handles localhost detection for local development behind Docker proxies.
 */

import { Request, CookieOptions } from 'express';
import { config } from '../config.js';
import { getBaseDomain } from './domain.js';

function normalizeHost(host: string | undefined): string {
    const value = (host ?? '').split(',')[0].trim();
    if (value.startsWith('[')) {
        const end = value.indexOf(']');
        return end > 0 ? value.slice(1, end) : value.slice(1);
    }
    if (value === '::1') {
        return value;
    }
    return value.split(':')[0];
}

function isLoopbackHost(host: string): boolean {
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isPrivateNetworkHost(host: string): boolean {
    return /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.)/.test(host);
}

/**
 * Detect if the request is coming from localhost/local development.
 * Checks multiple headers to handle proxy scenarios (Docker, nginx, etc.)
 * 
 * SECURITY: In production with HTTPS, always use Secure cookies.
 * This only disables Secure for true localhost development over HTTP.
 */
export function isLocalhostRequest(req: Request): boolean {
    const hostname = normalizeHost(req.hostname);
    const forwardedHost = normalizeHost(req.headers['x-forwarded-host'] as string | undefined);
    const hostHeader = normalizeHost(req.headers['host'] as string | undefined);
    const candidateHosts = [hostname, forwardedHost, hostHeader].filter(Boolean);

    if (candidateHosts.some(isLoopbackHost)) {
        return true;
    }

    // Hybrid local development often proxies localhost dashboard requests to
    // the backend's LAN IP. Treat those private hosts as local in development
    // so Express emits host-only cookies instead of an invalid IP domain.
    if (config.NODE_ENV !== 'production' && candidateHosts.some(isPrivateNetworkHost)) {
        return true;
    }

    // Check X-Forwarded-Proto - if not HTTPS, likely local dev
    const proto = req.headers['x-forwarded-proto'] as string | undefined;
    if (proto === 'http' && hostname !== '') {
        // HTTP request - could be local. Check if it's a private IP
        if (isPrivateNetworkHost(hostname)) {
            return true;
        }
    }

    return false;
}

/**
 * Determine if cookies should use the Secure flag.
 * 
 * Rules:
 * - Always use Secure in production UNLESS explicitly localhost
 * - In development, never use Secure (cookies work over HTTP)
 */
export function shouldUseSecureCookies(req: Request): boolean {
    // Development mode: never use Secure (allows HTTP cookies)
    if (config.NODE_ENV !== 'production') {
        return false;
    }

    // Production mode: use Secure UNLESS it's localhost
    return !isLocalhostRequest(req);
}

/**
 * Get the cookie domain.
 * Returns the base domain (e.g., .rejourney.co) for production.
 * Returns undefined for localhost to verify on current host only.
 */
function getCookieDomain(req: Request): string | undefined {
    if (isLocalhostRequest(req)) {
        return undefined;
    }

    // For cloud deployments, use the base domain to allow sharing between api. and www.
    // e.g., rejourney.co -> .rejourney.co
    const domain = getBaseDomain(req.hostname);
    return domain.includes('.') ? `.${domain}` : undefined;
}

/**
 * Get standard cookie options for session cookies
 */
export function getSessionCookieOptions(req: Request, maxAgeMs: number): CookieOptions {
    return {
        httpOnly: true,
        secure: shouldUseSecureCookies(req),
        sameSite: 'lax',
        maxAge: maxAgeMs,
        path: '/',
        domain: getCookieDomain(req),
    };
}

/**
 * Get standard cookie options for CSRF cookies
 */
export function getCsrfCookieOptions(req: Request): CookieOptions {
    return {
        httpOnly: false, // Allow JS access to include in headers
        secure: shouldUseSecureCookies(req),
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/',
        domain: getCookieDomain(req),
    };
}

/**
 * Get standard cookie options for OAuth state cookies
 */
export function getOAuthStateCookieOptions(req: Request): CookieOptions {
    return {
        httpOnly: true,
        secure: shouldUseSecureCookies(req),
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000, // 10 minutes
        path: '/',
        domain: getCookieDomain(req),
    };
}
