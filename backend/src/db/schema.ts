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
    jsonb,
    uniqueIndex,
    index,
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
    stripeCurrentPeriodStart: timestamp('stripe_current_period_start'), // Stripe's authoritative billing period start
    stripeCurrentPeriodEnd: timestamp('stripe_current_period_end'),     // Stripe's authoritative billing period end
    retentionTier: integer('retention_tier').default(1).notNull(), // Defaults to free video retention
    bonusSessions: integer('bonus_sessions').default(0).notNull(), // Manual override: extra sessions beyond plan limit
    /** When set, bonus_sessions only applies for this billing period string (see getTeamBillingPeriod). */
    bonusSessionsBillingPeriod: text('bonus_sessions_billing_period'),
    workspaceConfirmedAt: timestamp('workspace_confirmed_at'),
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

export const roadmapPosts = pgTable(
    'roadmap_posts',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
        title: varchar('title', { length: 160 }).notNull(),
        details: text('details').notNull(),
        status: varchar('status', { length: 32 }).default('open').notNull(),
        developerComment: text('developer_comment'),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        index('roadmap_posts_author_user_id_idx').on(table.authorUserId),
        index('roadmap_posts_status_created_at_idx').on(table.status, table.createdAt),
    ]
);

export const roadmapVotes = pgTable(
    'roadmap_votes',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        postId: uuid('post_id').notNull().references(() => roadmapPosts.id, { onDelete: 'cascade' }),
        userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('roadmap_votes_post_user_unique').on(table.postId, table.userId),
        index('roadmap_votes_post_id_idx').on(table.postId),
        index('roadmap_votes_user_id_idx').on(table.userId),
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
        webAllowedDomains: text('web_allowed_domains').array().default(sql`ARRAY[]::text[]`).notNull(),
        publicKey: varchar('public_key', { length: 64 }).notNull(),
        sampleRate: integer('sample_rate').default(100).notNull(),
        rejourneyEnabled: boolean('rejourney_enabled').default(true).notNull(),
        recordingEnabled: boolean('recording_enabled').default(true).notNull(),
        textInputMasking: varchar('text_input_masking', { length: 32 }).default('all').notNull(),
        imageVideoMasking: varchar('image_video_masking', { length: 32 }).default('none').notNull(),
        recordingFps: integer('recording_fps').default(1).notNull(),
        maxRecordingMinutes: integer('max_recording_minutes').default(10).notNull(),
        webMaxObservabilityMinutes: integer('web_max_observability_minutes').default(30).notNull(),
        smartCaptureEnabled: boolean('smart_capture_enabled').default(false).notNull(),
        smartCaptureMode: varchar('smart_capture_mode', { length: 32 }).default('record_all').notNull(),
        smartCapturePreset: varchar('smart_capture_preset', { length: 64 }).default('none').notNull(),
        smartCaptureRules: jsonb('smart_capture_rules').$type<Array<Record<string, unknown>>>().default(sql`'[]'::jsonb`).notNull(),
        smartCaptureDecisionWindowHours: integer('smart_capture_decision_window_hours').default(168).notNull(),
        deletedAt: timestamp('deleted_at'),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        index('projects_team_id_idx').on(table.teamId),
        uniqueIndex('projects_public_key_idx').on(table.publicKey),
        index('projects_web_allowed_domains_gin_idx').using('gin', table.webAllowedDomains),
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
// Project Revenue Integrations
// =============================================================================

export const projectRevenueSourceSettings = pgTable(
    'project_revenue_source_settings',
    {
        projectId: uuid('project_id').primaryKey().notNull().references(() => projects.id, { onDelete: 'cascade' }),
        activeProvider: varchar('active_provider', { length: 32 }),
        connectedByUserId: uuid('connected_by_user_id').references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        index('project_revenue_source_settings_active_idx').on(table.activeProvider),
    ]
);

export const projectRevenueConnections = pgTable(
    'project_revenue_connections',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
        connectedByUserId: uuid('connected_by_user_id').references(() => users.id, { onDelete: 'set null' }),
        provider: varchar('provider', { length: 32 }).notNull(),
        externalAccountId: varchar('external_account_id', { length: 255 }),
        externalAccountName: varchar('external_account_name', { length: 255 }),
        status: varchar('status', { length: 32 }).default('connected').notNull(),
        scope: text('scope'),
        accessTokenEncrypted: text('access_token_encrypted'),
        refreshTokenEncrypted: text('refresh_token_encrypted'),
        apiKeyEncrypted: text('api_key_encrypted'),
        apiKeyLast4: varchar('api_key_last4', { length: 16 }),
        tokenExpiresAt: timestamp('token_expires_at'),
        connectionConfig: jsonb('connection_config').$type<Record<string, unknown>>().default({}).notNull(),
        customEventConfig: jsonb('custom_event_config').$type<Record<string, unknown>>().default({}).notNull(),
        lastSyncStartedAt: timestamp('last_sync_started_at'),
        lastSyncCompletedAt: timestamp('last_sync_completed_at'),
        lastSyncError: text('last_sync_error'),
        oldestSyncedAt: timestamp('oldest_synced_at'),
        newestSyncedAt: timestamp('newest_synced_at'),
        cursor: varchar('cursor', { length: 255 }),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('project_revenue_connections_project_provider_unique').on(table.projectId, table.provider),
        index('project_revenue_connections_team_idx').on(table.teamId),
        index('project_revenue_connections_provider_status_idx').on(table.provider, table.status),
    ]
);

