const MAX_WEB_ALLOWED_DOMAINS = 25;

type ParsedDomain = {
    hostname: string;
    port: string | null;
    wildcard: boolean;
};

function normalizePort(port: string | undefined): string | null {
    if (!port) return null;
    if (!/^\d{1,5}$/.test(port)) return null;
    const numeric = Number(port);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) return null;
    return String(numeric);
}

function isValidIpv4(hostname: string): boolean {
    const parts = hostname.split('.');
    if (parts.length !== 4) return false;
    return parts.every((part) => {
        if (!/^\d{1,3}$/.test(part)) return false;
        const numeric = Number(part);
        return numeric >= 0 && numeric <= 255 && String(numeric) === part.replace(/^0+(?=\d)/, '');
    });
}

function isValidHostname(hostname: string, allowSingleLabel: boolean): boolean {
    if (hostname === 'localhost') return true;
    if (isValidIpv4(hostname)) return true;
    if (!allowSingleLabel && !hostname.includes('.')) return false;
    if (hostname.length > 253) return false;
    const labels = hostname.split('.');
    return labels.every((label) => (
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9-]+$/.test(label) &&
        !label.startsWith('-') &&
        !label.endsWith('-')
    ));
}

function parseNormalizedDomain(value: string): ParsedDomain | null {
    const wildcard = value.startsWith('*.');
    const withoutWildcard = wildcard ? value.slice(2) : value;
    if (!withoutWildcard) return null;

    if (withoutWildcard.startsWith('[')) {
        const match = withoutWildcard.match(/^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/);
        if (!match) return null;
        const port = normalizePort(match[2]);
        if (match[2] && !port) return null;
        return { hostname: match[1], port, wildcard: false };
    }

    if (withoutWildcard.includes(':') && withoutWildcard.split(':').length > 2) {
        return null;
    }

    const [hostnamePart, portPart] = withoutWildcard.split(':');
    const port = normalizePort(portPart);
    if (portPart && !port) return null;
    if (!hostnamePart || !isValidHostname(hostnamePart, false)) return null;
    if (wildcard && (hostnamePart === 'localhost' || isValidIpv4(hostnamePart))) return null;
    return { hostname: hostnamePart, port, wildcard };
}

export function normalizeWebAllowedDomain(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    let candidate = value.trim().toLowerCase();
    if (!candidate) return null;
    candidate = candidate.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    candidate = candidate.replace(/^\/\//, '');
    candidate = candidate.split(/[/?#]/)[0]?.trim() ?? '';
    candidate = candidate.replace(/\.$/, '');

    if (!candidate || candidate.length > 255) return null;
    if (candidate.includes('@') || /\s/.test(candidate)) return null;

    const parsed = parseNormalizedDomain(candidate);
    if (!parsed) return null;
    return `${parsed.wildcard ? '*.' : ''}${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
}

export function normalizeWebAllowedDomains(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    const seen = new Set<string>();
    const domains: string[] = [];

    for (const value of values) {
        const normalized = normalizeWebAllowedDomain(value);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        domains.push(normalized);
        if (domains.length >= MAX_WEB_ALLOWED_DOMAINS) break;
    }

    return domains;
}

export function isWebOriginAllowed(allowedDomains: unknown, origin: unknown): boolean {
    const normalizedAllowed = normalizeWebAllowedDomains(allowedDomains);
    if (normalizedAllowed.length === 0) return false;

    const candidate = normalizeWebAllowedDomain(origin);
    if (!candidate) return false;
    const candidateParsed = parseNormalizedDomain(candidate);
    if (!candidateParsed) return false;

    return normalizedAllowed.some((allowed) => {
        const allowedParsed = parseNormalizedDomain(allowed);
        if (!allowedParsed) return false;
        if (allowedParsed.port && allowedParsed.port !== candidateParsed.port) return false;

        if (allowedParsed.wildcard) {
            return candidateParsed.hostname.endsWith(`.${allowedParsed.hostname}`);
        }

        return allowedParsed.hostname === candidateParsed.hostname;
    });
}
