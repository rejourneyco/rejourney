import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { retentionPolicies, storageEndpoints } from '../src/db/schema.js';
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

async function main() {
  console.log('Bootstrapping production-safe system data...');

  await db.execute(sql`SELECT 1`);

  const retentionPolicyData = [
    { tier: 1, days: 7 },
    { tier: 2, days: 14 },
    { tier: 3, days: 30 },
    { tier: 4, days: 60 },
    { tier: 5, days: 3650 },
    { tier: 6, days: 36500 },
  ];

  for (const policy of retentionPolicyData) {
    const [existing] = await db
      .select()
      .from(retentionPolicies)
      .where(eq(retentionPolicies.tier, policy.tier))
      .limit(1);

    if (existing) {
      await db
        .update(retentionPolicies)
        .set({ retentionDays: policy.days })
        .where(eq(retentionPolicies.tier, policy.tier));
    } else {
      await db
        .insert(retentionPolicies)
        .values({
          tier: policy.tier,
          retentionDays: policy.days,
        })
        .onConflictDoNothing();
    }
  }

  console.log('Retention policies bootstrapped');

  const endpointUrl = normalizeUrl(requireEnv('S3_ENDPOINT'));
  const bucket = requireEnv('S3_BUCKET');
  const region = process.env.S3_REGION || 'us-east-1';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || null;
  const secretAccessKey = requireEnv('S3_SECRET_ACCESS_KEY');
  const keyRef = safeEncrypt(secretAccessKey);

  const endpointData = {
    endpointUrl,
    bucket,
    region,
    accessKeyId,
    keyRef,
    priority: 0,
    active: true,
    shadow: false,
  };

  const existing = await db
    .select({
      id: storageEndpoints.id,
      projectId: storageEndpoints.projectId,
    })
    .from(storageEndpoints)
    .where(and(isNull(storageEndpoints.projectId), eq(storageEndpoints.shadow, false)));

  if (existing.length === 0) {
    await db.insert(storageEndpoints).values({
      projectId: null,
      ...endpointData,
    });
    console.log(`Inserted global storage endpoint: ${endpointUrl} (${bucket})`);
    return;
  }

  for (const row of existing) {
    await db
      .update(storageEndpoints)
      .set(endpointData)
      .where(eq(storageEndpoints.id, row.id));
  }

  console.log(`Updated ${existing.length} global storage endpoint row(s)`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('System bootstrap failed:', error);
    process.exit(1);
  });
