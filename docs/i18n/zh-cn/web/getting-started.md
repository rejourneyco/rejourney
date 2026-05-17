<!-- AI_PROMPT_SECTION -->
**使用 Cursor、Claude 或 ChatGPT？** 复制集成提示并将其粘贴到 AI 助手中以自动生成设置代码。

<!-- /AI_PROMPT_SECTION -->

## 安装

使用 npm 或 yarn 将 Rejourney 包添加到您的项目中。

```bash
npm install @rejourneyco/browser
```

## 基本设置

在应用程序的入口点初始化并启动 Rejourney。

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init` 获取项目的远程配置并准备 SDK。 `start` 开始会话，注册访客，并且（如果启用重播）启动 rrweb 记录器。如果您不需要在完成时对任何内容进行门控，则两者都是异步且可以安全调用，无需等待。




> [!NOTE]
> `autoStart` 默认为 `false`。您必须显式调用 `start()`，这样您就可以在同意检查后控制录音。要在 `init` 之后自动启动，请传递 `{ autoStart: true }`。

### 框架集成

该软件包为流行框架提供了专用入口点。使用与您的堆栈相匹配的版本 - 或使用任何框架中的上述普通 API。

---

#### 反应

```javascript
import { RejourneyProvider, useRejourney } from '@rejourneyco/browser/react';

// Wrap your app root
function App() {
  return (
    <RejourneyProvider publicKey="pk_live_your_public_key" startOnMount>
      <YourApp />
    </RejourneyProvider>
  );
}

// Access the SDK anywhere inside the tree
function MyComponent() {
  const rejourney = useRejourney();

  function handlePurchase() {
    rejourney.logEvent('purchase_completed', { plan: 'pro' });
  }
}
```

`startOnMount` 在 `RejourneyProvider` 上默认为 `false`。组件安装后，通过 `startOnMount`（或 `startOnMount={true}`）开始录制。

---

#### Next.js

```javascript
// app/layout.tsx (or pages/_app.tsx)
import { RejourneyNext } from '@rejourneyco/browser/next';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <RejourneyNext publicKey="pk_live_your_public_key" />
        {children}
      </body>
    </html>
  );
}
```

`RejourneyNext` 是呈现 `null` 的 `'use client'` 组件。 `startOnMount` 默认为 `true`。通过历史记录 API 自动跟踪路线更改。

---

#### 维埃

```javascript
// main.ts
import { createApp } from 'vue';
import { createRejourney } from '@rejourneyco/browser/vue';
import App from './App.vue';
import router from './router';

const app = createApp(App);

app.use(createRejourney({
  publicKey: 'pk_live_your_public_key',
  router, // optional — enables per-route screen tracking via router.afterEach
}));

app.use(router).mount('#app');
```

Rejourney 实例可通过 `app.config.globalProperties.$rejourney` 和 `inject('rejourney')` 获取。为了方便起见，还导出了 `useRejourney()` 可组合项。

---

#### 努克斯特

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

`.client.ts` 后缀确保该插件仅在浏览器中运行。 Rejourney 实例作为 `$rejourney` 注入，并可通过 `useNuxtApp().$rejourney` 获取。

---

#### Svelte / SvelteKit

```javascript
// +layout.svelte
<script>
  import { onMount } from 'svelte';
  import { startRejourneyOnMount } from '@rejourneyco/browser/svelte';

  onMount(() => startRejourneyOnMount({ publicKey: 'pk_live_your_public_key' }));
</script>
```

`startRejourneyOnMount` 返回一个调用 `Rejourney.stop()` 的清理函数 — Svelte 的 `onMount` 返回值自动用作销毁回调。

---

#### 角

```javascript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { createRejourneyAppInitializer } from '@rejourneyco/browser/angular';

export const appConfig: ApplicationConfig = {
  providers: [
    {
      provide: APP_INITIALIZER,
      useFactory: () => createRejourneyAppInitializer({ publicKey: 'pk_live_your_public_key' }),
      multi: true,
    },
  ],
};
```

`createRejourneyAppInitializer` 返回一个工厂，该工厂在 Angular 的引导阶段初始化并启动 Rejourney。您还可以为基于类的 API 注入 `RejourneyService`。

---

#### 混音

```javascript
// app/root.tsx
import { RejourneyRemix } from '@rejourneyco/browser/remix';

