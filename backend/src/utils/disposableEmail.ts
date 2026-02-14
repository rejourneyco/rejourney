/**
 * Disposable email domain detection.
 *
 * This list intentionally focuses on common temporary mailbox providers.
 * It is not exhaustive, but catches high-volume abuse patterns with low overhead.
 */

const DISPOSABLE_EMAIL_DOMAINS = new Set([
    '10minutemail.com',
    '10minutemail.net',
    '20minutemail.com',
    '33mail.com',
    'dispostable.com',
    'dropmail.me',
    'emailondeck.com',
    'fakeinbox.com',
    'fakemail.net',
    'getairmail.com',
    'getnada.com',
    'guerrillamail.biz',
    'guerrillamail.com',
    'guerrillamail.de',
    'guerrillamail.net',
    'guerrillamail.org',
    'harakirimail.com',
    'incognitomail.org',
    'mail-temporaire.fr',
    'maildrop.cc',
    'mailinator.com',
    'mailnesia.com',
    'mailsac.com',
    'mintemail.com',
    'moakt.com',
    'my10minutemail.com',
    'mytrashmail.com',
    'nada.email',
    'nospam.ze.tc',
    'nowmymail.com',
    'spambog.com',
    'spambox.us',
    'temp-mail.org',
    'temp-mail.io',
    'tempail.com',
    'tempmail.dev',
    'tempmail.email',
    'tempmail.net',
    'tempr.email',
    'throwaway.email',
    'throwawaymail.com',
    'trashmail.com',
    'trashmail.de',
    'trashmail.io',
    'trashmail.me',
    'yopmail.com',
    'yopmail.fr',
    'yopmail.net',
]);

function normalizeDomain(domain: string): string {
    return domain.trim().toLowerCase();
}

export function getEmailDomain(email: string): string | null {
    const atIndex = email.lastIndexOf('@');
    if (atIndex < 0 || atIndex === email.length - 1) {
        return null;
    }
    return normalizeDomain(email.slice(atIndex + 1));
}

export function isDisposableEmail(email: string): boolean {
    const domain = getEmailDomain(email);
    if (!domain) return false;

    if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
        return true;
    }

    // Catch known disposable domains used via subdomains.
    for (const disposableDomain of DISPOSABLE_EMAIL_DOMAINS) {
        if (domain.endsWith(`.${disposableDomain}`)) {
            return true;
        }
    }

    return false;
}

