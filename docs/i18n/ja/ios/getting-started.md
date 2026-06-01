<!-- AI_PROMPT_SECTION -->
**Cursor、Claude、または ChatGPT を使用していますか?** 統合プロンプトをコピーし、AI アシスタントに貼り付けて、セットアップ コードを自動生成します。

<!-- /AI_PROMPT_SECTION -->

## インストール

### Swift Package Manager

**「ファイル」→「パッケージの依存関係を追加」** を介して Rejourney に Rejourney パッケージを追加し、次のように入力します。

```
https://github.com/rejourneyco/rejourney
```

または、`Package.swift` に直接追加します。

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
> Rejourney には、iOS 15.1 以降が必要です。

## Swift セットアップ

`@main` アプリ構造体で Rejourney を初期化して開始します。

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

`UIApplicationDelegate` を使用する場合は、`application(_:didFinishLaunchingWithOptions:)` で `configure` を呼び出します。

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

`start()` が解決されるとすぐに記録が開始されます。必要に応じて結果を確認できます。

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## リモート録画設定

プロジェクト設定は、新しいアプリ ビルドを出荷しなくても、Swift 記録のデフォルトを制御できます。サポートされている SDK バージョンは、`start()` が呼び出されたときに次の設定を読み取ります。

|設定 |行動 |
|---|---|
|サンプルレート |デフォルトは `100%` です。サンプリングされたセッションは通常どおりキャプチャされます。サンプリングされたセッションは、リプレイ キャプチャ、ネットワーク インターセプト、アップロード、またはその他のパッケージ作業が開始される前に返されます。 |
|最大可観測期間 |各可観測性セッションの最大長を制限します。 |
| FPS の録画 |デフォルトは `1 FPS` です。プロジェクト管理者は、`1`、`2`、または `3 FPS` を選択できます。リモート構成が使用できない場合、SDK はローカル/デフォルトのキャプチャ動作に戻ります。 |
|テキスト入力のプライバシー |デフォルトでは、すべてのテキスト入力がマスクされます。セキュア専用モードでは、パスワード/セキュア フィールドがマスクされたままになり、他のテキスト入力がデバッグ リプレイに表示されることが許可されます。 |

## スクリーントラッキング

Rejourney は SwiftUI ナビゲーションに自動的にフックしないため、ユーザーが新しい画面に移動するたびに `trackScreen` を呼び出します。

### SwiftUI

`.onAppear` またはナビゲーション対応修飾子を使用します。

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

### UIキット

`viewDidAppear` 内で `trackScreen` を呼び出します。

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### ナビゲーションパス / ナビゲーションスタック

ナビゲーション パスを観察し、変更を追跡します。

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

## ユーザーの識別

セッションを自分のユーザー ID に関連付けると、ダッシュボードで特定のユーザーを見つけることができます。

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **プライバシー：** 内部 ID または UUID を使用します。 PII (電子メール、電話) を使用する必要がある場合は、渡す前にハッシュ化してください。

ID は、`UserDefaults` 経由でアプリを起動しても保持されます。`identify` を呼び出す必要があるのは、アプリを開くたびではなく、ログインごとに 1 回だけです。

## カスタムイベント

意味のあるユーザーアクションを追跡して、行動を理解し、問題をデバッグし、ダッシュボードでセッションのリプレイをフィルタリングします。

### 基本的な使い方

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

|パラメータ |タイプ |必須 |説明 |
|---|---|---|---|
| `name` | `String` |はい |イベント名 - 一貫性を保つために `snake_case` を使用します。
| `properties` | `[String: RejourneyMetadataValue]` |いいえ |このイベントに関連付けられたキーと値のペア |

`RejourneyMetadataValue` は、Swift リテラルを直接受け入れます。ラッピングは必要ありません。

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### 例

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

### ダッシュボードでのイベントの表示方法

カスタム イベントはセッションごとに保存され、次の 2 つの場所に表示されます。

1. **セッションリプレイのタイムライン** — イベントはリプレイ タイムライン上にマーカーとして表示されるため、アクションが発生した正確な瞬間にジャンプできます。
2. **セッションアーカイブフィルター** — 次の条件でセッション リストをフィルタリングします。
   - **イベント名** — 特定のイベントを含むすべてのセッションを検索します (例: `purchase_completed`)
   - **イベント数** — 特定の数のカスタム イベントを持つセッションを検索する

### ベストプラクティス




> [!TIP]
> - 一貫した名前を使用します (`snake_case`、例: `Button Tapped` ではなく `button_tapped`)。
> - プロパティ値を単純にしてください (文字列、数値、ブール値) - 深くネストされたオブジェクトを避けます
> - デバッグや分析にとって重要なアクションに焦点を当てます。すべてをログに記録しないでください。

## プライバシー管理

テキスト入力とカメラ ビューはデフォルトで自動的にマスクされます。プロジェクト管理者は、サポートされている SDK バージョンのプロジェクト設定でデフォルトのテキスト入力マスキング レベルを変更できます。セキュア/パスワード フィールド、カメラ ビュー、および明示的なマスクは保護されたままになります。

追加の機密ビューを非表示にするには、`mask` および `unmask` API を使用します。

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

SwiftUI の場合は、`UIViewRepresentable` ラッパーまたは `introspect` を介して、基になる `UIView` を取得します。

#### ネイティブシート

