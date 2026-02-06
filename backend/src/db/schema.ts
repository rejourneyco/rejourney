/**
 * Drizzle ORM Database Schema
 *
 * Translated from Prisma schema.prisma to Drizzle ORM
 */

import {
    pgTable,
    uuid,
    varchar,
    text,
    boolean,
    integer,
    bigint,
    doublePrecision,
    timestamp,
    date,
    json,
    uniqueIndex,
    index,
    primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm/_relations';

// =============================================================================
// Core User & Team Models
// =============================================================================

export const users = pgTable(
    'users',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        email: varchar('email', { length: 255 }).unique().notNull(),
        displayName: varchar('display_name', { length: 255 }),
        avatarUrl: text('avatar_url'),
        authProvider: varchar('auth_provider', { length: 50 }),
        providerUserId: varchar('provider_user_id', { length: 255 }),
        roles: text('roles').array().default(sql`ARRAY['user']::text[]`),
        lastDataExportAt: timestamp('last_data_export_at'), // GDPR: rate limit data exports to once per 30 days
        // Fingerprinting fields for duplicate account detection
        registrationIp: varchar('registration_ip', { length: 45 }), // IPv4/IPv6 at registration
        registrationUserAgent: text('registration_user_agent'), // Full user-agent at registration
        registrationTimezone: varchar('registration_timezone', { length: 100 }), // Browser timezone (e.g., "America/Chicago")
        browserFingerprint: varchar('browser_fingerprint', { length: 64 }), // SHA-256 hash of canvas/WebGL fingerprint
        screenResolution: varchar('screen_resolution', { length: 20 }), // Screen dimensions (e.g., "1920x1080")
        languagePreference: varchar('language_preference', { length: 50 }), // Browser accept-language
        registrationPlatform: varchar('registration_platform', { length: 50 }), // Parsed OS/platform
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    }
);

