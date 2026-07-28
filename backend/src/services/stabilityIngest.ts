import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { anrs, crashes, db } from '../db/client.js';
import {
    normalizeStabilityIncidentId,
    normalizeStabilityStack,
    scoreStabilityStack,
} from './stabilityAnalytics.js';

type JsonMetadata = Record<string, unknown> | null | undefined;

export type PersistCrashOccurrenceInput = {
    projectId: string;
    sessionId: string | null;
    incidentId?: unknown;
    timestamp: Date;
    exceptionName: string;
    reason?: string | null;
    stackTrace?: string | null;
    fingerprint?: string | null;
    deviceMetadata?: JsonMetadata;
    status?: string;
    occurrenceCount?: number;
};

export type PersistAnrOccurrenceInput = {
    projectId: string;
    sessionId: string | null;
    incidentId?: unknown;
    timestamp: Date;
    durationMs: number;
    threadState?: string | null;
    deviceMetadata?: JsonMetadata;
    status?: string;
    occurrenceCount?: number;
};

export type PersistStabilityOccurrenceResult = {
    id: string;
    inserted: boolean;
    merged: boolean;
};

function mergeMetadata(primary: JsonMetadata, fallback: JsonMetadata): Record<string, unknown> | null {
    const primaryValue = primary && typeof primary === 'object' ? primary : {};
    const fallbackValue = fallback && typeof fallback === 'object' ? fallback : {};
    const merged: Record<string, unknown> = { ...fallbackValue };
    for (const [key, value] of Object.entries(primaryValue)) {
        if (value !== null && value !== undefined && value !== '') {
            merged[key] = value;
        }
    }
    return Object.keys(merged).length > 0 ? merged : null;
}

function earliestTimestamp(left: Date, right: Date): Date {
    return left.getTime() <= right.getTime() ? left : right;
}

function richestStack(current: string | null | undefined, incoming: string | null | undefined): string | null {
    const normalizedCurrent = normalizeStabilityStack(current);
    const normalizedIncoming = normalizeStabilityStack(incoming);
    return scoreStabilityStack(normalizedIncoming) > scoreStabilityStack(normalizedCurrent)
        ? normalizedIncoming
        : normalizedCurrent;
}

