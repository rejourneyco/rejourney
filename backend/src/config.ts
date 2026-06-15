/**
 * Rejourney Backend Configuration
 * 
 * Type-safe environment variable loader
 * 
 * Copyright (c) 2026 Rejourney
 * 
 * Licensed under the Server Side Public License 1.0 (the "License");
 * you may not use this file except in compliance with the License.
 * See LICENSE-SSPL for full terms.
 */

import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// =============================================================================
// Environment Variable Loading
// =============================================================================

/**
 * Load environment variables based on environment and priority:
 * 1. Process environment (already set - includes Docker Compose env vars)
 * 2. .env.k8s.local / .env.local (if present, prioritized in development)
 * 3. .env (if exists)
 */
function initializeEnv() {
    // Skip file loading if running in Docker (environment vars passed via container env)
    if (process.env.DOCKER_ENV === 'true') {
        return;
    }

    const cwd = process.cwd();
    const candidates: string[] = [];

    if (process.env.NODE_ENV !== 'production') {
        candidates.push(
            path.resolve(cwd, '.env.k8s.local'),
            path.resolve(cwd, '.env.local'),
            path.resolve(cwd, '../.env.k8s.local'),
            path.resolve(cwd, '../.env.local'),
        );
    }

    candidates.push(
        path.resolve(cwd, '.env'),
        path.resolve(cwd, '../.env'),
    );

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            dotenv.config({ path: candidate });
        }
    }
}

// Initialize environment variables before schema parsing
initializeEnv();

const optionalHexEncryptionKey = z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().length(64).optional(),
);

