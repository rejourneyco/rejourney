import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, users } from '../db/client.js';
import { checkRateLimit, getRedis } from '../db/redis.js';
import { ApiError } from '../middleware/errorHandler.js';
import { logger } from '../logger.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const NEW_ACCOUNT_RESTRICTION_MS = 72 * ONE_HOUR_MS;

const CREDENTIAL_STUFFING_MAX_DISTINCT_EMAILS_PER_IP = 12;
const CREDENTIAL_STUFFING_MAX_DISTINCT_IPS_PER_EMAIL = 15;
const CREDENTIAL_STUFFING_MAX_IP_FAILURES = 60;
const CREDENTIAL_STUFFING_IP_WINDOW_SECONDS = 15 * 60;
const CREDENTIAL_STUFFING_EMAIL_WINDOW_SECONDS = 30 * 60;

type NewAccountAction = 'team_create' | 'project_create' | 'invite_send' | 'api_key_create';

const NEW_ACCOUNT_ACTION_RULES: Record<
    NewAccountAction,
    {
        label: string;
        shortWindowMs: number;
        shortMax: number;
        longWindowMs: number;
        longMax: number;
    }
> = {
    team_create: {
        label: 'team creation',
        shortWindowMs: ONE_HOUR_MS,
        shortMax: 2,
        longWindowMs: ONE_DAY_MS,
        longMax: 4,
    },
    project_create: {
        label: 'project creation',
        shortWindowMs: ONE_HOUR_MS,
        shortMax: 6,
        longWindowMs: ONE_DAY_MS,
        longMax: 20,
    },
    invite_send: {
        label: 'team invitations',
        shortWindowMs: ONE_HOUR_MS,
        shortMax: 8,
        longWindowMs: ONE_DAY_MS,
        longMax: 30,
    },
    api_key_create: {
        label: 'API key creation',
        shortWindowMs: ONE_HOUR_MS,
        shortMax: 10,
        longWindowMs: ONE_DAY_MS,
        longMax: 40,
    },
};

function hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function normalizeIp(ip?: string | null): string | null {
    const normalized = ip?.trim();
    return normalized ? normalized : null;
}

function normalizeContent(content: string): string {
    return content.trim().toLowerCase().replace(/\s+/g, ' ');
}

function looksLikeDomain(value: string): boolean {
    return /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(value);
}

function extractLinkCandidates(contentParts: string[]): string[] {
    const links = new Set<string>();

    for (const part of contentParts) {
        const trimmed = part.trim().toLowerCase();
        if (!trimmed || trimmed.includes(' ')) continue;

        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            try {
                const parsed = new URL(trimmed);
                if (parsed.hostname) {
                    links.add(parsed.hostname.toLowerCase());
                }
            } catch {
                // Ignore malformed URL candidates.
            }
            continue;
        }

        if (!trimmed.includes('@') && looksLikeDomain(trimmed)) {
            links.add(trimmed);
        }
    }

    return Array.from(links);
}

async function trackDistinctTarget(
    key: string,
    targetId: string,
    windowMs: number
): Promise<number | null> {
    try {
        const redis = getRedis();
        await redis.sadd(key, targetId);
        await redis.expire(key, Math.max(1, Math.ceil(windowMs / 1000)));
        return await redis.scard(key);
    } catch (err) {
        logger.warn({ err, key }, 'Failed to track distinct target for abuse detection');
        return null;
    }
}

