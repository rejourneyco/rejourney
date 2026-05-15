# Kendi kendine barındırılan yedekleme ve kurtarma

Rejourney'yi [Docker Compose kendi kendine barındırma](/docs/selfhosted) ile çalıştırırsanız, aşağıdakilerin kopyalarını saklamak için bunları **kritik** olarak değerlendirin:

- Postgres
- `.env.selfhosted`
- Yerleşik MinIO kullanıyorsanız MinIO verileri

---

## Hızlı Yedekleme

Birlikte verilen yardımcıyı kullanın:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Ne yapar:

- Postgres her zaman dökümü
- Mevcut olduğunda Redis anlık görüntüsü
- `.env.selfhosted` her zaman kopyala
- MinIO nesne verileri, `--full` kullanıldığında ve yerleşik MinIO etkinleştirildiğinde

---

## Ne Kaydedilmeli?

### Her zaman kaydet

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### Yerleşik MinIO kullanırken tasarruf edin

- `backups/minio-*.tar.gz`

Harici S3 kullanıyorsanız, kayıtlarınız yerel MinIO birimi yerine bu klasörde yayınlanır; dolayısıyla veritabanı artı `.env.selfhosted` minimum yerel yedeklemelerdir.

---

## Siparişi Geri Yükle

### 1. Yığın yapılandırmasını yeniden oluşturun

Kaydedilen `.env.selfhosted`'yi repo köküne geri koyun.

### 2. Altyapıyı ve önyüklemeyi başlatın

```bash
./scripts/selfhosted/deploy.sh update
```

Bu, hizmetleri geri getirir ve kayıtlı yapılandırmanızdan `storage_endpoints` satırını yeniden oluşturur.

### 3. Postgres'yi geri yükleyin

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. Varsa, MinIO'yi geri yükleyin

Yerleşik MinIO kullanıyorsanız ve bir `--full` yedeği aldıysanız:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. Uygulama hizmetlerini yeniden başlatın

```bash
./scripts/selfhosted/deploy.sh update
```

Bu, önyüklemeyi yeniden çalıştırır ve geri yükleme sonrasında uygulama hizmetlerini yeniden başlatır.

---

## Önerilen Program

Günlük veritabanı yedeklemesi:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

MinIO verileriyle haftalık tam yedekleme:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## Olağanüstü Durum Kurtarma Notları

Yerleşik bir MinIO dağıtımını tamamen geri yüklemek için aşağıdakilerin tümüne ihtiyacınız vardır:

- `.env.selfhosted`
- Postgres yedekleme
- MinIO yedekleme

`.env.selfhosted` olmadan Postgres'deki şifrelenmiş depolama kimlik bilgilerine erişiminizi kaybedebilirsiniz çünkü `STORAGE_ENCRYPTION_KEY` orada yaşıyor.

---

## Doğrulama Kontrol Listesi

Bir geri yüklemeden sonra:

1. `./scripts/selfhosted/deploy.sh status`'yi çalıştırın
2. kontrol paneline giriş yap
3. mevcut bir projeyi aç
4. mevcut bir tekrarı aç
5. yeni bir kısa oturum kaydedin ve göründüğünü doğrulayın

Geri yükleme sonrasında tekrar oynatma işlemi başarısız olursa şunları kontrol edin:

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## Çoklu Paket Doğrulama Sorguları

Ağırlıklı çok birincil uç noktaları etkinleştirmeden önce veya proje kapsamlı paketleri değiştirdikten sonra bu SQL kontrollerini çalıştırın.

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
