import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ZipArchive } from 'archiver';
import { pool } from '../db/client.js';
import {
    downloadFromS3ForArtifact,
    normalizeStorageEndpointForS3Client,
} from '../db/s3.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { extractFramesFromArchive } from './screenshotFrames.js';
import {
    dimensionsFromRrwebEnvelope,
    extractRrwebEventsFromArtifact,
} from '../utils/webAttentionHeatmap.js';
import {
    extractMobileHierarchySnapshotsFromArtifact,
    type MobileHierarchySnapshot,
} from '../utils/mobileAttentionHeatmap.js';

const RESEARCH_SCHEMA_VERSION = 1;
const RESEARCH_ANONYMIZATION_VERSION = 1;
const PHONE_PORTRAIT_GRID = { columns: 64, rows: 128 } as const;
const PHONE_LANDSCAPE_GRID = { columns: 128, rows: 64 } as const;
const TABLET_PORTRAIT_GRID = { columns: 96, rows: 128 } as const;
const TABLET_LANDSCAPE_GRID = { columns: 128, rows: 96 } as const;
const TABLET_ASPECT_RATIO_MAX = 1.65;
const JPEG_MAX_MEMORY_MB = 192;
const HIERARCHY_ALIGNMENT_TOLERANCE_MS = 500;
const HIERARCHY_GOOD_ALIGNMENT_RATIO = 0.8;
const HIERARCHY_PER_FRAME_MIN_COVERAGE_RATIO = 0.8;
const HIERARCHY_EVERY_OTHER_MIN_RATIO = 0.35;
const RRWEB_EVENT_TYPE_FULL_SNAPSHOT = 2;
const RRWEB_EVENT_TYPE_INCREMENTAL = 3;
const RRWEB_EVENT_TYPE_META = 4;
const RRWEB_INCREMENTAL_MUTATION = 0;
const RRWEB_INCREMENTAL_SCROLL = 3;
const RRWEB_INCREMENTAL_VIEWPORT_RESIZE = 4;
const RESEARCH_LAKE_TYPES = ['interaction', 'behavioral_outcomes'] as const;
const STALE_PROCESSING_BUFFER_MS = 10 * 60 * 1000;

const require = createRequire(import.meta.url);
const jpeg = require('jpeg-js') as {
    decode: (buffer: Buffer, options?: { maxMemoryUsageInMB?: number }) => {
        width: number;
        height: number;
        data: Uint8Array;
    };
};

export type ResearchLakeType = typeof RESEARCH_LAKE_TYPES[number];

type ScreenOrientation = 'portrait' | 'landscape';
type ScreenFormFactor = 'phone' | 'tablet';
type FeatureGridSpec = {
    columns: number;
    rows: number;
    orientation: ScreenOrientation;
    formFactor: ScreenFormFactor;
};

type ResearchJobRow = {
    id: string;
    session_id: string;
    lake_type: ResearchLakeType;
    project_id: string;
    team_id: string;
    due_at: Date;
    attempts: number;
};

type SessionContext = {
    id: string;
    project_id: string;
    team_id: string;
    platform: string | null;
    app_version: string | null;
    sdk_version: string | null;
    started_at: Date;
    ended_at: Date | null;
    duration_seconds: number | null;
    retention_days: number;
    events: unknown;
    metadata: unknown;
    total_events: number | null;
    touch_count: number | null;
    scroll_count: number | null;
    gesture_count: number | null;
    input_count: number | null;
    api_success_count: number | null;
    api_error_count: number | null;
    api_total_count: number | null;
    api_avg_response_ms: number | null;
    rage_tap_count: number | null;
    dead_tap_count: number | null;
    custom_event_count: number | null;
    app_startup_time_ms: number | null;
    network_type: string | null;
    cellular_generation: string | null;
    is_constrained: boolean | null;
    is_expensive: boolean | null;
    sdk_upload_success_count: number | null;
    sdk_upload_failure_count: number | null;
    sdk_retry_attempt_count: number | null;
    sdk_circuit_breaker_open_count: number | null;
    sdk_memory_eviction_count: number | null;
    sdk_offline_persist_count: number | null;
    sdk_upload_success_rate: number | null;
    sdk_avg_upload_duration_ms: number | null;
    sdk_total_bytes_uploaded: bigint | number | null;
    sdk_total_bytes_evicted: bigint | number | null;
    hierarchy_snapshot_count: number | null;
    screenshot_segment_count: number | null;
    screenshot_total_bytes: bigint | number | null;
    screens_visited: string[] | null;
    geo_country: string | null;
    geo_country_code: string | null;
    geo_city: string | null;
    user_display_id: string | null;
    observe_only: boolean;
    replay_quota_billing_exhausted: boolean;
    replay_retention_state: string | null;
    text_input_masking: string | null;
    image_video_masking: string | null;
    crash_count?: number;
    anr_count?: number;
    error_count?: number;
};

type ArtifactContext = {
    id: string;
    kind: string;
    status: string;
    s3ObjectKey: string | null;
    endpointId: string | null;
    size_bytes: number | null;
    declared_size_bytes: number | null;
    start_time: number | null;
    end_time: number | null;
    frame_count: number | null;
};

type ResearchInteractionRow = Record<string, unknown> & {
    index: number;
    kind: string;
    elapsed_ms_bucket: number | null;
    screen_key: string;
    target_key: string;
};

type ResearchUiFrameRow = Record<string, unknown> & {
    frame_key: string;
    source_kind: 'screenshots' | 'rrweb' | 'hierarchy';
    source_index: number;
    elapsed_ms_bucket: number | null;
    screen_key: string;
};

type ResearchUiElementRow = Record<string, unknown> & {
    element_key: string;
    frame_key: string | null;
    screen_key: string;
    role: string;
};

type ScreenshotFeatureGrid = {
    width: number;
    height: number;
    gridColumns: number;
    gridRows: number;
    orientation: ScreenOrientation;
    formFactor: ScreenFormFactor;
    lumaGrid: number[];
    edgeGrid: number[];
    colorGrid: number[];
    signature: string;
    featureGridStatus: 'ok' | 'decode_failed';
};

type ResearchVisualRows = {
    frames: ResearchUiFrameRow[];
    skeleton: ResearchUiElementRow[];
};

export type ResearchLakeLaneSummary = {
    seeded: number;
    attempted: number;
    exported: number;
    rejected: number;
    failed: number;
};

export type RevenueOutcomeExportSummary = {
    attempted: number;
    exported: number;
    failed: number;
    mode: 'disabled' | 'backfill' | 'incremental' | 'idle';
};

export interface ResearchLakeCycleSummary extends ResearchLakeLaneSummary {
    recoveredStaleProcessing: number;
    byLake: Record<ResearchLakeType, ResearchLakeLaneSummary>;
    revenueOutcomes: RevenueOutcomeExportSummary;
}

let researchLakeClient: S3Client | null = null;

function getHashSecret(): string {
    return config.RESEARCH_LAKE_HASH_SECRET
        || config.SHARE_LINK_SECRET
        || config.JWT_SECRET;
}

function hmac(value: string, length = 24): string {
    return crypto.createHmac('sha256', getHashSecret()).update(value).digest('hex').slice(0, length);
}

function hmacBuffer(prefix: string, value: Buffer, length = 24): string {
    return crypto.createHmac('sha256', getHashSecret()).update(prefix).update(value).digest('hex').slice(0, length);
}

function getResearchLakeClient(): S3Client {
    if (researchLakeClient) return researchLakeClient;
    if (
        !config.RESEARCH_LAKE_ENDPOINT
        || !config.RESEARCH_LAKE_BUCKET
        || !config.RESEARCH_LAKE_ACCESS_KEY_ID
        || !config.RESEARCH_LAKE_SECRET_ACCESS_KEY
    ) {
        throw new Error('Research lake storage is enabled but endpoint, bucket, or credentials are missing');
    }

    const normalized = normalizeStorageEndpointForS3Client(
        config.RESEARCH_LAKE_ENDPOINT,
        config.RESEARCH_LAKE_BUCKET,
    );
    researchLakeClient = new S3Client({
        endpoint: normalized.endpointUrl,
        region: config.RESEARCH_LAKE_REGION,
        credentials: {
            accessKeyId: config.RESEARCH_LAKE_ACCESS_KEY_ID,
            secretAccessKey: config.RESEARCH_LAKE_SECRET_ACCESS_KEY,
        },
        forcePathStyle: normalized.forcePathStyle,
    });
    return researchLakeClient;
}

function jsonBuffer(value: unknown): Buffer {
    return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function jsonlBuffer(rows: unknown[]): Buffer {
    return Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}

function jsonlGzipBuffer(rows: unknown[]): Buffer {
    return gzipSync(Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8'));
}

function createZipArchiveBuffer(files: { name: string; buffer: Buffer }[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const archive = new ZipArchive({ zlib: { level: 9 } });
        const buffers: Buffer[] = [];
        archive.on('data', (data: Buffer) => buffers.push(data));
        archive.on('end', () => resolve(Buffer.concat(buffers)));
        archive.on('error', (err: any) => reject(err));
        for (const file of files) {
            archive.append(file.buffer, { name: file.name });
        }
        archive.finalize();
    });
}

async function putResearchObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await getResearchLakeClient().send(new PutObjectCommand({
        Bucket: config.RESEARCH_LAKE_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
    }));
}

function asEvents(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is Record<string, unknown> => (
        Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
    ));
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | null {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function positiveNumber(value: unknown): number | null {
    const numeric = numberValue(value);
    return numeric !== null && numeric > 0 ? numeric : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

type ViewportDimensions = {
    width: number | null;
    height: number | null;
    source: 'event' | 'session_metadata' | 'session_event_fallback' | 'missing';
};

function viewportDimensionsFromRecord(
    record: Record<string, unknown>,
    payload: Record<string, unknown> = {},
    deviceInfo: Record<string, unknown> = {},
): ViewportDimensions {
    const rawWidth = record.viewportWidth
        ?? record.viewport_width
        ?? payload.viewportWidth
        ?? payload.viewport_width
        ?? record.width
        ?? payload.width
        ?? record.screenWidth
        ?? record.screen_width
        ?? payload.screenWidth
        ?? payload.screen_width
        ?? deviceInfo.viewportWidth
        ?? deviceInfo.viewport_width
        ?? deviceInfo.screenWidth
        ?? deviceInfo.screen_width
        ?? deviceInfo.width;
    const rawHeight = record.viewportHeight
        ?? record.viewport_height
        ?? payload.viewportHeight
        ?? payload.viewport_height
        ?? record.height
        ?? payload.height
        ?? record.screenHeight
        ?? record.screen_height
        ?? payload.screenHeight
        ?? payload.screen_height
        ?? deviceInfo.viewportHeight
        ?? deviceInfo.viewport_height
        ?? deviceInfo.screenHeight
        ?? deviceInfo.screen_height
        ?? deviceInfo.height;

    return {
        width: positiveNumber(rawWidth),
        height: positiveNumber(rawHeight),
        source: positiveNumber(rawWidth) !== null && positiveNumber(rawHeight) !== null ? 'event' : 'missing',
    };
}

function sessionViewportFallback(session: SessionContext, events: Record<string, unknown>[]): ViewportDimensions {
    const metadata = objectValue(session.metadata) ?? {};
    const metadataDeviceInfo = objectValue(metadata.deviceInfo)
        ?? objectValue(metadata.device_info)
        ?? objectValue(metadata.device)
        ?? {};
    const fromMetadata = viewportDimensionsFromRecord(metadata, metadata, metadataDeviceInfo);
    if (fromMetadata.width !== null && fromMetadata.height !== null) {
        return { ...fromMetadata, source: 'session_metadata' };
    }

    for (const event of events) {
        const payload = objectValue(event.payload) ?? {};
        const deviceInfo = objectValue(event.deviceInfo)
            ?? objectValue(event.device_info)
            ?? objectValue(payload.deviceInfo)
            ?? objectValue(payload.device_info)
            ?? {};
        const candidate = viewportDimensionsFromRecord(event, payload, deviceInfo);
        if (candidate.width !== null && candidate.height !== null) {
            return { ...candidate, source: 'session_event_fallback' };
        }
    }

    return { width: null, height: null, source: 'missing' };
}

function bucketNumber(value: unknown, bucketSize: number, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
    const numeric = numberValue(value);
    if (numeric === null) return null;
    const bounded = Math.max(min, Math.min(max, numeric));
    return Math.round(bounded / bucketSize) * bucketSize;
}

function bucketMoneyAmount(value: unknown): number | null {
    const numeric = numberValue(value);
    if (numeric === null) return null;
    const bounded = Math.max(0, Math.min(1_000_000, numeric));
    if (bounded <= 200) return bucketNumber(bounded, 10, 0, 200);
    if (bounded <= 1_000) return bucketNumber(bounded, 50, 0, 1_000);
    return bucketNumber(bounded, 100, 0, 1_000_000);
}

function bucketItemCount(value: unknown): number | null {
    const numeric = numberValue(value);
    if (numeric === null) return null;
    const rounded = Math.max(0, Math.min(10_000, Math.round(numeric)));
    if (rounded <= 5) return rounded;
    if (rounded <= 10) return 10;
    if (rounded <= 20) return 20;
    if (rounded <= 50) return 50;
    if (rounded <= 100) return 100;
    return bucketNumber(rounded, 100, 0, 10_000);
}

function normalizedPositionBucket(position: unknown, extent: unknown): number | null {
    const rawPosition = numberValue(position);
    const rawExtent = positiveNumber(extent);
    if (rawPosition === null || rawExtent === null) return null;
    const normalized = (Math.max(0, Math.min(rawExtent, rawPosition)) / rawExtent) * 1000;
    return bucketNumber(normalized, 5, 0, 1000);
}

function visualGridSpecForDimensions(width: unknown, height: unknown): FeatureGridSpec {
    const numericWidth = positiveNumber(width);
    const numericHeight = positiveNumber(height);
    if (numericWidth === null || numericHeight === null) {
        return {
            ...PHONE_PORTRAIT_GRID,
            orientation: 'portrait',
            formFactor: 'phone',
        };
    }

    const orientation: ScreenOrientation = numericWidth > numericHeight ? 'landscape' : 'portrait';
    const shortSide = Math.min(numericWidth, numericHeight);
    const longSide = Math.max(numericWidth, numericHeight);
    const aspectRatio = shortSide > 0 ? longSide / shortSide : Number.POSITIVE_INFINITY;
    const formFactor: ScreenFormFactor = aspectRatio < TABLET_ASPECT_RATIO_MAX ? 'tablet' : 'phone';
    if (formFactor === 'tablet') {
        return {
            ...(orientation === 'landscape' ? TABLET_LANDSCAPE_GRID : TABLET_PORTRAIT_GRID),
            orientation,
            formFactor,
        };
    }

    return {
        ...(orientation === 'landscape' ? PHONE_LANDSCAPE_GRID : PHONE_PORTRAIT_GRID),
        orientation,
        formFactor,
    };
}

function gridCellFromNormalizedBucket(value: number | null, cellCount: number): number | null {
    if (value === null) return null;
    return Math.max(0, Math.min(cellCount - 1, Math.floor((value / 1000) * cellCount)));
}

function bucketTimestampElapsedMs(timestampMs: number | null, session: SessionContext, bucketSize = 500): number | null {
    if (timestampMs === null) return null;
    return bucketNumber(timestampMs - session.started_at.getTime(), bucketSize, 0, 86_400_000);
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
    let offset = 2;
    while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }

        const marker = buffer[offset + 1];
        offset += 2;

        if (marker === 0xd8 || marker === 0xd9) continue;
        if (marker >= 0xd0 && marker <= 0xd7) continue;
        if (offset + 2 > buffer.length) break;

        const segmentLength = buffer.readUInt16BE(offset);
        if (segmentLength < 2 || offset + segmentLength > buffer.length) break;

        const isStartOfFrame = [
            0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
            0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
        ].includes(marker);
        if (isStartOfFrame && segmentLength >= 7) {
            return {
                height: buffer.readUInt16BE(offset + 3),
                width: buffer.readUInt16BE(offset + 5),
            };
        }

        offset += segmentLength;
    }
    return null;
}

