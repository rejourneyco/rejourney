# 自托管备份和恢复

如果您使用 [Docker Compose 自托管](/docs/selfhosted) 运行 Rejourney，请将这些视为 **批判的** 以保留以下副本：

- Postgres
- `.env.selfhosted`
- MinIO 数据（如果使用内置 MinIO）

---

## 快速备份

使用捆绑的助手：

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

它的作用：

- Postgres 每次都转储
- Redis 快照（可用时）
- `.env.selfhosted` 每次都复制
- 使用 `--full` 且启用内置 MinIO 时的 MinIO 对象数据

---

## 保存什么

### 始终保存

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### 使用内置MinIO时保存

- `backups/minio-*.tar.gz`

如果您使用外部 S3，则您的录制内容位于该存储桶中，而不是本地 MinIO 卷中，因此数据库加上 `.env.selfhosted` 是最少的本地备份。

---

## 恢复秩序

### 1. 重新创建堆栈配置

将保存的 `.env.selfhosted` 放回到存储库根目录中。

### 2. 启动基础设施和引导程序

```bash
./scripts/selfhosted/deploy.sh update
```

这将恢复服务并从您保存的配置中重新创建 `storage_endpoints` 行。

### 3. 恢复Postgres

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. 恢复 MinIO（如果适用）

如果您使用内置 MinIO 并进行了 `--full` 备份：

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. 重启应用服务

```bash
./scripts/selfhosted/deploy.sh update
```

这会在恢复后重新运行引导程序并重新启动应用程序服务。

---

## 推荐时间表

每日数据库备份：

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

每周完整备份 MinIO 数据：

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## 灾难恢复注意事项

您需要以下所有内容才能完全恢复内置 MinIO 部署：

- `.env.selfhosted`
- Postgres 备份
- MinIO 备份

如果没有 `.env.selfhosted`，您可能无法访问 Postgres 中的加密存储凭据，因为 `STORAGE_ENCRYPTION_KEY` 位于其中。

---

## 验证清单

恢复后：

1. 运行`./scripts/selfhosted/deploy.sh status`
2. 登录仪表板
3. 打开现有项目
4. 打开现有的重播
5. 录制一个新的简短会话并验证它是否出现

如果恢复后重放提取失败，请检查：

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## 多桶验证查询

在启用加权多主端点之前或更改项目范围的存储桶之后运行这些 SQL 检查。

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
