<!-- AI_PROMPT_SECTION -->
**Sử dụng Cursor, Claude hoặc ChatGPT?** Sao chép lời nhắc tích hợp và dán vào trợ lý AI của bạn để tự động tạo mã thiết lập.

<!-- /AI_PROMPT_SECTION -->

## Cài đặt

Thêm gói Rejourney vào dự án của bạn bằng npm hoặc yarn.

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> Rejourney yêu cầu mã gốc và không tương thích với Expo Go. Sử dụng các bản dựng phát triển:
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## Thiết lập 3 dòng

Khởi tạo và khởi động Rejourney ở đầu ứng dụng của bạn (ví dụ: trong App.tsx hoặc index.js).

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

Không yêu cầu gói nhà cung cấp. Quá trình ghi bắt đầu ngay lập tức.

## Cài đặt ghi từ xa

Cài đặt dự án có thể kiểm soát các mặc định ghi React Native mà không cần gửi bản dựng ứng dụng mới. Các phiên bản SDK được hỗ trợ đọc cài đặt FPS ghi từ xa khi bắt đầu phiên; mặc định là 1 FPS và quản trị viên dự án có thể chọn 1, 2 hoặc 3 FPS. Nếu cấu hình từ xa không khả dụng, SDK sẽ quay trở lại hành vi chụp cục bộ/mặc định.

## Theo dõi màn hình

Rejourney tự động theo dõi các thay đổi trên màn hình để bạn có thể biết người dùng đang ở đâu trong ứng dụng của mình trong khi phát lại. Chọn thiết lập phù hợp với thư viện điều hướng của bạn:

### Expo Router (Tự động)

Nếu bạn sử dụng **Expo Router**, tính năng theo dõi màn hình sẽ hoạt động tốt. Không cần thêm mã.




