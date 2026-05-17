<!-- AI_PROMPT_SECTION -->
**Cursor、Claude、または ChatGPT を使用していますか?** 統合プロンプトをコピーし、AI アシスタントに貼り付けて、セットアップ コードを自動生成します。

<!-- /AI_PROMPT_SECTION -->

## インストール

npm または yarn を使用して、Rejourney パッケージをプロジェクトに追加します。

```bash
npm install @rejourneyco/browser
```

## 基本的なセットアップ

アプリのエントリ ポイントで Rejourney を初期化して開始します。

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init` はプロジェクトのリモート構成を取得し、SDK を準備します。 `start` はセッションを開始し、訪問者を登録し、(再生が有効な場合) rrweb レコーダーを開始します。どちらも非同期であり、完了時に何もゲートする必要がない場合は、待機せずに安全に呼び出すことができます。




> [!NOTE]
> デフォルトでは、`autoStart` は `false` です。 `start()` を明示的に呼び出す必要があります。これにより、同意チェックの背後で記録をゲートできるようになります。 `init` の後に自動的に開始するには、`{ autoStart: true }` を渡します。

### フレームワークの統合

このパッケージには、一般的なフレームワークの専用エントリ ポイントが同梱されています。スタックに一致するものを使用するか、任意のフレームワークの上記の標準的な API を使用してください。

---

#### 反応する

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

`startOnMount` のデフォルトは、`RejourneyProvider` の `false` です。コンポーネントがマウントされるとすぐに記録を開始するには、`startOnMount` (または `startOnMount={true}`) を渡します。

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

`RejourneyNext` は、`null` をレンダリングする `'use client'` コンポーネントです。 `startOnMount` のデフォルトは `true` です。ルート変更は、履歴 API を介して自動的に追跡されます。

---

#### ヴュー

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

Rejourney インスタンスは、`app.config.globalProperties.$rejourney` および `inject('rejourney')` 経由で利用できます。 `useRejourney()` コンポーザブルも便宜上エクスポートされます。

---

#### ナクスト

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

`.client.ts` サフィックスにより、このプラグインはブラウザーでのみ実行されます。 Rejourney インスタンスは `$rejourney` として挿入され、`useNuxtApp().$rejourney` 経由で利用可能になります。

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

`startRejourneyOnMount` は、`Rejourney.stop()` を呼び出すクリーンアップ関数を返します。Svelte の `onMount` 戻り値は、破棄コールバックとして自動的に使用されます。

---

#### 角度のある

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

`createRejourneyAppInitializer` は、Angular のブートストラップ フェーズ中に Rejourney を初期化して開始するファクトリを返します。クラスベースの API に `RejourneyService` を注入することもできます。

---

#### リミックス

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

`startOnMount` のデフォルトは `true` です。ルート変更は自動的に追跡されます。

---

#### アストロ

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

SSR 環境では `startRejourneyForAstro` no-ops — 実行前に `window` をチェックします。

---

## リモート録画設定

プロジェクト設定では、コードをデプロイしなくても、Web 録画のデフォルトを制御できます。 SDK は、`start()` 呼び出しごとにリモート構成を読み取ります。リモート設定では、録画を完全に有効または無効にしたり、許可されたドメイン リストを調整したり、最大セッション期間を設定したりできます。リモート設定が利用できない場合、`start()` は続行されません。これは、不明なプロジェクト状態での記録を防ぐための意図的なものです。

## ルート追跡

Rejourney はページとルートの変更を自動的に追跡するため、リプレイでナビゲーション コンテキストを確認できます。これはデフォルトで有効になっており (`autoTrackRoutes: true`)、履歴 API 呼び出し (`pushState`、`replaceState`) をインターセプトし、`popstate` イベントをリッスンすることで機能します。

### カスタムルート名

デフォルトでは、現在の `window.location.pathname` が画面名として使用されます。独自の命名ロジックを提供するには、`routeName` 関数を渡します。

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### 手動画面追跡

画面を手動で追跡するには (タブの変更やページ内ビューの遷移など)、`trackScreen` を直接呼び出します。

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

自動ルート追跡を無効にして手動呼び出しのみに依存するには:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## ユーザーの識別

セッションを内部ユーザー ID に関連付けて、ダッシュボードで特定のユーザーをフィルターして検索します。

```javascript
import { Rejourney } from '@rejourneyco/browser';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **プライバシー：** 内部 ID または UUID を使用します。 PII (電子メール、電話) を使用する必要がある場合は、送信する前にハッシュ化してください。

