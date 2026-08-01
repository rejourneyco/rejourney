import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { storageEndpoints } from '../src/db/schema.js';
import { safeEncrypt } from '../src/services/crypto.js';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

async function main() {
  if (process.env.STORAGE_SYNC_LABEL !== 'selfhosted-bootstrap') {
    throw new Error('Refusing storage sync outside the self-hosted bootstrap');
  }

  const endpoints = await db
    .select({ id: storageEndpoints.id })
    .from(storageEndpoints)
    .where(and(isNull(storageEndpoints.projectId), eq(storageEndpoints.shadow, false)));

  if (endpoints.length !== 1) {
    throw new Error(
      `Expected exactly one global, non-shadow storage endpoint; found ${endpoints.length}. ` +
      'Advanced multi-endpoint storage is operator-managed and will not be overwritten.',
    );
  }

  const endpointUrl = normalizeUrl(requireEnv('S3_ENDPOINT'));
  const bucket = requireEnv('S3_BUCKET');
  const region = process.env.S3_REGION?.trim() || 'us-east-1';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim() || null;
  const keyRef = safeEncrypt(requireEnv('S3_SECRET_ACCESS_KEY'));

  await db
    .update(storageEndpoints)
    .set({
      endpointUrl,
      bucket,
      region,
      accessKeyId,
      keyRef,
      priority: 0,
      active: true,
    })
    .where(eq(storageEndpoints.id, endpoints[0].id));

  console.log(`Self-hosted storage endpoint synced: ${endpointUrl} (${bucket})`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Self-hosted storage endpoint sync failed:', error);
    process.exit(1);
  });
