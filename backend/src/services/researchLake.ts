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

const RESEARCH_SCHEMA_VERSION = 1;
const RESEARCH_ANONYMIZATION_VERSION = 1;
const SCREENSHOT_FEATURE_GRID_SIZE = 8;
const JPEG_MAX_MEMORY_MB = 192;
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
    source_kind: 'screenshots' | 'rrweb';
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
    lumaGrid: number[];
    edgeGrid: number[];
    colorGrid: number[];
    signature: string;
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

export interface ResearchLakeCycleSummary extends ResearchLakeLaneSummary {
    recoveredStaleProcessing: number;
    byLake: Record<ResearchLakeType, ResearchLakeLaneSummary>;
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

function bucketNumber(value: unknown, bucketSize: number, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
    const numeric = numberValue(value);
    if (numeric === null) return null;
    const bounded = Math.max(min, Math.min(max, numeric));
    return Math.round(bounded / bucketSize) * bucketSize;
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

function getFunnelTransition(eventName: string, customEventConfig?: any): string | null {
    const name = eventName.toLowerCase();
    
    // Check custom event config first
    if (customEventConfig) {
        if (customEventConfig.revenueEventName && name === customEventConfig.revenueEventName.toLowerCase()) {
            return 'purchase_complete';
        }
        if (customEventConfig.conversionEventName && name === customEventConfig.conversionEventName.toLowerCase()) {
            return 'purchase_complete';
        }
        if (customEventConfig.checkoutEventName && name === customEventConfig.checkoutEventName.toLowerCase()) {
            return 'checkout_start';
        }
        if (customEventConfig.subscriptionStartedEventName && name === customEventConfig.subscriptionStartedEventName.toLowerCase()) {
            return 'checkout_start';
        }
        if (customEventConfig.subscriberEventName && name === customEventConfig.subscriberEventName.toLowerCase()) {
            return 'cart_add';
        }
    }
    
    // Default patterns for 16 funnel / lifecycle transitions
    if (/purchase_completed|purchase_complete|purchase_success|^purchase$|order_completed|complete_purchase|conversion/i.test(name)) {
        return 'purchase_complete';
    }
    if (/checkout_started|checkout_start|begin_checkout/i.test(name)) {
        return 'checkout_start';
    }
    // NOTE: 'added_to_cart' and 'product_added_to_cart' are included as default equivalencies
    // for compatibility with legacy SDK event tracking setups. If a future iteration needs to
    // differentiate them (e.g. quick-add vs detail-add), they should be split here or overridden 
    // explicitly via project customEventConfig.subscriberEventName setting.
    if (/add_to_cart|cart_add|addtocart|added_to_cart|product_added_to_cart/i.test(name)) {
        return 'cart_add';
    }
    if (/view_item|product_view|viewproduct/i.test(name)) {
        return 'product_view';
    }
    if (/signup|sign_up|register|account_created|signup_completed/i.test(name)) {
        return 'signup';
    }
    if (/login|sign_in/i.test(name)) {
        return 'login';
    }
    if (/paywall_view|paywall_exposure|view_paywall/i.test(name)) {
        return 'paywall_view';
    }
    if (/plan_selected|pricing_plan_selected|select_plan|pricing_viewed/i.test(name)) {
        return 'plan_selected';
    }
    if (/coupon_use|coupon_used|apply_coupon/i.test(name)) {
        return 'coupon_use';
    }
    if (/trial_started|trial_start|begin_trial/i.test(name)) {
        return 'trial_start';
    }
    if (/subscription_started|subscription_start/i.test(name)) {
        return 'subscription_start';
    }
    if (/refund|refund_completed|refunded|refund_processed/i.test(name)) {
        return 'refund';
    }
    if (/cancel|cancel_subscription|cancellation|subscription_cancelled/i.test(name)) {
        return 'cancellation';
    }
    if (/payment_failure|payment_failed|charge_failed/i.test(name)) {
        return 'payment_failure';
    }
    if (/onboarding_completed|onboarding_milestone|complete_onboarding/i.test(name)) {
        return 'onboarding_completed';
    }
    if (/feature_used|key_feature_used|use_feature/i.test(name)) {
        return 'feature_used';
    }
    
    return null;
}

function buildInteractions(
    session: SessionContext,
    projectKey: string,
    customEventConfig?: any
): ResearchInteractionRow[] {
    const events = asEvents(session.events);
    const startedAtMs = session.started_at.getTime();
    return events.map((event, index) => {
        const rawScreen = rawScreenValue(event, session);
        const eventAt = numberValue(event.timestamp ?? event.time ?? event.ts);
        const elapsedMs = eventAt && eventAt > startedAtMs
            ? eventAt - startedAtMs
            : numberValue(event.elapsedMs ?? event.elapsed_ms);
        const xBucket = bucketNumber(event.x ?? event.clientX ?? event.pageX, 24, 0, 4096);
        const yBucket = bucketNumber(event.y ?? event.clientY ?? event.pageY, 24, 0, 4096);
        const kind = classifyEventKind(event);
        const screen = screenKey(rawScreen, projectKey);

        const props = (event.properties ?? event.payload ?? {}) as Record<string, unknown>;
        const eventName = stringValue(event.name ?? event.type ?? event.eventName ?? event.event_name);
        const transition = getFunnelTransition(eventName, customEventConfig);
        
        let cartValueBucket: number | null = null;
        let itemCountChange: number | null = null;
        
        if (transition === 'cart_add') {
            const rawQty = numberValue(props.quantity ?? props.qty ?? event.quantity ?? event.qty);
            const qtyVal = rawQty !== null ? rawQty : 1;
            itemCountChange = Math.round(qtyVal / 5) * 5;
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
            cartValueBucket = Math.round(rawVal / 50) * 50;
        }

        const productIdRaw = props.productId ?? props.product_id ?? props.sku ?? event.productId ?? event.product_id ?? event.sku;
        const productId = typeof productIdRaw === 'string' && productIdRaw ? productIdRaw : null;

        const planIdRaw = props.planId ?? props.plan_id ?? props.plan ?? event.planId ?? event.plan_id ?? event.plan;
        const planId = typeof planIdRaw === 'string' && planIdRaw ? planIdRaw : null;

        const priceIdRaw = props.priceId ?? props.price_id ?? event.priceId ?? event.price_id;
        const priceId = typeof priceIdRaw === 'string' && priceIdRaw ? priceIdRaw : null;

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
            target_key: hmac(`${screen}:${kind}:${xBucket ?? 'x'}:${yBucket ?? 'y'}`, 20),
            x_bucket: xBucket,
            y_bucket: yBucket,
            viewport_width_bucket: bucketNumber(event.viewportWidth ?? event.width, 64, 0, 8192),
            viewport_height_bucket: bucketNumber(event.viewportHeight ?? event.height, 64, 0, 8192),
            input_modality: kind === 'tap' ? 'pointer' : kind,
            funnel_transition: transition,
            item_count_change: itemCountChange,
            cart_value_bucket: cartValueBucket,
            product_id: productId,
            plan_id: planId,
            price_id: priceId,
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
        if (interaction.funnel_transition === 'purchase_complete') {
            role = 'cta_purchase';
        } else if (interaction.funnel_transition === 'checkout_start') {
            role = 'cta_checkout';
        } else if (interaction.funnel_transition === 'cart_add') {
            role = 'cta_cart_add';
        } else if (interaction.funnel_transition === 'product_view') {
            role = 'view_item';
        } else if (interaction.funnel_transition === 'paywall_view') {
            role = 'paywall_element';
        } else if (interaction.funnel_transition === 'plan_selected') {
            role = 'plan_selector';
        } else if (interaction.funnel_transition === 'signup') {
            role = 'cta_signup';
        } else if (interaction.funnel_transition === 'login') {
            role = 'cta_login';
        } else if (interaction.funnel_transition === 'trial_start') {
            role = 'cta_trial_start';
        } else if (interaction.funnel_transition === 'subscription_start') {
            role = 'cta_subscription_start';
        } else if (interaction.funnel_transition === 'refund') {
            role = 'cta_refund';
        } else if (interaction.funnel_transition === 'cancellation') {
            role = 'cta_cancellation';
        } else if (interaction.funnel_transition === 'payment_failure') {
            role = 'payment_failure_element';
        } else if (interaction.funnel_transition === 'onboarding_completed') {
            role = 'cta_onboarding';
        } else if (interaction.funnel_transition === 'feature_used') {
            role = 'feature_element';
        } else if (interaction.funnel_transition === 'coupon_use') {
            role = 'cta_coupon_use';
        }

        elements.set(targetKey, {
            element_key: targetKey,
            frame_key: null,
            screen_key: interaction.screen_key,
            role,
            x_bucket: interaction.x_bucket,
            y_bucket: interaction.y_bucket,
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

        const lumaGrid: number[] = [];
        const edgeGrid: number[] = [];
        const colorGrid: number[] = [];
        const cellWidth = Math.max(1, Math.ceil(decoded.width / SCREENSHOT_FEATURE_GRID_SIZE));
        const cellHeight = Math.max(1, Math.ceil(decoded.height / SCREENSHOT_FEATURE_GRID_SIZE));

        for (let gy = 0; gy < SCREENSHOT_FEATURE_GRID_SIZE; gy++) {
            for (let gx = 0; gx < SCREENSHOT_FEATURE_GRID_SIZE; gx++) {
                const x0 = gx * cellWidth;
                const y0 = gy * cellHeight;
                const x1 = Math.min(decoded.width, x0 + cellWidth);
                const y1 = Math.min(decoded.height, y0 + cellHeight);
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
            lumaGrid.join(''),
            edgeGrid.join(''),
            colorGrid.join(''),
        ].join(':');

        return {
            width: decoded.width,
            height: decoded.height,
            lumaGrid,
            edgeGrid,
            colorGrid,
            signature,
        };
    } catch (err) {
        logger.warn({ err }, 'Failed to decode screenshot frame for research lake feature grid');
        const dimensions = jpegDimensions(buffer);
        if (!dimensions) return null;
        const lumaGrid = Array.from({ length: SCREENSHOT_FEATURE_GRID_SIZE ** 2 }, () => 0);
        const edgeGrid = Array.from({ length: SCREENSHOT_FEATURE_GRID_SIZE ** 2 }, () => 0);
        const colorGrid = Array.from({ length: SCREENSHOT_FEATURE_GRID_SIZE ** 2 }, () => 0);
        return {
            width: dimensions.width,
            height: dimensions.height,
            lumaGrid,
            edgeGrid,
            colorGrid,
            signature: `${dimensions.width}:${dimensions.height}:decode_failed`,
        };
    }
}

function gridDelta(a: number[] | null, b: number[]): number | null {
    if (!a || a.length !== b.length) return null;
    const total = b.reduce((sum, value, index) => sum + Math.abs(value - a[index]), 0);
    return Math.round(total / b.length);
}

function buildScreenshotGridSkeleton(
    frame: ResearchUiFrameRow,
    features: ScreenshotFeatureGrid,
): ResearchUiElementRow[] {
    return features.lumaGrid.map((luma, index) => {
        const xCell = index % SCREENSHOT_FEATURE_GRID_SIZE;
        const yCell = Math.floor(index / SCREENSHOT_FEATURE_GRID_SIZE);
        const edge = features.edgeGrid[index] ?? 0;
        const color = features.colorGrid[index] ?? 0;
        const prominence = Math.min(15, Math.round((edge * 0.65) + (Math.abs(luma - 8) * 0.35)));
        return {
            element_key: hmac(`${frame.frame_key}:cell:${index}:${luma}:${edge}:${color}`, 20),
            frame_key: frame.frame_key,
            screen_key: frame.screen_key,
            role: edge >= 4 ? 'visual_edge_region' : 'visual_region',
            x_cell: xCell,
            y_cell: yCell,
            grid_size: SCREENSHOT_FEATURE_GRID_SIZE,
            luma_bucket: luma,
            edge_bucket: edge,
            color_bucket: color,
            prominence_bucket: prominence,
            text_class: 'masked',
        };
    });
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
    return {
        has_class: typeof attr.class === 'string' && attr.class.length > 0,
        has_href: typeof attr.href === 'string' && attr.href.length > 0,
        has_src: typeof attr.src === 'string' && attr.src.length > 0,
        has_alt: typeof attr.alt === 'string' && attr.alt.length > 0,
        has_aria_label: typeof attr['aria-label'] === 'string' && attr['aria-label'].length > 0,
        has_placeholder: typeof attr.placeholder === 'string' && attr.placeholder.length > 0,
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
                source_index: sessionFrameIndex,
                source_artifact_index: artifactIndex,
                source_artifact_kind: artifact.kind,
                source_frame_index: frame.index,
                elapsed_ms_bucket: elapsedMsBucket,
                screen_key: screenKey,
                width_bucket: bucketNumber(features?.width ?? null, 64, 0, 8192),
                height_bucket: bucketNumber(features?.height ?? null, 64, 0, 8192),
                image_bytes_bucket: bucketNumber(frame.data.length, 16 * 1024, 0, 20 * 1024 * 1024),
                visual_signature_key: visualSignatureKey,
                source_frame_digest_key: sourceFrameDigestKey,
                luma_grid_8x8: features?.lumaGrid ?? [],
                edge_grid_8x8: features?.edgeGrid ?? [],
                color_grid_8x8: features?.colorGrid ?? [],
                previous_frame_delta_bucket: features ? gridDelta(previousLumaGrid, features.lumaGrid) : null,
                text_class: 'masked',
            };
            frames.push(frameRow);

            if (features) {
                skeleton.push(...buildScreenshotGridSkeleton(frameRow, features));
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
    const rrwebRows = await buildRrwebVisualRows(
        session,
        artifacts.filter((artifact) => artifact.kind === 'rrweb'),
        interactions,
        projectKey,
    );

    return {
        frames: [...screenshotRows.frames, ...rrwebRows.frames],
        skeleton: [...screenshotRows.skeleton, ...rrwebRows.skeleton],
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
        has_visual_source: artifacts.some((artifact) => ['screenshots', 'rrweb'].includes(artifact.kind)),
    };
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
                    AND ra.kind IN ('screenshots', 'rrweb')
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
        WITH candidates AS (
            SELECT
                s.id AS session_id,
                s.project_id,
                p.team_id,
                s.started_at + (s.retention_days * INTERVAL '1 day') AS due_at
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
            ORDER BY due_at, s.id
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

function buildClaimResearchJobsSql(): string {
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

async function claimResearchJobs(lakeType: ResearchLakeType, limit: number): Promise<ResearchJobRow[]> {
    const result = await pool.query<ResearchJobRow>(
        buildClaimResearchJobsSql(),
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
            s.replay_retention_state
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
            conversionRevenueBucket = Math.round(totalAmount / 50) * 50;
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
        if (i.product_id && typeof i.product_id === 'string') {
            purchasedProductsSet.add(i.product_id);
        }
    }
    const purchasedProducts = Array.from(purchasedProductsSet);

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
    const totalCartAdditionsBucket = Math.round(cartAdditions / 5) * 5;

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
        purchased_products: purchasedProducts,
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
        const productId = stringValue(interaction.product_id);
        const planId = stringValue(interaction.plan_id);
        const priceId = stringValue(interaction.price_id);
        return {
            event_index: interaction.index,
            elapsed_ms_bucket: interaction.elapsed_ms_bucket,
            event_family: eventFamily(interaction),
            event_kind: interaction.kind,
            event_name_key: eventName ? hmac(`${projectKey}:event-name:${eventName}`, 20) : null,
            funnel_transition: interaction.funnel_transition ?? null,
            screen_key: interaction.screen_key,
            target_key: interaction.target_key,
            input_modality: interaction.input_modality ?? null,
            item_count_bucket: interaction.item_count_change ?? null,
            cart_value_bucket: interaction.cart_value_bucket ?? null,
            currency: interaction.currency ?? null,
            product_key: productId ? hmac(`${projectKey}:product:${productId}`, 20) : null,
            plan_key: planId ? hmac(`${projectKey}:plan:${planId}`, 20) : null,
            price_key: priceId ? hmac(`${projectKey}:price:${priceId}`, 20) : null,
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
    projectKey: string,
): Record<string, unknown> {
    const hasApiFailure = (session.api_error_count || 0) > 0;
    const hasStabilityFailure = (session.crash_count ?? 0) > 0
        || (session.anr_count ?? 0) > 0
        || (session.error_count ?? 0) > 0;
    return {
        is_conversion_session: businessContext.is_conversion_session,
        max_funnel_stage_reached: businessContext.max_funnel_stage_reached,
        conversion_revenue_bucket: businessContext.conversion_revenue_bucket,
        purchased_product_keys: businessContext.purchased_products.map((productId) => hmac(`${projectKey}:product:${productId}`, 20)),
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
        geo: {
            country: session.geo_country || null,
            country_code: session.geo_country_code || null,
            city: session.geo_city || null,
        },
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
    const visualRows = await buildVisualRows(session, artifacts, interactions, projectKey);
    const skeleton = [
        ...visualRows.skeleton,
        ...buildInteractionSkeleton(interactions),
    ];
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
        visitor_context: {
            is_bounced: (session.duration_seconds || 0) < 15 && (session.total_events || 0) < 5,
            screens_visited_count: (session.screens_visited || []).length,
            screens_visited: session.screens_visited || [],
        },
        metrics: {
            total_events: session.total_events || 0,
            touch_count: session.touch_count || 0,
            scroll_count: session.scroll_count || 0,
            gesture_count: session.gesture_count || 0,
            input_count: session.input_count || 0,
            rage_tap_count: session.rage_tap_count || 0,
            dead_tap_count: session.dead_tap_count || 0,
            duration_seconds: session.duration_seconds || 0,
            crash_count: session.crash_count ?? 0,
            anr_count: session.anr_count ?? 0,
            error_count: session.error_count ?? 0,
        },
        geo: {
            country: session.geo_country || null,
            country_code: session.geo_country_code || null,
            city: session.geo_city || null,
        },
        business_context: {
            currency: businessContext.currency,
            has_discount_applied: businessContext.has_discount_applied,
            total_cart_additions_bucket: businessContext.total_cart_additions_bucket,
            session_metadata_keys: businessContext.session_metadata_keys,
            funnel_steps_configured: businessContext.funnel_steps_configured,
        },
        labels: {
            is_conversion_session: businessContext.is_conversion_session,
            max_funnel_stage_reached: businessContext.max_funnel_stage_reached,
            conversion_revenue_bucket: businessContext.conversion_revenue_bucket,
            purchased_products: businessContext.purchased_products,
            lifecycle_events_present: businessContext.lifecycle_events_present,
        },
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
        rrweb_event_frame_count: visualRows.frames.filter((frame) => frame.source_kind === 'rrweb').length,
        ui_skeleton_element_count: skeleton.length,
        pii_scan: 'passed',
        warnings: [],
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
    const labels = buildBehavioralLabels(session, businessContext, projectKey);
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

    addLaneSummaryTotals(summary);
    logger.info(summary, 'Research lake extraction cycle completed');
    return summary;
}

export const __researchLakeTestInternals = {
    containsIdentifierRisk,
    imageFeatureGrid,
    createZipArchiveBuffer,
    buildInteractions,
    buildBehavioralEvents,
    buildBehavioralLabels,
    buildBehavioralManifest,
    buildSessionMetrics,
    buildInteractionSkeleton,
    buildBusinessContext,
    buildSeedResearchJobsSql,
    buildClaimResearchJobsSql,
    interactionSeedCandidatePredicateSql,
    behavioralSeedCandidatePredicateSql,
    researchLakeTypes: RESEARCH_LAKE_TYPES,
};
