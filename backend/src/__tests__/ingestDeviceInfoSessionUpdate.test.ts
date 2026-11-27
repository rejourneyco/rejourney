import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sessions } from '../db/schema.js';
import { buildDeviceInfoSessionUpdate } from '../services/ingestEventArtifactProcessor.js';

/**
 * Device-info session write for events artifacts: only differing values are
 * written, the statement re-checks them in SQL, and nothing is sent when the
 * loaded row already matches.
 */

const builder = drizzle.mock();
const NOW = new Date('2026-11-27T12:00:00.000Z');

function render(plan: NonNullable<ReturnType<typeof buildDeviceInfoSessionUpdate>>) {
    return builder.update(sessions).set(plan.set as any).where(plan.where).toSQL();
}

const deviceInfo = {
    model: 'iPhone15,2',
    platform: 'ios',
    systemVersion: '17.4',
    appVersion: '1.2.3',
    sdkVersion: '1.5.1',
    networkType: 'wifi',
    deviceId: 'device-1',
};

const storedSession = {
    appVersion: '1.2.3',
    deviceModel: 'iPhone15,2',
    platform: 'ios',
    deviceId: 'device-1',
    osVersion: '17.4',
    sdkVersion: '1.5.1',
    metadata: {
        osVersion: '17.4',
        networkType: 'wifi',
        sdkVersion: '1.5.1',
        appVersion: '1.2.3',
        utm_source: 'kept',
    },
};

describe('buildDeviceInfoSessionUpdate', () => {
    it('returns null (no statement, updated_at untouched) when the stored row already matches', () => {
        expect(buildDeviceInfoSessionUpdate('session-1', storedSession, deviceInfo, NOW)).toBeNull();
        // Repeated artifacts carrying the same device info stay no-ops.
        expect(buildDeviceInfoSessionUpdate('session-1', storedSession, { ...deviceInfo }, NOW)).toBeNull();
    });

    it('returns null for device info that carries no session fields at all', () => {
        expect(buildDeviceInfoSessionUpdate(
            'session-1',
            { platform: 'ios', deviceId: 'device-1' },
            { screenWidth: 1080, screenHeight: 1920 },
            NOW,
        )).toBeNull();
    });

    it('writes only the column that differs and repeats the comparison in SQL', () => {
        const plan = buildDeviceInfoSessionUpdate('session-1', { ...storedSession, osVersion: '17.3' }, deviceInfo, NOW);

        expect(plan).not.toBeNull();
        expect(Object.keys(plan!.set).sort()).toEqual(['osVersion', 'updatedAt']);
        expect(render(plan!)).toEqual({
            sql: 'update "sessions" set "os_version" = $1, "updated_at" = $2 '
                + 'where ("sessions"."id" = $3 and "sessions"."os_version" is distinct from $4)',
            params: ['17.4', '2026-11-27T12:00:00.000Z', 'session-1', '17.4'],
        });
    });

    it('merges only the metadata keys that differ, guarded by containment', () => {
        const plan = buildDeviceInfoSessionUpdate(
            'session-1',
            { ...storedSession, metadata: { ...storedSession.metadata, networkType: 'cellular' } },
            deviceInfo,
            NOW,
        );

        expect(plan!.metadataPatch).toEqual({ networkType: 'wifi' });
        expect(render(plan!)).toEqual({
            sql: 'update "sessions" set "updated_at" = $1, "metadata" = "sessions"."metadata" || $2::jsonb '
                + 'where ("sessions"."id" = $3 and not ("sessions"."metadata" @> $4::jsonb))',
            params: ['2026-11-27T12:00:00.000Z', '{"networkType":"wifi"}', 'session-1', '{"networkType":"wifi"}'],
        });
    });

    it('combines column and metadata differences with OR so any real change writes the row', () => {
        const plan = buildDeviceInfoSessionUpdate(
            'session-1',
            { ...storedSession, appVersion: '1.2.2', deviceModel: null, metadata: { ...storedSession.metadata, appVersion: '1.2.2' } },
            deviceInfo,
            NOW,
        );

        expect(render(plan!)).toEqual({
            sql: 'update "sessions" set "app_version" = $1, "device_model" = $2, "updated_at" = $3, '
                + '"metadata" = "sessions"."metadata" || $4::jsonb '
                + 'where ("sessions"."id" = $5 and ("sessions"."app_version" is distinct from $6 '
                + 'or "sessions"."device_model" is distinct from $7 '
                + 'or not ("sessions"."metadata" @> $8::jsonb)))',
            params: [
                '1.2.3',
                'iPhone15,2',
                '2026-11-27T12:00:00.000Z',
                '{"appVersion":"1.2.3"}',
                'session-1',
                '1.2.3',
                'iPhone15,2',
                '{"appVersion":"1.2.3"}',
            ],
        });
    });

    it('sends the whole metadata patch when the caller did not load stored metadata', () => {
        const withoutMetadata: Record<string, unknown> = { ...storedSession };
        delete withoutMetadata.metadata;
        const plan = buildDeviceInfoSessionUpdate('session-1', withoutMetadata, deviceInfo, NOW);

        expect(plan!.metadataPatch).toEqual({
            osVersion: '17.4',
            networkType: 'wifi',
            sdkVersion: '1.5.1',
            appVersion: '1.2.3',
        });
        // Postgres decides: a stored object that already contains the patch matches zero rows.
        expect(render(plan!).sql).toBe(
            'update "sessions" set "updated_at" = $1, "metadata" = "sessions"."metadata" || $2::jsonb '
            + 'where ("sessions"."id" = $3 and not ("sessions"."metadata" @> $4::jsonb))',
        );
    });

    it('fills device id and sdk version only when the row has none, as before', () => {
        const plan = buildDeviceInfoSessionUpdate(
            'session-1',
            { ...storedSession, deviceId: null, sdkVersion: null },
            { ...deviceInfo, deviceId: undefined, vendorId: 'vendor-9' },
            NOW,
        );
        expect(plan!.set).toMatchObject({ deviceId: 'vendor-9', sdkVersion: '1.5.1' });

        const kept = buildDeviceInfoSessionUpdate(
            'session-1',
            storedSession,
            { ...deviceInfo, deviceId: 'other-device', sdkVersion: '9.9.9' },
            NOW,
        );
        // Stored device id and sdk version win; only the metadata copy of sdkVersion follows the payload.
        expect(kept!.set).not.toHaveProperty('deviceId');
        expect(kept!.set).not.toHaveProperty('sdkVersion');
        expect(kept!.metadataPatch).toEqual({ sdkVersion: '9.9.9' });
    });
});