export const userSessions = pgTable(
    'user_sessions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
        token: varchar('token', { length: 255 }).unique().notNull(),
        userAgent: text('user_agent'),
        ipAddress: varchar('ip_address', { length: 45 }),
        expiresAt: timestamp('expires_at').notNull(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [
        index('user_sessions_user_id_idx').on(table.userId),
        index('user_sessions_token_idx').on(table.token),
    ]
);

export const otpTokens = pgTable(
    'otp_tokens',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
        email: varchar('email', { length: 255 }).notNull(),
        codeHash: varchar('code_hash', { length: 255 }).notNull(),
        expiresAt: timestamp('expires_at').notNull(),
        attempts: integer('attempts').default(0).notNull(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [
        index('otp_tokens_email_idx').on(table.email),
    ]
);

export const teams = pgTable('teams', {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
    name: varchar('name', { length: 255 }),
    // Stripe integration - subscription and billing
    stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
    stripePaymentMethodId: varchar('stripe_payment_method_id', { length: 255 }),
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
    stripePriceId: varchar('stripe_price_id', { length: 255 }), // Current active Stripe Price
    billingEmail: varchar('billing_email', { length: 255 }),
    // Billing cycle anchor - when the team's billing cycle started
    billingCycleAnchor: timestamp('billing_cycle_anchor'),
    paymentFailedAt: timestamp('payment_failed_at'), // Set when payment fails, cleared on success
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const teamMembers = pgTable(
    'team_members',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
        userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
        role: varchar('role', { length: 50 }).default('member').notNull(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('team_members_team_user_unique').on(table.teamId, table.userId),
    ]
);

export const teamInvitations = pgTable(
    'team_invitations',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
        email: varchar('email', { length: 255 }).notNull(),
        role: varchar('role', { length: 50 }).default('member').notNull(),
        token: varchar('token', { length: 64 }).unique().notNull(),
        invitedBy: uuid('invited_by').notNull().references(() => users.id),
        expiresAt: timestamp('expires_at').notNull(),
        acceptedAt: timestamp('accepted_at'),
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [
        index('team_invitations_token_idx').on(table.token),
        index('team_invitations_email_idx').on(table.email),
    ]
);

// =============================================================================
// Project Models
// =============================================================================

export const projects = pgTable(
    'projects',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        teamId: uuid('team_id').notNull().references(() => teams.id),
        name: varchar('name', { length: 255 }).notNull(),
        platform: varchar('platform', { length: 50 }),
        bundleId: varchar('bundle_id', { length: 255 }),
        packageName: varchar('package_name', { length: 255 }),
        webDomain: varchar('web_domain', { length: 255 }),
        publicKey: varchar('public_key', { length: 64 }).notNull(),
        sampleRate: integer('sample_rate').default(100).notNull(),
        rejourneyEnabled: boolean('rejourney_enabled').default(true).notNull(),
        recordingEnabled: boolean('recording_enabled').default(true).notNull(),
        maxRecordingMinutes: integer('max_recording_minutes').default(10).notNull(),
        // Replay promotion: healthy session promotion rate (0.0 - 1.0)
        healthyReplaysPromoted: doublePrecision('healthy_replays_promoted').default(0.05).notNull(),
        deletedAt: timestamp('deleted_at'),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        index('projects_team_id_idx').on(table.teamId),
        index('projects_public_key_idx').on(table.publicKey),
    ]
);

export const apiKeys = pgTable(
    'api_keys',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        hashedKey: varchar('hashed_key', { length: 255 }).notNull(),
        name: varchar('name', { length: 255 }),
        maskedKey: varchar('masked_key', { length: 50 }).notNull(),
        scopes: text('scopes').array().default(sql`ARRAY['ingest']::text[]`),
        lastUsedAt: timestamp('last_used_at'),
        revokedAt: timestamp('revoked_at'),
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [
        index('api_keys_hashed_key_idx').on(table.hashedKey),
        index('api_keys_project_id_idx').on(table.projectId),
    ]
);

// =============================================================================
// NOTE: deviceRegistrations table was removed along with the dead ECDSA auth flow.
// The device_usage table now uses varchar device IDs (SHA-256 fingerprints)
// scoped per project instead of FK-ing to a registration table.

export const appAllTimeStats = pgTable('app_all_time_stats', {
    projectId: uuid('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
    totalSessions: bigint('total_sessions', { mode: 'bigint' }).default(sql`0`),
    totalUsers: bigint('total_users', { mode: 'bigint' }).default(sql`0`),
    totalEvents: bigint('total_events', { mode: 'bigint' }).default(sql`0`),
    totalErrors: bigint('total_errors', { mode: 'bigint' }).default(sql`0`),
    avgSessionDurationSeconds: doublePrecision('avg_session_duration_seconds').default(0),
    avgInteractionScore: doublePrecision('avg_interaction_score').default(0),
    avgUxScore: doublePrecision('avg_ux_score').default(0),
    avgApiErrorRate: doublePrecision('avg_api_error_rate').default(0),
    totalRageTaps: bigint('total_rage_taps', { mode: 'bigint' }).default(sql`0`),
    totalDeadTaps: bigint('total_dead_taps', { mode: 'bigint' }).default(sql`0`),

    // Engagement Segments
    totalBouncers: bigint('total_bouncers', { mode: 'bigint' }).default(sql`0`),
    totalCasuals: bigint('total_casuals', { mode: 'bigint' }).default(sql`0`),
    totalExplorers: bigint('total_explorers', { mode: 'bigint' }).default(sql`0`),
    totalLoyalists: bigint('total_loyalists', { mode: 'bigint' }).default(sql`0`),

    // Interaction Breakdown (All Time)
    totalTouches: bigint('total_touches', { mode: 'bigint' }).default(sql`0`),
    totalScrolls: bigint('total_scrolls', { mode: 'bigint' }).default(sql`0`),
    totalGestures: bigint('total_gestures', { mode: 'bigint' }).default(sql`0`),
    totalInteractions: bigint('total_interactions', { mode: 'bigint' }).default(sql`0`),

    // Device Breakdowns (JSONB: { "model": count })
    deviceModelBreakdown: json('device_model_breakdown').$type<Record<string, number>>().default({}),
    osVersionBreakdown: json('os_version_breakdown').$type<Record<string, number>>().default({}),
    platformBreakdown: json('platform_breakdown').$type<Record<string, number>>().default({}),
    appVersionBreakdown: json('app_version_breakdown').$type<Record<string, number>>().default({}),

    // Journey Breakdowns (JSONB)
    screenViewBreakdown: json('screen_view_breakdown').$type<Record<string, number>>().default({}),
    screenTransitionBreakdown: json('screen_transition_breakdown').$type<Record<string, number>>().default({}),
    entryScreenBreakdown: json('entry_screen_breakdown').$type<Record<string, number>>().default({}),
    exitScreenBreakdown: json('exit_screen_breakdown').$type<Record<string, number>>().default({}),

    // Geo Breakdown
    geoCountryBreakdown: json('geo_country_breakdown').$type<Record<string, number>>().default({}),

    // Unique Users
    uniqueUserCount: bigint('unique_user_count', { mode: 'bigint' }).default(sql`0`),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const deviceUsage = pgTable(
    'device_usage',
    {
        deviceId: varchar('device_id', { length: 64 }).notNull(), // SHA-256 fingerprint
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        period: date('period').notNull(), // daily granularity (YYYY-MM-DD)
        bytesUploaded: bigint('bytes_uploaded', { mode: 'bigint' }).default(sql`0`).notNull(),
        minutesRecorded: integer('minutes_recorded').default(0).notNull(),
        sessionsStarted: integer('sessions_started').default(0).notNull(),
        requestCount: integer('request_count').default(0).notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.deviceId, table.projectId, table.period] }),
        index('device_usage_project_idx').on(table.projectId),
        index('device_usage_period_idx').on(table.period),
    ]
);

// =============================================================================
// Audit Logging (Security & Compliance)
// =============================================================================

/**
 * Audit log for sensitive operations
 * 
 * Provides a tamper-proof trail for security-sensitive actions like:
 * - Spend cap changes
 * - API key creation/deletion
 * - Project/team deletion
 * - User permission changes
 * - Billing updates
 */
export const auditLogs = pgTable(
    'audit_logs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
        teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
        action: varchar('action', { length: 100 }).notNull(), // 'spend_cap_updated', 'api_key_created', 'project_deleted', etc.
        targetType: varchar('target_type', { length: 50 }), // 'team', 'project', 'session', 'api_key', 'user'
        targetId: varchar('target_id', { length: 100 }), // ID of the affected resource
        previousValue: json('previous_value'), // State before the change
        newValue: json('new_value'), // State after the change
        ipAddress: varchar('ip_address', { length: 45 }), // IPv4 or IPv6
        userAgent: text('user_agent'),
        metadata: json('metadata'), // Additional context (e.g., request path, etc.)
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [
        index('audit_logs_user_id_idx').on(table.userId),
        index('audit_logs_team_id_idx').on(table.teamId),
        index('audit_logs_action_idx').on(table.action),
        index('audit_logs_target_idx').on(table.targetType, table.targetId),
        index('audit_logs_created_at_idx').on(table.createdAt),
    ]
);


// =============================================================================
// Session & Event Models
// =============================================================================

export const sessions = pgTable(
    'sessions',
    {
        id: varchar('id', { length: 64 }).primaryKey().notNull(),
        projectId: uuid('project_id').notNull().references(() => projects.id),
        deviceId: varchar('device_id', { length: 255 }),
        platform: varchar('platform', { length: 20 }),
        appVersion: varchar('app_version', { length: 50 }),
        deviceModel: varchar('device_model', { length: 100 }),
        osVersion: text('os_version'),
        sdkVersion: text('sdk_version'),
        userDisplayId: varchar('user_display_id', { length: 255 }), // User ID for dashboard display
        anonymousHash: varchar('anonymous_hash', { length: 255 }),
        anonymousDisplayId: varchar('anonymous_display_id', { length: 255 }), // Original anonymousId for display
        startedAt: timestamp('started_at').defaultNow().notNull(),
        endedAt: timestamp('ended_at'),
        durationSeconds: integer('duration_seconds'),
        backgroundTimeSeconds: integer('background_time_seconds').default(0),
        status: varchar('status', { length: 20 }).default('pending').notNull(),
        // NOTE: s3ObjectKey, sizeBytes, checksum removed - use recordingArtifacts table instead
        retentionTier: integer('retention_tier').default(1).notNull(),

        retentionDays: integer('retention_days').default(7).notNull(),
        recordingDeleted: boolean('recording_deleted').default(false).notNull(),
        recordingDeletedAt: timestamp('recording_deleted_at'),
        isReplayExpired: boolean('is_replay_expired').default(false).notNull(),

        // Replay promotion status
        replayPromoted: boolean('replay_promoted').default(false).notNull(),
        replayPromotedReason: varchar('replay_promoted_reason', { length: 50 }),
        replayPromotedAt: timestamp('replay_promoted_at'),

        // Geo location
        geoCity: varchar('geo_city', { length: 100 }),
        geoRegion: varchar('geo_region', { length: 100 }),
        geoCountry: varchar('geo_country', { length: 100 }),
        geoCountryCode: varchar('geo_country_code', { length: 10 }),
        geoLatitude: doublePrecision('geo_latitude'),
        geoLongitude: doublePrecision('geo_longitude'),
        geoTimezone: varchar('geo_timezone', { length: 100 }),

        // Replay ranking
        replayPromotionScore: doublePrecision('replay_promotion_score'),

        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),

        // Video segment capture (new architecture)
        segmentCount: integer('segment_count').default(0),
        videoStorageBytes: bigint('video_storage_bytes', { mode: 'number' }).default(0),

        // Server-side enforcement: SDK's sampling decision (for rejecting video/screenshot uploads)
        isSampledIn: boolean('is_sampled_in').default(true).notNull(),
    },
    (table) => [
        index('sessions_project_started_idx').on(table.projectId, table.startedAt),
        index('sessions_status_idx').on(table.status),
        index('sessions_user_display_id_idx').on(table.userDisplayId),
        index('sessions_anonymous_hash_idx').on(table.anonymousHash),
    ]
);

export const sessionMetrics = pgTable('session_metrics', {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: varchar('session_id', { length: 64 }).unique().notNull().references(() => sessions.id, { onDelete: 'cascade' }),
    totalEvents: integer('total_events').default(0).notNull(),
    errorCount: integer('error_count').default(0).notNull(),
    touchCount: integer('touch_count').default(0).notNull(),
    scrollCount: integer('scroll_count').default(0).notNull(),
    gestureCount: integer('gesture_count').default(0).notNull(),
    inputCount: integer('input_count').default(0).notNull(),
    apiSuccessCount: integer('api_success_count').default(0).notNull(),
    apiErrorCount: integer('api_error_count').default(0).notNull(),
    apiTotalCount: integer('api_total_count').default(0).notNull(),
    apiAvgResponseMs: doublePrecision('api_avg_response_ms').default(0).notNull(),
    rageTapCount: integer('rage_tap_count').default(0).notNull(),
    deadTapCount: integer('dead_tap_count').default(0).notNull(),
    screensVisited: text('screens_visited').array().default(sql`ARRAY[]::text[]`),
    interactionScore: doublePrecision('interaction_score').default(0).notNull(),
    explorationScore: doublePrecision('exploration_score').default(0).notNull(),
    uxScore: doublePrecision('ux_score').default(0).notNull(),
    eventsSizeBytes: integer('events_size_bytes').default(0).notNull(),
    // NOTE: netTotalBytes and netAvgDurationMs removed - use apiAvgResponseMs instead
    customEventCount: integer('custom_event_count').default(0).notNull(),

    crashCount: integer('crash_count').default(0).notNull(),
    anrCount: integer('anr_count').default(0).notNull(),
    appStartupTimeMs: doublePrecision('app_startup_time_ms'),
    // Network quality metrics
    networkType: varchar('network_type', { length: 20 }), // wifi, cellular, wired, none, other
    cellularGeneration: varchar('cellular_generation', { length: 10 }), // 2G, 3G, 4G, 5G, unknown
    isConstrained: boolean('is_constrained').default(false), // Low data mode
    isExpensive: boolean('is_expensive').default(false), // Metered connection

    // SDK Telemetry / Health Metrics
    sdkUploadSuccessCount: integer('sdk_upload_success_count').default(0),
    sdkUploadFailureCount: integer('sdk_upload_failure_count').default(0),
    sdkRetryAttemptCount: integer('sdk_retry_attempt_count').default(0),
    sdkCircuitBreakerOpenCount: integer('sdk_circuit_breaker_open_count').default(0),
    sdkMemoryEvictionCount: integer('sdk_memory_eviction_count').default(0),
    sdkOfflinePersistCount: integer('sdk_offline_persist_count').default(0),
    sdkUploadSuccessRate: doublePrecision('sdk_upload_success_rate'),
    sdkAvgUploadDurationMs: doublePrecision('sdk_avg_upload_duration_ms'),
    sdkTotalBytesUploaded: bigint('sdk_total_bytes_uploaded', { mode: 'bigint' }),
    sdkTotalBytesEvicted: bigint('sdk_total_bytes_evicted', { mode: 'bigint' }),

    // Video segment metrics (new architecture)
    videoSegmentCount: integer('video_segment_count').default(0),
    videoTotalBytes: bigint('video_total_bytes', { mode: 'number' }).default(0),
    hierarchySnapshotCount: integer('hierarchy_snapshot_count').default(0),
    // Screenshot segment metrics (iOS screenshot-based capture)
    screenshotSegmentCount: integer('screenshot_segment_count').default(0),
    screenshotTotalBytes: bigint('screenshot_total_bytes', { mode: 'number' }).default(0),
});



export const recordingArtifacts = pgTable(
    'recording_artifacts',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        sessionId: varchar('session_id', { length: 64 }).notNull().references(() => sessions.id, { onDelete: 'cascade' }),
        kind: varchar('kind', { length: 50 }).notNull(), // 'events', 'video', 'hierarchy', 'crashes', 'anrs'
        s3ObjectKey: text('s3_object_key').notNull(),
        sizeBytes: integer('size_bytes'),
        status: varchar('status', { length: 20 }).default('pending').notNull(),
        readyAt: timestamp('ready_at'),
        timestamp: doublePrecision('timestamp'),
        // Video segment specific fields
        startTime: bigint('start_time', { mode: 'number' }), // Segment start time in epoch ms
        endTime: bigint('end_time', { mode: 'number' }), // Segment end time in epoch ms
        frameCount: integer('frame_count'), // Number of frames in video segment
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [
        index('recording_artifacts_session_id_idx').on(table.sessionId),
        index('recording_artifacts_video_idx').on(table.sessionId, table.kind),
    ]
);



// =============================================================================
// Storage Models
// =============================================================================

export const storageEndpoints = pgTable('storage_endpoints', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id),
    endpointUrl: text('endpoint_url').notNull(),
    bucket: varchar('bucket', { length: 255 }).notNull(),
    region: varchar('region', { length: 50 }),
    accessKeyId: varchar('access_key_id', { length: 255 }),
    keyRef: varchar('key_ref', { length: 255 }),
    roleArn: varchar('role_arn', { length: 255 }),
    kmsKeyId: varchar('kms_key_id', { length: 255 }),
    priority: integer('priority').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    shadow: boolean('shadow').default(false).notNull(),
});

