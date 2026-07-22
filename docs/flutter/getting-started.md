<!-- AI_PROMPT_SECTION -->
**Using an AI coding assistant?** Give it this page and ask it to add the SDK only after your app's consent decision, wire the navigator observer, and mask every field containing credentials, payment data, health data, or other sensitive content.
<!-- /AI_PROMPT_SECTION -->

# Flutter SDK

The Rejourney Flutter package provides privacy-first session replay, native crash and ANR reporting, product events, network timing, and SDK health metrics for iOS and Android. Capture runs in native code while the public API, navigation integration, privacy masks, error hooks, and HTTP client are idiomatic Dart and Flutter.

## Requirements

| Platform | Minimum |
|---|---|
| Flutter | 3.22 |
| Dart | 3.3 |
| iOS | 15.1 |
| Android | API 24 |

## Installation

Add the package:

```bash
flutter pub add rejourney
```

For a local checkout of this repository, use a path dependency instead:

```yaml
dependencies:
  rejourney:
    path: ../../packages/flutter
```

Run CocoaPods after adding the plugin to an existing iOS application if your normal Flutter build does not do so automatically:

```bash
cd ios && pod install && cd ..
```

## 3 Line Setup

Configure once during startup and begin recording only after any consent your product requires:

```dart
import 'package:rejourney/rejourney.dart';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`Rejourney.init` never starts capture. This separation lets the application wait for an explicit consent result. Call `Rejourney.stop()` if consent is revoked.

```dart
if (await consentStore.canRecord()) {
  final result = await Rejourney.start();
  debugPrint('session=${result.sessionId} replay=${!result.telemetryOnly}');
}
```

## Remote Recording Settings

Each `start` reads the project's current recording configuration. When the service is temporarily unavailable, the native SDK uses its cached configuration when possible and otherwise falls back to the local safe defaults.

| Setting | Behavior |
|---|---|
| Rejourney enabled | Remote kill switch for all session collection. |
| Recording enabled | Enables visual replay. Telemetry-only sessions may continue when replay is off. |
| Sample rate | Sampled-out sessions do not start native capture or upload work. |
| Maximum duration | Rolls over or ends sessions that reach the configured limit. |
| Recording FPS | Controls permitted replay capture frequency. |
| Text input privacy | Masks all text fields or secure fields only, based on project policy. |
| Image/video privacy | Masks image and video regions in native capture. |

Remote policy can make capture more restrictive than application configuration; it does not grant consent on the application's behalf.

## Screen Tracking

Create one observer and add it to the root application navigator:

```dart
final rejourneyObserver = RejourneyNavigatorObserver();

MaterialApp(
  navigatorObservers: <NavigatorObserver>[rejourneyObserver],
  routes: <String, WidgetBuilder>{
    '/': (_) => const HomeScreen(),
    '/checkout': (_) => const CheckoutScreen(),
  },
);
```

The observer handles push, pop, replace, and remove operations and suppresses duplicate screen names. You can customize names:

```dart
final observer = RejourneyNavigatorObserver(
  routeNameResolver: (route) => route.settings.name?.replaceFirst('/', ''),
);
```

With a declarative Router package, call `Rejourney.trackScreen('checkout')` from its route-change callback or attach the observer through that package's navigator integration.

## User Identification

Associate an internal identifier with the current and future session:

```dart
await Rejourney.setUserIdentity('user_abc123');

// Clear it during logout.
await Rejourney.clearUserIdentity();
```

Use an internal ID or UUID. Hash email addresses or phone numbers before sending them if your product must use those values.

## Custom Events

Track meaningful user actions to understand behavior patterns, debug issues, and filter session replays in the dashboard.

### Basic Usage

```dart
// Simple event (name only)
await Rejourney.logEvent('checkout_started');

