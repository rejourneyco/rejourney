import { eq, inArray } from 'drizzle-orm';
import { db, projects, retentionPolicies, sessions, teams } from '../db/client.js';

export const FREE_VIDEO_RETENTION_TIER = 1;

const FALLBACK_RETENTION_DAYS_BY_TIER: Record<number, number> = {
    1: 7,
    2: 14,
    3: 30,
    4: 60,
    5: 3650,
    6: 36500,
};

export interface VideoRetentionDetails {
    tier: number;
    days: number;
    label: string;
}

function formatVideoRetentionLabel(days: number): string {
    if (days % 365 === 0) {
        const years = days / 365;
        return `${years} year${years === 1 ? '' : 's'}`;
    }

    return `${days} day${days === 1 ? '' : 's'}`;
}

export function normalizeVideoRetentionTier(tier: number | null | undefined): number {
    if (!tier || tier < FREE_VIDEO_RETENTION_TIER) {
        return FREE_VIDEO_RETENTION_TIER;
    }

    return tier;
}

export function parseVideoRetentionTier(rawTier: string | null | undefined): number | null {
    if (!rawTier) return null;

    const parsed = Number.parseInt(rawTier, 10);
    if (!Number.isFinite(parsed) || parsed < FREE_VIDEO_RETENTION_TIER) {
        return null;
    }

    return parsed;
}

export async function getVideoRetentionDetailsForTier(
    tier: number | null | undefined
): Promise<VideoRetentionDetails> {
    const normalizedTier = normalizeVideoRetentionTier(tier);

    const [policy] = await db
        .select({
            retentionDays: retentionPolicies.retentionDays,
        })
        .from(retentionPolicies)
        .where(eq(retentionPolicies.tier, normalizedTier))
        .limit(1);

    const days = policy?.retentionDays ?? FALLBACK_RETENTION_DAYS_BY_TIER[normalizedTier] ?? FALLBACK_RETENTION_DAYS_BY_TIER[FREE_VIDEO_RETENTION_TIER];

    return {
        tier: normalizedTier,
        days,
        label: formatVideoRetentionLabel(days),
    };
}

export async function syncTeamVideoRetention(
    teamId: string,
    tier: number | null | undefined,
    options?: {
        backfillSessions?: boolean;
    }
): Promise<VideoRetentionDetails> {
    const details = await getVideoRetentionDetailsForTier(tier);

    await db
        .update(teams)
        .set({
            retentionTier: details.tier,
            updatedAt: new Date(),
        })
        .where(eq(teams.id, teamId));

    if (options?.backfillSessions) {
        const teamProjects = await db
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.teamId, teamId));

        const projectIds = teamProjects.map((project) => project.id);

        if (projectIds.length > 0) {
            await db
                .update(sessions)
                .set({
                    retentionTier: details.tier,
                    retentionDays: details.days,
                    updatedAt: new Date(),
                })
                .where(inArray(sessions.projectId, projectIds));
        }
    }

    return details;
}
