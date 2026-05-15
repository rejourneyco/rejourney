# Samodzielne tworzenie kopii zapasowych i odzyskiwanie danych

Jeśli uruchamiasz Rejourney z [Docker Compose self-hosting](/docs/selfhosted), traktuj je jako **krytyczny**, aby zachować kopie:

- Postgres
- `.env.selfhosted`
- Dane MinIO w przypadku korzystania z wbudowanego MinIO

---

## Szybka kopia zapasowa

Użyj dołączonego pomocnika:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Co robi:

- Postgres zrzut za każdym razem
- Migawka Redis, jeśli jest dostępna
- `.env.selfhosted` kopiuj za każdym razem
- Dane obiektowe MinIO, gdy używany jest `--full` i włączony jest wbudowany MinIO

---

## Co zapisać

### Zawsze oszczędzaj

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### Oszczędzaj, korzystając z wbudowanego MinIO

- `backups/minio-*.tar.gz`

Jeśli używasz zewnętrznego S3, Twoje nagrania znajdują się w tym zasobniku, a nie na lokalnym wolumenie MinIO, więc baza danych plus `.env.selfhosted` stanowią minimalne lokalne kopie zapasowe.

---

## Przywróć porządek

### 1. Utwórz ponownie konfigurację stosu

Umieść zapisany plik `.env.selfhosted` z powrotem w katalogu głównym repozytorium.

### 2. Uruchom infrastrukturę i bootstrap

```bash
./scripts/selfhosted/deploy.sh update
```

Spowoduje to przywrócenie usług i ponowne utworzenie wiersza `storage_endpoints` z zapisanej konfiguracji.

### 3. Przywróć Postgres

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. Przywróć MinIO, jeśli ma to zastosowanie

Jeśli korzystasz z wbudowanego MinIO i wykonałeś kopię zapasową `--full`:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. Uruchom ponownie usługi aplikacji

```bash
./scripts/selfhosted/deploy.sh update
```

Spowoduje to ponowne uruchomienie ładowania początkowego i ponowne uruchomienie usług aplikacji po przywróceniu.

---

## Zalecany harmonogram

Codzienna kopia zapasowa bazy danych:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

Cotygodniowa pełna kopia zapasowa danych MinIO:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## Uwagi dotyczące odzyskiwania po awarii

Aby w pełni przywrócić wbudowane wdrożenie MinIO, potrzebne są wszystkie poniższe elementy:

- `.env.selfhosted`
- Kopia zapasowa Postgres
- Kopia zapasowa MinIO

Bez `.env.selfhosted` możesz utracić dostęp do zaszyfrowanych poświadczeń magazynu w Postgres, ponieważ znajduje się tam `STORAGE_ENCRYPTION_KEY`.

---

## Lista kontrolna weryfikacji

Po przywróceniu:

1. uruchom `./scripts/selfhosted/deploy.sh status`
2. zaloguj się do panelu
3. otwórz istniejący projekt
4. otwórz istniejącą powtórkę
5. nagraj jedną nową krótką sesję i sprawdź, czy się pojawiła

Jeśli po przywróceniu odtwarzanie powtórki nie powiedzie się, sprawdź:

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## Zapytania weryfikacyjne obejmujące wiele zasobników

Uruchom te kontrole SQL przed włączeniem ważonych wielopodstawowych punktów końcowych lub po zmianie zasobników o zakresie projektu.

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
