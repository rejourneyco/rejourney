# セルフホスト型のトラブルシューティング

[セルフホスト Rejourney](/docs/selfhosted) に従っていて、何かが失敗したり、奇妙な動作をした場合は、このページを使用してください。コマンドは **リポジトリのルート** (`docker-compose.selfhosted.yml` が存在する場所) から実行されます。

---

## 素早いチェック

### サービス状況

```bash
./scripts/selfhosted/deploy.sh status
```

### API ログ

```bash
./scripts/selfhosted/deploy.sh logs api
```

### リレーログをアップロードする

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### ワーカーログ

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. ブートストラップ前またはブートストラップ中にインストールまたはアップデートが失敗する

### 症状

- `bootstrap` はゼロ以外で終了します
- アプリサービスが健全になることはありません
- `status` は、API またはブートストラップを待機しているワーカーを示します
- インストールまたはアップデートは `Database authentication failed before bootstrap.` で終了します

### 小切手

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

一般的な原因:

- 悪い `DATABASE_URL`
- 資格情報の不一致 (例: 以前に失敗した展開によるもの)
- `STORAGE_ENCRYPTION_KEY`がありません
- 無効な S3 認証情報
- 壊れた外部 S3 エンドポイント URL
- **ARM64** では、イメージのサポートがありません (`DOCKER_DEFAULT_PLATFORM=linux/amd64` を設定するか、未設定のときに設定する `./scripts/selfhosted/deploy.sh` を使用します)

回復：

1. 元の `.env.selfhosted` がまだある場合は、それを復元して実行します。

```bash
./scripts/selfhosted/deploy.sh update
```

2. 古いデータが必要ない場合は、消去して再インストールしてください。

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**スキーマ/移行メッセージ:** 通常のインストールでは、データベースは空の状態で開始され、ブートストラップによってすべてが設定されます。 **バックアップから Postgres を復元しました** を新しいサーバーに移動したが、移行メタデータが欠落している場合、またはスタックを **間違ったデータベース** に指定した場合、ブートストラップはデータを上書きするのではなく、データベースの不整合に関するエラーで終了することがあります。高度なリカバリを実行している場合を除き、`DATABASE_URL` を修正して一貫性のあるバックアップを復元するか、クリーンなボリュームから開始してください。意図的な移行のみのリカバリの場合、一部のセットアップでは `.env.selfhosted` で `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` を使用します (これを使用する前にメンテナのドキュメントまたはサポートを参照してください)。

### 修理

1. 元の `.env.selfhosted` がある場合は、それを復元して再実行します。

```bash
./scripts/selfhosted/deploy.sh update
```

2. オリジナルの `.env.selfhosted` がない場合は、消去して再インストールします。

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update` は、スキーマ、シード、ストレージ エンドポイントの同期を再実行します。 `reset` は自己ホスト型コンテナーとデータ ボリュームを削除するため、新規インストールで新しい認証情報を安全に生成できます。

---

## 2. セッションはカウントされますが、リプレイは空のままです

### これが現在通常何を意味するか

現在のアーキテクチャでは、これは通常、次の 2 つのうちのいずれかになります。

- `ingest-upload` はアーティファクト バイトを保存できませんでした
- `ingest-worker` はアップロードされたアーティファクトを処理できませんでした

デバイスは MinIO/S3 に直接アップロードされなくなりました。そのため、電話からのバケットへの到達可能性は主な原因ではなくなりました。

### 小切手

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

探す：

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### よくある原因

- `.env.selfhosted` の S3 認証情報が間違っています
- 外部 S3 バケットがありません
- 外部 S3 エンドポイントが Docker ネットワークから到達できません
- アップロードリレーが異常です
- 失敗したアーティファクトの再試行中にワーカーがスタックする

### 修理

- `S3_*` 値を確認する
- ストレージ構成を変更した場合は、次を再実行します。

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. ダッシュボードはロードされますが、認証または API 呼び出しが失敗します

### 小切手

- ダッシュボード ホスト DNS はサーバーを指します
- API ホスト DNS はサーバーを指します
- 取り込みホスト DNS はサーバーを指します
- ポート `80` および `443` が開いています
- Let’s Encrypt は証明書を発行しました

検査:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS または証明書の問題

Traefik は証明書を自動的に管理します。

### 小切手

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

両方の名前がスタックを実行しているサーバーに解決されることを確認してください。

最初のインストール時に DNS が間違っていた場合は、DNS を修正して再実行します。

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. 外部 S3 は CLI で動作しますが、Rejourney はアップロードできません

アップロード パスはサーバー側であることに注意してください。

重要なネットワーク パスは次のとおりです。

- `ingest-upload` コンテナ -> S3 エンドポイント

リレー ログを確認し、`.env.selfhosted` のエンドポイント/バケット/キーを確認して、サーバーからテストします。

変更した場合は、再実行します。

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. 組み込みの MinIO をインストールしてもアーティファクトが失敗する

### 小切手

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

`minio-setup` ワンショットでは、`S3_BUCKET` という名前のバケットを作成する必要があります。

最初のインストール後にバケット名を変更した場合は、次を実行します。

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. 請求ページに無効な請求が表示される

Stripe キーが設定されていない限り、これは予期されます。

スタックは「自己ホスト型」であるため、課金を無効にしなくなりました。 Stripe が構成されていないため、課金が無効になります。

Stripe キーを設定しない場合:

- 課金 UI は自己ホスト型/無制限の状態のままです
- Stripe チェックアウトと Webhook は無効のままになります

---

## 8. `.env.selfhosted` を変更した後、Postgres のストレージ エンドポイントが間違っている

走る：

```bash
./scripts/selfhosted/deploy.sh update
```

更新パスはブートストラップを再実行し、アクティブな `storage_endpoints` 行を再同期します。

---

## 9. データを失わずにサービスを停止する必要がある

使用：

```bash
./scripts/selfhosted/deploy.sh stop
```

これによりコンテナのみが停止されます。ボリュームは削除されません。

---

## 10. 1 つのサービスについてより深いログが必要

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
