# 贡献给 Rejourney

我们欢迎贡献！请参阅下面的指南来开始。

## 项目结构

这是由 npm 工作区管理的单一存储库。

## 先决条件

1. **Node.js** >= 18.0.0
2. **npm** 或 **yarn**（工作区适用于两者）
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**：Xcode 和 CocoaPods
7. **Android**：Android Studio 和 JDK 17

## 初始设置

### 1. 安装依赖项

来自 monorepo 的 **根**：

```bash
npm install
```

这将：
- 安装所有工作区依赖项
- 自动构建SDK包（通过根`package.json`中的`postinstall`脚本运行`npm run build:sdk`）
- 正确链接所有包

### 2. 构建SDK

如果更改后需要重建 SDK：

```bash
npm run build:sdk
```

或者对于干净的构建：

```bash
npm run build:clean
```

## 后端开发（本地Kubernetes）

Rejourney 使用 `local-k8s/` 进行本地开发，因此运行时保持接近生产 Kubernetes 设置，同时仍保持每日循环快速。

### 1、配置`.env.k8s.local`

复制本地Kubernetes环境模板：

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. 启动混合开发堆栈

```bash
npm run dev
```

那个流程：

- 如果需要，创建本地 `k3d` 集群
- 适用于 `local-k8s/namespace.yaml`、`postgres.yaml`、`redis.yaml` 和 `minio.yaml`
- 将 `.env.k8s.local` 同步到 Kubernetes 机密
- 在主机上从源运行 API、仪表板和工作程序

对于完整的集群内奇偶校验运行：

```bash
npm run dev:full
```

停止本地堆栈：

```bash
npm run dev:down
```

### 3. IP地址配置（物理设备测试）

如果您在连接到同一 WiFi 的 **物理设备**（iOS 或 Android）上进行测试，则 SDK 和仪表板需要知道您计算机的本地 IP 地址才能进行通信。

#### 查找您的 IP 地址 (Mac)

在终端中运行以下命令：

```bash
ipconfig getifaddr en0
```

或者在 **系统设置 > WiFi > [您的网络]详细信息** 中查找。

#### 更新`.env.k8s.local`

以下变量 **必须** 使用您的本地 IP 地址（例如 `http://192.168.1.5:3000`）而不是 `localhost`：

|变量|关键用法|
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` |公众访问MinIO进行视频回放|
| `PUBLIC_DASHBOARD_URL` |仪表板 UI 的基本 URL |
| `PUBLIC_API_URL` | API 的基本 URL |
| `PUBLIC_INGEST_URL` | SDK 事件摄取的基本 URL |
| `DASHBOARD_ORIGIN` |仪表板的 CORS 起源 |
| `OAUTH_REDIRECT_BASE` | OAuth 回调的基本 URL |




> [!IMPORTANT]
> 未能正确设置这些将导致物理设备上出现“连接被拒绝”错误或仪表板中的图像/视频链接损坏。

`npm run dev` 通过 `scripts/local-k8s/update-ips.sh` 自动更新这些面向 LAN 的值，并且它还写入 Expo 应用程序使用的示例应用程序环境文件。

#### 配置示例（`.env.k8s.local`）

假设您的计算机的IP地址是`192.168.1.100`：

```env
# Object storage (host access to local-k8s MinIO)
S3_ENDPOINT=http://127.0.0.1:9000
S3_PUBLIC_ENDPOINT=http://192.168.1.100:9000

# Public URLs
PUBLIC_DASHBOARD_URL=http://192.168.1.100:8080
PUBLIC_API_URL=http://192.168.1.100:3000
PUBLIC_INGEST_URL=http://192.168.1.100:3000
DASHBOARD_ORIGIN=http://192.168.1.100:8080
OAUTH_REDIRECT_BASE=http://192.168.1.100:3000
```

### 4. 本地Kubernetes文件

本地 Kubernetes 清单有意镜像生产 `k8s/` 布局：

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## 运行示例应用程序

### React Native 样板 (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

或者从示例目录：

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### 冲泡咖啡实验室 (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native 裸机

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## 它是如何运作的

### 工作区设置

monorepo 使用 npm 工作区作为核心包，但示例应用程序是独立的：

1. **根 `package.json`** 工作区中仅包括 `packages/*`、`backend` 和 `dashboard/web-ui`
2. **示例应用程序是独立的** - 他们有自己的 `node_modules` 以避免依赖冲突
3. **示例应用程序** 使用 `"rejourney": "file:../../packages/react-native"` 引用 SDK
4. **地铁配置** 配置为正确监视和解析 SDK 包

**为什么示例不在工作区中：**
- 示例应用程序使用不同的 Expo/React Native 版本
- 防止 npm 依赖重复数据删除冲突
- 每个示例都可以有自己完整的依赖关系树

### 地铁配置

每个示例应用程序都有一个 `metro.config.js` ：

1. **手表** SDK 源目录（`packages/react-native`）进行更改
2. **解决** 将`rejourney`封装到正确的位置
3. **积木** 工作区根目录中的重复 `react-native` 和 `react` 包

### 代码生成（TurboModules）

如果满足以下条件，React Native 的代码生成器会在构建应用程序时自动运行：

1. SDK 的 `package.json` 已定义 `codegenConfig` ✅
2. 规范文件（`NativeRejourney.ts`）遵循命名约定✅
3. 该应用程序包含 SDK 包 ✅

Codegen 在以下期间自动运行：
- `npm run ios`（iOS 构建）
- `npm run android`（Android 构建）

## 项目结构

```
rejourney/
├── packages/
│   └── react-native/          # SDK package
│       ├── src/                # TypeScript source
│       ├── android/           # Android native code
│       ├── ios/               # iOS native code
│       └── package.json       # Package config with codegenConfig
├── examples/
│   ├── react-native-boilerplate/  # Expo example
│   ├── brew-coffee-labs/          # Expo example
│   └── react-native-bare/         # Bare RN example
└── package.json               # Root workspace config
```

## CI/CD & 部署

Rejourney 使用 GitHub Actions 在整个 monorepo 中自动化测试、构建和部署。

有关我们的测试套件、本机集成测试和自动化部署逻辑的详细细分，请参阅[CI/CD 和测试文档](/docs/architecture/ci-cd)。

---

探索[架构比较](/docs/architecture/distributed-vs-single-node)，了解有关云 (K8s) 与自托管 (Docker) 的详细信息。

## 最佳实践

1. **始终构建 SDK** 测试前：`npm run build:sdk`
2. npm 工作区的 package.json 中的 **使用文件协议** (`file:../../packages/react-native`)
3. **清除 Metro 缓存** 出现问题时：`npm start -- --reset-cache`
4. SDK 本机代码更改后的 **重建本机应用程序**
5. **在 iOS 和 Android 上进行测试** 提交前