export const revenueProviderTransactions = pgTable(
    'revenue_provider_transactions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        connectionId: uuid('connection_id').notNull().references(() => projectRevenueConnections.id, { onDelete: 'cascade' }),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        provider: varchar('provider', { length: 32 }).notNull(),
        externalTransactionId: varchar('external_transaction_id', { length: 255 }).notNull(),
        externalSourceId: varchar('external_source_id', { length: 255 }),
        occurredAt: timestamp('occurred_at').notNull(),
        amountCents: integer('amount_cents').notNull(),
        feeCents: integer('fee_cents').default(0).notNull(),
        netCents: integer('net_cents').notNull(),
        grossAmountCents: integer('gross_amount_cents').default(0).notNull(),
        refundAmountCents: integer('refund_amount_cents').default(0).notNull(),
        currency: varchar('currency', { length: 12 }).notNull(),
        type: varchar('type', { length: 80 }).notNull(),
        reportingCategory: varchar('reporting_category', { length: 80 }),
        metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
        importedAt: timestamp('imported_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('revenue_provider_transactions_project_provider_tx_unique').on(table.projectId, table.provider, table.externalTransactionId),
        index('revenue_provider_transactions_project_provider_date_idx').on(table.projectId, table.provider, table.occurredAt),
        index('revenue_provider_transactions_connection_idx').on(table.connectionId),
        index('revenue_provider_transactions_manual_revenue_idx')
            .on(table.projectId, table.currency, table.occurredAt)
            .where(sql`${table.provider} = 'custom_events' AND ${table.metadata}->>'source' = 'manual_historical'`),
    ]
);

