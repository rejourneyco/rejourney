# 自托管 Rejourney

本指南适用于使用官方 **Docker Compose** 堆栈在自己的服务器（通常是单个 VPS 或专用机器）上运行 Rejourney 的 **任何人**。您不需要访问 Rejourney 的内部基础设施或 Kubernetes。

设置后您将得到：

- 您的域中的 **网络仪表板**（HTTPS 通过 Let’s Encrypt）
- 子域上的 **API**（用于仪表板和移动 SDK）
- 另一个子域上的 **摄取（上传）中继**（会话上传通过您的服务器，而不是直接从手机到对象存储）
- **PostgreSQL**、 **Redis** 以及 **内置MinIO** 或 **您自己的 S3-compatible 存储**
- 后台 **工人**，处理会话、保留和警报（与 Rejourney 云部署中的角色相同）

以下所有命令均假设您在克隆后位于 **存储库根目录** 中（包含 `docker-compose.selfhosted.yml` 的文件夹）。

---

## 事先需要什么

### 服务器

- **操作系统：** Ubuntu 22.04+、Debian 12+ 或另一个运行良好的 Docker
- **Docker：** 24 或更新版本，带有 **Docker Compose 插件**（`docker compose version` 应该可以工作）
- **资源（推荐）：** 4 个 vCPU、8 GB RAM、40 GB 磁盘（如果您保留大量录音，则需要更多）
- **网络：** 端口 **80** 和 **第443章** 向互联网开放（Let’s Encrypt HTTP 挑战和 HTTPS 需要）

### 域名和DNS

您需要控制 **一个基本域**（例如`example.com`）。在运行安装程序之前，创建 DNS **一个**（或 **AAAA**）记录，将这些主机名的 **全部** 指向服务器的公共 IP：

|主机名 |目的|
|----------|---------|
| `example.com` |仪表板|
| `www.example.com` |重定向至仪表板 |
| `api.example.com` | API（以及使用时的 WebSocket）|
| `ingest.example.com` |上传中继（一旦配置 API，SDK 就会自动使用此中继）|

将 `example.com` 替换为您的真实域名。传播可能需要几分钟到几小时；在正确解析 DNS 之前，不会颁发 TLS 证书。

### Let’s Encrypt

安装过程中系统会要求您提供 **电子邮件**。用于来自 Let’s Encrypt 的证书到期通知。

### 机器上的工具

- `git` 用于克隆存储库
- `openssl`（安装脚本使用它来生成机密）
- 一个外壳（bash即可）

---

## 首次安装

### 1. 克隆存储库

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

保留在默认分支上（如果项目记录了用于自托管的分支，则保留在发布标记上）。

### 2. 运行安装程序

```bash
./scripts/selfhosted/deploy.sh install
```

该脚本将：

1. 询问您的 **基域**（例如 `example.com` — 不是 `https://`，没有路径）。
2. 索取您的 **Let’s Encrypt 邮箱**。
3. 请求 **贮存**：内置 **MinIO**（推荐）或 **外部 S3-compatible** 存储（您将输入端点、存储桶、区域和密钥）。
4. 使用生成的密码和机密在存储库根目录中创建 **`.env.selfhosted`**。适用 **限制权限**（`chmod 600`）。
5. **拉** 发布的容器镜像（API、Web、workers、数据库、Traefik 等）。
6. **建造** **引导/迁移** 映像 **来自你的克隆**（它包含数据库设置脚本；它不是从容器注册表下载的）。
7. 启动数据库 Redis、Traefik 和（如果选择）MinIO。
8. 在引导程序运行之前，使用配置的 `DATABASE_URL` 验证数据库连接。
9. 运行一次性 **引导程序** 容器：数据库架构、可选的首次种子和数据库中的存储配置。
10. 启动API，上传relay、dashboard、worker。

首次安装可能需要几分钟（图像拉取和引导）。

### 3. 保护`.env.selfhosted`