// Event with properties
await Rejourney.logEvent('purchase_completed', <String, Object?>{
  'transactionId': order.id,
  'amount': order.total,
  'currency': 'USD',
  'paymentProvider': 'stripe',
});
```

### API

```dart
Future<void> Rejourney.logEvent(
  String name, [
  Map<String, Object?> properties = const <String, Object?>{},
])
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | `String` | Yes | Event name — use `snake_case` for consistency |
| `properties` | `Map<String, Object?>` | No | Key-value pairs attached to this specific event occurrence |

### Naming Conventions

Use stable, lowercase `snake_case` names. The preferred names below give Rejourney the cleanest signal for revenue, lifecycle, and future analysis features. The aliases are accepted for compatibility, but new instrumentation should use the preferred name.

| User action | Preferred event name | Compatible aliases |
|---|---|---|
| Purchase completed | `purchase_completed` | `purchase_complete`, `purchase_success`, `purchase`, `order_completed`, `complete_purchase`, `conversion` |
| Checkout started | `checkout_started` | `checkout_start`, `begin_checkout` |
| Product added to cart | `add_to_cart` | `cart_add`, `addtocart`, `added_to_cart`, `product_added_to_cart` |
| Product viewed | `product_view` | `view_item`, `viewproduct` |
| Signup completed | `signup_completed` | `signup`, `sign_up`, `register`, `account_created` |
| Login | `login` | `sign_in` |
| Paywall viewed | `paywall_view` | `paywall_exposure`, `view_paywall` |
| Plan selected | `plan_selected` | `pricing_plan_selected`, `select_plan`, `pricing_viewed` |
| Coupon used | `coupon_use` | `coupon_used`, `apply_coupon` |
| Trial started | `trial_started` | `trial_start`, `begin_trial` |
| Subscription started | `subscription_started` | `subscription_start` |
| Refund processed | `refund_processed` | `refund`, `refund_completed`, `refunded` |
| Subscription cancelled | `subscription_cancelled` | `cancel`, `cancel_subscription`, `cancellation` |
| Payment failed | `payment_failed` | `payment_failure`, `charge_failed` |
| Onboarding completed | `onboarding_completed` | `onboarding_milestone`, `complete_onboarding` |
| Feature used | `feature_used` | `key_feature_used`, `use_feature` |
| Ad viewed | `ad_viewed` | `ad_impression`, `ad_seen`, `ad_shown`, `ad_displayed` |
| Ad clicked | `ad_clicked` | `ad_click`, `ad_tapped`, `ad_cta_clicked` |
| Native ad viewed | `native_ad_viewed` | `native_ad_impression`, `native_ad_shown` |
| Native ad clicked | `native_ad_clicked` | `native_ad_click`, `native_ad_tapped` |
| Banner ad viewed | `banner_ad_viewed` | `banner_ad_impression`, `banner_ad_shown` |
| Banner ad clicked | `banner_ad_clicked` | `banner_ad_click`, `banner_ad_tapped` |
| Interstitial ad viewed | `interstitial_ad_viewed` | `interstitial_ad_impression`, `interstitial_ad_shown` |
| Interstitial ad clicked | `interstitial_ad_clicked` | `interstitial_ad_click`, `interstitial_ad_tapped` |
| Rewarded ad viewed | `rewarded_ad_viewed` | `rewarded_ad_impression`, `rewarded_video_ad_viewed` |
| Rewarded ad clicked | `rewarded_ad_clicked` | `rewarded_ad_click`, `rewarded_video_ad_clicked` |
| Video ad viewed | `video_ad_viewed` | `video_ad_impression`, `video_ad_started` |
| Video ad clicked | `video_ad_clicked` | `video_ad_click`, `video_ad_tapped` |
| Sponsored ad viewed | `sponsored_ad_viewed` | `sponsored_ad_impression`, `sponsored_content_viewed` |
| Sponsored ad clicked | `sponsored_ad_clicked` | `sponsored_ad_click`, `sponsored_content_clicked` |
| Variant selected | `variant_selected` | `product_variant_selected`, `select_variant` |
| Size selected | `size_selected` | `product_size_selected`, `select_size` |
| Color selected | `color_selected` | `product_color_selected`, `select_color` |
| Quantity changed | `quantity_changed` | `quantity_updated`, `cart_quantity_changed` |
| Reviews viewed | `reviews_viewed` | `product_reviews_viewed`, `ratings_viewed` |
| Shipping info viewed | `shipping_info_viewed` | `shipping_details_viewed`, `delivery_info_viewed` |
| Return policy viewed | `return_policy_viewed` | `returns_viewed`, `refund_policy_viewed` |
| Wishlist add | `wishlist_add` | `add_to_wishlist`, `added_to_wishlist` |
| Share clicked | `share_clicked` | `share_tapped`, `product_shared` |
| Upgrade clicked | `upgrade_clicked` | `upgrade_cta_clicked`, `click_upgrade` |
| Upgrade completed | `upgrade_completed` | `upgraded`, `plan_upgraded` |
| Discount offer viewed | `discount_offer_viewed` | `discount_viewed`, `promo_offer_viewed` |
| Discount offer accepted | `discount_offer_accepted` | `discount_accepted`, `offer_accepted` |
| Cancel flow started | `cancel_flow_started` | `cancellation_started`, `subscription_cancel_flow_started` |
| Cancel confirmed | `cancel_confirmed` | `cancellation_confirmed`, `subscription_cancel_confirmed` |

