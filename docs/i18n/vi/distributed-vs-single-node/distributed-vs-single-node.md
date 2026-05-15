# Đám mây phân tán và đám mây nút đơn

Rejourney hỗ trợ hai hình thức triển khai tự lưu trữ chính thức:

- **Nút đơn Docker Compose** cho một máy chủ hoặc VPS
- **Phân phối K3s** dành cho cụm sản xuất và chia tỷ lệ theo chiều ngang

Cả hai hiện đều sử dụng cùng một mô hình phụ trợ cốt lõi:

- điểm cuối lưu trữ được hỗ trợ bởi cơ sở dữ liệu
- tải lên nhập vào đi qua chuyển tiếp tải lên thuộc sở hữu phụ trợ
- công nhân xử lý các hiện vật đã được xác minh
- khả năng hiển thị phát lại được điều khiển bằng tạo tác

---

## So sánh tính năng

| Tính năng | Đám mây phân tán | Đám mây nút đơn |
|---------|--------------------|-------------------|
| Nền tảng | K3s | Docker Compose |
| Quy mô | Đa nút | Nút đơn |
| Điểm vào công cộng | Xâm nhập Traefik | Thùng chứa Traefik |
| Đường dẫn tải lên | API + dịch vụ tải lên | API + dịch vụ tải lên |
| Nguồn lưu trữ sự thật | Bảng `storage_endpoints` | Bảng `storage_endpoints` |
| Lưu trữ đối tượng mặc định | S3 bên ngoài | MinIO tích hợp |
| Hỗ trợ S3 bên ngoài | Có | Có |
| Mã hóa bí mật | `STORAGE_ENCRYPTION_KEY` | `STORAGE_ENCRYPTION_KEY` |
| Luồng cập nhật | k8s triển khai + việc làm | `deploy.sh update` |

---

## Mô hình lưu trữ chia sẻ

Trong cả hai mô hình triển khai, cấu hình lưu trữ thời gian chạy đều đến từ Postgres, không phải từ dự phòng env.

Điều đó có nghĩa là:

- điểm cuối lưu trữ đối tượng đang hoạt động được lưu trữ trong `storage_endpoints`
- khóa truy cập bí mật được mã hóa thành `key_ref`
- thời gian chạy đọc hàng cơ sở dữ liệu
- Các tập lệnh bootstrap/install chịu trách nhiệm đồng bộ hóa đầu vào `.env` vào hàng cơ sở dữ liệu

Điều này làm cho Docker tự lưu trữ gần giống với sản phẩm và local-k8s hơn nhiều so với mô hình dự phòng cũ.

---

## Khi nào nên chọn nút đơn Docker Compose

Chọn Docker Compose khi:

- bạn đang triển khai trên một máy chủ VPS hoặc máy chủ kim loại trần
- bạn muốn đường dẫn cài đặt nhanh nhất
- bạn muốn MinIO tích hợp sẵn theo mặc định
- bạn không cần chia tỷ lệ nhiều nút hoặc thao tác Kubernetes

Điểm vào chính thức:

- `docker-compose.selfhosted.yml`
- `scripts/selfhosted/deploy.sh`
- `docs/selfhosted/README.md`

---

## Khi nào nên chọn K3s phân tán

Chọn K3s khi:

- bạn cần nhiều nút
- bạn muốn các hoạt động gốc và xử lý bí mật Kubernetes
- bạn muốn mở rộng quy mô API, dịch vụ tải lên và dịch vụ công nhân một cách độc lập
- bạn muốn triển khai luân phiên và cách ly hồng ngoại mạnh hơn

Đường dẫn K3s nằm trong `k8s/` và `scripts/k8s/`.

---

## Sự khác biệt trong hoạt động

Sự khác biệt chính không còn là mô hình dữ liệu nữa. Đó là hình dạng hoạt động:

- Compose: một máy, một mạng Docker, một tập lệnh vận hành
- K3s: nhiều nhóm, không gian tên, xâm nhập cụm, công việc và bí mật Kubernetes

---

## Hướng dẫn thực hành

Bắt đầu với nút đơn Compose nếu bạn muốn tự lưu trữ nhanh chóng.

Di chuyển đến K3s khi bạn cần:

- thông lượng nhiều hơn
- triển khai cụm cán
- chia tỷ lệ ngang
- sự tách biệt cơ sở hạ tầng linh hoạt hơn

---

## Tài liệu kiến ​​trúc nội bộ

Để có hình ảnh kỹ thuật nội bộ mới nhất và thông tin chi tiết hơn về người vận hành:

- `dev_docs/ingest-session-recording-lifecycle.md` (sơ đồ vòng đời phiên)
- `dev_docs/storage-and-endpoints.md` (sơ đồ cấu trúc liên kết nhiều nhóm)
- `dev_docs/allthingscloud.md` (sơ đồ thiết lập đám mây k3s)

### Vòng đời phiên

![Cấu trúc vòng đời phiên](./assets/session-lifecycle.svg)

### Cấu trúc liên kết nhiều nhóm

![Cấu trúc liên kết lưu trữ nhiều nhóm](./assets/multi-bucket-topology.svg)

### Thiết lập đám mây K3s

![K3s kiến ​​trúc đám mây phân tán](./assets/k3s-cloud-setup.svg)
