import { pathToFileURL } from 'node:url';
import { createClient } from '@clickhouse/client';
import { BACKUP_ARCHIVE_SUFFIX, backupGroupFromKey, backupStartedAtFromId, trimSlashes } from '../src/services/clickhouseBackupNames.js';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client, type _Object } from '@aws-sdk/client-s3';

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`${name} is required`);
    }
    return value;
}

function optionalEnv(name: string, fallback: string): string {
    return process.env[name]?.trim() || fallback;
}

function quoteClickHouseString(value: string): string {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function quoteIdentifier(value: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        throw new Error(`Invalid ClickHouse identifier: ${value}`);
    }
    return `\`${value}\``;
}

function optionalPositiveIntegerEnv(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${name} must be a non-negative integer`);
    }
    return parsed;
}

function buildBackupId(): string {
    const explicit = process.env.CLICKHOUSE_BACKUP_ID?.trim();
    if (explicit) {
        if (!/^[A-Za-z0-9._=-]+$/.test(explicit)) {
            throw new Error('CLICKHOUSE_BACKUP_ID may only contain letters, numbers, dot, underscore, equals, or dash');
        }
        return explicit;
    }

    return `rejourney-${new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z')}`;
}

async function deleteObjectBatch(s3: S3Client, bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
            Objects: keys.map((Key) => ({ Key })),
            Quiet: true,
        },
    }));
}

async function cleanupExpiredBackups(params: {
    endpoint: string;
    bucket: string;
    prefix: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    retentionDays: number;
    keepBackupId: string;
}): Promise<{ expiredBackups: number; deletedObjects: number; deletedBytes: number }> {
    if (params.retentionDays === 0) {
        return { expiredBackups: 0, deletedObjects: 0, deletedBytes: 0 };
    }

    const cutoff = Date.now() - (params.retentionDays * 24 * 60 * 60 * 1000);
    const s3 = new S3Client({
        endpoint: params.endpoint,
        region: params.region,
        forcePathStyle: true,
        credentials: {
            accessKeyId: params.accessKeyId,
            secretAccessKey: params.secretAccessKey,
        },
    });

    const objectsByBackup = new Map<string, _Object[]>();
    let continuationToken: string | undefined;
    const objectPrefix = `${trimSlashes(params.prefix)}/`;

    do {
        const response = await s3.send(new ListObjectsV2Command({
            Bucket: params.bucket,
            Prefix: objectPrefix,
            ContinuationToken: continuationToken,
        }));

        for (const object of response.Contents ?? []) {
            if (!object.Key) continue;
            const backupId = backupGroupFromKey(params.prefix, object.Key);
            if (!backupId) continue;
            const group = objectsByBackup.get(backupId) ?? [];
            group.push(object);
            objectsByBackup.set(backupId, group);
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    let expiredBackups = 0;
    let deletedObjects = 0;
    let deletedBytes = 0;

    for (const [backupId, objects] of objectsByBackup) {
        if (backupId === params.keepBackupId || backupId === `${params.keepBackupId}${BACKUP_ARCHIVE_SUFFIX}`) continue;

        const startedAt = backupStartedAtFromId(backupId);
        if (!startedAt || startedAt.getTime() >= cutoff) continue;

        expiredBackups += 1;
        const keys = objects.map((object) => object.Key).filter((key): key is string => Boolean(key));
        for (let index = 0; index < keys.length; index += 1000) {
            await deleteObjectBatch(s3, params.bucket, keys.slice(index, index + 1000));
        }

        deletedObjects += keys.length;
        deletedBytes += objects.reduce((sum, object) => sum + (object.Size ?? 0), 0);
    }

    return { expiredBackups, deletedObjects, deletedBytes };
}

async function main(): Promise<void> {
    const clickhouseUrl = requireEnv('CLICKHOUSE_URL');
    const clickhouseUser = optionalEnv('CLICKHOUSE_USER', 'rejourney');
    const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? '';
    const database = optionalEnv('CLICKHOUSE_DATABASE', 'rejourney');

    const endpoint = requireEnv('BACKUP_S3_ENDPOINT').replace(/\/+$/g, '');
    const bucket = trimSlashes(requireEnv('BACKUP_S3_BUCKET'));
    const prefix = trimSlashes(optionalEnv('CLICKHOUSE_BACKUP_PREFIX', 'clickhouse/rejourney'));
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const backupId = buildBackupId();
    const destination = `${endpoint}/${bucket}/${prefix}/${backupId}${BACKUP_ARCHIVE_SUFFIX}`;
    const requestTimeout = Number(process.env.CLICKHOUSE_BACKUP_REQUEST_TIMEOUT_MS || process.env.CLICKHOUSE_REQUEST_TIMEOUT_MS || 3600000);
    const retentionDays = optionalPositiveIntegerEnv('CLICKHOUSE_BACKUP_RETENTION_DAYS', 7);
    const region = optionalEnv('BACKUP_S3_REGION', 'us-west-or');

    const client = createClient({
        url: clickhouseUrl,
        username: clickhouseUser,
        password: clickhousePassword,
        database,
        application: 'rejourney-clickhouse-backup',
        request_timeout: requestTimeout,
    });

    try {
        const query = `
            BACKUP DATABASE ${quoteIdentifier(database)}
            TO S3(
                ${quoteClickHouseString(destination)},
                ${quoteClickHouseString(accessKeyId)},
                ${quoteClickHouseString(secretAccessKey)}
            )
        `;

        await client.command({
            query,
            clickhouse_settings: {
                log_queries: 0,
                wait_end_of_query: 1,
            },
        });

        const cleanup = await cleanupExpiredBackups({
            endpoint,
            bucket,
            prefix,
            region,
            accessKeyId,
            secretAccessKey,
            retentionDays,
            keepBackupId: backupId,
        });

        console.log(JSON.stringify({
            status: 'created',
            database,
            backupId,
            destination,
            retentionDays,
            cleanup,
        }));
    } finally {
        await client.close();
    }
}

// Runs when executed (the CronJob), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error('[clickhouse-backup] failed', error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
