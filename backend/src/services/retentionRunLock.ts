import os from 'os';
import { pool } from '../db/client.js';

const DEFAULT_STALE_SECONDS = 15 * 60;
export const RETENTION_RUN_LOCK_NAME = 'retention-worker';

export function buildRetentionRunOwnerId(): string {
    return `retention:${os.hostname()}:${process.pid}:${Date.now()}`;
}

export async function tryAcquireRetentionRunLock(
    ownerId: string,
    staleSeconds = DEFAULT_STALE_SECONDS,
): Promise<boolean> {
    const result = await pool.query<{ owner_id: string }>(
        `
        WITH lock_row AS (
          INSERT INTO retention_run_lock (lock_name, owner_id, acquired_at, heartbeat_at)
          VALUES ($1, $2, NOW(), NOW())
          ON CONFLICT (lock_name) DO UPDATE
          SET owner_id = EXCLUDED.owner_id,
              acquired_at = NOW(),
              heartbeat_at = NOW()
          WHERE retention_run_lock.owner_id = EXCLUDED.owner_id
             OR retention_run_lock.heartbeat_at < NOW() - ($3 * INTERVAL '1 second')
          RETURNING owner_id
        )
        SELECT owner_id FROM lock_row
        `,
        [RETENTION_RUN_LOCK_NAME, ownerId, staleSeconds],
    );

    return result.rows[0]?.owner_id === ownerId;
}

export async function refreshRetentionRunLock(ownerId: string): Promise<void> {
    const result = await pool.query<{ owner_id: string }>(
        `
        UPDATE retention_run_lock
        SET heartbeat_at = NOW()
        WHERE lock_name = $1
          AND owner_id = $2
        RETURNING owner_id
        `,
        [RETENTION_RUN_LOCK_NAME, ownerId],
    );

    if (result.rows[0]?.owner_id !== ownerId) {
        throw new Error('Retention run lock lost');
    }
}

export async function releaseRetentionRunLock(ownerId: string): Promise<void> {
    await pool.query(
        `
        DELETE FROM retention_run_lock
        WHERE lock_name = $1
          AND owner_id = $2
        `,
        [RETENTION_RUN_LOCK_NAME, ownerId],
    );
}
