# Самостоятельное резервное копирование и восстановление

Если вы запускаете Rejourney с [Docker Compose самостоятельным размещением](/docs/selfhosted), рассматривайте их как **критический**, чтобы сохранить копии:

- Postgres
- `.env.selfhosted`
- Данные MinIO, если вы используете встроенный MinIO.

---

## Быстрое резервное копирование

Используйте встроенный помощник:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Что он делает:

- Postgres дамп каждый раз
- Снимок Redis, когда он доступен.
- `.env.selfhosted` копировать каждый раз
- Данные объекта MinIO, когда используется `--full` и включен встроенный MinIO.

---

## Что сохранить

### Всегда сохранять

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### Сохраняйте при использовании встроенного MinIO.

- `backups/minio-*.tar.gz`

Если вы используете внешний S3, ваши записи будут храниться в этом сегменте вместо локального тома MinIO, поэтому база данных плюс `.env.selfhosted` представляют собой минимальные локальные резервные копии.

---

## Восстановить порядок

### 1. Воссоздайте конфигурацию стека.

Поместите сохраненный `.env.selfhosted` обратно в корень репо.

### 2. Запустите инфраструктуру и загрузку.

```bash
./scripts/selfhosted/deploy.sh update
```

Это вернет службы и воссоздаст строку `storage_endpoints` из сохраненной конфигурации.

### 3. Восстановить Postgres.

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. Восстановите MinIO, если применимо.

Если вы используете встроенный MinIO и сделали резервную копию `--full`:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. Перезапустите службы приложений.

```bash
./scripts/selfhosted/deploy.sh update
```

Это повторно запускает загрузку и перезапускает службы приложений после восстановления.

---

## Рекомендуемое расписание

Ежедневное резервное копирование базы данных:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

Еженедельное полное резервное копирование с данными MinIO:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## Примечания по аварийному восстановлению

Для полного восстановления встроенного развертывания MinIO вам потребуется все следующее:

- `.env.selfhosted`
- Postgres резервная копия
- MinIO резервная копия

Без `.env.selfhosted` вы можете потерять доступ к зашифрованным учетным данным хранилища в Postgres, поскольку там находится `STORAGE_ENCRYPTION_KEY`.

---

## Контрольный список проверки

После восстановления:

1. запустить `./scripts/selfhosted/deploy.sh status`
2. войдите в панель управления
3. открыть существующий проект
4. открыть существующий повтор
5. запишите один новый короткий сеанс и убедитесь, что он появился

Если после восстановления не удалось загрузить повтор, проверьте:

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## Запросы проверки нескольких сегментов

Выполняйте эти проверки SQL перед включением взвешенных нескольких основных конечных точек или после изменения сегментов на уровне проекта.

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
