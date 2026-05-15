# Backup e ripristino self-hosted

Se esegui Rejourney con [Docker Compose self-hosting](/docs/selfhosted), trattali come **critico** per conservare copie di:

- Postgres
- `.env.selfhosted`
- Dati MinIO se si utilizza MinIO integrato

---

## Backup rapido

Utilizza l'helper in bundle:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Cosa fa:

- Postgres esegue il dump ogni volta
- Istantanea Redis quando disponibile
- `.env.selfhosted` copia ogni volta
- Dati oggetto MinIO quando viene utilizzato `--full` e MinIO integrato è abilitato

---

## Cosa salvare

### Risparmia sempre

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### Risparmia quando usi MinIO integrato

- `backups/minio-*.tar.gz`

Se utilizzi S3 esterno, le tue registrazioni risiedono in quel bucket invece che nel volume locale MinIO, quindi il database più `.env.selfhosted` rappresentano i backup locali minimi.

---

## Ripristina l'ordine

### 1. Ricrea la configurazione dello stack

Rimetti lo `.env.selfhosted` salvato nella radice del repository.

### 2. Avviare l'infrastruttura e avviare il bootstrap

```bash
./scripts/selfhosted/deploy.sh update
```

Ciò ripristina i servizi e ricrea la riga `storage_endpoints` dalla configurazione salvata.

### 3. Ripristina Postgres

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. Ripristina MinIO, se applicabile

Se utilizzi MinIO integrato e hai eseguito un backup `--full`:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. Riavvia i servizi dell'app

```bash
./scripts/selfhosted/deploy.sh update
```

Ciò esegue nuovamente il bootstrap e riavvia i servizi dell'app dopo il ripristino.

---

## Programma consigliato

Backup giornaliero del database:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

Backup completo settimanale con dati MinIO:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## Note sul ripristino di emergenza

Per ripristinare completamente una distribuzione MinIO integrata è necessario quanto segue:

- `.env.selfhosted`
- Backup Postgres
- Backup MinIO

Senza `.env.selfhosted`, potresti perdere l'accesso alle credenziali di archiviazione crittografate in Postgres perché `STORAGE_ENCRYPTION_KEY` risiede lì.

---

## Lista di controllo per la verifica

Dopo un ripristino:

1. eseguire `./scripts/selfhosted/deploy.sh status`
2. accedere alla dashboard
3. aprire un progetto esistente
4. aprire un replay esistente
5. registra una nuova breve sessione e verifica che appaia

Se l'acquisizione della riproduzione non riesce dopo il ripristino, controlla:

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## Query di verifica multi-bucket

Esegui questi controlli SQL prima di abilitare endpoint multiprimari ponderati o dopo aver modificato i bucket con ambito di progetto.

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
