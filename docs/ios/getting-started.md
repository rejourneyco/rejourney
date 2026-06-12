<!-- AI_PROMPT_SECTION -->
**Using Cursor, Claude, or ChatGPT?** Copy the integration prompt and paste it into your AI assistant to auto-generate the setup code.

<!-- /AI_PROMPT_SECTION -->

## Installation

### Swift Package Manager

Add the Rejourney package in Xcode via **File → Add Package Dependencies** and enter:

```
https://github.com/rejourneyco/rejourney
```

Or add it directly to your `Package.swift`:

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
> Rejourney requires iOS 15.1 or later.

## Swift Setup

Initialize and start Rejourney in your `@main` App struct.

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

If you use `UIApplicationDelegate`, call `configure` in `application(_:didFinishLaunchingWithOptions:)`:

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

Recording starts as soon as `start()` resolves. You can check the result if needed:

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## Remote Recording Settings

Project Settings can control Swift recording defaults without shipping a new app build. Supported SDK versions read these settings when `start()` is called:

| Setting | Behavior |
|---|---|
| Sample rate | Defaults to `100%`. Sampled-in sessions capture normally. Sampled-out sessions return before replay capture, network interception, uploads, or other package work starts. |
| Max observability duration | Limits the maximum length of each observability session. |
| Recording FPS | Defaults to `1 FPS`. Project admins can choose `1`, `2`, or `3 FPS`. If remote config is unavailable, the SDK falls back to local/default capture behavior. |
| Text input privacy | Defaults to masking all text inputs. Secure-only mode keeps password/secure fields masked and allows other text inputs to appear in debugging replays. |
| Image/video privacy | Defaults to showing images and videos. When enabled, images and videos are masked together. |

## Screen Tracking

Rejourney does not hook into SwiftUI navigation automatically, so call `trackScreen` whenever the user navigates to a new screen.

### SwiftUI

Use `.onAppear` or a navigation-aware modifier:

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

Call `trackScreen` inside `viewDidAppear`:

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### NavigationPath / NavigationStack

Observe the navigation path and track on change:

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

## User Identification

Associate sessions with your own user IDs so you can find specific users in the dashboard.

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **Privacy:** Use internal IDs or UUIDs. If you must use PII (email, phone), hash it before passing it in.

Identity is persisted across app launches via `UserDefaults` — you only need to call `identify` once per login, not on every app open.

## Custom Events

Track meaningful user actions to understand behaviour, debug issues, and filter session replays in the dashboard.

### Basic Usage

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

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | `String` | Yes | Event name — use `snake_case` for consistency |
| `properties` | `[String: RejourneyMetadataValue]` | No | Key-value pairs attached to this event |

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

`RejourneyMetadataValue` accepts Swift literals directly — no wrapping needed:

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### Examples

```swift
// E-commerce
Rejourney.logEvent("purchase_completed", properties: [
    "transactionId": order.id,
    "plan": "pro",
    "amount": 29.99,
    "currency": "USD",
    "paymentProvider": "stripe",
    "isRenewal": false
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

`transactionId` is strongly recommended so retries and duplicate client/backend sends collapse into one revenue fact. If your event sends cents, for example `["amount": 2999, "currency": "USD"]`, choose Cents / minor units. Refund and lifecycle events are optional; leave them unset unless you log separate events such as `refund_completed` or `subscription_cancelled`.

### How Events Appear in the Dashboard

Custom events are stored per-session and visible in two places:

1. **Session Replay Timeline** — Events appear as markers on the replay timeline so you can jump to the exact moment an action occurred.
2. **Session Archive Filters** — Filter the session list by:
   - **Event name** — Find all sessions containing a specific event (e.g. `purchase_completed`)
   - **Event count** — Find sessions with a specific number of custom events

### Best Practices

> [!TIP]
> - Use consistent naming (`snake_case`, e.g. `button_tapped` not `Button Tapped`)
> - Keep property values simple (strings, numbers, booleans) — avoid deeply nested objects
> - Focus on actions that matter for debugging or analytics — don't log everything

## Privacy Controls

Text inputs and camera views are automatically masked by default. Images and videos are visible by default so visual replay matches what the user saw. Project admins can change the default text input masking level and enable image/video masking in Project Settings for supported SDK versions. Secure/password fields, camera views, and explicit masks remain protected.

To hide additional sensitive views, use the `mask` and `unmask` APIs:

```swift
import UIKit
import Rejourney