ネイティブ シート キャプチャはデフォルトで有効になっています (`captureNativeSheets: true`)。これにより、OS がキャプチャを許可している場合、支払い承認モーダルなどのアプリ所有のネイティブ シートとダイアログがデバッグ リプレイに表示されるようになります。テキスト入力がデフォルトでマスクされる場合、キーボード/テキスト入力システム シートは除外されます。テキスト入力マスキングがセキュリティで保護されたフィールドのみに設定されている場合、キーボードはベストエフォート型のみとなり、iOS が保護されたまたはリモート システム サーフェスとしてレンダリングする可能性があるため、確実にキャプチャできません。 OS 共有シートもベストエフォート型であり、システムが保護されたサーフェスまたはリモート サーフェスとしてレンダリングする場合、確実にキャプチャすることはできません。

視覚的な再生をメイン アプリ ウィンドウに限定したい場合は、ネイティブ シート キャプチャを無効にします。

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### ユーザーの同意と GDPR




> [!IMPORTANT]
> **あなたはデータ管理者です。** Rejourney は、お客様に代わってデータ処理者として機能します。あなたには、セッションの記録についてエンドユーザーに通知し、エンドユーザーのデータを処理するための有効な法的根拠 (同意や正当な利益など) があることを確認する責任があります。

#### しなければならないこと

1. **アプリのプライバシー ポリシーでセッションの記録を開示します。** 次のような言語を含めます。

   > * 「当社では、Rejourney を使用して、アプリ内アクティビティの匿名化および非匿名化されたセッション リプレイを記録し、製品の改善、クラッシュや問題の追跡、製品の摩擦の軽減に役立てています。セッション データには、画面の操作、デバイス情報、およびおおよその位置が含まれる場合があります。テキスト入力と機密性の高い UI 要素は自動的にマスクされ、キャプチャされることはありません。」*

2. **同意に基づくゲート録音** (EEA ユーザーに推奨):

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

3. **オプトアウトを尊重します。** ユーザーが同意を撤回した場合は、記録を停止し、ユーザーの ID をクリアします。

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### 観察専用モード（映像記録なし）

エラー、クラッシュ、ANRs、およびビジュアル リプレイを記録するネットワーク アクティビティ **それなし** をキャプチャするには、`observeOnly: true` を設定します。

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

有効にすると、すべてのテレメトリが収集されますが、スクリーンショットは取得されません。セッションはリプレイ ページに表示されませんが、完全な分析、エラー、ネットワーク、クラッシュ データは引き続きキャプチャされます。ユーザーが画面録画をオプトアウトしているが、それでもエラーを可視化したい場合に便利です。

> **注記：** これは、保存された設定または同意フラグに基づいてユーザーごとに条件付きで設定できます。
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### ネットワークキャプチャ

ネットワーク リクエスト キャプチャ (デフォルトでは `autoTrackNetwork: true`) は、カスタム `URLProtocol` を介して `URLSession` トラフィックをインターセプトします。ネットワーク データを収集したくない場合は無効にします。

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### 地理位置情報

IP 由来の地理位置情報 (国、地域、都市) がデフォルトで収集されます。ルックアップを完全に抑制するには、これを無効にします。

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## 構成リファレンス

すべてのオプションは `configure` で一度設定され、`start` が呼び出された後は変更できません。

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

|オプション |タイプ |デフォルト |説明 |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` |セルフホスト展開のオーバーライド |
| `userId` | `String?` | `nil` |オプションの初期内部ユーザー ID |
| `enabled` | `Bool` | `true` |マスターキルスイッチ — SDK を完全に無効にするには、`false` に設定します。
| `observeOnly` | `Bool` | `false` |テレメトリのみを収集し、視覚的な記録は収集しません |
| `captureFPS` | `Int?` | `nil` |オプションのローカル キャプチャ FPS フォールバック。リモート プロジェクト設定の記録 FPS が利用可能な場合は優先されます。
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | JPEG キャプチャ品質 (`.low`、`.medium`、`.high`) |
| `wifiOnly` | `Bool` | `false` | Wi-Fi でセッション データのみをアップロード |
| `captureScreen` | `Bool` | `true` |ビジュアルスクリーンキャプチャを有効/無効にする |
| `captureAnalytics` | `Bool` | `true` |分析イベント収集を有効/無効にする |
| `captureCrashes` | `Bool` | `true` |クラッシュレポートを有効/無効にする |
| `captureANR` | `Bool` | `true` | ANR (アプリが応答なし) 検出を有効/無効にする |
| `trackConsoleLogs` | `Bool` | `true` |セッションのコンソール ログをキャプチャする |
| `collectGeoLocation` | `Bool` | `true` | IP 由来の地理位置情報を収集 |
| `autoTrackNetwork` | `Bool` | `true` |ネットワーク キャプチャの `URLSession` リクエストをインターセプトする |
| `captureNativeSheets` | `Bool` | `true` | iOS がキャプチャを許可する場合、アプリ所有のネイティブ シート/ダイアログ ウィンドウをビジュアル リプレイに含めます。 OS 共有シートとキーボードは保護されているか、リモートの表面である可能性があり、確実にキャプチャすることができません。
| `debug` | `Bool` | `false` |詳細な SDK ログをコンソールに出力します。

## 録音を停止する

現在のセッションを停止し、保留中のデータをフラッシュします。

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

コールバック バリアントは、非同期コンテキストで使用できます。

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## セッションID

現在のセッション ID にいつでもアクセスして、独自のログやサポート ツールと関連付けることができます。

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
