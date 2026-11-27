/** Backup ids, archive names and cleanup grouping for the nightly ClickHouse backup. */
import { describe, expect, it } from 'vitest';
import { BACKUP_ARCHIVE_SUFFIX, backupGroupFromKey, backupStartedAtFromId } from '../services/clickhouseBackupNames.js';

describe('ClickHouse backup names', () => {
    it('writes one zstd tar archive per backup', () => {
        expect(BACKUP_ARCHIVE_SUFFIX).toBe('.tar.zst');
    });

    it('reads the start time from archive and old directory backups alike, and nothing else', () => {
        const at = '2026-11-27T03:30:04.139Z';
        expect(backupStartedAtFromId('rejourney-2026-11-27T03-30-04-139Z')?.toISOString()).toBe(at);
        expect(backupStartedAtFromId('rejourney-2026-11-27T03-30-04-139Z.tar.zst')?.toISOString()).toBe(at);
        expect(backupStartedAtFromId('compression-test-20261127T152153')).toBeNull();
        expect(backupStartedAtFromId('rejourney-2026-11-27T03-30-04-139Z.zip')).toBeNull();
    });

    it('groups objects by backup, for both layouts', () => {
        expect(backupGroupFromKey('clickhouse/rejourney', 'clickhouse/rejourney/rejourney-2026-11-27T03-30-04-139Z.tar.zst')).toBe('rejourney-2026-11-27T03-30-04-139Z.tar.zst');
        expect(backupGroupFromKey('clickhouse/rejourney', 'clickhouse/rejourney/rejourney-2026-11-21T03-30-02-650Z/data/x.bin')).toBe('rejourney-2026-11-21T03-30-02-650Z');
        expect(backupGroupFromKey('clickhouse/rejourney', 'postgres-local/base/x')).toBeNull();
    });
});