async function lockIncident(tx: any, key: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export async function persistCrashOccurrence(
    input: PersistCrashOccurrenceInput,
): Promise<PersistStabilityOccurrenceResult> {
    const incidentId = normalizeStabilityIncidentId(input.incidentId);
    const occurrenceCount = Math.max(1, Math.floor(Number(input.occurrenceCount || 1)));
    const normalizedStack = normalizeStabilityStack(input.stackTrace);
    const lockKey = [
        'stability',
        input.projectId,
        'crash',
        incidentId || input.sessionId || 'no-session',
        incidentId ? '' : input.exceptionName,
    ].join(':');

    return db.transaction(async (tx) => {
        await lockIncident(tx, lockKey);

        let existing: typeof crashes.$inferSelect | undefined;
        if (incidentId) {
            [existing] = await tx
                .select()
                .from(crashes)
                .where(and(
                    eq(crashes.projectId, input.projectId),
                    eq(crashes.incidentId, incidentId),
                ))
                .limit(1);
        } else if (input.sessionId) {
            const minTimestamp = new Date(input.timestamp.getTime() - 1_000);
            const maxTimestamp = new Date(input.timestamp.getTime() + 1_000);
            [existing] = await tx
                .select()
                .from(crashes)
                .where(and(
                    eq(crashes.projectId, input.projectId),
                    eq(crashes.sessionId, input.sessionId),
                    eq(crashes.exceptionName, input.exceptionName),
                    gte(crashes.timestamp, minTimestamp),
                    lte(crashes.timestamp, maxTimestamp),
                    sql`coalesce(${crashes.reason}, '') = ${input.reason || ''}`,
                ))
                .orderBy(desc(crashes.timestamp))
                .limit(1);
        }

        if (existing) {
            await tx
                .update(crashes)
                .set({
                    incidentId: existing.incidentId || incidentId,
                    timestamp: earliestTimestamp(existing.timestamp, input.timestamp),
                    reason: existing.reason || input.reason || null,
                    stackTrace: richestStack(existing.stackTrace, normalizedStack),
                    fingerprint: existing.fingerprint || input.fingerprint || null,
                    deviceMetadata: mergeMetadata(input.deviceMetadata, existing.deviceMetadata as JsonMetadata),
                    status: existing.status === 'open' || input.status === 'open' ? 'open' : existing.status,
                    occurrenceCount: Math.max(existing.occurrenceCount, occurrenceCount),
                    updatedAt: new Date(),
                })
                .where(eq(crashes.id, existing.id));
            return { id: existing.id, inserted: false, merged: true };
        }

        const [inserted] = await tx
            .insert(crashes)
            .values({
                projectId: input.projectId,
                sessionId: input.sessionId,
                incidentId,
                timestamp: input.timestamp,
                exceptionName: input.exceptionName,
                reason: input.reason || null,
                stackTrace: normalizedStack,
                fingerprint: input.fingerprint || null,
                deviceMetadata: mergeMetadata(input.deviceMetadata, null),
                status: input.status || 'open',
                occurrenceCount,
            })
            .onConflictDoNothing()
            .returning({ id: crashes.id });

        if (inserted) return { id: inserted.id, inserted: true, merged: false };

        // A concurrent transaction can win the unique incident-id insert after our
        // initial read. Re-read and report it as a merged occurrence.
        if (incidentId) {
            const [winner] = await tx
                .select({ id: crashes.id })
                .from(crashes)
                .where(and(
                    eq(crashes.projectId, input.projectId),
                    eq(crashes.incidentId, incidentId),
                ))
                .limit(1);
            if (winner) return { id: winner.id, inserted: false, merged: true };
        }
        throw new Error('Crash occurrence insert conflicted without a resolvable incident');
    });
}

export async function persistAnrOccurrence(
    input: PersistAnrOccurrenceInput,
): Promise<PersistStabilityOccurrenceResult> {
    const incidentId = normalizeStabilityIncidentId(input.incidentId);
    const occurrenceCount = Math.max(1, Math.floor(Number(input.occurrenceCount || 1)));
    const normalizedStack = normalizeStabilityStack(input.threadState);
    const lockKey = [
        'stability',
        input.projectId,
        'anr',
        incidentId || input.sessionId || 'no-session',
    ].join(':');

    return db.transaction(async (tx) => {
        await lockIncident(tx, lockKey);

        let existing: typeof anrs.$inferSelect | undefined;
        if (incidentId) {
            [existing] = await tx
                .select()
                .from(anrs)
                .where(and(
                    eq(anrs.projectId, input.projectId),
                    eq(anrs.incidentId, incidentId),
                ))
                .limit(1);
        } else if (input.sessionId) {
            const minTimestamp = new Date(input.timestamp.getTime() - 2_000);
            const maxTimestamp = new Date(input.timestamp.getTime() + 2_000);
            [existing] = await tx
                .select()
                .from(anrs)
                .where(and(
                    eq(anrs.projectId, input.projectId),
                    eq(anrs.sessionId, input.sessionId),
                    gte(anrs.timestamp, minTimestamp),
                    lte(anrs.timestamp, maxTimestamp),
                    sql`abs(coalesce(${anrs.durationMs}, 0) - ${input.durationMs}) <= 500`,
                ))
                .orderBy(desc(anrs.timestamp))
                .limit(1);
        }

        if (existing) {
            await tx
                .update(anrs)
                .set({
                    incidentId: existing.incidentId || incidentId,
                    timestamp: earliestTimestamp(existing.timestamp, input.timestamp),
                    durationMs: Math.max(existing.durationMs, input.durationMs),
                    threadState: richestStack(existing.threadState, normalizedStack),
                    deviceMetadata: mergeMetadata(input.deviceMetadata, existing.deviceMetadata as JsonMetadata),
                    status: existing.status === 'open' || input.status === 'open' ? 'open' : existing.status,
                    occurrenceCount: Math.max(existing.occurrenceCount, occurrenceCount),
                    updatedAt: new Date(),
                })
                .where(eq(anrs.id, existing.id));
            return { id: existing.id, inserted: false, merged: true };
        }

        const [inserted] = await tx
            .insert(anrs)
            .values({
                projectId: input.projectId,
                sessionId: input.sessionId,
                incidentId,
                timestamp: input.timestamp,
                durationMs: input.durationMs,
                threadState: normalizedStack,
                deviceMetadata: mergeMetadata(input.deviceMetadata, null),
                status: input.status || 'open',
                occurrenceCount,
            })
            .onConflictDoNothing()
            .returning({ id: anrs.id });

        if (inserted) return { id: inserted.id, inserted: true, merged: false };

        if (incidentId) {
            const [winner] = await tx
                .select({ id: anrs.id })
                .from(anrs)
                .where(and(
                    eq(anrs.projectId, input.projectId),
                    eq(anrs.incidentId, incidentId),
                ))
                .limit(1);
            if (winner) return { id: winner.id, inserted: false, merged: true };
        }
        throw new Error('ANR occurrence insert conflicted without a resolvable incident');
    });
}
