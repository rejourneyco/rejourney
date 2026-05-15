# Zelf-gehoste back-up en herstel

Als u Rejourney uitvoert met [Docker Compose self-hosting](/docs/selfhosted), behandel deze dan als **kritisch** om kopieën te bewaren van:

- Postgres
- `.env.selfhosted`
- MinIO-gegevens als u de ingebouwde MinIO gebruikt

---

## Snelle back-up

Gebruik de gebundelde helper:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Wat het doet:

- Postgres elke keer dumpen
- Redis momentopname indien beschikbaar
- `.env.selfhosted` elke keer kopiëren
- MinIO-objectgegevens wanneer `--full` wordt gebruikt en ingebouwde MinIO is ingeschakeld

---

## Wat u kunt besparen

### Bewaar altijd

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### Bespaar bij gebruik van de ingebouwde MinIO

- `backups/minio-*.tar.gz`

Als u externe S3 gebruikt, bevinden uw opnamen zich in die bucket in plaats van het lokale MinIO-volume, dus de database plus `.env.selfhosted` zijn de minimale lokale back-ups.

---

## Herstel de orde

### 1. Maak de stapelconfiguratie opnieuw

Plaats de opgeslagen `.env.selfhosted` terug in de repo-root.

### 2. Start infrastructuur en bootstrap

```bash
./scripts/selfhosted/deploy.sh update
```

Hierdoor worden de services teruggezet en wordt de rij `storage_endpoints` opnieuw gemaakt vanuit uw opgeslagen configuratie.

### 3. Herstel Postgres

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. Herstel MinIO, indien van toepassing

Als u de ingebouwde MinIO gebruikt en een `--full`-back-up hebt gemaakt:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. Start app-services opnieuw

```bash
./scripts/selfhosted/deploy.sh update
```

Dat voert bootstrap opnieuw uit en start de app-services opnieuw na het herstel.

---

## Aanbevolen schema

Dagelijkse databaseback-up:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

Wekelijkse volledige back-up met MinIO-gegevens:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## Opmerkingen over noodherstel

U hebt al het volgende nodig om een ​​ingebouwde MinIO-implementatie volledig te herstellen:

- `.env.selfhosted`
- Postgres-back-up
- MinIO-back-up

Zonder `.env.selfhosted` verliest u mogelijk de toegang tot gecodeerde opslaggegevens in Postgres omdat `STORAGE_ENCRYPTION_KEY` daar woont.

---

## Verificatiechecklist

Na een herstel:

1. voer `./scripts/selfhosted/deploy.sh status` uit
2. log in op het dashboard
3. een bestaand project openen
4. open een bestaande herhaling
5. neem één nieuwe korte sessie op en controleer of deze verschijnt

Als de opname van de herhaling mislukt na het herstellen, controleer dan het volgende:

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## Verificatiequery's voor meerdere buckets

Voer deze SQL-controles uit voordat u gewogen multi-primaire eindpunten inschakelt of nadat u projectgerichte buckets hebt gewijzigd.

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
