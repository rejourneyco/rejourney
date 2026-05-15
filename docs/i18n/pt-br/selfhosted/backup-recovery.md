# Backup e recuperação auto-hospedados

Se você executar Rejourney com [auto-hospedagem Docker Compose](/docs/selfhosted), trate-os como **crítico** para manter cópias de:

- Postgres
- `.env.selfhosted`
- Dados MinIO se você usar MinIO integrado

---

## Backup rápido

Use o ajudante incluído:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

O que faz:

- Postgres despejo sempre
- Instantâneo Redis quando disponível
- `.env.selfhosted` copie sempre
- Dados do objeto MinIO quando `--full` é usado e MinIO integrado está ativado

---

## O que salvar

### Sempre salve

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### Economize ao usar MinIO integrado

- `backups/minio-*.tar.gz`

Se você usar S3 externo, suas gravações ficarão nesse bucket em vez do volume MinIO local, portanto, o banco de dados mais `.env.selfhosted` são os backups locais mínimos.

---

## Restaurar pedido

### 1. Recrie a configuração da pilha

Coloque o `.env.selfhosted` salvo de volta na raiz do repositório.

### 2. Inicie a infraestrutura e inicialize

```bash
./scripts/selfhosted/deploy.sh update
```

Isso traz os serviços de volta e recria a linha `storage_endpoints` da sua configuração salva.

### 3. Restaurar Postgres

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. Restaure MinIO, se aplicável

Se você usar MinIO integrado e tiver feito um backup `--full`:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. Reinicie os serviços do aplicativo

```bash
./scripts/selfhosted/deploy.sh update
```

Isso executa novamente o bootstrap e reinicia os serviços do aplicativo após a restauração.

---

## Cronograma recomendado

Backup diário do banco de dados:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

Backup completo semanal com dados MinIO:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## Notas de recuperação de desastres

Você precisa de todos os itens a seguir para restaurar totalmente uma implantação MinIO integrada:

- `.env.selfhosted`
- Backup Postgres
- Backup MinIO

Sem `.env.selfhosted`, você pode perder o acesso às credenciais de armazenamento criptografadas em Postgres porque `STORAGE_ENCRYPTION_KEY` reside lá.

---

## Lista de verificação de verificação

Após uma restauração:

1. execute `./scripts/selfhosted/deploy.sh status`
2. faça login no painel
3. abrir um projeto existente
4. abrir um replay existente
5. grave uma nova sessão curta e verifique se ela aparece

Se a ingestão de reprodução falhar após a restauração, verifique:

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## Consultas de verificação de vários buckets

Execute essas verificações SQL antes de ativar endpoints multiprimários ponderados ou depois de alterar os buckets no escopo do projeto.

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
