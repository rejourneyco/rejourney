import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
    resolve(TEST_DIR, '../../drizzle/20260820210000_database_read_path_indexes/migration.sql'),
    'utf8',
);
const concurrentSql = readFileSync(
    resolve(TEST_DIR, '../../drizzle/manual/database-read-path-indexes-concurrent.sql'),
    'utf8',
);
const schemaSource = readFileSync(resolve(TEST_DIR, '../db/schema.ts'), 'utf8');

describe('database read-path indexes', () => {
    it('tracks the additive exporter index in the Drizzle schema and migration journal', () => {
        const indexName = 'retention_deletion_log_completed_finished_idx';
        expect(schemaSource).toContain(`index('${indexName}')`);
        expect(migrationSql).toContain(`CREATE INDEX IF NOT EXISTS "${indexName}"`);
        expect(concurrentSql).toContain(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${indexName}"`);
        expect(schemaSource).not.toContain("index('sessions_research_seed_due_idx')");
    });

    it('refuses blocking index builds on large relations when the expand step was skipped', () => {
        expect(migrationSql).toContain('pg_total_relation_size');
        expect(migrationSql).toContain('>= 1073741824');
        expect(migrationSql).toContain('run drizzle/manual/database-read-path-indexes-concurrent.sql');
        expect(migrationSql).toContain('NOT indisvalid OR NOT indisready');
        expect(migrationSql).toContain('RESET lock_timeout;');
        expect(migrationSql).toContain('RESET statement_timeout;');
    });

    it('uses bounded direct-writer concurrent builds with invalid-index preflight', () => {
        expect(concurrentSql).toContain('\\set ON_ERROR_STOP on');
        expect(concurrentSql).toContain("SET lock_timeout = '5s'");
        expect(concurrentSql).toContain("SET statement_timeout = '2h'");
        expect(concurrentSql).toContain('NOT indisvalid OR NOT indisready');
        expect(concurrentSql).toContain('indisvalid');
        expect(concurrentSql).toContain('indisready');
        expect(concurrentSql).toContain('RESET lock_timeout;');
        expect(concurrentSql).toContain('RESET statement_timeout;');
    });

    // Moved to the infra repo (__tests__/infraContract.test.ts) with the k8s manifests.
    it('tunes autovacuum thresholds without changing table columns or stored shapes', () => {
        expect(migrationSql).toContain('ALTER TABLE "retention_deletion_log" SET');
        expect(migrationSql).toContain('ALTER TABLE "research_extraction_jobs" SET');
        expect(migrationSql).toContain('autovacuum_vacuum_scale_factor = 0.02');
        expect(migrationSql).not.toContain('ADD COLUMN');
    });
});