## カスタムイベント

意味のあるユーザーアクションを追跡して、行動パターンを理解し、問題をデバッグし、ダッシュボードでセッションのリプレイをフィルタリングします。

### 基本的な使い方

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

|パラメータ |タイプ |必須 |説明 |
|---|---|---|---|
| `name` | `string` |はい |イベント名 - 一貫性を保つために `snake_case` を使用します。
| `properties` | `object` |いいえ |この特定のイベントの発生に関連付けられたキーと値のペア |

### 例

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

### ダッシュボードでのイベントの表示方法

カスタム イベントはセッションごとに保存され、次の 2 つの場所に表示されます。

1. **セッションリプレイのタイムライン** — イベントはリプレイ タイムライン上にマーカーとして表示されるため、アクションが発生した正確な瞬間にジャンプできます。
2. **セッションアーカイブフィルター** — 次の条件でセッション リストをフィルタリングします。
   - **イベント名** — 特定のイベントを含むすべてのセッションを検索します (例: `purchase_completed`)
   - **イベントプロパティ** — プロパティ キーおよび/または値でさらに絞り込みます (例: `plan = pro`)
   - **イベント数** — 特定の数のカスタム イベント (例: 5 つ以上のイベント) を含むセッションを検索します。

### ベストプラクティス




> [!TIP]
> - 一貫した名前を使用します (`snake_case`、例: `Button Clicked` ではなく `button_clicked`)。
> - プロパティ値を単純にする (文字列、数値、ブール値) - ネストされたオブジェクトを避ける
> - デバッグや分析にとって重要なアクションに焦点を当てます。すべてをログに記録しないでください。
> - プロパティはイベントごとのコンテキスト用です。セッションレベルの属性の場合は、代わりに **メタデータ** を使用してください

---

## メタデータ

ユーザーまたはセッションのコンテキストを説明するセッション レベルのキーと値のペアをアタッチします。イベントとは異なり、メタデータはキーごとに 1 回設定され、セッション全体に適用されます。

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

メタデータ値は、`string`、`number`、または `boolean` である必要があります。オブジェクトと配列は受け入れられません。

### メタデータとイベントをいつ使用するか

|ユースケース | **メタデータ** を使用する | **イベント** を使用する |
|---|---|---|
|ユーザーのサブスクリプション プラン | `setMetadata('plan', 'pro')` | |
|ユーザーがボタンをクリックした | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| A/B テストのバリエーション | `setMetadata('ab_variant', 'v2')` | |
|購入完了 | | `logEvent('purchase', { amount: 29 })` |
|ユーザーの役割 | `setMetadata('role', 'admin')` | |
|オンボーディング ステップに達しました | | `logEvent('onboarding_step', { step: 3 })` |

**経験則:** *ユーザーが誰であるか*、または*ユーザーがどのような状態にある*かを説明する場合は、メタデータを使用します。 *起こったこと*を説明する場合は、イベントを使用します。

## プライバシー管理

すべてのテキスト入力はデフォルトでマスクされます (`maskAllInputs: true`)。マスクされたフィールドはリプレイでは空の入力として表示され、値はソースで取得されることはありません。パスワード、電子メール、電話、その他の機密性の高い入力タイプは、この設定に関係なく常にマスクされます。

### ブロック要素

DOM 要素をリプレイから完全に除外するには (ソリッド プレースホルダーとして表示されます)、次のいずれかを追加します。

- CSSクラス: `rr-block`
- データ属性: `data-rj-block` または `data-rejourney-block`
- `blockSelector` 構成オプションによるカスタム CSS セレクター

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### マスキングテキスト

要素のテキスト コンテンツをマスクするには (テキストは置き換えられますが、要素の形状は表示されたままになります)、次のいずれかを追加します。

