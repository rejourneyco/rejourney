# Rejourney に貢献しています

寄付を歓迎します！開始するには、以下のガイドを参照してください。

## プロジェクトの構造

これは、npm ワークスペースによって管理されるモノリポジトリです。

## 前提条件

1. **Node.js** >= 18.0.0
2. **npm** または **yarn** (ワークスペースは両方で動作します)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**: Xcode および CocoaPods
7. **Android**: Android Studio および JDK 17

## 初期セットアップ

### 1. 依存関係をインストールする

モノレポの **根** より:

```bash
npm install
```

これにより、次のことが行われます。
- すべてのワークスペースの依存関係をインストールする
- SDK パッケージを自動的にビルドします (ルート `package.json` の `postinstall` スクリプトを介して `npm run build:sdk` を実行します)
- すべてのパッケージを正しくリンクする

### 2. SDK を構築する

変更を加えた後に SDK を再構築する必要がある場合:

```bash
npm run build:sdk
```

またはクリーンビルドの場合:

```bash
npm run build:clean
```

## バックエンド開発 (ローカル Kubernetes)

Rejourney はローカル開発に `local-k8s/` を使用するため、毎日のループを高速に保ちながら、ランタイムは運用環境の Kubernetes セットアップに近くなります。

### 1. `.env.k8s.local`を設定する

ローカルの Kubernetes 環境テンプレートをコピーします。

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. ハイブリッド開発スタックを開始する

```bash
npm run dev
```

その流れは：

- 必要に応じてローカル `k3d` クラスターを作成します
- `local-k8s/namespace.yaml`、`postgres.yaml`、`redis.yaml`、および `minio.yaml` を適用します
- `.env.k8s.local` を Kubernetes シークレットに同期します
- ホスト マシン上のソースから API、ダッシュボード、ワーカーを実行します

完全なクラスター内パリティ実行の場合:

```bash
npm run dev:full
```

ローカルスタックを停止するには:

```bash
npm run dev:down
```

### 3. IP アドレスの設定 (物理デバイスのテスト)

同じ WiFi に接続された **物理デバイス** (iOS または Android) でテストしている場合、SDK とダッシュボードは通信するためにコンピューターのローカル IP アドレスを知っている必要があります。

#### IP アドレスの確認 (Mac)

ターミナルで次のコマンドを実行します。

```bash
ipconfig getifaddr en0
```

または、 **システム設定 > WiFi > [あなたのネットワーク] 詳細** で見つけてください。

#### `.env.k8s.local`を更新

次の変数 **しなければならない** は、`localhost` の代わりにローカル IP アドレス (例: `http://192.168.1.5:3000`) を使用します。

|変数 |キーの使用法 |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` |ビデオ再生のための MinIO へのパブリック アクセス |
| `PUBLIC_DASHBOARD_URL` |ダッシュボード UI のベース URL |
| `PUBLIC_API_URL` | API のベース URL |
| `PUBLIC_INGEST_URL` | SDK イベント取り込みのベース URL |
| `DASHBOARD_ORIGIN` |ダッシュボードの CORS 原点 |
| `OAUTH_REDIRECT_BASE` | OAuth コールバックのベース URL |




> [!IMPORTANT]
> これらを正しく設定しないと、物理デバイスで「接続が拒否されました」エラーが発生したり、ダッシュボードの画像/ビデオ リンクが壊れたりします。

`npm run dev` は、`scripts/local-k8s/update-ips.sh` を通じてこれらの LAN 側の値を自動的に更新し、Expo アプリで使用されるサンプル アプリの env ファイルも書き込みます。

#### 構成例 (`.env.k8s.local`)

コンピュータの IP アドレスが `192.168.1.100` であると仮定します。

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

### 4. ローカル Kubernetes ファイル

ローカルの Kubernetes マニフェストは、本番環境の `k8s/` レイアウトを意図的にミラーリングしています。

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## サンプルアプリの実行

### React Native ボイラープレート (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

または、サンプル ディレクトリから:

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### ブリューコーヒーラボ (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native ベア

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## 仕組み

### ワークスペースのセットアップ

モノリポジトリはコア パッケージに npm ワークスペースを使用しますが、サンプル アプリはスタンドアロンです。

1. **ルート `package.json`** には、ワークスペースに `packages/*`、`backend`、および `dashboard/web-ui` のみが含まれます
2. **サンプルアプリはスタンドアロンです** - 依存関係の競合を避けるために独自の `node_modules` があります。
3. **アプリ例** は、`"rejourney": "file:../../packages/react-native"` を使用して SDK を参照します
4. **メトロ構成** は、SDK パッケージを正しく監視して解決するように構成されています

**サンプルがワークスペースにない理由:**
- サンプルアプリは異なる Expo/React Native バージョンを使用します
- npm 依存関係重複排除の競合を防止します
- 各例には独自の完全な依存関係ツリーを含めることができます。

### メトロ構成

各サンプル アプリには、次のような `metro.config.js` があります。

1. **時計** 変更用の SDK ソース ディレクトリ (`packages/react-native`)
2. **解決します** `rejourney` パッケージを正しい場所にコピーします
3. **ブロック** ワークスペース ルートからの `react-native` および `react` パッケージの複製

### Codegen (ターボモジュール)

次の場合、React Native の codegen はアプリのビルド時に自動的に実行されます。

1. SDK の `package.json` には `codegenConfig` が定義されています ✅
2. 仕様ファイル (`NativeRejourney.ts`) は命名規則に従います ✅
3. アプリには SDK パッケージが含まれています ✅

Codegen は次の場合に自動的に実行されます。
- `npm run ios` (iOS ビルド)
- `npm run android` (Android ビルド)

## プロジェクトの構造

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

## CI/CD と展開

Rejourney は、GitHub Actions を使用して、モノリポジトリ全体にわたるテスト、構築、デプロイを自動化します。

テスト スイート、ネイティブ統合テスト、自動展開ロジックの詳細については、[CI/CD およびテスト ドキュメント](/docs/architecture/ci-cd) を参照してください。

---

クラウド (K8s) とセルフホスト (Docker) の詳細については、[アーキテクチャの比較](/docs/architecture/distributed-vs-single-node) をご覧ください。

## ベストプラクティス

1. テスト前 **常に SDK をビルドしてください**: `npm run build:sdk`
2. npm ワークスペースの package.json 内の **ファイルプロトコルを使用する** (`file:../../packages/react-native`)
3. 問題がある場合は **Metro キャッシュをクリアする**: `npm start -- --reset-cache`
4. SDK ネイティブ コード変更後の **ネイティブアプリを再構築する**
5. コミット前に **iOS と Android の両方でテストします**
