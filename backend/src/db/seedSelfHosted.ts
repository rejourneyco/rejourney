/**
 * Self-Hosted Database Seed Script
 * 
 * Optimized for self-hosted deployments:
 * - Generous retention policy (10 years / effectively unlimited)
 * - Default storage endpoint from environment variables
 * 
 * NOTE: Billing is disabled in self-hosted mode. Session limits are effectively unlimited.
 * 
 * Run with: npm run db:seed:selfhosted
 */

import { eq, and, isNull } from 'drizzle-orm';
import {
    db,
    retentionPolicies,
    storageEndpoints,
} from './client.js';
import { safeEncrypt } from '../services/crypto.js';

async function main() {
    console.log('🌱 Seeding database for self-hosted deployment...');
    console.log('');

    // =========================================================================
    // Self-Hosted Retention Policy
    // =========================================================================
    // Single generous retention - you own the storage, keep data as long as you want
    // 3650 days = ~10 years = effectively unlimited
    const retentionPolicyData = [
        { tier: 1, days: 3650 },  // Default: ~10 years (effectively unlimited)
        { tier: 2, days: 3650 },  // All tiers get the same generous retention
        { tier: 3, days: 3650 },
        { tier: 4, days: 3650 },
        { tier: 5, days: 3650 },
    ];

    for (const policy of retentionPolicyData) {
        const [existing] = await db
            .select()
            .from(retentionPolicies)
            .where(eq(retentionPolicies.tier, policy.tier))
            .limit(1);

        if (existing) {
            await db.update(retentionPolicies)
                .set({ retentionDays: policy.days })
                .where(eq(retentionPolicies.tier, policy.tier));
        } else {
            await db.insert(retentionPolicies).values({
                tier: policy.tier,
                retentionDays: policy.days,
            });
        }
    }
    console.log('✅ Retention policies created');
    console.log('   All tiers: 10 years (effectively unlimited)');

    // =========================================================================
    // Storage Endpoint
    // =========================================================================
    const s3Endpoint = process.env.S3_ENDPOINT;
    const s3Bucket = process.env.S3_BUCKET;
    const s3Region = process.env.S3_REGION || 'us-east-1';
    const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
    const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (s3Endpoint && s3Bucket) {
        const [existingGlobal] = await db
            .select()
            .from(storageEndpoints)
            .where(and(
                isNull(storageEndpoints.projectId),
                eq(storageEndpoints.active, true),
                eq(storageEndpoints.shadow, false)
            ))
            .limit(1);

        // Encrypt secret if provided and encryption key is configured
        const encryptedKeyRef = s3SecretAccessKey 
            ? safeEncrypt(s3SecretAccessKey) 
            : null;

        const endpointData = {
            endpointUrl: s3Endpoint,
            bucket: s3Bucket,
            region: s3Region,
            accessKeyId: s3AccessKeyId || null,
            keyRef: encryptedKeyRef,
            priority: 0,
            active: true,
            shadow: false,
        };

        if (!existingGlobal) {
            await db.insert(storageEndpoints).values({
                projectId: null,
                ...endpointData,
            });
            console.log('✅ Storage endpoint configured');
        } else {
            await db.update(storageEndpoints)
                .set(endpointData)
                .where(eq(storageEndpoints.id, existingGlobal.id));
            console.log('✅ Storage endpoint updated');
        }
        console.log(`   Endpoint: ${s3Endpoint}`);
        console.log(`   Bucket: ${s3Bucket}`);
        if (s3AccessKeyId) {
            console.log(`   Access Key ID: ${s3AccessKeyId}`);
        }
        if (encryptedKeyRef) {
            console.log(`   Secret Key: ${encryptedKeyRef ? '✓ Encrypted and stored' : '⚠ Not provided'}`);
        } else if (s3SecretAccessKey) {
            console.log(`   Secret Key: ⚠ Stored as plaintext (STORAGE_ENCRYPTION_KEY not set)`);
        }
    } else {
        console.log('');
        console.log('⚠️  S3_ENDPOINT and/or S3_BUCKET not set!');
        console.log('   Session recordings will not work without storage configured.');
        console.log('   Set these environment variables and re-run seed.');
    }

    console.log('');
    console.log('🎉 Self-hosted seed complete!');
    console.log('');
    console.log('Summary:');
    console.log('  • Billing: Disabled (self-hosted mode - unlimited sessions)');
    console.log('  • Retention: 10 years (you control your storage)');
    console.log('  • Storage: ' + (s3Endpoint ? 'Configured ✓' : 'Not configured ✗'));
    console.log('');
}

main()
    .catch((e) => {
        console.error('❌ Seeding failed:', e);
        process.exit(1);
    })
    .finally(() => {
        process.exit(0);
    });
