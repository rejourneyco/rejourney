/**
 * Single entry point for K8s, local-k8s, and self-hosted Compose bootstrap.
 *
 * - **Existing Drizzle history** (`drizzle.__drizzle_migrations` has rows): run
 *   `drizzle-kit migrate` only — applies unapplied migration folders; never `push`.
 * - **Brand-new database** (no public tables, empty journal): `drizzle-kit push --force`
 *   from `schema.ts`, then **stamp** every current `drizzle` folder `migration.sql` into
 *   `drizzle.__drizzle_migrations` with the same `hash` and `created_at` Drizzle
 *   uses internally, so later deploys only run **new** migrations.
 * - **Orphan** (public tables exist but journal empty): **abort** by default — often a
 *   restore or wrong DATABASE_URL. Override only with explicit env (see below).
 *
 * Hash/timestamp rules match `drizzle-orm/migrator.js` `readMigrationFiles`.
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';

function formatToMillis(dateStr: string): number {
    const year = parseInt(dateStr.slice(0, 4), 10);
    const month = parseInt(dateStr.slice(4, 6), 10) - 1;
    const day = parseInt(dateStr.slice(6, 8), 10);
    const hour = parseInt(dateStr.slice(8, 10), 10);
    const minute = parseInt(dateStr.slice(10, 12), 10);
    const second = parseInt(dateStr.slice(12, 14), 10);
    return Date.UTC(year, month, day, hour, minute, second);
}

type MigrationMeta = {
    folder: string;
    hash: string;
    folderMillis: number;
};

/**
 * Same discovery + hashing as drizzle-orm `readMigrationFiles` (folder migrations, no meta/_journal.json).
 */
function listMigrationMeta(migrationsFolder: string): MigrationMeta[] {
    if (existsSync(join(migrationsFolder, 'meta', '_journal.json'))) {
        throw new Error(
            'Legacy meta/_journal.json migrations are not supported by applyDatabaseSchema; run drizzle-kit up or migrate folders.',
        );
    }

    const entries = readdirSync(migrationsFolder, { withFileTypes: true });
    const metas: MigrationMeta[] = [];

    for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const folder = ent.name;
        const sqlPath = join(migrationsFolder, folder, 'migration.sql');
        if (!existsSync(sqlPath)) continue;

        const migrationDate = folder.slice(0, 14);
        if (!/^\d{14}$/.test(migrationDate)) {
            throw new Error(`Invalid migration folder name (expected timestamp prefix): ${folder}`);
        }

        const query = readFileSync(sqlPath, 'utf8');
        const hash = createHash('sha256').update(query).digest('hex');
        const folderMillis = formatToMillis(migrationDate);
        metas.push({ folder, hash, folderMillis });
    }

    metas.sort((a, b) => a.folder.localeCompare(b.folder));
    return metas;
}

function isTruthyEnv(name: string): boolean {
    const v = process.env[name];
    if (v === undefined || v === '') return false;
    return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

async function countPublicBaseTables(pool: pg.Pool): Promise<number> {
    const result = await pool.query(`
        select count(*)::int as n
        from information_schema.tables
        where table_schema = 'public'
          and table_type = 'BASE TABLE'
    `);
    return result.rows[0]?.n ?? 0;
}

async function migrationJournalRowCount(pool: pg.Pool): Promise<number | null> {
    try {
        const result = await pool.query(
            `select count(*)::int as n from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
        );
        return result.rows[0]?.n ?? 0;
    } catch {
        return null;
    }
}

function runDrizzleMigrate(): void {
    execSync('./node_modules/.bin/drizzle-kit migrate', {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: process.env,
    });
}

function runDrizzlePushForce(): void {
    execSync('./node_modules/.bin/drizzle-kit push --force', {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: process.env,
    });
}

async function stampAllMigrations(pool: pg.Pool, metas: MigrationMeta[]): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${MIGRATIONS_SCHEMA}`);
        await client.query(`
            CREATE TABLE IF NOT EXISTS ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (
                id SERIAL PRIMARY KEY,
                hash text NOT NULL,
                created_at bigint
            )
        `);

        for (const m of metas) {
            await client.query(
                `INSERT INTO ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} ("hash", "created_at") VALUES ($1, $2)`,
                [m.hash, m.folderMillis],
            );
        }
        await client.query('COMMIT');
        console.log(`Stamped ${metas.length} migration(s) into ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`);
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function main(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('DATABASE_URL is required');
    }

    const migrationsFolder = join(process.cwd(), 'drizzle');
    if (!existsSync(migrationsFolder)) {
        throw new Error(`Migrations folder missing: ${migrationsFolder}`);
    }

    const metas = listMigrationMeta(migrationsFolder);
    if (metas.length === 0) {
        throw new Error(`No migrations found under ${migrationsFolder}`);
    }

    const pool = new pg.Pool({ connectionString: databaseUrl });
    try {
        const publicTables = await countPublicBaseTables(pool);
        const journalCount = await migrationJournalRowCount(pool);

        if (journalCount !== null && journalCount > 0) {
            console.log(
                `Found ${journalCount} row(s) in ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}; running drizzle-kit migrate (unapplied only).`,
            );
            runDrizzleMigrate();
            return;
        }

        if (publicTables > 0) {
            const allowOrphan = isTruthyEnv('REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY');
            console.error(
                `Refusing automatic schema setup: public schema has ${publicTables} base table(s) but ` +
                    `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} is missing or empty. ` +
                    `This usually means a restore, wrong DATABASE_URL, or a non-Drizzle database. ` +
                    `Fix the journal or use an empty database. ` +
                    `If you intentionally need migrate-only against this DB (advanced), set REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1.`,
            );
            if (!allowOrphan) {
                process.exit(1);
            }
            console.warn(
                'REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1: running drizzle-kit migrate only (no push, no stamp).',
            );
            runDrizzleMigrate();
            return;
        }

        console.log(
            'Empty database and empty migration journal: drizzle-kit push --force, then stamp current migration files.',
        );
        runDrizzlePushForce();

        const postPushJournal = await migrationJournalRowCount(pool);
        if (postPushJournal !== null && postPushJournal > 0) {
            throw new Error(
                `After push, expected empty ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}, found ${postPushJournal} row(s). ` +
                    `Refusing to stamp to avoid duplicate migration state.`,
            );
        }

        await stampAllMigrations(pool, metas);
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error('applyDatabaseSchema failed:', error);
    process.exit(1);
});
