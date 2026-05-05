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
    .package(url: "https://github.com/rejourneyco/rejourney", from: "0.1.1")
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
        Rejourney.configure(publicKey: "pk_live_your_public_key")
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
        Rejourney.configure(publicKey: "pk_live_your_public_key")
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
.onChange(of: path) {
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

### How Events Appear in the Dashboard

Custom events are stored per-session and visible in two places:

1. **Session Replay Timeline** — Events appear as markers on the replay timeline so you can jump to the exact moment an action occurred.
2. **Session Archive Filters** — Filter the session list by:
   - **Event name** — Find all sessions containing a specific event (e.g. `purchase_completed`)
   - **Event property** — Narrow further by property key and/or value (e.g. `plan = pro`)
   - **Event count** — Find sessions with a specific number of custom events

### Best Practices

> [!TIP]
> - Use consistent naming (`snake_case`, e.g. `button_tapped` not `Button Tapped`)
> - Keep property values simple (strings, numbers, booleans) — avoid deeply nested objects
> - Focus on actions that matter for debugging or analytics — don't log everything
> - Properties are for per-event context. For session-level attributes, use **Metadata** instead

---

## Metadata

Attach session-level key-value pairs that describe the user or session context. Unlike events, metadata applies to the entire session.

```swift
import Rejourney

// Set a single property
Rejourney.setMetadata("plan", "premium")

// Set multiple properties at once
Rejourney.setMetadata([
    "role":       "admin",
    "segment":    "enterprise",
    "ab_variant": "checkout_v2"
])
```

### When to Use Metadata vs Events

| Use Case | Use **Metadata** | Use **Events** |
|---|---|---|
| User's subscription plan | `setMetadata("plan", "pro")` | |
| User tapped a button | | `logEvent("button_tapped", ...)` |
| A/B test variant | `setMetadata("ab_variant", "v2")` | |
| Purchase completed | | `logEvent("purchase", ...)` |
| User's role | `setMetadata("role", "admin")` | |
| Onboarding step reached | | `logEvent("onboarding_step", ...)` |

**Rule of thumb:** If it describes *who the user is* or *what state they're in*, use metadata. If it describes *something that happened*, use events.

## Privacy Controls

Text inputs are automatically masked by the SDK. To hide additional sensitive views, use the `mask` and `unmask` APIs:

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

For SwiftUI, get the underlying `UIView` via a `UIViewRepresentable` wrapper or `introspect`.

### User Consent & GDPR

> [!IMPORTANT]
> **You are the Data Controller.** Rejourney acts as a Data Processor on your behalf. You are responsible for ensuring your end-users are informed about session recording and that you have a valid legal basis for processing their data (e.g. consent or legitimate interests).

#### What you must do

1. **Disclose session recording in your app's privacy policy.** Include language such as:

   > *"We use Rejourney to record anonymized AND non-anonymized session replays of your in-app activity to help us improve the product, track crashes and issues, and reduce product friction. Session data may include screen interactions, device information, and approximate location. Text inputs and sensitive UI elements are automatically masked and never captured."*

2. **Gate recording behind consent** (recommended for EEA users):

   ```swift
   // Configure early — before consent is known
   Rejourney.configure(publicKey: "pk_live_your_public_key")

   // Call start() only after the user accepts your privacy policy
   func onUserConsented() {
       Task { await Rejourney.start() }
   }
   ```

3. **Respect opt-outs.** If a user withdraws consent, stop recording and clear their identity:

   ```swift
   await Rejourney.stop()
   Rejourney.clearIdentity()
   ```

#### Observe-Only Mode (No Visual Recording)

To capture errors, crashes, ANRs, and network activity **without** recording visual replays, set `observeOnly: true`:

```swift
Rejourney.configure(
    publicKey: "pk_live_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

When enabled, all telemetry is collected but no screenshots are taken — sessions will NOT appear in your Replays page but full analytics, error, network, and crash data is still captured. Useful when users have opted out of screen recording but you still want error visibility.

> **Note:** This can be set conditionally per user based on a stored preference or consent flag:
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "pk_live_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### Network capture

Network request capture (`autoTrackNetwork: true` by default) intercepts `URLSession` traffic via a custom `URLProtocol`. Disable it if you do not want network data collected:

```swift
Rejourney.configure(
    publicKey: "pk_live_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### Geolocation

IP-derived geolocation (country, region, city) is collected by default. Disable it to suppress the lookup entirely:

```swift
RejourneyOptions(collectGeoLocation: false)
```

## Configuration Reference

All options are set once in `configure` and cannot be changed after `start` is called.

```swift
Rejourney.configure(
    publicKey: "pk_live_your_public_key",
    options: RejourneyOptions(
        apiURL:             URL(string: "https://api.rejourney.co")!,
        enabled:            true,
        observeOnly:        false,
        captureFPS:         nil,          // nil = SDK default
        captureQuality:     .medium,      // .low | .medium | .high
        wifiOnly:           false,
        captureScreen:      true,
        captureAnalytics:   true,
        captureCrashes:     true,
        captureANR:         true,
        trackConsoleLogs:   true,
        collectGeoLocation: true,
        autoTrackNetwork:   true,
        debug:              false
    )
)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | Override for self-hosted deployments |
| `enabled` | `Bool` | `true` | Master kill switch — set to `false` to disable the SDK entirely |
| `observeOnly` | `Bool` | `false` | Collect telemetry only, no visual recording |
| `captureFPS` | `Int?` | SDK default | Frames per second for screen capture (1–30). `nil` lets the SDK decide |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | JPEG compression quality for captured frames |
| `wifiOnly` | `Bool` | `false` | Only upload session data on Wi-Fi |
| `captureScreen` | `Bool` | `true` | Enable/disable visual screen capture |
| `captureAnalytics` | `Bool` | `true` | Enable/disable analytics event collection |
| `captureCrashes` | `Bool` | `true` | Enable/disable crash reporting |
| `captureANR` | `Bool` | `true` | Enable/disable ANR (App Not Responding) detection |
| `trackConsoleLogs` | `Bool` | `true` | Capture diagnostic log output |
| `collectGeoLocation` | `Bool` | `true` | Collect IP-derived geolocation |
| `autoTrackNetwork` | `Bool` | `true` | Intercept `URLSession` requests for network capture |
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
    MyLogger.log("Rejourney session: \(sessionId)")
    Crashlytics.setCustomValue(sessionId, forKey: "rejourney_session_id")
}
```
