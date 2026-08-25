import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    lookup: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
    lookup: mocks.lookup,
}));

vi.mock('../logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
    isPrivateAddress,
    validateExternalStylesheetUrl,
    fetchExternalStylesheet,
    resolveReplayStylesheet,
} = await import('../services/replayCssProxy.js');

const PUBLIC_A = { address: '93.184.216.34', family: 4 };

function css(body: string, init: ResponseInit = {}): Response {
    return new Response(body, { status: 200, headers: { 'content-type': 'text/css' }, ...init });
}

describe('isPrivateAddress', () => {
    it('rejects every internal IPv4 range an SSRF probe would target', () => {
        for (const ip of [
            '10.0.0.4', '127.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
            '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '255.255.255.255',
        ]) {
            expect(isPrivateAddress(ip), ip).toBe(true);
        }
    });

    it('rejects internal IPv6 including mapped IPv4', () => {
        for (const ip of ['::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.4', '::ffff:169.254.169.254']) {
            expect(isPrivateAddress(ip), ip).toBe(true);
        }
    });

    it('accepts public unicast addresses', () => {
        for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700::1111', '::ffff:93.184.216.34']) {
            expect(isPrivateAddress(ip), ip).toBe(false);
        }
    });

    it('treats unparseable input as unsafe', () => {
        expect(isPrivateAddress('not-an-ip')).toBe(true);
    });
});

describe('validateExternalStylesheetUrl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.lookup.mockResolvedValue([PUBLIC_A]);
    });

    it('accepts a normal https stylesheet URL', async () => {
        const result = await validateExternalStylesheetUrl('https://cdn.example.com/app.css');
        expect(result.ok).toBe(true);
    });

    it.each([
        ['http://cdn.example.com/app.css', 'protocol_not_https'],
        ['https://user:pass@cdn.example.com/app.css', 'credentials_in_url'],
        ['https://cdn.example.com:8443/app.css', 'non_standard_port'],
        ['https://93.184.216.34/app.css', 'ip_literal_host'],
        ['https://[::1]/app.css', 'ip_literal_host'],
        ['https://localhost/app.css', 'bare_hostname'],
        ['not a url', 'invalid_url'],
    ])('rejects %s (%s)', async (url, reason) => {
        const result = await validateExternalStylesheetUrl(url);
        expect(result).toEqual({ ok: false, reason });
    });

    it('rejects hostnames that resolve to a private address, even alongside public ones', async () => {
        mocks.lookup.mockResolvedValue([PUBLIC_A, { address: '169.254.169.254', family: 4 }]);
        const result = await validateExternalStylesheetUrl('https://rebound.example.com/app.css');
        expect(result).toEqual({ ok: false, reason: 'resolves_to_private_address' });
    });

    it('fails closed when DNS resolution errors', async () => {
        mocks.lookup.mockRejectedValue(new Error('ENOTFOUND'));
        const result = await validateExternalStylesheetUrl('https://gone.example.com/app.css');
        expect(result).toEqual({ ok: false, reason: 'dns_resolution_failed' });
    });
});

describe('fetchExternalStylesheet', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.lookup.mockResolvedValue([PUBLIC_A]);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    async function run(url: string, opts?: { maxBytes?: number; timeoutMs?: number }) {
        const validated = await validateExternalStylesheetUrl(url);
        if (!validated.ok) throw new Error('test URL failed validation');
        return fetchExternalStylesheet(validated.url, opts);
    }

    it('returns the stylesheet body on success', async () => {
        globalThis.fetch = vi.fn(async () => css('body { color: red; }')) as any;
        const result = await run('https://cdn.example.com/app.css');
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.body.toString('utf8')).toContain('color: red');
    });

    it('refuses bodies that look like an HTML auth wall', async () => {
        globalThis.fetch = vi.fn(async () => css('<!DOCTYPE html><html><body>Sign in</body></html>')) as any;
        const result = await run('https://cdn.example.com/app.css');
        expect(result).toEqual({ ok: false, reason: 'body_looks_like_html' });
    });

    it('propagates non-200 upstream status as failure', async () => {
        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 404 })) as any;
        const result = await run('https://cdn.example.com/app.css');
        expect(result).toMatchObject({ ok: false, reason: 'upstream_status', status: 404 });
    });

    it('enforces the size cap', async () => {
        globalThis.fetch = vi.fn(async () => css('x'.repeat(2048))) as any;
        const result = await run('https://cdn.example.com/app.css', { maxBytes: 1024 });
        expect(result).toEqual({ ok: false, reason: 'too_large' });
    });

    it('follows a redirect only after revalidating the target', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn2.example.com/app.css' } }))
            .mockResolvedValueOnce(css('a { color: blue; }'));
        globalThis.fetch = fetchMock as any;

        const result = await run('https://cdn.example.com/app.css');
        expect(result.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        // Both the original host and the redirect target must have been resolved.
        expect(mocks.lookup).toHaveBeenCalledWith('cdn2.example.com', expect.anything());
    });

    it('refuses a redirect that points at a private address', async () => {
        globalThis.fetch = vi.fn(async () =>
            new Response(null, { status: 302, headers: { location: 'https://internal.example.com/app.css' } }),
        ) as any;
        mocks.lookup
            .mockResolvedValueOnce([PUBLIC_A]) // initial validation happens in run()
            .mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]); // redirect target

        const result = await run('https://cdn.example.com/app.css');
        expect(result).toMatchObject({ ok: false, reason: 'redirect_resolves_to_private_address' });
    });

    it('gives up after too many redirects', async () => {
        globalThis.fetch = vi.fn(async () =>
            new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/loop.css' } }),
        ) as any;
        const result = await run('https://cdn.example.com/app.css');
        expect(result).toEqual({ ok: false, reason: 'too_many_redirects' });
    });
});

describe('resolveReplayStylesheet', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('rejects before any network activity when the URL is unsafe', async () => {
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock as any;
        const result = await resolveReplayStylesheet('http://cdn.example.com/app.css');
        expect(result).toEqual({ ok: false, reason: 'protocol_not_https' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns CSS end to end for a safe URL', async () => {
        mocks.lookup.mockResolvedValue([PUBLIC_A]);
        globalThis.fetch = vi.fn(async () => css('.ok { display: block; }')) as any;
        const result = await resolveReplayStylesheet('https://cdn.example.com/app.css');
        expect(result.ok).toBe(true);
    });
});
