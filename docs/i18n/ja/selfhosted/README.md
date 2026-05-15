# セルフホスティング Rejourney

このガイドは、公式の **Docker Compose** スタックを使用して、独自のサーバー (通常は単一の VPS または専用マシン) で Rejourney を実行している **誰でも** を対象としています。 Rejourney の内部インフラストラクチャまたは Kubernetes にアクセスする必要はありません。

セットアップ後、次のものが得られます。

- ドメインの **ウェブダッシュボード** (Let’s Encrypt 経由の HTTPS)
- サブドメイン上の **API** (ダッシュボードおよびモバイル SDK)
- 別のサブドメインの **インジェスト（アップロード）リレー** (セッションのアップロードは電話からオブジェクト ストレージに直接ではなく、サーバーを経由します)
- **PostgreSQL**、 **Redis**、および **内蔵MinIO** または **あなただけの S3-compatible ストレージ**
- セッション、保持、アラートを処理するバックグラウンド **労働者** (Rejourney のクラウド展開と同じ役割)

以下のすべてのコマンドは、クローン作成後に **リポジトリのルート** (`docker-compose.selfhosted.yml` が含まれるフォルダー) にいることを前提としています。

---

## 事前に必要なもの

### サーバ

- **OS:** Ubuntu 22.04+、Debian 12+、または Docker を適切に実行する別の Linux
- **Docker:** 24 以降、 **Docker Compose プラグイン** を搭載 (`docker compose version` は動作するはずです)
- **リソース (推奨):** 4 vCPU、8 GB RAM、40 GB ディスク (多数の録画を保存する場合はさらに多く)
- **ネットワーク：** インターネットにオープンされたポート **80** および **443** (Let’s Encrypt HTTP チャレンジおよび HTTPS に必要)

### ドメインとDNS

あなたが管理する **1つのベースドメイン** (例: `example.com`) が必要です。インストーラーを実行する前に、サーバーのパブリック IP でこれらのホスト名の **全て** を指す DNS **あ** (または **ああああ**) レコードを作成します。

|ホスト名 |目的 |
|----------|---------|
| `example.com` |ダッシュボード |
| `www.example.com` |ダッシュボードにリダイレクトします |
| `api.example.com` | API (使用されている場合は WebSocket) |
| `ingest.example.com` |アップロードリレー (API が設定されると、SDK はこれを自動的に使用します) |

`example.com` を実際のドメインに置き換えます。伝播には数分から数時間かかる場合があります。 TLS 証明書は、DNS が正しく解決されるまで発行されません。

### Let’s Encrypt

インストール中に、 **電子メールアドレス** の入力を求められます。 Let’s Encrypt からの証明書の有効期限通知に使用されます。

### マシン上のツール

- `git`: リポジトリのクローンを作成します
- `openssl` (シークレットを生成するためにインストール スクリプトによって使用されます)
- シェル (bash で問題ありません)

---

## 初めてのインストール

### 1. リポジトリのクローンを作成します

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

デフォルトのブランチ (またはプロジェクトにセルフホスティング用のブランチが文書化されている場合はリリース タグ) をそのまま使用します。

### 2. インストーラーを実行します

```bash
./scripts/selfhosted/deploy.sh install
```

スクリプトは次のことを行います。

1. **ベースドメイン** を尋ねます (例: `example.com` — `https://` ではなく、パスなし)。
2. **Let’s Encryptメール** をお求めください。
3. **ストレージ** を要求します: 組み込み **MinIO** (推奨) または **外部 S3-compatible** ストレージ (エンドポイント、バケット、リージョン、キーを入力します)。
4. 生成されたパスワードとシークレットを使用して、リポジトリのルートに **`.env.selfhosted`** を作成します。 **権限を制限する** が適用されます(`chmod 600`)。
5. **引く** がコンテナー イメージ (API、Web、ワーカー、データベース、Traefik など) を公開しました。
6. **建てる** **ブートストラップ/移行** イメージ **あなたのクローンから** (データベース セットアップ スクリプトが含まれています。コンテナー レジストリからダウンロードされるものではありません)。
7. データベース Redis、Traefik、および (選択されている場合) MinIO を起動します。
8. ブートストラップを実行する前に、構成された `DATABASE_URL` を使用してデータベース接続を検証します。
9. ワンショット **ブートストラップ** コンテナー (データベース スキーマ、オプションの初回シード、データベース内のストレージ構成) を実行します。
10. API を開始し、リレー、ダッシュボード、ワーカーをアップロードします。

最初のインストールには数分かかる場合があります (イメージのプルとブートストラップ)。

### 3. `.env.selfhosted`を保護する

