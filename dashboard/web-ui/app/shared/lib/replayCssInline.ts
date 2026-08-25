/**
 * Client-side stylesheet inlining for rrweb replays.
 *
 * rrweb inlines stylesheets it can read at record time (`_cssText`), but a snapshot
 * that raced a stylesheet load — or CSS served cross-origin without CORS — keeps a
 * bare external `<link rel="stylesheet">`. The dashboard CSP only allows styles from
 * 'self', so the replay iframe can never load those links and the replay renders as
 * unstyled HTML.
 *
 * Before mounting the player we fetch each such stylesheet through the backend's
 * SSRF-guarded proxy (`cssProxyPath` on the replay payload) and inline the text into
 * the event nodes, mirroring the exact shape rrweb produces when it inlines at
 * record time: `_cssText` set, `rel`/`href` removed. The player then rebuilds them
 * as `<style>` elements and needs no network access at all.
 *
 * Fetch failures leave the node untouched — the replay is no worse than before.
 */

type SerializedNodeLike = {
    tagName?: string;
    attributes?: Record<string, unknown>;
    childNodes?: SerializedNodeLike[];
};

function isExternalStylesheetLink(node: SerializedNodeLike): boolean {
    if (node.tagName !== 'link' || !node.attributes) return false;
    const attrs = node.attributes;
    if (attrs._cssText) return false;
    const rel = String(attrs.rel ?? '').toLowerCase();
    if (!rel.split(/\s+/).includes('stylesheet')) return false;
    const href = attrs.href;
    return typeof href === 'string' && /^https?:\/\//i.test(href);
}

function collectFromNode(node: SerializedNodeLike | null | undefined, out: SerializedNodeLike[]): void {
    if (!node || typeof node !== 'object') return;
    if (isExternalStylesheetLink(node)) out.push(node);
    const children = node.childNodes;
    if (Array.isArray(children)) {
        for (const child of children) collectFromNode(child, out);
    }
}

/**
 * Find every un-inlined external stylesheet link across full snapshots (type 2)
 * and incremental mutation adds (type 3, source 0).
 */
export function collectExternalStylesheetLinks(events: any[]): SerializedNodeLike[] {
    const found: SerializedNodeLike[] = [];
    for (const event of events) {
        if (!event || typeof event !== 'object') continue;
        if (event.type === 2) {
            collectFromNode(event.data?.node, found);
        } else if (event.type === 3 && event.data?.source === 0 && Array.isArray(event.data.adds)) {
            for (const add of event.data.adds) collectFromNode(add?.node, found);
        }
    }
    return found;
}

export type FetchCssText = (href: string) => Promise<string | null>;

/**
 * Inline external stylesheet links in place. Returns how many links were inlined.
 * Each unique href is fetched once; nodes sharing an href share the result.
 */
export async function inlineExternalReplayStylesheets(
    events: any[],
    fetchCssText: FetchCssText,
): Promise<number> {
    const links = collectExternalStylesheetLinks(events);
    if (links.length === 0) return 0;

    const byHref = new Map<string, SerializedNodeLike[]>();
    for (const link of links) {
        const href = String(link.attributes!.href);
        const list = byHref.get(href) ?? [];
        list.push(link);
        byHref.set(href, list);
    }

    let inlined = 0;
    await Promise.all(
        [...byHref.entries()].map(async ([href, nodes]) => {
            let cssText: string | null = null;
            try {
                cssText = await fetchCssText(href);
            } catch {
                cssText = null;
            }
            if (!cssText) return;
            for (const node of nodes) {
                const attrs = node.attributes!;
                attrs._cssText = cssText;
                // Match rrweb's own inline shape so the replayer rebuilds this as a
                // <style> element instead of re-requesting the external URL.
                delete attrs.rel;
                delete attrs.href;
                inlined += 1;
            }
        }),
    );
    return inlined;
}

const CSS_PROXY_FETCH_TIMEOUT_MS = 8_000;

/**
 * Build the fetcher used against the backend stylesheet proxy. Kept separate from
 * the inliner so tests can exercise the walk/mutate logic with a stub.
 */
export function buildProxyCssFetcher(
    cssProxyPath: string,
    apiBaseUrl: string,
    credentials: RequestCredentials,
): FetchCssText {
    // Same resolution as rrwebReplayLoader's resolveSegmentUrl: payload paths are
    // /api/... and API_BASE_URL is '' in the browser (same-origin via the proxy).
    const base = /^https?:\/\//i.test(cssProxyPath)
        ? cssProxyPath
        : `${apiBaseUrl}${cssProxyPath.startsWith('/') ? cssProxyPath : `/${cssProxyPath}`}`;

    return async (href: string) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CSS_PROXY_FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(`${base}?url=${encodeURIComponent(href)}`, {
                credentials,
                signal: controller.signal,
            });
            if (!response.ok) return null;
            const text = await response.text();
            return text.length > 0 ? text : null;
        } catch {
            return null;
        } finally {
            clearTimeout(timer);
        }
    };
}
