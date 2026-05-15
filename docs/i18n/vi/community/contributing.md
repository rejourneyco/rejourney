# Đóng góp cho Rejourney

Chúng tôi hoan nghênh những đóng góp! Vui lòng xem hướng dẫn bên dưới để bắt đầu.

## Cấu trúc dự án

Đây là một monorepo được quản lý bởi không gian làm việc npm.

## Điều kiện tiên quyết

1. **Node.js** >= 18.0.0
2. **npm** hoặc **yarn** (không gian làm việc hoạt động với cả hai)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**: Xcode và CocoaPods
7. **Android**: Android Studio và JDK 17

## Thiết lập ban đầu

### 1. Cài đặt phụ thuộc

Từ **gốc** của monorepo:

```bash
npm install
```

Điều này sẽ:
- Cài đặt tất cả các phụ thuộc không gian làm việc
- Tự động xây dựng gói SDK (chạy `npm run build:sdk` thông qua tập lệnh `postinstall` trong thư mục gốc `package.json`)
- Liên kết tất cả các gói một cách chính xác

### 2. Xây dựng SDK

Nếu bạn cần xây dựng lại SDK sau khi thực hiện thay đổi:

```bash
npm run build:sdk
```

Hoặc để có một bản dựng sạch:

```bash
npm run build:clean
```

## Phát triển phụ trợ (Kubernetes cục bộ)

Rejourney sử dụng `local-k8s/` để phát triển cục bộ nên thời gian chạy gần với thiết lập Kubernetes sản xuất trong khi vẫn duy trì vòng lặp hàng ngày nhanh.

### 1. Cấu hình `.env.k8s.local`

Sao chép mẫu môi trường Kubernetes cục bộ:

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. Bắt đầu nhóm phát triển lai

```bash
npm run dev
```

Dòng chảy đó:

- Tạo cụm `k3d` cục bộ nếu cần
- Áp dụng `local-k8s/namespace.yaml`, `postgres.yaml`, `redis.yaml` và `minio.yaml`
- Đồng bộ hóa `.env.k8s.local` thành bí mật Kubernetes
- Chạy API, bảng thông tin và trình chạy từ nguồn trên máy chủ của bạn

Để chạy chẵn lẻ đầy đủ trong cụm:

```bash
npm run dev:full
```

Để dừng ngăn xếp cục bộ:

```bash
npm run dev:down
```

### 3. Cấu hình địa chỉ IP (Kiểm tra thiết bị vật lý)

Nếu bạn đang thử nghiệm trên **thiết bị vật lý** (iOS hoặc Android) được kết nối với cùng một WiFi thì SDK và Bảng điều khiển cần biết địa chỉ IP cục bộ của máy tính của bạn để liên lạc.

#### Tìm địa chỉ IP của bạn (Mac)

Chạy lệnh sau trong terminal của bạn:

```bash
ipconfig getifaddr en0
```

Hoặc tìm nó trong **Cài đặt hệ thống > WiFi > Chi tiết [Mạng của bạn]**.

#### Cập nhật `.env.k8s.local`

Các biến sau **PHẢI** sử dụng địa chỉ IP cục bộ của bạn (ví dụ: `http://192.168.1.5:3000`) thay vì `localhost`:

