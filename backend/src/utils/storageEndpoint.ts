export function resolvePublicStorageEndpointForSignedUrls(params: {
    endpointUrl: string;
    configuredPublicEndpoint?: string | null;
    nodeEnv?: string | null;
}): string | null {
    const configuredPublicEndpoint = params.configuredPublicEndpoint?.trim();
    if (configuredPublicEndpoint) return configuredPublicEndpoint;

    try {
        const parsed = new URL(params.endpointUrl);
        if (parsed.hostname !== 'minio') return params.endpointUrl;

        // The built-in self-hosted MinIO service is intentionally private. A
        // browser cannot resolve its Docker hostname, so callers must use the
        // authenticated same-origin proxy instead of receiving a broken URL.
        if (params.nodeEnv === 'production') return null;

        // Preserve the convenient host-browser URL used by local development.
        parsed.hostname = 'localhost';
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return params.endpointUrl;
    }
}
