import { describe, expect, it } from 'vitest';
import { sessionMetrics } from '../db/schema.js';

describe('cumulative session event bytes', () => {
    it('reads counters above 2 GiB as numbers so the next artifact can be added', () => {
        const column = sessionMetrics.eventsSizeBytes;
        expect(column.getSQLType()).toBe('bigint');
        const bytes = column.mapFromDriverValue('2147488698');
        if (typeof bytes !== 'number') throw new Error('Event byte counter must decode as a number');
        expect(bytes + 512).toBe(2147489210);
        expect(column.mapToDriverValue(bytes + 512)).toBe(2147489210);
    });
});
