# 分布式云与单节点云

Rejourney 支持两种官方自托管部署形态：

- **单节点 Docker Compose** 适用于一台服务器或 VPS
- **分布式 K3s** 用于生产集群和水平扩展

两者现在都使用相同的核心后端模型：

- 存储端点由数据库支持
- 摄取上传通过后端拥有的上传中继
- 工人处理经过验证的工件
- 重放可见性是由工件驱动的

---

## 特性比较

|特色 |分布式云|单节点云 |
|---------|--------------------|-------------------|
|平台| K3s | Docker Compose |
|规模|多节点 |单节点|
|公共入口点 | Traefik 入口 | Traefik 集装箱 |
|上传路径| API + 采集上传服务 | API + 摄取上传服务 |
|存储真相来源| `storage_endpoints` 表| `storage_endpoints` 表|
|默认对象存储 |外部 S3 |内置MinIO |
|外部 S3 支持 |是的 |是的 |
|秘密加密 | `STORAGE_ENCRYPTION_KEY` | `STORAGE_ENCRYPTION_KEY` |
|更新流程 | k8s 部署 + 作业 | `deploy.sh update` |

---

## 共享存储模型

在这两种部署模型中，运行时存储配置来自 Postgres，而不是来自 env 回退。

这意味着：

- 活动对象存储端点存储在 `storage_endpoints` 中
- 秘密访问密钥被加密为 `key_ref`
- 运行时读取数据库行
- 引导/安装脚本负责将 `.env` 输入同步到数据库行中

这使得自托管 Docker 比旧的后备模型更接近产品和 local-k8s。

---

## 何时选择单节点 Docker Compose

在以下情况下选择 Docker Compose：

- 您正在部署到一台 VPS 或裸机主机
- 您想要最快的安装路径
- 默认情况下你想要内置 MinIO
- 您不需要多节点扩展或 Kubernetes 操作

官方入口点：

- `docker-compose.selfhosted.yml`
- `scripts/selfhosted/deploy.sh`
- `docs/selfhosted/README.md`

---

## 何时选择分布式 K3s

在以下情况下选择 K3s：

- 你需要多个节点
- 你想要 Kubernetes 原生操作和秘密处理
- 您想要独立扩展 API、上传和工作人员服务
- 您需要滚动部署和更强的基础设施隔离

K3s 路径位于 `k8s/` 和 `scripts/k8s/` 下。

---

## 运营差异

主要区别不再是数据模型。它的操作形状：

- Compose：一台机器，一个Docker网络，一个操作员脚本
- K3s：多个 Pod、命名空间、集群入口、Kubernetes 作业和机密

---

## 实用指导

如果您想快速自托管，请从单节点 Compose 开始。

当您需要时请移至 K3s：

- 更多吞吐量
- 滚动集群部署
- 水平缩放
- 更具弹性的基础设施分离

---

## 内部架构文档

有关最新的内部工程视觉效果和更深入的操作细节：

- `dev_docs/ingest-session-recording-lifecycle.md`（会话生命周期图）
- `dev_docs/storage-and-endpoints.md`（多桶拓扑图）
- `dev_docs/allthingscloud.md`（k3s云设置图）

### 会话生命周期

![会话生命周期架构](./assets/session-lifecycle.svg)

### 多桶拓扑

![多桶存储拓扑](./assets/multi-bucket-topology.svg)

### K3s 云设置

![K3s分布式云架构](./assets/k3s-cloud-setup.svg)
