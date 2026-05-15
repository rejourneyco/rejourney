<!-- AI_PROMPT_SECTION -->
**使用 Cursor、Claude 或 ChatGPT？** 复制集成提示并将其粘贴到 AI 助手中以自动生成设置代码。

<!-- /AI_PROMPT_SECTION -->

## 安装

使用 npm 或 yarn 将 Rejourney 包添加到您的项目中。

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> Rejourney 需要本机代码，与 Expo Go 不兼容。使用开发版本：
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## 3 生产线设置

在应用程序顶部初始化并启动 Rejourney（例如在 App.tsx 或 index.js 中）。

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

不需要提供者包装。录音立即开始。

## 远程录音设置

项目设置可以控制 React Native 录制默认值，而无需发布新的应用程序版本。支持的 SDK 版本在会话启动时读取远程录制 FPS 设置；默认为 1 FPS，项目管理员可以选择 1、2 或 3 FPS。如果远程配置不可用，SDK 将回退到本地/默认捕获行为。

## 屏幕追踪

Rejourney 自动跟踪屏幕变化，以便您可以在重播期间查看用户在应用程序中的位置。选择与您的导航库匹配的设置：

### Expo Router（自动）

如果您使用 **Expo Router**，屏幕跟踪可以开箱即用。不需要额外的代码。




