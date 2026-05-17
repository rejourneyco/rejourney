/**
 * App Identifier Validation
 *
 * Validates iOS bundle identifiers and Android package names.
 * Accepts input that matches EITHER format.
 *
 * Combined UX rules:
 *   • Length 3-155
 *   • Must contain at least one period (.)
 *   • Allowed chars: A-Z a-z 0-9 . - _
 *   • Cannot start or end with .
 *   • No consecutive dots (..)
 */

const IOS_BUNDLE_REGEX = /^[A-Za-z0-9.\-]{1,155}$/;
const ANDROID_PACKAGE_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

/** Returns an error message if the identifier is invalid, or null if valid. */
function validateAppIdentifier(value: string): string | null {
    if (!value) return null; // Empty is OK (field is optional)
    if (value.length < 3) return 'Must be at least 3 characters';
    if (value.length > 155) return 'Cannot exceed 155 characters';
    if (!value.includes('.')) return 'Must contain at least one period (e.g. com.example.app)';
    if (value.startsWith('.') || value.endsWith('.')) return 'Cannot start or end with a period';
    if (value.includes('..')) return 'Cannot contain consecutive periods';

    const isValidIos = IOS_BUNDLE_REGEX.test(value);
    const isValidAndroid = ANDROID_PACKAGE_REGEX.test(value);

    if (!isValidIos && !isValidAndroid) {
        return 'Only letters, numbers, periods, hyphens, and underscores are allowed';
    }
    return null;
}

/** Validate an iOS bundle ID. Returns error string or null. */
export function getIosBundleIdError(value: string): string | null {
    return validateAppIdentifier(value);
}

/** Validate an Android package name. Returns error string or null. */
export function getAndroidPackageError(value: string): string | null {
    return validateAppIdentifier(value);
}

/** Validate any app identifier (iOS or Android). Returns error string or null. */
export function getAppIdentifierError(value: string): string | null {
    return validateAppIdentifier(value);
}

function normalizeWebAllowedDomain(value: string): string | null {
    let candidate = value.trim().toLowerCase();
    if (!candidate) return null;
    candidate = candidate.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    candidate = candidate.replace(/^\/\//, '');
    candidate = candidate.split(/[/?#]/)[0] || '';
    candidate = candidate.replace(/\.$/, '');
    if (!candidate || candidate.includes('@') || /\s/.test(candidate) || candidate.length > 255) return null;

    const wildcard = candidate.startsWith('*.');
    const hostWithPort = wildcard ? candidate.slice(2) : candidate;
    const parts = hostWithPort.split(':');
    if (parts.length > 2) return null;
    const [host, port] = parts;
    if (!host) return null;
    if (port && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) return null;

    const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    const validHost = host === 'localhost' ||
        isIpv4 ||
        (host.includes('.') && host.split('.').every((label) => (
            /^[a-z0-9-]{1,63}$/.test(label) && !label.startsWith('-') && !label.endsWith('-')
        )));

    if (!validHost || (wildcard && (host === 'localhost' || isIpv4))) return null;
    return `${wildcard ? '*.' : ''}${host}${port ? `:${port}` : ''}`;
}

export function parseWebAllowedDomainsInput(value: string): string[] {
    const seen = new Set<string>();
    const domains: string[] = [];
    for (const part of value.split(/[,\n]+/)) {
        const normalized = normalizeWebAllowedDomain(part);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        domains.push(normalized);
    }
    return domains;
}

export function formatWebAllowedDomainsInput(value: string[] | undefined | null): string {
    return (value || []).join('\n');
}

export function getWebAllowedDomainsError(value: string, required = false): string | null {
    const rawParts = value.split(/[,\n]+/).map((part) => part.trim()).filter(Boolean);
    const domains = parseWebAllowedDomainsInput(value);
    if (required && domains.length === 0) return 'Add at least one allowed domain';
    if (rawParts.some((part) => normalizeWebAllowedDomain(part) === null)) return 'Use valid domains like app.example.com, www.example.com, or *.example.com';
    if (domains.length > 25) return 'Use 25 or fewer domains';
    return null;
}