export default function App() {
  return (
    <html>
      <body>
        <RejourneyRemix publicKey="pk_live_your_public_key" />
        <Outlet />
      </body>
    </html>
  );
}
```

`startOnMount` 默认为 `true`。自动跟踪路线变化。

---

#### 阿斯特罗

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

SSR 环境中的 `startRejourneyForAstro` 无操作 — 它在运行之前检查 `window`。

---

## 远程录音设置

项目设置可以控制网络录制默认值，而无需部署代码。 SDK 在每次 `start()` 调用时读取远程配置。远程配置可以完全启用或禁用记录、调整允许的域列表以及设置最大会话持续时间。如果远程配置不可用，`start()` 将不会继续 - 这是为了防止在未知项目状态下进行记录。

## 路线追踪

Rejourney 自动跟踪页面和路线更改，以便您可以在重播中查看导航上下文。默认情况下启用此功能 (`autoTrackRoutes: true`)，并通过拦截历史记录 API 调用（`pushState`、`replaceState`）并侦听 `popstate` 事件来工作。

### 自定义路线名称

默认情况下，当前的 `window.location.pathname` 用作屏幕名称。要提供您自己的命名逻辑，请传递 `routeName` 函数：

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### 手动屏幕跟踪

要手动跟踪屏幕（例如选项卡更改或页内视图转换），请直接调用 `trackScreen`：

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

要禁用自动路线跟踪并仅依靠手动调用：

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## 用户识别

将会话与您的内部用户 ID 相关联，以在仪表板中过滤和搜索特定用户。

```javascript
import { Rejourney } from '@rejourneyco/browser';

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
import { Rejourney } from '@rejourneyco/browser';

// Simple event (name only)
Rejourney.logEvent('signup_completed');

// Event with properties
Rejourney.logEvent('button_clicked', { buttonName: 'signup' });
```

### API

```typescript
Rejourney.logEvent(name: string, properties?: Record<string, unknown>)
```

|参数|类型 |必填 |描述 |
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

### 事件如何在仪表板中显示

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
import { Rejourney } from '@rejourneyco/browser';

// Set a single property
Rejourney.setMetadata('plan', 'premium');

// Set multiple properties at once
Rejourney.setMetadata({
  role: 'admin',
  segment: 'enterprise',
  ab_variant: 'checkout_v2'
});
```

元数据值必须是 `string`、`number` 或 `boolean`。不接受对象和数组。

### 何时使用元数据与事件

|使用案例|使用 **元数据** |使用 **活动** |
|---|---|---|
|用户订阅计划 | `setMetadata('plan', 'pro')` | |
|用户单击按钮 | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| A/B 测试变体 | `setMetadata('ab_variant', 'v2')` | |
|购买完成 | | `logEvent('purchase', { amount: 29 })` |
|用户角色 | `setMetadata('role', 'admin')` | |
|已达到入职步骤 | | `logEvent('onboarding_step', { step: 3 })` |

**经验法则：** 如果描述*用户是谁*或*他们处于什么状态*，请使用元数据。如果它描述*发生的事情*，请使用事件。

## 隐私控制

默认情况下，所有文本输入都会被屏蔽 (`maskAllInputs: true`)。屏蔽字段在重播中显示为空白输入，并且永远不会在源处捕获这些值。无论此设置如何，密码、电子邮件、电话和其他敏感输入类型始终会被屏蔽。

### 阻挡元件

要从重播中完全排除 DOM 元素（它显示为实心占位符），请添加以下内容之一：

- CSS 类：`rr-block`
- 数据属性：`data-rj-block` 或 `data-rejourney-block`
- 通过 `blockSelector` 配置选项自定义 CSS 选择器

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### 屏蔽文本

要屏蔽元素的文本内容（文本被替换，但元素的形状仍然可见），请添加以下内容之一：

- CSS 类：`rr-mask`
- 数据属性：`data-rj-mask`、`data-rejourney-mask`、`data-private` 或任何包含 `"password"` 的 `data-testid`
- 通过 `maskTextSelector` 配置选项自定义 CSS 选择器

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### 忽略元素

要捕获元素的形状但抑制其上的所有交互事件（单击、输入），请添加：

- CSS 类：`rr-ignore`
- 数据属性：`data-rj-ignore` 或 `data-rejourney-ignore`

### 自定义屏蔽功能

对于编程屏蔽逻辑，请使用 `maskInputFn` 或 `maskTextFn`：

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### 用户同意 & GDPR




> [!IMPORTANT]
> **您是数据控制者。** Rejourney 代表您充当数据处理器。您有责任确保您的最终用户了解会话记录，并确保您拥有处理其数据的有效法律依据（例如同意或合法权益）。

#### 你必须做什么

1. **在您的隐私政策中披露会话记录。** 包括以下语言：

   > * “我们使用 Rejourney 记录您在我们网站上的活动的匿名和非匿名会话重播，以帮助我们改进产品并减少摩擦。会话数据可能包括页面交互、浏览器信息和大致位置。文本输入和敏感元素会被自动屏蔽并且永远不会被捕获。”*

2. **同意后的门记录**（推荐欧洲经济区用户）：

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **尊重选择退出。** 如果用户撤回同意，则停止录音并清除身份：

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### 通过 `setConsent` 进行细化同意

为了进行更精细的控制，请使用 `setConsent` 独立切换分析和重放：

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

将 `analytics: false` 和 `replay: false` 设置在一起会停止会话并清除所有排队的数据。单独设置 `replay: false` 会停止 rrweb 记录器，但保持事件跟踪运行。

#### 控制台日志捕获

默认情况下禁用控制台日志捕获（`trackConsoleLogs: false`）。仅在需要时才启用它，因为控制台日志可能包含 PII，具体取决于您的日志记录实践：

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### 地理定位

