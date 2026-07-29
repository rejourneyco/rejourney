import crypto from 'node:crypto';
import { config } from '../config.js';
import { pool } from '../db/client.js';
import { logger } from '../logger.js';
import { discardSmartCaptureVisualArtifacts } from './smartCapture.js';

const REVENUE_EVENTS = new Set(['purchase_complete', 'purchase_completed', 'purchase', 'order_completed', 'checkout_completed', 'subscription_start', 'subscription_started']);
const REFUND_EVENTS = new Set(['refund', 'refund_processed', 'purchase_refunded']);
const RENEWAL_EVENTS = new Set(['renewal', 'subscription_renewed', 'renewal_completed']);
const CANCELLATION_EVENTS = new Set(['cancellation', 'subscription_cancelled', 'subscription_canceled', 'cancel_confirmed']);

export type ResearchLakeV2SessionInput = {
    id: string;
    projectId: string;
    startedAt: Date;
    platform?: string | null;
    appVersion?: string | null;
    deviceId?: string | null;
    anonymousHash?: string | null;
    userDisplayId?: string | null;
    events?: unknown;
    isSampledIn?: boolean | null;
};

export type ResearchLakeV2ProjectInput = {
    id: string;
    teamId: string;
    sampleRate?: number | null;
};

export type ResearchLakeV2CaptureInput = {
    status: string;
    reason: string | null;
    ruleId: string | null;
    shouldDiscardVisualArtifacts: boolean;
};

export type ResearchLakeV2CaptureTier = 'spine' | 'uniform' | 'selected' | 'metadata_only';

type ExistingOutcomeSummary = {
    eventFamilies: string[];
    revenueAmountBucket: number | null;
    refundCount: number;
    renewalCount: number;
    cancellationCount: number;
};

let schemaActivationCache: { checkedAt: number; active: boolean } | null = null;

function hashSecret(): string {
    return config.RESEARCH_LAKE_HASH_SECRET || config.SHARE_LINK_SECRET || config.JWT_SECRET;
}

export async function isResearchLakeV2SchemaActive(): Promise<boolean> {
    const now = Date.now();
    if (schemaActivationCache && now - schemaActivationCache.checkedAt < 30_000) {
        return schemaActivationCache.active;
    }
    const result = await pool.query<{ active: boolean }>(
        `
        SELECT
            to_regclass('public.research_extraction_jobs_session_lake_unique') IS NULL
            AND EXISTS (
                SELECT 1
                FROM pg_index
                WHERE indexrelid = to_regclass('public.research_extraction_jobs_session_lake_schema_unique')
                  AND indisvalid AND indisready AND indisunique
            ) AS active
        `,
    );
    const active = Boolean(result.rows[0]?.active);
    schemaActivationCache = { checkedAt: now, active };
    return active;
}

function hmac(value: string, length = 32): string {
    return crypto.createHmac('sha256', hashSecret()).update(value).digest('hex').slice(0, length);
}

function quarantinedProjectIds(): Set<string> {
    return new Set(config.RESEARCH_LAKE_V2_QUARANTINED_PROJECT_IDS.split(',').map((value) => value.trim()).filter(Boolean));
}

function boundedRate(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(10_000, Math.trunc(value)));
}

export function researchLakeV2SamplingBucket(projectId: string, sessionId: string, policyVersion: number): number {
    const digest = crypto.createHmac('sha256', hashSecret())
        .update(`research-v2:${policyVersion}:${projectId}:${sessionId}`)
        .digest();
    return digest.readUInt32BE(0) % 10_000;
}

