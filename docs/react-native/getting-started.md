<!-- AI_PROMPT_SECTION -->
**Using Cursor, Claude, or ChatGPT?** Copy the integration prompt and paste it into your AI assistant to auto-generate the setup code.

<!-- /AI_PROMPT_SECTION -->

## Installation

Add the Rejourney package to your project using npm or yarn.

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> Rejourney requires native code and is not compatible with Expo Go. Use development builds:
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## 3 Line Setup

Initialize and start Rejourney at the top of your app (e.g. in App.tsx or index.js).

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

Requires no provider wrapping. Recording starts immediately.

## Remote Recording Settings

Project Settings can control React Native recording defaults without shipping a new app build. Supported SDK versions read remote settings each time `Rejourney.start()` is called. If the remote config is temporarily unavailable, the SDK uses the last cached config when available, otherwise it falls back to local/default capture behavior. Older SDK versions ignore unknown remote settings.

| Setting | Behavior |
|---|---|
| Rejourney enabled | Master remote kill switch. When disabled, no session data is captured. |
| Recording enabled | Controls visual replay capture. When disabled, telemetry can still be collected without screenshots. |
| Sample rate | Defaults to `100%`. Sampled-out sessions return before native replay capture, uploads, or other package work starts. |
| Max observability duration | Limits the maximum length of each observability session. |
| Recording FPS | Defaults to `1 FPS`. Project admins can choose `1`, `2`, or `3 FPS`. |
| Text input privacy | Defaults to masking all text inputs. Secure-only mode keeps password/secure fields masked and allows other text inputs to appear in debugging replays. |
| Image/video privacy | Defaults to showing images and videos. When enabled, images and videos are masked together. |

## Screen Tracking

Rejourney automatically tracks screen changes so you can see where users are in your app during replays. Choose the setup that matches your navigation library:

### Expo Router (Automatic)

If you use **Expo Router**, screen tracking works out of the box. No additional code is needed.