export async function enforceAccountCreationVelocity(params: {
    ip?: string | null;
    fingerprint?: string | null;
}): Promise<void> {
    const checks: Promise<{ allowed: boolean; remaining: number; resetAt: number }>[] = [];
    const ip = normalizeIp(params.ip);

    if (ip) {
        checks.push(checkRateLimit(`abuse:signup:ip:${ip}:short`, 10 * 60 * 1000, 3));
        checks.push(checkRateLimit(`abuse:signup:ip:${ip}:daily`, ONE_DAY_MS, 8));
    }

    if (params.fingerprint) {
        const fingerprintHash = hashValue(params.fingerprint.trim().toLowerCase());
        checks.push(checkRateLimit(`abuse:signup:fingerprint:${fingerprintHash}:daily`, ONE_DAY_MS, 5));
    }

    if (checks.length === 0) return;

    const results = await Promise.all(checks);
    if (results.some((r) => !r.allowed)) {
        throw ApiError.tooManyRequests(
            'Too many account creations from this device or network. Please try again later.'
        );
    }
}

export async function enforceCredentialStuffingGuards(params: {
    email: string;
    ip?: string | null;
}): Promise<void> {
    const ip = normalizeIp(params.ip);
    const email = normalizeEmail(params.email);
    const emailHash = hashValue(email);

    try {
        const redis = getRedis();

        const ipSetKey = ip ? `abuse:auth:ip:${ip}:emails` : null;
        const emailSetKey = `abuse:auth:email:${emailHash}:ips`;
        const ipFailureKey = ip ? `abuse:auth:ip:${ip}:failures` : null;

        const [
            distinctEmailsFromIpRaw,
            distinctIpsForEmailRaw,
            ipFailuresRaw,
        ] = await Promise.all([
            ipSetKey ? redis.scard(ipSetKey) : Promise.resolve(0),
            redis.scard(emailSetKey),
            ipFailureKey ? redis.get(ipFailureKey) : Promise.resolve('0'),
        ]);

        const distinctEmailsFromIp = Number(distinctEmailsFromIpRaw || 0);
        const distinctIpsForEmail = Number(distinctIpsForEmailRaw || 0);
        const ipFailures = Number(ipFailuresRaw || 0);

        if (distinctEmailsFromIp >= CREDENTIAL_STUFFING_MAX_DISTINCT_EMAILS_PER_IP) {
            throw ApiError.tooManyRequests('Suspicious login traffic detected from this IP. Please try again later.');
        }

        if (distinctIpsForEmail >= CREDENTIAL_STUFFING_MAX_DISTINCT_IPS_PER_EMAIL) {
            throw ApiError.tooManyRequests('Too many login attempts for this account from multiple IPs.');
        }

        if (ipFailures >= CREDENTIAL_STUFFING_MAX_IP_FAILURES) {
            throw ApiError.tooManyRequests('Too many failed login attempts from this IP. Please try again later.');
        }
    } catch (err) {
        if (err instanceof ApiError) {
            throw err;
        }
        logger.warn({ err }, 'Credential stuffing guard failed open');
    }
}

export async function recordFailedAuthAttempt(params: {
    email: string;
    ip?: string | null;
}): Promise<void> {
    const ip = normalizeIp(params.ip);
    const email = normalizeEmail(params.email);
    const emailHash = hashValue(email);

    try {
        const redis = getRedis();
        const pipeline = redis.pipeline();

        if (ip) {
            const ipSetKey = `abuse:auth:ip:${ip}:emails`;
            const ipFailureKey = `abuse:auth:ip:${ip}:failures`;

            pipeline.sadd(ipSetKey, emailHash);
            pipeline.expire(ipSetKey, CREDENTIAL_STUFFING_IP_WINDOW_SECONDS);
            pipeline.incr(ipFailureKey);
            pipeline.expire(ipFailureKey, CREDENTIAL_STUFFING_IP_WINDOW_SECONDS);
        }

        const emailSetKey = `abuse:auth:email:${emailHash}:ips`;
        pipeline.sadd(emailSetKey, ip || 'unknown');
        pipeline.expire(emailSetKey, CREDENTIAL_STUFFING_EMAIL_WINDOW_SECONDS);

        await pipeline.exec();
    } catch (err) {
        logger.warn({ err }, 'Failed to record auth failure for abuse detection');
    }
}

