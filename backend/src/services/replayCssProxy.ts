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
 * The socket itself resolves through a validating lookup, so the address that is
 * connected to is always one that passed the same check (no DNS rebinding
 * between validation and connect).
 */

import { lookup as lookupCallback, type LookupAddress, type LookupOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { Readable, pipeline } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
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

/** Expand an IPv6 address (already accepted by isIP) into its eight 16-bit groups. */
function parseIpv6Groups(ip: string): number[] | null {
    let addr = ip.toLowerCase();
    const zone = addr.indexOf('%');
    if (zone >= 0) addr = addr.slice(0, zone);

    // Rewrite an embedded dotted IPv4 tail (::ffff:1.2.3.4) as two hex groups.
    const lastColon = addr.lastIndexOf(':');
    const tail = addr.slice(lastColon + 1);
    if (tail.includes('.')) {
        const parts = tail.split('.').map(Number);
        if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
        addr = `${addr.slice(0, lastColon + 1)}${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
    }

    const halves = addr.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - head.length - rest.length;
    if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
    const groups = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
    if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
    return groups.map((g) => parseInt(g, 16));
}

function isPrivateIpv6(ip: string): boolean {
    const g = parseIpv6Groups(ip);
    if (!g) return true;
    const embeddedIpv4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
    const firstFiveZero = g.slice(0, 5).every((v) => v === 0);

    // IPv4-mapped addresses (::ffff:a.b.c.d, any notation) carry the IPv4 semantics.
    if (firstFiveZero && g[5] === 0xffff) return isPrivateIpv4(embeddedIpv4);
    // ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d range.
    if (firstFiveZero && g[5] === 0) return true;
    return (
        (g[0] === 0x64 && g[1] === 0xff9b) // 64:ff9b::/96 NAT64 and 64:ff9b:1::/48 local NAT64
        || g[0] === 0x2002 // 2002::/16 6to4 (embeds an IPv4 address)
        || (g[0] === 0x2001 && g[1] === 0) // 2001::/32 Teredo (embeds an IPv4 address)
        || (g[0] === 0x2001 && g[1] === 0xdb8) // 2001:db8::/32 documentation
        || (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) // 100::/64 discard
        || (g[0] & 0xfe00) === 0xfc00 // fc00::/7 unique local
        || (g[0] & 0xffc0) === 0xfe80 // fe80::/10 link-local
        || (g[0] & 0xffc0) === 0xfec0 // fec0::/10 deprecated site-local
        || (g[0] & 0xff00) === 0xff00 // ff00::/8 multicast
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

/** fetch-shaped transport; redirects are never followed by the transport itself. */
export type StylesheetTransport = (
    url: string,
    init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<Response>;

type LookupCallback = (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
) => void;

type LookupResolver = (
    hostname: string,
    options: LookupOptions & { all: true },
    callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/**
 * A socket `lookup` that refuses the connection unless every DNS answer is
 * public unicast, then hands the socket only those validated answers. Because
 * the socket connects to what this returns, a record that changes between
 * validateExternalStylesheetUrl() and connect cannot redirect it internally.
 */
export function createValidatingLookup(resolver: LookupResolver = lookupCallback as unknown as LookupResolver) {
    return (hostname: string, options: LookupOptions | number | undefined, callback: LookupCallback): void => {
        const opts: LookupOptions = typeof options === 'number' ? { family: options } : options ?? {};
        resolver(hostname, { ...opts, all: true, verbatim: true }, (err, addresses) => {
            if (err) {
                callback(err, []);
                return;
            }
            const list = Array.isArray(addresses) ? addresses : [];
            if (list.length === 0 || list.some((entry) => isPrivateAddress(entry.address))) {
                const blocked: NodeJS.ErrnoException = new Error(`Refusing to connect to ${hostname}: resolves to a non-public address`);
                blocked.code = 'ERR_REPLAY_CSS_PRIVATE_ADDRESS';
                callback(blocked, []);
                return;
            }
            if (opts.all) {
                callback(null, list);
                return;
            }
            callback(null, list[0].address, list[0].family);
        });
    };
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

function decodedBodyStream(response: IncomingMessage): Readable {
    const encoding = String(response.headers['content-encoding'] || '').trim().toLowerCase();
    const decoder = encoding === 'gzip' || encoding === 'x-gzip'
        ? createGunzip()
        : encoding === 'br'
            ? createBrotliDecompress()
            : encoding === 'deflate'
                ? createInflate()
                : null;
    if (!decoder) return response;
    // pipeline (unlike pipe) destroys the decoder when the response is aborted or
    // reset mid-body, so the body read rejects instead of waiting forever.
    pipeline(response, decoder, () => undefined);
    return decoder;
}

/** Wraps an upstream response as a fetch Response with its body decoded. */
export function responseFromIncomingMessage(incoming: IncomingMessage): Response {
    const status = incoming.statusCode ?? 0;
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
    }
    if (NULL_BODY_STATUSES.has(status) || status < 200 || status > 599) {
        incoming.resume();
        return new Response(null, { status: status >= 200 && status <= 599 ? status : 502, headers });
    }
    const stream = decodedBodyStream(incoming);
    stream.on('error', () => undefined);
    headers.delete('content-encoding');
    headers.delete('content-length');
    return new Response(Readable.toWeb(stream) as unknown as ConstructorParameters<typeof Response>[0], { status, headers });
}

/**
 * Default transport: a single https request whose socket resolves through
 * createValidatingLookup(), so the connected address is always validated.
 */
export const pinnedHttpsTransport: StylesheetTransport = (url, init) => new Promise<Response>((resolve, reject) => {
    const req = httpsRequest(url, {
        method: 'GET',
        agent: false,
        lookup: createValidatingLookup() as never,
        signal: init.signal,
        headers: { ...init.headers, 'accept-encoding': 'gzip, deflate, br' },
    }, (incoming) => {
        try {
            resolve(responseFromIncomingMessage(incoming));
        } catch (err) {
            incoming.destroy();
            reject(err);
        }
    });
    req.on('error', reject);
    req.end();
});

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
    options: { maxBytes?: number; timeoutMs?: number; transport?: StylesheetTransport } = {},
): Promise<StylesheetFetchResult> {
    const maxBytes = options.maxBytes ?? REPLAY_CSS_MAX_BYTES;
    const timeoutMs = options.timeoutMs ?? REPLAY_CSS_FETCH_TIMEOUT_MS;
    const transport = options.transport ?? pinnedHttpsTransport;
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
            response = await transport(current.toString(), {
                signal: abort.signal,
                headers: { accept: 'text/css,*/*;q=0.1' },
            });
        } catch (err) {
            clearTimeout(timer);
            const name = (err as Error | undefined)?.name;
            const code = (err as NodeJS.ErrnoException | undefined)?.code;
            if (code === 'ERR_REPLAY_CSS_PRIVATE_ADDRESS') return { ok: false, reason: 'resolves_to_private_address' };
            return { ok: false, reason: name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'fetch_failed' };
        }

        if (response.status !== 200) clearTimeout(timer);

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

        // The hop deadline also covers the body, so a slow-drip upstream cannot hold the request open.
        let body: Buffer | null;
        try {
            body = await readBodyWithCap(response, maxBytes);
        } catch {
            return { ok: false, reason: abort.signal.aborted ? 'timeout' : 'fetch_failed' };
        } finally {
            clearTimeout(timer);
        }
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
export async function resolveReplayStylesheet(
    rawUrl: string,
    options: { transport?: StylesheetTransport } = {},
): Promise<StylesheetFetchResult> {
    const validation = await validateExternalStylesheetUrl(rawUrl);
    if (!validation.ok) {
        logger.warn(
            { event: 'replay_css.url_rejected', reason: validation.reason },
            '[replayCssProxy] Rejected stylesheet URL',
        );
        return { ok: false, reason: validation.reason };
    }
    return fetchExternalStylesheet(validation.url, options);
}
