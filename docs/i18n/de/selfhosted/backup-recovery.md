# Selbstgehostete Sicherung und Wiederherstellung

Wenn Sie Rejourney mit [Docker Compose Self-Hosting](/docs/selfhosted) ausführen, behandeln Sie diese als **kritisch**, um Kopien von Folgendem zu behalten:

- Postgres
- `.env.selfhosted`
- MinIO-Daten, wenn Sie das integrierte MinIO verwenden

---

## Schnelle Sicherung

Verwenden Sie den mitgelieferten Helfer:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Was es tut:

- Postgres-Dump jedes Mal
- Redis Snapshot, sofern verfügbar
- `.env.selfhosted` jedes Mal kopieren
- MinIO-Objektdaten, wenn `--full` verwendet wird und das integrierte MinIO aktiviert ist

---

## Was Sie sparen sollten

### Speichern Sie immer

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### Sparen Sie bei Verwendung des integrierten MinIO

- `backups/minio-*.tar.gz`

Wenn Sie das externe S3 verwenden, befinden sich Ihre Aufzeichnungen in diesem Bucket und nicht im lokalen MinIO-Volume, sodass die Datenbank plus `.env.selfhosted` die minimalen lokalen Sicherungen sind.

---

## Ordnung wiederherstellen

### 1. Erstellen Sie die Stack-Konfiguration neu

Legen Sie den gespeicherten `.env.selfhosted` wieder im Repo-Root ab.

### 2. Infrastruktur und Bootstrap starten

```bash
./scripts/selfhosted/deploy.sh update
```

Dadurch werden die Dienste zurückgebracht und die Zeile `storage_endpoints` aus Ihrer gespeicherten Konfiguration neu erstellt.

### 3. Stellen Sie Postgres wieder her

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. Stellen Sie ggf. MinIO wieder her

Wenn Sie das integrierte MinIO verwenden und ein `--full`-Backup erstellt haben:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. Starten Sie die App-Dienste neu

```bash
./scripts/selfhosted/deploy.sh update
```

Dadurch wird Bootstrap erneut ausgeführt und die App-Dienste nach der Wiederherstellung neu gestartet.

---

## Empfohlener Zeitplan

Tägliche Datenbanksicherung:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

Wöchentliches Voll-Backup mit MinIO-Daten:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## Hinweise zur Notfallwiederherstellung

Um eine integrierte MinIO-Bereitstellung vollständig wiederherzustellen, benötigen Sie Folgendes:

- `.env.selfhosted`
- Postgres-Sicherung
- MinIO-Sicherung

Ohne `.env.selfhosted` verlieren Sie möglicherweise den Zugriff auf verschlüsselte Speicheranmeldeinformationen in Postgres, da `STORAGE_ENCRYPTION_KEY` dort lebt.

---

## Checkliste zur Verifizierung

Nach einer Wiederherstellung:

1. Führen Sie `./scripts/selfhosted/deploy.sh status` aus
2. Melden Sie sich im Dashboard an
3. Öffnen Sie ein vorhandenes Projekt
4. Öffnen Sie eine vorhandene Wiedergabe
5. Zeichnen Sie eine neue kurze Sitzung auf und überprüfen Sie, ob sie angezeigt wird

Wenn die Aufnahme der Wiedergabe nach der Wiederherstellung fehlschlägt, überprüfen Sie Folgendes:

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## Multi-Bucket-Verifizierungsabfragen

Führen Sie diese SQL-Prüfungen aus, bevor Sie gewichtete multiprimäre Endpunkte aktivieren oder nachdem Sie projektbezogene Buckets geändert haben.

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
