const UUID_PATH_SEGMENT_RE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
const LONG_HEX_PATH_SEGMENT_RE = /\/[0-9a-f]{16,}(?=\/|$)/gi;
const NUMERIC_PATH_SEGMENT_RE = /\/\d+(?=\/|$)/g;
const EXTRACTOR_FEED_LISTINGS_RE = /(\/api\/extractors\/feeds\/)[^/]+(?=\/listings\/?)/i;
const STATIC_ASSET_PATH_RE = /\.(jpg|jpeg|png|gif|webp|avif|svg|ico|css|js|map|woff2?|ttf|otf|mp4|webm|mov|m4v|mp3|wav|pdf)(?:$|[?#])/i;

export function normalizeApiEndpointPath(path: string): string {
    const trimmed = path.trim() || '/';
    return trimmed
        .replace(EXTRACTOR_FEED_LISTINGS_RE, '$1:feed')
        .replace(UUID_PATH_SEGMENT_RE, '/:id')
        .replace(LONG_HEX_PATH_SEGMENT_RE, '/:id')
        .replace(NUMERIC_PATH_SEGMENT_RE, '/:id');
}

export function buildNormalizedApiEndpointLabel(method: string, path: string): string {
    const normalizedMethod = method.trim().toUpperCase() || 'GET';
    return `${normalizedMethod} ${normalizeApiEndpointPath(path)}`;
}

export function isStaticAssetEndpointPath(path: string): boolean {
    return STATIC_ASSET_PATH_RE.test(path.trim());
}
