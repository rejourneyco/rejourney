# Khắc phục sự cố tự lưu trữ

Sử dụng trang này nếu bạn đã theo dõi [Rejourney tự lưu trữ](/docs/selfhosted) và có điều gì đó không thành công hoặc hoạt động kỳ lạ. Các lệnh được chạy từ **kho lưu trữ gốc** (nơi `docker-compose.selfhosted.yml` tồn tại).

---

## Kiểm tra nhanh

### Trạng thái dịch vụ

```bash
./scripts/selfhosted/deploy.sh status
```

### Nhật ký API

```bash
./scripts/selfhosted/deploy.sh logs api
```

### Tải lên nhật ký chuyển tiếp

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### Nhật ký công nhân

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. Cài đặt hoặc cập nhật không thành công trước hoặc trong khi khởi động

### Triệu chứng

- `bootstrap` thoát khác không
- dịch vụ ứng dụng không bao giờ trở nên lành mạnh
- `status` hiển thị API hoặc công nhân đang chờ trên bootstrap
- cài đặt hoặc cập nhật thoát bằng `Database authentication failed before bootstrap.`

### Séc

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

Nguyên nhân phổ biến:

- xấu `DATABASE_URL`
- thông tin xác thực không khớp (ví dụ: từ lần triển khai không thành công trước đó)
- thiếu `STORAGE_ENCRYPTION_KEY`
- thông tin xác thực S3 không hợp lệ
- URL điểm cuối S3 bên ngoài bị hỏng
- trên **ARM64**, thiếu hỗ trợ hình ảnh (đặt `DOCKER_DEFAULT_PLATFORM=linux/amd64` hoặc sử dụng `./scripts/selfhosted/deploy.sh`, cài đặt này khi không được đặt)

Sự hồi phục:

1. Nếu bạn vẫn còn `.env.selfhosted` gốc, hãy khôi phục nó và chạy:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Nếu bạn không cần dữ liệu cũ, hãy xóa và cài đặt lại:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**Thông báo lược đồ/di chuyển:** Khi cài đặt bình thường, cơ sở dữ liệu bắt đầu trống và bootstrap sẽ thiết lập mọi thứ. Nếu bạn **đã khôi phục Postgres từ bản sao lưu** vào máy chủ mới nhưng thiếu siêu dữ liệu di chuyển hoặc bạn trỏ ngăn xếp vào **cơ sở dữ liệu sai**, bootstrap có thể thoát với lỗi về cơ sở dữ liệu không nhất quán thay vì ghi đè dữ liệu của bạn. Trừ khi bạn đang thực hiện khôi phục nâng cao, hãy sửa `DATABASE_URL` và khôi phục bản sao lưu nhất quán hoặc bắt đầu từ ổ đĩa sạch. Để khôi phục chỉ di chuyển có chủ ý, một số thiết lập sử dụng `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` trong `.env.selfhosted` (xem tài liệu hoặc hỗ trợ của người bảo trì trước khi sử dụng).

### Sửa chữa

1. Nếu bạn có `.env.selfhosted` gốc, hãy khôi phục nó và chạy lại:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Nếu bạn không có `.env.selfhosted` gốc, hãy xóa và cài đặt lại:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update` chạy lại đồng bộ hóa lược đồ, hạt giống và điểm cuối lưu trữ. `reset` loại bỏ các vùng chứa và khối lượng dữ liệu tự lưu trữ để cài đặt mới có thể tạo thông tin xác thực mới một cách an toàn.

---

## 2. Phiên được tính nhưng Phát lại vẫn trống

### Điều này thường có nghĩa là gì bây giờ

Với kiến ​​trúc hiện tại, đây thường là một trong hai điều sau:

- `ingest-upload` không thể lưu trữ các byte giả
- `ingest-worker` không thể xử lý cấu phần phần mềm được tải lên

Thiết bị không còn tải trực tiếp lên MinIO/S3 nữa, do đó, khả năng tiếp cận nhóm từ điện thoại không còn là nghi phạm chính nữa.

### Séc

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

Hãy tìm:

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### Nguyên nhân phổ biến

- sai thông tin xác thực S3 trong `.env.selfhosted`
- Thiếu nhóm S3 bên ngoài
- Không thể truy cập điểm cuối S3 bên ngoài từ mạng Docker
- rơ-le tải lên không tốt
- công nhân bị mắc kẹt khi thử lại các tạo phẩm không thành công

### Sửa chữa

- xác minh giá trị `S3_*`
- nếu bạn thay đổi cấu hình lưu trữ, hãy chạy lại:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. Tải trang tổng quan nhưng lệnh gọi xác thực hoặc API không thành công

### Séc

- máy chủ bảng điều khiển DNS trỏ đến máy chủ
- Máy chủ API DNS trỏ đến máy chủ
- nhập máy chủ DNS trỏ đến máy chủ
- cổng `80` và `443` đang mở
- Let’s Encrypt đã cấp giấy chứng nhận

Thanh tra:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS hoặc các vấn đề về chứng chỉ

Traefik tự động quản lý chứng chỉ.

### Séc

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

Đảm bảo cả hai tên đều được phân giải đến máy chủ đang chạy ngăn xếp.

Nếu DNS bị lỗi trong lần cài đặt đầu tiên, hãy sửa DNS và chạy lại:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. S3 bên ngoài hoạt động trong CLI, nhưng Rejourney không thể tải lên

Hãy nhớ đường dẫn tải lên là phía máy chủ.

Đường dẫn mạng quan trọng là:

- Vùng chứa `ingest-upload` -> điểm cuối S3 của bạn

Kiểm tra từ máy chủ bằng cách xem lại nhật ký chuyển tiếp và xác nhận điểm cuối/nhóm/khóa trong `.env.selfhosted`.

Nếu bạn thay đổi chúng, hãy chạy lại:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. Cài đặt MinIO tích hợp nhưng tạo tác vẫn không thành công

### Séc

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

One-shot `minio-setup` sẽ tạo nhóm được đặt tên theo `S3_BUCKET`.

Nếu bạn thay đổi tên nhóm sau lần cài đặt đầu tiên, hãy chạy:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. Trang thanh toán hiển thị tính năng thanh toán bị vô hiệu hóa

Điều đó được mong đợi trừ khi các khóa Stripe được định cấu hình.

Ngăn xếp không còn vô hiệu hóa tính năng thanh toán vì nó "tự lưu trữ". Nó vô hiệu hóa thanh toán vì Stripe chưa được định cấu hình.

Nếu bạn không đặt khóa Stripe:

- Giao diện người dùng thanh toán vẫn ở trạng thái tự lưu trữ/không giới hạn
- Thanh toán Stripe và webhook vẫn bị vô hiệu hóa

---

## 8. Điểm cuối lưu trữ trong Postgres bị sai sau khi thay đổi `.env.selfhosted`

Chạy:

```bash
./scripts/selfhosted/deploy.sh update
```

Đường dẫn cập nhật chạy lại bootstrap và đồng bộ lại hàng `storage_endpoints` đang hoạt động.

---

## 9. Cần dừng dịch vụ mà không mất dữ liệu

Sử dụng:

```bash
./scripts/selfhosted/deploy.sh stop
```

Điều này chỉ dừng các container. Nó không loại bỏ khối lượng.

---

## 10. Cần nhật ký sâu hơn cho một dịch vụ

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
