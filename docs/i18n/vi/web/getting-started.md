<!-- AI_PROMPT_SECTION -->
**Sử dụng Cursor, Claude hoặc ChatGPT?** Sao chép lời nhắc tích hợp và dán vào trợ lý AI của bạn để tự động tạo mã thiết lập.

<!-- /AI_PROMPT_SECTION -->

## Cài đặt

Thêm gói Rejourney vào dự án của bạn bằng npm hoặc yarn.

```bash
npm install @rejourneyco/browser
```

## Thiết lập cơ bản

Khởi tạo và khởi động Rejourney tại điểm vào ứng dụng của bạn.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init` tìm nạp cấu hình từ xa của dự án của bạn và chuẩn bị SDK. `start` bắt đầu phiên, đăng ký khách truy cập và (nếu bật tính năng phát lại) sẽ khởi động trình ghi rrweb. Cả hai đều không đồng bộ và an toàn để gọi mà không cần chờ đợi nếu bạn không cần chuyển bất kỳ thứ gì khi hoàn thành.




> [!NOTE]
> `autoStart` theo mặc định là `false`. Bạn phải gọi `start()` một cách rõ ràng, điều này cho phép bạn ghi lại cổng sau khi kiểm tra sự đồng ý. Để bắt đầu tự động sau `init`, hãy vượt qua `{ autoStart: true }`.

### Tích hợp khung

Gói này cung cấp các điểm vào dành riêng cho các khung phổ biến. Sử dụng cái phù hợp với ngăn xếp của bạn - hoặc sử dụng vanilla API ở trên từ bất kỳ khung nào.

---

#### Phản ứng

```javascript
import { RejourneyProvider, useRejourney } from '@rejourneyco/browser/react';

// Wrap your app root
function App() {
  return (
    <RejourneyProvider publicKey="pk_live_your_public_key" startOnMount>
      <YourApp />
    </RejourneyProvider>
  );
}

// Access the SDK anywhere inside the tree
function MyComponent() {
  const rejourney = useRejourney();

  function handlePurchase() {
    rejourney.logEvent('purchase_completed', { plan: 'pro' });
  }
}
```

`startOnMount` mặc định là `false` trên `RejourneyProvider`. Chuyển `startOnMount` (hoặc `startOnMount={true}`) để bắt đầu ghi ngay khi thành phần được gắn kết.

---

#### Next.js

```javascript
// app/layout.tsx (or pages/_app.tsx)
import { RejourneyNext } from '@rejourneyco/browser/next';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <RejourneyNext publicKey="pk_live_your_public_key" />
        {children}
      </body>
    </html>
  );
}
```

`RejourneyNext` là thành phần `'use client'` hiển thị `null`. `startOnMount` mặc định là `true`. Những thay đổi về tuyến đường được theo dõi tự động thông qua Lịch sử API.

---

#### Vue

```javascript
// main.ts
import { createApp } from 'vue';
import { createRejourney } from '@rejourneyco/browser/vue';
import App from './App.vue';
import router from './router';

const app = createApp(App);

app.use(createRejourney({
  publicKey: 'pk_live_your_public_key',
  router, // optional — enables per-route screen tracking via router.afterEach
}));

app.use(router).mount('#app');
```

Phiên bản Rejourney có sẵn qua `app.config.globalProperties.$rejourney` và qua `inject('rejourney')`. Thành phần kết hợp `useRejourney()` cũng được xuất để thuận tiện.

---

#### Nuxt

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

Hậu tố `.client.ts` đảm bảo plugin này chỉ chạy trong trình duyệt. Phiên bản Rejourney được đưa vào dưới dạng `$rejourney` và có sẵn thông qua `useNuxtApp().$rejourney`.

---

#### Mảnh dẻ / Mảnh dẻ

```javascript
// +layout.svelte
<script>
  import { onMount } from 'svelte';
  import { startRejourneyOnMount } from '@rejourneyco/browser/svelte';

  onMount(() => startRejourneyOnMount({ publicKey: 'pk_live_your_public_key' }));
