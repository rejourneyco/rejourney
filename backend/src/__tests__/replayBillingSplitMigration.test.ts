import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
    resolve(__dirname, '../../drizzle/20260601130000_replay_usage_split/migration.sql'),
    'utf8'
);

describe('replay billing split migration', () => {
    it('adds replay usage columns and the replay quota counted marker', () => {
        expect(migrationSql).toContain('ALTER TABLE "project_usage"');
        expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "session_replays" integer DEFAULT 0 NOT NULL');
        expect(migrationSql).toContain('ALTER TABLE "billing_usage"');
        expect(migrationSql).toContain('ALTER TABLE "sessions"');
        expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "replay_quota_counted_at" timestamp');
    });

    it('preserves existing session usage into replay usage without lowering usage', () => {
        expect(migrationSql).toMatch(/UPDATE "project_usage"\s+SET "session_replays" = "sessions"\s+WHERE "session_replays" = 0\s+AND "sessions" <> 0;/);
        expect(migrationSql).toMatch(/UPDATE "billing_usage"\s+SET "session_replays" = "sessions"\s+WHERE "session_replays" = 0\s+AND "sessions" <> 0;/);
    });

    it('marks pre-migration sessions counted so future reconciliation cannot double count them', () => {
        expect(migrationSql).toContain('SET "replay_quota_counted_at" = COALESCE("updated_at", "created_at", "started_at", NOW())');
        expect(migrationSql).toContain('WHERE "replay_quota_counted_at" IS NULL');
    });

    it('adds keyed warning dedupe without requiring historical duplicates to be deleted', () => {
        expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "dedupe_key" text');
        expect(migrationSql).toContain("AND \"type\" IN ('warning_80', 'limit_100')");
        expect(migrationSql).toContain('ROW_NUMBER() OVER');
        expect(migrationSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "billing_notifications_dedupe_key_unique"');
    });
});
