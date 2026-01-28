/**
 * Database Seed Script
 * 
 * Seeds essential data for both production and development:
 * 
 * Production seeds (always run):
 * - Default retention policies (5 tiers: 7, 30, 90, 365, 3650 days)
 * - Default storage endpoint from environment variables
 * 
 * Development seeds (NODE_ENV !== 'production'):
 * - Test user with email test@example.com
 * - Test team with quota
 * - Test project with API key
 * - Default alert settings for test project
 * - Alert recipient (test user)
 * 
 * NOTE: Billing plans are now managed via Stripe Products/Prices.
 * Configure your plans in the Stripe Dashboard.
 */

import { createHash, randomBytes, randomUUID } from 'crypto';
import { eq, isNull, and, sql } from 'drizzle-orm';
import {
    db,
    users,
    teams,
    teamMembers,
    projects,
    apiKeys,
    retentionPolicies,
    storageEndpoints,
    alertSettings,
    alertRecipients,
} from './client.js';
import { safeEncrypt } from '../services/crypto.js';

const isDev = process.env.NODE_ENV !== 'production';

async function main() {
    console.log('🌱 Seeding database...');

    // Verify connection
    try {
        await db.execute(sql`SELECT 1`);
        console.log('✅ Database connection verified');
    } catch (e) {
        console.error('❌ Database connection failed immediately:', e);
        throw e;
    }

    // =========================================================================
    // Retention Policies (Production-safe)
    // =========================================================================
    // Tier-based retention for session data cleanup
    const retentionPolicyData = [
        { tier: 1, days: 7 },    // Basic: 1 week retention
        { tier: 2, days: 30 },   // Standard: 1 month retention
        { tier: 3, days: 90 },   // Professional: 3 months retention
        { tier: 4, days: 365 },  // Enterprise: 1 year retention
        { tier: 5, days: 3650 }, // Unlimited: ~10 years (effectively unlimited)
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
    console.log('✅ Retention policies seeded');

    // =========================================================================
    // Storage Endpoint (Production-safe)
    // =========================================================================
    // Default S3-compatible storage endpoint from environment variables
    const s3Endpoint = process.env.S3_ENDPOINT;
    const s3Bucket = process.env.S3_BUCKET;
    const s3Region = process.env.S3_REGION || 'us-east-1';
    const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
    const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (s3Endpoint && s3Bucket) {
        // Check if a global default endpoint exists (projectId = null)
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
                projectId: null, // Global default
                ...endpointData,
            });
            console.log('✅ Default storage endpoint seeded');
            console.log(`   Endpoint: ${s3Endpoint}`);
            console.log(`   Bucket: ${s3Bucket}`);
        } else {
            // Update existing if env vars changed
            await db.update(storageEndpoints)
                .set(endpointData)
                .where(eq(storageEndpoints.id, existingGlobal.id));
            console.log('✅ Default storage endpoint updated');
        }
        if (s3AccessKeyId) {
            console.log(`   Access Key ID: ${s3AccessKeyId}`);
        }
        if (encryptedKeyRef) {
            console.log(`   Secret Key: ✓ Encrypted and stored`);
        } else if (s3SecretAccessKey) {
            console.log(`   Secret Key: ⚠ Stored as plaintext (STORAGE_ENCRYPTION_KEY not set)`);
        }
    } else {
        console.log('⚠️ S3_ENDPOINT/S3_BUCKET not set, skipping storage endpoint seed');
    }

    // Note: Billing plans are now managed via Stripe Products/Prices
    console.log('ℹ️ Billing plans are managed via Stripe Dashboard');

    // =========================================================================
    // Development-only Seeds
    // =========================================================================
    // Create test user/team/project for local development
    if (isDev) {
        const testEmail = 'test@example.com';

        let [testUser] = await db
            .select()
            .from(users)
            .where(eq(users.email, testEmail))
            .limit(1);

        if (!testUser) {
            [testUser] = await db.insert(users).values({
                email: testEmail,
                displayName: 'Test User',
                authProvider: 'otp',
            }).returning();

            // Create default team (no billingPlanId - starts on free tier)
            const [team] = await db.insert(teams).values({
                ownerUserId: testUser.id,
                name: 'Test Team',
            }).returning();

            // Add user as team owner
            await db.insert(teamMembers).values({
                teamId: team.id,
                userId: testUser.id,
                role: 'owner',
            });

            // Note: Quota table removed. Session limits are handled by Stripe or defaults.


            // Create a test project
            const [project] = await db.insert(projects).values({
                teamId: team.id,
                name: 'Test App',
                platform: 'ios',
                bundleId: 'com.example.testapp',
                publicKey: randomUUID(),
                rejourneyEnabled: true,
                recordingEnabled: true,
                sampleRate: 100,
                maxRecordingMinutes: 10,
            }).returning();

            // Create an API key for the project
            const apiKeyValue = `rj_test_${randomBytes(24).toString('hex')}`;
            const hashedKey = createHash('sha256').update(apiKeyValue).digest('hex');

            await db.insert(apiKeys).values({
                projectId: project.id,
                hashedKey,
                maskedKey: `rj_...${apiKeyValue.slice(-8)}`,
                name: 'Development Key',
                scopes: ['ingest'],
            });

            // Create default alert settings for the project
            await db.insert(alertSettings).values({
                projectId: project.id,
                crashAlertsEnabled: true,
                anrAlertsEnabled: true,
                errorSpikeAlertsEnabled: true,
                apiDegradationAlertsEnabled: true,
                errorSpikeThresholdPercent: 50, // 50% increase triggers alert
                apiDegradationThresholdPercent: 100, // 2x latency triggers alert
                apiLatencyThresholdMs: 3000, // 3 second threshold
            });

            // Add test user as alert recipient
            await db.insert(alertRecipients).values({
                projectId: project.id,
                userId: testUser.id,
            });

            console.log('✅ Test user, team, project, and alert settings created');
            console.log(`   Email: ${testEmail}`);
            console.log(`   API Key: ${apiKeyValue}`);
            console.log('   (Send OTP to login or use the API key for ingest)');
        } else {
            // Ensure existing test user has alert settings for their projects
            console.log('ℹ️ Test user already exists, checking for missing alert settings...');

            // Get test user's projects
            const testUserTeams = await db
                .select({ teamId: teamMembers.teamId })
                .from(teamMembers)
                .where(eq(teamMembers.userId, testUser.id));

            for (const { teamId } of testUserTeams) {
                const teamProjects = await db
                    .select({ id: projects.id, name: projects.name })
                    .from(projects)
                    .where(eq(projects.teamId, teamId));

                for (const project of teamProjects) {
                    // Check if alert settings exist
                    const [existingSettings] = await db
                        .select()
                        .from(alertSettings)
                        .where(eq(alertSettings.projectId, project.id))
                        .limit(1);

                    if (!existingSettings) {
                        await db.insert(alertSettings).values({
                            projectId: project.id,
                            crashAlertsEnabled: true,
                            anrAlertsEnabled: true,
                            errorSpikeAlertsEnabled: true,
                            apiDegradationAlertsEnabled: true,
                            errorSpikeThresholdPercent: 50,
                            apiDegradationThresholdPercent: 100,
                            apiLatencyThresholdMs: 3000,
                        });
                        console.log(`   ✅ Created alert settings for project: ${project.name}`);
                    }

                    // Check if test user is an alert recipient
                    const [existingRecipient] = await db
                        .select()
                        .from(alertRecipients)
                        .where(and(
                            eq(alertRecipients.projectId, project.id),
                            eq(alertRecipients.userId, testUser.id)
                        ))
                        .limit(1);

                    if (!existingRecipient) {
                        await db.insert(alertRecipients).values({
                            projectId: project.id,
                            userId: testUser.id,
                        });
                        console.log(`   ✅ Added test user as alert recipient for: ${project.name}`);
                    }
                }
            }
        }
    }

    console.log('🎉 Seeding complete!');
}

main()
    .catch((e) => {
        console.error('❌ Seeding failed:', e);
        process.exit(1);
    })
    .finally(() => {
        // Pool cleanup is handled by client.ts beforeExit handler
        process.exit(0);
    });
