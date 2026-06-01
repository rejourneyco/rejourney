<!-- AI_PROMPT_SECTION -->
**使用 Cursor、Claude 或 ChatGPT？** 复制集成提示并将其粘贴到 AI 助手中以自动生成设置代码。

<!-- /AI_PROMPT_SECTION -->

## 安装

### Swift Package Manager

通过 **文件→添加包依赖项** 在Xcode中添加Rejourney包，并输入：

```
https://github.com/rejourneyco/rejourney
```

或者直接将其添加到您的 `Package.swift` 中：

```swift
dependencies: [
    .package(url: "https://github.com/rejourneyco/rejourney", from: "0.3.0")
],
targets: [
    .target(
        name: "YourApp",
        dependencies: [
            .product(name: "Rejourney", package: "rejourney")
        ]
    )
]
```

> [!NOTE]
> Rejourney 需要 iOS 15.1 或更高版本。

## Swift 设置

在 `@main` App 结构中初始化并启动 Rejourney。

```swift
import SwiftUI
import Rejourney

@main
struct MyApp: App {

    @MainActor
    init() {
        Rejourney.configure(publicKey: "rj_your_public_key")
        Task { await Rejourney.start() }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

如果使用`UIApplicationDelegate`，则在`application(_:didFinishLaunchingWithOptions:)`中调用`configure`：

```swift
import UIKit
import Rejourney

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    @MainActor
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        Rejourney.configure(publicKey: "rj_your_public_key")
        Task { await Rejourney.start() }
        return true
    }
}
```

`start()` 解析后立即开始记录。如果需要，您可以检查结果：

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## 远程录音设置

项目设置可以控制 Swift 录制默认值，而无需发布新的应用程序版本。支持的 SDK 版本在调用 `start()` 时读取这些设置：

|设置|行为 |
|---|---|
|采样率|默认为 `100%`。采样会话正常捕获。采样会话在重放捕获、网络拦截、上传或其他包工作开始之前返回。 |
|最大可观测持续时间 |限制每个可观察性会话的最大长度。 |
|记录 FPS |默认为 `1 FPS`。项目管理员可以选择 `1`、`2` 或 `3 FPS`。如果远程配置不可用，SDK 将回退到本地/默认捕获行为。 |
|文本输入隐私 |默认屏蔽所有文本输入。仅安全模式使密码/安全字段保持屏蔽，并允许其他文本输入出现在调试重放中。 |

## 屏幕追踪

Rejourney 不会自动挂钩到 SwiftUI 导航，因此每当用户导航到新屏幕时都会调用 `trackScreen`。

### SwiftUI

使用 `.onAppear` 或导航感知修改器：

```swift
struct CountriesListView: View {
    var body: some View {
        List { /* ... */ }
            .onAppear {
                Rejourney.trackScreen("Countries List")
            }
    }
}
```

### 用户界面工具包

在`viewDidAppear`内部调用`trackScreen`：

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### 导航路径/导航堆栈

观察导航路径并跟踪变化：

```swift
@State private var path = NavigationPath()

NavigationStack(path: $path) {
    ContentView()
}
.onChange(of: path) { _ in
    // derive screen name from path and call trackScreen
    Rejourney.trackScreen(currentScreenName(from: path))
}
```

## 用户识别

将会话与您自己的用户 ID 相关联，以便您可以在仪表板中找到特定用户。

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **隐私：** 使用内部 ID 或 UUID。如果必须使用 PII（电子邮件、电话），请在传入之前对其进行哈希处理。

通过 `UserDefaults` 在应用程序启动期间保留身份 - 您只需在每次登录时调用 `identify` 一次，而不是在每次打开应用程序时调用 `identify`。

## 自定义事件

跟踪有意义的用户操作以了解行为、调试问题并过滤仪表板中的会话重播。

### 基本用法

```swift
import Rejourney

// Simple event (name only)
Rejourney.logEvent("signup_completed")

// Event with properties
Rejourney.logEvent("button_tapped", properties: ["buttonName": "get_started"])
```

### API

```swift
Rejourney.logEvent(_ name: String, properties: [String: RejourneyMetadataValue] = [:])
```

|参数|类型 |必填|描述 |
|---|---|---|---|
| `name` | `String` |是的 |事件名称 — 使用 `snake_case` 保持一致性 |
| `properties` | `[String: RejourneyMetadataValue]` |没有 |附加到此事件的键值对 |

`RejourneyMetadataValue` 直接接受 Swift 文字 - 无需包装：

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### 示例

```swift
// E-commerce
Rejourney.logEvent("purchase_completed", properties: [
    "plan": "pro",
    "amount": 29.99,
    "currency": "USD"
])

// Onboarding
Rejourney.logEvent("onboarding_step", properties: [
    "step": 3,
    "stepName": "profile_setup",
    "skipped": false
])

// Feature usage
Rejourney.logEvent("feature_used", properties: [
    "feature": "dark_mode",
    "enabled": true
])

