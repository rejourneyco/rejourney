import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { storageEndpoints } from '../src/db/schema.js';
import { safeEncrypt } from '../src/services/crypto.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function getLogPrefix(): string {
  return process.env.STORAGE_SYNC_LABEL || 'storage-sync';
}

async function main() {
  const endpointUrl = normalizeUrl(requireEnv('S3_ENDPOINT'));
  const bucket = requireEnv('S3_BUCKET');
  const region = process.env.S3_REGION || 'us-east-1';
  const accessKeyId = requireEnv('S3_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('S3_SECRET_ACCESS_KEY');
  const logPrefix = getLogPrefix();

  const keyRef = safeEncrypt(secretAccessKey);

  const endpointData = {
    endpointUrl,
    bucket,
    region,
    accessKeyId,
    keyRef,
    active: true,
    shadow: false,
  };

  const existing = await db
    .select({
      id: storageEndpoints.id,
      projectId: storageEndpoints.projectId,
    })
    .from(storageEndpoints)
    .where(eq(storageEndpoints.shadow, false));

  if (existing.length === 0) {
    await db.insert(storageEndpoints).values({
      projectId: null,
      priority: 0,
      ...endpointData,
    });

    console.log(
      `[${logPrefix}] Inserted global storage endpoint: ${endpointUrl} (${bucket})`,
    );
    return;
  }

  for (const row of existing) {
    await db
      .update(storageEndpoints)
      .set(endpointData)
      .where(eq(storageEndpoints.id, row.id));
  }

  const hasGlobal = existing.some((row) => row.projectId === null);
  if (!hasGlobal) {
    await db.insert(storageEndpoints).values({
      projectId: null,
      priority: 0,
      ...endpointData,
    });
  }

  const globalRows = await db
    .select({ id: storageEndpoints.id })
    .from(storageEndpoints)
    .where(and(isNull(storageEndpoints.projectId), eq(storageEndpoints.shadow, false)));

  console.log(
    `[${logPrefix}] Synced ${existing.length} storage endpoint row(s) to ${endpointUrl} (${bucket}); global rows=${globalRows.length}`,
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(`[${getLogPrefix()}] Failed to sync storage endpoints:`, error);
    process.exit(1);
  });