// =============================================================================
// Ingest & Idempotency Models
// =============================================================================

export const ingestJobs = pgTable(
    'ingest_jobs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id),
        sessionId: varchar('session_id', { length: 64 }),
        artifactId: uuid('artifact_id').references(() => recordingArtifacts.id, { onDelete: 'cascade' }),
        kind: varchar('kind', { length: 50 }), // 'events', 'video', 'hierarchy', 'crashes', 'anrs'
        payloadRef: text('payload_ref'),
        status: varchar('status', { length: 20 }).default('pending').notNull(),
        attempts: integer('attempts').default(0).notNull(),
        nextRunAt: timestamp('next_run_at'),
        errorMsg: text('error_msg'),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        index('ingest_jobs_status_next_run_idx').on(table.status, table.nextRunAt),
        index('ingest_jobs_project_id_idx').on(table.projectId),
    ]
);


// =============================================================================
// Billing & Usage Models
// =============================================================================

export const projectUsage = pgTable(
    'project_usage',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id),
        period: varchar('period', { length: 10 }).notNull(),
        sessions: integer('sessions').default(0).notNull(),
        storageBytes: bigint('storage_bytes', { mode: 'bigint' }).default(sql`0`).notNull(),
        requests: integer('requests').default(0).notNull(),
        quotaVersion: integer('quota_version').default(1).notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('project_usage_project_period_version_unique').on(table.projectId, table.period, table.quotaVersion),
    ]
);

