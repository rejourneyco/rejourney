# Tự lưu trữ Rejourney

Hướng dẫn này dành cho **bất cứ ai** chạy Rejourney trên máy chủ của riêng họ (thường là một VPS hoặc máy chuyên dụng) sử dụng ngăn xếp **Docker Compose** chính thức. Bạn không cần quyền truy cập vào cơ sở hạ tầng nội bộ của Rejourney hoặc Kubernetes.

Sau khi thiết lập bạn nhận được:

- **bảng điều khiển web** tại miền của bạn (HTTPS qua Let’s Encrypt)
- **API** trên tên miền phụ (dành cho trang tổng quan và SDK trên thiết bị di động)
- **chuyển tiếp nhập (tải lên)** trên một tên miền phụ khác (phiên tải lên sẽ đi qua máy chủ của bạn chứ không phải trực tiếp từ điện thoại đến bộ lưu trữ đối tượng)
- **PostgreSQL**, **Redis** và **MinIO tích hợp sẵn** hoặc **bộ lưu trữ S3-compatible của riêng bạn**
- Nền tảng **công nhân** xử lý các phiên, lưu giữ và cảnh báo (các vai trò tương tự như trong triển khai đám mây của Rejourney)

Tất cả các lệnh bên dưới giả sử bạn đang ở trong **kho lưu trữ gốc** sau khi sao chép (thư mục chứa `docker-compose.selfhosted.yml`).

---

## Những gì bạn cần trước

### Máy chủ

- **Hệ điều hành:** Ubuntu 22.04+, Debian 12+ hoặc Linux khác chạy tốt Docker
- **Docker:** 24 ​​hoặc mới hơn, với **Phần bổ trợ Docker Compose** (`docker compose version` sẽ hoạt động)
- **Tài nguyên (được khuyến nghị):** 4 vCPU, RAM 8 GB, ổ đĩa 40 GB (nhiều hơn nếu bạn lưu giữ nhiều bản ghi)
- **Mạng:** Cổng **80** và **443** mở kết nối internet (bắt buộc đối với thử thách Let’s Encrypt HTTP và HTTPS)

### Tên miền và DNS

Bạn cần **một tên miền cơ sở** mà bạn điều khiển (ví dụ `example.com`). Trước khi chạy trình cài đặt, hãy tạo bản ghi DNS **MỘT** (hoặc **AAAA**) trỏ **tất cả** của các tên máy chủ này vào IP công cộng trên máy chủ của bạn:

| Tên máy chủ | Mục đích |
|----------|---------|
| `example.com` | Trang tổng quan |
| `www.example.com` | Chuyển hướng đến bảng điều khiển |
| `api.example.com` | API (và WebSocket khi được sử dụng) |
| `ingest.example.com` | Chuyển tiếp tải lên (SDK tự động sử dụng tính năng này sau khi API được định cấu hình) |

Thay thế `example.com` bằng tên miền thực của bạn. Việc nhân giống có thể mất vài phút đến vài giờ; Chứng chỉ TLS sẽ không được cấp cho đến khi DNS được giải quyết chính xác.

### Let’s Encrypt

Bạn sẽ được yêu cầu **địa chỉ email** trong khi cài đặt. Nó được sử dụng cho các thông báo hết hạn chứng chỉ từ Let’s Encrypt.

### Công cụ trên máy của bạn

- `git` để sao chép kho lưu trữ
- `openssl` (được sử dụng bởi tập lệnh cài đặt để tạo bí mật)
- Một shell (bash là ổn)

---

## Cài đặt lần đầu

### 1. Sao chép kho lưu trữ

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

Ở trên nhánh mặc định (hoặc thẻ phát hành nếu dự án ghi lại một thẻ để tự lưu trữ).

### 2. Chạy trình cài đặt

```bash
./scripts/selfhosted/deploy.sh install
```

Kịch bản sẽ:

