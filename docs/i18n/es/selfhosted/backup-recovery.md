# Copia de seguridad y recuperación autohospedada

Si ejecuta Rejourney con [Docker Compose self-hospedaje](/docs/selfhosted), trátelos como **crítico** para conservar copias de:

- Postgres
- `.env.selfhosted`
- Datos MinIO si utiliza el MinIO integrado

---

## Copia de seguridad rápida

Utilice el ayudante incluido:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Qué hace:

- Postgres volcado cada vez
- Instantánea Redis cuando esté disponible
- `.env.selfhosted` copia cada vez
- Datos de objeto MinIO cuando se utiliza `--full` y el MinIO integrado está habilitado

---

## Qué guardar

### guardar siempre

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### Ahorre cuando utilice el MinIO integrado

- `backups/minio-*.tar.gz`

Si utiliza S3 externo, sus grabaciones se encuentran en ese depósito en lugar del volumen MinIO local, por lo que la base de datos más `.env.selfhosted` son las copias de seguridad locales mínimas.

---

## Restaurar orden

### 1. Recrea la configuración de la pila.

Vuelva a colocar el `.env.selfhosted` guardado en la raíz del repositorio.

### 2. Inicie la infraestructura y arranque

```bash
./scripts/selfhosted/deploy.sh update
```

Esto recupera los servicios y recrea la fila `storage_endpoints` de su configuración guardada.

### 3. Restaurar Postgres

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. Restaure MinIO, si corresponde

Si utiliza el MinIO integrado y realizó una copia de seguridad de `--full`:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. Reinicie los servicios de la aplicación.

```bash
./scripts/selfhosted/deploy.sh update
```

Eso vuelve a ejecutar el arranque y reinicia los servicios de la aplicación después de la restauración.

---

## Horario recomendado

Copia de seguridad diaria de la base de datos:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

Copia de seguridad completa semanal con datos MinIO:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## Notas de recuperación ante desastres

Necesita todo lo siguiente para restaurar completamente una implementación MinIO integrada:

- `.env.selfhosted`
- Copia de seguridad Postgres
- Copia de seguridad MinIO

Sin `.env.selfhosted`, es posible que pierda el acceso a las credenciales de almacenamiento cifradas en Postgres porque `STORAGE_ENCRYPTION_KEY` reside allí.

---

## Lista de verificación de verificación

Después de una restauración:

1. ejecutar `./scripts/selfhosted/deploy.sh status`
2. iniciar sesión en el tablero
3. abrir un proyecto existente
4. abrir una repetición existente
5. Graba una nueva sesión corta y verifica que aparece.

Si la ingesta de reproducción falla después de la restauración, verifique:

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## Consultas de verificación de varios depósitos

Ejecute estas comprobaciones de SQL antes de habilitar puntos finales multiprimarios ponderados o después de cambiar los depósitos con ámbito de proyecto.

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
