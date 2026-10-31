import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
    resolve(TEST_DIR, '../../drizzle/20261031210000_index_diet/migration.sql'),
    'utf8',
);
const manualSql = readFileSync(
    resolve(TEST_DIR, '../../drizzle/manual/20261031210000_index_diet.concurrent.sql'),
    'utf8',
);
const schemaSource = readFileSync(resolve(TEST_DIR, '../db/schema.ts'), 'utf8');

const DROPPED = [
    'recording_artifacts_created_status_endpoint_idx',
    'recording_artifacts_session_id_idx',
    'recording_artifacts_session_ready_endpoint_idx',
    'recording_artifacts_failed_abandoned_idx',
    'sessions_reconciliation_activity_idx',
    'sessions_status_ended_at_id_idx',
    'sessions_retention_eligible_idx',
    'sessions_project_started_idx',
    'sessions_events_idx',
    'research_extraction_jobs_claim_idx',
    'retention_deletion_log_run_id_idx',
];

const REPLACEMENTS = [
    'recording_artifacts_created_at_idx',
    'recording_artifacts_kind_ready_covering_idx',
    'sessions_events_path_idx',
];

function statements(sqlText: string): string[] {
    return sqlText
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
}

describe('index diet', () => {
    it('removes dropped indexes from the Drizzle schema and models the replacements', () => {
        for (const name of DROPPED) {
            expect(schemaSource).not.toContain(`index('${name}')`);
        }
        for (const name of REPLACEMENTS) {
            expect(schemaSource).toContain(`index('${name}')`);
        }
        expect(schemaSource).toContain("using('gin', table.events.op('jsonb_path_ops'))");
        // Kept: other filters use non-'pending' smart capture values.
        expect(schemaSource).toContain("index('sessions_smart_capture_status_started_idx')");
        // Kept: only project_id-leading index serving the projects ON DELETE CASCADE.
        expect(schemaSource).toContain("index('research_capture_decisions_project_tier_idx')");
        // No session index may cover the ingest activity columns, or updates stop being HOT.
        expect(schemaSource).not.toMatch(/\.on\([^)]*table\.lastIngestActivityAt/);
    });

    it('is a guarded no-op on databases that already ran the manual step', () => {
        // drizzle-kit migrate runs inside a transaction: no concurrent DDL statements.
        expect(migrationSql).not.toMatch(/^\s*(CREATE|DROP|REINDEX)\b[^;\n]*CONCURRENTLY/im);
        expect(migrationSql).not.toMatch(/'(CREATE|DROP)[^']*CONCURRENTLY/i);
        expect(migrationSql).toContain("SET lock_timeout = '5s'");
        expect(migrationSql).toContain('RESET lock_timeout;');
        expect(migrationSql).toContain('RESET statement_timeout;');
        expect(migrationSql).toContain('>= 1073741824');
        expect(migrationSql).toContain('NOT indisvalid OR NOT indisready');
        expect(migrationSql).toContain("'fillfactor=85' = ANY");
        for (const name of DROPPED) {
            expect(migrationSql).toContain(`DROP INDEX IF EXISTS "${name}";`);
        }
        for (const name of REPLACEMENTS) {
            expect(migrationSql).toContain(`CREATE INDEX IF NOT EXISTS "${name}"`);
        }
        expect(migrationSql).toContain('USING gin ("events" jsonb_path_ops)');
        expect(migrationSql).toContain('INCLUDE ("size_bytes", "endpoint_id")');
    });

    it('builds every replacement before dropping anything it replaces', () => {
        for (const sqlText of [migrationSql, manualSql]) {
            const firstDrop = sqlText.search(/^DROP INDEX (CONCURRENTLY )?IF EXISTS/m);
            expect(firstDrop).toBeGreaterThan(0);
            for (const name of REPLACEMENTS) {
                const create = sqlText.indexOf(`IF NOT EXISTS ${sqlText === migrationSql ? `"${name}"` : name}`);
                expect(create).toBeGreaterThan(0);
                expect(create).toBeLessThan(firstDrop);
            }
        }
    });

    it('runs the production step online, statement by statement, with invalid-index recovery', () => {
        expect(manualSql).toContain('\\set ON_ERROR_STOP on');
        expect(manualSql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
        for (const name of REPLACEMENTS) {
            expect(manualSql).toContain(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name}`);
            expect(manualSql).toContain(`'DROP INDEX CONCURRENTLY public.${name};'`);
        }
        for (const name of DROPPED) {
            expect(manualSql).toContain(`DROP INDEX CONCURRENTLY IF EXISTS public.${name};`);
        }
        expect(manualSql).toContain('USING gin (events jsonb_path_ops)');
        expect(manualSql).toContain('ALTER TABLE public.sessions SET (fillfactor = 85);');
        expect(manualSql).toContain("format('REINDEX INDEX CONCURRENTLY %s;'");
        expect(manualSql).toContain('_cc(new|old)');
        // Every non-meta statement drops/creates/reindexes online or is read-only/session-local.
        for (const statement of statements(manualSql)) {
            if (/^(DROP|CREATE) INDEX/i.test(statement)) {
                expect(statement).toMatch(/^(DROP|CREATE) INDEX CONCURRENTLY/i);
            }
            expect(statement).not.toMatch(/^REINDEX (TABLE|INDEX) (?!CONCURRENTLY)/i);
        }
    });
});