> [!TIP]
> **使用自定义屏幕名称？** 如果您使用 Expo Router 但想要手动提供自己的屏幕名称，请参阅下面的[自定义屏幕名称](#custom-screen-names) 部分。

---

### React Navigation

如果您使用 **React Navigation** (`@react-navigation/native`)，请在根 `NavigationContainer` 中使用 `useNavigationTracking` 挂钩：

```javascript
import { Rejourney } from '@rejourneyco/react-native';
import { NavigationContainer } from '@react-navigation/native';

function App() {
  const navigationTracking = Rejourney.useNavigationTracking();

  return (
    <NavigationContainer {...navigationTracking}>
      {/* Your screens */}
    </NavigationContainer>
  );
}
```

---

### 自定义屏幕名称

如果您想手动指定屏幕名称（例如，为了分析一致性或如果您不使用上述库），请使用 `trackScreen` 方法。

#### 对于Expo Router用户：
要将自定义名称与 Expo Router 一起使用，您必须首先在配置中禁用自动跟踪：

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### 手动跟踪调用：
每当屏幕发生变化时调用 `trackScreen`：

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## 用户识别

将会话与您的内部用户 ID 相关联，以在仪表板中过滤和搜索特定用户。

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **隐私：** 使用内部 ID 或 UUID。如果您必须使用 PII（电子邮件、电话），请在发送前对其进行哈希处理。

## 自定义事件

跟踪有意义的用户操作，以了解行为模式、调试问题并在仪表板中过滤会话重播。

### 基本用法

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Simple event (name only)
Rejourney.logEvent('signup_completed');

// Event with properties
Rejourney.logEvent('button_clicked', { buttonName: 'signup' });
```

### API

```typescript
Rejourney.logEvent(name: string, properties?: Record<string, unknown>)
```

|参数|类型 |必填|描述 |
|---|---|---|---|
| `name` | `string` |是的 |事件名称 — 使用 `snake_case` 保持一致性 |
| `properties` | `object` |没有 |附加到此特定事件发生的键值对 |

### 示例

```javascript
// E-commerce
Rejourney.logEvent('purchase_completed', {
  plan: 'pro',
  amount: 29.99,
  currency: 'USD'
});

// Onboarding
Rejourney.logEvent('onboarding_step', {
  step: 3,
  stepName: 'profile_setup',
  skipped: false
});

// Feature usage
Rejourney.logEvent('feature_used', {
  feature: 'dark_mode',
  enabled: true
});

// Errors / edge cases
Rejourney.logEvent('payment_failed', {
  errorCode: 'card_declined',
  retryCount: 2
});
```

### 事件如何显示在仪表板中

自定义事件按会话存储并在两个位置可见：

1. **会话重播时间线** — 事件在重播时间线上显示为标记，以便您可以跳转到操作发生的确切时刻。
2. **会话存档过滤器** — 按以下方式过滤会话列表：
   - **活动名称** — 查找包含特定事件的所有会话（例如 `purchase_completed`）
   - **事件属性** — 按属性键和/或值进一步缩小范围（例如 `plan = pro`）
   - **事件计数** — 查找具有特定数量自定义事件的会话（例如超过 5 个事件）

### 最佳实践




> [!TIP]
> - 使用一致的命名（`snake_case`，例如 `button_clicked` 不是 `Button Clicked`）
> - 保持属性值简单（字符串、数字、布尔值）——避免嵌套对象
> - 专注于对调试或分析重要的操作 - 不要记录所有内容
> - 属性适用于每个事件上下文。对于会话级属性，请改用 **元数据**

---

## 元数据

附加描述用户或会话上下文的会话级键值对。与事件不同，元数据每个键设置一次并应用于整个会话。

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Set a single property
Rejourney.setMetadata('plan', 'premium');

// Set multiple properties at once
Rejourney.setMetadata({
  role: 'admin',
  segment: 'enterprise',
  ab_variant: 'checkout_v2'
});
```

### 何时使用元数据与事件

|使用案例|使用 **元数据** |使用 **活动** |
|---|---|---|
|用户订阅计划 |  `setMetadata('plan', 'pro')` | |
|用户单击按钮 | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| A/B 测试变体 |  `setMetadata('ab_variant', 'v2')` | |
|购买完成 | |  `logEvent('purchase', { amount: 29 })` |
|用户角色 |  `setMetadata('role', 'admin')` | |
|已达到入职步骤 | |  `logEvent('onboarding_step', { step: 3 })` |

**经验法则：** 如果描述*用户是谁*或*他们处于什么状态*，请使用元数据。如果它描述*发生的事情*，请使用事件。

## 隐私控制

默认情况下，文本输入和摄像机视图会自动屏蔽。项目管理员可以在项目设置中更改支持的 SDK 版本的默认文本输入屏蔽级别；较旧的 SDK 版本会忽略该远程设置并保留其现有的屏蔽行为。安全/密码字段、摄像头视图和显式掩码仍然受到保护。

要手动隐藏其他敏感 UI，请将组件包装在 `Mask` 组件中：

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

屏蔽内容在重播中显示为实心矩形，并且永远不会在源处捕获。

### 用户同意 & GDPR




> [!IMPORTANT]
> **您是数据控制者。** Rejourney 代表您充当数据处理器。您有责任确保您的最终用户了解会话记录，并确保您拥有处理其数据的有效法律依据（例如同意或合法权益）。

#### 你必须做什么

1. **在应用程序的隐私政策中披露会话记录。** 包括以下语言：

   > * “我们使用 Rejourney 记录您的应用内活动的匿名和非匿名会话重播，以帮助我们改进产品、跟踪崩溃和问题并减少产品摩擦。会话数据可能包括屏幕交互、设备信息和大致位置。文本输入和敏感 UI 元素会被自动屏蔽，并且永远不会被捕获。”*

2. **同意后的门记录**（推荐欧洲经济区用户）：

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **尊重选择退出。** 如果用户撤回同意，则停止录制并清除其数据：

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### 控制台日志捕获

默认情况下启用控制台日志捕获（`trackConsoleLogs: true`）。控制台日志可能包含 PII，具体取决于应用程序的日志记录实践。如果日志中可能出现敏感数据，请禁用它：

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### 地理定位

默认情况下会收集源自 IP 的地理位置（国家、地区、城市）。当 `collectGeoLocation` 为 `false` 时，SDK 会将一个标志传递到本机层，以抑制后端的 IP 地理位置查找 — 不会为该会话存储任何位置数据。如果您不需要位置数据或希望最大限度地减少 EEA 用户的数据收集，请禁用它：

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### 原生床单

对于受支持的 SDK 版本，默认启用本机工作表捕获 (`captureNativeSheets: true`)。当操作系统允许捕获时，这允许应用程序拥有的本机工作表和对话框（例如支付授权模式）出现在调试重放中。当默认情况下屏蔽文本输入时，键盘/文本输入系统工作表将被排除。当文本输入屏蔽设置为仅安全字段时，键盘只能尽力而为，无法可靠地捕获，特别是当操作系统将它们呈现为受保护或远程表面时。操作系统共享表也只能尽力而为，当系统将其呈现为受保护或远程表面时，无法可靠地捕获它们。

如果您希望视觉重播仅限于主应用程序窗口，请禁用本机工作表捕获：

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### 仅观察模式（无视觉记录）

要捕获错误、崩溃、ANRs 和网络活动 **没有** 记录视觉重播，请设置 `observeOnly: true`：

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

启用后，将收集所有遥测数据，但不会截取屏幕截图 - 会话不会出现在您的重播页面中，但会有完整的分析/错误/网络/崩溃数据。没有重播。当用户选择退出屏幕录制但您仍然希望错误可见性时，这非常有用。

> **笔记：** 这可以根据每个用户有条件地设置，例如基于存储的首选项或同意标志：
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```