Use these property names when they apply:

| Meaning | Preferred property | Compatible aliases |
|---|---|---|
| Transaction id | `transactionId` | `transaction_id` |
| Order id | `orderId` | |
| Money amount | `amount` | `value`, `price`, `cartValue`, `cart_value` |
| Currency | `currency` | |
| Quantity | `quantity` | `qty` |
| Product id | `productId` | `product_id`, `sku` |
| Plan id | `planId` | `plan_id`, `plan` |
| Price id | `priceId` | `price_id` |
| Payment provider | `paymentProvider` | `payment_provider` |
| Renewal flag | `isRenewal` | `is_renewal` |
| Trial conversion flag | `isTrialConversion` | `is_trial_conversion` |
| Coupon code | `couponCode` | `coupon_code`, `coupon` |

Avoid inventing special Rejourney-only object fields. If your product already has useful domain properties, send them as ordinary custom event properties, but do not expect the SDK to infer app-specific business objects.

### Examples

```dart
// E-commerce
await Rejourney.logEvent('purchase_completed', <String, Object?>{
  'transactionId': order.id,
  'planId': 'pro',
  'amount': 29.99,
  'currency': 'USD',
  'paymentProvider': 'stripe',
  'isRenewal': false,
});

// Onboarding
await Rejourney.logEvent('onboarding_step', <String, Object?>{
  'step': 3,
  'stepName': 'profile_setup',
  'skipped': false,
});

// Feature usage
await Rejourney.logEvent('feature_used', <String, Object?>{
  'feature': 'dark_mode',
  'enabled': true,
});

// Errors / edge cases
await Rejourney.logEvent('payment_failed', <String, Object?>{
  'errorCode': 'card_declined',
  'retryCount': 2,
});
```

### Revenue Mapping

The Revenue impact Custom events source uses the same `logEvent` payload. Use a real money-collected event such as `purchase_completed`; do not map setup or device events such as `device_info`, `app_initialized`, or screen-view events as revenue.

For the e-commerce example above, choose:

| Dashboard field | Value |
|---|---|
| Purchase event | `purchase_completed` |
| Amount property | `amount` |
| Currency property | `currency` |
| Default currency | `USD` |
| Amount unit | Dollars / major units |

