/**
 * Deletion Service
 *
 * Centralized hard-delete flows for projects and teams.
 * Ensures S3 assets and Postgres rows are removed deterministically.
 */

import { eq } from 'drizzle-orm';
import {
    db,
    projects,
    apiKeys,
    ingestJobs,
    projectUsage,
    storageEndpoints,
    sessions,
    teams,
    billingUsage,
} from '../db/client.js';
import { deleteProjectAssets } from '../db/s3.js';
import { logger } from '../logger.js';
import { cancelSubscription } from './stripe.js';
import { invalidateSessionCache } from './quotaCheck.js';

export interface ProjectDeletionTarget {
    id: string;
    teamId: string;
    publicKey?: string | null;
    name?: string | null;
}

export interface TeamDeletionResult {
    deletedProjectCount: number;
    hadActiveSubscription: boolean;
    subscriptionCancelled: boolean;
    downgradedToFree: boolean;
}

/**
 * Hard-delete a project and all related data.
 *
 * Safety model:
 * 1) Mark project deleted + revoke keys first (blocks new ingest quickly)
 * 2) Purge S3 objects
 * 3) Delete non-cascading rows, then delete project row
 */
export async function hardDeleteProject(target: ProjectDeletionTarget): Promise<void> {
    const now = new Date();

    // Block new ingest traffic as early as possible.
    await db.update(projects)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(projects.id, target.id));

    await db.update(apiKeys)
        .set({ revokedAt: now })
        .where(eq(apiKeys.projectId, target.id));

    // Delete project files from storage (primary + shadow endpoints).
    await deleteProjectAssets(target.id, target.teamId);

    // Explicitly clean tables that don't have ON DELETE CASCADE.
    await db.transaction(async (tx) => {
        await tx.delete(ingestJobs).where(eq(ingestJobs.projectId, target.id));
        await tx.delete(projectUsage).where(eq(projectUsage.projectId, target.id));
        await tx.delete(storageEndpoints).where(eq(storageEndpoints.projectId, target.id));
        await tx.delete(sessions).where(eq(sessions.projectId, target.id));
        await tx.delete(projects).where(eq(projects.id, target.id));
    });

    logger.info(
        { projectId: target.id, teamId: target.teamId, projectName: target.name },
        'Project hard deleted with S3 and Postgres cleanup'
    );
}

/**
 * Hard-delete a team and all projects under it.
 *
 * If the team has an active subscription, it is canceled immediately first
 * so the team is downgraded to free before deletion and won't auto-charge.
 */
export async function hardDeleteTeam(teamId: string): Promise<TeamDeletionResult> {
    const [team] = await db
        .select({
            id: teams.id,
            stripeSubscriptionId: teams.stripeSubscriptionId,
        })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

    if (!team) {
        throw new Error('Team not found');
    }

    const hadActiveSubscription = Boolean(team.stripeSubscriptionId);
    let subscriptionCancelled = false;

    if (hadActiveSubscription) {
        const cancelled = await cancelSubscription(teamId, true);
        if (!cancelled) {
            throw new Error('Unable to cancel active subscription before team deletion');
        }
        subscriptionCancelled = true;

        // Apply immediate downgrade in our DB without waiting for webhook timing.
        await db.update(teams)
            .set({
                stripeSubscriptionId: null,
                stripePriceId: null,
                paymentFailedAt: null,
                updatedAt: new Date(),
            })
            .where(eq(teams.id, teamId));

        await invalidateSessionCache(teamId);
    }

    const teamProjects = await db
        .select({
            id: projects.id,
            teamId: projects.teamId,
            name: projects.name,
            publicKey: projects.publicKey,
        })
        .from(projects)
        .where(eq(projects.teamId, teamId));

    for (const project of teamProjects) {
        await hardDeleteProject(project);
    }

    // billing_usage.team_id does not cascade, so remove it before deleting team.
    await db.transaction(async (tx) => {
        await tx.delete(billingUsage).where(eq(billingUsage.teamId, teamId));
        await tx.delete(teams).where(eq(teams.id, teamId));
    });

    logger.info(
        {
            teamId,
            deletedProjectCount: teamProjects.length,
            hadActiveSubscription,
            subscriptionCancelled,
        },
        'Team hard deleted with all projects and data cleanup'
    );

    return {
        deletedProjectCount: teamProjects.length,
        hadActiveSubscription,
        subscriptionCancelled,
        downgradedToFree: hadActiveSubscription,
    };
}
