/**
 * Outbound string scrubbing (§6.2 "from customers' own data to places it
 * should not go").
 *
 * Everything recorded on an end user's device is untrusted: it can hold
 * secrets the customer never meant to share with an AI client (tokens in
 * URLs, auth headers in logs) and text written to steer the model or make a
 * client load a URL. These functions are pure and are applied by the output
 * layer to every string a tool returns.
 */

export const REDACTED = '[redacted]';

// --- URLs ---------------------------------------------------------------------

/** `scheme://…` up to whitespace or a closing delimiter. */
const URL_PATTERN = /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s<>"'`)\]}]+/gi;
/** Trailing punctuation that belongs to the sentence, not the URL. */
const URL_TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/**
 * `scheme://user:pass@host:port/path?query#hash` -> `host:port/path`.
 * The scheme goes too, so clients do not turn the remainder into a link.
 */
export function reduceUrl(raw: string): string {
    try {
        const url = new URL(raw);
        if (!url.host) return REDACTED;
        const path = url.pathname === '/' ? '' : url.pathname;
        return `${url.host}${path}`;
    } catch {
        return REDACTED;
    }
}

function reduceUrls(text: string): string {
    return text.replace(URL_PATTERN, (match) => {
        const trailing = match.match(URL_TRAILING_PUNCTUATION)?.[0] ?? '';
        const body = trailing ? match.slice(0, -trailing.length) : match;
        return `${reduceUrl(body)}${trailing}`;
    });
}

/** Query strings on scheme-less paths: `/checkout?token=abc` -> `/checkout`. */
const PATH_QUERY_PATTERN = /(\/[^\s?#"'<>()]*)\?[^\s"'<>()]*/g;

// --- Secrets ------------------------------------------------------------------

const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/g;
/** `token=…`, `api_key: …`, `password=…` and friends. */
const SECRET_PAIR_PATTERN =
    /\b(access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|secret|client[_-]?secret|password|passwd|pwd|authorization|auth|session[_-]?id|signature|sig)(\s*[=:]\s*)(?!(?:Bearer|Basic)\s+\[redacted\])("?)[^\s"&,;]+\3/gi;
/** Vendor key and id prefixes, Stripe object ids included. */
const PREFIXED_KEY_PATTERN = new RegExp(
    [
        String.raw`\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}`,
        String.raw`\brjm_[A-Za-z0-9_-]{8,}`,
        String.raw`\bwhsec_[A-Za-z0-9]{8,}`,
        String.raw`\bgh[pousr]_[A-Za-z0-9]{20,}`,
        String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`,
        String.raw`\bAKIA[0-9A-Z]{16}\b`,
        String.raw`\bAIza[0-9A-Za-z_-]{30,}`,
        String.raw`\b(?:cus|sub|pi|pm|si|seti|price|prod|in|ch|evt|acct)_[A-Za-z0-9]{14,}`,
    ].join('|'),
    'g',
);
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** A run of word characters; redacted when it holds a long letter-and-digit run (see `hasLongMixedRun`). */
const WORD_TOKEN_PATTERN = /[A-Za-z0-9_-]{24,}/g;
const LONG_ALNUM_RUN = /[A-Za-z0-9]{24,}/g;
/** Base64 alphabet, slashes included; redacted when it does not look like a path (see `looksLikeBase64`). */
const BASE64_BLOB_PATTERN = /[A-Za-z0-9+/]{40,}={0,2}/g;
const CARD_PATTERN = /(?<![\d.])\d(?:[ -]?\d){12,18}(?![\d.])/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

function hasLongMixedRun(token: string): boolean {
    const runs = token.match(LONG_ALNUM_RUN);
    if (!runs) return false;
    return runs.some((run) => /[0-9]/.test(run) && /[A-Za-z]/.test(run));
}

/** Mixed case plus digits, and not chopped into short `/` segments the way a URL path is. */
function looksLikeBase64(blob: string): boolean {
    if (!/[0-9]/.test(blob) || !/[a-z]/.test(blob) || !/[A-Z]/.test(blob)) return false;
    const segments = blob.split('/').filter(Boolean);
    if (segments.length <= 1) return true;
    return blob.length / segments.length >= 16;
}

export function passesLuhn(digits: string): boolean {
    let sum = 0;
    let double = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
        let digit = digits.charCodeAt(index) - 48;
        if (double) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
        double = !double;
    }
    return sum % 10 === 0;
}

// --- Markup and control characters ----------------------------------------------

const INLINE_LINK_PATTERN = /!?\[([^\]\n]{0,300})\]\s*\(([^)\n]{0,600})\)/g;
const REFERENCE_LINK_PATTERN = /!?\[([^\]\n]{0,300})\]\s*\[([^\]\n]{0,300})\]/g;
/** C0/C1 controls except tab and newline, zero-width characters and bidi overrides. */
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/**
 * Makes markdown link and image syntax, and HTML tags, inert. A hostile event
 * label must not be able to make a client fetch a URL.
 */
export function neutralizeMarkup(text: string): string {
    return text
        .replace(INLINE_LINK_PATTERN, (_match, label: string, target: string) => `${label} (${target})`)
        // Two of our own markers side by side are not a reference link.
        .replace(REFERENCE_LINK_PATTERN, (match, label: string, reference: string) => (`[${label}]` === REDACTED && `[${reference}]` === REDACTED ? match : `${label} ${reference}`))
        // Anything the two patterns above did not catch (nesting, odd spacing).
        .replace(/!\[/g, '[')
        .replace(/\]\(/g, '] (')
        .replace(/\]\[/g, '] [')
        // Reference definitions (`[id]: url`) only exist at the start of a line.
        .replace(/^(\s*\[[^\]\n]*\]):/gm, '$1 :')
        .replace(/</g, '‹')
        .replace(/>/g, '›');
}

export interface ScrubOptions {
    /** Masking switch: emails are replaced too. */
    mask: boolean;
    /**
     * Stack frames: skip the generic long-token rule, which would eat mangled
     * symbol names. Every named pattern still applies.
     */
    stack?: boolean;
    maxLength?: number;
}

export const DEFAULT_MAX_STRING_LENGTH = 300;

/** Scrubs one untrusted string. Order matters: URLs are reduced before the token rules run on what is left. */
export function scrubText(input: string, options: ScrubOptions): string {
    let text = input.replace(CONTROL_PATTERN, '');
    text = reduceUrls(text);
    text = text.replace(PATH_QUERY_PATTERN, '$1');
    text = text.replace(AUTH_SCHEME_PATTERN, (_match, scheme: string) => `${scheme} ${REDACTED}`);
    text = text.replace(JWT_PATTERN, REDACTED);
    text = text.replace(SECRET_PAIR_PATTERN, (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`);
    text = text.replace(PREFIXED_KEY_PATTERN, REDACTED);
    text = text.replace(UUID_PATTERN, REDACTED);
    if (!options.stack) {
        text = text.replace(BASE64_BLOB_PATTERN, (blob) => (looksLikeBase64(blob) ? REDACTED : blob));
        text = text.replace(WORD_TOKEN_PATTERN, (token) => (hasLongMixedRun(token) ? REDACTED : token));
    }
    text = text.replace(CARD_PATTERN, (match) => (passesLuhn(match.replace(/[ -]/g, '')) ? REDACTED : match));
    if (options.mask) text = text.replace(EMAIL_PATTERN, REDACTED);
    text = neutralizeMarkup(text);

    const maxLength = options.maxLength ?? DEFAULT_MAX_STRING_LENGTH;
    if (text.length > maxLength) text = `${text.slice(0, Math.max(0, maxLength - 1))}…`;
    return text;
}