`transactionId` is strongly recommended so retries and duplicate client/backend sends collapse into one revenue fact. If your event sends cents, for example `<String, Object?>{'amount': 2999, 'currency': 'USD'}`, choose Cents / minor units. Refund and lifecycle events are optional; leave them unset unless you log separate events such as `refund_completed` or `subscription_cancelled`.

### How Events Appear in the Dashboard

Custom events are stored per-session and visible in two places:

1. **Session Replay Timeline** — Events appear as markers on the replay timeline so you can jump to the exact moment an action occurred.
2. **Session Archive Filters** — Filter the session list by:
   - **Event name** — Find all sessions containing a specific event (e.g. `purchase_completed`)
   - **Event property** — Narrow further by property key and/or value (e.g. `planId = pro`)
   - **Event count** — Find sessions with a specific number of custom events (e.g. more than 5 events)

### Best Practices

> [!TIP]
> - Use consistent naming (`snake_case`, e.g. `button_tapped` not `Button Tapped`)
> - Keep property values simple (strings, numbers, booleans) — avoid deeply nested objects
> - Focus on actions that matter for debugging or analytics — don't log everything
> - Properties are for per-event context. For session-level attributes, use **Metadata** instead

## Metadata

Metadata describes the session and replaces the current value for a key:

```dart
await Rejourney.setMetadata('plan', 'premium');
await Rejourney.setMetadata(<String, Object?>{
  'role': 'admin',
  'checkoutVariant': 'v2',
});
```

Channel values may be strings, numbers, booleans, null, lists, or maps with string keys. Unsupported objects are converted to strings.

## Privacy Controls

`RejourneyMask` hides a Flutter-rendered region in captured replay frames without changing what the user sees:

```dart
RejourneyMask(
  child: TextFormField(
    obscureText: true,
    autofillHints: const <String>[AutofillHints.creditCardNumber],
  ),
)
```

The mask tracks layout changes, scrolling, and disposal. It complements native secure-field detection and project-level text/media privacy rules. Mask the smallest useful subtree and test the exact checkout, login, health, and account flows your application ships.

## Error Capture

