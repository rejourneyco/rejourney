import { createHmac, randomBytes } from 'node:crypto';

import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';

import { config, isProduction } from '../config.js';
import { db, replayShareLinks } from '../db/client.js';
import { constantTimeEqualStrings } from '../utils/secureCompare.js';

export type ReplayShareVisibility = 'replay_only' | 'full_workbench';
export type ReplayShareExpirationPreset = '24h' | '7d' | '30d' | '90d' | 'never';

export type ReplayShareLinkRow = typeof replayShareLinks.$inferSelect;

const SHARE_TOKEN_PREFIX = 'rps_';
const PUBLIC_ID_BYTES = 18;
const TOKEN_PATTERN = /^rps_([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{32,96})$/;

function getShareLinkSecret(): string {
    if (config.SHARE_LINK_SECRET) return config.SHARE_LINK_SECRET;
    if (!isProduction) return config.JWT_SECRET;
    throw new Error('SHARE_LINK_SECRET is required to create or verify replay share links in production');
}

function signShareTokenBody(tokenBody: string): string {
    return createHmac('sha256', getShareLinkSecret())
        .update(tokenBody)
        .digest('base64url');
}

export function generateReplaySharePublicId(): string {
    return randomBytes(PUBLIC_ID_BYTES).toString('base64url');
}

export function buildReplayShareToken(publicId: string): string {
    const tokenBody = `${SHARE_TOKEN_PREFIX}${publicId}`;
    return `${tokenBody}.${signShareTokenBody(tokenBody)}`;
}

export function verifyReplayShareToken(token: string | undefined | null): { publicId: string } | null {
    if (!token || typeof token !== 'string') return null;
    const match = TOKEN_PATTERN.exec(token.trim());
    if (!match) return null;

    const publicId = match[1];
    const providedMac = match[2];
    const expectedMac = signShareTokenBody(`${SHARE_TOKEN_PREFIX}${publicId}`);
    if (!constantTimeEqualStrings(providedMac, expectedMac)) return null;
    return { publicId };
}

export function calculateReplayShareExpiresAt(
    preset: ReplayShareExpirationPreset,
    now: Date = new Date(),
): Date | null {
    if (preset === 'never') return null;
    const msByPreset: Record<Exclude<ReplayShareExpirationPreset, 'never'>, number> = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
        '90d': 90 * 24 * 60 * 60 * 1000,
    };
    return new Date(now.getTime() + msByPreset[preset]);
}

export function isReplayShareLinkActive(link: Pick<ReplayShareLinkRow, 'expiresAt' | 'revokedAt'>, now: Date = new Date()): boolean {
    if (link.revokedAt) return false;
    return !link.expiresAt || link.expiresAt > now;
}

export function buildReplayShareUrl(origin: string, publicId: string): string {
    const normalizedOrigin = origin.replace(/\/+$/, '');
    return `${normalizedOrigin}/share/replay/${buildReplayShareToken(publicId)}`;
}

export function serializeReplayShareLink(link: ReplayShareLinkRow, origin: string) {
    return {
        id: link.id,
        publicId: link.publicId,
        visibility: link.visibility as ReplayShareVisibility,
        expirationPreset: link.expirationPreset as ReplayShareExpirationPreset,
        expiresAt: link.expiresAt?.toISOString() ?? null,
        revokedAt: link.revokedAt?.toISOString() ?? null,
        lastAccessedAt: link.lastAccessedAt?.toISOString() ?? null,
        accessCount: link.accessCount,
        createdAt: link.createdAt.toISOString(),
        updatedAt: link.updatedAt.toISOString(),
        url: buildReplayShareUrl(origin, link.publicId),
    };
}

export async function listReplayShareLinksForSession(sessionId: string, origin: string) {
    const links = await db
        .select()
        .from(replayShareLinks)
        .where(eq(replayShareLinks.sessionId, sessionId))
        .orderBy(desc(replayShareLinks.createdAt));

    return links.map((link) => serializeReplayShareLink(link, origin));
}

export async function createOrReuseReplayShareLink(input: {
    sessionId: string;
    projectId: string;
    teamId: string;
    createdByUserId: string;
    visibility: ReplayShareVisibility;
    expirationPreset: ReplayShareExpirationPreset;
    now?: Date;
}): Promise<{ link: ReplayShareLinkRow; reused: boolean }> {
    const now = input.now ?? new Date();
    const expiresAt = calculateReplayShareExpiresAt(input.expirationPreset, now);
    const [existing] = await db
        .select()
        .from(replayShareLinks)
        .where(and(
            eq(replayShareLinks.sessionId, input.sessionId),
            eq(replayShareLinks.visibility, input.visibility),
            eq(replayShareLinks.expirationPreset, input.expirationPreset),
            isNull(replayShareLinks.revokedAt),
            or(isNull(replayShareLinks.expiresAt), gt(replayShareLinks.expiresAt, now)),
        ))
        .orderBy(desc(replayShareLinks.createdAt))
        .limit(1);

    if (existing) return { link: existing, reused: true };

    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const [created] = await db
                .insert(replayShareLinks)
                .values({
                    publicId: generateReplaySharePublicId(),
                    sessionId: input.sessionId,
                    projectId: input.projectId,
                    teamId: input.teamId,
                    createdByUserId: input.createdByUserId,
                    visibility: input.visibility,
                    expirationPreset: input.expirationPreset,
                    expiresAt,
                    updatedAt: now,
                })
                .returning();
            if (created) return { link: created, reused: false };
        } catch (err: any) {
            if (err?.code === '23505' && String(err?.constraint || '').includes('public')) {
                continue;
            }
            throw err;
        }
    }

    throw new Error('Failed to generate a unique replay share link');
}

export async function resolveReplayShareLink(token: string | undefined | null): Promise<ReplayShareLinkRow | null> {
    const parsed = verifyReplayShareToken(token);
    if (!parsed) return null;

    const [link] = await db
        .select()
        .from(replayShareLinks)
        .where(eq(replayShareLinks.publicId, parsed.publicId))
        .limit(1);

    if (!link || !isReplayShareLinkActive(link)) return null;
    return link;
}

export async function touchReplayShareLink(linkId: string): Promise<void> {
    await db
        .update(replayShareLinks)
        .set({
            lastAccessedAt: new Date(),
            accessCount: sql`${replayShareLinks.accessCount} + 1`,
            updatedAt: new Date(),
        })
        .where(eq(replayShareLinks.id, linkId));
}