export const projectRevenueDaily = pgTable(
    'project_revenue_daily',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        sourceProvider: varchar('source_provider', { length: 32 }).default('custom_events').notNull(),
        date: date('date').notNull(),
        currency: varchar('currency', { length: 12 }).notNull(),
        grossAmountCents: integer('gross_amount_cents').default(0).notNull(),
        refundAmountCents: integer('refund_amount_cents').default(0).notNull(),
        feeAmountCents: integer('fee_amount_cents').default(0).notNull(),
        netAmountCents: integer('net_amount_cents').default(0).notNull(),
        transactionCount: integer('transaction_count').default(0).notNull(),
        refundCount: integer('refund_count').default(0).notNull(),
        subscriberCount: integer('subscriber_count').default(0).notNull(),
        trialCount: integer('trial_count').default(0).notNull(),
        subscriptionStartCount: integer('subscription_start_count').default(0).notNull(),
        cancellationCount: integer('cancellation_count').default(0).notNull(),
        conversionCount: integer('conversion_count').default(0).notNull(),
        customEventCounts: jsonb('custom_event_counts').$type<Record<string, number>>().default({}).notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('project_revenue_daily_project_source_date_currency_unique').on(table.projectId, table.sourceProvider, table.date, table.currency),
        index('project_revenue_daily_project_source_date_idx').on(table.projectId, table.sourceProvider, table.date),
        index('project_revenue_daily_project_source_currency_idx').on(table.projectId, table.sourceProvider, table.currency),
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
        webReferral: varchar('web_referral', { length: 255 }),
        startedAt: timestamp('started_at').defaultNow().notNull(),
        endedAt: timestamp('ended_at'),
        explicitEndedAt: timestamp('explicit_ended_at'),
        finalizedAt: timestamp('finalized_at'),
        lastIngestActivityAt: timestamp('last_ingest_activity_at').defaultNow().notNull(),
        durationSeconds: integer('duration_seconds'),
        backgroundTimeSeconds: integer('background_time_seconds').default(0),
        status: varchar('status', { length: 20 }).default('pending').notNull(),
        closeSource: varchar('close_source', { length: 32 }),
        // NOTE: s3ObjectKey, sizeBytes, checksum removed - use recordingArtifacts table instead
        retentionTier: integer('retention_tier').default(1).notNull(),

        retentionDays: integer('retention_days').default(7).notNull(),
        recordingDeleted: boolean('recording_deleted').default(false).notNull(),
        recordingDeletedAt: timestamp('recording_deleted_at'),
        isReplayExpired: boolean('is_replay_expired').default(false).notNull(),
        identityScrubbedAt: timestamp('identity_scrubbed_at'),
        identityScrubVersion: integer('identity_scrub_version'),
        rawEventsDeletedAt: timestamp('raw_events_deleted_at'),

        // Canonical replay availability flag used by the ingest lifecycle
        replayAvailable: boolean('replay_available').default(false).notNull(),
        /**
         * Set when replay was disabled by the server because the team's replay quota
         * was already exhausted. Analytics artifacts are still accepted, but visual
         * replay artifacts are not expected. This is intentionally separate from
         * observe_only, which is controlled by customer consent/configuration.
         */
        replayQuotaBillingExhausted: boolean('replay_quota_billing_exhausted').default(false).notNull(),
        replayQuotaCountedAt: timestamp('replay_quota_counted_at'),
        replayRetentionState: varchar('replay_retention_state', { length: 32 }),
        smartCaptureStatus: varchar('smart_capture_status', { length: 32 }).default('not_applicable').notNull(),
        smartCaptureReason: varchar('smart_capture_reason', { length: 120 }),
        smartCaptureRuleId: varchar('smart_capture_rule_id', { length: 120 }),
        smartCaptureDecidedAt: timestamp('smart_capture_decided_at'),

        // Geo location
        geoCity: varchar('geo_city', { length: 100 }),
        geoRegion: varchar('geo_region', { length: 100 }),
        geoCountry: varchar('geo_country', { length: 100 }),
        geoCountryCode: varchar('geo_country_code', { length: 10 }),
        geoLatitude: doublePrecision('geo_latitude'),
        geoLongitude: doublePrecision('geo_longitude'),
        geoTimezone: varchar('geo_timezone', { length: 100 }),

        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),

        // Replay artifact counters
        replaySegmentCount: integer('replay_segment_count').default(0),
        replayStorageBytes: bigint('replay_storage_bytes', { mode: 'number' }).default(0),

        // Server-side enforcement: SDK sampling decision (for rejecting visual replay uploads)
        isSampledIn: boolean('is_sampled_in').default(true).notNull(),

        /**
         * Set to true when the SDK session was started with observeOnly:true (or an
         * equivalent customer/project observe-only setting). Replay quota exhaustion is
         * tracked separately by replay_quota_billing_exhausted so teams can distinguish
         * quota behavior from customer consent/configuration.
         * Defaults to false for full backward compat with older SDK versions that do not
         * send the x-rj-observe-only header.
         */
        observeOnly: boolean('observe_only').default(false).notNull(),

        // Session events and metadata
        events: jsonb('events').default([]).notNull(),
        metadata: jsonb('metadata').default({}).notNull(),
    },
    (table) => [
        index('sessions_project_started_idx').on(table.projectId, table.startedAt),
        index('sessions_status_idx').on(table.status),
        index('sessions_backup_ready_started_idx').on(table.status, table.startedAt, table.id),
        /** Speeds the session-backup-seed scan: orders 1M+ sessions by started_at without a full seq scan */
        index('sessions_seed_started_at_idx').on(table.startedAt, table.id),
        index('sessions_replay_available_idx').on(table.replayAvailable, table.startedAt),
        index('sessions_replay_retention_state_started_idx').on(table.replayRetentionState, table.startedAt),
        index('sessions_smart_capture_status_started_idx').on(table.smartCaptureStatus, table.startedAt),
        /** Speeds session archive list + count for replay-ready rows per project */
        index('sessions_archive_replay_idx')
            .on(table.projectId, table.startedAt)
            .where(sql`${table.replayAvailable} = true`),
        /** Speeds saved replay archive list + count while Smart Capture buffers are hidden */
        index('sessions_archive_saved_replay_idx')
            .on(table.projectId, table.startedAt)
            .where(sql`${table.replayAvailable} = true AND COALESCE(${table.replayRetentionState}, 'saved') = 'saved'`),
        /** Speeds “first session for device” checks on the archive list */
        index('sessions_project_device_started_idx').on(table.projectId, table.deviceId, table.startedAt),
        /** Speeds first-session checks (resolveArchiveFirstSessionIds), new_user filter NOT EXISTS, and live-badge visitor EXISTS — all use coalesce(device_id, anonymous_hash, user_display_id) */
        index('sessions_visitor_identity_started_idx').on(
            table.projectId,
            sql`coalesce(${table.deviceId}, ${table.anonymousHash}, ${table.userDisplayId})`,
            table.startedAt,
            table.id
        ),
        index('sessions_project_web_referral_started_idx')
            .on(table.projectId, table.webReferral, table.startedAt)
            .where(sql`${table.webReferral} IS NOT NULL`),
        index('sessions_user_display_id_idx').on(table.userDisplayId),
        index('sessions_anonymous_hash_idx').on(table.anonymousHash),
        index('sessions_events_idx').using('gin', table.events),
        index('sessions_metadata_idx').using('gin', table.metadata),
        /** Retention worker: status IN ('ready','completed') AND recording_deleted=false, ordered by retention_tier + started_at. The existing sessions_retention_eligible_idx excludes status='completed' so it can't serve this query. */
        index('sessions_retention_due_idx')
            .on(table.retentionTier, table.startedAt, table.id)
            .where(sql`${table.recordingDeleted} = false AND ${table.status} IN ('ready', 'completed')`),
        /** GDPR cleanup worker: scrubs identity and raw session event blobs when each session's own retention_days has elapsed. */
        index('sessions_identity_scrub_due_idx')
            .on(table.startedAt, table.id)
            .where(sql`${table.identityScrubbedAt} IS NULL`),
        /** sessionArtifactPurge: rows where recording_deleted=true OR is_replay_expired=true. Without this the OR predicate forces a full sessions_seed_started_at_idx scan of ~438K rows. */
        index('sessions_artifact_deletion_idx')
            .on(table.startedAt, table.id)
            .where(sql`${table.recordingDeleted} = true OR ${table.isReplayExpired} = true`),
        /** sessionReconciliation: status IN ('processing','pending') AND last_ingest_activity_at <= cutoff. sessions_status_idx alone forces a post-filter sort. */
        index('sessions_reconciliation_activity_idx')
            .on(table.lastIngestActivityAt)
            .where(sql`${table.status} IN ('processing', 'pending')`),
        /** Covering index for any future analytics shape filtering by project + time window + status. sessions_project_started_idx alone does not cover status, so a post-filter scans the full project's session range (1M+ rows on the top project). */
        index('sessions_project_started_status_idx').on(table.projectId, table.startedAt, table.status),
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
    frustrationCountsVersion: integer('frustration_counts_version').default(0).notNull(),
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

    // Replay artifact metrics
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
        kind: varchar('kind', { length: 50 }).notNull(), // 'events', 'screenshots', 'hierarchy', 'crashes', 'anrs'
        s3ObjectKey: text('s3_object_key').notNull(),
        clientUploadId: varchar('client_upload_id', { length: 255 }),
        endpointId: varchar('endpoint_id', { length: 255 }), // Pins artifact to upload endpoint for correct worker download (k3s load balancing)
        sizeBytes: integer('size_bytes'),
        declaredSizeBytes: integer('declared_size_bytes'),
        status: varchar('status', { length: 20 }).default('pending').notNull(),
        readyAt: timestamp('ready_at'),
        uploadCompletedAt: timestamp('upload_completed_at'),
        verifiedAt: timestamp('verified_at'),
        eventRollupRequestedAt: timestamp('event_rollup_requested_at'),
        eventRollupProcessedAt: timestamp('event_rollup_processed_at'),
        timestamp: doublePrecision('timestamp'),
        // Replay segment timing fields
        startTime: bigint('start_time', { mode: 'number' }), // Segment start time in epoch ms
        endTime: bigint('end_time', { mode: 'number' }), // Segment end time in epoch ms
        frameCount: integer('frame_count'), // Number of frames in replay segment
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [
        index('recording_artifacts_session_id_idx').on(table.sessionId),
        index('recording_artifacts_kind_idx').on(table.sessionId, table.kind),
        index('recording_artifacts_created_status_endpoint_idx')
            .on(table.createdAt, table.status, table.kind, table.endpointId),
        index('recording_artifacts_upload_completed_at_idx')
            .on(table.uploadCompletedAt, table.kind, table.endpointId, table.createdAt)
            .where(sql`${table.uploadCompletedAt} IS NOT NULL`),
        index('recording_artifacts_pending_stalled_idx')
            .on(table.kind, table.createdAt, table.endpointId)
            .where(sql`${table.status} = 'pending' AND ${table.uploadCompletedAt} IS NULL`),
        index('recording_artifacts_session_ready_endpoint_idx')
            .on(table.sessionId, table.endpointId)
            .where(sql`${table.status} = 'ready'`),
        index('recording_artifacts_failed_recent_idx')
            .on(table.status, table.createdAt, table.kind, table.endpointId)
            .where(sql`${table.status} IN ('abandoned', 'failed')`),
        /** queueRecoverableArtifacts (sessionLifecycleWorker every 10s): repairs sessions with ready 'events' segments missing start/end times. Targeted partial index avoids the 33GB full sort that previously spilled 347GB of temp files. */
        index('recording_artifacts_recoverable_idx')
            .on(sql`${table.createdAt} DESC`)
            .where(sql`${table.status} = 'ready' AND ${table.kind} = 'events' AND (${table.startTime} IS NULL OR ${table.endTime} IS NULL)`),
        /** queueRecoverableArtifacts: scans status='uploaded' (artifact bytes received, awaiting worker pickup) every 10s. Partial index turns the skip-scan into a direct seek. */
        index('recording_artifacts_uploaded_idx')
            .on(table.createdAt)
            .where(sql`${table.status} = 'uploaded'`),
        /** queueRecoverableArtifacts: scans status='buffered' (edge-node buffer awaiting flush-to-S3) every 10s. Partial index turns the skip-scan into a direct seek. */
        index('recording_artifacts_buffered_idx')
            .on(table.createdAt)
            .where(sql`${table.status} = 'buffered'`),
        uniqueIndex('recording_artifacts_client_upload_id_unique').on(table.clientUploadId),
    ]
);

