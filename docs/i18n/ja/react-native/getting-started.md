<!-- AI_PROMPT_SECTION -->
**Cursor、Claude、または ChatGPT を使用していますか?** 統合プロンプトをコピーし、AI アシスタントに貼り付けて、セットアップ コードを自動生成します。

<!-- /AI_PROMPT_SECTION -->

## インストール

npm または yarn を使用して、Rejourney パッケージをプロジェクトに追加します。

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> Rejourney にはネイティブ コードが必要であり、Expo Go とは互換性がありません。開発ビルドを使用します。
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## 3 ライン設定

アプリの最上部で Rejourney を初期化して開始します (App.tsx または Index.js など)。

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

プロバイダーのラッピングは必要ありません。すぐに録音が始まります。

## リモート録画設定

プロジェクト設定では、新しいアプリのビルドを出荷しなくても、React Native の記録のデフォルトを制御できます。サポートされている SDK バージョンは、セッション開始時にリモート録画の FPS 設定を読み取ります。デフォルトは 1 FPS で、プロジェクト管理者は 1、2、または 3 FPS を選択できます。リモート構成が使用できない場合、SDK はローカル/デフォルトのキャプチャ動作に戻ります。

## スクリーントラッキング

Rejourney は画面の変化を自動的に追跡するため、再生中にユーザーがアプリ内のどこにいるかを確認できます。ナビゲーション ライブラリに一致するセットアップを選択してください。

### Expo Router (自動)

**Expo Router** を使用する場合、画面追跡はすぐに機能します。追加のコードは必要ありません。




> [!TIP]
> **カスタムのスクリーン名を使用しますか?** Expo Router を使用しているが、独自のスクリーン名を手動で指定したい場合は、以下の [カスタム スクリーン名](#custom-screen-names) セクションを参照してください。

---

### React Navigation

**React Navigation** (`@react-navigation/native`) を使用する場合は、ルート `NavigationContainer` で `useNavigationTracking` フックを使用します。

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

### カスタムスクリーン名

スクリーン名を手動で指定する場合 (分析の一貫性のため、または上記のライブラリを使用しない場合など)、`trackScreen` メソッドを使用します。

#### Expo Router ユーザーの場合:
Expo Router でカスタム名を使用するには、まず構成で自動追跡を無効にする必要があります。

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### 手動追跡呼び出し:
画面の変更が発生するたびに、`trackScreen` を呼び出します。

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## ユーザーの識別

セッションを内部ユーザー ID に関連付けて、ダッシュボードで特定のユーザーをフィルターして検索します。

```javascript
import { Rejourney } from '@rejourneyco/react-native';

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

### メタデータとイベントをいつ使用するか

|使用例 | **メタデータ** を使用する | **イベント** を使用する |
|---|---|---|
|ユーザーのサブスクリプション プラン |  `setMetadata('plan', 'pro')` | |
|ユーザーがボタンをクリックした | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| A/B テストのバリエーション |  `setMetadata('ab_variant', 'v2')` | |
|購入完了 | |  `logEvent('purchase', { amount: 29 })` |
|ユーザーの役割 |  `setMetadata('role', 'admin')` | |
|オンボーディング ステップに達しました | |  `logEvent('onboarding_step', { step: 3 })` |

**経験則:** *ユーザーが誰であるか*、または*ユーザーがどのような状態にある*かを説明する場合は、メタデータを使用します。 *起こったこと*を説明する場合は、イベントを使用します。

## プライバシー管理

テキスト入力とカメラ ビューはデフォルトで自動的にマスクされます。プロジェクト管理者は、サポートされている SDK バージョンのプロジェクト設定でデフォルトのテキスト入力マスキング レベルを変更できます。古い SDK バージョンは、そのリモート設定を無視し、既存のマスキング動作を維持します。セキュア/パスワード フィールド、カメラ ビュー、および明示的なマスクは保護されたままになります。

追加の機密性の高い UI を手動で非表示にするには、コンポーネントを `Mask` コンポーネントでラップします。

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

マスクされたコンテンツは、リプレイでは塗りつぶされた四角形として表示され、ソースでは決してキャプチャされません。

### ユーザーの同意と GDPR




> [!IMPORTANT]
> **あなたはデータ管理者です。** Rejourney は、お客様に代わってデータ処理者として機能します。あなたには、セッションの記録についてエンドユーザーに通知し、エンドユーザーのデータを処理するための有効な法的根拠 (同意や正当な利益など) があることを確認する責任があります。

#### しなければならないこと

1. **アプリのプライバシー ポリシーでセッションの記録を開示します。** 次のような言語を含めます。

   > * 「当社では、Rejourney を使用して、アプリ内アクティビティの匿名化および非匿名化されたセッション リプレイを記録し、製品の改善、クラッシュや問題の追跡、製品の摩擦の軽減に役立てています。セッション データには、画面の操作、デバイス情報、およびおおよその位置が含まれる場合があります。テキスト入力と機密性の高い UI 要素は自動的にマスクされ、キャプチャされることはありません。」*

2. **同意に基づくゲート録音** (EEA ユーザーに推奨):

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **オプトアウトを尊重します。** ユーザーが同意を撤回した場合は、記録を停止し、データを消去します。

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### コンソールログのキャプチャ

コンソール ログ キャプチャはデフォルトで有効になっています (`trackConsoleLogs: true`)。アプリのログ記録方法に応じて、コンソール ログに PII が含まれる場合があります。機密データがログに表示される可能性がある場合は無効にします。

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### 地理位置情報

IP 由来の地理位置情報 (国、地域、都市) がデフォルトで収集されます。 `collectGeoLocation` が `false` の場合、SDK はバックエンドでの IP 地理位置情報ルックアップを抑制するフラグをネイティブ レイヤに渡します。そのセッションでは位置データは保存されません。位置データが必要ない場合、または EEA ユーザーのデータ収集を最小限に抑えたい場合は、これを無効にします。

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### ネイティブシート

サポートされている SDK バージョンでは、ネイティブ シート キャプチャがデフォルトで有効になっています (`captureNativeSheets: true`)。これにより、OS がキャプチャを許可している場合、支払い承認モーダルなどのアプリ所有のネイティブ シートとダイアログがデバッグ リプレイに表示されるようになります。テキスト入力がデフォルトでマスクされる場合、キーボード/テキスト入力システム シートは除外されます。テキスト入力マスキングがセキュリティで保護されたフィールドのみに設定されている場合、キーボードはベストエフォート型のみとなり、特に OS が保護されたサーフェスまたはリモート サーフェスとしてレンダリングする場合には確実にキャプチャできません。 OS 共有シートもベストエフォート型であり、システムが保護されたサーフェスまたはリモート サーフェスとしてレンダリングする場合、確実にキャプチャすることはできません。

視覚的な再生をメイン アプリ ウィンドウに限定したい場合は、ネイティブ シート キャプチャを無効にします。

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### 観察専用モード（映像記録なし）

エラー、クラッシュ、ANRs、およびビジュアル リプレイを記録するネットワーク アクティビティ **それなし** をキャプチャするには、`observeOnly: true` を設定します。

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

有効にすると、すべてのテレメトリが収集されますが、スクリーンショットは取得されません。セッションはリプレイ ページに表示されませんが、完全な分析/エラー/ネットワーク/クラッシュ データは存在します。リプレイはありません。これは、ユーザーが画面録画をオプトアウトしているが、それでもエラーを可視化したい場合に便利です。

> **注記：** これは、保存された設定や同意フラグなどに基づいて、ユーザーごとに条件付きで設定できます。
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```
