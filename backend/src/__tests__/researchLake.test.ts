import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { __researchLakeTestInternals } from '../services/researchLake.js';
import {
    __researchLakeV2LifecycleTestInternals,
    researchLakeV2CaptureTier,
    researchLakeV2SamplingBucket,
    summarizeExistingV2Outcomes,
} from '../services/researchLakeV2Lifecycle.js';

const require = createRequire(import.meta.url);
const jpeg = require('jpeg-js') as {
    encode: (input: { data: Buffer; width: number; height: number }, quality?: number) => {
        data: Buffer;
    };
};

describe('research lake anonymized payload shape', () => {
    it('exports additive device context with coarse battery buckets', () => {
        const metrics = __researchLakeTestInternals.buildSessionMetrics({
            battery_level_percent: 57,
            battery_state: 'unplugged',
            low_power_mode_enabled: false,
            battery_level_start_percent: 83,
            battery_level_end_percent: 71,
            battery_delta_percent: -12,
            battery_state_start: 'unplugged',
            battery_state_end: 'charging',
            charging_state_changed: true,
            low_power_mode_observed: true,
            thermal_state_start: 'nominal',
            thermal_state_peak: 'serious',
            thermal_state_end: 'fair',
            thermal_throttled_duration_ms: 2500,
            memory_pressure_peak: 'warning',
            memory_pressure_event_count: 2,
            memory_headroom_mb_bucket_start: 2048,
            memory_headroom_mb_bucket_min: 768,
            memory_headroom_mb_bucket_end: 1536,
            font_scale_bucket: 'large',
            ui_style: 'dark',
            layout_direction: 'rtl',
            orientation_start: 'portrait',
            orientation_end: 'landscape',
            orientation_change_count: 1,
            display_max_refresh_rate_hz: 120,
            capture_health_reported: true,
            frames_captured: 42,
            frames_skipped_duplicate: 9,
            frames_skipped_throttle: 3,
            frames_skipped_backlog: 2,
            frames_skipped_map_moving: 7,
        } as any);

        expect(metrics).toMatchObject({
            battery_level_percent_bucket: 60,
            battery_level_start_bucket: 80,
            battery_level_end_bucket: 70,
            battery_delta_bucket: -10,
            charging_state_changed: true,
            low_power_mode_observed: true,
            thermal_state_peak: 'serious',
            memory_pressure_peak: 'warning',
            memory_headroom_mb_bucket_min: 768,
            font_scale_bucket: 'large',
            ui_style: 'dark',
            layout_direction: 'rtl',
            display_max_refresh_rate_hz: 120,
            capture_health_reported: true,
            frames_captured: 42,
            frames_skipped_duplicate: 9,
            frames_skipped_throttle: 3,
            frames_skipped_backlog: 2,
            frames_skipped_map_moving: 7,
        });
    });

    it('keeps unsupported device summaries nullable for older SDK sessions', () => {
        const metrics = __researchLakeTestInternals.buildSessionMetrics({} as any);

        expect(metrics).toMatchObject({
            thermal_throttled_duration_ms: null,
            memory_pressure_event_count: null,
            orientation_change_count: null,
            capture_health_reported: false,
            frames_captured: null,
            frames_skipped_duplicate: null,
            frames_skipped_throttle: null,
            frames_skipped_backlog: null,
            frames_skipped_map_moving: null,
        });
    });

    it('allows anonymized sample keys but rejects raw identity and location values', () => {
        const safePayload = {
            manifest: {
                lake: 'interaction',
                project_key: 'a1b2c3d4e5f607182930',
                sample_key: 'f'.repeat(32),
                files: {
                    ui_frames: `v1/lake=interaction/project_key=a1b2/date=2026-05-11/sample_key=${'f'.repeat(32)}/ui_frames.jsonl.gz`,
                },
            },
            frame: {
                frame_key: 'abc123',
                source_kind: 'rrweb',
                has_href: true,
                has_src: false,
                text_class: 'masked',
            },
        };

        expect(__researchLakeTestInternals.containsIdentifierRisk(safePayload)).toBe(false);
        expect(__researchLakeTestInternals.containsIdentifierRisk({ session_id: 'session_1778538040547_ec8c9af04f3c4bb0b1a3fe0d3fb8e84c' })).toBe(true);
        expect(__researchLakeTestInternals.containsIdentifierRisk({ raw_url: 'https://example.com/account/123' })).toBe(true);
        expect(__researchLakeTestInternals.containsIdentifierRisk({ email: 'person@example.com' })).toBe(true);
        expect(__researchLakeTestInternals.containsIdentifierRisk({ network: '127.0.0.1' })).toBe(true);
        expect(__researchLakeTestInternals.containsIdentifierRisk({ device_id: 'device-123' })).toBe(true);
    });

    it('extracts portrait-phone screenshot feature grids without storing raw pixels', () => {
        const width = 64;
        const height = 128;
        const data = Buffer.alloc(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const offset = (y * width + x) * 4;
                data[offset] = Math.round((x / width) * 255);
                data[offset + 1] = Math.round((y / height) * 255);
                data[offset + 2] = Math.round(((x + y) / (width + height)) * 255);
                data[offset + 3] = 255;
            }
        }

        const jpegFrame = jpeg.encode({ data, width, height }, 80).data;
        const features = __researchLakeTestInternals.imageFeatureGrid(jpegFrame);

        expect(features).not.toBeNull();
        expect(features?.width).toBe(width);
        expect(features?.height).toBe(height);
        expect(features?.gridColumns).toBe(64);
        expect(features?.gridRows).toBe(128);
        expect(features?.orientation).toBe('portrait');
        expect(features?.formFactor).toBe('phone');
        expect(features?.lumaGrid).toHaveLength(8192);
        expect(features?.edgeGrid).toHaveLength(8192);
        expect(features?.colorGrid).toHaveLength(8192);
        expect(features?.lumaGrid.every((value) => value >= 0 && value <= 15)).toBe(true);
        expect(features?.edgeGrid.every((value) => value >= 0 && value <= 15)).toBe(true);
        expect(features?.lumaGrid.at(-1)).toBeGreaterThan(0);
    });

    it('selects one replay grid contract for phones and tablets by orientation', () => {
        expect(__researchLakeTestInternals.visualGridSpecForDimensions(390, 844)).toMatchObject({
            columns: 64,
            rows: 128,
            orientation: 'portrait',
            formFactor: 'phone',
        });
        expect(__researchLakeTestInternals.visualGridSpecForDimensions(844, 390)).toMatchObject({
            columns: 128,
            rows: 64,
            orientation: 'landscape',
            formFactor: 'phone',
        });
        expect(__researchLakeTestInternals.visualGridSpecForDimensions(768, 1024)).toMatchObject({
            columns: 96,
            rows: 128,
            orientation: 'portrait',
            formFactor: 'tablet',
        });
        expect(__researchLakeTestInternals.visualGridSpecForDimensions(1024, 768)).toMatchObject({
            columns: 128,
            rows: 96,
            orientation: 'landscape',
            formFactor: 'tablet',
        });
        expect(__researchLakeTestInternals.visualGridSpecForDimensions(null, null)).toMatchObject({
            columns: 64,
            rows: 128,
            orientation: 'portrait',
            formFactor: 'phone',
        });
    });

    it('generates a valid ZIP archive containing multiple files', async () => {
        const files = [
            { name: 'manifest.json', buffer: Buffer.from('{"test":true}', 'utf8') },
            { name: 'quality.json', buffer: Buffer.from('{"usable":true}', 'utf8') },
        ];
        const zipBuffer = await __researchLakeTestInternals.createZipArchiveBuffer(files);
        const storedZipBuffer = await __researchLakeTestInternals.createZipArchiveBuffer(files, { store: true });
        expect(zipBuffer).toBeInstanceOf(Buffer);
        expect(zipBuffer.length).toBeGreaterThan(0);
        expect(storedZipBuffer).toBeInstanceOf(Buffer);
        expect(storedZipBuffer.length).toBeGreaterThan(0);
        // Verify ZIP magic bytes (PK\x03\x04)
        for (const archive of [zipBuffer, storedZipBuffer]) {
            expect(archive[0]).toBe(0x50);
            expect(archive[1]).toBe(0x4b);
            expect(archive[2]).toBe(0x03);
            expect(archive[3]).toBe(0x04);
        }
    });

    it('uses deterministic standard JPEG paths inside V2 screenshot ZIPs', () => {
        expect(__researchLakeTestInternals.v2ScreenshotArchiveEntry(7, 1234))
            .toBe('frames/frame-000007-000001234ms.jpg');
    });

    it('records empty V2 screenshot chunks without failing an otherwise valid session', () => {
        const serviceSource = readFileSync(
            `${process.cwd()}/src/services/researchLake.ts`,
            'utf8',
        );

        expect(serviceSource).toContain("'Skipping empty V2 screenshot source artifact'");
        expect(serviceSource).toContain('unavailable_screenshot_artifact_count: media.unavailableArtifactCount');
        expect(serviceSource).toContain("'some_screenshot_source_artifacts_unavailable'");
        expect(serviceSource).not.toContain('throw new Error(`V2 screenshot source contained no extractable frames');
    });

    it('uses lane-specific seed SQL for visual interaction and behavioral outcomes jobs', () => {
        const interactionSql = __researchLakeTestInternals.buildSeedResearchJobsSql('interaction');
        const behavioralSql = __researchLakeTestInternals.buildSeedResearchJobsSql('behavioral_outcomes');
        const interactionClaimSql = __researchLakeTestInternals.buildClaimResearchJobsSql('interaction');
        const behavioralClaimSql = __researchLakeTestInternals.buildClaimResearchJobsSql('behavioral_outcomes');

        expect(interactionSql).toContain("ra.kind IN ('screenshots', 'hierarchy', 'rrweb')");
        expect(interactionSql).toContain('rej.lake_type = $3');
        expect(interactionSql).toContain('rej.schema_version = 1');
        expect(interactionSql).toContain("SELECT session_id, project_id, team_id, due_at, $3, 1, 'retention'");
        expect(interactionSql).toContain('ON CONFLICT DO NOTHING');
        expect(interactionSql).toContain('PARTITION BY s.project_id');
        expect(interactionSql).toContain('project_rank, project_oldest_due_at, project_id');

        expect(behavioralSql).toContain('COALESCE(s.observe_only, false) = true');
        expect(behavioralSql).toContain('COALESCE(s.replay_quota_billing_exhausted, false) = true');
        expect(behavioralSql).toContain("s.replay_retention_state = 'analytics_only'");
        expect(behavioralSql).toContain('jsonb_array_length(s.events) > 0');
        expect(behavioralSql).toContain('LEFT JOIN session_metrics sm');

        expect(__researchLakeTestInternals.researchLakeTypes).toEqual(['interaction', 'behavioral_outcomes']);
        expect(__researchLakeTestInternals.researchLakeV2Types).toEqual(['interaction', 'behavioral_outcomes', 'forward_outcomes']);
        expect(interactionClaimSql).toContain("status IN ('pending', 'failed')");
        expect(interactionClaimSql).toContain('lake_type = $2');
        expect(interactionClaimSql).toContain('CROSS JOIN LATERAL');
        expect(interactionClaimSql).toContain('project_id = active_projects.project_id');
        expect(interactionClaimSql).toContain('LIMIT $4');
        expect(interactionClaimSql).toContain('project_rank, ranked.project_oldest_due_at');
        expect(interactionClaimSql).toContain('FOR UPDATE OF rej SKIP LOCKED');

        expect(behavioralClaimSql).toContain("status IN ('pending', 'failed')");
        expect(behavioralClaimSql).toContain('ORDER BY due_at, created_at, id');
        expect(behavioralClaimSql).not.toContain('PARTITION BY project_id');
        expect(interactionClaimSql).toContain('schema_version = 1');
    });

    it('throttles empty seed scans but retries when eligibility can have changed', () => {
        const now = 1_000_000;
        const nextV1Retry = __researchLakeTestInternals.nextResearchSeedRetryAtMs(0, now);
        const nextV2Retry = __researchLakeTestInternals.nextResearchSeedRetryAtMs(
            0,
            now,
            __researchLakeTestInternals.researchV2EmptySeedRetryMs,
        );

        expect(nextV1Retry).toBe(now + __researchLakeTestInternals.researchEmptySeedRetryMs);
        expect(nextV2Retry).toBe(now + __researchLakeTestInternals.researchV2EmptySeedRetryMs);
        expect(__researchLakeTestInternals.shouldRetryResearchSeed(nextV1Retry, nextV1Retry - 1)).toBe(false);
        expect(__researchLakeTestInternals.shouldRetryResearchSeed(nextV1Retry, nextV1Retry)).toBe(true);

        // A later scan that discovers newly eligible work removes the throttle,
        // so the next bounded chunk can be seeded immediately after the queue drains.
        const afterEligibilityAppears = __researchLakeTestInternals.nextResearchSeedRetryAtMs(
            1,
            nextV1Retry,
        );
        expect(afterEligibilityAppears).toBe(0);
        expect(__researchLakeTestInternals.shouldRetryResearchSeed(afterEligibilityAppears, nextV1Retry)).toBe(true);
    });

    it('releases jobs claimed but not started at the runtime deadline', () => {
        const releaseSql = __researchLakeTestInternals.buildReleaseUnstartedResearchJobsSql();
        const serviceSource = readFileSync(
            `${process.cwd()}/src/services/researchLake.ts`,
            'utf8',
        );

        expect(releaseSql).toContain("status = 'pending'");
        expect(releaseSql).toContain('attempts = GREATEST(attempts - 1, 0)');
        expect(releaseSql).toContain('next_retry_at = NULL');
        expect(releaseSql).toContain('id = ANY($1::uuid[])');
        expect(releaseSql).toContain("status = 'processing'");
        expect(serviceSource).toContain('jobs.slice(batchResult.startedCount)');
        expect(serviceSource).toContain('releaseUnstartedResearchJobs(unstartedJobs)');
    });

    // Moved to the infra repo (__tests__/infraContract.test.ts) with the k8s manifests.
    it('reserves V2 worker time for in-flight screenshot archive exports', () => {
        const serviceSource = readFileSync(
            `${process.cwd()}/src/services/researchLake.ts`,
            'utf8',
        );

        expect(serviceSource).toContain('const workDeadlineAtMs = deadlineAtMs - drainBufferMs');
        expect(serviceSource).toContain('while (Date.now() < workDeadlineAtMs)');
        expect(serviceSource).toContain('deadlineAtMs: workDeadlineAtMs');
    });

    it('migration preserves interaction rows while replacing session-only uniqueness', () => {
        const migrationSql = readFileSync(
            `${process.cwd()}/drizzle/20260611140000_research_lake_lake_type_curated/migration.sql`,
            'utf8',
        );

        expect(migrationSql).toContain('"lake_type" varchar(32) DEFAULT \'interaction\' NOT NULL');
        expect(migrationSql).toContain('DROP INDEX IF EXISTS "research_extraction_jobs_session_unique"');
        expect(migrationSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "research_extraction_jobs_session_lake_unique"');
        expect(migrationSql).toContain('("session_id", "lake_type")');
        expect(migrationSql).toContain('("lake_type", "status", "next_retry_at", "due_at", "session_id")');
    });

    it('adds an index for fair project-rotating interaction claims', () => {
        const migrationSql = readFileSync(
            `${process.cwd()}/drizzle/20260709190000_research_lake_fair_claim_index/migration.sql`,
            'utf8',
        );

        expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS "research_extraction_jobs_fair_claim_idx"');
        expect(migrationSql).toContain('("lake_type", "status", "project_id", "due_at", "created_at")');
    });

    it('adds V2 tables and schema-versioned uniqueness without disabling V1', () => {
        const migrationSql = readFileSync(
            `${process.cwd()}/drizzle/20260729120000_research_lake_v2/migration.sql`,
            'utf8',
        );
        const concurrentIndexSql = readFileSync(
            `${process.cwd()}/drizzle/manual/research-lake-v2-indexes-concurrent.sql`,
            'utf8',
        );
        const activationSql = readFileSync(
            `${process.cwd()}/drizzle/manual/research-lake-v2-activate.sql`,
            'utf8',
        );

        expect(migrationSql).toContain("SET lock_timeout = '5s'");
        expect(migrationSql).toContain("SET statement_timeout = '2min'");
        expect(migrationSql).not.toContain('CREATE UNIQUE INDEX IF NOT EXISTS "research_extraction_jobs_session_lake_schema_unique"');
        expect(migrationSql).not.toContain('CREATE INDEX IF NOT EXISTS "research_extraction_jobs_v2_claim_idx"');
        expect(migrationSql).not.toContain('DROP INDEX IF EXISTS "research_extraction_jobs_session_lake_unique"');
        expect(migrationSql).not.toContain('DROP INDEX IF EXISTS "research_extraction_jobs_claim_idx"');
        expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "research_capture_decisions"');
        expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "research_panel_observations"');
        expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "research_release_registry"');
        expect(migrationSql).not.toContain('DROP TABLE');
        expect(migrationSql).not.toContain('DELETE FROM research_extraction_jobs');
        expect(migrationSql).not.toContain('category');
        expect(migrationSql).not.toContain('business_model');
        expect(migrationSql.indexOf('ALTER TABLE "research_extraction_jobs"')).toBeGreaterThan(
            migrationSql.indexOf('CREATE INDEX IF NOT EXISTS "research_release_registry_project_seen_idx"'),
        );
        expect(concurrentIndexSql).toContain('\\set ON_ERROR_STOP on');
        expect(concurrentIndexSql).toContain('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "research_extraction_jobs_session_lake_schema_unique"');
        expect(concurrentIndexSql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS "research_extraction_jobs_v2_claim_idx"');
        expect(concurrentIndexSql).not.toContain('DROP INDEX');
        expect(activationSql).toContain('\\set ON_ERROR_STOP on');
        expect(activationSql).toContain('indisvalid');
        expect(activationSql).toContain("ARRAY['session_id', 'lake_type', 'schema_version']");
        expect(activationSql).toContain(
            "ARRAY['lake_type', 'job_lane', 'status', 'next_retry_at', 'due_at', 'session_id']",
        );
        expect(activationSql).toContain('actual_columns IS DISTINCT FROM expected_columns');
        expect(activationSql).toContain('research_extraction_jobs_v2_fair_claim_idx');
        expect(activationSql).toContain('DROP INDEX CONCURRENTLY IF EXISTS "research_extraction_jobs_session_lake_unique"');
    });

    it('builds deterministic V2 sampling and keeps spine separate from uniform', () => {
        const first = researchLakeV2SamplingBucket('project-a', 'session-a', 1);
        const second = researchLakeV2SamplingBucket('project-a', 'session-a', 1);
        expect(first).toBe(second);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThan(10_000);
        expect(researchLakeV2CaptureTier(0, 'discarded')).toEqual({
            tier: 'spine',
            inclusionProbabilityPpm: 50_000,
            tierAssignmentProbabilityPpm: 30_000,
        });
        expect(researchLakeV2CaptureTier(299, 'discarded').tier).toBe('spine');
        expect(researchLakeV2CaptureTier(300, 'discarded')).toEqual({
            tier: 'uniform',
            inclusionProbabilityPpm: 50_000,
            tierAssignmentProbabilityPpm: 20_000,
        });
        expect(researchLakeV2CaptureTier(499, 'discarded').tier).toBe('uniform');
        expect(researchLakeV2CaptureTier(0, 'kept').inclusionProbabilityPpm).toBe(1_000_000);
        expect(researchLakeV2CaptureTier(500, 'kept')).toMatchObject({
            tier: 'selected',
            inclusionProbabilityPpm: 1_000_000,
            tierAssignmentProbabilityPpm: 950_000,
        });
        expect(researchLakeV2CaptureTier(500, 'not_applicable').tier).toBe('selected');
        expect(researchLakeV2CaptureTier(500, 'pending').tier).toBe('metadata_only');
        expect(researchLakeV2CaptureTier(500, 'discarded')).toMatchObject({
            tier: 'metadata_only',
            inclusionProbabilityPpm: 0,
            tierAssignmentProbabilityPpm: 950_000,
        });
    });

    it('derives only supported existing-event outcomes for the V2 panel', () => {
        const summary = summarizeExistingV2Outcomes([
            { name: 'purchase_complete', properties: { value: 49.99 } },
            { name: 'subscription_renewed' },
            { name: 'refund_processed' },
            { name: 'cancel_confirmed' },
            { name: 'variant_selected', properties: { variant: 'not-an-experiment' } },
        ]);

        expect(summary).toEqual({
            eventFamilies: ['cancellation', 'refund', 'renewal', 'revenue'],
            revenueAmountBucket: 50,
            refundCount: 1,
            renewalCount: 1,
            cancellationCount: 1,
        });
    });

    it('does not create a shared panel key from empty identity fields', () => {
        expect(__researchLakeV2LifecycleTestInternals.panelKeyForSession({
            projectId: 'project-a',
            deviceId: '  ',
            anonymousHash: '',
            userDisplayId: null,
        } as any)).toBeNull();
    });

    it('builds V2 latency buckets, screen versions, and action-conditioned flows', () => {
        expect([0, 49, 50, 99, 100, 1599, 1600].map(__researchLakeTestInternals.latencyBucket)).toEqual([
            '0_50', '0_50', '50_100', '50_100', '100_200', '800_1600', '1600_plus',
        ]);
        const frames = [
            { frame_key: 'f1', source_kind: 'hierarchy', source_index: 0, elapsed_ms: 100, elapsed_ms_bucket: 0, screen_key: 'home' },
            { frame_key: 'f2', source_kind: 'hierarchy', source_index: 1, elapsed_ms: 200, elapsed_ms_bucket: 0, screen_key: 'home' },
        ] as any;
        const skeleton = [
            { element_key: 'e1', frame_key: 'f1', screen_key: 'home', role: 'control', type_family: 'button', hierarchy_depth_bucket: 0, child_count_bucket: 0 },
            { element_key: 'e2', frame_key: 'f2', screen_key: 'home', role: 'control', type_family: 'button', hierarchy_depth_bucket: 0, child_count_bucket: 0 },
            { element_key: 'e3', frame_key: 'f2', screen_key: 'home', role: 'text', type_family: 'text', hierarchy_depth_bucket: 0, child_count_bucket: 0 },
        ] as any;
        const versions = __researchLakeTestInternals.buildV2ScreenVersions(frames, skeleton, 'project-key');
        expect(versions).toHaveLength(2);
        expect(versions[0]).toHaveProperty('structural_signature_key');
        expect(versions[1].structural_tokens_added_bucket).toBe(2);

        const edges = __researchLakeTestInternals.buildV2FlowEdges([
            { index: 0, kind: 'tap', elapsed_ms: 10, elapsed_ms_bucket: 0, screen_key: 'home', target_key: 'a' },
            { index: 1, kind: 'screen', elapsed_ms: 20, elapsed_ms_bucket: 0, screen_key: 'checkout', target_key: 'b' },
        ] as any);
        expect(edges).toEqual([expect.objectContaining({
            from_screen_key: 'home',
            to_screen_key: 'checkout',
            action_kind: 'tap',
            action_target_key: 'a',
            evidence_source: 'observed_event_order',
        })]);
    });

    it('bounds V2 retries to 24 hours from the later of creation or due time', () => {
        const job = {
            due_at: new Date('2026-07-01T12:00:00Z'),
            created_at: new Date('2026-06-01T12:00:00Z'),
        } as any;

        expect(__researchLakeTestInternals.v2RetryWindowExhausted(
            job,
            new Date('2026-07-02T11:59:59Z'),
        )).toBe(false);
        expect(__researchLakeTestInternals.v2RetryWindowExhausted(
            job,
            new Date('2026-07-02T12:00:00Z'),
        )).toBe(true);
    });

    it('refreshes release adoption once per hour instead of on every worker run', () => {
        expect(__researchLakeTestInternals.shouldRefreshV2ReleaseAdoption(
            new Date('2026-07-29T12:02:00Z'),
        )).toBe(true);
        expect(__researchLakeTestInternals.shouldRefreshV2ReleaseAdoption(
            new Date('2026-07-29T12:07:00Z'),
        )).toBe(false);
    });

    it('builds behavioral outcome rows without UI files or raw product identifiers', () => {
        const session = {
            id: 'session-789',
            started_at: new Date('2026-06-08T12:00:00Z'),
            platform: 'ios',
            app_version: '1.2.3',
            sdk_version: '1.3.0',
            duration_seconds: 120,
            retention_days: 30,
            observe_only: true,
            replay_quota_billing_exhausted: false,
            replay_retention_state: 'analytics_only',
            screens_visited: ['Home', 'Paywall'],
            events: [
                { name: 'paywall_view', timestamp: new Date('2026-06-08T12:00:10Z').getTime(), properties: { productId: 'prod_secret' } },
                { name: 'purchase_complete', timestamp: new Date('2026-06-08T12:00:20Z').getTime(), properties: { productId: 'prod_secret', value: 99, currency: 'USD', transactionId: 'tx_raw' } },
            ],
            total_events: 2,
            custom_event_count: 2,
            api_total_count: 1,
            api_error_count: 1,
            error_count: 1,
            crash_count: 0,
            anr_count: 0,
            rage_tap_count: 0,
            dead_tap_count: 0,
            battery_level_percent: 57,
            battery_state: 'unplugged',
            low_power_mode_enabled: true,
            geo_country: 'United States',
            geo_country_code: 'US',
            geo_city: 'San Francisco',
            metadata: { experiment: 'checkout' },
        } as any;
        const projectKey = 'project-key';
        const interactions = __researchLakeTestInternals.buildInteractions(session, projectKey, null);
        const events = __researchLakeTestInternals.buildBehavioralEvents(session, interactions, projectKey);
        const metrics = __researchLakeTestInternals.buildSessionMetrics(session);
        const businessContext = __researchLakeTestInternals.buildBusinessContext(session, interactions, [], null);
        const labels = __researchLakeTestInternals.buildBehavioralLabels(session, businessContext);
        const manifest = __researchLakeTestInternals.buildBehavioralManifest({
            session,
            projectKey,
            lakeSampleKey: 'f'.repeat(32),
            date: '2026-06-08',
            basePath: `v1/lake=behavioral_outcomes/project_key=${projectKey}/date=2026-06-08/sample_key=${'f'.repeat(32)}`,
            businessContext,
            metrics,
            labels,
            eventCount: events.length,
        });

        expect(manifest.schema_version).toBe(1);
        expect(manifest.files.events).toMatch(/^v1\//);
        expect(manifest.lake).toBe('behavioral_outcomes');
        expect(manifest.files).not.toHaveProperty('ui_frames');
        expect(manifest.files).not.toHaveProperty('ui_skeleton');
        expect(metrics).toMatchObject({
            crash_count: 0,
            anr_count: 0,
            error_count: 1,
            battery_level_percent_bucket: 60,
            battery_state: 'unplugged',
            low_power_mode_enabled: true,
        });
        expect(labels.has_stability_failure).toBe(true);
        expect(manifest.geo).toMatchObject({
            country: 'United States',
            country_code: 'US',
            city: 'San Francisco',
        });
        expect(__researchLakeTestInternals.buildGeoContext(session).city).toBe('San Francisco');
        expect(events[1]).toHaveProperty('product_key');
        expect(events[1]).not.toHaveProperty('product_id');
        expect(JSON.stringify({ manifest, interactions, events, metrics, labels })).not.toContain('prod_secret');
        expect(JSON.stringify({ manifest, interactions, events, metrics, labels })).not.toContain('tx_raw');
        expect(__researchLakeTestInternals.containsIdentifierRisk({ manifest, events, metrics, labels })).toBe(false);
    });

    it('populates business/funnel markers and semantic roles in interactions and skeleton', () => {
        const session = {
            id: 'session-123',
            user_display_id: 'user_9982',
            started_at: new Date('2026-06-08T12:00:00Z'),
            metadata: {
                plan: 'pro',
                experiment: 'v2'
            },
            events: [
                { name: 'signup_completed', timestamp: new Date('2026-06-08T12:00:01Z').getTime(), x: 50, y: 50, viewportWidth: 1000, viewportHeight: 2000 },
                { name: 'login', timestamp: new Date('2026-06-08T12:00:02Z').getTime(), x: 100, y: 100 },
                { name: 'product_view', timestamp: new Date('2026-06-08T12:00:05Z').getTime(), x: 150, y: 150, properties: { price: 49.99, productId: 'prod_1' } },
                { name: 'product_added_to_cart', timestamp: new Date('2026-06-08T12:00:10Z').getTime(), x: 200, y: 200, properties: { quantity: 7, price: 99.98, productId: 'prod_1' } },
                { name: 'paywall_view', timestamp: new Date('2026-06-08T12:00:12Z').getTime(), x: 250, y: 250 },
                { name: 'plan_selected', timestamp: new Date('2026-06-08T12:00:14Z').getTime(), x: 300, y: 300, properties: { planId: 'plan_gold' } },
                { name: 'coupon_use', timestamp: new Date('2026-06-08T12:00:16Z').getTime(), x: 350, y: 350, properties: { couponCode: 'SAVE20' } },
                { name: 'checkout_start', timestamp: new Date('2026-06-08T12:00:20Z').getTime(), x: 400, y: 400 },
                { name: 'purchase_complete', timestamp: new Date('2026-06-08T12:00:30Z').getTime(), x: 450, y: 450, properties: { value: 149.97, currency: 'USD', productId: 'prod_1', plan: 'plan_gold', priceId: 'price_gold_monthly', subscriptionId: 'sub_xyz', paymentProvider: 'stripe', platform: 'ios', isRenewal: false, isTrialConversion: true, transactionId: 'tx_8871' } },
                { name: 'trial_start', timestamp: new Date('2026-06-08T12:00:35Z').getTime(), x: 500, y: 500 },
                { name: 'subscription_start', timestamp: new Date('2026-06-08T12:00:40Z').getTime(), x: 550, y: 550 },
                { name: 'refund_processed', timestamp: new Date('2026-06-08T12:00:45Z').getTime(), x: 600, y: 600, properties: { refundId: 'ref_12' } },
                { name: 'cancellation', timestamp: new Date('2026-06-08T12:00:50Z').getTime(), x: 650, y: 650 },
                { name: 'payment_failure', timestamp: new Date('2026-06-08T12:00:55Z').getTime(), x: 700, y: 700 },
                { name: 'onboarding_completed', timestamp: new Date('2026-06-08T12:01:00Z').getTime(), x: 750, y: 750 },
                { name: 'feature_used', timestamp: new Date('2026-06-08T12:01:05Z').getTime(), x: 800, y: 800 },
                { name: 'added_to_cart', timestamp: new Date('2026-06-08T12:01:10Z').getTime(), x: 850, y: 850, properties: { quantity: 5 } },
            ]
        } as any;

        const projectKey = 'test-project-key';
        const customEventConfig = {
            revenueEventName: 'purchase_complete',
            checkoutEventName: 'checkout_start',
            subscriberEventName: 'cart_add'
        };

        const interactions = __researchLakeTestInternals.buildInteractions(session, projectKey, customEventConfig);

        expect(interactions).toHaveLength(17);

        // Verify transition names
        expect(interactions[0].funnel_transition).toBe('signup');
        expect(interactions[1].funnel_transition).toBe('login');
        expect(interactions[2].funnel_transition).toBe('product_view');
        expect(interactions[3].funnel_transition).toBe('cart_add');
        expect(interactions[4].funnel_transition).toBe('paywall_view');
        expect(interactions[5].funnel_transition).toBe('plan_selected');
        expect(interactions[6].funnel_transition).toBe('coupon_use');
        expect(interactions[7].funnel_transition).toBe('checkout_start');
        expect(interactions[8].funnel_transition).toBe('purchase_complete');
        expect(interactions[9].funnel_transition).toBe('trial_start');
        expect(interactions[10].funnel_transition).toBe('subscription_start');
        expect(interactions[11].funnel_transition).toBe('refund');
        expect(interactions[12].funnel_transition).toBe('cancellation');
        expect(interactions[13].funnel_transition).toBe('payment_failure');
        expect(interactions[14].funnel_transition).toBe('onboarding_completed');
        expect(interactions[15].funnel_transition).toBe('feature_used');
        expect(interactions[16].funnel_transition).toBe('cart_add');

        // Verify rounding and bucketing
        // product_view: 49.99 rounded into the fine low-value money bucket
        expect(interactions[2].cart_value_bucket).toBe(50);
        // product_added_to_cart: qty 7 maps to the 6-10 count bucket, price 99.98 to 100
        expect(interactions[3].item_count_change).toBe(10);
        expect(interactions[3].cart_value_bucket).toBe(100);
        // added_to_cart: exact small counts are retained as buckets
        expect(interactions[16].item_count_change).toBe(5);
        expect(interactions[0].x_norm_bucket).toBe(50);
        expect(interactions[0].y_norm_bucket).toBe(25);
        expect(interactions[0].x_cell).toBe(3);
        expect(interactions[0].y_cell).toBe(3);
        expect(interactions[0].touch_grid_columns).toBe(64);
        expect(interactions[0].touch_grid_rows).toBe(128);
        expect(interactions[0].screen_orientation).toBe('portrait');
        expect(interactions[0].screen_form_factor).toBe('phone');
        expect(interactions[1].viewport_source).toBe('session_event_fallback');
        expect(interactions[0]).not.toHaveProperty('x_cell_32');
        expect(interactions[0]).not.toHaveProperty('y_cell_32');
        expect(interactions[0]).not.toHaveProperty('x_bucket');
        expect(interactions[0]).not.toHaveProperty('y_bucket');

        // Verify custom properties extraction on purchase_complete
        const purchase = interactions[8];
        expect(purchase.product_key).toMatch(/^[0-9a-f]{20}$/);
        expect(purchase.plan_key).toMatch(/^[0-9a-f]{20}$/);
        expect(purchase.price_key).toMatch(/^[0-9a-f]{20}$/);
        expect(purchase.product_key).not.toBe('prod_1');
        expect(JSON.stringify(interactions)).not.toContain('prod_1');
        expect(JSON.stringify(interactions)).not.toContain('plan_gold');
        expect(JSON.stringify(interactions)).not.toContain('price_gold_monthly');
        expect(purchase.currency).toBe('USD');
        expect(purchase.payment_provider).toBe('stripe');
        expect(purchase.platform).toBe('ios');
        expect(purchase.is_renewal).toBe(false);
        expect(purchase.is_trial_conversion).toBe(true);

        // Verify that identity/transaction hashes are completely omitted for GDPR compliance
        expect(purchase.transaction_id_hash).toBeUndefined();
        expect(purchase.subscription_id_hash).toBeUndefined();

        const couponUse = interactions[6];
        expect(couponUse.coupon_code_hash).toBeUndefined();

        const refund = interactions[11];
        expect(refund.refund_id_hash).toBeUndefined();

        // Verify skeleton mapping roles
        const skeleton = __researchLakeTestInternals.buildInteractionSkeleton(interactions);
        expect(skeleton).toHaveLength(17);
        const roles = skeleton.map(e => e.role);
        expect(roles).toContain('cta_signup');
        expect(roles).toContain('cta_login');
        expect(roles).toContain('view_item');
        expect(roles).toContain('cta_cart_add');
        expect(roles).toContain('paywall_element');
        expect(roles).toContain('plan_selector');
        expect(roles).toContain('cta_coupon_use');
        expect(roles).toContain('cta_checkout');
        expect(roles).toContain('cta_purchase');
        expect(roles).toContain('cta_trial_start');
        expect(roles).toContain('cta_subscription_start');
        expect(roles).toContain('cta_refund');
        expect(roles).toContain('cta_cancellation');
        expect(roles).toContain('payment_failure_element');
        expect(roles).toContain('cta_onboarding');
        expect(roles).toContain('feature_element');

        // Verify buildBusinessContext manifest properties
        const bizContext = __researchLakeTestInternals.buildBusinessContext(session, interactions, [], customEventConfig);
        expect(bizContext.is_conversion_session).toBe(true);
        expect(bizContext.max_funnel_stage_reached).toBe('purchase');
        expect(bizContext.conversion_revenue_bucket).toBe(150); // 149.97 rounded to 150
        expect(bizContext.currency).toBe('USD');
        expect(bizContext.purchased_product_keys).toContain(purchase.product_key);
        expect(bizContext.has_discount_applied).toBe(true);
        expect((bizContext as any).user_identity_hash).toBeUndefined();
        expect(bizContext.session_metadata_keys).toContain('plan');
        expect(bizContext.session_metadata_keys).toContain('experiment');
        expect(bizContext.lifecycle_events_present).toContain('signup');
        expect(bizContext.lifecycle_events_present).toContain('purchase_complete');
    });

    it('recognizes common custom event naming variants as funnel transitions', () => {
        const cases = [
            { event: { name: 'PurchaseSucceeded' }, transition: 'purchase_complete' },
            { event: { type: 'checkout.initiated' }, transition: 'checkout_start' },
            { event: { eventName: 'add-to-basket' }, transition: 'cart_add' },
            { event: { event_name: 'Product Details Viewed' }, transition: 'product_view' },
            { event: { name: 'User Registered' }, transition: 'signup' },
            { event: { name: 'signedIn' }, transition: 'login' },
            { event: { name: 'paywall_shown' }, transition: 'paywall_view' },
            { event: { name: 'choosePlan' }, transition: 'plan_selected' },
            { event: { name: 'promoCodeApplied' }, transition: 'coupon_use' },
            { event: { name: 'free_trial_start' }, transition: 'trial_start' },
            { event: { name: 'subscriptionCreated' }, transition: 'subscription_start' },
            { event: { name: 'payment_refunded' }, transition: 'refund' },
            { event: { name: 'subscriptionCanceled' }, transition: 'cancellation' },
            { event: { name: 'card_declined' }, transition: 'payment_failure' },
            { event: { name: 'tutorial_completed' }, transition: 'onboarding_completed' },
            { event: { name: 'tool-used' }, transition: 'feature_used' },
            { event: { name: 'adDisplayed' }, transition: 'ad_viewed' },
            { event: { name: 'ad_tapped' }, transition: 'ad_clicked' },
            { event: { name: 'native_ad_impression' }, transition: 'native_ad_viewed' },
            { event: { name: 'native_ad_cta_clicked' }, transition: 'native_ad_clicked' },
            { event: { name: 'banner_ad_shown' }, transition: 'banner_ad_viewed' },
            { event: { name: 'banner_ad_click' }, transition: 'banner_ad_clicked' },
            { event: { name: 'interstitial_ad_displayed' }, transition: 'interstitial_ad_viewed' },
            { event: { name: 'interstitial_ad_tapped' }, transition: 'interstitial_ad_clicked' },
            { event: { name: 'rewarded_video_ad_impression' }, transition: 'rewarded_ad_viewed' },
            { event: { name: 'rewardedVideoAdClicked' }, transition: 'rewarded_ad_clicked' },
            { event: { name: 'video_ad_started' }, transition: 'video_ad_viewed' },
            { event: { name: 'video_ad_cta_clicked' }, transition: 'video_ad_clicked' },
            { event: { name: 'sponsored_content_viewed' }, transition: 'sponsored_ad_viewed' },
            { event: { name: 'sponsoredContentClicked' }, transition: 'sponsored_ad_clicked' },
            { event: { name: 'product_variant_selected' }, transition: 'variant_selected' },
            { event: { name: 'select-size' }, transition: 'size_selected' },
            { event: { name: 'colorChosen' }, transition: 'color_selected' },
            { event: { name: 'cart_quantity_changed' }, transition: 'quantity_changed' },
            { event: { name: 'productReviewsViewed' }, transition: 'reviews_viewed' },
            { event: { name: 'delivery_info_viewed' }, transition: 'shipping_info_viewed' },
            { event: { name: 'refund_policy_viewed' }, transition: 'return_policy_viewed' },
            { event: { name: 'add_to_wishlist' }, transition: 'wishlist_add' },
            { event: { name: 'product_shared' }, transition: 'share_clicked' },
            { event: { name: 'upgrade_cta_clicked' }, transition: 'upgrade_clicked' },
            { event: { name: 'plan_upgraded' }, transition: 'upgrade_completed' },
            { event: { name: 'promo_offer_viewed' }, transition: 'discount_offer_viewed' },
            { event: { name: 'offerAccepted' }, transition: 'discount_offer_accepted' },
            { event: { name: 'subscription_cancel_flow_started' }, transition: 'cancel_flow_started' },
            { event: { name: 'subscriptionCancellationConfirmed' }, transition: 'cancel_confirmed' },
            { event: { name: 'cancel_button_clicked' }, transition: null },
        ] as const;

        const startedAt = new Date('2026-06-08T12:00:00Z');
        const session = {
            id: 'session-aliases',
            started_at: startedAt,
            events: cases.map((entry, index) => ({
                ...entry.event,
                timestamp: startedAt.getTime() + index * 1000,
            })),
        } as any;

        const interactions = __researchLakeTestInternals.buildInteractions(session, 'project-key', null);

        expect(interactions.map((interaction) => interaction.funnel_transition)).toEqual(
            cases.map((entry) => entry.transition),
        );
        expect(__researchLakeTestInternals.funnelTransitionAliases).toHaveLength(45);
    });

    it('normalizes configured custom event names before matching funnel transitions', () => {
        const startedAt = new Date('2026-06-08T12:00:00Z');
        const session = {
            id: 'session-config-aliases',
            started_at: startedAt,
            events: [
                { name: 'VIP Plan Bought', timestamp: startedAt.getTime() + 1000 },
                { name: 'Custom Subscriber', timestamp: startedAt.getTime() + 2000 },
            ],
        } as any;

        const interactions = __researchLakeTestInternals.buildInteractions(session, 'project-key', {
            revenueEventName: 'vip_plan_bought',
            subscriberEventName: 'custom-subscriber',
        });

        expect(interactions.map((interaction) => interaction.funnel_transition)).toEqual([
            'purchase_complete',
            'cart_add',
        ]);
    });

    it('places touch events onto the active orientation-aware replay grid', () => {
        const session = {
            id: 'session-grid',
            started_at: new Date('2026-06-08T12:00:00Z'),
            events: [
                { name: 'tap', elapsedMs: 100, x: 640, y: 320, viewportWidth: 1280, viewportHeight: 640 },
                { name: 'tap', elapsedMs: 200, x: 512, y: 384, viewportWidth: 1024, viewportHeight: 768 },
                { name: 'tap', elapsedMs: 300, x: 50, y: 50 },
            ],
        } as any;

        const interactions = __researchLakeTestInternals.buildInteractions(session, 'project-key', null);

        expect(interactions[0]).toMatchObject({
            x_norm_bucket: 500,
            y_norm_bucket: 500,
            x_cell: 64,
            y_cell: 32,
            touch_grid_columns: 128,
            touch_grid_rows: 64,
            screen_orientation: 'landscape',
            screen_form_factor: 'phone',
        });
        expect(interactions[1]).toMatchObject({
            x_norm_bucket: 500,
            y_norm_bucket: 500,
            x_cell: 64,
            y_cell: 48,
            touch_grid_columns: 128,
            touch_grid_rows: 96,
            screen_orientation: 'landscape',
            screen_form_factor: 'tablet',
        });
        expect(interactions[2]).toMatchObject({
            x_norm_bucket: 50,
            y_norm_bucket: 65,
            x_cell: 6,
            y_cell: 6,
            touch_grid_columns: 128,
            touch_grid_rows: 96,
            screen_orientation: 'landscape',
            screen_form_factor: 'tablet',
            viewport_source: 'session_event_fallback',
        });
    });

    it('summarizes hierarchy capture cadence for manifest and quality warnings', () => {
        const screenshotFrames = [0, 500, 1000, 1500].map((elapsed, index) => ({
            frame_key: `s-${index}`,
            source_kind: 'screenshots',
            source_index: index,
            elapsed_ms_bucket: elapsed,
            screen_key: 'screen',
        }));
        const everyOtherHierarchy = [0, 1000].map((elapsed, index) => ({
            frame_key: `h-${index}`,
            source_kind: 'hierarchy',
            source_index: index,
            elapsed_ms_bucket: elapsed,
            screen_key: 'screen',
        }));

        const alignedProfile = __researchLakeTestInternals.buildHierarchyCaptureProfile([
            ...screenshotFrames,
            ...everyOtherHierarchy,
        ] as any);

        expect(alignedProfile).toMatchObject({
            present: true,
            cadence_mode: 'every_other_visual_frame',
            configured_interval_ms: null,
            observed_median_interval_ms: 1000,
            observed_snapshot_count: 2,
            screenshot_frame_count: 4,
            hierarchy_to_screenshot_ratio: 0.5,
            hierarchy_screenshot_alignment_ratio: 1,
            screenshot_hierarchy_coverage_ratio: 1,
            alignment_threshold_ratio: 0.8,
            alignment_tolerance_ms: 500,
            nearest_screenshot_median_delta_ms: 0,
            alignment: 'screenshot_frame_aligned',
        });
        expect(__researchLakeTestInternals.hierarchyCaptureWarnings(alignedProfile)).toEqual([]);
        const alignedRows = __researchLakeTestInternals.annotateHierarchyCaptureProfile({
            frames: everyOtherHierarchy,
            skeleton: [{
                element_key: 'node-1',
                frame_key: 'h-0',
                screen_key: 'screen',
                role: 'button',
                source_kind: 'hierarchy',
            }],
        } as any, alignedProfile);
        expect(alignedRows.frames[0]).toMatchObject({
            source_timing: 'screenshot_frame_aligned_snapshot',
            hierarchy_snapshot_sparse: false,
            hierarchy_capture_cadence: 'every_other_visual_frame',
            hierarchy_capture_alignment: 'screenshot_frame_aligned',
        });
        expect(alignedRows.skeleton[0]).toMatchObject({
            hierarchy_snapshot_sparse: false,
            hierarchy_capture_cadence: 'every_other_visual_frame',
        });

        const sparseProfile = __researchLakeTestInternals.buildHierarchyCaptureProfile([
            ...Array.from({ length: 10 }, (_, index) => ({
                frame_key: `sparse-s-${index}`,
                source_kind: 'screenshots',
                source_index: index,
                elapsed_ms_bucket: index * 500,
                screen_key: 'screen',
            })),
            ...[0, 2000, 4000].map((elapsed, index) => ({
                frame_key: `sparse-h-${index}`,
                source_kind: 'hierarchy',
                source_index: index,
                elapsed_ms_bucket: elapsed,
                screen_key: 'screen',
            })),
        ] as any);

        expect(sparseProfile).toMatchObject({
            present: true,
            cadence_mode: 'fixed_interval',
            observed_median_interval_ms: 2000,
            observed_snapshot_count: 3,
            alignment: 'sparse_timeline',
        });
        expect(__researchLakeTestInternals.hierarchyCaptureWarnings(sparseProfile)).toEqual([
            'hierarchy_sparse_timeline',
            'hierarchy_not_frame_aligned',
        ]);
        const sparseRows = __researchLakeTestInternals.annotateHierarchyCaptureProfile({
            frames: [{
                frame_key: 'sparse-h-0',
                source_kind: 'hierarchy',
                source_index: 0,
                elapsed_ms_bucket: 0,
                screen_key: 'screen',
            }],
            skeleton: [],
        } as any, sparseProfile);
        expect(sparseRows.frames[0]).toMatchObject({
            source_timing: 'sparse_timeline_snapshot',
            hierarchy_snapshot_sparse: true,
            hierarchy_capture_cadence: 'fixed_interval',
            hierarchy_capture_alignment: 'sparse_timeline',
        });

        const perFrameProfile = __researchLakeTestInternals.buildHierarchyCaptureProfile([
            ...screenshotFrames,
            ...screenshotFrames.map((frame, index) => ({
                frame_key: `per-h-${index}`,
                source_kind: 'hierarchy',
                source_index: index,
                elapsed_ms_bucket: frame.elapsed_ms_bucket,
                screen_key: 'screen',
            })),
        ] as any);
        expect(perFrameProfile).toMatchObject({
            cadence_mode: 'per_visual_frame',
            observed_snapshot_count: 4,
            screenshot_frame_count: 4,
            hierarchy_to_screenshot_ratio: 1,
            hierarchy_screenshot_alignment_ratio: 1,
            screenshot_hierarchy_coverage_ratio: 1,
            nearest_screenshot_median_delta_ms: 0,
            alignment: 'screenshot_frame_aligned',
        });
        expect(__researchLakeTestInternals.hierarchyCaptureWarnings(perFrameProfile)).toEqual([]);

        const imperfectFrameAlignedProfile = __researchLakeTestInternals.buildHierarchyCaptureProfile([
            ...Array.from({ length: 10 }, (_, index) => ({
                frame_key: `imperfect-s-${index}`,
                source_kind: 'screenshots',
                source_index: index,
                elapsed_ms_bucket: index * 500,
                screen_key: 'screen',
            })),
            ...Array.from({ length: 8 }, (_, index) => ({
                frame_key: `imperfect-h-${index}`,
                source_kind: 'hierarchy',
                source_index: index,
                elapsed_ms_bucket: index * 500,
                screen_key: 'screen',
            })),
        ] as any);
        expect(imperfectFrameAlignedProfile).toMatchObject({
            cadence_mode: 'per_visual_frame',
            observed_snapshot_count: 8,
            screenshot_frame_count: 10,
            hierarchy_to_screenshot_ratio: 0.8,
            hierarchy_screenshot_alignment_ratio: 1,
            screenshot_hierarchy_coverage_ratio: 0.9,
            alignment_threshold_ratio: 0.8,
            alignment: 'screenshot_frame_aligned',
        });
        expect(__researchLakeTestInternals.hierarchyCaptureWarnings(imperfectFrameAlignedProfile)).toEqual([]);
    });

    it('summarizes masking and keyboard/system surfaces for privacy-safe training gates', () => {
        const session = {
            text_input_masking: 'secure_only',
            image_video_masking: 'all',
        };
        const frames = [
            { frame_key: 'shot-1', source_kind: 'screenshots', source_index: 0, elapsed_ms_bucket: 0, screen_key: 'screen' },
            { frame_key: 'hier-1', source_kind: 'hierarchy', source_index: 1, elapsed_ms_bucket: 0, screen_key: 'screen' },
            { frame_key: 'dom-1', source_kind: 'rrweb', source_index: 2, elapsed_ms_bucket: 0, screen_key: 'screen' },
        ];
        const skeleton = [
            { element_key: 'native-input', frame_key: 'hier-1', screen_key: 'screen', role: 'input', source_kind: 'hierarchy', is_masked: true },
            { element_key: 'keyboard', frame_key: 'hier-1', screen_key: 'screen', role: 'system_surface', source_kind: 'hierarchy', is_keyboard_or_system: true },
            { element_key: 'dom-input', frame_key: 'dom-1', screen_key: 'screen', role: 'input', source_kind: 'rrweb', is_masked: true, has_masked_input_value: true },
            { element_key: 'dom-media', frame_key: 'dom-1', screen_key: 'screen', role: 'media', source_kind: 'rrweb', is_masked: true, has_masked_media_attribute: true },
        ];

        const profile = __researchLakeTestInternals.buildMaskingCaptureProfile(session as any, frames as any, skeleton as any);

        expect(profile).toMatchObject({
            text_input_masking_policy: 'secure_only',
            image_video_masking_policy: 'all',
            screenshot_pixels_post_redaction: true,
            hierarchy_mask_observed: true,
            hierarchy_masked_element_count: 1,
            hierarchy_masked_input_count: 1,
            hierarchy_media_surface_count: 0,
            hierarchy_keyboard_or_system_element_count: 1,
            hierarchy_keyboard_or_system_policy: 'exclude_or_downweight',
            rrweb_mask_observed: true,
            rrweb_masked_element_count: 2,
            rrweb_masked_input_value_count: 1,
            rrweb_masked_media_attribute_count: 1,
            rrweb_media_surface_count: 1,
        });
        expect(__researchLakeTestInternals.maskingCaptureWarnings(profile)).toEqual([
            'masking_text_inputs_secure_only_policy',
            'hierarchy_keyboard_or_system_nodes_present',
        ]);
    });

    it('summarizes rrweb replay quality for curated DOM training gates', () => {
        const rrwebFrames = [
            {
                frame_key: 'dom-0',
                source_kind: 'rrweb',
                source_index: 0,
                elapsed_ms_bucket: 0,
                screen_key: 'screen',
                rrweb_event_type: 2,
                rrweb_event_kind: 'full_snapshot',
                viewport_width_bucket: 1280,
                viewport_height_bucket: 720,
                page_width_bucket: 1280,
                page_height_bucket: 2048,
            },
            {
                frame_key: 'dom-1',
                source_kind: 'rrweb',
                source_index: 1,
                elapsed_ms_bucket: 500,
                screen_key: 'screen',
                rrweb_event_type: 3,
                rrweb_incremental_source: 0,
                rrweb_event_kind: 'mutation',
                viewport_width_bucket: 1280,
                viewport_height_bucket: 720,
                page_width_bucket: 1280,
                page_height_bucket: 2048,
            },
        ];
        const skeleton = [
            { element_key: 'dom-node-1', frame_key: 'dom-0', screen_key: 'screen', role: 'control' },
            { element_key: 'dom-node-2', frame_key: 'dom-1', screen_key: 'screen', role: 'container' },
        ];

        const profile = __researchLakeTestInternals.buildRrwebCaptureProfile(rrwebFrames as any, skeleton as any);

        expect(profile).toMatchObject({
            present: true,
            replay_basis: 'snapshot_plus_incremental',
            event_count: 2,
            full_snapshot_count: 1,
            incremental_count: 1,
            mutation_count: 1,
            dom_skeleton_element_count: 2,
            viewport_missing_count: 0,
            page_missing_count: 0,
            event_span_ms: 500,
        });
        expect(__researchLakeTestInternals.rrwebCaptureWarnings(profile)).toEqual([]);

        const partialProfile = __researchLakeTestInternals.buildRrwebCaptureProfile([{
            frame_key: 'dom-partial',
            source_kind: 'rrweb',
            source_index: 0,
            elapsed_ms_bucket: 0,
            screen_key: 'screen',
            rrweb_event_type: 3,
            rrweb_incremental_source: 0,
            rrweb_event_kind: 'mutation',
            viewport_width_bucket: null,
            viewport_height_bucket: null,
            page_width_bucket: null,
            page_height_bucket: null,
        }] as any, []);

        expect(partialProfile).toMatchObject({
            replay_basis: 'incremental_without_full_snapshot',
            full_snapshot_count: 0,
            mutation_count: 1,
            viewport_missing_count: 1,
            page_missing_count: 1,
        });
        expect(__researchLakeTestInternals.rrwebCaptureWarnings(partialProfile)).toEqual([
            'rrweb_missing_full_snapshot',
            'rrweb_incremental_without_full_snapshot',
            'rrweb_viewport_dimensions_missing',
            'rrweb_page_dimensions_missing',
        ]);
    });

    it('respects customEventConfig for amount/currency property mapping, default currency, and minor units conversion', () => {
        const session = {
            id: 'session-456',
            user_display_id: 'user_1122',
            started_at: new Date('2026-06-08T12:00:00Z'),
            events: [
                {
                    name: 'custom_purchase',
                    timestamp: new Date('2026-06-08T12:00:10Z').getTime(),
                    properties: {
                        custom_amount: 14997, // 149.97 in cents
                        custom_currency: 'EUR',
                        transactionId: 'tx_9999',
                    }
                },
                {
                    name: 'custom_purchase_no_currency',
                    timestamp: new Date('2026-06-08T12:00:20Z').getTime(),
                    properties: {
                        custom_amount: 5000, // 50.00 in cents
                        transactionId: 'tx_10000',
                    }
                }
            ]
        } as any;

        const customEventConfig = {
            revenueEventName: 'custom_purchase',
            conversionEventName: 'custom_purchase_no_currency',
            revenueAmountProperty: 'custom_amount',
            revenueCurrencyProperty: 'custom_currency',
            defaultCurrency: 'GBP',
            amountUnit: 'minor',
        };

        const projectKey = 'test-project-key';
        const interactions = __researchLakeTestInternals.buildInteractions(session, projectKey, customEventConfig);

        expect(interactions).toHaveLength(2);
        
        // 149.97 rounded into the fine low-value money bucket
        expect(interactions[0].cart_value_bucket).toBe(150);
        expect(interactions[0].currency).toBe('EUR');

        // 50.00 rounded into the fine low-value money bucket
        expect(interactions[1].cart_value_bucket).toBe(50);
        // Fallbacks to defaultCurrency GBP
        expect(interactions[1].currency).toBe('GBP');

        const bizContext = __researchLakeTestInternals.buildBusinessContext(session, interactions, [], customEventConfig);
        expect(bizContext.is_conversion_session).toBe(true);
        // total amount is 149.97 + 50.00 = 199.97, rounded to 50 is 200
        expect(bizContext.conversion_revenue_bucket).toBe(200);
        expect(bizContext.currency).toBe('EUR');
    });

    it('builds revenue outcome documents without session, transaction, or provider identity keys', () => {
        const rawProjectId = '3f4f7d8a-7660-4a78-b944-442051c62eca';
        const documents = __researchLakeTestInternals.buildRevenueOutcomeDocuments({
            id: '7bc5c775-c68d-43a7-9b82-f7cd81633823',
            project_id: rawProjectId,
            source_provider: 'revenuecat',
            date: '2026-06-11',
            currency: 'usd',
            gross_amount_cents: 14997,
            refund_amount_cents: 999,
            fee_amount_cents: 0,
            net_amount_cents: 13998,
            transaction_count: 7,
            refund_count: 1,
            subscriber_count: 4,
            trial_count: 2,
            subscription_start_count: 3,
            cancellation_count: 0,
            conversion_count: 0,
            updated_at: new Date('2026-06-11T12:00:00Z'),
        } as any, {
            previousDayNetCents: 10000,
            netDeltaCents: 3998,
            trailing7dNetCents: 70000,
            previous7dNetCents: 50000,
            trailing7dDeltaCents: 20000,
        });

        expect(documents.basePath).toContain('/lake=revenue_outcomes/');
        expect(documents.basePath).not.toContain('/sample_key=');
        expect(documents.manifest).not.toHaveProperty('sample_key');
        expect(documents.dailyRevenue).not.toHaveProperty('sample_key');
        expect(documents.dailyRevenue).toMatchObject({
            provider: 'revenuecat',
            currency: 'usd',
            attribution_scope: 'project_day',
            revenue_observation_grain: 'project_provider_currency_day',
            session_attribution_available: false,
            gross_revenue_bucket: 150,
            refund_revenue_bucket: 10,
            net_revenue_abs_bucket: 140,
            transaction_count_bucket: 10,
            net_revenue_delta_direction: 'increase',
            trailing_7d_net_revenue_delta_abs_bucket: 200,
        });

        const serialized = JSON.stringify(documents);
        expect(serialized).not.toContain(rawProjectId);
        expect(serialized).not.toContain('7bc5c775-c68d-43a7-9b82-f7cd81633823');
        expect(serialized).not.toContain('transaction_id');
        expect(serialized).not.toContain('session_id');
        expect(serialized).not.toContain('customer_id');
        expect(__researchLakeTestInternals.containsIdentifierRisk({
            manifest: documents.manifest,
            quality: documents.quality,
            dailyRevenue: documents.dailyRevenue,
        })).toBe(false);
    });
});
