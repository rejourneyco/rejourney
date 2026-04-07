# Self-hosted backup and recovery

If you run Rejourney with [Docker Compose self-hosting](/docs/selfhosted), treat these as **critical** to keep copies of:

- Postgres
- `.env.selfhosted`
- MinIO data if you use built-in MinIO

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

---

## What to Save

### Always save

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### Save when using built-in MinIO

- `backups/minio-*.tar.gz`

If you use external S3, your recordings live in that bucket instead of the local MinIO volume, so the database plus `.env.selfhosted` are the minimum local backups.

---

## Restore Order

### 1. Recreate the stack config

Put the saved `.env.selfhosted` back in the repo root.

### 2. Start infrastructure and bootstrap

```bash
./scripts/selfhosted/deploy.sh update
```

This brings the services back and recreates the `storage_endpoints` row from your saved config.

### 3. Restore Postgres

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. Restore MinIO, if applicable

If you use built-in MinIO and you took a `--full` backup:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. Restart app services

```bash
./scripts/selfhosted/deploy.sh update
```

That reruns bootstrap and restarts the app services after the restore.

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