- CSSクラス: `rr-mask`
- データ属性: `data-rj-mask`、`data-rejourney-mask`、`data-private`、または `"password"` を含む任意の `data-testid`
- `maskTextSelector` 構成オプションによるカスタム CSS セレクター

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### 要素の無視

要素の形状をキャプチャしながら、要素上のすべてのインタラクション イベント (クリック、入力) を抑制するには、次を追加します。

- CSSクラス: `rr-ignore`
- データ属性: `data-rj-ignore` または `data-rejourney-ignore`

### カスタムマスキング関数

プログラムによるマスキング ロジックの場合は、`maskInputFn` または `maskTextFn` を使用します。

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### ユーザーの同意と GDPR




> [!IMPORTANT]
> **あなたはデータ管理者です。** Rejourney は、お客様に代わってデータ処理者として機能します。あなたには、セッションの記録についてエンドユーザーに通知し、エンドユーザーのデータを処理するための有効な法的根拠 (同意や正当な利益など) があることを確認する責任があります。

#### しなければならないこと

1. **プライバシー ポリシーでセッションの記録を開示します。** 次のような言語を含めます。

   > * 「弊社では、製品の改善と摩擦の軽減に役立てるため、弊社 Web サイトでのお客様のアクティビティの匿名化および非匿名化セッション リプレイを記録するために Rejourney を使用しています。セッション データには、ページ インタラクション、ブラウザー情報、おおよその位置情報が含まれる場合があります。テキスト入力と機密要素は自動的にマスクされ、キャプチャされることはありません。」*

2. **同意に基づくゲート録音** (EEA ユーザーに推奨):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **オプトアウトを尊重します。** ユーザーが同意を撤回した場合は、記録を停止し、ユーザーの ID をクリアします。

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### `setConsent` による詳細な同意

より細かく制御するには、`setConsent` を使用して分析と再生を個別に切り替えます。

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

`analytics: false` と `replay: false` を一緒に設定すると、セッションが停止され、キューに入れられたデータがすべてクリアされます。 `replay: false` を単独で設定すると、rrweb レコーダーは停止しますが、イベント追跡は実行し続けます。

#### コンソールログのキャプチャ

コンソール ログ キャプチャはデフォルトで無効になっています (`trackConsoleLogs: false`)。ロギング方法によっては、コンソール ログに PII が含まれる可能性があるため、必要な場合にのみ有効にしてください。

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### 地理位置情報

IP 由来の地理位置情報 (国、地域、都市) がデフォルトで収集されます。 `collectGeoLocation` が `false` の場合、SDK はバックエンドでの IP 地理位置情報検索を抑制するフラグを渡します。そのセッションでは位置データは保存されません。

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### 観察専用モード（映像記録なし）

エラー、長いタスク、ネットワーク アクティビティ、およびビジュアル リプレイを記録する分析 **それなし** をキャプチャするには、`observeOnly: true` を設定します。

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

有効にすると、すべてのテレメトリが収集されますが、rrweb 記録は実行されません。セッションは [リプレイ] ページに表示されませんが、完全な分析、エラー、およびネットワーク データは引き続きキャプチャされます。ユーザーが視覚的記録をオプトアウトしているが、可観測性が必要な場合に便利です。

> **注記：** これは、保存された同意設定などに基づいて、ユーザーごとに条件付きで設定できます。
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### ボットの検出

ボットと自動ブラウザはデフォルトで無視されます (`ignoreBots: true`)。 Playwright、Puppeteer、Selenium、およびその他の Web ドライバーベースのクライアントは抑制されます。自動化セッションを記録するには (例: 内部ツール用):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

カスタムボット検出パターンを提供するには:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### ネットワークリクエストのキャプチャ

ネットワーク リクエスト (フェッチおよび XHR) はデフォルトでインターセプトされ、ログに記録されます (`autoTrackNetwork: true`)。リクエストおよびレスポンスの本文サイズは、デフォルトでキャプチャされる **ない** (`networkCaptureSizes: false`) です。 URL、メソッド、ステータス コード、および期間は常にキャプチャされます。

特定の URL を除外するには:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

送信前にリクエストをフィルタリングまたは編集するには:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## 構成リファレンス

