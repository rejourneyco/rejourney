<!-- AI_PROMPT_SECTION -->
**Sử dụng Cursor, Claude hoặc ChatGPT?** Sao chép lời nhắc tích hợp và dán vào trợ lý AI của bạn để tự động tạo mã thiết lập.

<!-- /AI_PROMPT_SECTION -->

## Cài đặt

### Swift Package Manager

Thêm gói Rejourney trong Xcode qua **Tệp → Thêm phụ thuộc gói** và nhập:

```
https://github.com/rejourneyco/rejourney
```

Hoặc thêm trực tiếp vào `Package.swift` của bạn:

```swift
dependencies: [
    .package(url: "https://github.com/rejourneyco/rejourney", from: "0.3.0")
],
targets: [
    .target(
        name: "YourApp",
        dependencies: [
            .product(name: "Rejourney", package: "rejourney")
        ]
    )
]
```

> [!NOTE]
> Rejourney yêu cầu iOS 15.1 trở lên.

## Cài đặt Swift

Khởi tạo và khởi động Rejourney trong cấu trúc Ứng dụng `@main` của bạn.

```swift
import SwiftUI
import Rejourney

@main
struct MyApp: App {

    @MainActor
    init() {
        Rejourney.configure(publicKey: "rj_your_public_key")
        Task { await Rejourney.start() }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

Nếu bạn sử dụng `UIApplicationDelegate`, hãy gọi `configure` trong `application(_:didFinishLaunchingWithOptions:)`:

```swift
import UIKit
import Rejourney

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    @MainActor
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        Rejourney.configure(publicKey: "rj_your_public_key")
        Task { await Rejourney.start() }
        return true
    }
}
```

Quá trình ghi bắt đầu ngay khi `start()` được xử lý. Bạn có thể kiểm tra kết quả nếu cần:

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## Cài đặt ghi từ xa

Cài đặt dự án có thể kiểm soát các mặc định ghi Swift mà không cần gửi bản dựng ứng dụng mới. Các phiên bản SDK được hỗ trợ đọc các cài đặt này khi `start()` được gọi:

| Cài đặt | Hành vi |
|---|---|
| Tỷ lệ mẫu | Mặc định là `100%`. Các phiên lấy mẫu được chụp bình thường. Các phiên lấy mẫu sẽ quay trở lại trước khi bắt đầu chụp lại, chặn mạng, tải lên hoặc bắt đầu công việc gói khác. |
| Thời lượng quan sát tối đa | Giới hạn độ dài tối đa của mỗi phiên quan sát. |
| Ghi FPS | Mặc định là `1 FPS`. Quản trị viên dự án có thể chọn `1`, `2` hoặc `3 FPS`. Nếu cấu hình từ xa không khả dụng, SDK sẽ quay trở lại hành vi chụp cục bộ/mặc định. |
| Quyền riêng tư khi nhập văn bản | Mặc định là che giấu tất cả các kiểu nhập văn bản. Chế độ chỉ bảo mật giúp ẩn mật khẩu/các trường bảo mật và cho phép các nội dung nhập văn bản khác xuất hiện trong bản phát lại gỡ lỗi. |

## Theo dõi màn hình

Rejourney không tự động kết nối với điều hướng SwiftUI, vì vậy hãy gọi `trackScreen` bất cứ khi nào người dùng điều hướng đến một màn hình mới.

### SwiftUI

Sử dụng `.onAppear` hoặc công cụ sửa đổi nhận biết điều hướng:

```swift
struct CountriesListView: View {
    var body: some View {
        List { /* ... */ }
            .onAppear {
                Rejourney.trackScreen("Countries List")
            }
    }
}
```

### UIKit

Gọi `trackScreen` bên trong `viewDidAppear`:

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### Đường dẫn điều hướng / NavigationStack

Quan sát đường dẫn điều hướng và theo dõi sự thay đổi:

```swift
@State private var path = NavigationPath()

