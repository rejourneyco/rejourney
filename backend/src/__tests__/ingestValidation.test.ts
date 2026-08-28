import { describe, expect, it } from 'vitest';
import { endSessionSchema } from '../validation/ingest.js';

describe('endSessionSchema', () => {
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