> [!TIP]
> **Sử dụng tên màn hình tùy chỉnh?** Nếu bạn sử dụng Expo Router nhưng muốn cung cấp tên màn hình của riêng mình theo cách thủ công, hãy xem phần [Tên màn hình tùy chỉnh](#custom-screen-names) bên dưới.

---

### React Navigation

Nếu bạn sử dụng **React Navigation** (`@react-navigation/native`), hãy sử dụng móc `useNavigationTracking` trong thư mục gốc `NavigationContainer` của bạn:

```javascript
import { Rejourney } from '@rejourneyco/react-native';
import { NavigationContainer } from '@react-navigation/native';

function App() {
  const navigationTracking = Rejourney.useNavigationTracking();

  return (
    <NavigationContainer {...navigationTracking}>
      {/* Your screens */}
    </NavigationContainer>
  );
}
```

---

### Tên màn hình tùy chỉnh

Nếu bạn muốn chỉ định tên màn hình theo cách thủ công (ví dụ: để thống nhất về phân tích hoặc nếu bạn không sử dụng các thư viện ở trên), hãy sử dụng phương pháp `trackScreen`.

#### Đối với người dùng Expo Router:
Để sử dụng tên tùy chỉnh với Expo Router, trước tiên bạn phải tắt tính năng theo dõi tự động trong cấu hình của mình:

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### Cuộc gọi theo dõi thủ công:
Gọi `trackScreen` bất cứ khi nào xảy ra thay đổi màn hình:

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## Nhận dạng người dùng

Liên kết các phiên với ID người dùng nội bộ của bạn để lọc và tìm kiếm những người dùng cụ thể trong trang tổng quan.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Sự riêng tư:** Sử dụng ID nội bộ hoặc UUID. Nếu bạn phải sử dụng PII (email, điện thoại), hãy băm nó trước khi gửi.

## Sự kiện tùy chỉnh

Theo dõi các hành động có ý nghĩa của người dùng để hiểu các kiểu hành vi, sự cố gỡ lỗi và lọc các lần phát lại phiên trong trang tổng quan.

### Cách sử dụng cơ bản

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Simple event (name only)
Rejourney.logEvent('signup_completed');

// Event with properties
Rejourney.logEvent('button_clicked', { buttonName: 'signup' });
```

### API

```typescript
Rejourney.logEvent(name: string, properties?: Record<string, unknown>)
```

| Tham số | Loại | Bắt buộc | Mô tả |
|---|---|---|---|
| `name` | `string` | Có | Tên sự kiện - sử dụng `snake_case` để thống nhất |
| `properties` | `object` | Không | Cặp khóa-giá trị được đính kèm với lần xuất hiện sự kiện cụ thể này |

### Ví dụ

```javascript
// E-commerce
Rejourney.logEvent('purchase_completed', {
  plan: 'pro',
  amount: 29.99,
  currency: 'USD'
});

// Onboarding
Rejourney.logEvent('onboarding_step', {
  step: 3,
  stepName: 'profile_setup',
  skipped: false
});

// Feature usage
Rejourney.logEvent('feature_used', {
  feature: 'dark_mode',
  enabled: true
});

// Errors / edge cases
Rejourney.logEvent('payment_failed', {
  errorCode: 'card_declined',
  retryCount: 2
});
```

### Cách sự kiện xuất hiện trong Bảng điều khiển

Sự kiện tùy chỉnh được lưu trữ mỗi phiên và hiển thị ở hai nơi:

1. **Dòng thời gian phát lại phiên** — Các sự kiện xuất hiện dưới dạng điểm đánh dấu trên dòng thời gian phát lại để bạn có thể chuyển đến thời điểm chính xác mà một hành động đã xảy ra.
2. **Bộ lọc lưu trữ phiên** - Lọc danh sách phiên theo:
   - **Tên sự kiện** - Tìm tất cả các phiên có chứa một sự kiện cụ thể (ví dụ: `purchase_completed`)
   - **Thuộc tính sự kiện** - Thu hẹp hơn nữa theo khóa thuộc tính và/hoặc giá trị (ví dụ: `plan = pro`)
   - **Số sự kiện** - Tìm các phiên có số lượng sự kiện tùy chỉnh cụ thể (ví dụ: nhiều hơn 5 sự kiện)

### Thực tiễn tốt nhất




> [!TIP]
> - Sử dụng cách đặt tên nhất quán (`snake_case`, ví dụ: `button_clicked` chứ không phải `Button Clicked`)
> - Giữ các giá trị thuộc tính đơn giản (chuỗi, số, boolean) - tránh các đối tượng lồng nhau
> - Tập trung vào các hành động quan trọng để gỡ lỗi hoặc phân tích — đừng ghi lại mọi thứ
> - Các thuộc tính dành cho bối cảnh của mỗi sự kiện. Đối với các thuộc tính cấp phiên, thay vào đó hãy sử dụng **Siêu dữ liệu**

---

## Siêu dữ liệu

Đính kèm các cặp khóa-giá trị cấp phiên mô tả bối cảnh phiên hoặc người dùng. Không giống như sự kiện, siêu dữ liệu được đặt một lần cho mỗi khóa và áp dụng cho toàn bộ phiên.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Set a single property
Rejourney.setMetadata('plan', 'premium');

// Set multiple properties at once
Rejourney.setMetadata({
  role: 'admin',
  segment: 'enterprise',
  ab_variant: 'checkout_v2'
});
```

### Khi nào nên sử dụng siêu dữ liệu và sự kiện

| Trường hợp sử dụng | Sử dụng **Siêu dữ liệu** | Sử dụng **Sự kiện** |
|---|---|---|
| Gói đăng ký của người dùng |  `setMetadata('plan', 'pro')` | |
| Người dùng đã nhấp vào nút | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| Biến thể thử nghiệm A/B |  `setMetadata('ab_variant', 'v2')` | |
| Mua hàng hoàn tất | |  `logEvent('purchase', { amount: 29 })` |
| Vai trò của người dùng |  `setMetadata('role', 'admin')` | |
| Đã đạt đến bước giới thiệu | |  `logEvent('onboarding_step', { step: 3 })` |

**Quy tắc ngón tay cái:** Nếu nó mô tả *người dùng là ai* hoặc *họ đang ở trạng thái nào*, hãy sử dụng siêu dữ liệu. Nếu nó mô tả *điều gì đó đã xảy ra*, hãy sử dụng sự kiện.

## Kiểm soát quyền riêng tư

Theo mặc định, nội dung nhập văn bản và chế độ xem camera sẽ tự động bị ẩn. Quản trị viên dự án có thể thay đổi mức mặt nạ nhập văn bản mặc định trong Cài đặt dự án cho các phiên bản SDK được hỗ trợ; các phiên bản SDK cũ hơn bỏ qua cài đặt từ xa đó và giữ nguyên hành vi che giấu hiện có của chúng. Các trường bảo mật/mật khẩu, chế độ xem camera và mặt nạ rõ ràng vẫn được bảo vệ.

Để ẩn giao diện người dùng nhạy cảm bổ sung theo cách thủ công, hãy gói các thành phần trong thành phần `Mask`:

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

Nội dung bị che sẽ xuất hiện dưới dạng hình chữ nhật đặc trong các bản phát lại và không bao giờ được ghi lại ở nguồn.

### Sự đồng ý của người dùng & GDPR




> [!IMPORTANT]
> **Bạn là Người kiểm soát dữ liệu.** Rejourney đóng vai trò là Bên xử lý dữ liệu thay mặt bạn. Bạn có trách nhiệm đảm bảo người dùng cuối của mình được thông báo về việc ghi phiên và bạn có cơ sở pháp lý hợp lệ để xử lý dữ liệu của họ (ví dụ: sự đồng ý hoặc lợi ích hợp pháp).

#### Bạn phải làm gì

1. **Tiết lộ việc ghi phiên trong chính sách quyền riêng tư của ứng dụng của bạn.** Bao gồm ngôn ngữ như:

   > * "Chúng tôi sử dụng Rejourney để ghi lại các lần phát lại phiên ẩn danh VÀ không ẩn danh của hoạt động trong ứng dụng của bạn nhằm giúp chúng tôi cải tiến sản phẩm, theo dõi sự cố và sự cố, đồng thời giảm ma sát với sản phẩm. Dữ liệu phiên có thể bao gồm các tương tác trên màn hình, thông tin thiết bị và vị trí gần đúng. Dữ liệu nhập văn bản và các thành phần giao diện người dùng nhạy cảm sẽ tự động bị ẩn và không bao giờ được ghi lại."*

2. **Cổng ghi đằng sau sự đồng ý** (được khuyến nghị cho người dùng EEA):

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Tôn trọng sự lựa chọn không tham gia.** Nếu người dùng rút lại sự đồng ý, hãy dừng ghi và xóa dữ liệu của họ:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Ghi nhật ký bảng điều khiển

Tính năng ghi nhật ký bảng điều khiển được bật theo mặc định (`trackConsoleLogs: true`). Nhật ký bảng điều khiển có thể chứa PII tùy thuộc vào hoạt động ghi nhật ký của ứng dụng của bạn. Tắt nó nếu dữ liệu nhạy cảm có thể xuất hiện trong nhật ký:

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### Định vị địa lý

Vị trí địa lý có nguồn gốc từ IP (quốc gia, vùng, thành phố) được thu thập theo mặc định. Khi `collectGeoLocation` là `false`, SDK chuyển cờ đến lớp gốc ngăn chặn việc tra cứu vị trí địa lý IP ở phần phụ trợ — không có dữ liệu vị trí nào được lưu trữ cho phiên đó. Tắt nó nếu bạn không cần dữ liệu vị trí hoặc muốn giảm thiểu việc thu thập dữ liệu cho người dùng EEA:

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Trang tính gốc

Tính năng chụp trang tính gốc được bật theo mặc định (`captureNativeSheets: true`) cho các phiên bản SDK được hỗ trợ. Điều này cho phép các trang tính và hộp thoại gốc do ứng dụng sở hữu, chẳng hạn như các phương thức ủy quyền thanh toán, xuất hiện trong các bản phát lại gỡ lỗi khi hệ điều hành cho phép chụp. Trang tính hệ thống bàn phím/nhập văn bản bị loại trừ khi tính năng nhập văn bản bị che theo mặc định. Khi mặt nạ nhập văn bản chỉ được đặt thành các trường bảo mật, bàn phím chỉ cần nỗ lực tốt nhất và không thể ghi lại một cách đáng tin cậy, đặc biệt là khi HĐH hiển thị chúng dưới dạng bề mặt được bảo vệ hoặc từ xa. Bảng chia sẻ hệ điều hành cũng chỉ là nỗ lực tốt nhất và không thể được ghi lại một cách đáng tin cậy khi hệ thống hiển thị chúng dưới dạng các bề mặt được bảo vệ hoặc từ xa.

Tắt tính năng chụp trang tính gốc nếu bạn muốn tính năng phát lại trực quan luôn bị giới hạn trong cửa sổ ứng dụng chính:

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### Chế độ chỉ quan sát (Không ghi hình ảnh)

Để ghi lại lỗi, sự cố, ANRs và hoạt động mạng **không có** ghi lại các bản phát lại trực quan, hãy đặt `observeOnly: true`:

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Khi được bật, tất cả dữ liệu đo từ xa sẽ được thu thập nhưng không có ảnh chụp màn hình nào được chụp - các phiên SẼ KHÔNG xuất hiện trong Trang phát lại của bạn nhưng sẽ có đầy đủ dữ liệu phân tích/lỗi/mạng/sự cố. Không phát lại. Điều này hữu ích khi người dùng đã chọn không ghi màn hình nhưng bạn vẫn muốn hiển thị lỗi.

> **Ghi chú:** Điều này có thể được đặt có điều kiện cho mỗi người dùng, ví dụ: dựa trên tùy chọn được lưu trữ hoặc cờ đồng ý:
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```