// Mask a view — appears as a privacy placeholder in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

For SwiftUI, get the underlying `UIView` via a `UIViewRepresentable` wrapper or `introspect`.

Camera, keyboard, image, and video placeholders use the same white treatment with a type-specific icon or label. When image/video masking is enabled remotely, both images and videos are masked together.

#### Native sheets

Native sheet capture is enabled by default (`captureNativeSheets: true`). This allows app-owned native sheets and dialogs, such as payment authorization modals, to appear in debugging replays when the OS permits capture. Keyboard/text-input system sheets are excluded when text inputs are masked by default. When text input masking is set to secure fields only, keyboards are best-effort only and cannot be reliably captured because iOS may render them as protected or remote system surfaces. OS share sheets are also best-effort only and cannot be reliably captured when the system renders them as protected or remote surfaces.

Disable native sheet capture if you want visual replay to stay limited to the main app window:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### User Consent & GDPR

> [!IMPORTANT]
> **You are the Data Controller.** Rejourney acts as a Data Processor on your behalf. You are responsible for ensuring your end-users are informed about session recording and that you have a valid legal basis for processing their data (e.g. consent or legitimate interests).

#### What you must do

1. **Disclose session recording in your app's privacy policy.** Include language such as:

   > *"We use Rejourney to record anonymized AND non-anonymized session replays of your in-app activity to help us improve the product, track crashes and issues, and reduce product friction. Session data may include screen interactions, device information, and approximate location. Text inputs and sensitive UI elements are automatically masked and never captured."*

2. **Gate recording behind consent** (recommended for EEA users):

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

3. **Respect opt-outs.** If a user withdraws consent, stop recording and clear their identity:

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### Observe-Only Mode (No Visual Recording)

To capture errors, crashes, ANRs, and network activity **without** recording visual replays, set `observeOnly: true`:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

When enabled, all telemetry is collected but no screenshots are taken — sessions will NOT appear in your Replays page but full analytics, error, network, and crash data is still captured. Useful when users have opted out of screen recording but you still want error visibility.

> **Note:** This can be set conditionally per user based on a stored preference or consent flag:
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### Network capture

Network request capture (`autoTrackNetwork: true` by default) intercepts `URLSession` traffic via a custom `URLProtocol`. Disable it if you do not want network data collected:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### Geolocation

IP-derived geolocation (country, region, city) is collected by default. Disable it to suppress the lookup entirely:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## Configuration Reference

All options are set once in `configure` and cannot be changed after `start` is called.

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

| Option | Type | Default | Description |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | Override for self-hosted deployments |
| `userId` | `String?` | `nil` | Optional initial internal user ID |
| `enabled` | `Bool` | `true` | Master kill switch — set to `false` to disable the SDK entirely |
| `observeOnly` | `Bool` | `false` | Collect telemetry only, no visual recording |
| `captureFPS` | `Int?` | `nil` | Optional local capture FPS fallback. Remote Project Settings recording FPS takes precedence when available |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | JPEG capture quality (`.low`, `.medium`, `.high`) |
| `wifiOnly` | `Bool` | `false` | Only upload session data on Wi-Fi |
| `captureScreen` | `Bool` | `true` | Enable/disable visual screen capture |
| `captureAnalytics` | `Bool` | `true` | Enable/disable analytics event collection |
| `captureCrashes` | `Bool` | `true` | Enable/disable crash reporting |
| `captureANR` | `Bool` | `true` | Enable/disable ANR (App Not Responding) detection |
| `trackConsoleLogs` | `Bool` | `true` | Capture console logs for the session |
| `collectGeoLocation` | `Bool` | `true` | Collect IP-derived geolocation |
| `autoTrackNetwork` | `Bool` | `true` | Intercept `URLSession` requests for network capture |
| `captureNativeSheets` | `Bool` | `true` | Include app-owned native sheet/dialog windows in visual replay when iOS permits capture. OS share sheets and keyboards may be protected or remote surfaces and cannot be reliably captured |
| `debug` | `Bool` | `false` | Print verbose SDK logs to the console |

## Stopping Recording

Stop the current session and flush pending data:

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

The callback variant is available for non-async contexts:

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## Session ID

Access the current session ID at any time to correlate with your own logs or support tooling:

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