// Errors / edge cases
Rejourney.logEvent("payment_failed", properties: [
    "errorCode": "card_declined",
    "retryCount": 2
])
```

### 事件如何显示在仪表板中

自定义事件按会话存储并在两个位置可见：

1. **会话重播时间线** — 事件在重播时间线上显示为标记，以便您可以跳转到操作发生的确切时刻。
2. **会话存档过滤器** — 按以下方式过滤会话列表：
   - **活动名称** — 查找包含特定事件的所有会话（例如 `purchase_completed`）
   - **事件计数** — 查找具有特定数量自定义事件的会话

### 最佳实践




> [!TIP]
> - 使用一致的命名（`snake_case`，例如 `button_tapped` 不是 `Button Tapped`）
> - 保持属性值简单（字符串、数字、布尔值）——避免深度嵌套的对象
> - 专注于对调试或分析重要的操作 - 不要记录所有内容

## 隐私控制

默认情况下，文本输入和摄像机视图会自动屏蔽。项目管理员可以在项目设置中更改受支持的 SDK 版本的默认文本输入屏蔽级别。安全/密码字段、摄像头视图和显式掩码仍然受到保护。

要隐藏其他敏感视图，请使用 `mask` 和 `unmask` API：

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

对于 SwiftUI，通过 `UIViewRepresentable` 包装器或 `introspect` 获取底层 `UIView`。

#### 原生床单

默认情况下启用本机工作表捕获 (`captureNativeSheets: true`)。当操作系统允许捕获时，这允许应用程序拥有的本机工作表和对话框（例如支付授权模式）出现在调试重放中。当默认情况下屏蔽文本输入时，键盘/文本输入系统工作表将被排除。当文本输入屏蔽设置为仅安全字段时，键盘只能尽力而为，并且无法可靠地捕获，因为 iOS 可能会将它们呈现为受保护或远程系统表面。操作系统共享表也只能尽力而为，当系统将其呈现为受保护或远程表面时，无法可靠地捕获它们。

如果您希望视觉重播仅限于主应用程序窗口，请禁用本机工作表捕获：

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### 用户同意 & GDPR




> [!IMPORTANT]
> **您是数据控制者。** Rejourney 代表您充当数据处理器。您有责任确保您的最终用户了解会话记录，并确保您拥有处理其数据的有效法律依据（例如同意或合法权益）。

#### 你必须做什么

1. **在应用程序的隐私政策中披露会话记录。** 包括以下语言：

   > * “我们使用 Rejourney 记录您的应用内活动的匿名和非匿名会话重播，以帮助我们改进产品、跟踪崩溃和问题并减少产品摩擦。会话数据可能包括屏幕交互、设备信息和大致位置。文本输入和敏感 UI 元素会被自动屏蔽，并且永远不会被捕获。”*

2. **同意后的门记录**（推荐欧洲经济区用户）：

   ```swift
   // Configure early — before consent is known
   Rejourney.configure(publicKey: "rj_your_public_key")

   // Call start() only after the user accepts your privacy policy
   func onUserConsented() {
       Task { @MainActor in
           await Rejourney.start()
       }
   }
   ```

3. **尊重选择退出。** 如果用户撤回同意，则停止录音并清除身份：

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### 仅观察模式（无视觉记录）

要捕获错误、崩溃、ANRs 和网络活动 **没有** 记录视觉重播，请设置 `observeOnly: true`：

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

启用后，将收集所有遥测数据，但不会截取屏幕截图 - 会话不会出现在“重播”页面中，但仍会捕获完整的分析、错误、网络和崩溃数据。当用户选择退出屏幕录制但您仍然希望看到错误时非常有用。

> **笔记：** 这可以根据存储的首选项或同意标志有条件地为每个用户设置：
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### 网络抓拍

网络请求捕获（默认为 `autoTrackNetwork: true`）通过自定义 `URLProtocol` 拦截 `URLSession` 流量。如果您不想收集网络数据，请将其禁用：

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### 地理定位

默认情况下会收集源自 IP 的地理位置（国家、地区、城市）。禁用它以完全抑制查找：

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## 配置参考

所有选项在 `configure` 中设置一次，调用 `start` 后不能更改。

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(
        apiURL:             URL(string: "https://api.rejourney.co")!,
        userId:             nil,
        enabled:            true,
        observeOnly:        false,
        captureFPS:         nil,
        captureQuality:     .medium,
        wifiOnly:           false,
        captureScreen:      true,
        captureAnalytics:   true,
        captureCrashes:     true,
        captureANR:         true,
        trackConsoleLogs:   true,
        collectGeoLocation: true,
        autoTrackNetwork:   true,
        captureNativeSheets: true,
        debug:              false
    )
)
```

|选项 |类型 |默认 |描述 |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` |自托管部署的覆盖 |
| `userId` | `String?` | `nil` |可选的初始内部用户 ID |
| `enabled` | `Bool` | `true` |主终止开关 — 设置为 `false` 以完全禁用 SDK |
| `observeOnly` | `Bool` | `false` |仅收集遥测数据，无视觉记录 |
| `captureFPS` | `Int?` | `nil` |可选的本地捕获 FPS 回退。远程项目设置记录 FPS（如果可用）优先 |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | JPEG 捕获质量（`.low`、`.medium`、`.high`）|
| `wifiOnly` | `Bool` | `false` |仅在 Wi-Fi 上上传会话数据 |
| `captureScreen` | `Bool` | `true` |启用/禁用视觉屏幕捕获 |
| `captureAnalytics` | `Bool` | `true` |启用/禁用分析事件收集 |
| `captureCrashes` | `Bool` | `true` |启用/禁用崩溃报告 |
| `captureANR` | `Bool` | `true` |启用/禁用 ANR（应用程序无响应）检测 |
| `trackConsoleLogs` | `Bool` | `true` |捕获会话的控制台日志 |
| `collectGeoLocation` | `Bool` | `true` |收集源自 IP 的地理位置 |
| `autoTrackNetwork` | `Bool` | `true` |拦截`URLSession`网络抓包请求|
| `captureNativeSheets` | `Bool` | `true` |当 iOS 允许捕获时，在视觉重播中包括应用程序拥有的本机工作表/对话框窗口。操作系统共享表和键盘可能受到保护或远程表面并且无法可靠地捕获|
| `debug` | `Bool` | `false` |将详细 SDK 日志打印到控制台 |

## 停止录音

停止当前会话并刷新待处理数据：

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

回调变体可用于非异步上下文：

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## 会话ID

随时访问当前会话 ID 以与您自己的日志或支持工具关联：

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