NavigationStack(path: $path) {
    ContentView()
}
.onChange(of: path) { _ in
    // derive screen name from path and call trackScreen
    Rejourney.trackScreen(currentScreenName(from: path))
}
```

## Nhận dạng người dùng

Liên kết các phiên với ID người dùng của riêng bạn để bạn có thể tìm thấy những người dùng cụ thể trong trang tổng quan.

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **Sự riêng tư:** Sử dụng ID nội bộ hoặc UUID. Nếu bạn phải sử dụng PII (email, điện thoại), hãy băm nó trước khi chuyển vào.

Danh tính được duy trì trong suốt quá trình khởi chạy ứng dụng thông qua `UserDefaults` — bạn chỉ cần gọi `identify` một lần cho mỗi lần đăng nhập chứ không phải trên mọi ứng dụng đang mở.

## Sự kiện tùy chỉnh

Theo dõi các hành động có ý nghĩa của người dùng để hiểu hành vi, sự cố gỡ lỗi và lọc các lần phát lại phiên trong trang tổng quan.

### Cách sử dụng cơ bản

```swift
import Rejourney

// Simple event (name only)
Rejourney.logEvent("signup_completed")

// Event with properties
Rejourney.logEvent("button_tapped", properties: ["buttonName": "get_started"])
```

### API

```swift
Rejourney.logEvent(_ name: String, properties: [String: RejourneyMetadataValue] = [:])
```

| Tham số | Loại | Bắt buộc | Mô tả |
|---|---|---|---|
| `name` | `String` | Có | Tên sự kiện - sử dụng `snake_case` để thống nhất |
| `properties` | `[String: RejourneyMetadataValue]` | Không | Cặp khóa-giá trị được đính kèm với sự kiện này |

`RejourneyMetadataValue` chấp nhận trực tiếp các chữ Swift - không cần gói:

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### Ví dụ

```swift
// E-commerce
Rejourney.logEvent("purchase_completed", properties: [
    "plan": "pro",
    "amount": 29.99,
    "currency": "USD"
])

// Onboarding
Rejourney.logEvent("onboarding_step", properties: [
    "step": 3,
    "stepName": "profile_setup",
    "skipped": false
])

// Feature usage
Rejourney.logEvent("feature_used", properties: [
    "feature": "dark_mode",
    "enabled": true
])

