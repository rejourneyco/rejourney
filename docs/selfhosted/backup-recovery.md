# Self-hosted backup and recovery

If you run Rejourney with [Docker Compose self-hosting](/docs/selfhosted), treat these as **critical** to keep copies of:

- Postgres
- `.env.selfhosted`
- MinIO data if you use built-in MinIO

Think of recovery as a three-part bundle: config, database, and replay bytes. If all three are available, a single-server restore should be straightforward.

---

## Backup Checklist

- [ ] I have a recent Postgres backup.
- [ ] I have the matching `.env.selfhosted`.
- [ ] If using built-in MinIO, I have a MinIO backup from the same period.
- [ ] If using external S3, I know which bucket contains recordings.
- [ ] I have tested at least one restore path on a non-production machine.

---

## Quick Backup

Use the bundled helper:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

What it does:

- Postgres dump every time
- Redis snapshot when available
- `.env.selfhosted` copy every time
- MinIO object data when `--full` is used and built-in MinIO is enabled

A full built-in-MinIO backup briefly stops MinIO while copying its volume, then starts it again. This avoids taking a raw volume snapshot while object files are changing; expect a short replay-upload interruption during that step.

The helper creates `backups/` with mode `0700` and backup files with mode `0600`. These files contain credentials, user data, and recorded session content; keep the same restrictions after copying them elsewhere.

Use `--full` before server moves, major upgrades, or any maintenance where replacing the machine is on the table.

---

## What to Save

### Always save

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### Save when using built-in MinIO

- `backups/minio-*.tar.gz`

If you use external S3, your recordings live in that bucket instead of the local MinIO volume, so the database plus `.env.selfhosted` are the minimum local backups.

---

## Restore Worksheet

Fill this in before touching production data.

| Question | Answer |
|---|---|
| Which backup timestamp am I restoring? | `YYYYMMDD-HHMMSS` |
| Do I have the matching `.env.selfhosted`? | yes / no |
| Storage mode | built-in MinIO / external S3 |
| Target server | same server / new server |
| Is data loss acceptable? | yes / no |

If the answer to "Do I have the matching `.env.selfhosted`?" is no, stop and recover that file first. It contains `STORAGE_ENCRYPTION_KEY`, which is needed to read encrypted storage credentials saved in Postgres.

---

## Restore Order

### 1. Recreate the stack config

Put the saved `.env.selfhosted` back in the repo root.

### 2. Start only the fresh Postgres service

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted up -d postgres
```

Do not run `deploy.sh update` yet. Bootstrap creates application tables, and a plain `pg_dump` must be restored into the fresh, empty database before those tables exist.

Wait until Postgres is healthy, then restore it:

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 3. Restore MinIO, if applicable

If you use built-in MinIO and you took a `--full` backup:

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted --profile minio create minio
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

Restore the MinIO volume before starting MinIO so nothing writes to it during extraction.

### 4. Bootstrap and start the application

```bash
./scripts/selfhosted/deploy.sh update
```

That applies any migrations newer than the backup, safely syncs the standard single storage endpoint, and starts the app services.

---

## Recommended Schedule

Daily database backup:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

Weekly full backup with MinIO data:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## Disaster Recovery Notes

You need all of the following to fully restore a built-in-MinIO deployment:

- `.env.selfhosted`
- Postgres backup
- MinIO backup

Without `.env.selfhosted`, you may lose access to encrypted storage credentials in Postgres because `STORAGE_ENCRYPTION_KEY` lives there.

Do not run `reset` during recovery unless you have already confirmed the target volumes are disposable. `reset` removes the self-hosted containers and Docker volumes.

---

## Verification Checklist

After a restore:

1. run `./scripts/selfhosted/deploy.sh status`
2. log into the dashboard
3. open an existing project
4. open an existing replay
5. record one new short session and verify it appears

If replay ingestion fails after restore, check:

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## Multi-Bucket Verification Queries

Run these SQL checks before enabling weighted multi-primary endpoints or after changing project-scoped buckets.

```sql
-- Sessions whose ready artifacts are split across multiple endpoint_ids.
SELECT
  ra.session_id,
  COUNT(DISTINCT COALESCE(ra.endpoint_id, 'global-default')) AS endpoint_count
FROM recording_artifacts ra
WHERE ra.status = 'ready'
GROUP BY ra.session_id
HAVING COUNT(DISTINCT COALESCE(ra.endpoint_id, 'global-default')) > 1
ORDER BY endpoint_count DESC, ra.session_id
LIMIT 200;
```

```sql
-- Ready artifacts with missing/invalid endpoint mapping.
SELECT
  ra.id,
  ra.session_id,
  ra.kind,
  ra.endpoint_id,
  ra.s3_object_key
FROM recording_artifacts ra
LEFT JOIN storage_endpoints se ON se.id = ra.endpoint_id
WHERE ra.status = 'ready'
  AND ra.endpoint_id IS NOT NULL
  AND se.id IS NULL
ORDER BY ra.session_id, ra.kind
LIMIT 500;
```

```sql
-- Backup success ratio by project (uses session_backup_log rows as successful backups).
SELECT
  s.project_id,
  COUNT(*) FILTER (WHERE bl.session_id IS NOT NULL) AS backed_up_sessions,
  COUNT(*) AS eligible_sessions,
  ROUND(
    (COUNT(*) FILTER (WHERE bl.session_id IS NOT NULL)::numeric / NULLIF(COUNT(*), 0)) * 100,
    2
  ) AS backup_coverage_percent
FROM sessions s
LEFT JOIN session_backup_log bl ON bl.session_id = s.id
WHERE s.status IN ('ready', 'completed')
GROUP BY s.project_id
ORDER BY backup_coverage_percent ASC, eligible_sessions DESC;
```