export function researchLakeV2CaptureTier(
    bucket: number,
    smartCaptureStatus: string,
): {
    tier: ResearchLakeV2CaptureTier;
    inclusionProbabilityPpm: number;
    tierAssignmentProbabilityPpm: number;
} {
    const spineBps = boundedRate(config.RESEARCH_LAKE_V2_SPINE_RATE_BPS, 300);
    const uniformBps = Math.min(
        10_000 - spineBps,
        boundedRate(config.RESEARCH_LAKE_V2_UNIFORM_RATE_BPS, 200),
    );
    const researchSampleProbabilityPpm = (spineBps + uniformBps) * 100;
    const remainderProbabilityPpm = (10_000 - spineBps - uniformBps) * 100;
    const smartCaptureSelected = smartCaptureStatus === 'kept' || smartCaptureStatus === 'not_applicable';
    const visualInclusionProbabilityPpm = smartCaptureSelected
        ? 1_000_000
        : researchSampleProbabilityPpm;
    if (bucket < spineBps) {
        return {
            tier: 'spine',
            inclusionProbabilityPpm: visualInclusionProbabilityPpm,
            tierAssignmentProbabilityPpm: spineBps * 100,
        };
    }
    if (bucket < spineBps + uniformBps) {
        return {
            tier: 'uniform',
            inclusionProbabilityPpm: visualInclusionProbabilityPpm,
            tierAssignmentProbabilityPpm: uniformBps * 100,
        };
    }
    if (smartCaptureSelected) {
        return {
            tier: 'selected',
            inclusionProbabilityPpm: 1_000_000,
            tierAssignmentProbabilityPpm: remainderProbabilityPpm,
        };
    }
    return {
        tier: 'metadata_only',
        inclusionProbabilityPpm: 0,
        tierAssignmentProbabilityPpm: remainderProbabilityPpm,
    };
}

function eventRecords(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)));
}

function normalizedEventName(event: Record<string, unknown>): string {
    const raw = event.name ?? event.eventName ?? event.event_name ?? event.type;
    return typeof raw === 'string' ? raw.trim().toLowerCase().replace(/[\s.-]+/g, '_') : '';
}

