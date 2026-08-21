import { pool } from '../db/client.js';
import { getRedis } from '../db/redis.js';

export async function checkUploadDependencies(): Promise<void> {
    // pool.query manages checkout/release internally, including every failure
    // path. The former explicit connect/query/release sequence leaked a client
    // whenever SELECT 1 threw.
    await pool.query('SELECT 1');
    await getRedis().ping();
}