> [!TIP]
> **Using custom screen names?** If you use Expo Router but want to provide your own screen names manually, see the [Custom Screen Names](#custom-screen-names) section below.

---

### React Navigation

If you use **React Navigation** (`@react-navigation/native`), use the `useNavigationTracking` hook in your root `NavigationContainer`:

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

### Custom Screen Names

If you want to manually specify screen names (e.g., for analytics consistency or if you don't use the libraries above), use the `trackScreen` method.

#### For Expo Router users:
To use custom names with Expo Router, you must first disable automatic tracking in your configuration:

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### Manual tracking call:
Call `trackScreen` whenever a screen change occurs:

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## User Identification

Associate sessions with your internal user IDs to filter and search for specific users in the dashboard.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Privacy:** Use internal IDs or UUIDs. If you must use PII (email, phone), hash it before sending.

## Custom Events

Track meaningful user actions to understand behavior patterns, debug issues, and filter session replays in the dashboard.

### Basic Usage

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

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Event name — use `snake_case` for consistency |
| `properties` | `object` | No | Key-value pairs attached to this specific event occurrence |

### Examples

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

### How Events Appear in the Dashboard

Custom events are stored per-session and visible in two places:

1. **Session Replay Timeline** — Events appear as markers on the replay timeline so you can jump to the exact moment an action occurred.
2. **Session Archive Filters** — Filter the session list by:
   - **Event name** — Find all sessions containing a specific event (e.g. `purchase_completed`)
   - **Event property** — Narrow further by property key and/or value (e.g. `plan = pro`)
   - **Event count** — Find sessions with a specific number of custom events (e.g. more than 5 events)

### Best Practices

> [!TIP]
> - Use consistent naming (`snake_case`, e.g. `button_clicked` not `Button Clicked`)
> - Keep property values simple (strings, numbers, booleans) — avoid nested objects
> - Focus on actions that matter for debugging or analytics — don't log everything
> - Properties are for per-event context. For session-level attributes, use **Metadata** instead

---

## Metadata

Attach session-level key-value pairs that describe the user or session context. Unlike events, metadata is set once per key and applies to the entire session.

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

### When to Use Metadata vs Events

| Use Case | Use **Metadata** | Use **Events** |
|---|---|---|
| User's subscription plan |  `setMetadata('plan', 'pro')` | |
| User clicked a button | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| A/B test variant |  `setMetadata('ab_variant', 'v2')` | |
| Purchase completed | |  `logEvent('purchase', { amount: 29 })` |
| User's role |  `setMetadata('role', 'admin')` | |
| Onboarding step reached | |  `logEvent('onboarding_step', { step: 3 })` |

**Rule of thumb:** If it describes *who the user is* or *what state they're in*, use metadata. If it describes *something that happened*, use events.

## Privacy Controls

Text inputs and camera views are automatically masked by default. Images and videos are visible by default so visual replay matches what the user saw. Project admins can change the default text input masking level and enable image/video masking in Project Settings for supported SDK versions; older SDK versions ignore those remote settings and keep their existing masking behavior. Secure/password fields, camera views, and explicit masks remain protected.

To manually hide additional sensitive UI, wrap components in the `Mask` component:

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

Masked content appears as a privacy placeholder in replays and is never captured at the source. Camera, keyboard, image, and video placeholders use the same white treatment with a type-specific icon or label. When image/video masking is enabled remotely, both images and videos are masked together.

### User Consent & GDPR

> [!IMPORTANT]
> **You are the Data Controller.** Rejourney acts as a Data Processor on your behalf. You are responsible for ensuring your end-users are informed about session recording and that you have a valid legal basis for processing their data (e.g. consent or legitimate interests).

#### What you must do

1. **Disclose session recording in your app's privacy policy.** Include language such as:

   > *"We use Rejourney to record anonymized AND non-anonymized session replays of your in-app activity to help us improve the product, track crashes and issues, and reduce product friction. Session data may include screen interactions, device information, and approximate location. Text inputs and sensitive UI elements are automatically masked and never captured."*

2. **Gate recording behind consent** (recommended for EEA users):

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Respect opt-outs.** If a user withdraws consent, stop recording and clear their data:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Console log capture

Console log capture is enabled by default (`trackConsoleLogs: true`). Console logs can contain PII depending on your app's logging practices. Disable it if sensitive data may appear in logs:

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### Geolocation

IP-derived geolocation (country, region, city) is collected by default. When `collectGeoLocation` is `false`, the SDK passes a flag to the native layer that suppresses the IP geolocation lookup on the backend — no location data is stored for that session. Disable it if you do not need location data or want to minimise data collection for EEA users:

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Native sheets

Native sheet capture is enabled by default (`captureNativeSheets: true`) for supported SDK versions. This allows app-owned native sheets and dialogs, such as payment authorization modals, to appear in debugging replays when the OS permits capture. Keyboard/text-input system sheets are excluded when text inputs are masked by default. When text input masking is set to secure fields only, keyboards are best-effort only and cannot be reliably captured, especially when the OS renders them as protected or remote surfaces. OS share sheets are also best-effort only and cannot be reliably captured when the system renders them as protected or remote surfaces.

Disable native sheet capture if you want visual replay to stay limited to the main app window:

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### Observe-Only Mode (No Visual Recording)

To capture errors, crashes, ANRs, and network activity **without** recording visual replays, set `observeOnly: true`:

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

When enabled, all telemetry is collected but no screenshots are taken — sessions WILL NOT appear in your Replays Page but there will be full analytics/error/network/crash data. No replay. This is useful when users have opted out of screen recording but you still want error visibility.

> **Note:** This can be set conditionally per user, for example based on a stored preference or consent flag:
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```

## Configuration Reference

Most apps only need `init()` and `start()`. Use options when you need a local fallback, privacy gate, or self-hosted endpoint. Remote Project Settings take precedence for recording FPS and privacy defaults when they are available.

```javascript
Rejourney.init('pk_live_your_public_key', {
  apiUrl: 'https://api.rejourney.co',
  enabled: true,
  observeOnly: false,
  captureFPS: 1,
  maxSessionDuration: 600000,
  captureQuality: 'medium',
  wifiOnly: false,
  captureNativeSheets: true,
  trackConsoleLogs: true,
  collectGeoLocation: true,
  collectDeviceInfo: true,
  autoTrackNetwork: true,
  networkIgnoreUrls: ['analytics.example.com'],
  networkCaptureSizes: true,
  autoTrackExpoRouter: true,
  detectRageTaps: true,
  rageTapThreshold: 3,
  rageTapTimeWindow: 500,
  rageTapRadius: 50,
  disableInDev: false,
  debug: false
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `apiUrl` | `string` | `https://api.rejourney.co` | Override for self-hosted deployments |
| `enabled` | `boolean` | `true` | Local kill switch for the SDK |
| `observeOnly` | `boolean` | `false` | Collect telemetry only, no visual recording |
| `captureFPS` | `number` | `1` | Local capture FPS fallback. Remote Project Settings recording FPS takes precedence when available |
| `maxSessionDuration` | `number` | `600000` | Local maximum session duration in milliseconds |
| `captureQuality` | `'low' \| 'medium' \| 'high'` | `'medium'` | Screenshot JPEG quality preset |
| `wifiOnly` | `boolean` | `false` | Prefer uploading session data on Wi-Fi only |
| `captureNativeSheets` | `boolean` | `true` | Include app-owned native sheet/dialog windows in visual replay when the OS permits capture |
| `trackConsoleLogs` | `boolean` | `true` | Capture console logs for the session |
| `collectGeoLocation` | `boolean` | `true` | Collect IP-derived geolocation |
| `collectDeviceInfo` | `boolean` | `true` | Collect device and environment metadata |
| `autoTrackNetwork` | `boolean` | `true` | Intercept fetch/XHR requests for network capture |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | `[]` | Ignore matching URLs during network capture |
| `networkCaptureSizes` | `boolean` | `true` | Capture request and response body sizes |
| `autoTrackExpoRouter` | `boolean` | `true` | Enable automatic Expo Router screen tracking |
| `detectRageTaps` | `boolean` | `true` | Enable rage tap detection |
| `rageTapThreshold` | `number` | `3` | Number of taps required to detect a rage tap |
| `rageTapTimeWindow` | `number` | `500` | Rage tap detection window in milliseconds |
| `rageTapRadius` | `number` | `50` | Rage tap clustering radius in points/dp |
| `disableInDev` | `boolean` | `false` | Disable recording in development builds |
| `debug` | `boolean` | `false` | Print verbose SDK logs to the console |