Install error handlers before `runApp`:

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Rejourney.init('pk_live_your_public_key');
  final capture = RejourneyErrorCapture.install();

  RejourneyErrorCapture.runGuarded(() {
    runApp(const App());
  });
}
```

This records Flutter framework exceptions, platform-dispatcher errors, and guarded-zone errors, then preserves previously installed handlers. Native crash and Android ANR capture are separately controlled by `captureCrashes` and `captureAnrs`.

`Rejourney.debugCrash()` intentionally crashes the native process and `Rejourney.debugTriggerAnr()` intentionally blocks the native main thread. Use them only in a disposable debug build.

## Network Capture

Wrap `package:http` calls when you want request timeline markers:

```dart
final client = RejourneyHttpClient();
try {
  final response = await client.get(Uri.parse('https://api.example.com/catalog'));
  // Consume response.body as usual.
} finally {
  client.close();
}
```

The wrapper records method, URL, status, timing, content type, and byte sizes. It does not inspect bodies. Rejourney ingestion endpoints are excluded automatically; configure additional patterns with `networkIgnoreUrls`.

For Dio, gRPC, GraphQL, or another client, use its interceptor to call `Rejourney.logNetworkRequest(RejourneyNetworkRequest(...))` after completion.

## Configuration Reference

```dart
await Rejourney.init(
  'pk_live_your_public_key',
  config: const RejourneyConfig(
    enabled: true,
    observeOnly: false,
    captureQuality: RejourneyCaptureQuality.medium,
    stopTimeout: Duration(seconds: 10),
    detectRageTaps: true,
    rageTapThreshold: 3,
    rageTapTimeWindow: Duration(milliseconds: 500),
    captureCrashes: true,
    captureAnrs: true,
    autoTrackNetwork: true,
    networkIgnoreUrls: <String>['/health', 'telemetry.example.com'],
    disableInDevelopment: true,
  ),
);
```

| Option | Default | Purpose |
|---|---:|---|
| `apiUrl` | Rejourney cloud | Base URL for cloud or self-hosted ingestion. |
| `enabled` | `true` | Local SDK switch. |
| `observeOnly` | `false` | Collect telemetry without visual capture. |
| `captureFps` | remote/default | Local upper capture frequency. |
| `maxSessionDuration` | remote/default | Local maximum session duration. |
| `stopTimeout` | 10 seconds | Bounds how long `stop()` waits; native persistence continues after a timeout. |
| `disableInDevelopment` | `false` | Prevent `start` in debug builds. |
| `captureQuality` | `medium` | Native frame compression preset. |
| `wifiOnly` | `false` | Restrict artifact upload to Wi-Fi. |
| `captureScreen` | `true` | Permit replay frame capture. |
| `captureAnalytics` | `true` | Permit behavioral analytics. |
| `captureCrashes` | `true` | Enable supported native crash handling. |
| `captureAnrs` | `true` | Enable Android ANR observation. |
| `trackConsoleLogs` | `true` | Include supported diagnostic logs. |
| `collectDeviceInfo` | `true` | Include device and application context. |
| `collectGeoLocation` | `true` | Include coarse network-derived location when supported. |
| `autoTrackNetwork` | `true` | Enable supported request instrumentation. |
| `captureNativeSheets` | `true` | Capture supported native modal surfaces. |
| `networkCaptureSizes` | `true` | Include request/response byte sizes. |

## Lifecycle and Advanced API

- `Rejourney.getSessionId()` returns the active identifier.
- `Rejourney.stop()` flushes and closes the active session.
- `Rejourney.markVisualChange(reason)` requests an immediate frame when capture policy permits it.
- `Rejourney.onScroll(offset)` informs adaptive visual capture about scrolling.
- `Rejourney.onOAuthStarted`, `onOAuthCompleted`, and `onExternalUrlOpened` handle external-screen boundaries.
- `Rejourney.logFeedback(rating, message)` adds feedback to the timeline.
- `Rejourney.getSdkMetrics()` exposes upload, retry, queue, eviction, crash, and session counters.
- `Rejourney.nativeEvents` exposes native session lifecycle messages.

## Verify the Integration

1. Run the application on both an iOS simulator/device and an Android emulator/device.
2. Accept the application's recording consent and confirm `Rejourney.start()` returns `success: true` with a session ID. A deliberately disabled test configuration should return `error: disabled` without network access.
3. Navigate between named routes and emit a test event.
4. Exercise masked inputs and inspect replay output before enabling production sampling.
5. Consume an HTTP response through `RejourneyHttpClient` and confirm its request marker appears.
6. Call `getSdkMetrics()` to verify the native bridge and health counters.
7. Validate debug crash and ANR capture only in disposable builds.

The repository includes two working applications: the package example in `packages/flutter/example` and a consumer-style app in `examples/flutter`.

## Troubleshooting

- **MissingPluginException:** stop the app completely, run `flutter clean`, fetch packages, and rebuild; hot reload cannot install a new native plugin.
- **iOS deployment target error:** set the application deployment target to iOS 15.1 or newer and run `pod install` again.
- **Android minSdk error:** set `minSdk` to 24 or newer.
- **No session starts:** check consent flow, `enabled`, `disableInDevelopment`, the dashboard kill switch, project sample rate, and network access.
- **No route names:** assign names in `RouteSettings` or provide `routeNameResolver`.
- **Network marker delayed:** consume or drain the streamed response; the wrapper records its final byte count when the stream completes.
- **Sensitive content visible:** wrap the exact subtree with `RejourneyMask`, verify native project privacy settings, and repeat replay QA before release.

## License

The Flutter API, platform bridges, examples, and documentation are MIT licensed. Embedded Rejourney native core source files retain their Apache-2.0 notices. See the package license and third-party notice files for the exact boundary.