export const billingUsage = pgTable(
    'billing_usage',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        teamId: uuid('team_id').notNull().references(() => teams.id),
        period: varchar('period', { length: 10 }).notNull(),
        sessions: integer('sessions').default(0).notNull(),
        storageBytes: bigint('storage_bytes', { mode: 'bigint' }).default(sql`0`).notNull(),
        requests: integer('requests').default(0).notNull(),
        amountCents: integer('amount_cents'),
        quotaVersion: integer('quota_version').default(1).notNull(),
        computedAt: timestamp('computed_at'),
        invoiceStatus: varchar('invoice_status', { length: 20 }),
        invoiceUrl: text('invoice_url'),
    },
    (table) => [
        uniqueIndex('billing_usage_team_period_unique').on(table.teamId, table.period),
    ]
);

// =============================================================================
// Billing (Stripe Products)
// =============================================================================

// NOTE: Billing plans are now managed via Stripe Products/Prices.
// The session_limit is stored in Stripe Price metadata.
// Custom enterprise pricing uses custom Stripe Prices.
// Old tables (billing_plans, custom_billing_configs) have been removed.

// Table removed: quotas

export const retentionPolicies = pgTable('retention_policies', {
    id: uuid('id').primaryKey().defaultRandom(),
    tier: integer('tier').unique().notNull(),
    retentionDays: integer('retention_days').notNull(),
    effectiveAt: timestamp('effective_at').defaultNow().notNull(),
});

// =============================================================================
// Stripe & Billing Notifications
// =============================================================================

/**
 * Stripe Webhook Events - for idempotency
 * Stores processed Stripe webhook event IDs to prevent duplicate processing
 */
export const stripeWebhookEvents = pgTable(
    'stripe_webhook_events',
    {
        id: varchar('id', { length: 255 }).primaryKey(), // Stripe event ID
        type: varchar('type', { length: 100 }).notNull(), // e.g., 'invoice.paid'
        processedAt: timestamp('processed_at').defaultNow().notNull(),
        metadata: json('metadata'), // Optional: store relevant event data
    },
    (table) => [
        index('stripe_webhook_events_type_idx').on(table.type),
    ]
);

/**
 * Billing Notifications - track sent alerts
 * Types: 'session_limit_80', 'session_limit_100', 'payment_failed'
 */
export const billingNotifications = pgTable(
    'billing_notifications',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
        userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // For user-level (free tier) notifications
        type: varchar('type', { length: 50 }).notNull(),
        period: varchar('period', { length: 10 }).notNull(), // YYYY-MM
        metadata: json('metadata'), // e.g., { amountCents: 45 } for sub_50_rollover
        sentAt: timestamp('sent_at').defaultNow().notNull(),
    },
    (table) => [
        index('billing_notifications_team_period_idx').on(table.teamId, table.period),
        index('billing_notifications_user_period_idx').on(table.userId, table.period),
        index('billing_notifications_type_idx').on(table.type),
    ]
);