このファイルには、デプロイメントの **すべての秘密** (データベース、Redis、JWT、ストレージ暗号化、使用されている場合は MinIO 資格情報など) が保持されます。 **バックアップしてください** を安全な場所 ​​(パスワード マネージャー、暗号化されたバックアップ) に保存します。これを紛失すると、保存されている資格情報を復号化したり、同じ展開を再構築したりできなくなる可能性があります。

これを git にコミットしないでください (`.gitignore` によって無視されるはずです)。

---

## インストール後

### URL

インストーラーは URL を出力します。一般的に：

- **ダッシュボード:** `https://<your-base-domain>`
- **API:** `https://api.<your-base-domain>`
- **摂取:** `https://ingest.<your-base-domain>`

`www.<your-base-domain>` はダッシュボードにリダイレクトされます。

### スタックを検証する

```bash
./scripts/selfhosted/deploy.sh status
```

コンテナが実行されているのが確認できるはずです。 `api` と `ingest-upload` は、しばらくすると **健康** になります。

### 最初のログインとテスト記録

1. ブラウザでダッシュボードを開きます。
2. アカウントとプロジェクトを作成します。
3. アプリの Rejourney SDK を **API URL** で構成します (下記の [SDK 構成](#configuring-your-mobile-app) を参照)。
4. 短いセッションを録画し、それがリプレイに表示されることを確認します。

セッションがリプレイに表示されない場合は、[トラブルシューティング](/docs/selfhosted/troubleshooting) (リレーのアップロードとワーカー ログの取り込み) を参照してください。

---

## 日常業務

これらはすべてリポジトリのルートから実行されます。

|アクション |コマンド |
|--------|---------|
|サービスステータス | `./scripts/selfhosted/deploy.sh status` |
|すべてのログをフォローする | `./scripts/selfhosted/deploy.sh logs` |
| 1 つのサービスのログ | `./scripts/selfhosted/deploy.sh logs api` (`api` を `web`、`ingest-upload`、`ingest-worker` などに置き換えます) |
| **アップグレード** イメージと再実行ブートストラップ | `./scripts/selfhosted/deploy.sh update` |
|すべてを停止 **それなし** データを削除中 | `./scripts/selfhosted/deploy.sh stop` |
| **リセット** コンテナーとボリューム (破壊的) | `./scripts/selfhosted/deploy.sh reset` |

**`update`** は、新しいイメージ (該当する場合) をプルし、現在のクローンからブートストラップ イメージを再構築し、スタックを再起動して、ブートストラップを再度実行することで、データベース スキーマとストレージ設定が `.env.selfhosted` と一致するようにします。 **ない** は Postgres またはオブジェクト ストレージ ボリュームをワイプします。

ブートストラップの前に、`install` と `update` の両方が、構成された資格情報を使用してデータベース接続を検証します。資格情報が永続的な Postgres データと一致しない場合、デプロイメントは後のブートストラップで失敗するのではなく、リカバリ ガイダンスによって早期に停止されます。

**`stop`** はコンテナのみを停止します。 Docker **ボリューム** (Postgres データ、MinIO データなど) は、明示的に削除するまで残ります。

**`reset`** は、確認プロンプトの後、セルフホスト コンテナーと Docker ボリューム (`pgdata`、`redisdata`、`miniodata`、`traefik-certs`) を削除します。また、`.env.selfhosted` が見つからない場合でも、MinIO プロファイル コンテナーを破棄するため、古い MinIO データが次のインストールをブロックすることはありません。これは、完全に新規インストールする場合にのみ使用してください。

---

## ストレージ: MinIO と外部 S3

### 内蔵 MinIO (デフォルト)

- 単一サーバーの場合が最も簡単: オブジェクト ストレージは **Docker内** を実行し、デフォルトではパブリック インターネットに公開されません。
- セッション バイトは **取り込み-アップロード** サービスによって書き込まれます。デバイスは MinIO に直接到達する必要はありません。
- バケットの作成はインストール中に処理されます。

### 外部 S3-compatible ストレージ

AWS S3、Cloudflare R2、Hetzner Object Storage、Wasabi、または任意の S3-compatible API を使用します。インストール中に、エンドポイント URL、バケット、リージョン、およびアクセス キーを指定します。

エンドポイント URL スタイルの例 (プロバイダーのドキュメントが信頼できるものです):

- AWS: `https://s3.<region>.amazonaws.com`
- Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`
- ヘッツナー: `https://<location>.your-objectstorage.com`

ダウンロード用に **別の公開 URL** を追加する場合は、`.env.selfhosted`に`S3_PUBLIC_ENDPOINT`を設定して、`./scripts/selfhosted/deploy.sh update`を実行します。

---

## 重要な構成 (`.env.selfhosted`)

インストーラーはこのファイルを生成します。一般的な変数には次のものがあります。

- **ドメインとパブリック URL:** `BASE_DOMAIN`、`DASHBOARD_DOMAIN`、`API_DOMAIN`、`INGEST_DOMAIN`、`PUBLIC_*_URL`
- **データベース:** `DATABASE_URL` (Compose 内の `postgres` サービスを指します)
- **Redis:** `REDIS_URL`
- **ストレージ：** `STORAGE_BACKEND`、`S3_*`、およびオプションで `MINIO_*`
- **安全：** `JWT_SECRET`、`JWT_SIGNING_KEY`、`INGEST_HMAC_SECRET`、`STORAGE_ENCRYPTION_KEY`

オプションの統合 (未使用の場合は空白のままにします): Stripe、SMTP、GitHub OAuth、Turnstile など。

**ストレージまたはドメイン関連の値の変更:** `.env.selfhosted` を編集して、次を実行します。

```bash
./scripts/selfhosted/deploy.sh update
```

---

## データベースのセットアップの仕組み (最初の起動とその後の更新)

通常、 **ない** は手動で SQL を実行する必要があります。 **ブートストラップ** コンテナーがこれを処理します。

- **新品の空のデータベース:** スタックはコードから現在のスキーマを適用し、どの移行バージョンがすでに満たされているかを記録するため、今後の更新では **新しい** 移行のみが適用されます。
- **既存のデータベース (初期化済み):** **保留中** の移行のみが適用されます。データは、`update` ごとに最初から再構築されるわけではありません。
- データベースが **すでにテーブルがあります** であるが、移行履歴テーブルが **欠落しているか空である** である場合 (部分復元など)、偶発的な損傷を避けるために **エラーで止まる** をブートストラップします。高度な回復オプションについては、[トラブルシューティング](/docs/selfhosted/troubleshooting) に記載されています。

---

## Apple SiliconとARMサーバー

**ARM64** マシン (多くの Mac、一部のクラウド インスタンス) では、自分で設定していない場合でも、デプロイ スクリプトによってイメージ プルに `DOCKER_DEFAULT_PLATFORM=linux/amd64` が設定されるため、`amd64` のみを公開する事前構築済みイメージは引き続き実行されます。別の動作が必要な場合は、スクリプトを実行する前に環境で `DOCKER_DEFAULT_PLATFORM` を設定します。

**ブートストラップ** イメージは常にクローンされたリポジトリからの **あなたのマシン上に構築される** であるため、常にチェックアウトと一致します。

---

## Docker で動作するもの (概要)

- **Traefik:** HTTPS 証明書と、ダッシュボード API へのルーティング、およびホスト名の取り込み。
- **Postgres / Redis:** アプリケーション データとキュー。
- **MinIO:** オプションの内部オブジェクト ストレージ。
- **API:** メイン HTTP API。
- **取り込み-アップロード:** アップロードリレートラフィック専用のサービス。
- **ウェブ：** ダッシュボードの静的 UI。
- **労働者：** プロセス取り込みキュー、アーティファクトの再生、セッションのライフサイクル、スケジュールされた保持スタイルの作業、およびアラート。

このスタックには、 **いいえ** の個別の請求バッチ ワーカーがあります。課金の統合は、キーを構成するときに Stripe および API によって駆動されます。

---

## モバイルアプリの設定

SDK を **あなたの** API ホストに指定します (`API_DOMAIN` / `PUBLIC_API_URL` と一致する必要があります)。

### React Native の例

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

実際の API URL を使用してください。サーバーが正しく構成されている場合、アップロード URL は `ingest.<your-domain>` に対して自動的に導出されます。

---

## バックアップ

少なくとも、 **PostgreSQL**、 **`.env.selfhosted`**、および (組み込みの MinIO を使用する場合) **オブジェクトストレージデータ** をバックアップします。

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

詳細: [バックアップとリカバリ](/docs/selfhosted/backup-recovery)。

---

## トラブルシューティングとサポート

- [トラブルシューティング](/docs/selfhosted/troubleshooting) — ブートストラップの失敗、TLS、空のリプレイ、外部 S3 の問題。
- [バックアップとリカバリ](/docs/selfhosted/backup-recovery) — 復元順序と MinIO。

これらのドキュメントのバグや改善については、GitHub にあるプロジェクトの公開問題トラッカーを使用してください。

---

## 関連ドキュメント

- [分散クラウドと単一ノード クラウド](/docs/distributed-vs-single-node/distributed-vs-single-node) — マルチサービス クラウド レイアウトとの比較 (概念)。