</script>
```

`startRejourneyOnMount` trả về một hàm dọn dẹp gọi `Rejourney.stop()` — Giá trị trả về `onMount` của Svelte được sử dụng làm lệnh gọi lại hủy tự động.

---

#### Góc cạnh

```javascript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { createRejourneyAppInitializer } from '@rejourneyco/browser/angular';

export const appConfig: ApplicationConfig = {
  providers: [
    {
      provide: APP_INITIALIZER,
      useFactory: () => createRejourneyAppInitializer({ publicKey: 'pk_live_your_public_key' }),
      multi: true,
    },
  ],
};
```

`createRejourneyAppInitializer` trả về một nhà máy khởi tạo và khởi động Rejourney trong giai đoạn khởi động của Angular. Bạn cũng có thể đưa `RejourneyService` vào API dựa trên lớp.

---

#### phối lại

```javascript
// app/root.tsx
import { RejourneyRemix } from '@rejourneyco/browser/remix';

export default function App() {
  return (
    <html>
      <body>
        <RejourneyRemix publicKey="pk_live_your_public_key" />
        <Outlet />
      </body>
    </html>
  );
}
```

`startOnMount` mặc định là `true`. Thay đổi tuyến đường được theo dõi tự động.

---

#### Astro

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

`startRejourneyForAstro` không hoạt động trong môi trường SSR - nó kiểm tra `window` trước khi chạy.

---

## Cài đặt ghi từ xa

Cài đặt dự án có thể kiểm soát mặc định ghi web mà không cần triển khai mã. SDK đọc cấu hình từ xa trên mỗi cuộc gọi `start()`. Cấu hình từ xa có thể bật hoặc tắt hoàn toàn tính năng ghi, điều chỉnh danh sách miền được phép và đặt thời lượng phiên tối đa. Nếu cấu hình từ xa không khả dụng, `start()` sẽ không tiếp tục - điều này nhằm mục đích ngăn việc ghi ở trạng thái dự án không xác định.

## Theo dõi lộ trình

Rejourney tự động theo dõi các thay đổi của trang và tuyến đường để bạn có thể xem ngữ cảnh điều hướng trong các bản phát lại. Tính năng này được bật theo mặc định (`autoTrackRoutes: true`) và hoạt động bằng cách chặn các cuộc gọi History API (`pushState`, `replaceState`) và lắng nghe các sự kiện `popstate`.

### Tên tuyến đường tùy chỉnh

Theo mặc định, `window.location.pathname` hiện tại được sử dụng làm tên màn hình. Để cung cấp logic đặt tên của riêng bạn, hãy chuyển hàm `routeName`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### Theo dõi màn hình thủ công

Để theo dõi màn hình theo cách thủ công (ví dụ: thay đổi tab hoặc chuyển đổi chế độ xem trong trang), hãy gọi trực tiếp `trackScreen`:

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

Để tắt tính năng theo dõi tuyến đường tự động và chỉ dựa vào các lệnh gọi thủ công:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## Nhận dạng người dùng

Liên kết các phiên với ID người dùng nội bộ của bạn để lọc và tìm kiếm những người dùng cụ thể trong trang tổng quan.

```javascript
import { Rejourney } from '@rejourneyco/browser';

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
import { Rejourney } from '@rejourneyco/browser';

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
import { Rejourney } from '@rejourneyco/browser';

// Set a single property
Rejourney.setMetadata('plan', 'premium');