function datePart(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function coarseAppVersion(value: string | null): string {
    if (!value) return 'unknown';
    const match = value.match(/^(\d+)(?:\.(\d+))?/);
    if (!match) return 'other';
    return [match[1], match[2]].filter(Boolean).join('.');
}

function classifyEventKind(event: Record<string, unknown>): string {
    const raw = stringValue(event.type) || stringValue(event.name) || stringValue(event.event) || 'event';
    const normalized = raw.toLowerCase();
    if (normalized.includes('touch') || normalized.includes('tap') || normalized.includes('click')) return 'tap';
    if (normalized.includes('scroll')) return 'scroll';
    if (normalized.includes('gesture') || normalized.includes('swipe') || normalized.includes('pan')) return 'gesture';
    if (normalized.includes('input') || normalized.includes('text')) return 'input';
    if (normalized.includes('screen') || normalized.includes('route') || normalized.includes('page')) return 'screen';
    return 'event';
}

function rawScreenValue(event: Record<string, unknown>, session: SessionContext): string {
    const direct = stringValue(event.screen)
        || stringValue(event.screenName)
        || stringValue(event.page)
        || stringValue(event.route)
        || stringValue(event.url);
    if (direct) return direct;
    return session.screens_visited?.[0] || 'unknown';
}

function classifyScreen(raw: string): string {
    if (!raw || raw === 'unknown') return 'unknown';
    if (/^https?:\/\//i.test(raw)) return 'web_url';
    if (raw.includes('/')) return 'route';
    return 'screen';
}

function screenKey(raw: string, projectKey: string): string {
    return hmac(`${projectKey}:screen:${raw}`, 20);
}

const FUNNEL_TRANSITION_ALIASES = [
    {
        transition: 'purchase_complete',
        names: [
            'purchase_completed',
            'purchase_complete',
            'purchase_success',
            'purchase_successful',
            'purchase_succeeded',
            'purchase_paid',
            'purchase',
            'order_completed',
            'order_complete',
            'order_success',
            'order_succeeded',
            'order_paid',
            'complete_purchase',
            'completed_purchase',
            'successful_purchase',
            'conversion',
            'conversion_complete',
            'conversion_completed',
            'payment_success',
            'payment_successful',
            'payment_succeeded',
            'payment_completed',
            'checkout_completed',
            'checkout_complete',
            'checkout_success',
            'checkout_succeeded',
            'booking_completed',
            'booking_success',
            'reservation_completed',
            'reservation_success',
        ],
    },
    {
        transition: 'checkout_start',
        names: [
            'checkout_started',
            'checkout_start',
            'begin_checkout',
            'checkout_begin',
            'start_checkout',
            'checkout_initiated',
            'initiate_checkout',
            'initiated_checkout',
            'checkout_opened',
            'checkout_viewed',
            'checkout_page_viewed',
            'checkout_step_started',
            'payment_started',
        ],
    },
    {
        transition: 'cart_add',
        names: [
            'add_to_cart',
            'cart_add',
            'addtocart',
            'added_to_cart',
            'product_added_to_cart',
            'item_added_to_cart',
            'item_add_to_cart',
            'cart_item_added',
            'add_cart',
            'add_to_basket',
            'basket_add',
            'added_to_basket',
            'add_to_bag',
            'bag_add',
            'added_to_bag',
            'add_to_order',
            'item_added',
            'product_added',
        ],
    },
    {
        transition: 'product_view',
        names: [
            'view_item',
            'product_view',
            'viewproduct',
            'product_viewed',
            'view_product',
            'product_detail_view',
            'product_details_view',
            'product_detail_viewed',
            'product_details_viewed',
            'product_opened',
            'item_view',
            'item_viewed',
            'view_item_detail',
            'listing_view',
            'listing_viewed',
            'content_view',
            'content_viewed',
        ],
    },
    {
        transition: 'signup',
        names: [
            'signup',
            'sign_up',
            'register',
            'account_created',
            'signup_completed',
            'sign_up_completed',
            'signed_up',
            'user_signup',
            'user_signed_up',
            'user_registered',
            'registration_completed',
            'registration_complete',
            'register_completed',
            'account_signup',
            'create_account',
            'account_creation',
            'account_created_success',
            'signup_success',
            'signup_started',
            'registration_started',
        ],
    },
    {
        transition: 'login',
        names: [
            'login',
            'sign_in',
            'signin',
            'signed_in',
            'logged_in',
            'user_login',
            'user_logged_in',
            'sign_in_success',
            'login_success',
            'login_completed',
        ],
    },
    {
        transition: 'paywall_view',
        names: [
            'paywall_view',
            'paywall_exposure',
            'view_paywall',
            'paywall_viewed',
            'paywall_seen',
            'paywall_opened',
            'paywall_shown',
            'paywall_displayed',
            'paywall_impression',
            'subscription_paywall_viewed',
        ],
    },
    {
        transition: 'plan_selected',
        names: [
            'plan_selected',
            'pricing_plan_selected',
            'select_plan',
            'pricing_viewed',
            'pricing_page_viewed',
            'pricing_page_view',
            'selected_plan',
            'plan_chosen',
            'choose_plan',
            'chose_plan',
            'subscription_plan_selected',
            'package_selected',
            'product_package_selected',
            'price_selected',
            'tier_selected',
        ],
    },
    {
        transition: 'coupon_use',
        names: [
            'coupon_use',
            'coupon_used',
            'apply_coupon',
            'coupon_applied',
            'coupon_apply',
            'discount_applied',
            'apply_discount',
            'promo_code_applied',
            'promo_applied',
            'promo_code_used',
            'discount_code_applied',
            'voucher_applied',
        ],
    },
    {
        transition: 'trial_start',
        names: [
            'trial_started',
            'trial_start',
            'begin_trial',
            'start_trial',
            'trial_begin',
            'free_trial_started',
            'free_trial_start',
            'trial_activated',
            'trial_began',
            'trial_created',
        ],
    },
    {
        transition: 'subscription_start',
        names: [
            'subscription_started',
            'subscription_start',
            'subscribe',
            'subscribed',
            'subscription_created',
            'subscription_activated',
            'subscription_success',
            'subscription_successful',
            'subscription_succeeded',
            'subscription_purchased',
            'plan_started',
            'plan_activated',
            'membership_started',
            'membership_created',
        ],
    },
    {
        transition: 'refund',
        names: [
            'refund',
            'refund_completed',
            'refunded',
            'refund_processed',
            'refund_issued',
            'refund_success',
            'refund_succeeded',
            'refund_created',
            'order_refunded',
            'payment_refunded',
        ],
    },
    {
        transition: 'cancellation',
        names: [
            'cancel',
            'canceled',
            'cancelled',
            'cancel_subscription',
            'cancellation',
            'subscription_cancelled',
            'subscription_canceled',
            'subscription_cancel',
            'subscription_cancel_requested',
            'subscription_ended',
            'subscription_expired',
            'plan_cancelled',
            'plan_canceled',
            'unsubscribe',
            'unsubscribed',
            'membership_cancelled',
            'membership_canceled',
        ],
    },
    {
        transition: 'payment_failure',
        names: [
            'payment_failure',
            'payment_failed',
            'charge_failed',
            'payment_error',
            'payment_declined',
            'card_declined',
            'transaction_failed',
            'checkout_failed',
            'purchase_failed',
            'payment_unsuccessful',
            'invoice_payment_failed',
            'billing_error',
            'billing_failed',
        ],
    },
    {
        transition: 'onboarding_completed',
        names: [
            'onboarding_completed',
            'onboarding_milestone',
            'complete_onboarding',
            'onboarding_complete',
            'onboarding_finished',
            'onboarding_finish',
            'onboarding_done',
            'onboarding_success',
            'onboarding_step_completed',
            'tutorial_completed',
            'setup_completed',
            'activation_completed',
        ],
    },
    {
        transition: 'feature_used',
        names: [
            'feature_used',
            'key_feature_used',
            'use_feature',
            'feature_use',
            'used_feature',
            'feature_clicked',
            'feature_activated',
            'feature_enabled',
            'key_feature_activated',
            'tool_used',
            'action_used',
            'integration_connected',
            'workspace_created',
        ],
    },
    {
        transition: 'ad_viewed',
        names: [
            'ad_viewed',
            'ad_view',
            'ad_seen',
            'ad_shown',
            'ad_displayed',
            'ad_impression',
            'ad_exposure',
            'ad_rendered',
        ],
    },
    {
        transition: 'ad_clicked',
        names: [
            'ad_clicked',
            'ad_click',
            'ad_tapped',
            'ad_tap',
            'ad_cta_clicked',
            'ad_opened',
        ],
    },
    {
        transition: 'native_ad_viewed',
        names: [
            'native_ad_viewed',
            'native_ad_impression',
            'native_ad_seen',
            'native_ad_shown',
            'native_ad_displayed',
        ],
    },
    {
        transition: 'native_ad_clicked',
        names: [
            'native_ad_clicked',
            'native_ad_click',
            'native_ad_tapped',
            'native_ad_cta_clicked',
        ],
    },
    {
        transition: 'banner_ad_viewed',
        names: [
            'banner_ad_viewed',
            'banner_ad_impression',
            'banner_ad_seen',
            'banner_ad_shown',
            'banner_ad_displayed',
        ],
    },
    {
        transition: 'banner_ad_clicked',
        names: [
            'banner_ad_clicked',
            'banner_ad_click',
            'banner_ad_tapped',
            'banner_ad_cta_clicked',
        ],
    },
    {
        transition: 'interstitial_ad_viewed',
        names: [
            'interstitial_ad_viewed',
            'interstitial_ad_impression',
            'interstitial_ad_seen',
            'interstitial_ad_shown',
            'interstitial_ad_displayed',
        ],
    },
    {
        transition: 'interstitial_ad_clicked',
        names: [
            'interstitial_ad_clicked',
            'interstitial_ad_click',
            'interstitial_ad_tapped',
            'interstitial_ad_cta_clicked',
        ],
    },
    {
        transition: 'rewarded_ad_viewed',
        names: [
            'rewarded_ad_viewed',
            'rewarded_ad_impression',
            'rewarded_ad_seen',
            'rewarded_ad_shown',
            'rewarded_video_ad_viewed',
            'rewarded_video_ad_impression',
        ],
    },
    {
        transition: 'rewarded_ad_clicked',
        names: [
            'rewarded_ad_clicked',
            'rewarded_ad_click',
            'rewarded_ad_tapped',
            'rewarded_video_ad_clicked',
        ],
    },
    {
        transition: 'video_ad_viewed',
        names: [
            'video_ad_viewed',
            'video_ad_impression',
            'video_ad_seen',
            'video_ad_shown',
            'video_ad_started',
        ],
    },
    {
        transition: 'video_ad_clicked',
        names: [
            'video_ad_clicked',
            'video_ad_click',
            'video_ad_tapped',
            'video_ad_cta_clicked',
        ],
    },
    {
        transition: 'sponsored_ad_viewed',
        names: [
            'sponsored_ad_viewed',
            'sponsored_ad_impression',
            'sponsored_ad_seen',
            'sponsored_ad_shown',
            'sponsored_content_viewed',
        ],
    },
    {
        transition: 'sponsored_ad_clicked',
        names: [
            'sponsored_ad_clicked',
            'sponsored_ad_click',
            'sponsored_ad_tapped',
            'sponsored_content_clicked',
        ],
    },
    {
        transition: 'variant_selected',
        names: [
            'variant_selected',
            'product_variant_selected',
            'select_variant',
            'variant_chosen',
        ],
    },
    {
        transition: 'size_selected',
        names: [
            'size_selected',
            'product_size_selected',
            'select_size',
            'size_chosen',
        ],
    },
    {
        transition: 'color_selected',
        names: [
            'color_selected',
            'product_color_selected',
            'select_color',
            'color_chosen',
        ],
    },
    {
        transition: 'quantity_changed',
        names: [
            'quantity_changed',
            'quantity_updated',
            'item_quantity_changed',
            'cart_quantity_changed',
        ],
    },
    {
        transition: 'reviews_viewed',
        names: [
            'reviews_viewed',
            'review_viewed',
            'product_reviews_viewed',
            'ratings_viewed',
        ],
    },
    {
        transition: 'shipping_info_viewed',
        names: [
            'shipping_info_viewed',
            'shipping_viewed',
            'shipping_details_viewed',
            'delivery_info_viewed',
        ],
    },
    {
        transition: 'return_policy_viewed',
        names: [
            'return_policy_viewed',
            'returns_viewed',
            'returns_policy_viewed',
            'refund_policy_viewed',
        ],
    },
    {
        transition: 'wishlist_add',
        names: [
            'wishlist_add',
            'add_to_wishlist',
            'added_to_wishlist',
            'product_added_to_wishlist',
            'favorite_added',
            'saved_item',
        ],
    },
    {
        transition: 'share_clicked',
        names: [
            'share_clicked',
            'share_click',
            'share_tapped',
            'product_shared',
            'item_shared',
        ],
    },
    {
        transition: 'upgrade_clicked',
        names: [
            'upgrade_clicked',
            'upgrade_click',
            'upgrade_cta_clicked',
            'click_upgrade',
        ],
    },
    {
        transition: 'upgrade_completed',
        names: [
            'upgrade_completed',
            'upgrade_complete',
            'upgraded',
            'plan_upgraded',
            'subscription_upgraded',
        ],
    },
    {
        transition: 'discount_offer_viewed',
        names: [
            'discount_offer_viewed',
            'discount_viewed',
            'offer_viewed',
            'promo_offer_viewed',
        ],
    },
    {
        transition: 'discount_offer_accepted',
        names: [
            'discount_offer_accepted',
            'discount_accepted',
            'offer_accepted',
            'promo_offer_accepted',
        ],
    },
    {
        transition: 'cancel_flow_started',
        names: [
            'cancel_flow_started',
            'cancellation_started',
            'cancel_started',
            'subscription_cancel_flow_started',
        ],
    },
    {
        transition: 'cancel_confirmed',
        names: [
            'cancel_confirmed',
            'cancellation_confirmed',
            'subscription_cancel_confirmed',
            'subscription_cancellation_confirmed',
        ],
    },
] as const;

type FunnelTransition = typeof FUNNEL_TRANSITION_ALIASES[number]['transition'];

const FUNNEL_TRANSITION_ALIAS_MAP = new Map<string, FunnelTransition>();
for (const group of FUNNEL_TRANSITION_ALIASES) {
    for (const name of group.names) {
        FUNNEL_TRANSITION_ALIAS_MAP.set(normalizeEventName(name), group.transition);
    }
}

function normalizeEventName(value: unknown): string {
    return stringValue(value)
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

function customConfigEventMatches(name: string, configuredName: unknown): boolean {
    const normalizedConfiguredName = normalizeEventName(configuredName);
    return normalizedConfiguredName !== '' && name === normalizedConfiguredName;
}

function getFunnelTransition(eventName: string, customEventConfig?: any): string | null {
    const name = normalizeEventName(eventName);
    if (!name) return null;
    
    // Check custom event config first
    if (customEventConfig) {
        if (customConfigEventMatches(name, customEventConfig.revenueEventName)) {
            return 'purchase_complete';
        }
        if (customConfigEventMatches(name, customEventConfig.conversionEventName)) {
            return 'purchase_complete';
        }
        if (customConfigEventMatches(name, customEventConfig.checkoutEventName)) {
            return 'checkout_start';
        }
        if (customConfigEventMatches(name, customEventConfig.subscriptionStartedEventName)) {
            return 'checkout_start';
        }
        if (customConfigEventMatches(name, customEventConfig.subscriberEventName)) {
            return 'cart_add';
        }
    }

    return FUNNEL_TRANSITION_ALIAS_MAP.get(name) ?? null;
}

function buildInteractions(
    session: SessionContext,
    projectKey: string,
    customEventConfig?: any
): ResearchInteractionRow[] {
    const events = asEvents(session.events);
    const startedAtMs = session.started_at.getTime();
    const fallbackViewport = sessionViewportFallback(session, events);
    let rollingViewport = fallbackViewport;
    return events.map((event, index) => {
        const payload = objectValue(event.payload) ?? {};
        const deviceInfo = objectValue(event.deviceInfo)
            ?? objectValue(event.device_info)
            ?? objectValue(payload.deviceInfo)
            ?? objectValue(payload.device_info)
            ?? {};
        const props = objectValue(event.properties) ?? payload;
        const rawScreen = rawScreenValue(event, session);
        const eventAt = numberValue(event.timestamp ?? event.time ?? event.ts);
        const elapsedMs = eventAt && eventAt > startedAtMs
            ? eventAt - startedAtMs
            : numberValue(event.elapsedMs ?? event.elapsed_ms);
        const rawX = event.x ?? event.clientX ?? event.pageX ?? payload.x ?? payload.clientX ?? payload.pageX;
        const rawY = event.y ?? event.clientY ?? event.pageY ?? payload.y ?? payload.clientY ?? payload.pageY;
        const eventViewport = viewportDimensionsFromRecord(event, payload, deviceInfo);
        const hasEventViewport = eventViewport.width !== null && eventViewport.height !== null;
        const activeViewport = hasEventViewport
            ? eventViewport
            : rollingViewport;
        if (hasEventViewport) {
            rollingViewport = { ...eventViewport, source: 'session_event_fallback' };
        }
        const rawViewportWidth = activeViewport.width;
        const rawViewportHeight = activeViewport.height;
        const viewportSource = hasEventViewport ? 'event' : activeViewport.source;
        const rawDocumentWidth = event.documentWidth ?? event.document_width ?? payload.documentWidth ?? payload.document_width;
        const rawDocumentHeight = event.documentHeight ?? event.document_height ?? payload.documentHeight ?? payload.document_height;
        const hasViewportX = event.x !== undefined || event.clientX !== undefined || payload.x !== undefined || payload.clientX !== undefined;
        const hasViewportY = event.y !== undefined || event.clientY !== undefined || payload.y !== undefined || payload.clientY !== undefined;
        const xNormBucket = normalizedPositionBucket(rawX, hasViewportX ? rawViewportWidth : rawDocumentWidth ?? rawViewportWidth);
        const yNormBucket = normalizedPositionBucket(rawY, hasViewportY ? rawViewportHeight : rawDocumentHeight ?? rawViewportHeight);
        const touchGrid = visualGridSpecForDimensions(rawViewportWidth, rawViewportHeight);
        const xCell = gridCellFromNormalizedBucket(xNormBucket, touchGrid.columns);
        const yCell = gridCellFromNormalizedBucket(yNormBucket, touchGrid.rows);
        const targetX = xCell ?? xNormBucket ?? bucketNumber(rawX, 24, 0, 4096) ?? 'x';
        const targetY = yCell ?? yNormBucket ?? bucketNumber(rawY, 24, 0, 4096) ?? 'y';
        const kind = classifyEventKind(event);
        const screen = screenKey(rawScreen, projectKey);

        const eventName = stringValue(event.name ?? event.type ?? event.eventName ?? event.event_name);
        const transition = getFunnelTransition(eventName, customEventConfig);
        
        let cartValueBucket: number | null = null;
        let itemCountChange: number | null = null;
        
        if (transition === 'cart_add') {
            const rawQty = numberValue(props.quantity ?? props.qty ?? event.quantity ?? event.qty);
            const qtyVal = rawQty !== null ? rawQty : 1;
            itemCountChange = bucketItemCount(qtyVal);
        }
        
        const amtProp = typeof customEventConfig?.revenueAmountProperty === 'string' && customEventConfig.revenueAmountProperty.trim()
            ? customEventConfig.revenueAmountProperty.trim()
            : null;
        let rawVal = numberValue(
            (amtProp ? (props[amtProp] ?? event[amtProp]) : null) ??
            props.price ?? props.amount ?? props.value ?? props.cart_value ?? props.cartValue ?? event.price ?? event.amount ?? event.value
        );
        if (rawVal !== null) {
            if (customEventConfig?.amountUnit === 'minor') {
                rawVal = rawVal / 100;
            }
            cartValueBucket = bucketMoneyAmount(rawVal);
        }

        const productIdRaw = props.productId ?? props.product_id ?? props.sku ?? event.productId ?? event.product_id ?? event.sku;
        const productId = typeof productIdRaw === 'string' && productIdRaw ? productIdRaw : null;
        const productKey = productId ? hmac(`${projectKey}:product:${productId}`, 20) : null;

        const planIdRaw = props.planId ?? props.plan_id ?? props.plan ?? event.planId ?? event.plan_id ?? event.plan;
        const planId = typeof planIdRaw === 'string' && planIdRaw ? planIdRaw : null;
        const planKey = planId ? hmac(`${projectKey}:plan:${planId}`, 20) : null;

        const priceIdRaw = props.priceId ?? props.price_id ?? event.priceId ?? event.price_id;
        const priceId = typeof priceIdRaw === 'string' && priceIdRaw ? priceIdRaw : null;
        const priceKey = priceId ? hmac(`${projectKey}:price:${priceId}`, 20) : null;

        const curProp = typeof customEventConfig?.revenueCurrencyProperty === 'string' && customEventConfig.revenueCurrencyProperty.trim()
            ? customEventConfig.revenueCurrencyProperty.trim()
            : null;
        let currency = curProp
            ? (stringValue(props[curProp] ?? event[curProp]) || null)
            : null;
        if (!currency) {
            const currencyRaw = props.currency ?? event.currency;
            currency = typeof currencyRaw === 'string' && currencyRaw ? currencyRaw : null;
        }
        if (!currency && customEventConfig?.defaultCurrency) {
            currency = String(customEventConfig.defaultCurrency);
        }
        if (currency) {
            currency = currency.trim().toUpperCase();
        }

        const paymentProviderRaw = props.paymentProvider ?? props.payment_provider ?? event.paymentProvider ?? event.payment_provider;
        const paymentProvider = typeof paymentProviderRaw === 'string' && paymentProviderRaw ? paymentProviderRaw : null;

        const platformRaw = props.platform ?? event.platform;
        const platform = typeof platformRaw === 'string' && platformRaw ? platformRaw : null;

        let isRenewal: boolean | null = null;
        const isRenewalRaw = props.isRenewal ?? props.is_renewal ?? event.isRenewal ?? event.is_renewal;
        if (isRenewalRaw !== undefined && isRenewalRaw !== null) {
            isRenewal = Boolean(isRenewalRaw);
        }

        let isTrialConversion: boolean | null = null;
        const isTrialConversionRaw = props.isTrialConversion ?? props.is_trial_conversion ?? event.isTrialConversion ?? event.is_trial_conversion;
        if (isTrialConversionRaw !== undefined && isTrialConversionRaw !== null) {
            isTrialConversion = Boolean(isTrialConversionRaw);
        }
        return {
            index,
            kind,
            elapsed_ms_bucket: bucketNumber(elapsedMs, 500, 0, 86_400_000),
            screen_key: screen,
            screen_class: classifyScreen(rawScreen),
            target_key: hmac(`${screen}:${kind}:${targetX}:${targetY}`, 20),
            x_norm_bucket: xNormBucket,
            y_norm_bucket: yNormBucket,
            x_cell: xCell,
            y_cell: yCell,
            touch_grid_columns: touchGrid.columns,
            touch_grid_rows: touchGrid.rows,
            screen_orientation: touchGrid.orientation,
            screen_form_factor: touchGrid.formFactor,
            viewport_width_bucket: bucketNumber(rawViewportWidth, 64, 0, 8192),
            viewport_height_bucket: bucketNumber(rawViewportHeight, 64, 0, 8192),
            viewport_source: viewportSource,
            input_modality: kind === 'tap' ? 'pointer' : kind,
            funnel_transition: transition,
            item_count_change: itemCountChange,
            cart_value_bucket: cartValueBucket,
            product_key: productKey,
            plan_key: planKey,
            price_key: priceKey,
            currency: currency,
            payment_provider: paymentProvider,
            platform: platform,
            is_renewal: isRenewal,
            is_trial_conversion: isTrialConversion,
        };
    });
}

function buildInteractionSkeleton(interactions: ResearchInteractionRow[]): ResearchUiElementRow[] {
    const elements = new Map<string, ResearchUiElementRow>();
    for (const interaction of interactions) {
        const targetKey = stringValue(interaction.target_key);
        if (!targetKey || elements.has(targetKey)) continue;

        let role = interaction.kind === 'input' ? 'input' : interaction.kind === 'scroll' ? 'scroll_region' : 'interactive';
        const transition = stringValue(interaction.funnel_transition);
        if (transition === 'purchase_complete') {
            role = 'cta_purchase';
        } else if (transition === 'checkout_start') {
            role = 'cta_checkout';
        } else if (transition === 'cart_add') {
            role = 'cta_cart_add';
        } else if (transition === 'product_view') {
            role = 'view_item';
        } else if (transition === 'paywall_view') {
            role = 'paywall_element';
        } else if (transition === 'plan_selected') {
            role = 'plan_selector';
        } else if (transition === 'signup') {
            role = 'cta_signup';
        } else if (transition === 'login') {
            role = 'cta_login';
        } else if (transition === 'trial_start') {
            role = 'cta_trial_start';
        } else if (transition === 'subscription_start') {
            role = 'cta_subscription_start';
        } else if (transition === 'refund') {
            role = 'cta_refund';
        } else if (transition === 'cancellation') {
            role = 'cta_cancellation';
        } else if (transition === 'payment_failure') {
            role = 'payment_failure_element';
        } else if (transition === 'onboarding_completed') {
            role = 'cta_onboarding';
        } else if (transition === 'feature_used') {
            role = 'feature_element';
        } else if (transition === 'coupon_use') {
            role = 'cta_coupon_use';
        } else if (transition === 'ad_clicked' || transition.endsWith('_ad_clicked')) {
            role = 'ad_click';
        } else if (transition === 'ad_viewed' || transition.endsWith('_ad_viewed')) {
            role = 'ad_impression';
        } else if (['variant_selected', 'size_selected', 'color_selected', 'quantity_changed'].includes(transition)) {
            role = 'product_option';
        } else if (['reviews_viewed', 'shipping_info_viewed', 'return_policy_viewed'].includes(transition)) {
            role = 'product_info';
        } else if (['wishlist_add', 'share_clicked'].includes(transition)) {
            role = 'engagement_element';
        } else if (['upgrade_clicked', 'upgrade_completed'].includes(transition)) {
            role = 'upgrade_element';
        } else if (['discount_offer_viewed', 'discount_offer_accepted'].includes(transition)) {
            role = 'discount_element';
        } else if (['cancel_flow_started', 'cancel_confirmed'].includes(transition)) {
            role = 'cancellation_element';
        }

        elements.set(targetKey, {
            element_key: targetKey,
            frame_key: null,
            screen_key: interaction.screen_key,
            role,
            x_norm_bucket: interaction.x_norm_bucket,
            y_norm_bucket: interaction.y_norm_bucket,
            x_cell: interaction.x_cell,
            y_cell: interaction.y_cell,
            touch_grid_columns: interaction.touch_grid_columns,
            touch_grid_rows: interaction.touch_grid_rows,
            screen_orientation: interaction.screen_orientation,
            screen_form_factor: interaction.screen_form_factor,
            width_bucket: null,
            height_bucket: null,
            text_class: 'masked',
            hierarchy_depth_bucket: null,
        });
    }
    return Array.from(elements.values());
}

function nearestInteractionForElapsed(
    interactions: ResearchInteractionRow[],
    elapsedMsBucket: number | null,
): ResearchInteractionRow | null {
    if (interactions.length === 0) return null;
    if (elapsedMsBucket === null) return interactions[0];

    let best = interactions[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const interaction of interactions) {
        const candidateElapsed = numberValue(interaction.elapsed_ms_bucket);
        if (candidateElapsed === null) continue;
        const distance = Math.abs(candidateElapsed - elapsedMsBucket);
        if (distance < bestDistance) {
            best = interaction;
            bestDistance = distance;
        }
    }
    return best;
}

function fallbackScreenKey(projectKey: string): string {
    return hmac(`${projectKey}:screen:unknown`, 20);
}

function quantizeByte(value: number): number {
    return Math.max(0, Math.min(15, Math.round(value / 17)));
}

function quantizeColor(r: number, g: number, b: number): number {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 24) return 0;
    if (max === r && g >= b) return 1;
    if (max === r) return 2;
    if (max === g && r >= b) return 3;
    if (max === g) return 4;
    if (r >= g) return 5;
    return 6;
}

function imageFeatureGrid(buffer: Buffer): ScreenshotFeatureGrid | null {
    try {
        const decoded = jpeg.decode(buffer, { maxMemoryUsageInMB: JPEG_MAX_MEMORY_MB });
        if (!decoded.width || !decoded.height || decoded.data.length === 0) return null;

        const gridSpec = visualGridSpecForDimensions(decoded.width, decoded.height);
        const lumaGrid: number[] = [];
        const edgeGrid: number[] = [];
        const colorGrid: number[] = [];
        for (let gy = 0; gy < gridSpec.rows; gy++) {
            for (let gx = 0; gx < gridSpec.columns; gx++) {
                const x0 = Math.min(decoded.width - 1, Math.floor((gx * decoded.width) / gridSpec.columns));
                const y0 = Math.min(decoded.height - 1, Math.floor((gy * decoded.height) / gridSpec.rows));
                const x1 = Math.min(
                    decoded.width,
                    Math.max(x0 + 1, Math.floor(((gx + 1) * decoded.width) / gridSpec.columns)),
                );
                const y1 = Math.min(
                    decoded.height,
                    Math.max(y0 + 1, Math.floor(((gy + 1) * decoded.height) / gridSpec.rows)),
                );
                const stepX = Math.max(1, Math.floor((x1 - x0) / 12));
                const stepY = Math.max(1, Math.floor((y1 - y0) / 12));
                let lumaSum = 0;
                let edgeSum = 0;
                let rSum = 0;
                let gSum = 0;
                let bSum = 0;
                let samples = 0;

                for (let y = y0; y < y1; y += stepY) {
                    for (let x = x0; x < x1; x += stepX) {
                        const offset = (y * decoded.width + x) * 4;
                        const r = decoded.data[offset] ?? 0;
                        const g = decoded.data[offset + 1] ?? 0;
                        const b = decoded.data[offset + 2] ?? 0;
                        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                        lumaSum += luma;
                        rSum += r;
                        gSum += g;
                        bSum += b;
                        samples++;

                        const rightX = Math.min(decoded.width - 1, x + stepX);
                        const downY = Math.min(decoded.height - 1, y + stepY);
                        const rightOffset = (y * decoded.width + rightX) * 4;
                        const downOffset = (downY * decoded.width + x) * 4;
                        const rightLuma = 0.2126 * (decoded.data[rightOffset] ?? 0)
                            + 0.7152 * (decoded.data[rightOffset + 1] ?? 0)
                            + 0.0722 * (decoded.data[rightOffset + 2] ?? 0);
                        const downLuma = 0.2126 * (decoded.data[downOffset] ?? 0)
                            + 0.7152 * (decoded.data[downOffset + 1] ?? 0)
                            + 0.0722 * (decoded.data[downOffset + 2] ?? 0);
                        edgeSum += (Math.abs(luma - rightLuma) + Math.abs(luma - downLuma)) / 2;
                    }
                }

                const divisor = Math.max(1, samples);
                lumaGrid.push(quantizeByte(lumaSum / divisor));
                edgeGrid.push(quantizeByte(edgeSum / divisor));
                colorGrid.push(quantizeColor(rSum / divisor, gSum / divisor, bSum / divisor));
            }
        }

        const signature = [
            decoded.width,
            decoded.height,
            gridSpec.columns,
            gridSpec.rows,
            lumaGrid.join(''),
            edgeGrid.join(''),
            colorGrid.join(''),
        ].join(':');

        return {
            width: decoded.width,
            height: decoded.height,
            gridColumns: gridSpec.columns,
            gridRows: gridSpec.rows,
            orientation: gridSpec.orientation,
            formFactor: gridSpec.formFactor,
            lumaGrid,
            edgeGrid,
            colorGrid,
            signature,
            featureGridStatus: 'ok',
        };
    } catch (err) {
        logger.warn({ err }, 'Failed to decode screenshot frame for research lake feature grid');
        const dimensions = jpegDimensions(buffer);
        if (!dimensions) return null;
        const gridSpec = visualGridSpecForDimensions(dimensions.width, dimensions.height);
        const gridCellCount = gridSpec.columns * gridSpec.rows;
        const lumaGrid = Array.from({ length: gridCellCount }, () => 0);
        const edgeGrid = Array.from({ length: gridCellCount }, () => 0);
        const colorGrid = Array.from({ length: gridCellCount }, () => 0);
        return {
            width: dimensions.width,
            height: dimensions.height,
            gridColumns: gridSpec.columns,
            gridRows: gridSpec.rows,
            orientation: gridSpec.orientation,
            formFactor: gridSpec.formFactor,
            lumaGrid,
            edgeGrid,
            colorGrid,
            signature: `${dimensions.width}:${dimensions.height}:${gridSpec.columns}:${gridSpec.rows}:decode_failed`,
            featureGridStatus: 'decode_failed',
        };
    }
}

function gridDelta(a: number[] | null, b: number[]): number | null {
    if (!a || a.length !== b.length) return null;
    const total = b.reduce((sum, value, index) => sum + Math.abs(value - a[index]), 0);
    return Math.round(total / b.length);
}

function rrwebEventKind(event: Record<string, unknown>): string {
    const type = numberValue(event.type);
    if (type === RRWEB_EVENT_TYPE_FULL_SNAPSHOT) return 'full_snapshot';
    if (type === RRWEB_EVENT_TYPE_META) return 'meta';
    if (type === RRWEB_EVENT_TYPE_INCREMENTAL) {
        const data = event.data && typeof event.data === 'object' ? event.data as Record<string, unknown> : {};
        const source = numberValue(data.source);
        if (source === RRWEB_INCREMENTAL_MUTATION) return 'mutation';
        if (source === RRWEB_INCREMENTAL_SCROLL) return 'scroll';
        if (source === RRWEB_INCREMENTAL_VIEWPORT_RESIZE) return 'viewport_resize';
        return 'incremental';
    }
    return 'event';
}

function rrwebNodeKind(node: Record<string, unknown>): string {
    const type = numberValue(node.type);
    if (type === 2) return 'element';
    if (type === 3) return 'text';
    return 'node';
}

function safeTagName(value: unknown): string {
    const tag = stringValue(value).toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!tag) return 'node';
    if (['button', 'input', 'select', 'textarea', 'a', 'img', 'video', 'canvas', 'form', 'label'].includes(tag)) return tag;
    if (['nav', 'main', 'header', 'footer', 'aside', 'section', 'article', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th'].includes(tag)) return tag;
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return ['div', 'span', 'p', 'svg'].includes(tag) ? tag : 'element';
}

function roleForNode(node: Record<string, unknown>): string {
    const tag = safeTagName(node.tagName);
    if (['button', 'a'].includes(tag)) return 'control';
    if (['input', 'select', 'textarea'].includes(tag)) return 'input';
    if (['img', 'video', 'canvas', 'svg'].includes(tag)) return 'media';
    if (tag === 'heading') return 'heading';
    if (tag === 'text') return 'text';
    return rrwebNodeKind(node) === 'text' ? 'text' : 'container';
}

function childNodes(node: Record<string, unknown>): Record<string, unknown>[] {
    const children = node.childNodes;
    if (!Array.isArray(children)) return [];
    return children.filter((child): child is Record<string, unknown> => (
        Boolean(child) && typeof child === 'object' && !Array.isArray(child)
    ));
}

function attributeFlags(node: Record<string, unknown>): Record<string, boolean> {
    const attributes = node.attributes;
    const attr = attributes && typeof attributes === 'object' && !Array.isArray(attributes)
        ? attributes as Record<string, unknown>
        : {};
    const className = stringValue(attr.class).toLowerCase();
    const tagName = safeTagName(node.tagName);
    const hasMaskedInputValue = ['input', 'textarea'].includes(tagName)
        && (attr.value === '***' || attr.placeholder === '***');
    const hasMaskedMediaAttribute = ['img', 'video', 'canvas', 'image'].includes(tagName)
        && ['src', 'srcset', 'poster', 'href', 'xlink:href', 'data', 'rr_dataURL', 'alt', 'title', 'aria-label']
            .some((key) => attr[key] === '***');
    const hasMaskMarker = className.includes('rr-mask')
        || className.includes('rr-block')
        || className.includes('rj-media-mask')
        || attr['data-rj-mask'] !== undefined
        || attr['data-rejourney-mask'] !== undefined
        || attr['data-private'] !== undefined
        || attr['data-rj-mask-media'] !== undefined
        || attr['data-rejourney-mask-media'] !== undefined;
    return {
        has_class: typeof attr.class === 'string' && attr.class.length > 0,
        has_href: typeof attr.href === 'string' && attr.href.length > 0,
        has_src: typeof attr.src === 'string' && attr.src.length > 0,
        has_alt: typeof attr.alt === 'string' && attr.alt.length > 0,
        has_aria_label: typeof attr['aria-label'] === 'string' && attr['aria-label'].length > 0,
        has_placeholder: typeof attr.placeholder === 'string' && attr.placeholder.length > 0,
        has_masked_input_value: hasMaskedInputValue,
        has_masked_media_attribute: hasMaskedMediaAttribute,
        is_masked: hasMaskedInputValue || hasMaskedMediaAttribute || hasMaskMarker,
    };
}

function collectRrwebSkeleton(
    node: Record<string, unknown>,
    params: {
        frameKey: string;
        screenKey: string;
        path: string;
        depth: number;
        output: ResearchUiElementRow[];
    },
): { nodeCount: number; interactiveCount: number } {
    const children = childNodes(node);
    const kind = rrwebNodeKind(node);
    const role = roleForNode(node);
    if (kind !== 'text') {
        const flags = attributeFlags(node);
        params.output.push({
            element_key: hmac(`${params.frameKey}:dom:${params.path}:${safeTagName(node.tagName)}:${role}`, 20),
            frame_key: params.frameKey,
            screen_key: params.screenKey,
            role,
            source_kind: 'rrweb',
            visual_modality: 'dom_event_stream',
            tag_class: safeTagName(node.tagName),
            depth_bucket: bucketNumber(params.depth, 2, 0, 40),
            child_count_bucket: bucketNumber(children.length, 2, 0, 200),
            ...flags,
            text_class: 'masked',
        });
    }

    let nodeCount = 1;
    let interactiveCount = ['control', 'input', 'media'].includes(role) ? 1 : 0;
    children.forEach((child, index) => {
        const result = collectRrwebSkeleton(child, {
            frameKey: params.frameKey,
            screenKey: params.screenKey,
            path: `${params.path}.${index}`,
            depth: params.depth + 1,
            output: params.output,
        });
        nodeCount += result.nodeCount;
        interactiveCount += result.interactiveCount;
    });
    return { nodeCount, interactiveCount };
}

function rrwebMutationSummary(data: Record<string, unknown>): Record<string, number | null> {
    const adds = Array.isArray(data.adds) ? data.adds.length : 0;
    const removes = Array.isArray(data.removes) ? data.removes.length : 0;
    const texts = Array.isArray(data.texts) ? data.texts.length : 0;
    const attributes = Array.isArray(data.attributes) ? data.attributes.length : 0;
    return {
        mutation_adds_bucket: bucketNumber(adds, 2, 0, 200),
        mutation_removes_bucket: bucketNumber(removes, 2, 0, 200),
        mutation_texts_bucket: bucketNumber(texts, 2, 0, 200),
        mutation_attributes_bucket: bucketNumber(attributes, 2, 0, 200),
    };
}

type HierarchyRect = { x: number; y: number; w: number; h: number };

type HierarchySnapshotStats = {
    nodeCount: number;
    interactiveCount: number;
    textNodeCount: number;
    mediaCount: number;
    maskedNodeCount: number;
    maskedInputCount: number;
    keyboardOrSystemNodeCount: number;
    maxDepth: number;
};

function hierarchyChildren(node: Record<string, unknown>): Record<string, unknown>[] {
    const children = Array.isArray(node.children)
        ? node.children
        : Array.isArray(node.childNodes)
            ? node.childNodes
            : Array.isArray(node.subviews)
                ? node.subviews
                : [];
    return children.filter((child): child is Record<string, unknown> => (
        Boolean(child) && typeof child === 'object' && !Array.isArray(child)
    ));
}

function hierarchyFrame(node: Record<string, unknown>): HierarchyRect | null {
    const frame = objectValue(node.frame)
        ?? objectValue(node.bounds)
        ?? objectValue(node.layout)
        ?? null;
    if (!frame) return null;

    const left = numberValue(frame.left);
    const top = numberValue(frame.top);
    const right = numberValue(frame.right);
    const bottom = numberValue(frame.bottom);
    const x = numberValue(frame.x) ?? left ?? 0;
    const y = numberValue(frame.y) ?? top ?? 0;
    const w = positiveNumber(frame.w)
        ?? positiveNumber(frame.width)
        ?? (right !== null ? positiveNumber(right - x) : null);
    const h = positiveNumber(frame.h)
        ?? positiveNumber(frame.height)
        ?? (bottom !== null ? positiveNumber(bottom - y) : null);
    if (w === null || h === null) return null;
    return { x, y, w, h };
}

function clipRect(rect: HierarchyRect, bounds: HierarchyRect): HierarchyRect | null {
    const x0 = Math.max(bounds.x, rect.x);
    const y0 = Math.max(bounds.y, rect.y);
    const x1 = Math.min(bounds.x + bounds.w, rect.x + rect.w);
    const y1 = Math.min(bounds.y + bounds.h, rect.y + rect.h);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function hierarchyDimensions(snapshot: MobileHierarchySnapshot): { width: number | null; height: number | null } {
    const screen = objectValue(snapshot.screen) ?? {};
    const rootFrame = hierarchyFrame(snapshot.rootElement);
    return {
        width: positiveNumber(screen.width)
            ?? positiveNumber(screen.viewportWidth)
            ?? positiveNumber(screen.viewport_width)
            ?? positiveNumber(screen.screenWidth)
            ?? positiveNumber(screen.screen_width)
            ?? rootFrame?.w
            ?? null,
        height: positiveNumber(screen.height)
            ?? positiveNumber(screen.viewportHeight)
            ?? positiveNumber(screen.viewport_height)
            ?? positiveNumber(screen.screenHeight)
            ?? positiveNumber(screen.screen_height)
            ?? rootFrame?.h
            ?? null,
    };
}

function hierarchySemanticText(node: Record<string, unknown>): string {
    return [
        node.type,
        node.role,
        node.className,
        node.label,
        node.testID,
        node.text,
        node.placeholder,
        node.buttonTitle,
        node.resourceId,
        node.contentDescription,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join(' ')
        .toLowerCase();
}

function isHierarchyKeyboardOrSystemNode(node: Record<string, unknown>): boolean {
    const semantic = hierarchySemanticText(node);
    return semantic.includes('keyboard')
        || semantic.includes('inputset')
        || semantic.includes('textinputhost')
        || semantic.includes('systemui')
        || semantic.includes('statusbar')
        || semantic.includes('uiremotekeyboardwindow')
        || semantic.includes('uitexteffectswindow')
        || semantic.includes('uiinputsethostview');
}

function hierarchyRole(node: Record<string, unknown>): string {
    const semantic = hierarchySemanticText(node);
    if (isHierarchyKeyboardOrSystemNode(node)) return 'system_surface';
    const interactive = Boolean(node.interactive || node.clickable || node.enabled === true);
    if (/mapview|mkmapview|mapbox|googlemap|applemap|map/.test(semantic)) return 'map';
    if (/webview/.test(semantic)) return 'webview';
    if (/searchbar|searchfield|search_box/.test(semantic)) return 'search_input';
    if (/textfield|edittext|textinput|input/.test(semantic)) return 'input';
    if (/button|touchable|pressable|checkbox|switch|segmented|tabbaritem/.test(semantic) || interactive) return 'control';
    if (/image|icon|video|camera|player|lottie|animation/.test(semantic) || node.hasImage) return 'media';
    if (/scrollview|recyclerview|collectionview|tableview|flatlist|list/.test(semantic)) return 'list';
    if (/navbar|tabbar|toolbar|navigation/.test(semantic)) return 'navigation';
    if (/label|textview|text|heading|title/.test(semantic) || positiveNumber(node.textLength) !== null) return 'text';
    return 'container';
}

function hierarchyTypeFamily(role: string): string {
    if (role === 'system_surface') return 'system';
    if (['control', 'input', 'search_input'].includes(role)) return 'interactive';
    if (['map', 'webview', 'media'].includes(role)) return 'surface';
    if (['list', 'navigation'].includes(role)) return 'structure';
    if (role === 'text') return 'content';
    return 'container';
}

function hierarchyFlagFields(node: Record<string, unknown>): Record<string, boolean | null> {
    return {
        has_text: typeof node.text === 'string' && node.text.length > 0 || positiveNumber(node.textLength) !== null,
        has_label: typeof node.label === 'string' && node.label.length > 0,
        has_test_id: typeof node.testID === 'string' && node.testID.length > 0,
        has_placeholder: typeof node.placeholder === 'string' && node.placeholder.length > 0,
        is_masked: booleanValue(node.masked),
        is_keyboard_or_system: isHierarchyKeyboardOrSystemNode(node),
        is_clickable: booleanValue(node.clickable ?? node.interactive),
        is_enabled: booleanValue(node.enabled),
        is_focused: booleanValue(node.focused),
        is_hidden: booleanValue(node.hidden),
    };
}

function bucketSnapshotElapsedMs(timestampMs: number | null, session: SessionContext): number | null {
    if (timestampMs === null) return null;
    const startedAtMs = session.started_at.getTime();
    const elapsedMs = timestampMs > startedAtMs - 60_000
        ? timestampMs - startedAtMs
        : timestampMs;
    return bucketNumber(elapsedMs, 500, 0, 86_400_000);
}

function collectMobileHierarchySkeleton(
    node: Record<string, unknown>,
    params: {
        frameKey: string;
        screenKey: string;
        path: string;
        depth: number;
        parentOrigin: { x: number; y: number };
        dimensions: { width: number; height: number };
        gridSpec: FeatureGridSpec;
        platform: string | null;
        elapsedMsBucket: number | null;
        output: ResearchUiElementRow[];
    },
): HierarchySnapshotStats {
    const children = hierarchyChildren(node);
    const role = hierarchyRole(node);
    const typeFamily = hierarchyTypeFamily(role);
    const platformLower = String(params.platform ?? '').toLowerCase();
    const usesAbsoluteFrames = platformLower === 'android';
    const frame = hierarchyFrame(node);
    const bounds = { x: 0, y: 0, w: params.dimensions.width, h: params.dimensions.height };
    const absoluteFrame = frame
        ? (usesAbsoluteFrames || params.depth === 0
            ? frame
            : { ...frame, x: params.parentOrigin.x + frame.x, y: params.parentOrigin.y + frame.y })
        : null;
    const clipped = absoluteFrame ? clipRect(absoluteFrame, bounds) : null;
    const centerX = clipped ? clipped.x + clipped.w / 2 : null;
    const centerY = clipped ? clipped.y + clipped.h / 2 : null;
    const xNormBucket = normalizedPositionBucket(centerX, params.dimensions.width);
    const yNormBucket = normalizedPositionBucket(centerY, params.dimensions.height);

    if (role !== 'container' || params.depth <= 2 || children.length === 0) {
        params.output.push({
            element_key: hmac(`${params.frameKey}:hierarchy:${params.path}:${role}:${typeFamily}`, 20),
            frame_key: params.frameKey,
            screen_key: params.screenKey,
            role,
            source_kind: 'hierarchy',
            visual_modality: 'mobile_hierarchy_snapshot',
            source_timing: 'hierarchy_snapshot',
            type_family: typeFamily,
            snapshot_elapsed_ms_bucket: params.elapsedMsBucket,
            hierarchy_depth_bucket: bucketNumber(params.depth, 2, 0, 60),
            child_count_bucket: bucketNumber(children.length, 2, 0, 500),
            x_norm_bucket: xNormBucket,
            y_norm_bucket: yNormBucket,
            x_cell: gridCellFromNormalizedBucket(xNormBucket, params.gridSpec.columns),
            y_cell: gridCellFromNormalizedBucket(yNormBucket, params.gridSpec.rows),
            touch_grid_columns: params.gridSpec.columns,
            touch_grid_rows: params.gridSpec.rows,
            screen_orientation: params.gridSpec.orientation,
            screen_form_factor: params.gridSpec.formFactor,
            width_bucket: bucketNumber(clipped?.w ?? null, 8, 0, 8192),
            height_bucket: bucketNumber(clipped?.h ?? null, 8, 0, 8192),
            text_class: 'masked',
            ...hierarchyFlagFields(node),
        });
    }

    let stats: HierarchySnapshotStats = {
        nodeCount: 1,
        interactiveCount: ['control', 'input', 'search_input', 'map'].includes(role) ? 1 : 0,
        textNodeCount: role === 'text' ? 1 : 0,
        mediaCount: ['media', 'map', 'webview'].includes(role) ? 1 : 0,
        maskedNodeCount: node.masked === true ? 1 : 0,
        maskedInputCount: node.masked === true && ['input', 'search_input'].includes(role) ? 1 : 0,
        keyboardOrSystemNodeCount: role === 'system_surface' ? 1 : 0,
        maxDepth: params.depth,
    };
    const nextOrigin = absoluteFrame
        ? { x: absoluteFrame.x, y: absoluteFrame.y }
        : params.parentOrigin;

    children.forEach((child, index) => {
        const childStats = collectMobileHierarchySkeleton(child, {
            ...params,
            path: `${params.path}.${index}`,
            depth: params.depth + 1,
            parentOrigin: nextOrigin,
        });
        stats = {
            nodeCount: stats.nodeCount + childStats.nodeCount,
            interactiveCount: stats.interactiveCount + childStats.interactiveCount,
            textNodeCount: stats.textNodeCount + childStats.textNodeCount,
            mediaCount: stats.mediaCount + childStats.mediaCount,
            maskedNodeCount: stats.maskedNodeCount + childStats.maskedNodeCount,
            maskedInputCount: stats.maskedInputCount + childStats.maskedInputCount,
            keyboardOrSystemNodeCount: stats.keyboardOrSystemNodeCount + childStats.keyboardOrSystemNodeCount,
            maxDepth: Math.max(stats.maxDepth, childStats.maxDepth),
        };
    });

    return stats;
}

async function buildHierarchyVisualRows(
    session: SessionContext,
    hierarchyArtifacts: ArtifactContext[],
    interactions: ResearchInteractionRow[],
    projectKey: string,
): Promise<ResearchVisualRows> {
    const frames: ResearchUiFrameRow[] = [];
    const skeleton: ResearchUiElementRow[] = [];
    let sourceIndex = 0;
    const sortedArtifacts = [...hierarchyArtifacts].sort((a, b) => {
        const left = a.start_time ?? 0;
        const right = b.start_time ?? 0;
        return left - right;
    });

    for (let artifactIndex = 0; artifactIndex < sortedArtifacts.length; artifactIndex++) {
        const artifact = sortedArtifacts[artifactIndex];
        if (!artifact.s3ObjectKey) continue;

        const data = await downloadFromS3ForArtifact(session.project_id, artifact.s3ObjectKey, artifact.endpointId);
        if (!data) {
            logger.warn({ artifactId: artifact.id }, 'Research lake could not download hierarchy artifact');
            continue;
        }

        const snapshots = extractMobileHierarchySnapshotsFromArtifact(data, artifact.s3ObjectKey, artifact.start_time);
        for (let snapshotIndex = 0; snapshotIndex < snapshots.length; snapshotIndex++) {
            const snapshot = snapshots[snapshotIndex];
            const dimensions = hierarchyDimensions(snapshot);
            const gridSpec = visualGridSpecForDimensions(dimensions.width, dimensions.height);
            const width = dimensions.width ?? 0;
            const height = dimensions.height ?? 0;
            const elapsedMsBucket = bucketSnapshotElapsedMs(numberValue(snapshot.timestamp), session);
            const nearestInteraction = nearestInteractionForElapsed(interactions, elapsedMsBucket);
            const rawScreen = snapshot.screenName || null;
            const screen = rawScreen ? screenKey(rawScreen, projectKey) : nearestInteraction?.screen_key ?? fallbackScreenKey(projectKey);
            const frameKey = hmac(`${projectKey}:hierarchy-frame:${artifactIndex}:${snapshotIndex}:${snapshot.timestamp}:${screen}`, 24);
            const stats = width > 0 && height > 0
                ? collectMobileHierarchySkeleton(snapshot.rootElement, {
                    frameKey,
                    screenKey: screen,
                    path: '0',
                    depth: 0,
                    parentOrigin: { x: 0, y: 0 },
                    dimensions: { width, height },
                    gridSpec,
                    platform: session.platform,
                    elapsedMsBucket,
                    output: skeleton,
                })
                : {
                    nodeCount: 0,
                    interactiveCount: 0,
                    textNodeCount: 0,
                    mediaCount: 0,
                    maskedNodeCount: 0,
                    maskedInputCount: 0,
                    keyboardOrSystemNodeCount: 0,
                    maxDepth: 0,
                };

            frames.push({
                frame_key: frameKey,
                source_kind: 'hierarchy',
                visual_modality: 'mobile_hierarchy_snapshot',
                recommended_encoder: 'mobile_hierarchy_encoder',
                source_index: sourceIndex,
                source_artifact_index: artifactIndex,
                source_artifact_kind: artifact.kind,
                source_snapshot_index: snapshotIndex,
                elapsed_ms_bucket: elapsedMsBucket,
                screen_key: screen,
                source_timing: 'hierarchy_snapshot',
                hierarchy_snapshot_sparse: null,
                viewport_width_bucket: bucketNumber(width || null, 64, 0, 8192),
                viewport_height_bucket: bucketNumber(height || null, 64, 0, 8192),
                grid_columns: gridSpec.columns,
                grid_rows: gridSpec.rows,
                screen_orientation: gridSpec.orientation,
                screen_form_factor: gridSpec.formFactor,
                hierarchy_node_count_bucket: bucketNumber(stats.nodeCount, 5, 0, 100_000),
                hierarchy_interactive_count_bucket: bucketNumber(stats.interactiveCount, 2, 0, 20_000),
                hierarchy_text_node_count_bucket: bucketNumber(stats.textNodeCount, 2, 0, 20_000),
                hierarchy_media_count_bucket: bucketNumber(stats.mediaCount, 2, 0, 20_000),
                hierarchy_masked_node_count_bucket: bucketNumber(stats.maskedNodeCount, 2, 0, 20_000),
                hierarchy_masked_input_count_bucket: bucketNumber(stats.maskedInputCount, 2, 0, 20_000),
                hierarchy_keyboard_or_system_node_count_bucket: bucketNumber(stats.keyboardOrSystemNodeCount, 2, 0, 20_000),
                hierarchy_max_depth_bucket: bucketNumber(stats.maxDepth, 2, 0, 100),
                feature_grid_status: null,
                text_class: 'masked',
            });
            sourceIndex++;
        }
    }

    return { frames, skeleton };
}

async function buildScreenshotVisualRows(
    session: SessionContext,
    screenshotArtifacts: ArtifactContext[],
    interactions: ResearchInteractionRow[],
    projectKey: string,
): Promise<ResearchVisualRows> {
    const frames: ResearchUiFrameRow[] = [];
    const skeleton: ResearchUiElementRow[] = [];
    let sessionFrameIndex = 0;
    let previousLumaGrid: number[] | null = null;
    const sessionStartMs = session.started_at.getTime();
    const sessionEndMs = session.ended_at?.getTime() ?? null;
    const upperBound = sessionEndMs ? sessionEndMs + 5_000 : Infinity;

    const sortedArtifacts = [...screenshotArtifacts].sort((a, b) => {
        const left = a.start_time ?? 0;
        const right = b.start_time ?? 0;
        return left - right;
    });

    for (let artifactIndex = 0; artifactIndex < sortedArtifacts.length; artifactIndex++) {
        const artifact = sortedArtifacts[artifactIndex];
        if (!artifact.s3ObjectKey) continue;

        const archiveData = await downloadFromS3ForArtifact(session.project_id, artifact.s3ObjectKey, artifact.endpointId);
        if (!archiveData) {
            logger.warn({ artifactId: artifact.id }, 'Research lake could not download screenshot artifact');
            continue;
        }

        const extractedFrames = await extractFramesFromArchive(archiveData, sessionStartMs);
        const boundedFrames = extractedFrames.filter((frame) => (
            frame.timestamp >= sessionStartMs && frame.timestamp <= upperBound
        ));

        for (const frame of boundedFrames) {
            const features = imageFeatureGrid(frame.data);
            const elapsedMsBucket = bucketTimestampElapsedMs(frame.timestamp, session);
            const nearestInteraction = nearestInteractionForElapsed(interactions, elapsedMsBucket);
            const screenKey = nearestInteraction?.screen_key ?? fallbackScreenKey(projectKey);
            const sourceFrameDigestKey = hmacBuffer(`${projectKey}:source-frame`, frame.data, 24);
            const visualSignatureKey = hmac(`${projectKey}:visual:${features?.signature ?? sourceFrameDigestKey}`, 24);
            const frameKey = hmac(`${projectKey}:screenshot-frame:${artifactIndex}:${frame.index}:${frame.timestamp}:${sourceFrameDigestKey}`, 24);

            const frameRow: ResearchUiFrameRow = {
                frame_key: frameKey,
                source_kind: 'screenshots',
                visual_modality: 'raster_feature_grid',
                recommended_encoder: 'screenshot_grid_encoder',
                source_index: sessionFrameIndex,
                source_artifact_index: artifactIndex,
                source_artifact_kind: artifact.kind,
                source_frame_index: frame.index,
                elapsed_ms_bucket: elapsedMsBucket,
                screen_key: screenKey,
                width_bucket: bucketNumber(features?.width ?? null, 64, 0, 8192),
                height_bucket: bucketNumber(features?.height ?? null, 64, 0, 8192),
                grid_columns: features?.gridColumns ?? null,
                grid_rows: features?.gridRows ?? null,
                screen_orientation: features?.orientation ?? null,
                screen_form_factor: features?.formFactor ?? null,
                feature_grid_status: features?.featureGridStatus ?? 'unavailable',
                grid_cell_count: features ? features.gridColumns * features.gridRows : null,
                image_bytes_bucket: bucketNumber(frame.data.length, 16 * 1024, 0, 20 * 1024 * 1024),
                visual_signature_key: visualSignatureKey,
                source_frame_digest_key: sourceFrameDigestKey,
                luma_grid: features?.lumaGrid ?? [],
                edge_grid: features?.edgeGrid ?? [],
                color_grid: features?.colorGrid ?? [],
                previous_frame_delta_bucket: features ? gridDelta(previousLumaGrid, features.lumaGrid) : null,
                text_class: 'masked',
            };
            frames.push(frameRow);

            if (features) {
                previousLumaGrid = features.lumaGrid;
            }
            sessionFrameIndex++;
        }
    }

    return { frames, skeleton };
}

async function buildRrwebVisualRows(
    session: SessionContext,
    rrwebArtifacts: ArtifactContext[],
    interactions: ResearchInteractionRow[],
    projectKey: string,
): Promise<ResearchVisualRows> {
    const frames: ResearchUiFrameRow[] = [];
    const skeleton: ResearchUiElementRow[] = [];
    let sourceIndex = 0;
    let currentDimensions: {
        pageWidth: number | null;
        pageHeight: number | null;
        viewportWidth: number | null;
        viewportHeight: number | null;
    } = {
        pageWidth: null,
        pageHeight: null,
        viewportWidth: null,
        viewportHeight: null,
    };

    const sortedArtifacts = [...rrwebArtifacts].sort((a, b) => {
        const left = a.start_time ?? 0;
        const right = b.start_time ?? 0;
        return left - right;
    });

    for (let artifactIndex = 0; artifactIndex < sortedArtifacts.length; artifactIndex++) {
        const artifact = sortedArtifacts[artifactIndex];
        if (!artifact.s3ObjectKey) continue;

        const data = await downloadFromS3ForArtifact(session.project_id, artifact.s3ObjectKey, artifact.endpointId);
        if (!data) {
            logger.warn({ artifactId: artifact.id }, 'Research lake could not download rrweb artifact');
            continue;
        }

        const extracted = extractRrwebEventsFromArtifact(data, artifact.s3ObjectKey);
        const envelopeDimensions = dimensionsFromRrwebEnvelope(extracted.page, extracted.viewport);
        currentDimensions = {
            pageWidth: positiveNumber(envelopeDimensions.pageWidth) ?? currentDimensions.pageWidth,
            pageHeight: positiveNumber(envelopeDimensions.pageHeight) ?? currentDimensions.pageHeight,
            viewportWidth: positiveNumber(envelopeDimensions.viewportWidth) ?? currentDimensions.viewportWidth,
            viewportHeight: positiveNumber(envelopeDimensions.viewportHeight) ?? currentDimensions.viewportHeight,
        };

        for (let eventIndex = 0; eventIndex < extracted.events.length; eventIndex++) {
            const event = extracted.events[eventIndex] as Record<string, unknown>;
            if (!event || typeof event !== 'object') continue;

            const timestamp = numberValue(event.timestamp);
            const elapsedMsBucket = bucketTimestampElapsedMs(timestamp, session);
            const nearestInteraction = nearestInteractionForElapsed(interactions, elapsedMsBucket);
            const screenKey = nearestInteraction?.screen_key ?? fallbackScreenKey(projectKey);
            const dataObject = event.data && typeof event.data === 'object' && !Array.isArray(event.data)
                ? event.data as Record<string, unknown>
                : {};
            const eventType = numberValue(event.type);
            const incrementalSource = numberValue(dataObject.source);
            const kind = rrwebEventKind(event);
            const frameKey = hmac(`${projectKey}:rrweb-frame:${artifactIndex}:${eventIndex}:${timestamp ?? 'none'}:${kind}`, 24);

            if (eventType === RRWEB_EVENT_TYPE_META) {
                currentDimensions = {
                    pageWidth: positiveNumber(dataObject.width) ?? currentDimensions.pageWidth,
                    pageHeight: positiveNumber(dataObject.height) ?? currentDimensions.pageHeight,
                    viewportWidth: positiveNumber(dataObject.width) ?? currentDimensions.viewportWidth,
                    viewportHeight: positiveNumber(dataObject.height) ?? currentDimensions.viewportHeight,
                };
            }
            if (eventType === RRWEB_EVENT_TYPE_INCREMENTAL && incrementalSource === RRWEB_INCREMENTAL_VIEWPORT_RESIZE) {
                currentDimensions = {
                    ...currentDimensions,
                    viewportWidth: positiveNumber(dataObject.width) ?? currentDimensions.viewportWidth,
                    viewportHeight: positiveNumber(dataObject.height) ?? currentDimensions.viewportHeight,
                };
            }

            let nodeCount = 0;
            let interactiveCount = 0;
            if (eventType === RRWEB_EVENT_TYPE_FULL_SNAPSHOT) {
                const rootNode = dataObject.node && typeof dataObject.node === 'object' && !Array.isArray(dataObject.node)
                    ? dataObject.node as Record<string, unknown>
                    : null;
                if (rootNode) {
                    const result = collectRrwebSkeleton(rootNode, {
                        frameKey,
                        screenKey,
                        path: '0',
                        depth: 0,
                        output: skeleton,
                    });
                    nodeCount = result.nodeCount;
                    interactiveCount = result.interactiveCount;
                }
            } else if (eventType === RRWEB_EVENT_TYPE_INCREMENTAL && incrementalSource === RRWEB_INCREMENTAL_MUTATION) {
                const adds = Array.isArray(dataObject.adds) ? dataObject.adds : [];
                adds.forEach((entry, addIndex) => {
                    const node = entry
                        && typeof entry === 'object'
                        && !Array.isArray(entry)
                        && (entry as Record<string, unknown>).node
                        && typeof (entry as Record<string, unknown>).node === 'object'
                        && !Array.isArray((entry as Record<string, unknown>).node)
                        ? (entry as Record<string, unknown>).node as Record<string, unknown>
                        : null;
                    if (!node) return;
                    const result = collectRrwebSkeleton(node, {
                        frameKey,
                        screenKey,
                        path: `add.${addIndex}`,
                        depth: 0,
                        output: skeleton,
                    });
                    nodeCount += result.nodeCount;
                    interactiveCount += result.interactiveCount;
                });
            }

            frames.push({
                frame_key: frameKey,
                source_kind: 'rrweb',
                visual_modality: 'dom_event_stream',
                recommended_encoder: 'rrweb_dom_encoder',
                source_index: sourceIndex,
                source_artifact_index: artifactIndex,
                source_artifact_kind: artifact.kind,
                source_event_index: eventIndex,
                rrweb_event_type: eventType,
                rrweb_incremental_source: incrementalSource,
                rrweb_event_kind: kind,
                elapsed_ms_bucket: elapsedMsBucket,
                screen_key: screenKey,
                page_width_bucket: bucketNumber(currentDimensions.pageWidth, 64, 0, 20_000),
                page_height_bucket: bucketNumber(currentDimensions.pageHeight, 64, 0, 200_000),
                viewport_width_bucket: bucketNumber(currentDimensions.viewportWidth, 64, 0, 20_000),
                viewport_height_bucket: bucketNumber(currentDimensions.viewportHeight, 64, 0, 20_000),
                dom_node_count_bucket: bucketNumber(nodeCount, 5, 0, 10_000),
                dom_interactive_count_bucket: bucketNumber(interactiveCount, 2, 0, 2_000),
                ...rrwebMutationSummary(dataObject),
                event_shape_key: hmac(`${projectKey}:rrweb-shape:${kind}:${eventType}:${incrementalSource ?? 'none'}:${Object.keys(dataObject).sort().join(',')}`, 20),
                text_class: 'masked',
            });
            sourceIndex++;
        }
    }

    return { frames, skeleton };
}

async function buildVisualRows(
    session: SessionContext,
    artifacts: ArtifactContext[],
    interactions: ResearchInteractionRow[],
    projectKey: string,
): Promise<ResearchVisualRows> {
    const screenshotRows = await buildScreenshotVisualRows(
        session,
        artifacts.filter((artifact) => artifact.kind === 'screenshots'),
        interactions,
        projectKey,
    );
    const hierarchyRows = await buildHierarchyVisualRows(
        session,
        artifacts.filter((artifact) => artifact.kind === 'hierarchy'),
        interactions,
        projectKey,
    );
    const rrwebRows = await buildRrwebVisualRows(
        session,
        artifacts.filter((artifact) => artifact.kind === 'rrweb'),
        interactions,
        projectKey,
    );

    return {
        frames: [...screenshotRows.frames, ...hierarchyRows.frames, ...rrwebRows.frames],
        skeleton: [...screenshotRows.skeleton, ...hierarchyRows.skeleton, ...rrwebRows.skeleton],
    };
}

function artifactSummary(artifacts: ArtifactContext[]): Record<string, unknown> {
    const byKind: Record<string, number> = {};
    let totalBytes = 0;
    let totalFrames = 0;
    for (const artifact of artifacts) {
        byKind[artifact.kind] = (byKind[artifact.kind] ?? 0) + 1;
        totalBytes += Number(artifact.size_bytes ?? artifact.declared_size_bytes ?? 0);
        totalFrames += Number(artifact.frame_count ?? 0);
    }
    return {
        count: artifacts.length,
        by_kind: byKind,
        total_bytes_bucket: Math.round(totalBytes / 1024 / 1024) * 1024 * 1024,
        total_frames_bucket: Math.round(totalFrames / 10) * 10,
        has_visual_source: artifacts.some((artifact) => ['screenshots', 'hierarchy', 'rrweb'].includes(artifact.kind)),
    };
}

function countStringField(rows: Record<string, unknown>[], field: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const row of rows) {
        const value = stringValue(row[field]) || 'null';
        counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
}

function gridShapeCounts(frames: ResearchUiFrameRow[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const frame of frames) {
        const columns = numberValue(frame.grid_columns);
        const rows = numberValue(frame.grid_rows);
        if (columns === null || rows === null) continue;
        const key = `${columns}x${rows}`;
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
}

function medianNumber(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle];
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function elapsedBucketsForKind(frames: ResearchUiFrameRow[], sourceKind: ResearchUiFrameRow['source_kind']): number[] {
    return frames
        .filter((frame) => frame.source_kind === sourceKind)
        .map((frame) => numberValue(frame.elapsed_ms_bucket))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
}

function medianIntervalMs(elapsedMs: number[]): number | null {
    if (elapsedMs.length < 2) return null;
    const deltas: number[] = [];
    for (let index = 1; index < elapsedMs.length; index++) {
        const delta = elapsedMs[index] - elapsedMs[index - 1];
        if (delta > 0) deltas.push(delta);
    }
    return medianNumber(deltas);
}

function medianNearestDeltaMs(sourceElapsedMs: number[], targetElapsedMs: number[]): number | null {
    if (sourceElapsedMs.length === 0 || targetElapsedMs.length === 0) return null;
    const deltas = sourceElapsedMs.map((source) => (
        targetElapsedMs.reduce((best, target) => Math.min(best, Math.abs(source - target)), Number.POSITIVE_INFINITY)
    ));
    return medianNumber(deltas.filter((value) => Number.isFinite(value)));
}

function nearTargetRatio(sourceElapsedMs: number[], targetElapsedMs: number[], toleranceMs: number): number | null {
    if (sourceElapsedMs.length === 0 || targetElapsedMs.length === 0) return null;
    const nearCount = sourceElapsedMs.filter((source) => (
        targetElapsedMs.some((target) => Math.abs(source - target) <= toleranceMs)
    )).length;
    return Math.round((nearCount / sourceElapsedMs.length) * 100) / 100;
}

function buildHierarchyCaptureProfile(frames: ResearchUiFrameRow[]): Record<string, unknown> {
    const hierarchyElapsedMs = elapsedBucketsForKind(frames, 'hierarchy');
    const screenshotElapsedMs = elapsedBucketsForKind(frames, 'screenshots');
    const observedSnapshotCount = hierarchyElapsedMs.length;
    if (observedSnapshotCount === 0) {
        return {
            present: false,
            cadence_mode: 'absent',
            configured_interval_ms: null,
            observed_median_interval_ms: null,
            observed_snapshot_count: 0,
            screenshot_frame_count: screenshotElapsedMs.length,
            hierarchy_screenshot_alignment_ratio: null,
            screenshot_hierarchy_coverage_ratio: null,
            alignment_threshold_ratio: HIERARCHY_GOOD_ALIGNMENT_RATIO,
            alignment_tolerance_ms: HIERARCHY_ALIGNMENT_TOLERANCE_MS,
            nearest_screenshot_median_delta_ms: null,
            alignment: 'not_present',
        };
    }

    const observedMedianIntervalMs = medianIntervalMs(hierarchyElapsedMs);
    const nearestScreenshotMedianDeltaMs = medianNearestDeltaMs(hierarchyElapsedMs, screenshotElapsedMs);
    const hierarchyScreenshotAlignmentRatio = nearTargetRatio(
        hierarchyElapsedMs,
        screenshotElapsedMs,
        HIERARCHY_ALIGNMENT_TOLERANCE_MS,
    );
    const screenshotHierarchyCoverageRatio = nearTargetRatio(
        screenshotElapsedMs,
        hierarchyElapsedMs,
        HIERARCHY_ALIGNMENT_TOLERANCE_MS,
    );
    const screenshotFrameCount = screenshotElapsedMs.length;
    const hierarchyToScreenshotRatio = screenshotFrameCount > 0
        ? Math.round((observedSnapshotCount / screenshotFrameCount) * 100) / 100
        : null;

    let cadenceMode = 'sparse_interval';
    if (observedSnapshotCount === 1) {
        cadenceMode = 'single_snapshot';
    } else if (
        screenshotFrameCount > 0
        && hierarchyToScreenshotRatio !== null
        && hierarchyToScreenshotRatio >= HIERARCHY_PER_FRAME_MIN_COVERAGE_RATIO
        && (hierarchyScreenshotAlignmentRatio ?? 0) >= HIERARCHY_GOOD_ALIGNMENT_RATIO
        && (screenshotHierarchyCoverageRatio ?? 0) >= HIERARCHY_PER_FRAME_MIN_COVERAGE_RATIO
        && (nearestScreenshotMedianDeltaMs === null || nearestScreenshotMedianDeltaMs <= HIERARCHY_ALIGNMENT_TOLERANCE_MS)
    ) {
        cadenceMode = 'per_visual_frame';
    } else if (
        screenshotFrameCount > 0
        && hierarchyToScreenshotRatio !== null
        && hierarchyToScreenshotRatio >= HIERARCHY_EVERY_OTHER_MIN_RATIO
        && (hierarchyScreenshotAlignmentRatio ?? 0) >= HIERARCHY_GOOD_ALIGNMENT_RATIO
        && (nearestScreenshotMedianDeltaMs === null || nearestScreenshotMedianDeltaMs <= HIERARCHY_ALIGNMENT_TOLERANCE_MS)
        && (observedMedianIntervalMs === null || observedMedianIntervalMs <= 1_250)
    ) {
        cadenceMode = 'every_other_visual_frame';
    } else if (observedMedianIntervalMs !== null && observedMedianIntervalMs >= 1_500) {
        cadenceMode = 'fixed_interval';
    }

    const alignment = ['per_visual_frame', 'every_other_visual_frame'].includes(cadenceMode)
        ? 'screenshot_frame_aligned'
        : 'sparse_timeline';

    return {
        present: true,
        cadence_mode: cadenceMode,
        configured_interval_ms: null,
        observed_median_interval_ms: observedMedianIntervalMs,
        observed_snapshot_count: observedSnapshotCount,
        screenshot_frame_count: screenshotFrameCount,
        hierarchy_to_screenshot_ratio: hierarchyToScreenshotRatio,
        hierarchy_screenshot_alignment_ratio: hierarchyScreenshotAlignmentRatio,
        screenshot_hierarchy_coverage_ratio: screenshotHierarchyCoverageRatio,
        alignment_threshold_ratio: HIERARCHY_GOOD_ALIGNMENT_RATIO,
        alignment_tolerance_ms: HIERARCHY_ALIGNMENT_TOLERANCE_MS,
        nearest_screenshot_median_delta_ms: nearestScreenshotMedianDeltaMs,
        alignment,
    };
}

function hierarchyCaptureWarnings(profile: Record<string, unknown>): string[] {
    if (profile.present !== true) return [];
    const warnings: string[] = [];
    if (['fixed_interval', 'sparse_interval', 'single_snapshot'].includes(stringValue(profile.cadence_mode))) {
        warnings.push('hierarchy_sparse_timeline');
    }
    if (profile.alignment !== 'screenshot_frame_aligned') {
        warnings.push('hierarchy_not_frame_aligned');
    }
    return warnings;
}

function buildRrwebCaptureProfile(
    frames: ResearchUiFrameRow[],
    skeleton: ResearchUiElementRow[],
): Record<string, unknown> {
    const rrwebFrames = frames.filter((frame) => frame.source_kind === 'rrweb');
    const eventCount = rrwebFrames.length;
    if (eventCount === 0) {
        return {
            present: false,
            replay_basis: 'absent',
            event_count: 0,
            full_snapshot_count: 0,
            incremental_count: 0,
            mutation_count: 0,
            meta_count: 0,
            viewport_resize_count: 0,
            scroll_count: 0,
            dom_skeleton_element_count: 0,
            viewport_missing_count: 0,
            page_missing_count: 0,
            event_span_ms: null,
        };
    }

    const eventKindCounts = countStringField(rrwebFrames, 'rrweb_event_kind');
    const fullSnapshotCount = numberValue(eventKindCounts.full_snapshot) ?? 0;
    const incrementalCount = rrwebFrames.filter((frame) => numberValue(frame.rrweb_event_type) === RRWEB_EVENT_TYPE_INCREMENTAL).length;
    const mutationCount = numberValue(eventKindCounts.mutation) ?? 0;
    const metaCount = numberValue(eventKindCounts.meta) ?? 0;
    const viewportResizeCount = numberValue(eventKindCounts.viewport_resize) ?? 0;
    const scrollCount = numberValue(eventKindCounts.scroll) ?? 0;
    const viewportMissingCount = rrwebFrames.filter((frame) => (
        numberValue(frame.viewport_width_bucket) === null || numberValue(frame.viewport_height_bucket) === null
    )).length;
    const pageMissingCount = rrwebFrames.filter((frame) => (
        numberValue(frame.page_width_bucket) === null || numberValue(frame.page_height_bucket) === null
    )).length;
    const elapsed = rrwebFrames
        .map((frame) => numberValue(frame.elapsed_ms_bucket))
        .filter((value): value is number => value !== null);
    const eventSpanMs = elapsed.length >= 2 ? Math.max(...elapsed) - Math.min(...elapsed) : null;
    const rrwebFrameKeys = new Set(rrwebFrames.map((frame) => stringValue(frame.frame_key)).filter(Boolean));
    const domSkeletonElementCount = skeleton.filter((element) => (
        stringValue(element.frame_key) && rrwebFrameKeys.has(stringValue(element.frame_key))
    )).length;

    let replayBasis = 'events_without_baseline';
    if (fullSnapshotCount > 0 && mutationCount > 0) {
        replayBasis = 'snapshot_plus_incremental';
    } else if (fullSnapshotCount > 0) {
        replayBasis = 'full_snapshot_only';
    } else if (incrementalCount > 0) {
        replayBasis = 'incremental_without_full_snapshot';
    }

    return {
        present: true,
        replay_basis: replayBasis,
        event_count: eventCount,
        full_snapshot_count: fullSnapshotCount,
        incremental_count: incrementalCount,
        mutation_count: mutationCount,
        meta_count: metaCount,
        viewport_resize_count: viewportResizeCount,
        scroll_count: scrollCount,
        dom_skeleton_element_count: domSkeletonElementCount,
        viewport_missing_count: viewportMissingCount,
        page_missing_count: pageMissingCount,
        event_span_ms: eventSpanMs,
    };
}

function rrwebCaptureWarnings(profile: Record<string, unknown>): string[] {
    if (profile.present !== true) return [];
    const warnings: string[] = [];
    const fullSnapshotCount = numberValue(profile.full_snapshot_count) ?? 0;
    const mutationCount = numberValue(profile.mutation_count) ?? 0;
    const viewportMissingCount = numberValue(profile.viewport_missing_count) ?? 0;
    const pageMissingCount = numberValue(profile.page_missing_count) ?? 0;
    const skeletonElementCount = numberValue(profile.dom_skeleton_element_count) ?? 0;

    if (fullSnapshotCount === 0) warnings.push('rrweb_missing_full_snapshot');
    if (fullSnapshotCount === 0 && mutationCount > 0) warnings.push('rrweb_incremental_without_full_snapshot');
    if (viewportMissingCount > 0) warnings.push('rrweb_viewport_dimensions_missing');
    if (pageMissingCount > 0) warnings.push('rrweb_page_dimensions_missing');
    if (fullSnapshotCount > 0 && skeletonElementCount === 0) warnings.push('rrweb_full_snapshot_without_dom_skeleton');
    return warnings;
}

function buildMaskingCaptureProfile(
    session: SessionContext,
    frames: ResearchUiFrameRow[],
    skeleton: ResearchUiElementRow[],
): Record<string, unknown> {
    const textInputPolicy = session.text_input_masking === 'secure_only' ? 'secure_only' : 'all';
    const imageVideoPolicy = session.image_video_masking === 'all' ? 'all' : 'none';
    const hierarchyElements = skeleton.filter((element) => element.source_kind === 'hierarchy');
    const rrwebElements = skeleton.filter((element) => element.source_kind === 'rrweb');
    const hierarchyMaskedElements = hierarchyElements.filter((element) => element.is_masked === true);
    const rrwebMaskedElements = rrwebElements.filter((element) => element.is_masked === true);
    const hierarchyKeyboardOrSystemElements = hierarchyElements.filter((element) => element.is_keyboard_or_system === true);
    const hierarchyMediaSurfaceCount = hierarchyElements.filter((element) => ['media', 'map', 'webview'].includes(stringValue(element.role))).length;
    const rrwebMediaSurfaceCount = rrwebElements.filter((element) => stringValue(element.role) === 'media').length;
    const screenshotFrameCount = frames.filter((frame) => frame.source_kind === 'screenshots').length;
    const hierarchyFrameCount = frames.filter((frame) => frame.source_kind === 'hierarchy').length;
    const rrwebFrameCount = frames.filter((frame) => frame.source_kind === 'rrweb').length;
    const signalSources = [
        screenshotFrameCount > 0 ? 'screenshot_pixels_post_redaction' : null,
        hierarchyMaskedElements.length > 0 ? 'native_hierarchy_masked_nodes' : null,
        rrwebMaskedElements.length > 0 ? 'rrweb_sanitized_dom_nodes' : null,
    ].filter((value): value is string => Boolean(value));

    return {
        text_input_masking_policy: textInputPolicy,
        image_video_masking_policy: imageVideoPolicy,
        screenshot_pixels_post_redaction: screenshotFrameCount > 0,
        hierarchy_mask_observed: hierarchyMaskedElements.length > 0,
        hierarchy_masked_element_count: hierarchyMaskedElements.length,
        hierarchy_masked_input_count: hierarchyMaskedElements.filter((element) => ['input', 'search_input'].includes(stringValue(element.role))).length,
        hierarchy_media_surface_count: hierarchyMediaSurfaceCount,
        hierarchy_keyboard_or_system_element_count: hierarchyKeyboardOrSystemElements.length,
        hierarchy_keyboard_or_system_policy: 'exclude_or_downweight',
        hierarchy_frame_count: hierarchyFrameCount,
        rrweb_mask_observed: rrwebMaskedElements.length > 0,
        rrweb_masked_element_count: rrwebMaskedElements.length,
        rrweb_masked_input_value_count: rrwebElements.filter((element) => element.has_masked_input_value === true).length,
        rrweb_masked_media_attribute_count: rrwebElements.filter((element) => element.has_masked_media_attribute === true).length,
        rrweb_media_surface_count: rrwebMediaSurfaceCount,
        rrweb_frame_count: rrwebFrameCount,
        mask_signal_sources: signalSources,
    };
}

function maskingCaptureWarnings(profile: Record<string, unknown>): string[] {
    const warnings: string[] = [];
    if (profile.text_input_masking_policy === 'secure_only') {
        warnings.push('masking_text_inputs_secure_only_policy');
    }
    const mediaSurfaceCount = (numberValue(profile.hierarchy_media_surface_count) ?? 0)
        + (numberValue(profile.rrweb_media_surface_count) ?? 0);
    if (profile.image_video_masking_policy === 'none' && mediaSurfaceCount > 0) {
        warnings.push('masking_media_not_forced_by_policy');
    }
    if ((numberValue(profile.hierarchy_keyboard_or_system_element_count) ?? 0) > 0) {
        warnings.push('hierarchy_keyboard_or_system_nodes_present');
    }
    return warnings;
}

function annotateHierarchyCaptureProfile(rows: ResearchVisualRows, profile: Record<string, unknown>): ResearchVisualRows {
    const cadenceMode = stringValue(profile.cadence_mode) || 'absent';
    const alignment = stringValue(profile.alignment) || 'not_present';
    const hasHierarchy = cadenceMode !== 'absent';
    const snapshotSparse = alignment !== 'screenshot_frame_aligned';
    const sourceTiming = alignment === 'screenshot_frame_aligned'
        ? 'screenshot_frame_aligned_snapshot'
        : 'sparse_timeline_snapshot';

    const annotate = <T extends Record<string, unknown>>(row: T): T => {
        if (row.source_kind !== 'hierarchy' || !hasHierarchy) {
            return row;
        }
        return {
            ...row,
            source_timing: sourceTiming,
            hierarchy_snapshot_sparse: snapshotSparse,
            hierarchy_capture_cadence: cadenceMode,
            hierarchy_capture_alignment: alignment,
        };
    };

    return {
        frames: rows.frames.map((frame) => annotate(frame) as ResearchUiFrameRow),
        skeleton: rows.skeleton.map((element) => annotate(element) as ResearchUiElementRow),
    };
}

function interactionQualityMetrics(interactions: ResearchInteractionRow[]): Record<string, unknown> {
    const coordinateEvents = interactions.filter((interaction) => (
        ['tap', 'gesture', 'input'].includes(interaction.kind)
    ));
    return {
        coordinate_event_count: coordinateEvents.length,
        coordinate_missing_count: coordinateEvents.filter((interaction) => (
            interaction.x_norm_bucket === null || interaction.y_norm_bucket === null
        )).length,
        viewport_missing_count: interactions.filter((interaction) => interaction.viewport_source === 'missing').length,
        viewport_source_counts: countStringField(interactions, 'viewport_source'),
    };
}

function interactionQualityWarnings(
    interactions: ResearchInteractionRow[],
    frames: ResearchUiFrameRow[],
): string[] {
    const warnings: string[] = [];
    const screenshotFrameCount = frames.filter((frame) => frame.source_kind === 'screenshots').length;
    const hierarchyFrameCount = frames.filter((frame) => frame.source_kind === 'hierarchy').length;
    const rrwebFrameCount = frames.filter((frame) => frame.source_kind === 'rrweb').length;
    const decodeFailedCount = frames.filter((frame) => frame.feature_grid_status === 'decode_failed').length;
    const unavailableFeatureCount = frames.filter((frame) => frame.source_kind === 'screenshots' && frame.feature_grid_status === 'unavailable').length;
    const missingViewportCount = interactions.filter((interaction) => interaction.viewport_source === 'missing').length;
    const missingCoordinateCount = interactions.filter((interaction) => (
        ['tap', 'gesture', 'input'].includes(interaction.kind)
        && (interaction.x_norm_bucket === null || interaction.y_norm_bucket === null)
    )).length;

    if (hierarchyFrameCount > 0 && screenshotFrameCount === 0 && rrwebFrameCount === 0) {
        warnings.push('hierarchy_only_sparse_visual_source');
    }
    if (decodeFailedCount > 0) warnings.push('screenshot_decode_failed_fallback_grid_used');
    if (unavailableFeatureCount > 0) warnings.push('screenshot_feature_grid_unavailable');
    if (missingViewportCount > 0) warnings.push('interaction_viewport_missing_for_some_events');
    if (missingCoordinateCount > 0) warnings.push('coordinate_missing_for_some_pointer_events');
    return warnings;
}

function createLaneSummary(): ResearchLakeLaneSummary {
    return {
        seeded: 0,
        attempted: 0,
        exported: 0,
        rejected: 0,
        failed: 0,
    };
}

function createCycleSummary(): ResearchLakeCycleSummary {
    return {
        seeded: 0,
        attempted: 0,
        exported: 0,
        rejected: 0,
        failed: 0,
        recoveredStaleProcessing: 0,
        byLake: {
            interaction: createLaneSummary(),
            behavioral_outcomes: createLaneSummary(),
        },
        revenueOutcomes: {
            attempted: 0,
            exported: 0,
            failed: 0,
            mode: 'idle',
        },
    };
}

function addLaneSummaryTotals(summary: ResearchLakeCycleSummary): void {
    summary.seeded = 0;
    summary.attempted = 0;
    summary.exported = 0;
    summary.rejected = 0;
    summary.failed = 0;
    for (const lakeType of RESEARCH_LAKE_TYPES) {
        const lane = summary.byLake[lakeType];
        summary.seeded += lane.seeded;
        summary.attempted += lane.attempted;
        summary.exported += lane.exported;
        summary.rejected += lane.rejected;
        summary.failed += lane.failed;
    }
}

function interactionRejectReason(
    artifacts: ArtifactContext[],
    interactions: Record<string, unknown>[],
    uiFrames: ResearchUiFrameRow[],
): string | null {
    const summary = artifactSummary(artifacts);
    if (!summary.has_visual_source) return 'source_replay_deleted_or_missing';
    if (uiFrames.length === 0) return 'source_visual_frames_missing_or_unreadable';
    if (interactions.length < config.RESEARCH_LAKE_MIN_EVENT_COUNT) return 'insufficient_interaction_events';
    if (containsIdentifierRisk({ interactions, uiFrames })) return 'identifier_risk_detected';
    return null;
}

function containsIdentifierRisk(value: unknown): boolean {
    const riskyKeyNames = new Set([
        'anonymous_display_id',
        'anonymous_hash',
        'class_name',
        'device_id',
        'distinct_id',
        'email',
        'fingerprint',
        'full_selector',
        'href',
        'ip',
        'ip_address',
        'path_name',
        'raw_text',
        'raw_url',
        'selector',
        'session_id',
        'src',
        'text',
        'url',
        'user_display_id',
        'user_id',
    ]);
    const riskyValuePatterns = [
        /\bsession_[a-z0-9_]{16,}\b/i,
        /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
        /https?:\/\//i,
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
        /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
    ];

    const visit = (entry: unknown): boolean => {
        if (typeof entry === 'string') {
            return riskyValuePatterns.some((pattern) => pattern.test(entry));
        }
        if (!entry || typeof entry !== 'object') return false;
        if (Array.isArray(entry)) return entry.some((item) => visit(item));
        return Object.entries(entry as Record<string, unknown>).some(([key, nested]) => (
            riskyKeyNames.has(key.toLowerCase()) || visit(nested)
        ));
    };

    return visit(value);
}

function interactionSeedCandidatePredicateSql(): string {
    return `
              AND s.recording_deleted = false
              AND EXISTS (
                  SELECT 1
                  FROM recording_artifacts ra
                  WHERE ra.session_id = s.id
                    AND ra.status = 'ready'
                    AND ra.kind IN ('screenshots', 'hierarchy', 'rrweb')
              )
`.trimEnd();
}

function behavioralMeaningfulPredicateSql(): string {
    return `
              AND (
                  (jsonb_typeof(s.events) = 'array' AND jsonb_array_length(s.events) > 0)
                  OR COALESCE(sm.total_events, 0) > 0
                  OR COALESCE(sm.custom_event_count, 0) > 0
                  OR COALESCE(sm.api_total_count, 0) > 0
                  OR COALESCE(sm.api_error_count, 0) > 0
                  OR COALESCE(sm.error_count, 0) > 0
                  OR COALESCE(sm.crash_count, 0) > 0
                  OR COALESCE(sm.anr_count, 0) > 0
                  OR COALESCE(sm.rage_tap_count, 0) > 0
                  OR COALESCE(sm.dead_tap_count, 0) > 0
                  OR COALESCE(array_length(sm.screens_visited, 1), 0) > 0
              )
`.trimEnd();
}

function behavioralSeedCandidatePredicateSql(): string {
    return `
              AND s.status IN ('ready', 'completed')
              AND (
                  COALESCE(s.observe_only, false) = true
                  OR COALESCE(s.replay_quota_billing_exhausted, false) = true
                  OR s.replay_retention_state = 'analytics_only'
              )
${behavioralMeaningfulPredicateSql()}
`.trimEnd();
}

function buildSeedResearchJobsSql(lakeType: ResearchLakeType): string {
    const lanePredicate = lakeType === 'interaction'
        ? interactionSeedCandidatePredicateSql()
        : behavioralSeedCandidatePredicateSql();
    return `
        WITH eligible AS (
            SELECT
                s.id AS session_id,
                s.project_id,
                p.team_id,
                s.started_at + (s.retention_days * INTERVAL '1 day') AS due_at,
                ROW_NUMBER() OVER (
                    PARTITION BY s.project_id
                    ORDER BY s.started_at + (s.retention_days * INTERVAL '1 day'), s.id
                ) AS project_rank,
                MIN(s.started_at + (s.retention_days * INTERVAL '1 day')) OVER (
                    PARTITION BY s.project_id
                ) AS project_oldest_due_at
            FROM sessions s
            INNER JOIN projects p ON p.id = s.project_id
            LEFT JOIN session_metrics sm ON sm.session_id = s.id
            WHERE p.deleted_at IS NULL
              AND s.identity_scrubbed_at IS NULL
              AND s.started_at + (s.retention_days * INTERVAL '1 day') <= NOW() + ($1 * INTERVAL '1 hour')
${lanePredicate}
              AND NOT EXISTS (
                  SELECT 1
                  FROM research_extraction_jobs rej
                  WHERE rej.session_id = s.id
                    AND rej.lake_type = $3
              )
        ),
        candidates AS (
            SELECT session_id, project_id, team_id, due_at
            FROM eligible
            ORDER BY project_rank, project_oldest_due_at, project_id, due_at, session_id
            LIMIT $2
        )
        INSERT INTO research_extraction_jobs (session_id, project_id, team_id, due_at, lake_type)
        SELECT session_id, project_id, team_id, due_at, $3
        FROM candidates
        ON CONFLICT (session_id, lake_type) DO NOTHING
        `;
}

async function seedResearchJobs(lakeType: ResearchLakeType, limit: number): Promise<number> {
    const result = await pool.query(
        buildSeedResearchJobsSql(lakeType),
        [config.RESEARCH_LAKE_LOOKAHEAD_HOURS, limit, lakeType],
    );
    return result.rowCount ?? 0;
}

async function recoverStaleProcessingJobs(): Promise<number> {
    const staleMinutes = Math.max(
        15,
        Math.ceil((config.RESEARCH_LAKE_MAX_RUNTIME_MS + STALE_PROCESSING_BUFFER_MS) / 60_000),
    );
    const result = await pool.query(
        `
        UPDATE research_extraction_jobs
        SET
            status = 'failed',
            next_retry_at = NOW(),
            last_error = 'Recovered stale processing research-lake job after worker deadline',
            updated_at = NOW()
        WHERE status = 'processing'
          AND updated_at < NOW() - ($1 * INTERVAL '1 minute')
        `,
        [staleMinutes],
    );
    return result.rowCount ?? 0;
}

function buildFifoClaimResearchJobsSql(): string {
    return `
        WITH candidates AS (
            SELECT id
            FROM research_extraction_jobs
            WHERE status IN ('pending', 'failed')
              AND lake_type = $2
              AND (next_retry_at IS NULL OR next_retry_at <= NOW())
              AND due_at <= NOW() + ($1 * INTERVAL '1 hour')
            ORDER BY due_at, created_at, id
            LIMIT $3
            FOR UPDATE SKIP LOCKED
        )
        UPDATE research_extraction_jobs rej
        SET
            status = 'processing',
            attempts = attempts + 1,
            updated_at = NOW()
        FROM candidates
        WHERE rej.id = candidates.id
        RETURNING rej.id, rej.session_id, rej.lake_type, rej.project_id, rej.team_id, rej.due_at, rej.attempts
        `;
}

function buildFairClaimResearchJobsSql(): string {
    return `
        WITH ranked AS (
            SELECT
                id,
                project_id,
                due_at,
                created_at,
                ROW_NUMBER() OVER (
                    PARTITION BY project_id
                    ORDER BY due_at, created_at, id
                ) AS project_rank,
                MIN(due_at) OVER (
                    PARTITION BY project_id
                ) AS project_oldest_due_at
            FROM research_extraction_jobs
            WHERE status IN ('pending', 'failed')
              AND lake_type = $2
              AND (next_retry_at IS NULL OR next_retry_at <= NOW())
              AND due_at <= NOW() + ($1 * INTERVAL '1 hour')
        ),
        candidates AS (
            SELECT rej.id
            FROM ranked
            INNER JOIN research_extraction_jobs rej ON rej.id = ranked.id
            ORDER BY ranked.project_rank, ranked.project_oldest_due_at, ranked.project_id, ranked.due_at, ranked.created_at, ranked.id
            LIMIT $3
            FOR UPDATE OF rej SKIP LOCKED
        )
        UPDATE research_extraction_jobs rej
        SET
            status = 'processing',
            attempts = attempts + 1,
            updated_at = NOW()
        FROM candidates
        WHERE rej.id = candidates.id
        RETURNING rej.id, rej.session_id, rej.lake_type, rej.project_id, rej.team_id, rej.due_at, rej.attempts
        `;
}

function buildClaimResearchJobsSql(lakeType: ResearchLakeType = 'interaction'): string {
    return lakeType === 'interaction'
        ? buildFairClaimResearchJobsSql()
        : buildFifoClaimResearchJobsSql();
}

async function claimResearchJobs(lakeType: ResearchLakeType, limit: number): Promise<ResearchJobRow[]> {
    const result = await pool.query<ResearchJobRow>(
        buildClaimResearchJobsSql(lakeType),
        [config.RESEARCH_LAKE_LOOKAHEAD_HOURS, lakeType, limit],
    );
    return result.rows;
}

async function loadSessionContext(sessionId: string): Promise<{
    session: SessionContext | null;
    artifacts: ArtifactContext[];
    transactions: { amount_cents: number; reporting_category: string; type: string; }[];
    customEventConfig: any | null;
}> {
    const sessionResult = await pool.query<SessionContext>(
        `
        SELECT
            s.id,
            s.project_id,
            p.team_id,
            s.platform,
            s.app_version,
            s.sdk_version,
            s.started_at,
            s.ended_at,
            s.duration_seconds,
            s.retention_days,
            s.events,
            s.metadata,
            sm.total_events,
            sm.touch_count,
            sm.scroll_count,
            sm.gesture_count,
            sm.input_count,
            sm.api_success_count,
            sm.api_error_count,
            sm.api_total_count,
            sm.api_avg_response_ms,
            sm.rage_tap_count,
            sm.dead_tap_count,
            sm.custom_event_count,
            sm.app_startup_time_ms,
            sm.network_type,
            sm.cellular_generation,
            sm.is_constrained,
            sm.is_expensive,
            sm.sdk_upload_success_count,
            sm.sdk_upload_failure_count,
            sm.sdk_retry_attempt_count,
            sm.sdk_circuit_breaker_open_count,
            sm.sdk_memory_eviction_count,
            sm.sdk_offline_persist_count,
            sm.sdk_upload_success_rate,
            sm.sdk_avg_upload_duration_ms,
            sm.sdk_total_bytes_uploaded,
            sm.sdk_total_bytes_evicted,
            sm.hierarchy_snapshot_count,
            sm.screenshot_segment_count,
            sm.screenshot_total_bytes,
            sm.screens_visited,
            s.geo_country,
            s.geo_country_code,
            s.geo_city,
            s.user_display_id AS "user_display_id",
            s.observe_only,
            s.replay_quota_billing_exhausted,
            s.replay_retention_state,
            p.text_input_masking,
            p.image_video_masking
        FROM sessions s
        INNER JOIN projects p ON p.id = s.project_id
        LEFT JOIN session_metrics sm ON sm.session_id = s.id
        WHERE s.id = $1
        LIMIT 1
        `,
        [sessionId],
    );

    if (sessionResult.rows.length === 0) {
        return {
            session: null,
            artifacts: [],
            transactions: [],
            customEventConfig: null,
        };
    }

    const session = sessionResult.rows[0];

    const artifactsResult = await pool.query<ArtifactContext>(
        `
        SELECT
            id,
            kind,
            status,
            s3_object_key AS "s3ObjectKey",
            endpoint_id AS "endpointId",
            size_bytes,
            declared_size_bytes,
            start_time,
            end_time,
            frame_count
        FROM recording_artifacts
        WHERE session_id = $1
          AND status = 'ready'
        ORDER BY created_at, id
        `,
        [sessionId],
    );

    const transactionsResult = await pool.query<{
        amount_cents: number;
        reporting_category: string;
        type: string;
    }>(
        `
        SELECT amount_cents AS "amount_cents", reporting_category AS "reporting_category", type
        FROM revenue_provider_transactions
        WHERE project_id = $1 AND (external_source_id = $2 OR metadata->>'sessionId' = $2)
        `,
        [session.project_id, sessionId]
    );

    const connectionResult = await pool.query<{
        custom_event_config: any;
    }>(
        `
        SELECT custom_event_config AS "custom_event_config"
        FROM project_revenue_connections
        WHERE project_id = $1 AND provider = 'custom_events' AND status = 'connected'
        LIMIT 1
        `,
        [session.project_id]
    );

    const customEventConfig = connectionResult.rows[0]?.custom_event_config || null;

    const crashesResult = await pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM crashes WHERE session_id = $1',
        [sessionId]
    );
    const anrsResult = await pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM anrs WHERE session_id = $1',
        [sessionId]
    );
    const errorsResult = await pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM errors WHERE session_id = $1',
        [sessionId]
    );

    session.crash_count = crashesResult.rows[0]?.count ?? 0;
    session.anr_count = anrsResult.rows[0]?.count ?? 0;
    session.error_count = errorsResult.rows[0]?.count ?? 0;

    return {
        session,
        artifacts: artifactsResult.rows,
        transactions: transactionsResult.rows,
        customEventConfig,
    };
}

async function completeJob(
    job: ResearchJobRow,
    params: {
        status: 'exported' | 'rejected';
        lakePath?: string | null;
        qualityTier?: string | null;
        rejectReason?: string | null;
        sourceArtifactCount: number;
        interactionEventCount: number;
        uiFrameCount: number;
        uiSkeletonElementCount: number;
    },
): Promise<void> {
    await pool.query(
        `
        UPDATE research_extraction_jobs
        SET
            status = $2,
            lake_path = $3,
            quality_tier = $4,
            reject_reason = $5,
            source_artifact_count = $6,
            interaction_event_count = $7,
            ui_frame_count = $8,
            ui_skeleton_element_count = $9,
            processed_at = NOW(),
            last_error = NULL,
            updated_at = NOW()
        WHERE id = $1
        `,
        [
            job.id,
            params.status,
            params.lakePath ?? null,
            params.qualityTier ?? null,
            params.rejectReason ?? null,
            params.sourceArtifactCount,
            params.interactionEventCount,
            params.uiFrameCount,
            params.uiSkeletonElementCount,
        ],
    );
}

async function failJob(job: ResearchJobRow, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const retryMinutes = Math.min(60, Math.max(5, job.attempts * 5));
    await pool.query(
        `
        UPDATE research_extraction_jobs
        SET
            status = 'failed',
            next_retry_at = NOW() + ($2 * INTERVAL '1 minute'),
            last_error = $3,
            updated_at = NOW()
        WHERE id = $1
        `,
        [job.id, retryMinutes, message.slice(0, 2000)],
    );
}

type RevenueOutcomeRow = {
    id: string;
    project_id: string;
    source_provider: string;
    date: string | Date;
    currency: string;
    gross_amount_cents: number | string;
    refund_amount_cents: number | string;
    fee_amount_cents: number | string;
    net_amount_cents: number | string;
    transaction_count: number | string;
    refund_count: number | string;
    subscriber_count: number | string;
    trial_count: number | string;
    subscription_start_count: number | string;
    cancellation_count: number | string;
    conversion_count: number | string;
    updated_at: string | Date;
};

type RevenueExportCheckpoint = {
    full_backfill_started_at: Date | null;
    full_backfill_completed_at: Date | null;
    full_backfill_cursor_date: string | Date | null;
    full_backfill_cursor_project_id: string | null;
    full_backfill_cursor_provider: string | null;
    full_backfill_cursor_currency: string | null;
    incremental_cursor_updated_at: Date | null;
    incremental_cursor_id: string | null;
};

type RevenueTrend = {
    previousDayNetCents: number;
    netDeltaCents: number;
    trailing7dNetCents: number;
    previous7dNetCents: number;
    trailing7dDeltaCents: number;
};

const REVENUE_OUTCOMES_CHECKPOINT_ID = 'default';
const REVENUE_ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function dbNumber(value: unknown): number {
    return numberValue(value) ?? 0;
}

function dateKeyFromDb(value: string | Date | null | undefined): string {
    if (value instanceof Date) return datePart(value);
    return String(value || '').slice(0, 10);
}

function updatedAtFromDb(value: string | Date): Date {
    return value instanceof Date ? value : new Date(value);
}

function addDaysToDateKey(dateKey: string, days: number): string {
    const date = new Date(`${dateKey}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function safePartitionSegment(value: unknown, fallback = 'unknown'): string {
    const raw = String(value || fallback).trim().toLowerCase();
    const safe = raw.replace(/[^a-z0-9_.=-]+/g, '_').slice(0, 80);
    return safe || fallback;
}

function moneyBucketFromCents(value: unknown): number {
    return bucketMoneyAmount(Math.max(0, dbNumber(value)) / 100) ?? 0;
}

function absoluteMoneyBucketFromCents(value: unknown): number {
    return bucketMoneyAmount(Math.abs(dbNumber(value)) / 100) ?? 0;
}

function countBucket(value: unknown): number {
    return bucketItemCount(dbNumber(value)) ?? 0;
}

function amountDirection(cents: number): 'positive' | 'negative' | 'zero' {
    if (cents > 0) return 'positive';
    if (cents < 0) return 'negative';
    return 'zero';
}

function deltaDirection(cents: number): 'increase' | 'decrease' | 'flat' {
    if (cents > 0) return 'increase';
    if (cents < 0) return 'decrease';
    return 'flat';
}

function revenueOutcomeBasePath(row: RevenueOutcomeRow): string {
    const projectKey = hmac(`project:${row.project_id}`, 20);
    const date = dateKeyFromDb(row.date);
    const provider = safePartitionSegment(row.source_provider);
    const currency = safePartitionSegment(row.currency);
    return `${config.RESEARCH_LAKE_PREFIX.replace(/^\/+|\/+$/g, '')}/lake=revenue_outcomes/project_key=${projectKey}/date=${date}/provider=${provider}/currency=${currency}`;
}

function buildRevenueOutcomeDocuments(row: RevenueOutcomeRow, trend: RevenueTrend) {
    const projectKey = hmac(`project:${row.project_id}`, 20);
    const date = dateKeyFromDb(row.date);
    const provider = safePartitionSegment(row.source_provider);
    const currency = safePartitionSegment(row.currency);
    const basePath = revenueOutcomeBasePath(row);
    const netCents = dbNumber(row.net_amount_cents);

    const dailyRevenue = {
        schema_version: RESEARCH_SCHEMA_VERSION,
        anonymization_version: RESEARCH_ANONYMIZATION_VERSION,
        lake: 'revenue_outcomes',
        project_key: projectKey,
        sample_date: date,
        provider,
        currency,
        attribution_scope: 'project_day',
        revenue_observation_grain: 'project_provider_currency_day',
        session_attribution_available: false,
        gross_revenue_bucket: moneyBucketFromCents(row.gross_amount_cents),
        refund_revenue_bucket: moneyBucketFromCents(row.refund_amount_cents),
        fee_revenue_bucket: moneyBucketFromCents(row.fee_amount_cents),
        net_revenue_abs_bucket: absoluteMoneyBucketFromCents(netCents),
        net_revenue_direction: amountDirection(netCents),
        transaction_count_bucket: countBucket(row.transaction_count),
        refund_count_bucket: countBucket(row.refund_count),
        subscriber_count_bucket: countBucket(row.subscriber_count),
        trial_count_bucket: countBucket(row.trial_count),
        subscription_start_count_bucket: countBucket(row.subscription_start_count),
        cancellation_count_bucket: countBucket(row.cancellation_count),
        conversion_count_bucket: countBucket(row.conversion_count),
        previous_day_net_revenue_abs_bucket: absoluteMoneyBucketFromCents(trend.previousDayNetCents),
        previous_day_net_revenue_direction: amountDirection(trend.previousDayNetCents),
        net_revenue_delta_abs_bucket: absoluteMoneyBucketFromCents(trend.netDeltaCents),
        net_revenue_delta_direction: deltaDirection(trend.netDeltaCents),
        trailing_7d_net_revenue_abs_bucket: absoluteMoneyBucketFromCents(trend.trailing7dNetCents),
        trailing_7d_net_revenue_direction: amountDirection(trend.trailing7dNetCents),
        previous_7d_net_revenue_abs_bucket: absoluteMoneyBucketFromCents(trend.previous7dNetCents),
        previous_7d_net_revenue_direction: amountDirection(trend.previous7dNetCents),
        trailing_7d_net_revenue_delta_abs_bucket: absoluteMoneyBucketFromCents(trend.trailing7dDeltaCents),
        trailing_7d_net_revenue_delta_direction: deltaDirection(trend.trailing7dDeltaCents),
    };

    const quality = {
        schema_version: RESEARCH_SCHEMA_VERSION,
        quality_tier: 'aggregate_only',
        pii_scan: 'passed',
        source_row_count: 1,
        attribution_scope: 'project_day',
        session_attribution_available: false,
        warnings: ['not_session_attributed'],
    };

    const manifest = {
        schema_version: RESEARCH_SCHEMA_VERSION,
        anonymization_version: RESEARCH_ANONYMIZATION_VERSION,
        lake: 'revenue_outcomes',
        project_key: projectKey,
        sample_date: date,
        provider,
        currency,
        source: {
            table: 'project_revenue_daily',
            attribution_scope: 'project_day',
            session_attribution_available: false,
        },
        quality_tier: quality.quality_tier,
        files: {
            daily_revenue: `${basePath}/daily_revenue.json`,
            quality: `${basePath}/quality.json`,
            zip: `${basePath}.zip`,
        },
    };

    return { basePath, manifest, quality, dailyRevenue };
}

function revenueGroupKey(row: Pick<RevenueOutcomeRow, 'project_id' | 'source_provider' | 'currency'>): string {
    return `${row.project_id}:${row.source_provider}:${row.currency}`;
}

async function loadRevenueTrendRows(rows: RevenueOutcomeRow[]): Promise<Map<string, Map<string, RevenueOutcomeRow>>> {
    const groups = new Map<string, {
        projectId: string;
        provider: string;
        currency: string;
        minDate: string;
        maxDate: string;
    }>();

    for (const row of rows) {
        const date = dateKeyFromDb(row.date);
        const key = revenueGroupKey(row);
        const existing = groups.get(key);
        if (!existing) {
            groups.set(key, {
                projectId: row.project_id,
                provider: row.source_provider,
                currency: row.currency,
                minDate: date,
                maxDate: date,
            });
        } else {
            if (date < existing.minDate) existing.minDate = date;
            if (date > existing.maxDate) existing.maxDate = date;
        }
    }

    const trends = new Map<string, Map<string, RevenueOutcomeRow>>();
    for (const group of groups.values()) {
        const result = await pool.query<RevenueOutcomeRow>(
            `
            SELECT
                id::text,
                project_id::text,
                source_provider,
                date::text,
                currency,
                gross_amount_cents,
                refund_amount_cents,
                fee_amount_cents,
                net_amount_cents,
                transaction_count,
                refund_count,
                subscriber_count,
                trial_count,
                subscription_start_count,
                cancellation_count,
                conversion_count,
                updated_at
            FROM project_revenue_daily
            WHERE project_id = $1
              AND source_provider = $2
              AND currency = $3
              AND date >= ($4::date - INTERVAL '13 days')
              AND date <= $5::date
            ORDER BY date
            `,
            [group.projectId, group.provider, group.currency, group.minDate, group.maxDate],
        );

        const byDate = new Map<string, RevenueOutcomeRow>();
        for (const trendRow of result.rows) {
            byDate.set(dateKeyFromDb(trendRow.date), trendRow);
        }
        trends.set(`${group.projectId}:${group.provider}:${group.currency}`, byDate);
    }

    return trends;
}

function sumNetCentsByDate(
    byDate: Map<string, RevenueOutcomeRow> | undefined,
    startDate: string,
    endDate: string,
): number {
    let total = 0;
    for (let date = startDate; date <= endDate; date = addDaysToDateKey(date, 1)) {
        total += dbNumber(byDate?.get(date)?.net_amount_cents);
    }
    return total;
}

function buildRevenueTrend(row: RevenueOutcomeRow, trendRows: Map<string, Map<string, RevenueOutcomeRow>>): RevenueTrend {
    const date = dateKeyFromDb(row.date);
    const byDate = trendRows.get(revenueGroupKey(row));
    const previousDayDate = addDaysToDateKey(date, -1);
    const previousDayNetCents = dbNumber(byDate?.get(previousDayDate)?.net_amount_cents);
    const netDeltaCents = dbNumber(row.net_amount_cents) - previousDayNetCents;
    const trailing7dNetCents = sumNetCentsByDate(byDate, addDaysToDateKey(date, -6), date);
    const previous7dNetCents = sumNetCentsByDate(byDate, addDaysToDateKey(date, -13), addDaysToDateKey(date, -7));
    return {
        previousDayNetCents,
        netDeltaCents,
        trailing7dNetCents,
        previous7dNetCents,
        trailing7dDeltaCents: trailing7dNetCents - previous7dNetCents,
    };
}

async function putRevenueOutcomeRow(row: RevenueOutcomeRow, trend: RevenueTrend): Promise<void> {
    const { basePath, manifest, quality, dailyRevenue } = buildRevenueOutcomeDocuments(row, trend);
    if (containsIdentifierRisk({ manifest, quality, dailyRevenue })) {
        throw new Error('identifier_risk_detected_in_revenue_outcome');
    }

    const manifestBuf = jsonBuffer(manifest);
    const qualityBuf = jsonBuffer(quality);
    const dailyRevenueBuf = jsonBuffer(dailyRevenue);
    await putResearchObject(`${basePath}/manifest.json`, manifestBuf, 'application/json');
    await putResearchObject(`${basePath}/quality.json`, qualityBuf, 'application/json');
    await putResearchObject(`${basePath}/daily_revenue.json`, dailyRevenueBuf, 'application/json');
    const zipBuffer = await createZipArchiveBuffer([
        { name: 'manifest.json', buffer: manifestBuf },
        { name: 'quality.json', buffer: qualityBuf },
        { name: 'daily_revenue.json', buffer: dailyRevenueBuf },
    ]);
    await putResearchObject(`${basePath}.zip`, zipBuffer, 'application/zip');
}

async function loadRevenueExportCheckpoint(): Promise<RevenueExportCheckpoint> {
    await pool.query(
        `
        INSERT INTO research_lake_revenue_export_checkpoints (id)
        VALUES ($1)
        ON CONFLICT (id) DO NOTHING
        `,
        [REVENUE_OUTCOMES_CHECKPOINT_ID],
    );
    const result = await pool.query<RevenueExportCheckpoint>(
        `
        SELECT
            full_backfill_started_at,
            full_backfill_completed_at,
            full_backfill_cursor_date,
            full_backfill_cursor_project_id::text,
            full_backfill_cursor_provider,
            full_backfill_cursor_currency,
            incremental_cursor_updated_at,
            incremental_cursor_id::text
        FROM research_lake_revenue_export_checkpoints
        WHERE id = $1
        LIMIT 1
        `,
        [REVENUE_OUTCOMES_CHECKPOINT_ID],
    );
    return result.rows[0];
}

async function markRevenueBackfillStarted(startedAt: Date): Promise<void> {
    await pool.query(
        `
        UPDATE research_lake_revenue_export_checkpoints
        SET
            full_backfill_started_at = COALESCE(full_backfill_started_at, $2),
            updated_at = NOW()
        WHERE id = $1
        `,
        [REVENUE_OUTCOMES_CHECKPOINT_ID, startedAt],
    );
}

async function loadRevenueBackfillRows(
    checkpoint: RevenueExportCheckpoint,
    limit: number,
): Promise<RevenueOutcomeRow[]> {
    const result = await pool.query<RevenueOutcomeRow>(
        `
        SELECT
            id::text,
            project_id::text,
            source_provider,
            date::text,
            currency,
            gross_amount_cents,
            refund_amount_cents,
            fee_amount_cents,
            net_amount_cents,
            transaction_count,
            refund_count,
            subscriber_count,
            trial_count,
            subscription_start_count,
            cancellation_count,
            conversion_count,
            updated_at
        FROM project_revenue_daily
        WHERE (
            $1::date IS NULL
            OR (date, project_id, source_provider, currency)
              > ($1::date, $2::uuid, $3::varchar, $4::varchar)
        )
        ORDER BY date, project_id, source_provider, currency
        LIMIT $5
        `,
        [
            dateKeyFromDb(checkpoint.full_backfill_cursor_date) || null,
            checkpoint.full_backfill_cursor_project_id,
            checkpoint.full_backfill_cursor_provider,
            checkpoint.full_backfill_cursor_currency,
            limit,
        ],
    );
    return result.rows;
}

async function loadRevenueIncrementalRows(
    checkpoint: RevenueExportCheckpoint,
    limit: number,
): Promise<RevenueOutcomeRow[]> {
    const cursorUpdatedAt = checkpoint.incremental_cursor_updated_at
        ?? checkpoint.full_backfill_started_at
        ?? new Date(0);
    const cursorId = checkpoint.incremental_cursor_id ?? REVENUE_ZERO_UUID;
    const result = await pool.query<RevenueOutcomeRow>(
        `
        SELECT
            id::text,
            project_id::text,
            source_provider,
            date::text,
            currency,
            gross_amount_cents,
            refund_amount_cents,
            fee_amount_cents,
            net_amount_cents,
            transaction_count,
            refund_count,
            subscriber_count,
            trial_count,
            subscription_start_count,
            cancellation_count,
            conversion_count,
            updated_at
        FROM project_revenue_daily
        WHERE (updated_at, id) > ($1::timestamp, $2::uuid)
        ORDER BY updated_at, id
        LIMIT $3
        `,
        [cursorUpdatedAt, cursorId, limit],
    );
    return result.rows;
}

async function advanceRevenueBackfillCheckpoint(
    rows: RevenueOutcomeRow[],
    complete: boolean,
    backfillStartedAt: Date,
): Promise<void> {
    const last = rows.at(-1);
    await pool.query(
        `
        UPDATE research_lake_revenue_export_checkpoints
        SET
            full_backfill_cursor_date = COALESCE($2::date, full_backfill_cursor_date),
            full_backfill_cursor_project_id = COALESCE($3::uuid, full_backfill_cursor_project_id),
            full_backfill_cursor_provider = COALESCE($4::varchar, full_backfill_cursor_provider),
            full_backfill_cursor_currency = COALESCE($5::varchar, full_backfill_cursor_currency),
            full_backfill_completed_at = CASE WHEN $6::boolean THEN NOW() ELSE full_backfill_completed_at END,
            incremental_cursor_updated_at = CASE
                WHEN $6::boolean THEN COALESCE(incremental_cursor_updated_at, $7::timestamp)
                ELSE incremental_cursor_updated_at
            END,
            incremental_cursor_id = CASE
                WHEN $6::boolean THEN COALESCE(incremental_cursor_id, $8::uuid)
                ELSE incremental_cursor_id
            END,
            last_exported_at = NOW(),
            last_error = NULL,
            updated_at = NOW()
        WHERE id = $1
        `,
        [
            REVENUE_OUTCOMES_CHECKPOINT_ID,
            last ? dateKeyFromDb(last.date) : null,
            last?.project_id ?? null,
            last?.source_provider ?? null,
            last?.currency ?? null,
            complete,
            backfillStartedAt,
            REVENUE_ZERO_UUID,
        ],
    );
}

async function advanceRevenueIncrementalCheckpoint(rows: RevenueOutcomeRow[]): Promise<void> {
    const last = rows.at(-1);
    if (!last) return;
    await pool.query(
        `
        UPDATE research_lake_revenue_export_checkpoints
        SET
            incremental_cursor_updated_at = $2,
            incremental_cursor_id = $3,
            last_exported_at = NOW(),
            last_error = NULL,
            updated_at = NOW()
        WHERE id = $1
        `,
        [REVENUE_OUTCOMES_CHECKPOINT_ID, updatedAtFromDb(last.updated_at), last.id],
    );
}

async function recordRevenueExportError(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
        `
        UPDATE research_lake_revenue_export_checkpoints
        SET last_error = $2, updated_at = NOW()
        WHERE id = $1
        `,
        [REVENUE_OUTCOMES_CHECKPOINT_ID, message.slice(0, 2000)],
    );
}

async function exportRevenueOutcomeRows(rows: RevenueOutcomeRow[]): Promise<{ exported: number; failed: number }> {
    const trendRows = await loadRevenueTrendRows(rows);
    let exported = 0;
    let failed = 0;
    for (const row of rows) {
        try {
            await putRevenueOutcomeRow(row, buildRevenueTrend(row, trendRows));
            exported++;
        } catch (err) {
            failed++;
            logger.error({
                err,
                provider: safePartitionSegment(row.source_provider),
                date: dateKeyFromDb(row.date),
                currency: safePartitionSegment(row.currency),
            }, 'Research lake revenue outcome export failed');
        }
    }
    return { exported, failed };
}

async function runResearchLakeRevenueOutcomesExportCycle(): Promise<RevenueOutcomeExportSummary> {
    const summary: RevenueOutcomeExportSummary = {
        attempted: 0,
        exported: 0,
        failed: 0,
        mode: config.RESEARCH_LAKE_REVENUE_OUTCOMES_ENABLED ? 'idle' : 'disabled',
    };
    if (!config.RESEARCH_LAKE_REVENUE_OUTCOMES_ENABLED) return summary;

    const batchSize = Math.max(1, Math.trunc(config.RESEARCH_LAKE_REVENUE_OUTCOMES_BATCH_SIZE));
    const checkpoint = await loadRevenueExportCheckpoint();

    if (!checkpoint.full_backfill_completed_at) {
        summary.mode = 'backfill';
        const backfillStartedAt = checkpoint.full_backfill_started_at ?? new Date();
        if (!checkpoint.full_backfill_started_at) {
            await markRevenueBackfillStarted(backfillStartedAt);
        }

        const rows = await loadRevenueBackfillRows(checkpoint, batchSize);
        summary.attempted = rows.length;
        if (rows.length === 0) {
            await advanceRevenueBackfillCheckpoint([], true, backfillStartedAt);
            summary.mode = 'idle';
            return summary;
        }

        const result = await exportRevenueOutcomeRows(rows);
        summary.exported = result.exported;
        summary.failed = result.failed;
        if (summary.failed > 0) {
            await recordRevenueExportError(`${summary.failed} revenue outcome rows failed`);
            return summary;
        }

        await advanceRevenueBackfillCheckpoint(rows, rows.length < batchSize, backfillStartedAt);
        return summary;
    }

    const rows = await loadRevenueIncrementalRows(checkpoint, batchSize);
    summary.mode = rows.length > 0 ? 'incremental' : 'idle';
    summary.attempted = rows.length;
    if (rows.length === 0) return summary;

    const result = await exportRevenueOutcomeRows(rows);
    summary.exported = result.exported;
    summary.failed = result.failed;
    if (summary.failed > 0) {
        await recordRevenueExportError(`${summary.failed} revenue outcome rows failed`);
        return summary;
    }

    await advanceRevenueIncrementalCheckpoint(rows);
    return summary;
}

function buildBusinessContext(
    session: SessionContext,
    interactions: ResearchInteractionRow[],
    _transactions: { amount_cents: number; reporting_category: string; type: string; }[],
    customEventConfig?: any
) {
    const events = asEvents(session.events);
    const purchaseCompleteEvents = interactions.filter((i) => i.funnel_transition === 'purchase_complete');
    const isConversionSession = purchaseCompleteEvents.length > 0;

    let conversionRevenueBucket: number | null = null;
    let dominantCurrency: string | null = null;
    let hasDiscountApplied = false;
    const purchasedProductsSet = new Set<string>();

    if (isConversionSession) {
        let totalAmount = 0;
        for (const i of purchaseCompleteEvents) {
            const ev = events[i.index];
            if (ev) {
                const props = (ev.properties ?? ev.payload ?? {}) as Record<string, unknown>;
                const amtProp = typeof customEventConfig?.revenueAmountProperty === 'string' && customEventConfig.revenueAmountProperty.trim()
                    ? customEventConfig.revenueAmountProperty.trim()
                    : null;
                let rawVal = numberValue(
                    (amtProp ? (props[amtProp] ?? ev[amtProp]) : null) ??
                    props.amount ?? props.value ?? props.price ?? ev.amount ?? ev.value ?? ev.price
                );
                if (rawVal !== null && rawVal > 0) {
                    if (customEventConfig?.amountUnit === 'minor') {
                        rawVal = rawVal / 100;
                    }
                    totalAmount += rawVal;
                }
                const curProp = typeof customEventConfig?.revenueCurrencyProperty === 'string' && customEventConfig.revenueCurrencyProperty.trim()
                    ? customEventConfig.revenueCurrencyProperty.trim()
                    : null;
                let currencyVal = stringValue(
                    (curProp ? (props[curProp] ?? ev[curProp]) : null) ??
                    props.currency ?? ev.currency
                );
                if (!currencyVal && customEventConfig?.defaultCurrency) {
                    currencyVal = String(customEventConfig.defaultCurrency);
                }
                if (currencyVal) {
                    currencyVal = currencyVal.trim().toUpperCase();
                }
                if (currencyVal && !dominantCurrency) {
                    dominantCurrency = currencyVal;
                }
            }
        }
        if (totalAmount > 0) {
            conversionRevenueBucket = bucketMoneyAmount(totalAmount);
        }
    }

    for (const ev of events) {
        const props = (ev.properties ?? ev.payload ?? {}) as Record<string, unknown>;
        const couponVal = props.couponCode ?? props.coupon_code ?? props.coupon ?? ev.couponCode ?? ev.coupon_code ?? ev.coupon;
        if (couponVal !== undefined && couponVal !== null && couponVal !== '') {
            hasDiscountApplied = true;
            break;
        }
    }

    for (const i of purchaseCompleteEvents) {
        if (i.product_key && typeof i.product_key === 'string') {
            purchasedProductsSet.add(i.product_key);
        }
    }
    const purchasedProductKeys = Array.from(purchasedProductsSet);

    const uniqueTransitions = new Set<string>();
    for (const i of interactions) {
        if (typeof i.funnel_transition === 'string' && i.funnel_transition) {
            uniqueTransitions.add(i.funnel_transition);
        }
    }
    const lifecycleEventsPresent = Array.from(uniqueTransitions);

    let sessionMetadataKeys: string[] = [];
    if (session.metadata && typeof session.metadata === 'object' && !Array.isArray(session.metadata)) {
        sessionMetadataKeys = Object.keys(session.metadata);
    }

    const cartAdditions = interactions
        .filter((i) => i.funnel_transition === 'cart_add')
        .reduce((sum, i) => sum + Number(i.item_count_change ?? 0), 0);
    const totalCartAdditionsBucket = bucketItemCount(cartAdditions);

    let maxFunnelStageReached = 'none';
    if (isConversionSession) {
        maxFunnelStageReached = 'purchase';
    } else if (interactions.some((i) => i.funnel_transition === 'checkout_start')) {
        maxFunnelStageReached = 'checkout';
    } else if (interactions.some((i) => i.funnel_transition === 'cart_add')) {
        maxFunnelStageReached = 'cart';
    } else if (interactions.some((i) => i.funnel_transition === 'product_view')) {
        maxFunnelStageReached = 'view';
    }

    return {
        is_conversion_session: isConversionSession,
        max_funnel_stage_reached: maxFunnelStageReached,
        conversion_revenue_bucket: conversionRevenueBucket,
        currency: dominantCurrency,
        purchased_product_keys: purchasedProductKeys,
        has_discount_applied: hasDiscountApplied,
        lifecycle_events_present: lifecycleEventsPresent,
        total_cart_additions_bucket: totalCartAdditionsBucket,
        session_metadata_keys: sessionMetadataKeys,
        funnel_steps_configured: [
            'product_view',
            'cart_add',
            'checkout_start',
            'purchase_complete'
        ]
    };
}

function behavioralSourceReason(session: SessionContext): string {
    if (session.observe_only) return 'observe_only';
    if (session.replay_quota_billing_exhausted) return 'replay_quota_exhausted';
    if (session.replay_retention_state === 'analytics_only') return 'smart_capture_analytics_only';
    return 'unknown';
}

function buildGeoContext(session: SessionContext): Record<string, string | null> {
    return {
        country: session.geo_country || null,
        country_code: session.geo_country_code || null,
        city: session.geo_city || null,
    };
}

function booleanValue(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes'].includes(normalized)) return true;
        if (['false', '0', 'no'].includes(normalized)) return false;
    }
    if (typeof value === 'number') return value !== 0;
    return null;
}

function buildSessionMetrics(session: SessionContext): Record<string, unknown> {
    return {
        total_events: session.total_events || 0,
        custom_event_count: session.custom_event_count || 0,
        touch_count: session.touch_count || 0,
        scroll_count: session.scroll_count || 0,
        gesture_count: session.gesture_count || 0,
        input_count: session.input_count || 0,
        rage_tap_count: session.rage_tap_count || 0,
        dead_tap_count: session.dead_tap_count || 0,
        duration_seconds_bucket: bucketNumber(session.duration_seconds, 30, 0, 24 * 60 * 60),
        crash_count: session.crash_count ?? 0,
        anr_count: session.anr_count ?? 0,
        error_count: session.error_count ?? 0,
        api_total_count: session.api_total_count || 0,
        api_success_count: session.api_success_count || 0,
        api_error_count: session.api_error_count || 0,
        api_avg_response_ms_bucket: bucketNumber(session.api_avg_response_ms, 100, 0, 120_000),
        app_startup_time_ms_bucket: bucketNumber(session.app_startup_time_ms, 100, 0, 120_000),
        network_type: session.network_type || null,
        cellular_generation: session.cellular_generation || null,
        is_constrained: booleanValue(session.is_constrained),
        is_expensive: booleanValue(session.is_expensive),
        sdk_upload_success_count: session.sdk_upload_success_count || 0,
        sdk_upload_failure_count: session.sdk_upload_failure_count || 0,
        sdk_retry_attempt_count: session.sdk_retry_attempt_count || 0,
        sdk_circuit_breaker_open_count: session.sdk_circuit_breaker_open_count || 0,
        sdk_memory_eviction_count: session.sdk_memory_eviction_count || 0,
        sdk_offline_persist_count: session.sdk_offline_persist_count || 0,
        sdk_upload_success_rate_bucket: bucketNumber(session.sdk_upload_success_rate, 0.05, 0, 1),
        sdk_avg_upload_duration_ms_bucket: bucketNumber(session.sdk_avg_upload_duration_ms, 100, 0, 120_000),
        sdk_total_bytes_uploaded_bucket: bucketNumber(session.sdk_total_bytes_uploaded, 64 * 1024, 0, 2 * 1024 * 1024 * 1024),
        sdk_total_bytes_evicted_bucket: bucketNumber(session.sdk_total_bytes_evicted, 64 * 1024, 0, 2 * 1024 * 1024 * 1024),
        hierarchy_snapshot_count: session.hierarchy_snapshot_count || 0,
        screenshot_segment_count: session.screenshot_segment_count || 0,
        screenshot_total_bytes_bucket: bucketNumber(session.screenshot_total_bytes, 64 * 1024, 0, 2 * 1024 * 1024 * 1024),
    };
}

function hasMeaningfulBehavioralSignal(session: SessionContext, events: unknown[]): boolean {
    if (events.length > 0) return true;
    if ((session.screens_visited || []).length > 0) return true;
    const metrics = buildSessionMetrics(session);
    return [
        'total_events',
        'custom_event_count',
        'api_total_count',
        'api_error_count',
        'error_count',
        'crash_count',
        'anr_count',
        'rage_tap_count',
        'dead_tap_count',
        'sdk_upload_failure_count',
    ].some((key) => Number(metrics[key] ?? 0) > 0);
}

function eventFamily(interaction: ResearchInteractionRow): string {
    const transition = stringValue(interaction.funnel_transition);
    if (transition) return 'funnel';
    if (['tap', 'scroll', 'gesture', 'input'].includes(interaction.kind)) return 'interaction';
    if (interaction.kind === 'screen') return 'navigation';
    return 'custom';
}

function buildBehavioralEvents(
    session: SessionContext,
    interactions: ResearchInteractionRow[],
    projectKey: string,
): Record<string, unknown>[] {
    const events = asEvents(session.events);
    return interactions.map((interaction) => {
        const sourceEvent = events[interaction.index] ?? {};
        const eventName = stringValue(sourceEvent.name ?? sourceEvent.type ?? sourceEvent.eventName ?? sourceEvent.event_name);
        const props = sourceEvent.properties && typeof sourceEvent.properties === 'object' && !Array.isArray(sourceEvent.properties)
            ? sourceEvent.properties as Record<string, unknown>
            : sourceEvent.payload && typeof sourceEvent.payload === 'object' && !Array.isArray(sourceEvent.payload)
                ? sourceEvent.payload as Record<string, unknown>
                : {};
        return {
            event_index: interaction.index,
            elapsed_ms_bucket: interaction.elapsed_ms_bucket,
            event_family: eventFamily(interaction),
            event_kind: interaction.kind,
            event_name_key: eventName ? hmac(`${projectKey}:event-name:${eventName}`, 20) : null,
            funnel_transition: interaction.funnel_transition ?? null,
            screen_key: interaction.screen_key,
            target_key: interaction.target_key,
            x_norm_bucket: interaction.x_norm_bucket ?? null,
            y_norm_bucket: interaction.y_norm_bucket ?? null,
            x_cell: interaction.x_cell ?? null,
            y_cell: interaction.y_cell ?? null,
            touch_grid_columns: interaction.touch_grid_columns ?? null,
            touch_grid_rows: interaction.touch_grid_rows ?? null,
            screen_orientation: interaction.screen_orientation ?? null,
            screen_form_factor: interaction.screen_form_factor ?? null,
            input_modality: interaction.input_modality ?? null,
            item_count_bucket: interaction.item_count_change ?? null,
            cart_value_bucket: interaction.cart_value_bucket ?? null,
            currency: interaction.currency ?? null,
            product_key: interaction.product_key ?? null,
            plan_key: interaction.plan_key ?? null,
            price_key: interaction.price_key ?? null,
            payment_provider: interaction.payment_provider ?? null,
            platform: interaction.platform ?? null,
            is_renewal: interaction.is_renewal ?? null,
            is_trial_conversion: interaction.is_trial_conversion ?? null,
            event_shape_key: hmac(`${projectKey}:event-shape:${eventFamily(interaction)}:${Object.keys(props).sort().join(',')}`, 20),
        };
    });
}

function buildBehavioralLabels(
    session: SessionContext,
    businessContext: ReturnType<typeof buildBusinessContext>,
): Record<string, unknown> {
    const hasApiFailure = (session.api_error_count || 0) > 0;
    const hasStabilityFailure = (session.crash_count ?? 0) > 0
        || (session.anr_count ?? 0) > 0
        || (session.error_count ?? 0) > 0;
    return {
        is_conversion_session: businessContext.is_conversion_session,
        max_funnel_stage_reached: businessContext.max_funnel_stage_reached,
        conversion_revenue_bucket: businessContext.conversion_revenue_bucket,
        purchased_product_keys: businessContext.purchased_product_keys,
        lifecycle_events_present: businessContext.lifecycle_events_present,
        has_api_failure: hasApiFailure,
        has_stability_failure: hasStabilityFailure,
        has_rage_or_dead_tap: (session.rage_tap_count || 0) > 0 || (session.dead_tap_count || 0) > 0,
        abandoned_after_paywall: !businessContext.is_conversion_session
            && businessContext.lifecycle_events_present.includes('paywall_view'),
        abandoned_after_checkout: !businessContext.is_conversion_session
            && businessContext.lifecycle_events_present.includes('checkout_start'),
    };
}

function buildBehavioralManifest(params: {
    session: SessionContext;
    projectKey: string;
    lakeSampleKey: string;
    date: string;
    basePath: string;
    businessContext: ReturnType<typeof buildBusinessContext>;
    metrics: Record<string, unknown>;
    labels: Record<string, unknown>;
    eventCount: number;
}) {
    const { session, projectKey, lakeSampleKey, date, basePath, businessContext, metrics, labels, eventCount } = params;
    const screenPathKeys = (session.screens_visited || []).map((screen) => screenKey(screen, projectKey));
    return {
        schema_version: RESEARCH_SCHEMA_VERSION,
        anonymization_version: RESEARCH_ANONYMIZATION_VERSION,
        lake: 'behavioral_outcomes',
        project_key: projectKey,
        sample_key: lakeSampleKey,
        sample_date: date,
        session_start_ts_utc: session.started_at.toISOString(),
        platform: session.platform || 'unknown',
        app_version_bucket: coarseAppVersion(session.app_version),
        sdk_version_bucket: coarseAppVersion(session.sdk_version),
        duration_seconds_bucket: bucketNumber(session.duration_seconds, 30, 0, 24 * 60 * 60),
        retention_days: session.retention_days,
        source: {
            reason: behavioralSourceReason(session),
            has_visual_source: false,
            source_event_count: eventCount,
        },
        visitor_context: {
            is_bounced: (session.duration_seconds || 0) < 15 && (session.total_events || 0) < 5,
            screens_visited_count: (session.screens_visited || []).length,
            screen_path_keys: screenPathKeys,
        },
        metrics,
        geo: buildGeoContext(session),
        business_context: {
            currency: businessContext.currency,
            has_discount_applied: businessContext.has_discount_applied,
            total_cart_additions_bucket: businessContext.total_cart_additions_bucket,
            session_metadata_keys: businessContext.session_metadata_keys,
            funnel_steps_configured: businessContext.funnel_steps_configured,
        },
        labels,
        files: {
            events: `${basePath}/events.jsonl.gz`,
            session_metrics: `${basePath}/session_metrics.json`,
            labels: `${basePath}/labels.json`,
            quality: `${basePath}/quality.json`,
            zip: `${basePath}.zip`,
        },
    };
}

async function rejectMissingSession(job: ResearchJobRow): Promise<'rejected'> {
    await completeJob(job, {
        status: 'rejected',
        rejectReason: 'session_missing',
        sourceArtifactCount: 0,
        interactionEventCount: 0,
        uiFrameCount: 0,
        uiSkeletonElementCount: 0,
    });
    return 'rejected';
}

async function processInteractionJob(
    job: ResearchJobRow,
    session: SessionContext,
    artifacts: ArtifactContext[],
    transactions: { amount_cents: number; reporting_category: string; type: string; }[],
    customEventConfig: any | null,
): Promise<'exported' | 'rejected'> {
    const projectKey = hmac(`project:${session.project_id}`, 20);
    const lakeSampleKey = crypto.randomUUID().replace(/-/g, '');
    const interactions = buildInteractions(session, projectKey, customEventConfig);
    const rawVisualRows = await buildVisualRows(session, artifacts, interactions, projectKey);
    const hierarchyCaptureProfile = buildHierarchyCaptureProfile(rawVisualRows.frames);
    const visualRows = annotateHierarchyCaptureProfile(rawVisualRows, hierarchyCaptureProfile);
    const skeleton = [
        ...visualRows.skeleton,
        ...buildInteractionSkeleton(interactions),
    ];
    const rrwebCaptureProfile = buildRrwebCaptureProfile(visualRows.frames, visualRows.skeleton);
    const maskingCaptureProfile = buildMaskingCaptureProfile(session, visualRows.frames, visualRows.skeleton);
    const artifactsSummary = artifactSummary(artifacts);
    const rejection = interactionRejectReason(artifacts, interactions, visualRows.frames);

    if (rejection) {
        await completeJob(job, {
            status: 'rejected',
            rejectReason: rejection,
            sourceArtifactCount: artifacts.length,
            interactionEventCount: interactions.length,
            uiFrameCount: visualRows.frames.length,
            uiSkeletonElementCount: skeleton.length,
        });
        return 'rejected';
    }

    const businessContext = buildBusinessContext(session, interactions, transactions, customEventConfig);
    const labels = buildBehavioralLabels(session, businessContext);
    const metrics = buildSessionMetrics(session);
    const screenPathKeys = (session.screens_visited || []).map((screen) => screenKey(screen, projectKey));
    const captureProfile = {
        hierarchy: hierarchyCaptureProfile,
        rrweb: rrwebCaptureProfile,
        masking: maskingCaptureProfile,
    };
    const qualityWarnings = [
        ...interactionQualityWarnings(interactions, visualRows.frames),
        ...hierarchyCaptureWarnings(hierarchyCaptureProfile),
        ...rrwebCaptureWarnings(rrwebCaptureProfile),
        ...maskingCaptureWarnings(maskingCaptureProfile),
    ];

    const date = datePart(session.started_at);
    const basePath = `${config.RESEARCH_LAKE_PREFIX.replace(/^\/+|\/+$/g, '')}/lake=interaction/project_key=${projectKey}/date=${date}/sample_key=${lakeSampleKey}`;
    const manifest = {
        schema_version: RESEARCH_SCHEMA_VERSION,
        anonymization_version: RESEARCH_ANONYMIZATION_VERSION,
        lake: 'interaction',
        project_key: projectKey,
        sample_key: lakeSampleKey,
        sample_date: date,
        session_start_ts_utc: session.started_at.toISOString(),
        platform: session.platform || 'unknown',
        app_version_bucket: coarseAppVersion(session.app_version),
        sdk_version_bucket: coarseAppVersion(session.sdk_version),
        duration_seconds_bucket: bucketNumber(session.duration_seconds, 30, 0, 24 * 60 * 60),
        retention_days: session.retention_days,
        source: artifactsSummary,
        capture_profile: captureProfile,
        visitor_context: {
            is_bounced: (session.duration_seconds || 0) < 15 && (session.total_events || 0) < 5,
            screens_visited_count: (session.screens_visited || []).length,
            screen_path_keys: screenPathKeys,
        },
        metrics,
        geo: buildGeoContext(session),
        business_context: {
            currency: businessContext.currency,
            has_discount_applied: businessContext.has_discount_applied,
            total_cart_additions_bucket: businessContext.total_cart_additions_bucket,
            session_metadata_keys: businessContext.session_metadata_keys,
            funnel_steps_configured: businessContext.funnel_steps_configured,
        },
        labels,
        files: {
            interactions: `${basePath}/interactions.jsonl.gz`,
            ui_frames: `${basePath}/ui_frames.jsonl.gz`,
            ui_skeleton: `${basePath}/ui_skeleton.jsonl.gz`,
            quality: `${basePath}/quality.json`,
            zip: `${basePath}.zip`,
        },
    };
    const quality = {
        schema_version: RESEARCH_SCHEMA_VERSION,
        quality_tier: 'usable',
        source_artifact_count: artifacts.length,
        interaction_event_count: interactions.length,
        ui_frame_count: visualRows.frames.length,
        screenshot_frame_count: visualRows.frames.filter((frame) => frame.source_kind === 'screenshots').length,
        hierarchy_snapshot_frame_count: visualRows.frames.filter((frame) => frame.source_kind === 'hierarchy').length,
        rrweb_event_frame_count: visualRows.frames.filter((frame) => frame.source_kind === 'rrweb').length,
        ui_skeleton_element_count: skeleton.length,
        visual_modality_counts: countStringField(visualRows.frames, 'visual_modality'),
        recommended_encoder_counts: countStringField(visualRows.frames, 'recommended_encoder'),
        grid_shape_counts: gridShapeCounts(visualRows.frames),
        feature_grid_status_counts: countStringField(visualRows.frames, 'feature_grid_status'),
        capture_profile: captureProfile,
        ...interactionQualityMetrics(interactions),
        pii_scan: 'passed',
        warnings: qualityWarnings,
    };

    if (containsIdentifierRisk({
        manifest,
        quality,
        interactions,
        uiFrames: visualRows.frames,
        skeleton,
    })) {
        await completeJob(job, {
            status: 'rejected',
            rejectReason: 'identifier_risk_detected_after_build',
            sourceArtifactCount: artifacts.length,
            interactionEventCount: interactions.length,
            uiFrameCount: visualRows.frames.length,
            uiSkeletonElementCount: skeleton.length,
        });
        return 'rejected';
    }

    const manifestBuf = jsonBuffer(manifest);
    const qualityBuf = jsonBuffer(quality);
    const interactionsBuf = jsonlGzipBuffer(interactions);
    const uiFramesBuf = jsonlGzipBuffer(visualRows.frames);
    const uiSkeletonBuf = jsonlGzipBuffer(skeleton);

    await putResearchObject(`${basePath}/manifest.json`, manifestBuf, 'application/json');
    await putResearchObject(`${basePath}/quality.json`, qualityBuf, 'application/json');
    await putResearchObject(`${basePath}/interactions.jsonl.gz`, interactionsBuf, 'application/jsonl+gzip');
    await putResearchObject(`${basePath}/ui_frames.jsonl.gz`, uiFramesBuf, 'application/jsonl+gzip');
    await putResearchObject(`${basePath}/ui_skeleton.jsonl.gz`, uiSkeletonBuf, 'application/jsonl+gzip');

    const zipFiles = [
        { name: 'manifest.json', buffer: manifestBuf },
        { name: 'quality.json', buffer: qualityBuf },
        { name: 'interactions.jsonl', buffer: jsonlBuffer(interactions) },
        { name: 'ui_frames.jsonl', buffer: jsonlBuffer(visualRows.frames) },
        { name: 'ui_skeleton.jsonl', buffer: jsonlBuffer(skeleton) },
    ];
    const zipBuffer = await createZipArchiveBuffer(zipFiles);
    await putResearchObject(`${basePath}.zip`, zipBuffer, 'application/zip');

    await completeJob(job, {
        status: 'exported',
        lakePath: basePath,
        qualityTier: 'usable',
        sourceArtifactCount: artifacts.length,
        interactionEventCount: interactions.length,
        uiFrameCount: visualRows.frames.length,
        uiSkeletonElementCount: skeleton.length,
    });

    return 'exported';
}

async function processBehavioralJob(
    job: ResearchJobRow,
    session: SessionContext,
    _artifacts: ArtifactContext[],
    transactions: { amount_cents: number; reporting_category: string; type: string; }[],
    customEventConfig: any | null,
): Promise<'exported' | 'rejected'> {
    const projectKey = hmac(`project:${session.project_id}`, 20);
    const lakeSampleKey = crypto.randomUUID().replace(/-/g, '');
    const interactions = buildInteractions(session, projectKey, customEventConfig);
    const events = buildBehavioralEvents(session, interactions, projectKey);
    const metrics = buildSessionMetrics(session);

    if (!hasMeaningfulBehavioralSignal(session, events)) {
        await completeJob(job, {
            status: 'rejected',
            rejectReason: 'insufficient_events_or_metrics',
            sourceArtifactCount: 0,
            interactionEventCount: events.length,
            uiFrameCount: 0,
            uiSkeletonElementCount: 0,
        });
        return 'rejected';
    }

    const businessContext = buildBusinessContext(session, interactions, transactions, customEventConfig);
    const labels = buildBehavioralLabels(session, businessContext);
    const qualityTier = events.length >= config.RESEARCH_LAKE_MIN_EVENT_COUNT ? 'usable' : 'metrics_only';
    const date = datePart(session.started_at);
    const basePath = `${config.RESEARCH_LAKE_PREFIX.replace(/^\/+|\/+$/g, '')}/lake=behavioral_outcomes/project_key=${projectKey}/date=${date}/sample_key=${lakeSampleKey}`;
    const manifest = buildBehavioralManifest({
        session,
        projectKey,
        lakeSampleKey,
        date,
        basePath,
        businessContext,
        metrics,
        labels,
        eventCount: events.length,
    });
    const quality = {
        schema_version: RESEARCH_SCHEMA_VERSION,
        quality_tier: qualityTier,
        source_artifact_count: 0,
        event_count: events.length,
        metrics_only: qualityTier === 'metrics_only',
        ...interactionQualityMetrics(interactions),
        pii_scan: 'passed',
        warnings: qualityTier === 'metrics_only' ? ['below_min_event_count_but_metrics_present'] : [],
    };

    if (containsIdentifierRisk({
        manifest,
        quality,
        events,
        sessionMetrics: metrics,
        labels,
    })) {
        await completeJob(job, {
            status: 'rejected',
            rejectReason: 'identifier_risk_detected_after_build',
            sourceArtifactCount: 0,
            interactionEventCount: events.length,
            uiFrameCount: 0,
            uiSkeletonElementCount: 0,
        });
        return 'rejected';
    }

    const manifestBuf = jsonBuffer(manifest);
    const qualityBuf = jsonBuffer(quality);
    const eventsBuf = jsonlGzipBuffer(events);
    const metricsBuf = jsonBuffer(metrics);
    const labelsBuf = jsonBuffer(labels);

    await putResearchObject(`${basePath}/manifest.json`, manifestBuf, 'application/json');
    await putResearchObject(`${basePath}/quality.json`, qualityBuf, 'application/json');
    await putResearchObject(`${basePath}/events.jsonl.gz`, eventsBuf, 'application/jsonl+gzip');
    await putResearchObject(`${basePath}/session_metrics.json`, metricsBuf, 'application/json');
    await putResearchObject(`${basePath}/labels.json`, labelsBuf, 'application/json');

    const zipFiles = [
        { name: 'manifest.json', buffer: manifestBuf },
        { name: 'quality.json', buffer: qualityBuf },
        { name: 'events.jsonl', buffer: jsonlBuffer(events) },
        { name: 'session_metrics.json', buffer: metricsBuf },
        { name: 'labels.json', buffer: labelsBuf },
    ];
    const zipBuffer = await createZipArchiveBuffer(zipFiles);
    await putResearchObject(`${basePath}.zip`, zipBuffer, 'application/zip');

    await completeJob(job, {
        status: 'exported',
        lakePath: basePath,
        qualityTier,
        sourceArtifactCount: 0,
        interactionEventCount: events.length,
        uiFrameCount: 0,
        uiSkeletonElementCount: 0,
    });

    return 'exported';
}

async function processJob(job: ResearchJobRow): Promise<'exported' | 'rejected'> {
    const { session, artifacts, transactions, customEventConfig } = await loadSessionContext(job.session_id);
    if (!session) return rejectMissingSession(job);

    if (job.lake_type === 'behavioral_outcomes') {
        return processBehavioralJob(job, session, artifacts, transactions, customEventConfig);
    }

    return processInteractionJob(job, session, artifacts, transactions, customEventConfig);
}

export async function runResearchLakeExtractionCycle(): Promise<ResearchLakeCycleSummary> {
    const summary = createCycleSummary();

    if (!config.RESEARCH_LAKE_ENABLED) {
        logger.info('Research lake disabled; skipping extraction cycle');
        return summary;
    }

    const batchSize = Math.max(1, Math.trunc(config.RESEARCH_LAKE_BATCH_SIZE));
    summary.recoveredStaleProcessing = await recoverStaleProcessingJobs();
    for (const lakeType of RESEARCH_LAKE_TYPES) {
        summary.byLake[lakeType].seeded = await seedResearchJobs(lakeType, batchSize * 40);
    }
    addLaneSummaryTotals(summary);
    const startedAt = Date.now();

    while (Date.now() - startedAt < config.RESEARCH_LAKE_MAX_RUNTIME_MS) {
        let claimedThisRound = 0;

        for (const lakeType of RESEARCH_LAKE_TYPES) {
            if (Date.now() - startedAt >= config.RESEARCH_LAKE_MAX_RUNTIME_MS) break;

            const jobs = await claimResearchJobs(lakeType, batchSize);
            claimedThisRound += jobs.length;
            if (jobs.length === 0) continue;

            const concurrency = Math.max(1, Math.min(config.RESEARCH_LAKE_CONCURRENCY, jobs.length));
            let nextIndex = 0;

            async function worker(): Promise<void> {
                while (nextIndex < jobs.length) {
                    if (Date.now() - startedAt >= config.RESEARCH_LAKE_MAX_RUNTIME_MS) break;
                    const job = jobs[nextIndex++];
                    const lane = summary.byLake[job.lake_type];
                    lane.attempted++;
                    try {
                        const status = await processJob(job);
                        if (status === 'exported') lane.exported++;
                        else lane.rejected++;
                    } catch (err) {
                        lane.failed++;
                        await failJob(job, err);
                        logger.error({
                            err,
                            jobId: job.id,
                            sessionId: job.session_id,
                            lakeType: job.lake_type,
                        }, 'Research lake extraction failed');
                    }
                }
            }

            await Promise.all(Array.from({ length: concurrency }, () => worker()));
        }

        addLaneSummaryTotals(summary);
        if (claimedThisRound === 0) break;
    }

    try {
        summary.revenueOutcomes = await runResearchLakeRevenueOutcomesExportCycle();
    } catch (err) {
        summary.revenueOutcomes.failed++;
        await recordRevenueExportError(err).catch(() => {});
        logger.error({ err }, 'Research lake revenue outcomes export cycle failed');
    }

    addLaneSummaryTotals(summary);
    logger.info(summary, 'Research lake extraction cycle completed');
    return summary;
}

export const __researchLakeTestInternals = {
    containsIdentifierRisk,
    visualGridSpecForDimensions,
    imageFeatureGrid,
    createZipArchiveBuffer,
    buildInteractions,
    buildBehavioralEvents,
    buildBehavioralLabels,
    buildBehavioralManifest,
    buildSessionMetrics,
    buildGeoContext,
    buildHierarchyCaptureProfile,
    hierarchyCaptureWarnings,
    buildRrwebCaptureProfile,
    rrwebCaptureWarnings,
    buildMaskingCaptureProfile,
    maskingCaptureWarnings,
    annotateHierarchyCaptureProfile,
    buildInteractionSkeleton,
    buildBusinessContext,
    buildRevenueOutcomeDocuments,
    buildSeedResearchJobsSql,
    buildClaimResearchJobsSql,
    buildFairClaimResearchJobsSql,
    buildFifoClaimResearchJobsSql,
    interactionSeedCandidatePredicateSql,
    behavioralSeedCandidatePredicateSql,
    funnelTransitionAliases: FUNNEL_TRANSITION_ALIASES,
    researchLakeTypes: RESEARCH_LAKE_TYPES,
};
