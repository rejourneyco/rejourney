# セルフホスト型のバックアップとリカバリ

[Docker Compose セルフホスティング](/docs/selfhosted) で Rejourney を実行する場合、これらを **致命的** として扱い、以下のコピーを保持します。

- Postgres
- `.env.selfhosted`
- 組み込みの MinIO を使用する場合は、MinIO データ

---

## クイックバックアップ

バンドルされたヘルパーを使用します。

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

機能:

- 毎回Postgresダンプ
- Redis スナップショット (利用可能な場合)
- `.env.selfhosted` 毎回コピー
- `--full` が使用され、組み込み MinIO が有効になっている場合の MinIO オブジェクト データ

---

## 何を保存するか

### 常に保存する

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### 内蔵 MinIO 使用時に保存

- `backups/minio-*.tar.gz`

外部 S3 を使用する場合、録画はローカル MinIO ボリュームではなくそのバケットに保存されるため、データベースと `.env.selfhosted` が最小限のローカル バックアップになります。

---

## 順序を復元する

### 1. スタック構成を再作成します

保存した `.env.selfhosted` をリポジトリのルートに戻します。

### 2. インフラストラクチャとブートストラップを開始する

```bash
./scripts/selfhosted/deploy.sh update
```

これによりサービスが元に戻り、保存された構成から `storage_endpoints` 行が再作成されます。

### 3. Postgresを復元する

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. 該当する場合、MinIO を復元します。

組み込みの MinIO を使用し、`--full` バックアップを作成した場合:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. アプリサービスを再起動します

```bash
./scripts/selfhosted/deploy.sh update
```

これにより、ブートストラップが再実行され、復元後にアプリ サービスが再起動されます。

---

## おすすめのスケジュール

毎日のデータベースのバックアップ:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

MinIO データによる毎週の完全バックアップ:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## 災害復旧メモ

組み込みの MinIO 展開を完全に復元するには、次のすべてが必要です。

- `.env.selfhosted`
- Postgres バックアップ
- MinIO バックアップ

`.env.selfhosted` が存在しない場合、`STORAGE_ENCRYPTION_KEY` がそこに存在するため、Postgres 内の暗号化されたストレージ資格情報にアクセスできなくなる可能性があります。

---

## 検証チェックリスト

復元後:

1. `./scripts/selfhosted/deploy.sh status`を実行
2. ダッシュボードにログインする
3. 既存のプロジェクトを開く
4. 既存のリプレイを開く
5. 新しい短いセッションを 1 つ録音し、それが表示されることを確認します

復元後にリプレイの取り込みが失敗する場合は、以下を確認してください。

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## マルチバケット検証クエリ

これらの SQL チェックは、重み付けされたマルチプライマリ エンドポイントを有効にする前、またはプロジェクト スコープのバケットを変更した後に実行します。

```sql
-- Sessions whose ready artifacts are split across multiple endpoint_ids.
SELECT
  ra.session_id,
  COUNT(DISTINCT COALESCE(ra.endpoint_id, 'global-default')) AS endpoint_count
FROM recording_artifacts ra
WHERE ra.status = 'ready'
GROUP BY ra.session_id
HAVING COUNT(DISTINCT COALESCE(ra.endpoint_id, 'global-default')) > 1
ORDER BY endpoint_count DESC, ra.session_id
LIMIT 200;
```

```sql
-- Ready artifacts with missing/invalid endpoint mapping.
SELECT
  ra.id,
  ra.session_id,
  ra.kind,
  ra.endpoint_id,
  ra.s3_object_key
FROM recording_artifacts ra
LEFT JOIN storage_endpoints se ON se.id = ra.endpoint_id
WHERE ra.status = 'ready'
  AND ra.endpoint_id IS NOT NULL
  AND se.id IS NULL
ORDER BY ra.session_id, ra.kind
LIMIT 500;
```

```sql
-- Backup success ratio by project (uses session_backup_log rows as successful backups).
SELECT
  s.project_id,
  COUNT(*) FILTER (WHERE bl.session_id IS NOT NULL) AS backed_up_sessions,
  COUNT(*) AS eligible_sessions,
  ROUND(
    (COUNT(*) FILTER (WHERE bl.session_id IS NOT NULL)::numeric / NULLIF(COUNT(*), 0)) * 100,
    2
  ) AS backup_coverage_percent
FROM sessions s
LEFT JOIN session_backup_log bl ON bl.session_id = s.id
WHERE s.status IN ('ready', 'completed')
GROUP BY s.project_id
ORDER BY backup_coverage_percent ASC, eligible_sessions DESC;
```
