/** Names and layout of the nightly ClickHouse backups in the backup bucket. */

export function trimSlashes(value: string): string {
    return value.replace(/^\/+|\/+$/g, '');
}

/**
 * Backups are one zstd-compressed tar archive each (`<id>.tar.zst`). ClickHouse
 * copies table parts as stored (LZ4), so a plain directory backup is barely
 * smaller than the data; zstd over the whole archive takes about 40% off.
 * Older directory backups (`<id>/...`) are still recognised for cleanup.
 */
export const BACKUP_ARCHIVE_SUFFIX = '.tar.zst';

export function backupStartedAtFromId(backupId: string): Date | null {
    const match = /^rejourney-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)(?:\.tar\.zst)?$/.exec(backupId);
    if (!match) return null;

    const iso = match[1].replace(
        /^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/,
        '$1$2:$3:$4.$5',
    );
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function backupGroupFromKey(prefix: string, key: string): string | null {
    const normalizedPrefix = `${trimSlashes(prefix)}/`;
    if (!key.startsWith(normalizedPrefix)) return null;

    const rest = key.slice(normalizedPrefix.length);
    const backupId = rest.split('/', 1)[0];
    return backupId || null;
}