function eventProperties(event: Record<string, unknown>): Record<string, unknown> {
    const raw = event.properties ?? event.payload;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function numericValue(value: unknown): number | null {
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(numeric) ? numeric : null;
}

function bucketMoney(value: number): number {
    const bounded = Math.max(0, Math.min(1_000_000, value));
    const step = bounded <= 200 ? 10 : bounded <= 1_000 ? 50 : 100;
    return Math.round(bounded / step) * step;
}

export function summarizeExistingV2Outcomes(events: unknown): ExistingOutcomeSummary {
    const families = new Set<string>();
    let revenue = 0;
    let sawRevenue = false;
    let refundCount = 0;
    let renewalCount = 0;
    let cancellationCount = 0;

    for (const event of eventRecords(events)) {
        const name = normalizedEventName(event);
        if (!name) continue;
        const props = eventProperties(event);
        if (REVENUE_EVENTS.has(name)) {
            families.add('revenue');
            const amount = numericValue(props.value ?? props.amount ?? props.price ?? event.value ?? event.amount ?? event.price);
            if (amount !== null && amount >= 0) {
                revenue += amount;
                sawRevenue = true;
            }
            if (props.isRenewal === true || props.is_renewal === true) renewalCount++;
        }
        if (REFUND_EVENTS.has(name)) {
            families.add('refund');
            refundCount++;
        }
        if (RENEWAL_EVENTS.has(name)) {
            families.add('renewal');
            renewalCount++;
        }
        if (CANCELLATION_EVENTS.has(name)) {
            families.add('cancellation');
            cancellationCount++;
        }
    }

    return {
        eventFamilies: [...families].sort(),
        revenueAmountBucket: sawRevenue ? bucketMoney(revenue) : null,
        refundCount,
        renewalCount,
        cancellationCount,
    };
}

function panelKeyForSession(session: ResearchLakeV2SessionInput): string | null {
    const identity = [session.deviceId, session.anonymousHash, session.userDisplayId]
        .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
        ?.trim();
    return identity ? hmac(`panel:${session.projectId}:${identity}`, 40) : null;
}

export async function prepareResearchLakeV2Session(params: {
    session: ResearchLakeV2SessionInput;
    project: ResearchLakeV2ProjectInput;
    capture: ResearchLakeV2CaptureInput;
    hasReplayArtifacts: boolean;
    jobLane?: 'fresh' | 'backfill';
    now?: Date;
}): Promise<{
    preserveVisualArtifacts: boolean;
    interactionJobCreated: boolean;
    tier: ResearchLakeV2CaptureTier;
} | null> {
    if (!config.RESEARCH_LAKE_V2_ENABLED) return null;
    if (!await isResearchLakeV2SchemaActive()) return null;

    const now = params.now ?? new Date();
    const policyVersion = Math.max(1, Math.trunc(config.RESEARCH_LAKE_V2_POLICY_VERSION));
    const samplingBucket = researchLakeV2SamplingBucket(params.project.id, params.session.id, policyVersion);
    const {
        tier,
        inclusionProbabilityPpm,
        tierAssignmentProbabilityPpm,
    } = researchLakeV2CaptureTier(samplingBucket, params.capture.status);
    const preserveVisualArtifacts = params.hasReplayArtifacts
        && params.capture.shouldDiscardVisualArtifacts
        && tier !== 'metadata_only';
    const cleanupDueAt = preserveVisualArtifacts
        ? new Date(now.getTime() + Math.max(1, config.RESEARCH_LAKE_V2_VISUAL_HOLD_HOURS) * 60 * 60 * 1000)
        : null;
    const outcomes = summarizeExistingV2Outcomes(params.session.events);
    const panelKey = panelKeyForSession(params.session);
    const expiresAt = new Date(now.getTime() + Math.max(31, config.RESEARCH_LAKE_V2_PANEL_TTL_DAYS) * 24 * 60 * 60 * 1000);
    const sourceSampleRateBps = params.session.isSampledIn === false
        ? 0
        : Math.max(0, Math.min(10_000, Math.round(Number(params.project.sampleRate ?? 100) * 100)));
    const smartCaptureRuleKey = params.capture.ruleId
        ? hmac(`smart-capture-rule:${params.project.id}:${params.capture.ruleId}`, 32)
        : null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `
            INSERT INTO research_capture_decisions (
                session_id, project_id, team_id, schema_version, policy_version,
                sampling_bucket, capture_tier, inclusion_probability_ppm,
                tier_assignment_probability_ppm, source_sample_rate_bps,
                smart_capture_status, smart_capture_reason, smart_capture_rule_key,
                smart_capture_would_discard, preserve_visual_source, source_cleanup_state,
                evaluation_quarantined, source_cleanup_due_at, decided_at, updated_at
            ) VALUES ($1, $2, $3, 2, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)
            ON CONFLICT (session_id, schema_version) DO UPDATE SET
                policy_version = EXCLUDED.policy_version,
                sampling_bucket = EXCLUDED.sampling_bucket,
                capture_tier = EXCLUDED.capture_tier,
                inclusion_probability_ppm = EXCLUDED.inclusion_probability_ppm,
                tier_assignment_probability_ppm = EXCLUDED.tier_assignment_probability_ppm,
                source_sample_rate_bps = EXCLUDED.source_sample_rate_bps,
                smart_capture_status = EXCLUDED.smart_capture_status,
                smart_capture_reason = EXCLUDED.smart_capture_reason,
                smart_capture_rule_key = EXCLUDED.smart_capture_rule_key,
                smart_capture_would_discard = EXCLUDED.smart_capture_would_discard,
                preserve_visual_source = research_capture_decisions.preserve_visual_source OR EXCLUDED.preserve_visual_source,
                source_cleanup_state = CASE
                    WHEN research_capture_decisions.source_cleanup_state = 'exported_and_cleaned' THEN research_capture_decisions.source_cleanup_state
                    ELSE EXCLUDED.source_cleanup_state
                END,
                source_cleanup_due_at = COALESCE(research_capture_decisions.source_cleanup_due_at, EXCLUDED.source_cleanup_due_at),
                updated_at = EXCLUDED.updated_at
            `,
            [
                params.session.id,
                params.project.id,
                params.project.teamId,
                policyVersion,
                samplingBucket,
                tier,
                inclusionProbabilityPpm,
                tierAssignmentProbabilityPpm,
                sourceSampleRateBps,
                params.capture.status,
                params.capture.reason,
                smartCaptureRuleKey,
                params.capture.shouldDiscardVisualArtifacts,
                preserveVisualArtifacts,
                preserveVisualArtifacts ? 'pending_export' : 'not_required',
                quarantinedProjectIds().has(params.project.id),
                cleanupDueAt,
                now,
            ],
        );

        const panelInsert = await client.query(
            `
            INSERT INTO research_panel_observations (
                session_id, project_id, panel_key, started_at, event_families,
                revenue_amount_bucket, refund_count, renewal_count, cancellation_count, expires_at
            ) VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10)
            ON CONFLICT (session_id) DO NOTHING
            `,
            [
                params.session.id,
                params.project.id,
                panelKey,
                params.session.startedAt,
                outcomes.eventFamilies,
                outcomes.revenueAmountBucket,
                outcomes.refundCount,
                outcomes.renewalCount,
                outcomes.cancellationCount,
                expiresAt,
            ],
        );

        const jobs: Array<{ lakeType: string; dueAt: Date }> = [
            { lakeType: 'behavioral_outcomes', dueAt: now },
            { lakeType: 'forward_outcomes', dueAt: new Date(params.session.startedAt.getTime() + 31 * 24 * 60 * 60 * 1000) },
        ];
        const shouldCreateInteractionJob = params.hasReplayArtifacts && tier !== 'metadata_only';
        if (shouldCreateInteractionJob) jobs.unshift({ lakeType: 'interaction', dueAt: now });
        for (const job of jobs) {
            await client.query(
                `
                INSERT INTO research_extraction_jobs (
                    session_id, project_id, team_id, due_at, lake_type, schema_version, job_lane
                ) VALUES ($1, $2, $3, $4, $5, 2, $6)
                ON CONFLICT (session_id, lake_type, schema_version) DO NOTHING
                `,
                [params.session.id, params.project.id, params.project.teamId, job.dueAt, job.lakeType, params.jobLane ?? 'fresh'],
            );
        }

        if (params.session.appVersion && (panelInsert.rowCount ?? 0) > 0) {
            await client.query(
                `
                INSERT INTO research_release_registry (
                    project_id, platform, release_id, first_seen_at, last_seen_at, observed_session_count, updated_at
                ) VALUES ($1, $2, $3, $4, $4, 1, $5)
                ON CONFLICT (project_id, platform, release_id) DO UPDATE SET
                    first_seen_at = LEAST(research_release_registry.first_seen_at, EXCLUDED.first_seen_at),
                    last_seen_at = GREATEST(research_release_registry.last_seen_at, EXCLUDED.last_seen_at),
                    observed_session_count = research_release_registry.observed_session_count + 1,
                    updated_at = EXCLUDED.updated_at
                `,
                [params.project.id, params.session.platform ?? 'unknown', params.session.appVersion.slice(0, 80), params.session.startedAt, now],
            );
        }

        await client.query('COMMIT');
        return {
            preserveVisualArtifacts,
            interactionJobCreated: shouldCreateInteractionJob,
            tier,
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function markResearchLakeV2VisualExportComplete(sessionId: string): Promise<void> {
    const result = await pool.query<{ smart_capture_would_discard: boolean }>(
        `
        UPDATE research_capture_decisions
        SET source_cleanup_state = CASE WHEN smart_capture_would_discard THEN 'exported_cleanup_pending' ELSE 'not_required' END,
            source_cleanup_due_at = CASE WHEN smart_capture_would_discard THEN NOW() ELSE source_cleanup_due_at END,
            updated_at = NOW()
        WHERE session_id = $1 AND schema_version = 2
        RETURNING smart_capture_would_discard
        `,
        [sessionId],
    );
    if (!result.rows[0]?.smart_capture_would_discard) return;
    try {
        await discardSmartCaptureVisualArtifacts(sessionId);
        await pool.query(
            `UPDATE research_capture_decisions SET source_cleanup_state = 'exported_and_cleaned', updated_at = NOW() WHERE session_id = $1 AND schema_version = 2`,
            [sessionId],
        );
    } catch (error) {
        logger.warn({ error, sessionId }, 'Deferred research-lake V2 source cleanup after a completed export');
    }
}

export async function expireResearchLakeV2VisualHold(sessionId: string): Promise<void> {
    await pool.query(
        `
        UPDATE research_capture_decisions
        SET source_cleanup_state = CASE
                WHEN source_cleanup_state = 'pending_export' THEN 'pending_export'
                ELSE source_cleanup_state
            END,
            source_cleanup_due_at = CASE
                WHEN source_cleanup_state = 'pending_export' THEN LEAST(COALESCE(source_cleanup_due_at, NOW()), NOW())
                ELSE source_cleanup_due_at
            END,
            updated_at = NOW()
        WHERE session_id = $1 AND schema_version = 2
        `,
        [sessionId],
    );
}

export async function cleanupExpiredResearchLakeV2State(limit = 100): Promise<{ visualHolds: number; panelRows: number }> {
    const expired = await pool.query<{ session_id: string; export_completed: boolean }>(
        `
        WITH candidates AS (
            SELECT decisions.session_id,
                   decisions.source_cleanup_state,
                   decisions.source_cleanup_state = 'exported_cleanup_pending'
                       OR EXISTS (
                           SELECT 1
                           FROM research_extraction_jobs jobs
                           WHERE jobs.session_id = decisions.session_id
                             AND jobs.schema_version = 2
                             AND jobs.lake_type = 'interaction'
                             AND jobs.status = 'exported'
                       ) AS export_completed
            FROM research_capture_decisions decisions
            WHERE decisions.schema_version = 2
              AND (
                  (decisions.source_cleanup_state = 'pending_export' AND decisions.source_cleanup_due_at <= NOW())
                  OR (decisions.source_cleanup_state = 'exported_cleanup_pending' AND decisions.source_cleanup_due_at <= NOW())
                  OR (decisions.source_cleanup_state = 'cleanup_processing' AND decisions.updated_at <= NOW() - INTERVAL '15 minutes')
              )
            ORDER BY decisions.source_cleanup_due_at, decisions.session_id
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        )
        UPDATE research_capture_decisions decisions
        SET source_cleanup_state = 'cleanup_processing', updated_at = NOW()
        FROM candidates
        WHERE decisions.session_id = candidates.session_id AND decisions.schema_version = 2
        RETURNING decisions.session_id, candidates.export_completed
        `,
        [Math.max(1, limit)],
    );
    let cleanedVisualHolds = 0;
    for (const row of expired.rows) {
        try {
            await discardSmartCaptureVisualArtifacts(row.session_id);
            await pool.query(
                `UPDATE research_capture_decisions SET source_cleanup_state = $2, updated_at = NOW() WHERE session_id = $1 AND schema_version = 2`,
                [row.session_id, row.export_completed ? 'exported_and_cleaned' : 'expired_and_cleaned'],
            );
            cleanedVisualHolds++;
        } catch (error) {
            await pool.query(
                `UPDATE research_capture_decisions SET source_cleanup_state = $2, source_cleanup_due_at = NOW() + INTERVAL '5 minutes', updated_at = NOW() WHERE session_id = $1 AND schema_version = 2`,
                [row.session_id, row.export_completed ? 'exported_cleanup_pending' : 'pending_export'],
            ).catch(() => {});
            logger.warn({ error, sessionId: row.session_id }, 'Failed to clean expired research-lake V2 visual hold');
        }
    }
    const deleted = await pool.query(
        `
        WITH candidates AS (
            SELECT id
            FROM research_panel_observations
            WHERE expires_at <= NOW()
            ORDER BY expires_at, id
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        )
        DELETE FROM research_panel_observations observations
        USING candidates
        WHERE observations.id = candidates.id
        `,
        [Math.max(1, limit) * 10],
    );
    return { visualHolds: cleanedVisualHolds, panelRows: deleted.rowCount ?? 0 };
}

export const __researchLakeV2LifecycleTestInternals = {
    normalizedEventName,
    panelKeyForSession,
};