// Set multiple properties at once
Rejourney.setMetadata({
  role: 'admin',
  segment: 'enterprise',
  ab_variant: 'checkout_v2'
});
```

Giá trị siêu dữ liệu phải là `string`, `number` hoặc `boolean`. Các đối tượng và mảng không được chấp nhận.

### Khi nào nên sử dụng siêu dữ liệu và sự kiện

| Trường hợp sử dụng | Sử dụng **Siêu dữ liệu** | Sử dụng **Sự kiện** |
|---|---|---|
| Gói đăng ký của người dùng | `setMetadata('plan', 'pro')` | |
| Người dùng đã nhấp vào nút | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| Biến thể thử nghiệm A/B | `setMetadata('ab_variant', 'v2')` | |
| Mua hàng hoàn tất | | `logEvent('purchase', { amount: 29 })` |
| Vai trò của người dùng | `setMetadata('role', 'admin')` | |
| Đã đạt đến bước giới thiệu | | `logEvent('onboarding_step', { step: 3 })` |

**Quy tắc ngón tay cái:** Nếu nó mô tả *người dùng là ai* hoặc *họ đang ở trạng thái nào*, hãy sử dụng siêu dữ liệu. Nếu nó mô tả *điều gì đó đã xảy ra*, hãy sử dụng sự kiện.

## Kiểm soát quyền riêng tư

Tất cả các đầu vào văn bản đều bị che theo mặc định (`maskAllInputs: true`). Các trường bị che xuất hiện dưới dạng đầu vào trống trong các bản phát lại và các giá trị không bao giờ được ghi lại ở nguồn. Mật khẩu, email, điện thoại và các loại đầu vào nhạy cảm khác luôn bị ẩn bất kể cài đặt này.

### Phần tử chặn

Để loại trừ hoàn toàn phần tử DOM khỏi các bản phát lại (nó xuất hiện dưới dạng phần giữ chỗ cố định), hãy thêm một trong các phần sau:

- Lớp CSS: `rr-block`
- Thuộc tính dữ liệu: `data-rj-block` hoặc `data-rejourney-block`
- Bộ chọn CSS tùy chỉnh thông qua tùy chọn cấu hình `blockSelector`

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### Che văn bản

Để che nội dung văn bản của một phần tử (văn bản được thay thế nhưng hình dạng của phần tử vẫn hiển thị), hãy thêm một trong các mục sau:

- Lớp CSS: `rr-mask`
- Thuộc tính dữ liệu: `data-rj-mask`, `data-rejourney-mask`, `data-private` hoặc bất kỳ `data-testid` nào chứa `"password"`
- Bộ chọn CSS tùy chỉnh thông qua tùy chọn cấu hình `maskTextSelector`

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### Bỏ qua các yếu tố

Để nắm bắt hình dạng của một phần tử nhưng ngăn chặn tất cả các sự kiện tương tác (lần nhấp, đầu vào) trên phần tử đó, hãy thêm:

- Lớp CSS: `rr-ignore`
- Thuộc tính dữ liệu: `data-rj-ignore` hoặc `data-rejourney-ignore`

### Chức năng mặt nạ tùy chỉnh

Đối với logic mặt nạ có lập trình, hãy sử dụng `maskInputFn` hoặc `maskTextFn`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### Sự đồng ý của người dùng & GDPR




> [!IMPORTANT]
> **Bạn là Người kiểm soát dữ liệu.** Rejourney đóng vai trò là Bên xử lý dữ liệu thay mặt bạn. Bạn có trách nhiệm đảm bảo người dùng cuối của mình được thông báo về việc ghi phiên và bạn có cơ sở pháp lý hợp lệ để xử lý dữ liệu của họ (ví dụ: sự đồng ý hoặc lợi ích hợp pháp).

#### Bạn phải làm gì

1. **Tiết lộ ghi phiên trong chính sách bảo mật của bạn.** Bao gồm ngôn ngữ như:

   > * "Chúng tôi sử dụng Rejourney để ghi lại các lần phát lại phiên ẩn danh và không ẩn danh về hoạt động của bạn trên trang web của chúng tôi nhằm giúp chúng tôi cải tiến sản phẩm và giảm bớt rắc rối. Dữ liệu phiên có thể bao gồm các tương tác trang, thông tin trình duyệt và vị trí gần đúng. Dữ liệu nhập văn bản và các thành phần nhạy cảm sẽ tự động bị ẩn và không bao giờ được ghi lại."*

2. **Cổng ghi đằng sau sự đồng ý** (được khuyến nghị cho người dùng EEA):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Tôn trọng sự lựa chọn không tham gia.** Nếu người dùng rút lại sự đồng ý, hãy dừng ghi và xóa danh tính của họ:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Sự đồng ý chi tiết thông qua `setConsent`

Để kiểm soát tốt hơn, hãy sử dụng `setConsent` để chuyển đổi phân tích và phát lại một cách độc lập:

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

Việc đặt `analytics: false` và `replay: false` cùng nhau sẽ dừng phiên và xóa tất cả dữ liệu được xếp hàng đợi. Chỉ cài đặt `replay: false` sẽ dừng trình ghi rrweb nhưng vẫn tiếp tục theo dõi sự kiện.

#### Ghi nhật ký bảng điều khiển

Tính năng ghi nhật ký bảng điều khiển bị tắt theo mặc định (`trackConsoleLogs: false`). Chỉ kích hoạt nó nếu bạn cần, vì nhật ký bảng điều khiển có thể chứa PII tùy thuộc vào hoạt động ghi nhật ký của bạn:

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### Định vị địa lý

Vị trí địa lý có nguồn gốc từ IP (quốc gia, vùng, thành phố) được thu thập theo mặc định. Khi `collectGeoLocation` là `false`, SDK sẽ chuyển cờ ngăn chặn việc tra cứu vị trí địa lý IP ở phần phụ trợ — không có dữ liệu vị trí nào được lưu trữ cho phiên đó:

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Chế độ chỉ quan sát (Không ghi hình ảnh)

Để ghi lại lỗi, tác vụ dài, hoạt động mạng và phân tích **không có** ghi lại các bản phát lại trực quan, hãy đặt `observeOnly: true`:

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Khi được bật, tất cả dữ liệu đo từ xa sẽ được thu thập nhưng không có bản ghi rrweb nào chạy — các phiên sẽ không xuất hiện trong trang Phát lại của bạn nhưng toàn bộ phân tích, lỗi và dữ liệu mạng vẫn được ghi lại. Hữu ích khi người dùng đã chọn không tham gia ghi hình ảnh nhưng bạn vẫn muốn có khả năng quan sát được.

> **Ghi chú:** Bạn có thể đặt điều này theo điều kiện cho mỗi người dùng, chẳng hạn như dựa trên tùy chọn đồng ý được lưu trữ:
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### Phát hiện bot

Bot và trình duyệt tự động bị bỏ qua theo mặc định (`ignoreBots: true`). Nhà viết kịch, Puppeteer, Selenium và các ứng dụng khách dựa trên trình quản trị web khác bị chặn. Để ghi lại các phiên tự động hóa (ví dụ: đối với công cụ nội bộ):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

Để cung cấp mẫu phát hiện bot tùy chỉnh:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### Chụp yêu cầu mạng

Các yêu cầu mạng (tìm nạp và XHR) bị chặn và ghi lại theo mặc định (`autoTrackNetwork: true`). Kích thước nội dung yêu cầu và phản hồi là **không** được ghi lại theo mặc định (`networkCaptureSizes: false`). URL, phương thức, mã trạng thái và thời lượng luôn được ghi lại.

Để loại trừ các URL cụ thể:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

Để lọc hoặc sắp xếp lại các yêu cầu trước khi chúng được gửi:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## Tham khảo cấu hình

| Tùy chọn | Loại | Mặc định | Mô tả |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | Tự động gọi `start()` sau khi `init()` hoàn thành |
| `disableInDev` | `boolean` | `false` | Ngăn chặn ghi âm trên `localhost` và `127.0.0.1` |
| `debug` | `boolean` | `false` | Cho phép ghi nhật ký SDK dài dòng vào bảng điều khiển trình duyệt |
| `enabled` | `boolean` | `true` | Công tắc tắt chính — được đặt thành `false` để ngăn mọi hoạt động ghi |
| `observeOnly` | `boolean` | `false` | Ghi lại số liệu phân tích/lỗi/mạng mà không cần phát lại bằng hình ảnh |
| `captureReplay` | `boolean` | `true` | Bật tính năng chụp lại hình ảnh rrweb |
| `allowedDomains` | `string[]` | `[]` | Hạn chế ghi vào các miền cụ thể. Trống có nghĩa là tất cả các tên miền được phép. Hỗ trợ ký tự đại diện `*.example.com` |
| `maxSessionDuration` | `number` | `1800000` | Thời lượng phiên tối đa tính bằng mili giây (mặc định: 30 phút) |
| `collectGeoLocation` | `boolean` | `true` | Thu thập quốc gia/vùng/thành phố có nguồn gốc từ IP |
| `captureAttribution` | `boolean` | `true` | Nắm bắt các thông số UTM, liên kết giới thiệu và URL mục nhập khi bắt đầu phiên |
| `ignoreBots` | `boolean` | `true` | Ngăn chặn việc ghi lại các bot và trình điều khiển web được phát hiện |
| `recordAutomation` | `boolean` | `false` | Cho phép ghi lại các buổi của Nhà viết kịch/Người múa rối/Selenium |
| `autoTrackRoutes` | `boolean` | `true` | Tự động theo dõi thay đổi lộ trình qua History API |
| `routeName` | `(location: Location) => string` | — | Chức năng tùy chỉnh để lấy tên màn hình từ `window.location` |
| `autoTrackNetwork` | `boolean` | `true` | Chặn và ghi lại các yêu cầu tìm nạp/XHR |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | URL cần loại trừ khỏi theo dõi mạng |
| `networkCaptureSizes` | `boolean` | `false` | Bao gồm kích thước nội dung yêu cầu/phản hồi trong nhật ký mạng |
| `trackConsoleLogs` | `boolean` | `false` | Chụp đầu ra `console.log/warn/error` |
| `trackLongTasks` | `boolean` | `true` | Phát hiện và ghi nhật ký các tác vụ dài (khối luồng JS > 50ms) |
| `trackResourceErrors` | `boolean` | `true` | Ghi lại các lần tải tài nguyên không thành công (hình ảnh, tập lệnh, biểu định kiểu) |
| `maskAllInputs` | `boolean` | `true` | Che giấu tất cả các giá trị nhập văn bản trong các bản phát lại |
| `blockClass` | `string \| RegExp` | `'rr-block'` | Lớp CSS để chặn hoàn toàn một phần tử phát lại |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | Bộ chọn CSS để chặn hoàn toàn các phần tử phát lại |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | Lớp CSS để bỏ qua các sự kiện tương tác trên một phần tử |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | Bộ chọn CSS để bỏ qua các sự kiện tương tác |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | Lớp CSS để che nội dung văn bản khi phát lại |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | Bộ chọn CSS để che nội dung văn bản |
| `maskInputFn` | `(value, element) => string` | — | Chức năng tùy chỉnh để chuyển đổi giá trị đầu vào trước khi chụp |
| `maskTextFn` | `(text, element) => string` | — | Chức năng tùy chỉnh để chuyển đổi nội dung văn bản trước khi chụp |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | Chức năng tùy chỉnh để quyết định mỗi lần tải trang có ghi hay không |
| `beforeSendEvent` | `(event) => event \| null` | — | Lọc hoặc sửa đổi các sự kiện trước khi chúng được xếp hàng đợi. Trả về `null` để thả |
| `beforeSendNetwork` | `(request) => request \| null` | — | Lọc hoặc sửa đổi các mục mạng trước khi chúng được xếp hàng đợi. Trả về `null` để thả |
| `onAuthError` | `(error) => void` | — | Được gọi khi SDK không xác thực được bằng phần phụ trợ |

## Dừng ghi

Gọi `stop()` để kết thúc phiên, xóa mọi sự kiện đang chờ xử lý và dọn sạch tất cả trình nghe SDK:

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()` an toàn khi gọi nhiều lần. Sau khi dừng, hãy gọi lại `start()` để bắt đầu phiên mới.

## ID phiên

Truy cập ID phiên hiện tại để tương quan các phiên Rejourney với nhật ký hoặc công cụ hỗ trợ của riêng bạn:

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

Trả về `null` nếu không có phiên nào hoạt động.

## Người trợ giúp trạng thái

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```