export const heatmapBaseTemplates = pgTable(
    'heatmap_base_templates',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        screenName: text('screen_name').notNull(),
        platformScope: varchar('platform_scope', { length: 20 }).default('all').notNull(),
        appVersionScope: varchar('app_version_scope', { length: 120 }).default('all').notNull(),
        sourceSessionId: varchar('source_session_id', { length: 64 }).references(() => sessions.id, { onDelete: 'set null' }),
        sourceTimestampMs: bigint('source_timestamp_ms', { mode: 'number' }).notNull(),
        imageS3ObjectKey: text('image_s3_object_key').notNull(),
        imageEndpointId: varchar('image_endpoint_id', { length: 255 }),
        imageSizeBytes: integer('image_size_bytes'),
        pageWidth: integer('page_width'),
        pageHeight: integer('page_height'),
        viewportWidth: integer('viewport_width'),
        viewportHeight: integer('viewport_height'),
        createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
        updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('heatmap_base_templates_scope_unique').on(
            table.projectId,
            table.screenName,
            table.platformScope,
            table.appVersionScope,
        ),
        index('heatmap_base_templates_project_screen_idx').on(table.projectId, table.screenName),
        index('heatmap_base_templates_source_session_idx').on(table.sourceSessionId),
    ],
);

export const replayShareLinks = pgTable(
    'replay_share_links',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        publicId: varchar('public_id', { length: 64 }).notNull(),
        sessionId: varchar('session_id', { length: 64 }).notNull().references(() => sessions.id, { onDelete: 'cascade' }),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
        createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
        visibility: varchar('visibility', { length: 32 }).default('replay_only').notNull(),
        expirationPreset: varchar('expiration_preset', { length: 16 }).default('7d').notNull(),
        expiresAt: timestamp('expires_at'),
        revokedAt: timestamp('revoked_at'),
        lastAccessedAt: timestamp('last_accessed_at'),
        accessCount: integer('access_count').default(0).notNull(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('replay_share_links_public_id_unique').on(table.publicId),
        index('replay_share_links_session_idx').on(table.sessionId, table.revokedAt, table.expiresAt),
        index('replay_share_links_team_created_idx').on(table.teamId, table.createdAt),
        index('replay_share_links_active_reuse_idx')
            .on(table.sessionId, table.visibility, table.expirationPreset, table.expiresAt)
            .where(sql`${table.revokedAt} IS NULL`),
    ],
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
    storageClass: varchar('storage_class', { length: 64 }),
});

