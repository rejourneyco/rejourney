# 自托管故障排除

如果您按照[自托管 Rejourney](/docs/selfhosted) 进行操作并且出现故障或行为异常，请使用此页面。命令从 **存储库根目录**（`docker-compose.selfhosted.yml` 所在的位置）运行。

---

## 快速检查

### 服务状态

```bash
./scripts/selfhosted/deploy.sh status
```

### API 日志

```bash
./scripts/selfhosted/deploy.sh logs api
```

### 上传中继日志

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### 工人日志

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. 在引导之前或期间安装或更新失败

### 症状

- `bootstrap` 非零退出
- 应用程序服务永远不会变得健康
- `status` 显示 API 或工作人员正在等待引导
- 安装或更新退出并显示 `Database authentication failed before bootstrap.`

### 支票

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

常见原因：

- 坏 `DATABASE_URL`
- 凭据不匹配（例如，来自先前失败的部署）
- 缺少`STORAGE_ENCRYPTION_KEY`
- 无效的 S3 凭证
- 损坏的外部 S3 端点 URL
- 在 **ARM64** 上，缺少图像支持（设置 `DOCKER_DEFAULT_PLATFORM=linux/amd64` 或使用 `./scripts/selfhosted/deploy.sh`，这会在未设置时设置它）

恢复：

1. 如果您仍然有原始的 `.env.selfhosted`，请将其恢复并运行：

```bash
./scripts/selfhosted/deploy.sh update
```

2. 如果您不需要旧数据，请擦除并重新安装：

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**架构/迁移消息：** 在正常安装中，数据库启动时为空，引导程序会设置所有内容。如果您将 **从备份恢复 Postgres** 转移到新服务器，但迁移元数据丢失，或者您将堆栈指向 **错误的数据库**，引导程序可能会退出并显示有关数据库不一致的错误，而不是覆盖您的数据。除非您正在进行高级恢复，否则请修复 `DATABASE_URL` 并恢复一致的备份，或从干净的​​卷开始。对于故意仅迁移恢复，某些设置在 `.env.selfhosted` 中使用 `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1`（使用此功能之前请参阅维护者文档或支持）。

### 使固定

1. 如果您有原始的 `.env.selfhosted`，请将其恢复并重新运行：

```bash
./scripts/selfhosted/deploy.sh update
```

2. 如果您没有原来的`.env.selfhosted`，请擦除并重新安装：

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update` 重新运行架构、种子和存储端点同步。 `reset` 删除了自托管容器和数据卷，以便全新安装可以安全地生成新凭据。

---

## 2. 会话被计数，但重播仍为空

### 现在这通常意味着什么

对于当前的架构，这通常是以下两件事之一：

- `ingest-upload` 无法存储工件字节
- `ingest-worker` 无法处理上传的工件

该设备不再直接上传到 MinIO/S3，因此从手机的存储桶可达性不再是主要嫌疑点。

### 支票

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

寻找：

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### 常见原因

- `.env.selfhosted` 中的 S3 凭证错误
- 外部 S3 铲斗缺失
- 从 Docker 网络无法访问外部 S3 端点
- 上传中继不健康
- 工作人员卡在重试失败的工件上

### 使固定

- 验证 `S3_*` 值
- 如果您更改了存储配置，请重新运行：

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. 仪表板加载，但 auth 或 API 调用失败

### 支票

- 仪表板主机DNS指向服务器
- API 主机 DNS 指向服务器
- 采集主机DNS指向服务器
- 端口 `80` 和 `443` 已打开
- Let’s Encrypt 已颁发证书

检查：

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS或证书问题

Traefik 自动管理证书。

### 支票

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

确保两个名称都解析为运行堆栈的服务器。

如果首次安装时 DNS 错误，请修复 DNS 并重新运行：

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. 外部S3在CLI下工作，但Rejourney无法上传

请记住，上传路径是服务器端的。

重要的网络路径是：

- `ingest-upload` 容器 -> 您的 S3 端点

通过查看中继日志并确认 `.env.selfhosted` 中的端点/存储桶/密钥，从服务器进行测试。

如果您更改了它们，请重新运行：

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. 内置MinIO安装，但工件仍然失败

### 支票

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

`minio-setup` 一次性应创建由 `S3_BUCKET` 命名的存储桶。

如果您在首次安装后更改了存储桶名称，请运行：

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. 计费页面显示禁用计费

除非配置了 Stripe 密钥，否则这是预期的。

该堆栈不再禁用计费，因为它是“自托管”的。它禁用计费，因为 Stripe 未配置。

如果不设置Stripe键：

- 计费 UI 保持自托管/无限制状态
- Stripe 结账和 webhooks 保持禁用状态

---

## 8、更改`.env.selfhosted`后Postgres中的存储端点错误

跑步：

```bash
./scripts/selfhosted/deploy.sh update
```

更新路径重新运行引导程序并重新同步活动的 `storage_endpoints` 行。

---

## 9. 需要停止服务而不丢失数据

使用：

```bash
./scripts/selfhosted/deploy.sh stop
```

这仅停止容器。它不会删除卷。

---

## 10. 一项服务需要更深入的日志

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
