# CI/CD & 自动化测试

Rejourney 使用 GitHub Actions 来确保整个 monorepo 的代码质量。每个拉取请求和推送到主分支都会触发一系列全面的测试。

## 测试套件

### 1. 后端API测试
这些测试位于`backend/`目录中，确保核心逻辑和数据库交互稳定。
* **棉绒**：使用 ESLint 强制代码风格并捕获常见错误。
* **单元测试**：由 Vitest 提供支持，测试服务逻辑、实用功能和 API 控制器。
* **构建验证**：确保 TypeScript 源代码正确编译到最终发行版中。

### 2. React Native SDK 测试
这些测试位于 `packages/react-native/`，对于跨平台稳定性至关重要。
* **TypeScript 检查**：验证整个 SDK 的类型，捕获潜在的桥不匹配。
* **棉绒**：强制执行一致的代码质量。
* **构建验证**：运行准备脚本以确保可以捆绑包进行分发。

### 3. Web 仪表板测试
位于`dashboard/web-ui/`，重点关注用户界面和SSR。
* **TypeScript 检查**：包含React Router类型生成，确保路由安全。
* **SSR构建**：验证整个 Remix/React Router 应用程序是否可以构建用于服务器端渲染。

---

## 本机集成测试
我们的 CI/CD 最强大的部分之一是在真实平台环境中验证 SDK。

### iOS 集成（macos 最新）
* **全新安装**：CI从头开始创建一个全新的React Native项目。
* **包注入**：它使用`npm pack`捆绑本地SDK并将其安装到测试应用程序中。
* **CocoaPods 验证**：运行 `pod install` 以确保本机依赖项和 podspec 正确链接。
* **构建验证**：执行 `xcodebuild` 以确保测试应用程序在集成 SDK 的情况下成功编译。

### Android 集成（ubuntu-最新）
* **全新安装**：与iOS类似，初始化一个基于Android的新项目React Native。
* **构建验证**：运行 `./gradlew assembleDebug` 以确保 Android 本机代码中没有明显的冲突或编译错误。

---

## 部署和发布逻辑

### 自动化云部署（VPS）
生产环境的部署是通过版本控制来控制的。
* **版本检查**：专用作业将根 `package.json` 版本与之前的提交进行比较。
* **条件触发**：仅当版本已增加时部署才会继续。
* **自动推出**：如果触发，它将应用最新的 K8s 清单并执行所有部署（api、web 和工作线程）的滚动重启。

### 自动化 SDK 发布 (NPM)
我们维护 `rejourney` 包的无缝发布流程。
* **路径敏感**：仅当`packages/react-native/`内的文件被修改时触发。
* **注册表检查**：将本地包版本与 NPM 注册表上的最新版本进行比较。
* **自动发布**：如果本地版本较高，则所有测试通过后自动将新版本发布到NPM。