1. Yêu cầu **miền cơ sở** của bạn (ví dụ: `example.com` — không phải `https://`, không có đường dẫn).
2. Yêu cầu **Email Let’s Encrypt** của bạn.
3. Yêu cầu bộ lưu trữ **kho**: bộ lưu trữ **MinIO** (được khuyến nghị) hoặc **bên ngoài S3-compatible** tích hợp (bạn sẽ nhập điểm cuối, nhóm, vùng và khóa).
4. Tạo **`.env.selfhosted`** trong thư mục gốc repo bằng mật khẩu và bí mật được tạo. **Hạn chế quyền** được áp dụng (`chmod 600`).
5. **Sự lôi kéo** đã xuất bản hình ảnh vùng chứa (API, web, công nhân, cơ sở dữ liệu, Traefik, v.v.).
6. **Xây dựng** hình ảnh **khởi động/di chuyển** **từ bản sao của bạn** (nó chứa các tập lệnh thiết lập cơ sở dữ liệu; nó không được tải xuống từ sổ đăng ký vùng chứa).
7. Bắt đầu cơ sở dữ liệu, Redis, Traefik và (nếu được chọn) MinIO.
8. Xác thực kết nối cơ sở dữ liệu bằng cách sử dụng `DATABASE_URL` đã định cấu hình trước khi chạy bootstrap.
9. Chạy bộ chứa **khởi động** một lần: lược đồ cơ sở dữ liệu, hạt giống lần đầu tùy chọn và cấu hình lưu trữ trong cơ sở dữ liệu.
10. Khởi động API, tải lên rơle, bảng điều khiển và công nhân.

Lần cài đặt đầu tiên có thể mất vài phút (kéo hình ảnh và khởi động lại).

### 3. Bảo vệ `.env.selfhosted`

Tệp này chứa **tất cả bí mật** để triển khai của bạn (cơ sở dữ liệu, Redis, JWT, mã hóa bộ nhớ, thông tin xác thực MinIO nếu được sử dụng, v.v.). **Sao lưu nó** đến nơi an toàn (trình quản lý mật khẩu, sao lưu được mã hóa). Nếu làm mất nó, bạn có thể mất khả năng giải mã thông tin xác thực được lưu trữ hoặc xây dựng lại quá trình triển khai tương tự.

Đừng cam kết nó với git (`.gitignore` nên bỏ qua nó).

---

## Sau khi cài đặt

### URL

Trình cài đặt in các URL. Nói chung:

- **Bảng điều khiển:** `https://<your-base-domain>`
- **API:** `https://api.<your-base-domain>`
- **Nhập:** `https://ingest.<your-base-domain>`

`www.<your-base-domain>` chuyển hướng đến trang tổng quan.

### Xác minh ngăn xếp

```bash
./scripts/selfhosted/deploy.sh status
```

Bạn sẽ thấy các container đang chạy; `api` và `ingest-upload` sẽ trở thành **khỏe mạnh** sau một thời gian ngắn.

### Đăng nhập lần đầu và ghi thử nghiệm

