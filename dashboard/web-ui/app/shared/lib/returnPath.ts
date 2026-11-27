/**
 * Post-login return targets. Only same-origin relative paths are allowed:
 * "/x" passes; "//host", "/\host" (browsers read "\" as "/"), absolute URLs and
 * anything with control characters (stripped by URL parsers, so "/\t/host"
 * would become "//host") are rejected.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
    if (typeof value !== "string" || !value.startsWith("/")) return null;
    if (value.startsWith("//")) return null;
    if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
    return value;
}

/** `/login?returnTo=<path>`, or plain `/login` when the path is not a safe return target. */
export function buildLoginPath(returnTo: string): string {
    const safe = safeReturnPath(returnTo);
    return safe ? `/login?returnTo=${encodeURIComponent(safe)}` : "/login";
}