// =============================================================================
// Analytics Models
// =============================================================================



export const appDailyStats = pgTable(
    'app_daily_stats',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        date: date('date').notNull(),
        totalSessions: integer('total_sessions').default(0).notNull(),
        completedSessions: integer('completed_sessions').default(0).notNull(),
        avgDurationSeconds: doublePrecision('avg_duration_seconds'),
        avgInteractionScore: doublePrecision('avg_interaction_score'),
        avgUxScore: doublePrecision('avg_ux_score'),
        avgApiErrorRate: doublePrecision('avg_api_error_rate'),
        avgApiResponseMs: doublePrecision('avg_api_response_ms'),
        p50Duration: doublePrecision('p50_duration'),
        p90Duration: doublePrecision('p90_duration'),
        p50InteractionScore: doublePrecision('p50_interaction_score'),
        p90InteractionScore: doublePrecision('p90_interaction_score'),
        totalErrors: integer('total_errors').default(0).notNull(),
        totalRageTaps: integer('total_rage_taps').default(0).notNull(),
        totalDeadTaps: integer('total_dead_taps').default(0).notNull(),
        totalCrashes: integer('total_crashes').default(0).notNull(),
        totalAnrs: integer('total_anrs').default(0).notNull(),
        // Engagement Segments
        totalBouncers: integer('total_bouncers').default(0).notNull(),
        totalCasuals: integer('total_casuals').default(0).notNull(),
        totalExplorers: integer('total_explorers').default(0).notNull(),
        totalLoyalists: integer('total_loyalists').default(0).notNull(),
        // Interaction Breakdown
        totalTouches: integer('total_touches').default(0).notNull(),
        totalScrolls: integer('total_scrolls').default(0).notNull(),
        totalGestures: integer('total_gestures').default(0).notNull(),
        totalInteractions: integer('total_interactions').default(0).notNull(),

        // Device Breakdowns (JSONB: { "model": count })
        deviceModelBreakdown: json('device_model_breakdown').$type<Record<string, number>>().default({}),
        osVersionBreakdown: json('os_version_breakdown').$type<Record<string, number>>().default({}),
        platformBreakdown: json('platform_breakdown').$type<Record<string, number>>().default({}),
        appVersionBreakdown: json('app_version_breakdown').$type<Record<string, number>>().default({}),

        // Journey Breakdowns (JSONB)
        screenViewBreakdown: json('screen_view_breakdown').$type<Record<string, number>>().default({}),
        screenTransitionBreakdown: json('screen_transition_breakdown').$type<Record<string, number>>().default({}),
        entryScreenBreakdown: json('entry_screen_breakdown').$type<Record<string, number>>().default({}),
        exitScreenBreakdown: json('exit_screen_breakdown').$type<Record<string, number>>().default({}),

        // Geo Breakdown
        geoCountryBreakdown: json('geo_country_breakdown').$type<Record<string, number>>().default({}),

        // Unique Users
        uniqueUserCount: integer('unique_user_count').default(0).notNull(),
        uniqueUserIds: json('unique_user_ids').$type<string[]>().default([]),
    },
    (table) => [
        uniqueIndex('app_daily_stats_project_date_unique').on(table.projectId, table.date),
    ]
);

// API Endpoint Daily Stats - Per-endpoint performance metrics
export const apiEndpointDailyStats = pgTable(
    'api_endpoint_daily_stats',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        date: date('date').notNull(),
        endpoint: text('endpoint').notNull(),
        region: varchar('region', { length: 50 }).default('unknown').notNull(),
        totalCalls: bigint('total_calls', { mode: 'bigint' }).default(sql`0`).notNull(),
        totalErrors: bigint('total_errors', { mode: 'bigint' }).default(sql`0`).notNull(),
        sumLatencyMs: bigint('sum_latency_ms', { mode: 'bigint' }).default(sql`0`).notNull(),
        p50LatencyMs: integer('p50_latency_ms'),
        p90LatencyMs: integer('p90_latency_ms'),
        p99LatencyMs: integer('p99_latency_ms'),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('api_endpoint_daily_stats_project_date_endpoint_region_unique').on(table.projectId, table.date, table.endpoint, table.region),
        index('api_endpoint_daily_stats_project_date_idx').on(table.projectId, table.date),
        index('api_endpoint_daily_stats_region_idx').on(table.projectId, table.region),
    ]
);

// Screen Touch Heatmaps - Aggregated touch coordinates per screen for real heatmap visualization
export const screenTouchHeatmaps = pgTable(
    'screen_touch_heatmaps',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        screenName: varchar('screen_name', { length: 255 }).notNull(),
        date: date('date').notNull(),
        // Touch coordinates bucketed into grid cells (normalized 0-1)
        // Format: { "0.1,0.2": 5, "0.5,0.8": 12 } where key is "x,y" bucket
        touchBuckets: json('touch_buckets').$type<Record<string, number>>().default({}),
        // Rage tap coordinates (separate for intensity coloring)
        rageTapBuckets: json('rage_tap_buckets').$type<Record<string, number>>().default({}),
        totalTouches: integer('total_touches').default(0).notNull(),
        totalRageTaps: integer('total_rage_taps').default(0).notNull(),
        // Sample session ID for cover frame reference
        sampleSessionId: varchar('sample_session_id', { length: 64 }),
        // Timestamp (in ms since epoch) when this screen was first seen in the sample session
        // Used to extract the correct video thumbnail frame for this screen
        screenFirstSeenMs: bigint('screen_first_seen_ms', { mode: 'number' }),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('screen_touch_heatmaps_unique').on(table.projectId, table.screenName, table.date),
        index('screen_touch_heatmaps_project_date_idx').on(table.projectId, table.date),
        index('screen_touch_heatmaps_screen_idx').on(table.projectId, table.screenName),
    ]
);


// =============================================================================
// Webhook Model
// =============================================================================


// =============================================================================
// UI Workspace Models (Browser-like tabs)
// =============================================================================