// =============================================================================

export const retentionDeletionLog = pgTable(
    'retention_deletion_log',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        runId: varchar('run_id', { length: 128 }).notNull(),
        scope: varchar('scope', { length: 32 }).notNull(),
        status: varchar('status', { length: 20 }).notNull(),
        trigger: varchar('trigger', { length: 64 }),
        sessionId: varchar('session_id', { length: 64 }),
        projectId: uuid('project_id'),
        teamId: uuid('team_id'),
        storagePrefix: text('storage_prefix').notNull(),
        plannedArtifactRowCount: integer('planned_artifact_row_count').default(0).notNull(),
        plannedArtifactBytes: bigint('planned_artifact_bytes', { mode: 'number' }).default(0).notNull(),
        plannedIngestJobCount: integer('planned_ingest_job_count').default(0).notNull(),
        deletedArtifactRowCount: integer('deleted_artifact_row_count').default(0).notNull(),
        deletedIngestJobCount: integer('deleted_ingest_job_count').default(0).notNull(),
        deletedObjectCount: integer('deleted_object_count').default(0).notNull(),
        deletedBytes: bigint('deleted_bytes', { mode: 'number' }).default(0).notNull(),
        storageMissing: boolean('storage_missing').default(false).notNull(),
        cacheKeyCount: integer('cache_key_count').default(0).notNull(),
        details: jsonb('details').default(sql`'{}'::jsonb`).notNull(),
        errorText: text('error_text'),
        startedAt: timestamp('started_at').defaultNow().notNull(),
        finishedAt: timestamp('finished_at'),
    },
    (table) => [
        index('retention_deletion_log_run_id_idx').on(table.runId),
        index('retention_deletion_log_scope_idx').on(table.scope, table.startedAt),
        index('retention_deletion_log_session_id_idx').on(table.sessionId),
    ]
);

