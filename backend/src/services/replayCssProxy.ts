/**
 * Replay Stylesheet Proxy
 *
 * rrweb inlines same-origin stylesheets into the snapshot at record time, but when
 * that fails (cross-origin CSS, or a snapshot racing a stylesheet load) the recorded
 * document keeps a bare external <link>. The dashboard cannot load customer-origin
 * stylesheets directly — its CSP only allows styles from 'self' — so those replays
 * render as unstyled HTML.
 *
 * Instead of loosening the CSP, the dashboard fetches the stylesheet through this
 * proxy (connect-src already allows the API origin) and inlines the text into the
 * snapshot client-side, mirroring the shape rrweb itself produces.
 *
 * Because this fetches arbitrary recorded URLs server-side, everything here is
 * SSRF-guarded: https only, no credentials in the URL, no IP-literal hosts, every
 * DNS answer must be public unicast, and redirects are re-validated hop by hop.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { logger } from '../logger.js';

export const REPLAY_CSS_MAX_BYTES = 5 * 1024 * 1024;
export const REPLAY_CSS_FETCH_TIMEOUT_MS = 10_000;
const REPLAY_CSS_MAX_REDIRECTS = 3;

export type StylesheetUrlValidation =
    | { ok: true; url: URL }
    | { ok: false; reason: string };

function isPrivateIpv4(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
    const [a, b] = parts;
    return (
        a === 0 // "this network"
        || a === 10
        || a === 127 // loopback
        || (a === 100 && b >= 64 && b <= 127) // CGNAT
        || (a === 169 && b === 254) // link-local / cloud metadata
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 192 && b === 0) // 192.0.0.0/24 special use
        || (a === 198 && (b === 18 || b === 19)) // benchmarking
        || a >= 224 // multicast + reserved
    );
}

function isPrivateIpv6(ip: string): boolean {
    const lower = ip.toLowerCase();
    // IPv4-mapped addresses carry the embedded IPv4 semantics.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIpv4(mapped[1]);
    return (
        lower === '::'
        || lower === '::1' // loopback
        || lower.startsWith('fc') // fc00::/7 unique local
        || lower.startsWith('fd')
        || lower.startsWith('fe8') // fe80::/10 link-local
        || lower.startsWith('fe9')
        || lower.startsWith('fea')
        || lower.startsWith('feb')
        || lower.startsWith('ff') // multicast
    );
}

export function isPrivateAddress(ip: string): boolean {
    const family = isIP(ip);
    if (family === 4) return isPrivateIpv4(ip);
    if (family === 6) return isPrivateIpv6(ip);
    return true; // unparseable — treat as unsafe
}

/**
 * Validate a recorded stylesheet URL before any network activity.
 * DNS resolution is part of validation: every answer must be public unicast,
 * so a hostname pointing at 169.254.169.254 or an internal service is refused.
 */
export async function validateExternalStylesheetUrl(raw: string): Promise<StylesheetUrlValidation> {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return { ok: false, reason: 'invalid_url' };
    }

    if (url.protocol !== 'https:') return { ok: false, reason: 'protocol_not_https' };
    if (url.username || url.password) return { ok: false, reason: 'credentials_in_url' };
    if (url.port && url.port !== '443') return { ok: false, reason: 'non_standard_port' };

    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(hostname)) return { ok: false, reason: 'ip_literal_host' };
    if (!hostname.includes('.')) return { ok: false, reason: 'bare_hostname' };

    let addresses: Array<{ address: string }>;
    try {
        addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
        return { ok: false, reason: 'dns_resolution_failed' };
    }
    if (addresses.length === 0) return { ok: false, reason: 'dns_no_answers' };
    if (addresses.some((entry) => isPrivateAddress(entry.address))) {
        return { ok: false, reason: 'resolves_to_private_address' };
    }

    return { ok: true, url };
}

export type StylesheetFetchResult =
    | { ok: true; body: Buffer }
    | { ok: false; reason: string; status?: number };

async function readBodyWithCap(response: Response, maxBytes: number): Promise<Buffer | null> {
    if (!response.body) return Buffer.alloc(0);
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            return null;
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

/**
 * Fetch a validated stylesheet URL. Redirects are followed manually so every hop
 * passes the same SSRF validation as the original URL.
 */
export async function fetchExternalStylesheet(
    initialUrl: URL,
    options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<StylesheetFetchResult> {
    const maxBytes = options.maxBytes ?? REPLAY_CSS_MAX_BYTES;
    const timeoutMs = options.timeoutMs ?? REPLAY_CSS_FETCH_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    let current = initialUrl;
    for (let hop = 0; hop <= REPLAY_CSS_MAX_REDIRECTS; hop += 1) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) return { ok: false, reason: 'timeout' };

        // This tsconfig's ES2022 lib types AbortSignal without the static timeout()
        // helper, so build the timeout signal manually.
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), remainingMs);
        let response: Response;
        try {
            response = await fetch(current.toString(), {
                redirect: 'manual',
                signal: abort.signal,
                headers: { accept: 'text/css,*/*;q=0.1' },
            });
        } catch (err) {
            const name = (err as Error | undefined)?.name;
            return { ok: false, reason: name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'fetch_failed' };
        } finally {
            clearTimeout(timer);
        }

        if (response.status >= 300 && response.status < 400) {
            await response.body?.cancel().catch(() => undefined);
            const location = response.headers.get('location');
            if (!location) return { ok: false, reason: 'redirect_without_location', status: response.status };
            let next: string;
            try {
                next = new URL(location, current.toString()).toString();
            } catch {
                return { ok: false, reason: 'redirect_invalid_location', status: response.status };
            }
            const revalidated = await validateExternalStylesheetUrl(next);
            if (!revalidated.ok) return { ok: false, reason: `redirect_${revalidated.reason}`, status: response.status };
            current = revalidated.url;
            continue;
        }

        if (response.status !== 200) {
            await response.body?.cancel().catch(() => undefined);
            return { ok: false, reason: 'upstream_status', status: response.status };
        }

        const body = await readBodyWithCap(response, maxBytes);
        if (body === null) return { ok: false, reason: 'too_large' };

        // An auth wall or error page serialised as HTML must not be injected as CSS.
        const head = body.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
        if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<head') || head.startsWith('<body')) {
            return { ok: false, reason: 'body_looks_like_html' };
        }

        return { ok: true, body };
    }

    return { ok: false, reason: 'too_many_redirects' };
}

/**
 * Full pipeline used by the proxy routes: validate, fetch, and report one
 * outcome object the route can translate into an HTTP response.
 */
export async function resolveReplayStylesheet(rawUrl: string): Promise<StylesheetFetchResult> {
    const validation = await validateExternalStylesheetUrl(rawUrl);
    if (!validation.ok) {
        logger.warn(
            { event: 'replay_css.url_rejected', reason: validation.reason },
            '[replayCssProxy] Rejected stylesheet URL',
        );
        return { ok: false, reason: validation.reason };
    }
    return fetchExternalStylesheet(validation.url);
}
