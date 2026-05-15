# CI/CD & Kiểm tra tự động

Rejourney sử dụng GitHub Actions để đảm bảo chất lượng mã trên toàn bộ monorepo. Mỗi yêu cầu kéo và đẩy tới nhánh chính sẽ kích hoạt một loạt các thử nghiệm toàn diện.

## Bộ thử nghiệm

### 1. Kiểm tra API phụ trợ
Nằm trong thư mục `backend/`, các thử nghiệm này đảm bảo logic cốt lõi và tương tác cơ sở dữ liệu ổn định.
* **xơ vải**: Sử dụng ESLint để thực thi kiểu mã và phát hiện các lỗi phổ biến.
* **Kiểm tra đơn vị**: Được cung cấp bởi Vitest, kiểm tra logic dịch vụ, chức năng tiện ích và bộ điều khiển API.
* **Xác minh bản dựng**: Đảm bảo nguồn TypeScript biên dịch chính xác vào bản phân phối cuối cùng.

### 2. Các thử nghiệm React Native SDK
Nằm trong `packages/react-native/`, các thử nghiệm này rất quan trọng đối với độ ổn định trên nhiều nền tảng.
* **Kiểm tra TypeScript**: Xác thực các loại trên toàn bộ SDK, phát hiện các điểm không khớp có thể xảy ra với cầu nối.
* **xơ vải**: Thực thi chất lượng mã nhất quán.
* **Xác minh bản dựng**: Chạy tập lệnh chuẩn bị để đảm bảo gói có thể được đóng gói để phân phối.

### 3. Kiểm tra bảng điều khiển web
Nằm trong `dashboard/web-ui/`, tập trung vào giao diện người dùng và SSR.
* **Kiểm tra TypeScript**: Bao gồm việc tạo loại Bộ định tuyến React để đảm bảo an toàn cho tuyến đường.
* **Xây dựng SSR**: Xác minh rằng toàn bộ ứng dụng Bộ định tuyến Remix/React có thể được xây dựng để hiển thị phía máy chủ.

---

## Kiểm tra tích hợp gốc
Một trong những phần mạnh mẽ nhất của CI/CD của chúng tôi là xác thực SDK trên môi trường nền tảng thực.

### Tích hợp iOS (macos-mới nhất)
* **Cài đặt mới**: CI tạo dự án React Native hoàn toàn mới từ đầu.
* **Gói tiêm**: Nó đóng gói SDK cục bộ bằng cách sử dụng `npm pack` và cài đặt nó vào ứng dụng thử nghiệm.
* **Xác minh CocoaPods**: Chạy `pod install` để đảm bảo các phần phụ thuộc gốc và podspec được liên kết chính xác.
* **Xác minh bản dựng**: Thực thi `xcodebuild` để đảm bảo ứng dụng thử nghiệm biên dịch thành công với SDK được tích hợp.

### Tích hợp Android (phiên bản mới nhất của Ubuntu)
* **Cài đặt mới**: Tương tự như iOS, một dự án Android dựa trên React Native mới được khởi tạo.
* **Xác minh bản dựng**: Chạy `./gradlew assembleDebug` để đảm bảo không có xung đột hoặc lỗi biên dịch rõ ràng trong mã gốc Android.

---

## Logic triển khai và xuất bản

### Triển khai đám mây tự động (VPS)
Việc triển khai vào môi trường sản xuất của chúng tôi được kiểm soát bằng cách lập phiên bản.
* **Kiểm tra phiên bản**: Một công việc chuyên dụng so sánh phiên bản `package.json` gốc với cam kết trước đó.
* **Trình kích hoạt có điều kiện**: Việc triển khai chỉ tiếp tục nếu phiên bản đã được tăng lên.
* **Triển khai tự động**: Nếu được kích hoạt, nó sẽ áp dụng các tệp kê khai K8 mới nhất và thực hiện khởi động lại dần dần tất cả các quá trình triển khai (api, web và công nhân).

### Xuất bản SDK tự động (NPM)
Chúng tôi duy trì quy trình xuất bản liền mạch cho gói `rejourney`.
* **Đường dẫn nhạy cảm**: Chỉ kích hoạt khi các tệp bên trong `packages/react-native/` được sửa đổi.
* **Kiểm tra sổ đăng ký**: So sánh phiên bản gói cục bộ với phiên bản mới nhất trên sổ đăng ký NPM.
* **Tự động xuất bản**: Nếu phiên bản cục bộ cao hơn, nó sẽ tự động xuất bản phiên bản mới lên NPM sau khi vượt qua tất cả các thử nghiệm.