export const retentionRunLock = pgTable('retention_run_lock', {
    lockName: text('lock_name').primaryKey(),
    ownerId: text('owner_id').notNull(),
    acquiredAt: timestamp('acquired_at').defaultNow().notNull(),
    heartbeatAt: timestamp('heartbeat_at').defaultNow().notNull(),
});

export const researchExtractionJobs = pgTable(
    'research_extraction_jobs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        sessionId: varchar('session_id', { length: 64 }).notNull().references(() => sessions.id, { onDelete: 'cascade' }),
        lakeType: varchar('lake_type', { length: 32 }).default('interaction').notNull(),
        projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
        teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
        dueAt: timestamp('due_at').notNull(),
        status: varchar('status', { length: 32 }).default('pending').notNull(),
        attempts: integer('attempts').default(0).notNull(),
        nextRetryAt: timestamp('next_retry_at'),
        lakePath: text('lake_path'),
        qualityTier: varchar('quality_tier', { length: 32 }),
        rejectReason: text('reject_reason'),
        sourceArtifactCount: integer('source_artifact_count').default(0).notNull(),
        interactionEventCount: integer('interaction_event_count').default(0).notNull(),
        uiFrameCount: integer('ui_frame_count').default(0).notNull(),
        uiSkeletonElementCount: integer('ui_skeleton_element_count').default(0).notNull(),
        anonymizationVersion: integer('anonymization_version').default(1).notNull(),
        schemaVersion: integer('schema_version').default(1).notNull(),
        processedAt: timestamp('processed_at'),
        lastError: text('last_error'),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('research_extraction_jobs_session_lake_unique').on(table.sessionId, table.lakeType),
        index('research_extraction_jobs_claim_idx').on(table.lakeType, table.status, table.nextRetryAt, table.dueAt, table.sessionId),
        index('research_extraction_jobs_project_status_idx').on(table.projectId, table.lakeType, table.status, table.dueAt),
    ],
);


