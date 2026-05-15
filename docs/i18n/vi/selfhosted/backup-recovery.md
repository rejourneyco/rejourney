# Sao lưu và phục hồi tự lưu trữ

Nếu bạn chạy Rejourney với [Docker Compose tự lưu trữ](/docs/selfhosted), hãy coi chúng là **phê bình** để giữ bản sao của:

- Postgres
- `.env.selfhosted`
- Dữ liệu MinIO nếu bạn sử dụng MinIO tích hợp

---

## Sao lưu nhanh

Sử dụng trình trợ giúp đi kèm:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Nó làm gì:

- Kết xuất Postgres mỗi lần
- Ảnh chụp nhanh Redis khi khả dụng
- `.env.selfhosted` sao chép mọi lúc
- Dữ liệu đối tượng MinIO khi `--full` được sử dụng và MinIO tích hợp được bật

---

## Những gì cần lưu

### Luôn lưu

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### Tiết kiệm khi sử dụng MinIO tích hợp

- `backups/minio-*.tar.gz`

Nếu bạn sử dụng S3 bên ngoài, các bản ghi của bạn sẽ nằm trong bộ chứa đó thay vì ổ đĩa MinIO cục bộ, vì vậy cơ sở dữ liệu cộng với `.env.selfhosted` là bản sao lưu cục bộ tối thiểu.

---

## Khôi phục đơn hàng

### 1. Tạo lại cấu hình ngăn xếp

Đặt `.env.selfhosted` đã lưu trở lại thư mục gốc repo.

### 2. Bắt đầu cơ sở hạ tầng và khởi động

```bash
./scripts/selfhosted/deploy.sh update
```

Thao tác này sẽ đưa các dịch vụ trở lại và tạo lại hàng `storage_endpoints` từ cấu hình đã lưu của bạn.

### 3. Khôi phục Postgres

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. Khôi phục MinIO, nếu có

Nếu bạn sử dụng MinIO tích hợp sẵn và bạn đã sao lưu `--full`:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. Khởi động lại dịch vụ ứng dụng

```bash
./scripts/selfhosted/deploy.sh update
```

Điều đó chạy lại bootstrap và khởi động lại dịch vụ ứng dụng sau khi khôi phục.

---

## Lịch trình đề xuất

Sao lưu cơ sở dữ liệu hàng ngày:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

Sao lưu toàn bộ hàng tuần với dữ liệu MinIO:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## Ghi chú khắc phục thảm họa

Bạn cần tất cả những điều sau đây để khôi phục hoàn toàn quá trình triển khai MinIO tích hợp sẵn:

- `.env.selfhosted`
- Sao lưu Postgres
- Sao lưu MinIO

Nếu không có `.env.selfhosted`, bạn có thể mất quyền truy cập vào thông tin xác thực bộ nhớ được mã hóa trong Postgres vì `STORAGE_ENCRYPTION_KEY` tồn tại ở đó.

---

## Danh sách kiểm tra xác minh

Sau khi khôi phục:

1. chạy `./scripts/selfhosted/deploy.sh status`
2. đăng nhập vào bảng điều khiển
3. mở một dự án hiện có
4. mở một bản phát lại hiện có
5. ghi lại một phiên ngắn mới và xác minh nó xuất hiện

Nếu quá trình nhập lại không thành công sau khi khôi phục, hãy kiểm tra:

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## Truy vấn xác minh nhiều nhóm

Chạy các bước kiểm tra SQL này trước khi bật các điểm cuối đa chính có trọng số hoặc sau khi thay đổi các nhóm trong phạm vi dự án.

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
