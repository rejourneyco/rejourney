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

Text inputs and camera views are automatically masked. To manually hide additional sensitive UI, wrap components in the `Mask` component:

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

Masked content appears as a solid rectangle in replays and is never captured at the source.

## User Consent & GDPR

> [!IMPORTANT]
> **You are the Data Controller.** Rejourney acts as a Data Processor on your behalf. You are responsible for ensuring your end-users are informed about session recording and that you have a valid legal basis for processing their data (e.g. consent or legitimate interests).

### What you must do

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

### Console log capture

Console log capture is enabled by default (`trackConsoleLogs: true`). Console logs can contain PII depending on your app's logging practices. Disable it if sensitive data may appear in logs:

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```
```