const envSchema = z.object({
    // Server
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().transform(Number).default('3000'),

    // Database
    DATABASE_URL: z.string(),
    // Optional read-replica connection. When set, `dbRead` in db/client.ts uses
    // this; otherwise it falls back to DATABASE_URL. api-dashboard pods set this
    // to the pgbouncer-ro pool fronting the Postgres standby.
    DATABASE_URL_READ: z.string().optional(),

    // ClickHouse analytics projection. These default off so adding the
    // dependency/config is safe before the local/prod clusters exist.
    CLICKHOUSE_ENABLED: z.string().transform(v => v === 'true').default('false'),
    CLICKHOUSE_DUAL_WRITE_ENABLED: z.string().transform(v => v === 'true').default('false'),
    CLICKHOUSE_READS_ENABLED: z.string().transform(v => v === 'true').default('false'),
    CLICKHOUSE_URL: z.string().optional(),
    CLICKHOUSE_USER: z.string().default('default'),
    CLICKHOUSE_PASSWORD: z.string().optional(),
    CLICKHOUSE_DATABASE: z.string().default('rejourney'),
    CLICKHOUSE_ASYNC_INSERT: z.string().transform(v => v !== 'false').default('true'),
    CLICKHOUSE_REQUEST_TIMEOUT_MS: z.string().transform(Number).default('5000'),

    // Private issue-detection integration. The UI/API default is intentionally
    // closed unless explicitly enabled by runtime env.
    SHOW_ISSUE_DETECTION_UI: z.preprocess(
        (value) => value === 'true',
        z.boolean(),
    ).default(false),
    ISSUE_DETECTION_API_URL: z.string().optional(),
    ISSUE_DETECTION_SERVICE_SECRET: z.string().optional(),
    // Customer-facing GitHub App (issue-detection source access). SLUG builds the
    // install URL; STATE_SECRET signs the setup-redirect state. Unset => the
    // install-url / setup-callback routes answer 503 (closed by default).
    GITHUB_APP_SLUG: z.string().optional(),
    GITHUB_APP_STATE_SECRET: z.string().min(32).optional(),
    REJOURNEY_INTERNAL_API_URL: z.string().optional(),
    REJOURNEY_INTERNAL_SERVICE_SECRET: z.string().optional(),
    RJ_API_ROLE: z.enum(['dashboard', 'ingest']).optional(),

    // Redis
    REDIS_URL: z.string().default('redis://localhost:6379/0'),
    // Redis Sentinel (optional — when set, app connects via Sentinel instead of URL)
    REDIS_SENTINEL_HOST: z.string().optional(),
    REDIS_SENTINEL_PORT: z.coerce.number().optional().default(26379),
    REDIS_MASTER_NAME: z.string().optional().default('mymaster'),
    REDIS_PASSWORD: z.string().optional(),

    // S3/MinIO bootstrap inputs.
    // Runtime storage routing is database-backed via storage_endpoints.
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_PUBLIC_ENDPOINT: z.string().optional(),
    RETENTION_BATCH_SIZE: z.string().transform(Number).default('100'),
    RETENTION_REPAIR_BATCH_SIZE: z.string().transform(Number).default('100'),
    RETENTION_MAX_RUNTIME_MS: z.string().transform(Number).default('240000'),
    RETENTION_S3_CONCURRENCY: z.string().transform(Number).default('4'),
    RETENTION_FAIL_ON_MISSING_STORAGE: z.string().transform(v => v === 'true').default('false'),
    RESEARCH_LAKE_ENABLED: z.string().transform(v => v === 'true').default('false'),
    RESEARCH_LAKE_ENDPOINT: z.string().optional(),
    RESEARCH_LAKE_BUCKET: z.string().optional(),
    RESEARCH_LAKE_REGION: z.string().default('us-east-1'),
    RESEARCH_LAKE_ACCESS_KEY_ID: z.string().optional(),
    RESEARCH_LAKE_SECRET_ACCESS_KEY: z.string().optional(),
    RESEARCH_LAKE_PREFIX: z.string().default('v1'),
    RESEARCH_LAKE_BATCH_SIZE: z.string().transform(Number).default('50'),
    RESEARCH_LAKE_CONCURRENCY: z.string().transform(Number).default('4'),
    RESEARCH_LAKE_MAX_RUNTIME_MS: z.string().transform(Number).default('240000'),
    RESEARCH_LAKE_LOOKAHEAD_HOURS: z.string().transform(Number).default('24'),
    RESEARCH_LAKE_MIN_EVENT_COUNT: z.string().transform(Number).default('3'),
    RESEARCH_LAKE_HASH_SECRET: z.string().optional(),

    // Auth
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().optional(),
    INGEST_HMAC_SECRET: z.string().min(32),
    SHARE_LINK_SECRET: z.string().min(32).optional(),

    // SMTP (optional in dev)
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().transform(Number).optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    SMTP_SECURE: z.string().transform(v => v === 'true').optional(),

    // Turnstile (optional)
    TURNSTILE_SITE_KEY: z.string().optional(),
    TURNSTILE_SECRET_KEY: z.string().optional(),

    // GitHub OAuth (optional)
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    OAUTH_REDIRECT_BASE: z.string().optional(),

    // Stripe (optional)
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    SUPERWALL_API_BASE_URL: z.string().default('https://api.superwall.com'),
    REVENUECAT_API_BASE_URL: z.string().default('https://api.revenuecat.com/v2'),

    // AI query builder (optional)
    QUERY_BUILDER_KEY: z.string().optional(),
    QUERY_BUILDER_MODEL: z.string().default('gemini-3.1-flash-lite-preview'),

    // URLs
    PUBLIC_DASHBOARD_URL: z.string().optional(),
    DASHBOARD_ORIGIN: z.string().optional(),
    ADDITIONAL_DASHBOARD_ORIGINS: z.string().optional(),
    PUBLIC_API_URL: z.string().optional(),
    PUBLIC_INGEST_URL: z.string().optional(),

    // Limits
    MAX_RECORDING_MINUTES: z.string().transform(Number).default('10'),
    INGEST_MAX_OBJECT_BYTES: z.string().transform(Number).default('26214400'), // 25 MB
    INGEST_DEVICE_BYTES_PER_MINUTE: z.string().transform(Number).default('52428800'), // 50 MB/min per device
    INGEST_DEVICE_BYTES_PER_DAY: z.string().transform(Number).default('2147483648'), // 2 GB/day per device
    INGEST_PROJECT_BYTES_PER_MINUTE: z.string().transform(Number).default('536870912'), // 512 MB/min per project
    INGEST_PROJECT_BYTES_PER_DAY: z.string().transform(Number).default('107374182400'), // 100 GB/day per project
    INGEST_IP_BYTES_PER_MINUTE: z.string().transform(Number).default('104857600'), // 100 MB/min per IP
    INGEST_IP_BYTES_PER_DAY: z.string().transform(Number).default('5368709120'), // 5 GB/day per IP

    // Storage encryption
    STORAGE_ENCRYPTION_KEY: z.string().length(64).optional(), // 32-byte hex key

    // Superwall API key encryption
    SUPERWALL_API_KEY_ENCRYPTION_KEY: optionalHexEncryptionKey, // 32-byte hex key

    // RevenueCat API key encryption
    REVENUECAT_API_KEY_ENCRYPTION_KEY: optionalHexEncryptionKey, // 32-byte hex key

    // Logging
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

});

