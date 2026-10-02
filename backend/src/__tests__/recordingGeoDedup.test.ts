import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), update: vi.fn(), where: vi.fn() }));
vi.mock('../db/client.js', () => ({ db: { update: mocks.update }, sessions: { id: 'id' } }));
vi.mock('../services/geoIpMmdb.js', () => ({ lookupGeoIpFromMmdb: mocks.lookup }));
vi.mock('../services/clickhouseProductRollupsSink.js', () => ({ buildClickHouseDeviceUsageDailyRollupRow: vi.fn(), writeDeviceUsageDailyRollupToClickHouse: vi.fn() }));
vi.mock('../logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
import { lookupGeoIp } from '../services/recording.js';
describe('GeoIP ingestion deduplication', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.lookup.mockResolvedValue({ city: 'Austin', countryCode: 'US', region: 'TX', latitude: 30, longitude: -97, timezone: 'America/Chicago' });
        mocks.where.mockResolvedValue(undefined);
        mocks.update.mockReturnValue({ set: () => ({ where: mocks.where }) });
    });
    it('looks up a repeated session/IP once, but immediately handles a changed IP', async () => {
        await lookupGeoIp('dedup-session', '8.8.8.8');
        await lookupGeoIp('dedup-session', '::ffff:8.8.8.8');
        expect(mocks.lookup).toHaveBeenCalledTimes(1);
        expect(mocks.update).toHaveBeenCalledTimes(1);
        await lookupGeoIp('dedup-session', '1.1.1.1');
        expect(mocks.update).toHaveBeenCalledTimes(2);
    });
    it('retries failed writes instead of treating them as completed', async () => {
        mocks.where.mockRejectedValueOnce(new Error('unavailable'));
        await lookupGeoIp('retry-session', '8.8.4.4');
        await lookupGeoIp('retry-session', '8.8.4.4');
        expect(mocks.update).toHaveBeenCalledTimes(2);
    });
    it('deduplicates simultaneous requests', async () => {
        await Promise.all(Array.from({ length: 20 }, () => lookupGeoIp('concurrent-session', '8.8.8.8')));
        expect(mocks.update).toHaveBeenCalledTimes(1);
    });
    it('skips private addresses', async () => {
        await lookupGeoIp('private-session', '192.168.1.5');
        expect(mocks.lookup).not.toHaveBeenCalled();
    });
    it('refreshes after five minutes', async () => {
        vi.useFakeTimers();
        try {
            await lookupGeoIp('expiry-session', '8.8.8.8');
            vi.advanceTimersByTime(300_001);
            await lookupGeoIp('expiry-session', '8.8.8.8');
            expect(mocks.update).toHaveBeenCalledTimes(2);
        } finally { vi.useRealTimers(); }
    });
});