|オプション |タイプ |デフォルト |説明 |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | `init()` が完了した後、自動的に `start()` を呼び出します。
| `disableInDev` | `boolean` | `false` | `localhost` および `127.0.0.1` での記録を抑制する |
| `debug` | `boolean` | `false` |ブラウザコンソールへの詳細な SDK ログを有効にする |
| `enabled` | `boolean` | `true` |マスターキルスイッチ - 録画を禁止するには、`false` に設定します。
| `observeOnly` | `boolean` | `false` |視覚的なリプレイなしで分析/エラー/ネットワークをキャプチャ |
| `captureReplay` | `boolean` | `true` | rrweb ビジュアル リプレイ キャプチャを有効にする |
| `allowedDomains` | `string[]` | `[]` |記録を特定のドメインに制限します。空は、すべてのドメインが許可されていることを意味します。 `*.example.com` ワイルドカードをサポート |
| `maxSessionDuration` | `number` | `1800000` |最大セッション長 (ミリ秒単位) (デフォルト: 30 分) |
| `collectGeoLocation` | `boolean` | `true` | IP 由来の国/地域/都市を収集 |
| `captureAttribution` | `boolean` | `true` |セッション開始時に UTM パラメータ、リファラー、エントリ URL をキャプチャ |
| `ignoreBots` | `boolean` | `true` |検出されたボットと Web ドライバーの記録を抑制する |
| `recordAutomation` | `boolean` | `false` | Playwright/Puppeteer/Selenium セッションの記録を許可する |
| `autoTrackRoutes` | `boolean` | `true` |履歴を介してルート変更を自動的に追跡 API |
| `routeName` | `(location: Location) => string` | — | `window.location` | からスクリーン名を導出するカスタム関数
| `autoTrackNetwork` | `boolean` | `true` |フェッチ/XHR リクエストをインターセプトしてログに記録します。
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — |ネットワーク追跡から除外する URL |
| `networkCaptureSizes` | `boolean` | `false` |リクエスト/レスポンスボディのサイズをネットワークログに含める |
| `trackConsoleLogs` | `boolean` | `false` | `console.log/warn/error` 出力をキャプチャ |
| `trackLongTasks` | `boolean` | `true` |長いタスク (JS スレッド ブロック > 50ms) を検出してログに記録します。
| `trackResourceErrors` | `boolean` | `true` |失敗したリソースのロード (画像、スクリプト、スタイルシート) をキャプチャ |
| `maskAllInputs` | `boolean` | `true` |リプレイ内のすべてのテキスト入力値をマスクする |
| `blockClass` | `string \| RegExp` | `'rr-block'` |要素の再生を完全にブロックする CSS クラス |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` |要素の再生を完全にブロックする CSS セレクター |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` |要素上のインタラクション イベントを無視する CSS クラス |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` |インタラクション イベントを無視する CSS セレクター |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` |再生時にテキストコンテンツをマスクする CSS クラス |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` |テキストコンテンツをマスクする CSS セレクター |
| `maskInputFn` | `(value, element) => string` | — |キャプチャ前に入力値を変換するカスタム関数 |
| `maskTextFn` | `(text, element) => string` | — |キャプチャ前にテキスト コンテンツを変換するカスタム関数 |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — |ページ読み込みごとに記録するかどうかを決定するカスタム関数 |
| `beforeSendEvent` | `(event) => event \| null` | — |イベントをキューに入れる前にフィルターまたは変更します。 `null` をドロップに返します |
| `beforeSendNetwork` | `(request) => request \| null` | — |ネットワーク エントリをキューに入れる前にフィルタリングまたは変更します。 `null` をドロップに返します |
| `onAuthError` | `(error) => void` | — | SDK がバックエンドでの認証に失敗したときに呼び出されます。

## 録音を停止する

`stop()` を呼び出してセッションを終了し、保留中のイベントをフラッシュし、すべての SDK リスナーをクリーンアップします。

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()` は複数回呼び出しても安全です。停止後、`start()` を再度呼び出して、新しいセッションを開始します。

## セッションID

現在のセッション ID にアクセスして、Rejourney セッションを独自のログまたはサポート ツールと関連付けます。

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

アクティブなセッションがない場合は、`null` を返します。

## ステータスヘルパー

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```
