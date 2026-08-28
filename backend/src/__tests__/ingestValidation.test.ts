import { describe, expect, it } from 'vitest';
import { endSessionSchema } from '../validation/ingest.js';

describe('endSessionSchema', () => {
    it('accepts mobile capture quality counters', () => {
        const parsed = endSessionSchema.parse({
            sessionId: 'session_capture_quality',
            metrics: {
                framesCaptured: 12,
                framesSkippedDuplicate: 3,
                framesSkippedThrottle: 4,
                framesSkippedBacklog: 5,
                framesSkippedMapMoving: 6,
            },
        });

        expect(parsed.metrics).toMatchObject({
            framesCaptured: 12,
            framesSkippedDuplicate: 3,
            framesSkippedThrottle: 4,
            framesSkippedBacklog: 5,
            framesSkippedMapMoving: 6,
        });
    });

    it('accepts crash/anr counts in metrics payload', () => {
        const parsed = endSessionSchema.parse({
            sessionId: 'session_test',
            endedAt: Date.now(),
            metrics: {
                touchCount: 12,
                errorCount: 1,
                crashCount: 2,
                anrCount: 1,
            },
        });

        expect(parsed.metrics?.crashCount).toBe(2);
        expect(parsed.metrics?.anrCount).toBe(1);
    });

    it('accepts bounded additive mobile device-quality context', () => {
        const parsed = endSessionSchema.parse({
            sessionId: 'session_device_quality',
            metrics: {
                thermalStateStart: 'nominal',
                thermalStatePeak: 'serious',
                thermalStateEnd: 'fair',
                thermalThrottledDurationMs: 1250,
                memoryPressurePeak: 'warning',
                memoryPressureEventCount: 2,
                memoryHeadroomMbBucketStart: 2048,
                memoryHeadroomMbBucketMin: 768,
                memoryHeadroomMbBucketEnd: 1536,
                fontScaleBucket: 'accessibility',
                uiStyle: 'dark',
                layoutDirection: 'rtl',
                orientationStart: 'portrait',
                orientationEnd: 'landscape',
                orientationChangeCount: 1,
                displayMaxRefreshRateHz: 120,
                batteryLevelStartPercent: 80,
                batteryLevelEndPercent: 73,
                batteryDeltaPercent: -7,
                batteryStateStart: 'unplugged',
                batteryStateEnd: 'charging',
                chargingStateChanged: true,
                lowPowerModeObserved: true,
            },
        });

        expect(parsed.metrics?.batteryDeltaPercent).toBe(-7);
        expect(parsed.metrics?.thermalStatePeak).toBe('serious');
        expect(parsed.metrics?.fontScaleBucket).toBe('accessibility');
    });

    it('rejects out-of-range or high-cardinality device context', () => {
        expect(() => endSessionSchema.parse({
            sessionId: 'session_invalid_device_quality',
            metrics: {
                batteryLevelStartPercent: 101,
                thermalStatePeak: 'hot',
                displayMaxRefreshRateHz: 5000,
            },
        })).toThrow();
    });

    it('accepts sdk telemetry crash count', () => {
        const parsed = endSessionSchema.parse({
            sessionId: 'session_test',
            sdkTelemetry: {
                uploadSuccessCount: 5,
                crashCount: 3,
            },
        });

        expect(parsed.sdkTelemetry?.crashCount).toBe(3);
        expect(parsed.sdkTelemetry?.uploadSuccessCount).toBe(5);
    });

    it('accepts optional lifecycle v2 fields while preserving old payload compatibility', () => {
        const parsed = endSessionSchema.parse({
            sessionId: 'session_test',
            endedAt: Date.now(),
            endReason: 'background_timeout',
            lifecycleVersion: 2,
        });

        expect(parsed.endReason).toBe('background_timeout');
        expect(parsed.lifecycleVersion).toBe(2);
    });
});