export const uiWorkspaces = pgTable(
    'ui_workspaces',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
        teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        workspaceKey: text('workspace_key').default('default').notNull(),
        tabs: json('tabs').notNull(),
        activeTabId: text('active_tab_id'), // Changed from uuid - frontend uses non-UUID IDs like 'analytics-journeys'
        recentlyClosed: json('recently_closed').default([]).notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('ui_workspaces_unique').on(table.userId, table.teamId, table.projectId, table.workspaceKey),
        index('ui_workspaces_project_idx').on(table.projectId),
        index('ui_workspaces_user_idx').on(table.userId),
    ]
);

// =============================================================================
// Crash Reporting Models
// =============================================================================

export const crashes = pgTable(
    'crashes',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        sessionId: varchar('session_id', { length: 64 }).references(() => sessions.id, { onDelete: 'cascade' }),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        timestamp: timestamp('timestamp').notNull(),
        exceptionName: varchar('exception_name', { length: 255 }).notNull(),
        reason: text('reason'),
        stackTrace: text('stack_trace'), // Full stack trace for display
        fingerprint: varchar('fingerprint', { length: 64 }), // Hash for deduplication/grouping
        s3ObjectKey: text('s3_object_key'),
        deviceMetadata: json('device_metadata'),
        status: varchar('status', { length: 20 }).default('open').notNull(), // 'open', 'resolved', 'ignored'
        occurrenceCount: integer('occurrence_count').default(1).notNull(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        index('crashes_project_idx').on(table.projectId),
        index('crashes_session_idx').on(table.sessionId),
        index('crashes_status_idx').on(table.status),
        index('crashes_timestamp_idx').on(table.timestamp),
        index('crashes_fingerprint_idx').on(table.fingerprint),
    ]
);

// =============================================================================
// ANR (Application Not Responding) Models
// =============================================================================

export const anrs = pgTable(
    'anrs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        sessionId: varchar('session_id', { length: 64 }).references(() => sessions.id, { onDelete: 'cascade' }),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        timestamp: timestamp('timestamp').notNull(),
        durationMs: integer('duration_ms').notNull(), // How long the main thread was blocked
        threadState: text('thread_state'), // Main thread stack trace
        s3ObjectKey: text('s3_object_key'),
        deviceMetadata: json('device_metadata'),
        status: varchar('status', { length: 20 }).default('open').notNull(), // 'open', 'resolved', 'ignored'
        occurrenceCount: integer('occurrence_count').default(1).notNull(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        index('anrs_project_idx').on(table.projectId),
        index('anrs_session_idx').on(table.sessionId),
        index('anrs_status_idx').on(table.status),
        index('anrs_timestamp_idx').on(table.timestamp),
    ]
);

// =============================================================================
// JavaScript Error Reporting Models
// =============================================================================

/**
 * JS Errors table - tracks in-app JavaScript errors, unhandled exceptions,
 * and promise rejections. Separate from native crashes for granular analysis.
 */
export const errors = pgTable(
    'errors',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        sessionId: varchar('session_id', { length: 64 }).references(() => sessions.id, { onDelete: 'cascade' }),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        timestamp: timestamp('timestamp').notNull(),
        // Error classification
        errorType: varchar('error_type', { length: 50 }).notNull(), // 'js_error', 'unhandled_exception', 'promise_rejection'
        errorName: varchar('error_name', { length: 255 }).notNull(), // e.g., 'TypeError', 'ReferenceError'
        message: text('message').notNull(),
        stack: text('stack'),
        // Context
        screenName: varchar('screen_name', { length: 255 }), // Screen where error occurred
        componentName: varchar('component_name', { length: 255 }), // React component if available
        // Device context
        deviceModel: varchar('device_model', { length: 100 }),
        osVersion: varchar('os_version', { length: 50 }),
        appVersion: varchar('app_version', { length: 50 }),
        // Aggregation
        fingerprint: varchar('fingerprint', { length: 64 }), // Hash for grouping similar errors
        occurrenceCount: integer('occurrence_count').default(1).notNull(),
        // Status
        status: varchar('status', { length: 20 }).default('open').notNull(), // 'open', 'resolved', 'ignored'
        // Timestamps
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        index('errors_project_idx').on(table.projectId),
        index('errors_session_idx').on(table.sessionId),
        index('errors_timestamp_idx').on(table.timestamp),
        index('errors_status_idx').on(table.status),
        index('errors_fingerprint_idx').on(table.fingerprint),
        index('errors_error_type_idx').on(table.errorType),
    ]
);

// =============================================================================
// Issues (Grouped Error/Crash/ANR Tracking)
// =============================================================================

/**
 * Issues table - aggregated grouping of errors, crashes, ANRs for the Feed page.
 * Fingerprinting and Issue Grouping logic.
 * Each unique fingerprint = one issue.
 */