// Errors / edge cases
Rejourney.logEvent("payment_failed", properties: [
    "errorCode": "card_declined",
    "retryCount": 2
])
```

### Cách sự kiện xuất hiện trong Bảng điều khiển

Sự kiện tùy chỉnh được lưu trữ mỗi phiên và hiển thị ở hai nơi:

1. **Dòng thời gian phát lại phiên** — Các sự kiện xuất hiện dưới dạng điểm đánh dấu trên dòng thời gian phát lại để bạn có thể chuyển đến thời điểm chính xác mà một hành động đã xảy ra.
2. **Bộ lọc lưu trữ phiên** - Lọc danh sách phiên theo:
   - **Tên sự kiện** - Tìm tất cả các phiên có chứa một sự kiện cụ thể (ví dụ: `purchase_completed`)
   - **Số sự kiện** - Tìm các phiên có số lượng sự kiện tùy chỉnh cụ thể

### Thực tiễn tốt nhất




> [!TIP]
> - Sử dụng cách đặt tên nhất quán (`snake_case`, ví dụ: `button_tapped` chứ không phải `Button Tapped`)
> - Giữ các giá trị thuộc tính đơn giản (chuỗi, số, boolean) - tránh các đối tượng lồng nhau sâu
> - Tập trung vào các hành động quan trọng để gỡ lỗi hoặc phân tích — đừng ghi lại mọi thứ

## Kiểm soát quyền riêng tư

Theo mặc định, nội dung nhập văn bản và chế độ xem camera sẽ tự động bị ẩn. Quản trị viên dự án có thể thay đổi mức mặt nạ nhập văn bản mặc định trong Cài đặt dự án cho các phiên bản SDK được hỗ trợ. Các trường bảo mật/mật khẩu, chế độ xem camera và mặt nạ rõ ràng vẫn được bảo vệ.

Để ẩn các chế độ xem nhạy cảm bổ sung, hãy sử dụng API `mask` và `unmask`:

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

Đối với SwiftUI, hãy lấy `UIView` cơ bản thông qua trình bao bọc `UIViewRepresentable` hoặc `introspect`.

#### Trang tính gốc

Tính năng chụp trang tính gốc được bật theo mặc định (`captureNativeSheets: true`). Điều này cho phép các trang tính và hộp thoại gốc do ứng dụng sở hữu, chẳng hạn như các phương thức ủy quyền thanh toán, xuất hiện trong các bản phát lại gỡ lỗi khi hệ điều hành cho phép chụp. Trang tính hệ thống bàn phím/nhập văn bản bị loại trừ khi tính năng nhập văn bản bị che theo mặc định. Khi mặt nạ nhập văn bản chỉ được đặt thành các trường bảo mật, bàn phím chỉ cần nỗ lực tốt nhất và không thể ghi lại một cách đáng tin cậy vì iOS có thể hiển thị chúng dưới dạng bề mặt hệ thống được bảo vệ hoặc từ xa. Bảng chia sẻ hệ điều hành cũng chỉ là nỗ lực tốt nhất và không thể được ghi lại một cách đáng tin cậy khi hệ thống hiển thị chúng dưới dạng các bề mặt được bảo vệ hoặc từ xa.

Tắt tính năng chụp trang tính gốc nếu bạn muốn tính năng phát lại trực quan luôn bị giới hạn trong cửa sổ ứng dụng chính:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### Sự đồng ý của người dùng & GDPR




> [!IMPORTANT]
> **Bạn là Người kiểm soát dữ liệu.** Rejourney đóng vai trò là Bên xử lý dữ liệu thay mặt bạn. Bạn có trách nhiệm đảm bảo người dùng cuối của mình được thông báo về việc ghi phiên và bạn có cơ sở pháp lý hợp lệ để xử lý dữ liệu của họ (ví dụ: sự đồng ý hoặc lợi ích hợp pháp).

#### Bạn phải làm gì

1. **Tiết lộ việc ghi phiên trong chính sách quyền riêng tư của ứng dụng của bạn.** Bao gồm ngôn ngữ như:

   > * "Chúng tôi sử dụng Rejourney để ghi lại các lần phát lại phiên ẩn danh VÀ không ẩn danh của hoạt động trong ứng dụng của bạn nhằm giúp chúng tôi cải tiến sản phẩm, theo dõi sự cố và sự cố, đồng thời giảm ma sát với sản phẩm. Dữ liệu phiên có thể bao gồm các tương tác trên màn hình, thông tin thiết bị và vị trí gần đúng. Dữ liệu nhập văn bản và các thành phần giao diện người dùng nhạy cảm sẽ tự động bị ẩn và không bao giờ được ghi lại."*

2. **Cổng ghi đằng sau sự đồng ý** (được khuyến nghị cho người dùng EEA):

   ```swift
   // Configure early — before consent is known
   Rejourney.configure(publicKey: "rj_your_public_key")

   // Call start() only after the user accepts your privacy policy
   func onUserConsented() {
       Task { @MainActor in
           await Rejourney.start()
       }
   }
   ```

3. **Tôn trọng sự lựa chọn không tham gia.** Nếu người dùng rút lại sự đồng ý, hãy dừng ghi và xóa danh tính của họ:

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### Chế độ chỉ quan sát (Không ghi hình ảnh)

Để ghi lại lỗi, sự cố, ANRs và hoạt động mạng **không có** ghi lại các bản phát lại trực quan, hãy đặt `observeOnly: true`:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

Khi được bật, tất cả dữ liệu đo từ xa sẽ được thu thập nhưng không có ảnh chụp màn hình nào được chụp - các phiên sẽ KHÔNG xuất hiện trên trang Phát lại của bạn nhưng dữ liệu phân tích, lỗi, mạng và sự cố đầy đủ vẫn được ghi lại. Hữu ích khi người dùng đã chọn không ghi màn hình nhưng bạn vẫn muốn hiển thị lỗi.

> **Ghi chú:** Điều này có thể được đặt có điều kiện cho mỗi người dùng dựa trên tùy chọn được lưu trữ hoặc cờ đồng ý:
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### Chụp mạng

Chụp yêu cầu mạng (`autoTrackNetwork: true` theo mặc định) chặn lưu lượng truy cập `URLSession` thông qua `URLProtocol` tùy chỉnh. Tắt nó nếu bạn không muốn thu thập dữ liệu mạng:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### Định vị địa lý

Vị trí địa lý có nguồn gốc từ IP (quốc gia, vùng, thành phố) được thu thập theo mặc định. Vô hiệu hóa nó để ngăn chặn hoàn toàn việc tra cứu:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## Tham khảo cấu hình

Tất cả các tùy chọn được đặt một lần trong `configure` và không thể thay đổi sau khi `start` được gọi.

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(
        apiURL:             URL(string: "https://api.rejourney.co")!,
        userId:             nil,
        enabled:            true,
        observeOnly:        false,
        captureFPS:         nil,
        captureQuality:     .medium,
        wifiOnly:           false,
        captureScreen:      true,
        captureAnalytics:   true,
        captureCrashes:     true,
        captureANR:         true,
        trackConsoleLogs:   true,
        collectGeoLocation: true,
        autoTrackNetwork:   true,
        captureNativeSheets: true,
        debug:              false
    )
)
```