type Env = z.infer<typeof envSchema>;

function loadConfig(): Env {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        console.error('❌ Invalid environment variables:');
        console.error(result.error.format());
        process.exit(1);
    }

    return result.data;
}

export const config = loadConfig();

// Derived config values
export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';

// Rate limit defaults (increased for dashboard with many parallel requests)
export const rateLimits = {
    // Ingest uploads: per-project
    ingest: {
        // Split project buckets by route family so hot replay traffic does not
        // starve batch ingest, lifecycle closure, or fault ingest.
        perProjectAuth: { windowMs: 60_000, max: 3000 },
        perProjectBatch: { windowMs: 60_000, max: 20000 },
        perProjectSegment: { windowMs: 60_000, max: 50000 },
        perProjectLifecycle: { windowMs: 60_000, max: 4000 },
        perProjectFault: { windowMs: 60_000, max: 2000 },
        // Keep device auth conservative, but do not let it share a bucket with
        // high-frequency ingest presign routes.
        perDeviceAuth: { windowMs: 60_000, max: 120 },
        perDeviceBatch: { windowMs: 60_000, max: 120 },
        // Replay sessions can legitimately emit many segment presigns per minute.
        perDeviceSegment: { windowMs: 60_000, max: 1500 },
        maxBodyBytes: 5 * 1024 * 1024, // 5 MB
        byteQuota: {
            maxObjectBytes: config.INGEST_MAX_OBJECT_BYTES,
            perDevicePerMinuteBytes: config.INGEST_DEVICE_BYTES_PER_MINUTE,
            perDevicePerDayBytes: config.INGEST_DEVICE_BYTES_PER_DAY,
            perProjectPerMinuteBytes: config.INGEST_PROJECT_BYTES_PER_MINUTE,
            perProjectPerDayBytes: config.INGEST_PROJECT_BYTES_PER_DAY,
            perIpPerMinuteBytes: config.INGEST_IP_BYTES_PER_MINUTE,
            perIpPerDayBytes: config.INGEST_IP_BYTES_PER_DAY,
        },
    },
    // Dashboard APIs (high limits needed for frames, heatmaps, etc.)
    dashboard: {
        perUser: { windowMs: 60_000, max: 1200 },
        perProject: { windowMs: 60_000, max: 2400 },
        stats: { windowMs: 120_000, max: 80 },
        queryBuilderUser: { windowMs: 60 * 60_000, max: 100 },
        queryBuilderProject: { windowMs: 24 * 60 * 60_000, max: 1000 },
        queryBuilderIp: { windowMs: 60 * 60_000, max: 300 },
    },
    // Auth/OTP
    auth: {
        otpSend: { windowMs: 15 * 60_000, max: 10 },
        otpVerify: { windowMs: 60_000, max: 30 },
    },
    // API key traffic
    apiKey: {
        perProject: { windowMs: 60_000, max: 1000 },
        safeMode: { windowMs: 60_000, max: 300 },
    },
    // Signed URLs
    signedUrl: { windowMs: 60_000, max: 300 },
    // Network endpoints
    network: { windowMs: 60_000, max: 300 },
    // Admin/billing
    admin: { windowMs: 60_000, max: 120 },
};

// Retention tiers
export const retentionTiers = [
    { tier: 1, days: 7 },  // Free
    { tier: 2, days: 14 },
    { tier: 3, days: 30 },
    { tier: 4, days: 60 },
    { tier: 5, days: 3650 },
    { tier: 6, days: 36500 }, // Unlimited (100 years)
];
