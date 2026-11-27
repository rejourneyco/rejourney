/**
 * In-process HTTP test helpers: an ephemeral loopback server whose handler can
 * be attached after its port is known, and a minimal browser-like cookie jar
 * for following redirect chains by hand.
 */
import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestServer {
    baseUrl: string;
    /** Attach the request handler once the app (which may need `baseUrl`) is built. */
    handle: (listener: RequestListener) => void;
    close: () => Promise<void>;
}

export async function listenEphemeral(): Promise<TestServer> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        handle: (listener) => {
            server.on('request', listener);
        },
        close: () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve());
                server.closeAllConnections();
            }),
    };
}

/** Reads a JSON body as a loose record; Node types `Response.json()` as `unknown`. */
export async function readJson(response: Response): Promise<Record<string, any>> {
    return (await response.json()) as Record<string, unknown>;
}

interface StoredCookie {
    name: string;
    value: string;
    path: string;
}

/** Path-scoped cookie jar for a single origin. */
export class CookieJar {
    private cookies: StoredCookie[] = [];

    store(response: Response): void {
        for (const line of response.headers.getSetCookie()) {
            const [pair, ...attributes] = line.split(';').map((part) => part.trim());
            const separator = pair.indexOf('=');
            const name = pair.slice(0, separator);
            const value = pair.slice(separator + 1);
            let path = '/';
            let expired = value === '';
            for (const attribute of attributes) {
                const [key, attributeValue = ''] = attribute.split('=');
                if (key.toLowerCase() === 'path') path = attributeValue || '/';
                if (key.toLowerCase() === 'expires' && Date.parse(attributeValue) <= Date.now()) expired = true;
                if (key.toLowerCase() === 'max-age' && Number(attributeValue) <= 0) expired = true;
            }
            this.cookies = this.cookies.filter((cookie) => !(cookie.name === name && cookie.path === path));
            if (!expired) this.cookies.push({ name, value, path });
        }
    }

    header(url: URL): string | undefined {
        const matching = this.cookies.filter(
            (cookie) => url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`),
        );
        return matching.length > 0 ? matching.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ') : undefined;
    }

    names(): string[] {
        return this.cookies.map((cookie) => cookie.name);
    }

    /** Adds a cookie by hand (a session cookie set by another host, say). */
    set(name: string, value: string, path = '/'): void {
        this.cookies = this.cookies.filter((cookie) => !(cookie.name === name && cookie.path === path));
        this.cookies.push({ name, value, path });
    }
}

export interface BrowseResult {
    /** The last response received from the origin being browsed. */
    response: Response;
    /** Set when the chain ended in a redirect that leaves the origin (e.g. to the client's redirect_uri). */
    external?: URL;
    /** Every URL requested, in order. */
    trail: string[];
}

/** Follows same-origin redirects like a browser would, carrying cookies, and stops when leaving the origin. */
export async function browse(jar: CookieJar, start: string | URL): Promise<BrowseResult> {
    const origin = new URL(start).origin;
    const trail: string[] = [];
    let current = new URL(start);

    for (let hop = 0; hop < 10; hop += 1) {
        trail.push(current.href);
        const cookie = jar.header(current);
        const response = await fetch(current, { redirect: 'manual', headers: cookie ? { cookie } : {} });
        jar.store(response);

        const location = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location) {
            await response.arrayBuffer();
            const next = new URL(location, current);
            if (next.origin !== origin) return { response, external: next, trail };
            current = next;
            continue;
        }
        return { response, trail };
    }
    throw new Error(`Too many redirects: ${trail.join(' -> ')}`);
}