此文件包含用于您的部署的 **所有的秘密**（数据库、Redis、JWT、存储加密、MinIO 凭据（如果使用）等）。 **备份一下** 到安全的地方（密码管理器，加密备份）。如果丢失它，您可能会失去解密存储的凭据或重建相同部署的能力。

不要将其提交到 git （它应该被 `.gitignore` 忽略）。

---

## 安装后

### 网址

安装程序会打印 URL。一般来说：

- **仪表板：** `https://<your-base-domain>`
- **API：** `https://api.<your-base-domain>`
- **摄取：** `https://ingest.<your-base-domain>`

`www.<your-base-domain>` 重定向至仪表板。

### 验证堆栈

```bash
./scripts/selfhosted/deploy.sh status
```

您应该看到容器正在运行； `api` 和 `ingest-upload` 不久后应变为 **健康**。

### 首次登录并测试录制

1. 在浏览器中打开仪表板。
2. 创建一个帐户和一个项目。
3. 使用 **API 网址** 配置应用程序的 Rejourney SDK（请参阅下面的 [SDK 配置](#configuring-your-mobile-app)）。
4. 录制一个简短的会话并确认它出现在重播中。

如果会话从未出现在重播中，请参阅[故障排除](/docs/selfhosted/troubleshooting)（上传中继和摄取工作日志）。

---

## 日常运营

所有这些都从存储库根运行。

|行动|命令|
|--------|---------|
|服务状态 | `./scripts/selfhosted/deploy.sh status` |
|关注所有日志 | `./scripts/selfhosted/deploy.sh logs` |
|一项服务的日志 | `./scripts/selfhosted/deploy.sh logs api`（用`web`、`ingest-upload`、`ingest-worker`等替换`api`）|
| **升级** 映像并重新运行引导程序 | `./scripts/selfhosted/deploy.sh update` |
|停止一切删除数据 **没有** | `./scripts/selfhosted/deploy.sh stop` |
| **重置** 容器和卷（破坏性）| `./scripts/selfhosted/deploy.sh reset` |

**`update`** 提取较新的映像（如果适用），从当前克隆重建引导映像，重新启动堆栈，然后再次运行引导程序，以便数据库架构和存储设置与您的 `.env.selfhosted` 保持一致。它会擦除 **不是** 或对象存储卷。

在引导之前，`install` 和 `update` 都会使用配置的凭据验证数据库连接。如果凭据与持久的 Postgres 数据不匹配，部署会在恢复指导下提前停止，而不是稍后在引导程序中失败。

**`stop`** 仅停止容器； Docker **卷**（Postgres 数据、MinIO 数据等）将保留，直到您明确删除它们。

在出现确认提示后， **`reset`** 会删除自承载容器和 Docker 卷（`pgdata`、`redisdata`、`miniodata`、`traefik-certs`）。即使 `.env.selfhosted` 丢失，它也会拆除 MinIO 配置文件容器，因此过时的 MinIO 数据不会阻止下一次安装。仅当您想要完全全新安装时才使用此选项。

---

## 存储：MinIO 与外部 S3

### 内置MinIO（默认）

- 对于单个服务器来说最简单：对象存储运行 **里面Docker** 并且默认情况下不暴露于公共互联网。
- 会话字节由 **摄取-上传** 服务写入；设备不需要直接到达MinIO。
- 存储桶创建是在安装期间处理的。

### 外部 S3-compatible 存储

使用 AWS S3、Cloudflare R2、Hetzner 对象存储、Wasabi 或任何 S3-compatible API。在安装过程中，您需要提供端点 URL、存储桶、区域和访问密钥。

端点 URL 样式示例（您的提供商的文档具有权威性）：

- AWS: `https://s3.<region>.amazonaws.com`
- Cloudflare R2：`https://<account-id>.r2.cloudflarestorage.com`
- 赫兹纳：`https://<location>.your-objectstorage.com`

如果添加 **单独的公共 URL** 进行下载，则在`.env.selfhosted`中设置`S3_PUBLIC_ENDPOINT`并运行`./scripts/selfhosted/deploy.sh update`。

---

## 重要配置（`.env.selfhosted`）

安装程序生成此文件。典型的变量包括：

- **域名和公共 URL：** `BASE_DOMAIN`、`DASHBOARD_DOMAIN`、`API_DOMAIN`、`INGEST_DOMAIN`、`PUBLIC_*_URL`
- **数据库：** `DATABASE_URL`（指向Compose内部的`postgres`服务）
- **Redis：** `REDIS_URL`
- **贮存：** `STORAGE_BACKEND`、`S3_*` 和可选的 `MINIO_*`
- **安全：** `JWT_SECRET`、`JWT_SIGNING_KEY`、`INGEST_HMAC_SECRET`、`STORAGE_ENCRYPTION_KEY`

可选集成（如果未使用则留空）：Stripe、SMTP、GitHub OAuth、Turnstile 等。

**更改存储或域相关值：** 编辑 `.env.selfhosted`，然后运行：

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 数据库设置如何工作（首次启动与稍后更新）

您通常需要手动运行 **不是** SQL。 **引导程序** 容器处理它。

- **全新的空数据库：** 堆栈应用代码中的当前架构，然后记录已满足的迁移版本，以便将来的更新仅应用 **新的** 迁移。
- **现有数据库（已初始化）：** 仅应用 **待办的** 迁移。您的数据不会在每个 `update` 上从头开始重建。
- 如果数据库为 **已经有桌子了**，但迁移历史表为 **缺失或为空**（例如部分恢复），则引导 **因错误而停止** 以避免意外损坏。高级恢复选项记录在[故障排除](/docs/selfhosted/troubleshooting) 中。

---

## Apple Silicon 和 ARM 服务器

在 **ARM64** 计算机（许多 Mac、一些云实例）上，部署脚本会在您未自行设置时为映像拉取设置 `DOCKER_DEFAULT_PLATFORM=linux/amd64`，因此仅发布 `amd64` 的预构建映像仍会运行。如果您需要不同的行为，请在运行脚本之前在您的环境中设置 `DOCKER_DEFAULT_PLATFORM`。

**引导程序** 映像始终是来自克隆存储库的 **构建在您的机器上**，因此它始终与您的签出相匹配。

---

## Docker 中运行的内容（概述）

- **Traefik：** HTTPS 证书和路由到仪表板、API 和摄取主机名。
- **Postgres / Redis：** 应用程序数据和队列。
- **MinIO：** 可选内部对象存储。
- **API：** 主要HTTP API。
- **摄取-上传：** 上传中继流量专用服务。
- **网址：** 仪表板静态 UI。
- **工人：** 处理摄取队列、重播工件、会话生命周期、计划的保留式工作和警报。

该堆栈中有 **不** 单独计费批量worker；配置密钥时，计费集成由 Stripe 和 API 驱动。

---

## 配置您的移动应用程序

将 SDK 指向 **你的** API 主机（必须匹配 `API_DOMAIN` / `PUBLIC_API_URL`）。

### React Native 示例

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

使用您真实的 API URL。当服务器配置正确时，会自动派生 `ingest.<your-domain>` 的上传 URL。

---

## 备份

至少，备份 **PostgreSQL**、 **`.env.selfhosted`** 和（如果您使用内置 MinIO） **对象存储数据**。

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

详细信息：[备份与恢复](/docs/selfhosted/backup-recovery)。

---

## 故障排除和支持

- [故障排除](/docs/selfhosted/troubleshooting) — 引导失败、TLS、空重放、外部 S3 问题。
- [备份与恢复](/docs/selfhosted/backup-recovery) — 恢复顺序和MinIO。

对于这些文档的错误或改进，请使用 GitHub 上的项目公共问题跟踪器。

---

## 相关文档

- [分布式云与单节点云](/docs/distributed-vs-single-node/distributed-vs-single-node) — 与多服务云布局（概念性）的比较。