export const issues = pgTable(
    'issues',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),

        // Issue identification
        shortId: varchar('short_id', { length: 50 }).notNull(), // e.g., "MOBILE-REACT-NATIVE-1"
        fingerprint: varchar('fingerprint', { length: 255 }).notNull(), // Hash for grouping

        // Issue type: 'error', 'crash', 'anr', 'rage_tap'
        issueType: varchar('issue_type', { length: 20 }).default('error').notNull(),

        // Issue details
        title: varchar('title', { length: 500 }).notNull(), // e.g., "Error", "TouchableOpacity.props.onPress"
        subtitle: text('subtitle'), // e.g., "500 - INTERNAL SERVER ERROR"
        culprit: varchar('culprit', { length: 500 }), // e.g., "placeOrder(src/screens/Ch..."

        // Context
        screenName: varchar('screen_name', { length: 255 }),
        componentName: varchar('component_name', { length: 255 }),

        // Status and handling
        status: varchar('status', { length: 20 }).default('unresolved').notNull(), // 'unresolved', 'resolved', 'ignored', 'ongoing'
        isHandled: boolean('is_handled').default(true),

        // Assignee
        assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),

        // Priority: 'low', 'medium', 'high', 'critical'
        priority: varchar('priority', { length: 20 }).default('medium'),

        // Environment
        environment: varchar('environment', { length: 50 }),

        // Timestamps
        firstSeen: timestamp('first_seen').defaultNow().notNull(),
        lastSeen: timestamp('last_seen').defaultNow().notNull(),

        // Aggregated counts
        eventCount: bigint('event_count', { mode: 'bigint' }).default(sql`1`).notNull(),
        userCount: integer('user_count').default(1).notNull(),

        // Session counts for sparkline trends
        events24h: integer('events_24h').default(0).notNull(),
        events90d: integer('events_90d').default(0).notNull(),

        // Sample data
        sampleSessionId: varchar('sample_session_id', { length: 64 }).references(() => sessions.id, { onDelete: 'set null' }),
        sampleStackTrace: text('sample_stack_trace'),
        sampleDeviceModel: varchar('sample_device_model', { length: 100 }),
        sampleOsVersion: varchar('sample_os_version', { length: 50 }),
        sampleAppVersion: varchar('sample_app_version', { length: 50 }),

        // Daily event breakdown (JSONB)
        dailyEvents: json('daily_events').$type<Record<string, number>>().default({}),

        // Affected versions/devices breakdown
        affectedVersions: json('affected_versions').$type<Record<string, number>>().default({}),
        affectedDevices: json('affected_devices').$type<Record<string, number>>().default({}),

        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('issues_project_fingerprint_unique').on(table.projectId, table.fingerprint),
        index('issues_project_status_idx').on(table.projectId, table.status),
        index('issues_project_type_idx').on(table.projectId, table.issueType),
        index('issues_last_seen_idx').on(table.lastSeen),
        index('issues_first_seen_idx').on(table.firstSeen),
        index('issues_event_count_idx').on(table.eventCount),
        index('issues_assignee_idx').on(table.assigneeId),
        index('issues_priority_idx').on(table.priority),
        index('issues_short_id_idx').on(table.projectId, table.shortId),
    ]
);

/**
 * Issue events - individual occurrences linked to issues
 */
export const issueEvents = pgTable(
    'issue_events',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        issueId: uuid('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
        sessionId: varchar('session_id', { length: 64 }).references(() => sessions.id, { onDelete: 'cascade' }),

        timestamp: timestamp('timestamp').notNull(),

        screenName: varchar('screen_name', { length: 255 }),
        userId: varchar('user_id', { length: 255 }),

        deviceModel: varchar('device_model', { length: 100 }),
        osVersion: varchar('os_version', { length: 50 }),
        appVersion: varchar('app_version', { length: 50 }),

        errorMessage: text('error_message'),
        stackTrace: text('stack_trace'),

        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [
        index('issue_events_issue_idx').on(table.issueId, table.timestamp),
        index('issue_events_session_idx').on(table.sessionId),
        index('issue_events_timestamp_idx').on(table.timestamp),
    ]
);

// =============================================================================
// Funnel Analysis Models
// =============================================================================

export const projectFunnelStats = pgTable(
    'project_funnel_stats',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        funnelPath: text('funnel_path').array().notNull(), // e.g. ['Splash', 'Login', 'Home']
        targetScreen: varchar('target_screen', { length: 255 }).notNull(), // The "success" screen
        confidence: doublePrecision('confidence').default(0).notNull(), // 0.0 - 1.0
        sampleSize: integer('sample_size').default(0).notNull(), // How many sessions analyzed
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('project_funnel_stats_project_unique').on(table.projectId),
    ]
);

// =============================================================================
// Relations

// =============================================================================

// =============================================================================
// Alert Settings & Recipients
// =============================================================================

/**
 * Alert settings per project - controls which alerts are enabled and thresholds
 */
export const alertSettings = pgTable('alert_settings', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),

    // Toggle-based alert preferences
    crashAlertsEnabled: boolean('crash_alerts_enabled').default(true).notNull(),
    anrAlertsEnabled: boolean('anr_alerts_enabled').default(true).notNull(),
    errorSpikeAlertsEnabled: boolean('error_spike_alerts_enabled').default(true).notNull(),
    apiDegradationAlertsEnabled: boolean('api_degradation_alerts_enabled').default(true).notNull(),

    // Thresholds
    errorSpikeThresholdPercent: integer('error_spike_threshold_percent').default(50), // 50% increase triggers alert
    apiDegradationThresholdPercent: integer('api_degradation_threshold_percent').default(100), // 100% (2x) increase triggers alert
    apiLatencyThresholdMs: integer('api_latency_threshold_ms').default(3000), // 3 seconds

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Alert recipients - up to 5 team members per project can receive alerts
 */
export const alertRecipients = pgTable(
    'alert_recipients',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('alert_recipients_project_user_unique').on(table.projectId, table.userId),
        index('alert_recipients_project_idx').on(table.projectId),
    ]
);

/**
 * Alert history - tracks sent alerts for rate limiting and deduplication
 */
export const alertHistory = pgTable(
    'alert_history',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        alertType: varchar('alert_type', { length: 50 }).notNull(), // 'crash', 'anr', 'error_spike', 'api_degradation', 'daily_digest'
        fingerprint: varchar('fingerprint', { length: 255 }), // For deduplication of same issue
        recipientCount: integer('recipient_count').default(1).notNull(),
        sentAt: timestamp('sent_at').defaultNow().notNull(),
    },
    (table) => [
        index('alert_history_project_type_idx').on(table.projectId, table.alertType, table.sentAt),
        index('alert_history_fingerprint_idx').on(table.projectId, table.fingerprint, table.sentAt),
    ]
);

// =============================================================================
// Alert Relations
// =============================================================================

export const alertSettingsRelations = relations(alertSettings, ({ one }) => ({
    project: one(projects, { fields: [alertSettings.projectId], references: [projects.id] }),
}));

export const alertRecipientsRelations = relations(alertRecipients, ({ one }) => ({
    project: one(projects, { fields: [alertRecipients.projectId], references: [projects.id] }),
    user: one(users, { fields: [alertRecipients.userId], references: [users.id] }),
}));