export async function enforceNewAccountActionLimit(params: {
    userId: string;
    action: NewAccountAction;
}): Promise<void> {
    const [user] = await db
        .select({ createdAt: users.createdAt })
        .from(users)
        .where(eq(users.id, params.userId))
        .limit(1);

    if (!user) return;

    const accountAgeMs = Date.now() - user.createdAt.getTime();
    if (accountAgeMs > NEW_ACCOUNT_RESTRICTION_MS) {
        return;
    }

    const rule = NEW_ACCOUNT_ACTION_RULES[params.action];
    const [shortWindow, longWindow] = await Promise.all([
        checkRateLimit(`abuse:new-account:${params.action}:short:${params.userId}`, rule.shortWindowMs, rule.shortMax),
        checkRateLimit(`abuse:new-account:${params.action}:long:${params.userId}`, rule.longWindowMs, rule.longMax),
    ]);

    if (!shortWindow.allowed || !longWindow.allowed) {
        throw ApiError.tooManyRequests(
            `New accounts are temporarily limited for ${rule.label} during the first 72 hours.`
        );
    }
}

export async function assertNoDuplicateContentSpam(params: {
    actorId: string;
    action: string;
    contentParts: Array<string | null | undefined>;
    targetId?: string;
    windowMs?: number;
    maxIdenticalInWindow?: number;
    maxIdenticalTargets?: number;
    maxLinkRepeatsInWindow?: number;
    maxLinkTargets?: number;
    checkLinks?: boolean;
}): Promise<void> {
    const windowMs = params.windowMs ?? 30 * 60 * 1000;
    const maxIdenticalInWindow = params.maxIdenticalInWindow ?? 8;
    const maxIdenticalTargets = params.maxIdenticalTargets ?? 4;
    const maxLinkRepeatsInWindow = params.maxLinkRepeatsInWindow ?? 12;
    const maxLinkTargets = params.maxLinkTargets ?? 6;
    const checkLinks = params.checkLinks !== false;

    const normalizedParts = params.contentParts
        .filter((v): v is string => typeof v === 'string')
        .map((v) => normalizeContent(v))
        .filter((v) => v.length > 0);

    if (normalizedParts.length === 0) {
        return;
    }

    const signature = hashValue(normalizedParts.join('|'));
    const contentRate = await checkRateLimit(
        `abuse:content:${params.action}:${params.actorId}:${signature}`,
        windowMs,
        maxIdenticalInWindow
    );

    if (!contentRate.allowed) {
        throw ApiError.tooManyRequests('Repeated identical content detected. Please slow down.');
    }

    if (params.targetId) {
        const distinctTargets = await trackDistinctTarget(
            `abuse:content-targets:${params.action}:${params.actorId}:${signature}`,
            params.targetId,
            windowMs
        );

        if (distinctTargets !== null && distinctTargets > maxIdenticalTargets) {
            throw ApiError.tooManyRequests(
                'Repeated identical content across many targets detected. Please slow down.'
            );
        }
    }

    if (!checkLinks) {
        return;
    }

    const links = extractLinkCandidates(normalizedParts);
    for (const link of links) {
        const linkHash = hashValue(link);
        const linkRate = await checkRateLimit(
            `abuse:links:${params.action}:${params.actorId}:${linkHash}`,
            windowMs,
            maxLinkRepeatsInWindow
        );

        if (!linkRate.allowed) {
            throw ApiError.tooManyRequests('Repeated link posting detected. Please slow down.');
        }

        if (params.targetId) {
            const distinctLinkTargets = await trackDistinctTarget(
                `abuse:link-targets:${params.action}:${params.actorId}:${linkHash}`,
                params.targetId,
                windowMs
            );

            if (distinctLinkTargets !== null && distinctLinkTargets > maxLinkTargets) {
                throw ApiError.tooManyRequests(
                    'Repeated links across many targets detected. Please slow down.'
                );
            }
        }
    }
}

