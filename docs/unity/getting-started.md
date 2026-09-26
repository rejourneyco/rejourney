<!-- AI_PROMPT_SECTION -->
**Using Cursor, Claude, or ChatGPT?** Copy the integration prompt and paste it into your AI assistant to auto-generate the setup code.

<!-- /AI_PROMPT_SECTION -->

# Unity SDK

Rejourney for Unity records what players saw and what the game did:

- **Session replay** of the Unity viewport, with text inputs and marked objects masked
  before frames leave the device.
- **[Performance monitoring](#performance-monitoring)**: frame times, long frames,
  memory, garbage collection, game-loop hangs and scene load times, charted against
  the replay.
- **[Gameplay markers](#gameplay-markers)** that separate play from menus. Taps during
  play are left out of frustration signals and heatmaps.
- **[Crashes, exceptions and errors](#errors-and-crashes)**, with managed stacks and
  native crash recovery.
- **[Automatic HTTP timing](#automatic-http-coverage)** for `UnityWebRequest` and
  `HttpClient`, with no code changes.


## Install and configure

Download `co.rejourney.unity-0.1.0.tgz` from the
[Unity SDK v0.1.0 release](https://github.com/rejourneyco/rejourney/releases/tag/unity-v0.1.0)
and install it with **Window → Package Manager → + → Install package from tarball**.
To follow the release through Git instead, add this line to `Packages/manifest.json`:

```json
"co.rejourney.unity": "https://github.com/rejourneyco/rejourney.git?path=/packages/unity#unity-v0.1.0"
```

The archive includes an iOS XCFramework and Android AAR. UPM resolves Newtonsoft JSON and Mono.Cecil. Keep
`Rejourney.Runtime` in assemblies that call the public API. Optional uGUI and
Input System assemblies activate through package version defines; remove their
folders if those integrations are not desired.

Use Project Settings → Rejourney to prepare local configuration. That page
writes `ProjectSettings/Rejourney.local.json`; ignore it in version control and
copy the configuration into your app bootstrap explicitly. The page never
starts a session. The example instead accepts an ignored
`Assets/Resources/RejourneyLocal.json`:

```json
{"publicProjectKey":"YOUR_CLOUD_PUBLIC_KEY","apiUrl":"https://api.rejourney.co"}
```

Call `Init` once on the Unity thread. After consent, await `StartAsync` and inspect
`StartResult.State`: Recording, TelemetryOnly, Disabled, AuthenticationFailed,
Unsupported or Error. No SDK operation requires an account credential.
`Init` with another project while active fails; await `StopAsync` first. Calls
before initialization are safe. Native recovery remains bound to its original
project and endpoint and cannot use a replacement project's upload token.

`PauseAsync` preserves the foreground session and records a gap. `ResumeAsync`
continues it. A background shorter than 60 seconds resumes the same session and
leaves the time away out of its duration. A longer background ends the session at
the moment the app left the foreground; a new session starts on return and
`CurrentSessionId` changes, while `State` stays unchanged.
`FlushAsync` and `StopAsync` distinguish Delivered from Queued and Failed.
Queued requires a durable native retry entry; it is not a server acknowledgment.
A failed or timed-out drain may still have work in flight. Events not yet sealed
in the native spool are lost on abrupt process death.
`Rejourney.Health.MainThreadMilliseconds` reports the SDK's cumulative cost on
the Unity main thread.

## Screen Tracking

Rejourney tracks screen and scene changes so you can see where players are in your game during replays.

### Automatic Scene Tracking

Unity active scene changes (`SceneManager.activeSceneChanged`) are tracked as screen transitions automatically. No additional setup is required for scene-based navigation.

### UI Screen Component (RejourneyScreen)

For canvas menus, sub-panels, and dialogs within the same scene, attach the `RejourneyScreen` component to your root panel GameObject:

```csharp
using RejourneySDK;

// Add RejourneyScreen to your UI panel GameObject in the Unity Inspector,
// or configure its ScreenName field in code:
var screen = gameObject.AddComponent<RejourneyScreen>();
screen.ScreenName = "ShopPanel";
```

Whenever the GameObject is enabled (`OnEnable`), `RejourneyScreen` automatically reports the screen transition using its configured `ScreenName` (or falls back to `gameObject.name` if left blank).

### Manual Screen Tracking

You can also trigger screen changes imperatively from your UI controllers or state machines:

```csharp
using RejourneySDK;

// Call when opening a dialog, switching tabs, or changing UI state
Rejourney.TrackScreen("CharacterCustomization");
```

## User Identification

Associate sessions with your internal player IDs to filter and search for specific users in the dashboard.

```csharp
using RejourneySDK;

// After player authentication or login
Rejourney.SetUserIdentity("player_abc123");

// On player logout
Rejourney.ClearUserIdentity();
```

> [!IMPORTANT]
> **Privacy:** Use internal IDs or UUIDs. If you must use PII (email, username, phone), hash it before sending. Developer-supplied identities, event properties, and metadata must contain no sensitive data.

## Custom Events

Track meaningful player actions to understand user behavior, debug issues, and filter session replays in the dashboard.

### Basic Usage

```csharp
using System.Collections.Generic;
using RejourneySDK;

// Simple event (name only)
Rejourney.LogEvent("signup_completed");

// Event with properties
Rejourney.LogEvent("button_clicked", new Dictionary<string, object> {
    ["buttonName"] = "start_game"
});
```

### API

```csharp
public static void Rejourney.LogEvent(string name, IDictionary<string, object> properties = null)
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Event name — use `snake_case` for consistency |
| `properties` | `IDictionary<string, object>` | No | Key-value pairs attached to this specific event occurrence |

### Naming Conventions

Use stable, lowercase `snake_case` names. The preferred names below give Rejourney the cleanest signal for revenue, lifecycle, and dashboard analysis features. The aliases are accepted for compatibility, but new instrumentation should use the preferred name.

| Player / User action | Preferred event name | Compatible aliases |
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

Use these standard property names when they apply:

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

Avoid inventing proprietary Rejourney-only wrapper objects. If your game has relevant domain attributes, supply them directly as custom event properties.

### Examples

```csharp
using System.Collections.Generic;
using RejourneySDK;

// In-App Purchase (IAP) / Store transaction
Rejourney.LogEvent("purchase_completed", new Dictionary<string, object> {
    ["transactionId"] = order.Id,
    ["productId"] = "gem_pack_tier_2",
    ["amount"] = 4.99,
    ["currency"] = "USD",
    ["paymentProvider"] = "google_play", // or "apple_app_store"
    ["isRenewal"] = false
});

// Tutorial / Onboarding progression
Rejourney.LogEvent("onboarding_step", new Dictionary<string, object> {
    ["step"] = 3,
    ["stepName"] = "combat_tutorial",
    ["skipped"] = false
});

// Feature usage / Game settings
Rejourney.LogEvent("feature_used", new Dictionary<string, object> {
    ["feature"] = "auto_aim",
    ["enabled"] = true
});

// Payment / Transaction failure
Rejourney.LogEvent("payment_failed", new Dictionary<string, object> {
    ["errorCode"] = "billing_unavailable",
    ["retryCount"] = 2
});
```

### Specialized Unity Events

The Unity SDK provides dedicated helper methods for common game lifecycle and external navigation events:

```csharp
using RejourneySDK;

// Add a diagnostic or cohort tag to the current session
Rejourney.AddSessionTag("closed_beta");

// Record player satisfaction feedback (message only, or rating and message)
Rejourney.LogFeedback("Great battle mechanics!");
Rejourney.LogFeedback(5, "Loved the final boss fight!");

// Mark flows that leave the game, so replay gaps have an explanation
Rejourney.OnExternalUrlOpened("https://discord.gg/yourgame");
Rejourney.OnOAuthStarted("google");
Rejourney.OnOAuthCompleted("google", true);
```

#### Custom Events vs. Gameplay Markers

It is important to understand the difference between **Custom Events** and **Gameplay Markers**:
- **Custom Events (`Rejourney.LogEvent`)** record discrete, point-in-time actions (such as store purchases, button taps, or reaching a tutorial step).
- **Gameplay Markers (`StartGameplay`, `EndGameplay`, `Gameplay`)** define time-spanned intervals representing active gameplay (matches, rounds, levels). During an active gameplay segment, touches are excluded from rage/dead tap heuristics, and the replay timeline displays an amber gameplay lane. See [Gameplay markers](#gameplay-markers) below for details.

### Revenue Mapping

The Revenue impact Custom events source uses the same `LogEvent` payload. Use a real money-collected event such as `purchase_completed`; do not map setup, device, or screen-view events as revenue.

For the IAP example above, configure the dashboard as follows:

| Dashboard field | Value |
|---|---|
| Purchase event | `purchase_completed` |
| Amount property | `amount` |
| Currency property | `currency` |
| Default currency | `USD` |
| Amount unit | Dollars / major units |

`transactionId` is strongly recommended so retries and duplicate client/backend sends collapse into one revenue fact. If your event sends cents, for example `["amount"] = 499`, select Cents / minor units in the dashboard. Refund and lifecycle events are optional; leave them unset unless you log separate events such as `refund_completed` or `subscription_cancelled`.

### How Events Appear in the Dashboard

Custom events are stored per-session and visible in two places:

1. **Session Replay Timeline** — Events appear as markers on the replay timeline so you can jump to the exact moment an action occurred.
2. **Session Archive Filters** — Filter the session list by:
   - **Event name** — Find all sessions containing a specific event (e.g. `purchase_completed`)
   - **Event property** — Narrow further by property key and/or value (e.g. `productId = gem_pack_tier_2`)
   - **Event count** — Find sessions with a specific number of custom events (e.g. more than 5 events)

### Best Practices

> [!TIP]
> - Use consistent naming (`snake_case`, e.g. `item_purchased` not `Item Purchased`)
> - Keep property values simple (strings, numbers, booleans) — avoid deeply nested structures
> - Focus on actions that matter for debugging or analytics — don't log every frame or physics collision
> - Properties are for per-event context. For session-level attributes, use **Metadata** instead

---

## Metadata

Attach session-level key-value pairs that describe the player or session context. Unlike events, metadata is set once per key and applies across the entire session.

```csharp
using System.Collections.Generic;
using RejourneySDK;

// Set a single property
Rejourney.SetMetadata("player_tier", "vip");

// Set multiple properties at once
Rejourney.SetMetadata(new Dictionary<string, object> {
    ["guild"] = "dragon_slayers",
    ["player_level"] = 42,
    ["ab_variant"] = "tutorial_v2"
});
```

### When to Use Metadata vs Events

| Use Case | Use **Metadata** | Use **Events** |
|---|---|---|
| Player's account tier | `Rejourney.SetMetadata("tier", "vip")` | |
| Player clicked a UI button | | `Rejourney.LogEvent("button_clicked", new Dictionary<string, object> { ["buttonName"] = "play" })` |
| A/B test variant assignment | `Rejourney.SetMetadata("ab_variant", "v2")` | |
| In-App Purchase completed | | `Rejourney.LogEvent("purchase_completed", new Dictionary<string, object> { ["amount"] = 4.99, ["currency"] = "USD" })` |
| Player's clan / guild | `Rejourney.SetMetadata("guild", "knights")` | |
| Tutorial step reached | | `Rejourney.LogEvent("onboarding_step", new Dictionary<string, object> { ["step"] = 3 })` |

**Rule of thumb:** If it describes *who the player is* or *what persistent state they're in*, use metadata. If it describes *something that happened*, use events.

## Gameplay markers

Mark where play starts and ends. The replay, analytics and research exports can
then tell game input from interface use:

```csharp
// Entering a level, match, round or run.
Rejourney.StartGameplay("level_3", new Dictionary<string, object> { ["difficulty"] = "hard" });

// Leaving it, with an outcome.
Rejourney.EndGameplay(GameplayOutcome.Completed, new Dictionary<string, object> { ["score"] = 1200 });

// Or as a scope that ends as completed when disposed.
using (Rejourney.Gameplay("boss_fight")) { /* ... */ }
```

- **One segment at a time.** Starting a segment while another is active ends
  the previous one with outcome `superseded`. `EndGameplay` takes `completed`,
  `failed`, `quit`, `abandoned`, `ended` (the default) or any short string.
  The dashboard and research exports keep these values and group any other
  string as other.
- **Checking state.** `IsGameplayActive` and `ActiveGameplayId` report the
  active segment.
- **Starting before recording.** Calling `StartGameplay` before `Init`, or
  while no session is recording, is safe: the segment is tracked, and the next
  session that starts records it as continued.
- **Segments outlive sessions.** After a 60-second background rollover or a new
  `StartAsync`, the new session gets its own start marker. `StopAsync` ends the
  interval in the stopping session with outcome `session_end` but leaves the
  segment active.
- **Background and pause.** Starting or ending play while the app is in the
  background or recording is paused is safe, including from your own
  `OnApplicationPause` handler. The marker is written with its original time as
  soon as recording resumes.
- **Taps during play.** They stay in the replay and in touch counts, but never
  count as rage or dead taps and are left out of heatmaps. The replay timeline
  shows gameplay as an amber lane, and the Unity panel lists the segments with
  links to seek to them.
- **Research exports.** Exports carry the intervals and flag every row inside
  them. Research tooling leaves gameplay out by default.
- **Names and properties.** They follow the same rules as `LogEvent`: no
  personal or sensitive data. Names are trimmed to 128 characters and outcomes
  to 64. Properties are limited to 4 KB of JSON per marker; if they are larger,
  the properties are dropped and the marker is kept.

## Performance monitoring

Performance is measured automatically while a session records, including in
telemetry-only mode. You write no code, and the numbers come from real players on
real devices.

- **Frame pacing.** Every 5 seconds the SDK records FPS and frame time at p50, p95
  and maximum, plus the number of long frames (50 ms or more).
- **Memory and garbage collection.** Each sample includes the managed heap, Unity's
  allocated memory and the garbage collections since the previous sample, so leaks
  and GC spikes line up with what the player was doing.
- **Game-loop hangs.** When the Unity main thread stops producing frames for
  `HangThresholdSeconds` (default 5, minimum 2), the SDK records a hang incident
  once the loop resumes, with the stall's full duration and the screen it froze
  on. It is reported separately from Android's UI-thread ANRs. Detection skips the first 10 seconds after `Init` and any time a debugger
  is attached. `CaptureHangs = false` turns off both this detector and Android's
  native ANR capture.
- **Scene loads.** Wrap a load in `using (Rejourney.BeginSceneLoad("Shop")) { ... }`
  to record its measured duration. Active scene changes are tracked as screens
  automatically.
- **Runtime context.** Every session carries the Unity version, scripting backend,
  graphics API, render pipeline and build GUID, so you can compare builds and
  rendering setups.

In the dashboard, the Metadata tab of a Unity session's replay has a Unity panel
with a frame-time chart for the whole session and a link to seek to the slowest
moment. The samples and hangs also appear in the replay timeline, next to the
frames, taps and requests around them.

The SDK measures its own cost too: `Rejourney.Health.MainThreadMilliseconds` is the
total time it has spent on the Unity main thread since `Init`.

## Errors and crashes

Errors are captured automatically while a session records, including when
`CaptureLogs` is off. Each one carries its exception type, stack, the screen it
happened on and whether the game handled it, and the issue feed groups them by
type and message.

- **Unhandled exceptions.** Anything Unity logs as an exception: exceptions thrown
  from `Update`, coroutines, UI events or `async void` methods. `Debug.LogException`
  reaches the same log and counts the same way.
- **Unity errors.** `Debug.LogError` and failed assertions, named `UnityLogError` and
  `UnityAssert`.
- **Handled exceptions.** Report one with `Rejourney.CaptureException(exception)`.
  If the exception was never thrown, the SDK records the caller's stack instead.
- **Unobserved task exceptions.** A `Task` that faults with nothing awaiting it is
  reported as unhandled when .NET collects the task. Your game's own
  `TaskScheduler.UnobservedTaskException` handling is left unchanged.
- **Native crashes.** Fatal signals and native exceptions are recorded on the device
  as they happen and uploaded when the game next starts a session. The crashed
  session is closed at its last activity. `CaptureCrashes = false` turns this off.
  On iOS devices, MetricKit adds the system's crash report when iOS delivers it.

Capture follows the recording session: after `StopAsync`, or once the project's
maximum recording length has ended the session, errors and crashes are recorded
again only when the next session starts.

## Privacy and capture

Replay defaults to 1 FPS, a 960-pixel maximum dimension and JPEG quality 50.
The cloud governs 1–3 FPS, text masking and media masking. Password fields are
always masked. uGUI/InputField, TMP_InputField and UI Toolkit TextField geometry
is collected before GPU readback. Add `RejourneyMask` to sensitive UI subtrees or
world objects, or call `Mask(gameObject)` / `Unmask(gameObject)`.

Unresolvable geometry, excessive mask counts, and an all-media cloud policy
suppress frames. The all-media policy currently suppresses the entire Unity
viewport because arbitrary game-rendered media cannot be safely classified.
This is visible in privacy-drop diagnostics. A black scene is valid footage.

Coordinates use a top-left origin in the Unity viewport, in pixels. Semantic
snapshots include viewport size, mask rectangles, and at most 128 explicitly
registered targets. They omit arbitrary scene text. GPU and encode queues have
one job in flight; native frame and hierarchy delivery each have one pending
job. Backpressure drops are separate from capture failures. A synchronous
readback fallback is limited to 480 pixels and reported as degraded.

Pause around system keyboards, payment/ad/native plugin overlays, and other
surfaces outside Unity's rendered frame. XR and arbitrary native overlays are
outside this release's capture guarantee.

## Automatic HTTP coverage

Player compilation rewrites ordinary UnityWebRequest.SendWebRequest and
Dispose calls, plus the three HttpClient constructors. Coroutines, async state
machines and nested classes are included. The original operation, custom
handler, cancellation, certificate behavior and disposal ownership are retained.
HttpClient timing ends when its handler returns the response; response byte
counts use Content-Length when available. Request/response bodies and headers
are not collected. URLs omit credentials, query values and fragments. The
configured Rejourney API host is excluded; SDK native transport is not woven.

Reports are in `Library/Rejourney/NetworkReports`. Instrumentation failures fail
the player build. `[RejourneyNetworkExclude]` excludes assemblies/classes/methods;
`REJOURNEY_DISABLE_AUTO_NETWORK` disables weaving for the build. Precompiled DLLs,
reflection-created calls, native libraries, WebSockets, multiplayer transports,
and Unity engine assemblies are outside automatic coverage. Use
`LogNetworkRequest` for those paths. Never weaken TLS or replace game handlers
just to enable telemetry.

## Native builds and stripping

Consumers use the included binaries. Maintainers run `Tools~/build-native.sh`
with Xcode and Unity Android Build Support installed. Xcode processing keeps
Swift runtime embedding and linker settings; the AAR build processor adds the
explicit AndroidX/OkHttp/coroutine dependencies. Android UI work always uses the
main looper, including under GameActivity.

IL2CPP preservation is automatic at every stripping level. Unity does not read
`link.xml` files inside packages, so the package hands its rules to UnityLinker
itself, and the optional uGUI/Input System adapters are always linked. If the uGUI
adapter is removed or stripped anyway, frames that contain active uGUI or TMP input
fields are dropped rather than recorded unmasked. Android release builds use IL2CPP
(ARM64 is required by Google Play); Unity 6 Mono development builds are ARMv7-only.

Keep symbols from your own release builds. The SDK reports managed stacks and
native facts available from platform recovery or a signal marker. It does not
provide full native symbolication. Use deliberate native probes only from
Development builds and without an attached debugger.