| Tùy chọn | Loại | Mặc định | Mô tả |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | Ghi đè cho việc triển khai tự lưu trữ |
| `userId` | `String?` | `nil` | ID người dùng nội bộ ban đầu tùy chọn |
| `enabled` | `Bool` | `true` | Master kill switch — được đặt thành `false` để tắt hoàn toàn SDK |
| `observeOnly` | `Bool` | `false` | Chỉ thu thập dữ liệu từ xa, không ghi hình ảnh |
| `captureFPS` | `Int?` | `nil` | Tùy chọn dự phòng FPS chụp cục bộ. Ghi FPS cài đặt dự án từ xa được ưu tiên khi có sẵn |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | Chất lượng chụp ảnh JPEG (`.low`, `.medium`, `.high`) |
| `wifiOnly` | `Bool` | `false` | Chỉ tải lên dữ liệu phiên trên Wi-Fi |
| `captureScreen` | `Bool` | `true` | Bật/tắt tính năng chụp ảnh màn hình trực quan |
| `captureAnalytics` | `Bool` | `true` | Bật/tắt bộ sưu tập sự kiện phân tích |
| `captureCrashes` | `Bool` | `true` | Bật/tắt báo cáo sự cố |
| `captureANR` | `Bool` | `true` | Bật/tắt tính năng phát hiện ANR (Ứng dụng không phản hồi) |
| `trackConsoleLogs` | `Bool` | `true` | Ghi lại nhật ký bảng điều khiển cho phiên |
| `collectGeoLocation` | `Bool` | `true` | Thu thập vị trí địa lý có nguồn gốc từ IP |
| `autoTrackNetwork` | `Bool` | `true` | Chặn các yêu cầu `URLSession` để chụp mạng |
| `captureNativeSheets` | `Bool` | `true` | Bao gồm các cửa sổ hộp thoại/trang tính gốc do ứng dụng sở hữu trong tính năng phát lại trực quan khi iOS cho phép chụp. Bảng chia sẻ hệ điều hành và bàn phím có thể được bảo vệ hoặc các bề mặt ở xa và không thể ghi lại một cách đáng tin cậy |
| `debug` | `Bool` | `false` | In nhật ký SDK dài dòng vào bảng điều khiển |

## Dừng ghi

Dừng phiên hiện tại và xóa dữ liệu đang chờ xử lý:

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

Biến thể gọi lại có sẵn cho các ngữ cảnh không đồng bộ:

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## ID phiên

Truy cập ID phiên hiện tại bất kỳ lúc nào để tương quan với nhật ký hoặc công cụ hỗ trợ của riêng bạn:

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
