import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(testDir, '../..');

function migration(name: string): string {
    return readFileSync(resolve(backendRoot, 'drizzle', name, 'migration.sql'), 'utf8');
}

describe('SDK-next migration compatibility', () => {
    it('keeps the previously shipped mobile metrics migration additive and repeatable', () => {
        const sql = migration('20260827120000_mobile_capture_quality_metrics');

        for (const column of [
            'frames_captured',
            'frames_skipped_duplicate',
            'frames_skipped_throttle',
            'frames_skipped_backlog',
            'frames_skipped_map_moving',
            'battery_level_start_percent',
            'battery_level_end_percent',
            'thermal_state_start',
            'memory_pressure_peak',
            'display_max_refresh_rate_hz',
        ]) {
            expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "${column}"`);
        }
        expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i);
    });

    it('keeps pause state additive for fresh installs without relocking infra-prepared tables', () => {
        const sql = migration('20260828150000_sdk_pause_state');

        for (const column of ['sdk_paused_at', 'sdk_pause_id', 'sdk_pause_state_updated_at']) {
            expect(sql).toContain(`column_name = '${column}'`);
            expect(sql).toContain(`ADD COLUMN "${column}"`);
        }
        expect(sql).toContain("to_regclass('public.sessions_sdk_paused_started_idx') IS NULL");
        expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i);
    });

    it('defaults legacy capture health to unreported and skips redundant production DDL', () => {
        const sql = migration('20260828180000_capture_health_presence');

        expect(sql).toContain("column_name = 'capture_health_reported'");
        expect(sql).toContain('ADD COLUMN "capture_health_reported" boolean NOT NULL DEFAULT false');
        expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i);
    });
});
