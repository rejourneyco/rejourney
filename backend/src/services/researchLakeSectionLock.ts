/**
 * Mutual exclusion for research-lake cycle sections that must run once per tick
 * when several worker pods share a tick.
 *
 * The lock is a transaction-scoped Postgres advisory lock held on a dedicated
 * client for the duration of the section. PgBouncer runs in transaction mode,
 * so session-level advisory locks would not survive; xact-level locks inside an
 * explicit BEGIN do. The section's own queries go through the normal pool; the
 * locked client is only the mutex.
 *
 * 'skip' returns immediately when another pod holds the section. 'wait' blocks
 * until that pod commits, then still reports skipped: the caller re-reads the
 * state the sibling just produced (a fresh seed, for example) instead of
 * repeating the work.
 */
import { pool } from '../db/client.js';
import { logger } from '../logger.js';

export type SectionLockMode = 'skip' | 'wait';

export type SectionLockResult<T> = { skipped: true } | { skipped: false; result: T };

export async function withResearchLakeSectionLock<T>(
    key: string,
    mode: SectionLockMode,
    fn: () => Promise<T>,
): Promise<SectionLockResult<T>> {
    const client = await pool.connect();
    let inTransaction = false;
    try {
        await client.query('BEGIN');
        inTransaction = true;
        const attempt = await client.query<{ acquired: boolean }>(
            'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
            [key],
        );
        const acquired = attempt.rows[0]?.acquired === true;
        if (!acquired) {
            if (mode === 'wait') {
                await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
            }
            logger.info({ key, mode }, 'Research lake section held by another worker; skipped');
            return { skipped: true };
        }
        const result = await fn();
        return { skipped: false, result };
    } finally {
        if (inTransaction) {
            await client.query('ROLLBACK').catch(() => undefined);
        }
        client.release();
    }
}