// =============================================================================
// Billing & Usage Models
// =============================================================================

export const billingCutovers = pgTable('billing_cutovers', {
    name: varchar('name', { length: 128 }).primaryKey(),
    cutoverAt: timestamp('cutover_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const projectUsage = pgTable(
    'project_usage',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        projectId: uuid('project_id').notNull().references(() => projects.id),
        period: varchar('period', { length: 10 }).notNull(),
        sessions: integer('sessions').default(0).notNull(),
        sessionReplays: integer('session_replays').default(0).notNull(),
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
        sessionReplays: integer('session_replays').default(0).notNull(),
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
 * Types include replay usage warnings ('warning_80', 'limit_100') and payment alerts.
 */
export const billingNotifications = pgTable(
    'billing_notifications',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
        userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // For user-level (free tier) notifications
        type: varchar('type', { length: 50 }).notNull(),
        period: varchar('period', { length: 10 }).notNull(), // YYYY-MM
        dedupeKey: text('dedupe_key'),
        metadata: json('metadata'), // e.g., { amountCents: 45 } for sub_50_rollover
        sentAt: timestamp('sent_at').defaultNow().notNull(),
    },
    (table) => [
        index('billing_notifications_team_period_idx').on(table.teamId, table.period),
        index('billing_notifications_user_period_idx').on(table.userId, table.period),
        index('billing_notifications_type_idx').on(table.type),
        uniqueIndex('billing_notifications_dedupe_key_unique')
            .on(table.dedupeKey)
            .where(sql`${table.dedupeKey} IS NOT NULL`),
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
export type EmailAlertRuleAlertType = 'crash' | 'anr' | 'error_spike' | 'api_degradation';
export type EmailAlertRuleMetric = 'affected_users' | 'duration_ms' | 'percent_increase' | 'latency_ms';
export type EmailAlertRuleOperator = 'gt' | 'gte' | 'lt' | 'lte';
export type EmailAlertRuleSeverity = 'critical' | 'high' | 'watch';
export type EmailAlertRuleSource = 'default' | 'custom';

export interface EmailAlertRule {
    id: string;
    name: string;
    description?: string;
    alertType: EmailAlertRuleAlertType;
    metric: EmailAlertRuleMetric;
    operator: EmailAlertRuleOperator;
    threshold: number;
    windowMinutes: number;
    severity: EmailAlertRuleSeverity;
    enabled: boolean;
    source: EmailAlertRuleSource;
    updatedAt: string;
}

export const alertSettings = pgTable('alert_settings', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),

    // Toggle-based alert preferences
    crashAlertsEnabled: boolean('crash_alerts_enabled').default(true).notNull(),
    anrAlertsEnabled: boolean('anr_alerts_enabled').default(true).notNull(),
    errorSpikeAlertsEnabled: boolean('error_spike_alerts_enabled').default(true).notNull(),
    apiDegradationAlertsEnabled: boolean('api_degradation_alerts_enabled').default(true).notNull(),
    leakScanAlertsEnabled: boolean('leak_scan_alerts_enabled').default(true).notNull(),

    // Thresholds
    errorSpikeThresholdPercent: integer('error_spike_threshold_percent').default(50), // 50% increase triggers alert
    apiDegradationThresholdPercent: integer('api_degradation_threshold_percent').default(100), // 100% (2x) increase triggers alert
    apiLatencyThresholdMs: integer('api_latency_threshold_ms').default(3000), // 3 seconds
    emailRules: jsonb('email_rules').$type<EmailAlertRule[]>().default(sql`'[]'::jsonb`).notNull(),
    ignoredApiEndpoints: jsonb('ignored_api_endpoints').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),

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
    roadmapPosts: many(roadmapPosts),
    roadmapVotes: many(roadmapVotes),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
    owner: one(users, { fields: [teams.ownerUserId], references: [users.id] }),
    members: many(teamMembers),
    invitations: many(teamInvitations),
    projects: many(projects),
    replayShareLinks: many(replayShareLinks),
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

export const roadmapPostsRelations = relations(roadmapPosts, ({ one, many }) => ({
    author: one(users, { fields: [roadmapPosts.authorUserId], references: [users.id] }),
    votes: many(roadmapVotes),
}));

export const roadmapVotesRelations = relations(roadmapVotes, ({ one }) => ({
    post: one(roadmapPosts, { fields: [roadmapVotes.postId], references: [roadmapPosts.id] }),
    user: one(users, { fields: [roadmapVotes.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
    team: one(teams, { fields: [projects.teamId], references: [teams.id] }),
    apiKeys: many(apiKeys),
    sessions: many(sessions),
    replayShareLinks: many(replayShareLinks),
    heatmapBaseTemplates: many(heatmapBaseTemplates),
    projectUsage: many(projectUsage),
    storageEndpoints: many(storageEndpoints),
    revenueDaily: many(projectRevenueDaily),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
    project: one(projects, { fields: [sessions.projectId], references: [projects.id] }),
    metrics: one(sessionMetrics, { fields: [sessions.id], references: [sessionMetrics.sessionId] }),
    recordingArtifacts: many(recordingArtifacts),
    replayShareLinks: many(replayShareLinks),
    heatmapBaseTemplates: many(heatmapBaseTemplates),
}));

export const sessionMetricsRelations = relations(sessionMetrics, ({ one }) => ({
    session: one(sessions, { fields: [sessionMetrics.sessionId], references: [sessions.id] }),
}));



export const recordingArtifactsRelations = relations(recordingArtifacts, ({ one }) => ({
    session: one(sessions, { fields: [recordingArtifacts.sessionId], references: [sessions.id] }),
}));

export const heatmapBaseTemplatesRelations = relations(heatmapBaseTemplates, ({ one }) => ({
    project: one(projects, { fields: [heatmapBaseTemplates.projectId], references: [projects.id] }),
    sourceSession: one(sessions, { fields: [heatmapBaseTemplates.sourceSessionId], references: [sessions.id] }),
    createdBy: one(users, { fields: [heatmapBaseTemplates.createdByUserId], references: [users.id] }),
    updatedBy: one(users, { fields: [heatmapBaseTemplates.updatedByUserId], references: [users.id] }),
}));

export const replayShareLinksRelations = relations(replayShareLinks, ({ one }) => ({
    session: one(sessions, { fields: [replayShareLinks.sessionId], references: [sessions.id] }),
    project: one(projects, { fields: [replayShareLinks.projectId], references: [projects.id] }),
    team: one(teams, { fields: [replayShareLinks.teamId], references: [teams.id] }),
    createdBy: one(users, { fields: [replayShareLinks.createdByUserId], references: [users.id] }),
}));



export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
    project: one(projects, { fields: [apiKeys.projectId], references: [projects.id] }),
}));

export const projectRevenueDailyRelations = relations(projectRevenueDaily, ({ one }) => ({
    project: one(projects, { fields: [projectRevenueDaily.projectId], references: [projects.id] }),
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
