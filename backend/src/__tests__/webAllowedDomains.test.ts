import { describe, expect, it } from 'vitest';
import { isWebOriginAllowed, normalizeWebAllowedDomain } from '../utils/webAllowedDomains.js';

describe('web allowed domains', () => {
    it('fails closed when no browser allowlist is configured', () => {
        expect(isWebOriginAllowed([], 'https://app.example.com')).toBe(false);
        expect(isWebOriginAllowed(null, 'https://app.example.com')).toBe(false);
    });

    it('allows exact and wildcard browser origins from the allowlist', () => {
        expect(isWebOriginAllowed(['app.example.com', '*.shop.example.com'], 'https://app.example.com')).toBe(true);
        expect(isWebOriginAllowed(['app.example.com', '*.shop.example.com'], 'https://checkout.shop.example.com')).toBe(true);
        expect(isWebOriginAllowed(['app.example.com', '*.shop.example.com'], 'https://evil.example.net')).toBe(false);
    });

    it('keeps localhost explicit instead of default-allowed', () => {
        expect(normalizeWebAllowedDomain('http://localhost:3000')).toBe('localhost:3000');
        expect(isWebOriginAllowed(['localhost:3000'], 'http://localhost:3000')).toBe(true);
        expect(isWebOriginAllowed(['app.example.com'], 'http://localhost:3000')).toBe(false);
    });
});