export const alertHistoryRelations = relations(alertHistory, ({ one }) => ({
    project: one(projects, { fields: [alertHistory.projectId], references: [projects.id] }),
}));

/**
 * Email Logs - detailed history of all alert emails sent
 * Stores individual emails for audit trail and user visibility
 */
export const emailLogs = pgTable(
    'email_logs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        recipientEmail: varchar('recipient_email', { length: 255 }).notNull(),
        recipientName: varchar('recipient_name', { length: 255 }),
        alertType: varchar('alert_type', { length: 50 }).notNull(), // 'crash', 'anr', 'error_spike', 'api_degradation'
        subject: varchar('subject', { length: 500 }).notNull(),
        issueTitle: varchar('issue_title', { length: 500 }), // The issue/crash that triggered this
        issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'set null' }),
        status: varchar('status', { length: 20 }).default('sent').notNull(), // 'sent', 'failed', 'bounced'
        errorMessage: text('error_message'), // If failed
        sentAt: timestamp('sent_at').defaultNow().notNull(),
    },
    (table) => [
        index('email_logs_project_idx').on(table.projectId, table.sentAt),
        index('email_logs_recipient_idx').on(table.projectId, table.recipientEmail),
        index('email_logs_type_idx').on(table.projectId, table.alertType),
    ]
);

export const emailLogsRelations = relations(emailLogs, ({ one }) => ({
    project: one(projects, { fields: [emailLogs.projectId], references: [projects.id] }),
    issue: one(issues, { fields: [emailLogs.issueId], references: [issues.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
    ownedTeams: many(teams),
    teamMembers: many(teamMembers),
    teamInvitations: many(teamInvitations),
    otpTokens: many(otpTokens),
    sessions: many(userSessions),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
    owner: one(users, { fields: [teams.ownerUserId], references: [users.id] }),
    members: many(teamMembers),
    invitations: many(teamInvitations),
    projects: many(projects),
    billingUsage: many(billingUsage),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
    team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
    user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
}));

export const teamInvitationsRelations = relations(teamInvitations, ({ one }) => ({
    team: one(teams, { fields: [teamInvitations.teamId], references: [teams.id] }),
    inviter: one(users, { fields: [teamInvitations.invitedBy], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
    team: one(teams, { fields: [projects.teamId], references: [teams.id] }),
    apiKeys: many(apiKeys),
    sessions: many(sessions),
    projectUsage: many(projectUsage),
    appDailyStats: many(appDailyStats),
    storageEndpoints: many(storageEndpoints),
    ingestJobs: many(ingestJobs),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
    project: one(projects, { fields: [sessions.projectId], references: [projects.id] }),
    metrics: one(sessionMetrics, { fields: [sessions.id], references: [sessionMetrics.sessionId] }),
    recordingArtifacts: many(recordingArtifacts),
}));

export const sessionMetricsRelations = relations(sessionMetrics, ({ one }) => ({
    session: one(sessions, { fields: [sessionMetrics.sessionId], references: [sessions.id] }),
}));



export const recordingArtifactsRelations = relations(recordingArtifacts, ({ one }) => ({
    session: one(sessions, { fields: [recordingArtifacts.sessionId], references: [sessions.id] }),
}));



export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
    project: one(projects, { fields: [apiKeys.projectId], references: [projects.id] }),
}));

export const deviceUsageRelations = relations(deviceUsage, ({ one }) => ({
    project: one(projects, { fields: [deviceUsage.projectId], references: [projects.id] }),
}));

export const ingestJobsRelations = relations(ingestJobs, ({ one }) => ({
    project: one(projects, { fields: [ingestJobs.projectId], references: [projects.id] }),
}));

export const projectFunnelStatsRelations = relations(projectFunnelStats, ({ one }) => ({
    project: one(projects, { fields: [projectFunnelStats.projectId], references: [projects.id] }),
}));


export const storageEndpointsRelations = relations(storageEndpoints, ({ one }) => ({
    project: one(projects, { fields: [storageEndpoints.projectId], references: [projects.id] }),
}));

export const projectUsageRelations = relations(projectUsage, ({ one }) => ({
    project: one(projects, { fields: [projectUsage.projectId], references: [projects.id] }),
}));

export const billingUsageRelations = relations(billingUsage, ({ one }) => ({
    team: one(teams, { fields: [billingUsage.teamId], references: [teams.id] }),
}));



export const appDailyStatsRelations = relations(appDailyStats, ({ one }) => ({
    project: one(projects, { fields: [appDailyStats.projectId], references: [projects.id] }),
}));


export const userSessionsRelations = relations(userSessions, ({ one }) => ({
    user: one(users, { fields: [userSessions.userId], references: [users.id] }),
}));

export const otpTokensRelations = relations(otpTokens, ({ one }) => ({
    user: one(users, { fields: [otpTokens.userId], references: [users.id] }),
}));

export const crashesRelations = relations(crashes, ({ one }) => ({
    session: one(sessions, { fields: [crashes.sessionId], references: [sessions.id] }),
    project: one(projects, { fields: [crashes.projectId], references: [projects.id] }),
}));

export const errorsRelations = relations(errors, ({ one }) => ({
    session: one(sessions, { fields: [errors.sessionId], references: [sessions.id] }),
    project: one(projects, { fields: [errors.projectId], references: [projects.id] }),
}));

export const issuesRelations = relations(issues, ({ one, many }) => ({
    project: one(projects, { fields: [issues.projectId], references: [projects.id] }),
    assignee: one(users, { fields: [issues.assigneeId], references: [users.id] }),
    sampleSession: one(sessions, { fields: [issues.sampleSessionId], references: [sessions.id] }),
    events: many(issueEvents),
}));

export const issueEventsRelations = relations(issueEvents, ({ one }) => ({
    issue: one(issues, { fields: [issueEvents.issueId], references: [issues.id] }),
    session: one(sessions, { fields: [issueEvents.sessionId], references: [sessions.id] }),
}));
