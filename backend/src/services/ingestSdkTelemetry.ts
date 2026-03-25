import { sql } from 'drizzle-orm';
import { sessionMetrics } from '../db/client.js';

export type NormalizedSdkTelemetry = {
    uploadSuccessCount?: number;
    uploadFailureCount?: number;
    retryAttemptCount?: number;
    circuitBreakerOpenCount?: number;
    memoryEvictionCount?: number;
    offlinePersistCount?: number;
    uploadSuccessRate?: number;
    avgUploadDurationMs?: number;
    totalBytesUploaded?: bigint;
    totalBytesEvicted?: bigint;
};

export function toNonNegativeInt(value: unknown): number | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.max(0, Math.trunc(parsed));
}

export function toFiniteNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
}

export function toNonNegativeBigInt(value: unknown): bigint | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return BigInt(Math.max(0, Math.trunc(parsed)));
}

export function normalizeEndReason(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return null;
    return trimmed
        .replace(/[^a-z0-9._-]/g, '_')
        .slice(0, 64);
}

export function normalizeSdkTelemetry(value: unknown): NormalizedSdkTelemetry | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const payload = value as Record<string, unknown>;
    const normalized: NormalizedSdkTelemetry = {
        uploadSuccessCount: toNonNegativeInt(payload.uploadSuccessCount),
        uploadFailureCount: toNonNegativeInt(payload.uploadFailureCount),
        retryAttemptCount: toNonNegativeInt(payload.retryAttemptCount),
        circuitBreakerOpenCount: toNonNegativeInt(payload.circuitBreakerOpenCount),
        memoryEvictionCount: toNonNegativeInt(payload.memoryEvictionCount),
        offlinePersistCount: toNonNegativeInt(payload.offlinePersistCount),
        uploadSuccessRate: toFiniteNumber(payload.uploadSuccessRate),
        avgUploadDurationMs: toFiniteNumber(payload.avgUploadDurationMs),
        totalBytesUploaded: toNonNegativeBigInt(payload.totalBytesUploaded),
        totalBytesEvicted: toNonNegativeBigInt(payload.totalBytesEvicted),
    };

    const hasAnyValue = Object.values(normalized).some(v => v !== undefined);
    return hasAnyValue ? normalized : null;
}

export function buildSdkTelemetryMergeSet(sdk: NormalizedSdkTelemetry): Record<string, unknown> {
    const updates: Record<string, unknown> = {};

    if (sdk.uploadSuccessCount !== undefined) {
        updates.sdkUploadSuccessCount = sql`GREATEST(COALESCE(${sessionMetrics.sdkUploadSuccessCount}, 0), ${sdk.uploadSuccessCount})`;
    }
    if (sdk.uploadFailureCount !== undefined) {
        updates.sdkUploadFailureCount = sql`GREATEST(COALESCE(${sessionMetrics.sdkUploadFailureCount}, 0), ${sdk.uploadFailureCount})`;
    }
    if (sdk.retryAttemptCount !== undefined) {
        updates.sdkRetryAttemptCount = sql`GREATEST(COALESCE(${sessionMetrics.sdkRetryAttemptCount}, 0), ${sdk.retryAttemptCount})`;
    }
    if (sdk.circuitBreakerOpenCount !== undefined) {
        updates.sdkCircuitBreakerOpenCount = sql`GREATEST(COALESCE(${sessionMetrics.sdkCircuitBreakerOpenCount}, 0), ${sdk.circuitBreakerOpenCount})`;
    }
    if (sdk.memoryEvictionCount !== undefined) {
        updates.sdkMemoryEvictionCount = sql`GREATEST(COALESCE(${sessionMetrics.sdkMemoryEvictionCount}, 0), ${sdk.memoryEvictionCount})`;
    }
    if (sdk.offlinePersistCount !== undefined) {
        updates.sdkOfflinePersistCount = sql`GREATEST(COALESCE(${sessionMetrics.sdkOfflinePersistCount}, 0), ${sdk.offlinePersistCount})`;
    }
    if (sdk.uploadSuccessRate !== undefined) {
        updates.sdkUploadSuccessRate = sdk.uploadSuccessRate;
    }
    if (sdk.avgUploadDurationMs !== undefined) {
        updates.sdkAvgUploadDurationMs = sdk.avgUploadDurationMs;
    }
    if (sdk.totalBytesUploaded !== undefined) {
        updates.sdkTotalBytesUploaded = sql`GREATEST(COALESCE(${sessionMetrics.sdkTotalBytesUploaded}, 0), ${sdk.totalBytesUploaded})`;
    }
    if (sdk.totalBytesEvicted !== undefined) {
        updates.sdkTotalBytesEvicted = sql`GREATEST(COALESCE(${sessionMetrics.sdkTotalBytesEvicted}, 0), ${sdk.totalBytesEvicted})`;
    }

    return updates;
}