1. Mở bảng điều khiển trong trình duyệt.
2. Tạo một tài khoản và một dự án.
3. Định cấu hình Rejourney SDK của ứng dụng với **URL API** của bạn (xem [cấu hình SDK](#configuring-your-mobile-app) bên dưới).
4. Ghi lại một phiên ngắn và xác nhận nó xuất hiện trong Phát lại.

Nếu các phiên không bao giờ hiển thị trong Phát lại, hãy xem [Khắc phục sự cố](/docs/selfhosted/troubleshooting) (tải lên rơle và nhập nhật ký công nhân).

---

## Hoạt động hàng ngày

Tất cả đều chạy từ root repo.

| Hành động | Lệnh |
|--------|---------|
| Tình trạng dịch vụ | `./scripts/selfhosted/deploy.sh status` |
| Theo dõi tất cả nhật ký | `./scripts/selfhosted/deploy.sh logs` |
| Nhật ký cho một dịch vụ | `./scripts/selfhosted/deploy.sh logs api` (thay `api` bằng `web`, `ingest-upload`, `ingest-worker`, v.v.) |
| Hình ảnh **Nâng cấp** và chạy lại bootstrap | `./scripts/selfhosted/deploy.sh update` |
| Dừng mọi thứ **không có** xóa dữ liệu | `./scripts/selfhosted/deploy.sh stop` |
| Thùng chứa và khối lượng **Cài lại** (phá hủy) | `./scripts/selfhosted/deploy.sh reset` |

**`update`** lấy các hình ảnh mới hơn (nếu có), xây dựng lại hình ảnh bootstrap từ bản sao hiện tại của bạn, khởi động lại ngăn xếp và chạy lại bootstrap để lược đồ cơ sở dữ liệu và cài đặt lưu trữ luôn được căn chỉnh với `.env.selfhosted` của bạn. Nó thực hiện **không** xóa Postgres hoặc khối lượng lưu trữ đối tượng.

Trước khi khởi động, cả `install` và `update` đều xác thực kết nối cơ sở dữ liệu bằng thông tin xác thực đã định cấu hình. Nếu thông tin đăng nhập không khớp với dữ liệu Postgres liên tục, quá trình triển khai sẽ dừng sớm với hướng dẫn khôi phục thay vì bị lỗi sau đó trong quá trình khởi động.

**`stop`** chỉ dừng các container; Docker **tập** (dữ liệu Postgres, dữ liệu MinIO, v.v.) vẫn còn cho đến khi bạn xóa chúng một cách rõ ràng.

**`reset`** loại bỏ các vùng chứa tự lưu trữ và các ổ đĩa Docker (`pgdata`, `redisdata`, `miniodata`, `traefik-certs`) sau lời nhắc xác nhận. Nó cũng phá bỏ các vùng chứa hồ sơ MinIO ngay cả khi thiếu `.env.selfhosted`, do đó, dữ liệu MinIO cũ không chặn lần cài đặt tiếp theo. Chỉ sử dụng điều này khi bạn muốn cài đặt hoàn toàn mới.

---

## Bộ nhớ: MinIO so với S3 bên ngoài

### MinIO tích hợp (mặc định)

- Dễ dàng nhất đối với một máy chủ: bộ lưu trữ đối tượng chạy **bên trong Docker** và không được hiển thị trên Internet công cộng theo mặc định.
- Các byte phiên được ghi bởi dịch vụ **nhập-tải lên**; các thiết bị không cần phải tiếp cận trực tiếp MinIO.
- Việc tạo nhóm được xử lý trong quá trình cài đặt.

### Bộ nhớ ngoài S3-compatible

Sử dụng AWS S3, Cloudflare R2, Bộ lưu trữ đối tượng Hetzner, Wasabi hoặc bất kỳ S3-compatible API nào. Trong quá trình cài đặt, bạn cung cấp URL điểm cuối, nhóm, vùng và khóa truy cập.

Ví dụ về kiểu URL điểm cuối (tài liệu của nhà cung cấp của bạn là có thẩm quyền):

- AWS: `https://s3.<region>.amazonaws.com`
- Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`
- Hetzner: `https://<location>.your-objectstorage.com`

Nếu bạn thêm **URL công khai riêng biệt** để tải xuống, hãy đặt `S3_PUBLIC_ENDPOINT` trong `.env.selfhosted` và chạy `./scripts/selfhosted/deploy.sh update`.

---

## Cấu hình quan trọng (`.env.selfhosted`)

Trình cài đặt tạo ra tập tin này. Các biến điển hình bao gồm:

- **Tên miền và URL công khai:** `BASE_DOMAIN`, `DASHBOARD_DOMAIN`, `API_DOMAIN`, `INGEST_DOMAIN`, `PUBLIC_*_URL`
- **Cơ sở dữ liệu:** `DATABASE_URL` (chỉ vào dịch vụ `postgres` bên trong Compose)
- **Redis:** `REDIS_URL`
- **Kho:** `STORAGE_BACKEND`, `S3_*` và tùy chọn `MINIO_*`
- **Bảo vệ:** `JWT_SECRET`, `JWT_SIGNING_KEY`, `INGEST_HMAC_SECRET`, `STORAGE_ENCRYPTION_KEY`

Tích hợp tùy chọn (để trống nếu không sử dụng): Stripe, SMTP, GitHub OAuth, Turnstile, v.v.

**Thay đổi giá trị lưu trữ hoặc liên quan đến tên miền:** chỉnh sửa `.env.selfhosted`, sau đó chạy:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## Cách thiết lập cơ sở dữ liệu hoạt động (khởi động lần đầu và cập nhật sau)

Thông thường bạn làm **không** cần chạy SQL bằng tay. Thùng chứa **khởi động** xử lý nó.

- Ngăn xếp **Cơ sở dữ liệu trống hoàn toàn mới:** áp dụng lược đồ hiện tại từ mã, sau đó ghi lại phiên bản di chuyển nào đã được đáp ứng để các bản cập nhật trong tương lai chỉ áp dụng di chuyển **mới**.
- **Cơ sở dữ liệu hiện có (đã được khởi tạo):** chỉ áp dụng di chuyển **chưa giải quyết**. Dữ liệu của bạn không được xây dựng lại từ đầu trên mỗi `update`.
- Nếu cơ sở dữ liệu **đã có bàn rồi** nhưng bảng lịch sử di chuyển là **thiếu hoặc trống** (ví dụ: khôi phục một phần), hãy khởi động **dừng lại với một lỗi** để tránh thiệt hại do tai nạn. Các tùy chọn khôi phục nâng cao được ghi lại trong [Khắc phục sự cố](/docs/selfhosted/troubleshooting).

---

## Máy chủ Apple Silicon và ARM

Trên các máy **ARM64** (nhiều máy Mac, một số phiên bản đám mây), tập lệnh triển khai đặt `DOCKER_DEFAULT_PLATFORM=linux/amd64` để kéo hình ảnh khi bạn chưa tự thiết lập, vì vậy các hình ảnh dựng sẵn chỉ xuất bản `amd64` vẫn chạy. Nếu bạn cần một hành vi khác, hãy đặt `DOCKER_DEFAULT_PLATFORM` trong môi trường của bạn trước khi chạy tập lệnh.

Hình ảnh **khởi động** luôn là **được xây dựng trên máy của bạn** từ kho lưu trữ nhân bản, vì vậy nó luôn khớp với giao dịch thanh toán của bạn.

---

## Những gì chạy trong Docker (tổng quan)

- Chứng chỉ **Traefik:** HTTPS và định tuyến đến bảng điều khiển, API và nhập tên máy chủ.
- **Postgres / Redis:** Dữ liệu ứng dụng và hàng đợi.
- **MinIO:** Lưu trữ đối tượng bên trong tùy chọn.
- **API:** Chính HTTP API.
- **nhập-tải lên:** Dịch vụ chuyên dụng cho lưu lượng chuyển tiếp tải lên.
- Giao diện người dùng tĩnh của bảng điều khiển **mạng:**.
- **Công nhân:** Xử lý hàng đợi nhập, tạo phẩm phát lại, vòng đời phiên, công việc theo kiểu lưu giữ theo lịch trình và cảnh báo.

Có **KHÔNG** xử lý lô thanh toán riêng biệt trong ngăn xếp này; Tích hợp thanh toán được điều khiển bởi Stripe và API khi bạn định cấu hình khóa.

---

## Định cấu hình ứng dụng di động của bạn

Trỏ SDK vào máy chủ **của bạn** API (phải khớp với `API_DOMAIN` / `PUBLIC_API_URL`).

### Ví dụ về React Native

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

Sử dụng URL API thực của bạn. URL tải lên được lấy tự động cho `ingest.<your-domain>` khi máy chủ được định cấu hình chính xác.

---

## Sao lưu

Tối thiểu, hãy sao lưu **PostgreSQL**, **`.env.selfhosted`** và (nếu bạn sử dụng MinIO tích hợp sẵn) **dữ liệu lưu trữ đối tượng**.

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Chi tiết: [Sao lưu và khôi phục](/docs/selfhosted/backup-recovery).

---

## Khắc phục sự cố và hỗ trợ

- [Khắc phục sự cố](/docs/selfhosted/troubleshooting) — lỗi khởi động, TLS, Phát lại trống, sự cố S3 bên ngoài.
- [Sao lưu & Khôi phục](/docs/selfhosted/backup-recovery) — khôi phục trật tự và MinIO.

Để biết các lỗi hoặc cải tiến đối với các tài liệu này, hãy sử dụng trình theo dõi sự cố công khai của dự án trên GitHub.

---

## Tài liệu liên quan

- [Đám mây phân tán và đám mây một nút](/docs/distributed-vs-single-node/distributed-vs-single-node) — so sánh điều này với bố cục đám mây đa dịch vụ (khái niệm) như thế nào.