默认情况下会收集源自 IP 的地理位置（国家、地区、城市）。当 `collectGeoLocation` 为 `false` 时，SDK 会传递一个禁止后端 IP 地理位置查找的标志 - 不会为该会话存储位置数据：

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### 仅观察模式（无视觉记录）

要捕获错误、长任务、网络活动和分析 **没有** 记录视觉重放，请设置 `observeOnly: true`：

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

启用后，将收集所有遥测数据，但不会运行 rrweb 记录 - 会话不会出现在“重播”页面中，但仍会捕获完整的分析、错误和网络数据。当用户选择退出视觉记录但您仍然需要可观察性时很有用。

> **笔记：** 您可以根据每个用户有条件地设置此设置，例如基于存储的同意首选项：
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### 机器人检测

默认情况下会忽略机器人和自动浏览器 (`ignoreBots: true`)。 Playwright、Puppeteer、Selenium 和其他基于 Webdriver 的客户端均受到抑制。记录自动化会话（例如用于内部工具）：

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

提供自定义机器人检测模式：

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### 网络请求捕获

默认情况下会拦截并记录网络请求（fetch 和 XHR）（`autoTrackNetwork: true`）。默认捕获的请求和响应正文大小为 **不是** (`networkCaptureSizes: false`)。 URL、方法、状态代码和持续时间始终会被捕获。

要排除特定 URL：

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

要在发送请求之前过滤或编辑请求：

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## 配置参考

|选项 |类型 |默认|描述 |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | `init()`完成后自动调用`start()` |
| `disableInDev` | `boolean` | `false` |抑制 `localhost` 和 `127.0.0.1` 上的录音 |
| `debug` | `boolean` | `false` |启用浏览器控制台的详细 SDK 日志记录 |
| `enabled` | `boolean` | `true` |主终止开关 — 设置为 `false` 以防止任何录音 |
| `observeOnly` | `boolean` | `false` |无需视觉重放即可捕获分析/错误/网络 |
| `captureReplay` | `boolean` | `true` |启用 rrweb 视觉重播捕获 |
| `allowedDomains` | `string[]` | `[]` |限制录制到特定域。空表示允许所有域。支持 `*.example.com` 通配符 |
| `maxSessionDuration` | `number` | `1800000` |最大会话长度（以毫秒为单位）（默认值：30 分钟）|
| `collectGeoLocation` | `boolean` | `true` |收集IP衍生国家/地区/城市 |
| `captureAttribution` | `boolean` | `true` |在会话开始时捕获 UTM 参数、引荐来源网址和入口 URL |
| `ignoreBots` | `boolean` | `true` |禁止记录检测到的机器人和网络驱动程序 |
| `recordAutomation` | `boolean` | `false` |允许录制 Playwright/Puppeteer/Selenium 会话 |
| `autoTrackRoutes` | `boolean` | `true` |通过历史记录自动跟踪路线变化 API |
| `routeName` | `(location: Location) => string` | — |从 `window.location` 派生屏幕名称的自定义函数 |
| `autoTrackNetwork` | `boolean` | `true` |拦截并记录获取/XHR 请求 |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — |从网络跟踪中排除的 URL |
| `networkCaptureSizes` | `boolean` | `false` |在网络日志中包含请求/响应正文大小 |
| `trackConsoleLogs` | `boolean` | `false` |捕获 `console.log/warn/error` 输出 |
| `trackLongTasks` | `boolean` | `true` |检测并记录长任务（JS 线程块> 50ms）|
| `trackResourceErrors` | `boolean` | `true` |捕获失败的资源加载（图像、脚本、样式表）|
| `maskAllInputs` | `boolean` | `true` |屏蔽重播中的所有文本输入值 |
| `blockClass` | `string \| RegExp` | `'rr-block'` | CSS 类完全阻止元素重播 |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | CSS 选择器可完全阻止元素重播 |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` |用于忽略元素上的交互事件的 CSS 类 |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | CSS 选择器忽略交互事件 |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` |用于在重播中屏蔽文本内容的 CSS 类 |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` |用于屏蔽文本内容的 CSS 选择器 |
| `maskInputFn` | `(value, element) => string` | — |在捕获之前转换输入值的自定义函数 |
| `maskTextFn` | `(text, element) => string` | — |在捕获之前转换文本内容的自定义函数 |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — |自定义函数决定每页加载是否记录 |
| `beforeSendEvent` | `(event) => event \| null` | — |在事件排队之前对其进行过滤或修改。返回`null`掉落|
| `beforeSendNetwork` | `(request) => request \| null` | — |在网络条目排队之前对其进行过滤或修改。返回`null`掉落|
| `onAuthError` | `(error) => void` | — | SDK 与后端认证失败时调用 |

## 停止录音

调用 `stop()` 结束会话，刷新所有待处理事件，并清除所有 SDK 侦听器：

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()` 多次调用是安全的。停止后，再次调用`start()`开始新的会话。

## 会话ID

访问当前会话 ID，将 Rejourney 会话与您自己的日志或支持工具相关联：

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

如果没有活动会话，则返回 `null`。

## 状态助手

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```