| Biến | Cách sử dụng khóa |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` | Quyền truy cập công khai vào MinIO để phát lại video |
| `PUBLIC_DASHBOARD_URL` | URL cơ sở cho giao diện người dùng trang tổng quan |
| `PUBLIC_API_URL` | URL cơ sở cho API |
| `PUBLIC_INGEST_URL` | URL cơ sở để nhập sự kiện SDK |
| `DASHBOARD_ORIGIN` | Nguồn gốc CORS cho bảng điều khiển |
| `OAUTH_REDIRECT_BASE` | URL cơ sở cho lệnh gọi lại OAuth |




> [!IMPORTANT]
> Việc không đặt chính xác các cài đặt này sẽ dẫn đến lỗi "Từ chối kết nối" trên thiết bị vật lý hoặc liên kết hình ảnh/video bị hỏng trong trang tổng quan.

`npm run dev` tự động cập nhật các giá trị mạng LAN này thông qua `scripts/local-k8s/update-ips.sh`, đồng thời ghi các tệp env ứng dụng mẫu được ứng dụng Expo sử dụng.

#### Cấu hình ví dụ (`.env.k8s.local`)

Giả sử địa chỉ IP máy tính của bạn là `192.168.1.100`:

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

### 4. Tệp Kubernetes cục bộ

Các biểu hiện Kubernetes cục bộ cố tình phản ánh bố cục `k8s/` sản xuất:

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## Chạy ứng dụng mẫu

### Tấm nồi hơi React Native (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

Hoặc từ thư mục ví dụ:

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### Phòng thí nghiệm pha cà phê (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native trần

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## Nó hoạt động như thế nào

### Thiết lập không gian làm việc

Monorepo sử dụng không gian làm việc npm cho các gói cốt lõi, nhưng các ứng dụng mẫu là độc lập:

1. **Gốc `package.json`** chỉ bao gồm `packages/*`, `backend` và `dashboard/web-ui` trong không gian làm việc
2. **Các ứng dụng mẫu là độc lập** - họ có `node_modules` của riêng mình để tránh xung đột phụ thuộc
3. **Ứng dụng mẫu** tham chiếu SDK bằng `"rejourney": "file:../../packages/react-native"`
4. **Cấu hình Metro** được định cấu hình để xem và giải quyết chính xác gói SDK

**Tại sao các ví dụ không có trong không gian làm việc:**
- Các ứng dụng mẫu sử dụng các phiên bản Expo/React Native khác nhau
- Ngăn chặn xung đột chống trùng lặp phụ thuộc npm
- Mỗi ví dụ có thể có cây phụ thuộc hoàn chỉnh của riêng nó

### Cấu hình Metro

Mỗi ứng dụng mẫu có `metro.config.js`:

1. **Đồng hồ** thư mục nguồn SDK (`packages/react-native`) để thay đổi
2. **giải quyết** gói `rejourney` vào đúng vị trí
3. **Khối** sao chép các gói `react-native` và `react` từ thư mục gốc của không gian làm việc

### Codegen (TurboModules)

Codegen của React Native tự động chạy khi xây dựng ứng dụng nếu:

1. SDK của `package.json` được xác định `codegenConfig` ✅
2. Tệp thông số kỹ thuật (`NativeRejourney.ts`) tuân theo quy ước đặt tên ✅
3. Ứng dụng bao gồm gói SDK ✅

Codegen chạy tự động trong thời gian:
- `npm run ios` (bản dựng iOS)
- `npm run android` (bản dựng Android)

## Cấu trúc dự án

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

## CI/CD & Triển khai

Rejourney sử dụng GitHub Actions để tự động hóa việc kiểm tra, xây dựng và triển khai trên toàn bộ monorepo.

Để biết thông tin chi tiết về bộ thử nghiệm, thử nghiệm tích hợp gốc và logic triển khai tự động của chúng tôi, vui lòng xem [CI/CD & Tài liệu thử nghiệm](/docs/architecture/ci-cd).

---

Khám phá [So sánh kiến ​​trúc](/docs/architecture/distributed-vs-single-node) để biết thông tin chi tiết về Đám mây (K8) so với Tự lưu trữ (Docker).

## Thực tiễn tốt nhất

1. **Luôn xây dựng SDK** trước khi thử nghiệm: `npm run build:sdk`
2. **Sử dụng giao thức tập tin** (`file:../../packages/react-native`) trong pack.json cho không gian làm việc npm
3. **Xóa bộ nhớ cache của Metro** khi gặp sự cố: `npm start -- --reset-cache`
4. **Xây dựng lại ứng dụng gốc** sau khi thay đổi mã gốc SDK
5. **Kiểm tra trên cả iOS và Android** trước khi cam kết
