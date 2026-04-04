import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { db, ingestJobs, recordingArtifacts } from '../db/client.js';

export type ArtifactJobRecord = typeof ingestJobs.$inferSelect;

export type ArtifactQueueConfig = {
    allowedKinds: string[];
    batchSize: number;
    jobProcessConcurrency: number;
    kindPriority: Map<string, number>;
    maxAttempts: number;
    maxRunnablePerSession: number;
    workerId: string;
};

type CreateArtifactQueueConfigOptions = {
    allowedKinds: string[];
    defaultBatchSize: number;
    defaultJobProcessConcurrency: number;
    defaultMaxRunnablePerSession: number;
    kindPriority: string[];
    maxAttempts?: number;
    workerId: string;
};

function parsePositiveInt(value: string | undefined, fallback: number, minimum = 1): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, Math.trunc(parsed));
}

export function createArtifactQueueConfig(options: CreateArtifactQueueConfigOptions): ArtifactQueueConfig {
    return {
        allowedKinds: options.allowedKinds,
        batchSize: parsePositiveInt(process.env.RJ_INGEST_BATCH_SIZE, options.defaultBatchSize),
        jobProcessConcurrency: parsePositiveInt(process.env.RJ_INGEST_JOB_CONCURRENCY, options.defaultJobProcessConcurrency),
        kindPriority: new Map(options.kindPriority.map((kind, index) => [kind, index])),
        maxAttempts: options.maxAttempts ?? 5,
        maxRunnablePerSession: parsePositiveInt(
            process.env.RJ_INGEST_MAX_RUNNABLE_PER_SESSION,
            options.defaultMaxRunnablePerSession,
        ),
        workerId: options.workerId,
    };
}

export function getArtifactKindPriority(config: Pick<ArtifactQueueConfig, 'kindPriority'>, kind: string | null | undefined): number {
    if (!kind) return config.kindPriority.size + 1;
    return config.kindPriority.get(kind) ?? (config.kindPriority.size + 1);
}

export function sortArtifactJobsByPriority(
    jobs: ArtifactJobRecord[],
    config: Pick<ArtifactQueueConfig, 'kindPriority'>,
): ArtifactJobRecord[] {
    return [...jobs].sort((left, right) => {
        const priorityDelta = getArtifactKindPriority(config, left.kind) - getArtifactKindPriority(config, right.kind);
        if (priorityDelta !== 0) return priorityDelta;
        return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
}

export function applyPerSessionRunnableLimit(
    jobs: ArtifactJobRecord[],
    maxRunnablePerSession: number,
): ArtifactJobRecord[] {
    const perSessionCounts = new Map<string, number>();

    return jobs.filter((job) => {
        const key = job.sessionId || `job:${job.id}`;
        const currentCount = perSessionCounts.get(key) ?? 0;
        if (currentCount >= maxRunnablePerSession) return false;
        perSessionCounts.set(key, currentCount + 1);
        return true;
    });
}

export async function loadPendingArtifactJobBatch(config: Pick<ArtifactQueueConfig, 'allowedKinds' | 'batchSize'>): Promise<ArtifactJobRecord[]> {
    const jobs = await db
        .select({ job: ingestJobs })
        .from(ingestJobs)
        .innerJoin(recordingArtifacts, eq(recordingArtifacts.id, ingestJobs.artifactId))
        .where(
            and(
                eq(ingestJobs.status, 'pending'),
                config.allowedKinds.length > 0
                    ? sql`${ingestJobs.kind} in (${sql.join(config.allowedKinds.map((kind) => sql`${kind}`), sql`, `)})`
                    : sql`true`,
                sql`${recordingArtifacts.status} in ('uploaded', 'ready')`,
                or(
                    isNull(ingestJobs.nextRunAt),
                    lte(ingestJobs.nextRunAt, new Date()),
                ),
            ),
        )
        .orderBy(asc(ingestJobs.createdAt))
        .limit(config.batchSize);

    return jobs.map((row) => row.job);
}

export async function selectRunnableArtifactJobs(config: Pick<ArtifactQueueConfig, 'allowedKinds' | 'batchSize' | 'kindPriority' | 'maxRunnablePerSession'>): Promise<ArtifactJobRecord[]> {
    const jobs = await loadPendingArtifactJobBatch(config);
    return applyPerSessionRunnableLimit(sortArtifactJobsByPriority(jobs, config), config.maxRunnablePerSession);
}

export async function markArtifactJobProcessing(
    jobId: string,
    options: {
        attemptNumber: number;
        startedAt: Date;
        workerId: string;
    },
): Promise<void> {
    await db.update(ingestJobs)
        .set({
            status: 'processing',
            attempts: options.attemptNumber,
            startedAt: options.startedAt,
            workerId: options.workerId,
            updatedAt: options.startedAt,
        })
        .where(eq(ingestJobs.id, jobId));
}

export async function markArtifactJobDone(jobId: string, completedAt: Date): Promise<void> {
    await db.update(ingestJobs)
        .set({ status: 'done', completedAt, updatedAt: completedAt })
        .where(eq(ingestJobs.id, jobId));
}

export async function recoverStuckArtifactJobs(): Promise<number> {
    const result = await db.update(ingestJobs)
        .set({ status: 'pending', updatedAt: new Date(), startedAt: null, workerId: null })
        .where(eq(ingestJobs.status, 'processing'));
    return (result as { rowCount?: number }).rowCount ?? 0;
}

export async function scheduleArtifactJobRetry(options: {
    artifactId: string | null | undefined;
    attemptNumber: number;
    errorMsg: string;
    jobId: string;
    log: { warn: (...args: any[]) => void };
    maxAttempts: number;
    kind?: string | null;
    sessionId?: string | null;
}): Promise<void> {
    if (options.attemptNumber >= options.maxAttempts) {
        await db.update(ingestJobs)
            .set({ status: 'dlq', errorMsg: options.errorMsg, completedAt: new Date(), updatedAt: new Date() })
            .where(eq(ingestJobs.id, options.jobId));
        if (options.artifactId) {
            await db.update(recordingArtifacts)
                .set({ status: 'failed' })
                .where(eq(recordingArtifacts.id, options.artifactId));
        }
        options.log.warn(
            {
                event: 'ingest.artifact_job_dlq',
                replayArtifact: options.kind === 'screenshots' || options.kind === 'hierarchy',
                jobId: options.jobId,
                artifactId: options.artifactId,
                sessionId: options.sessionId,
                kind: options.kind,
                attemptNumber: options.attemptNumber,
                maxAttempts: options.maxAttempts,
                errorMsgPreview: options.errorMsg?.slice(0, 400),
            },
            'ingest.artifact_job_dlq',
        );
        return;
    }

    const nextRunAt = new Date(Date.now() + Math.pow(2, options.attemptNumber) * 1000);
    await db.update(ingestJobs)
        .set({ status: 'pending', nextRunAt, errorMsg: options.errorMsg })
        .where(eq(ingestJobs.id, options.jobId));

    options.log.warn(
        {
            event: 'ingest.artifact_job_retry_scheduled',
            attemptNumber: options.attemptNumber,
            maxAttempts: options.maxAttempts,
            nextRunAt,
            kind: options.kind,
            sessionId: options.sessionId,
            errorMsgPreview: options.errorMsg?.slice(0, 400),
        },
        'ingest.artifact_job_retry_scheduled',
    );
}
