<!-- AI_PROMPT_SECTION -->
**Using Cursor, Claude, or ChatGPT?** Copy the integration prompt and paste it into your AI assistant to auto-generate the setup code.

<!-- /AI_PROMPT_SECTION -->

## Installation

Add the Rejourney package to your project using npm or yarn.

```bash
npm install @rejourneyco/browser
```

## Basic Setup

Initialize and start Rejourney at the entry point of your app.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init` fetches your project's remote config and prepares the SDK. `start` begins the session, registers the visitor, and (if replay is enabled) starts the rrweb recorder. Both are async and safe to call without awaiting if you don't need to gate anything on completion.

> [!NOTE]
> `autoStart` is `false` by default. You must call `start()` explicitly, which lets you gate recording behind a consent check. To start automatically after `init`, pass `{ autoStart: true }`.

### Framework Integrations

The package ships dedicated entry points for popular frameworks. Use the one that matches your stack — or use the vanilla API above from any framework.

---

#### React

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

`startOnMount` defaults to `false` on `RejourneyProvider`. Pass `startOnMount` (or `startOnMount={true}`) to start recording as soon as the component mounts.

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

`RejourneyNext` is a `'use client'` component that renders `null`. `startOnMount` defaults to `true`. Route changes are tracked automatically via the History API.

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

The Rejourney instance is available via `app.config.globalProperties.$rejourney` and via `inject('rejourney')`. The `useRejourney()` composable is also exported for convenience.

---

#### Nuxt

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

The `.client.ts` suffix ensures this plugin runs only in the browser. The Rejourney instance is injected as `$rejourney` and available via `useNuxtApp().$rejourney`.

---

#### Svelte / SvelteKit

```javascript
// +layout.svelte
<script>
  import { onMount } from 'svelte';
  import { startRejourneyOnMount } from '@rejourneyco/browser/svelte';

  onMount(() => startRejourneyOnMount({ publicKey: 'pk_live_your_public_key' }));
</script>
```

`startRejourneyOnMount` returns a cleanup function that calls `Rejourney.stop()` — Svelte's `onMount` return value is used as the destroy callback automatically.

---

#### Angular

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

`createRejourneyAppInitializer` returns a factory that initializes and starts Rejourney during Angular's bootstrap phase. You can also inject `RejourneyService` for a class-based API.

---

#### Remix

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

`startOnMount` defaults to `true`. Route changes are tracked automatically.

---

#### Astro

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

`startRejourneyForAstro` no-ops in SSR environments — it checks for `window` before running.

---

## Remote Recording Settings

Project Settings can control web recording defaults without a code deploy. The SDK reads remote config on every `start()` call. The remote config can enable or disable recording entirely, adjust the allowed domains list, and set a maximum session duration. If the remote config is unavailable, `start()` will not proceed — this is intentional to prevent recording under unknown project state.

## Route Tracking

Rejourney automatically tracks page and route changes so you can see navigation context in replays. This is enabled by default (`autoTrackRoutes: true`) and works by intercepting History API calls (`pushState`, `replaceState`) and listening to `popstate` events.

### Custom Route Names

By default the current `window.location.pathname` is used as the screen name. To provide your own naming logic, pass a `routeName` function:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### Manual Screen Tracking

To track screens manually (e.g. for tab changes or in-page view transitions), call `trackScreen` directly:

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

To disable automatic route tracking and rely solely on manual calls:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## User Identification

Associate sessions with your internal user IDs to filter and search for specific users in the dashboard.

```javascript
import { Rejourney } from '@rejourneyco/browser';

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

Metadata values must be `string`, `number`, or `boolean`. Objects and arrays are not accepted.

### When to Use Metadata vs Events

| Use Case | Use **Metadata** | Use **Events** |
|---|---|---|
| User's subscription plan | `setMetadata('plan', 'pro')` | |
| User clicked a button | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| A/B test variant | `setMetadata('ab_variant', 'v2')` | |
| Purchase completed | | `logEvent('purchase', { amount: 29 })` |
| User's role | `setMetadata('role', 'admin')` | |
| Onboarding step reached | | `logEvent('onboarding_step', { step: 3 })` |

**Rule of thumb:** If it describes *who the user is* or *what state they're in*, use metadata. If it describes *something that happened*, use events.

## Privacy Controls

All text inputs are masked by default (`maskAllInputs: true`). Masked fields appear as blank inputs in replays and the values are never captured at the source. Password, email, phone, and other sensitive input types are always masked regardless of this setting.

### Blocking Elements

To completely exclude a DOM element from replays (it appears as a solid placeholder), add one of the following:

- CSS class: `rr-block`
- Data attribute: `data-rj-block` or `data-rejourney-block`
- Custom CSS selector via `blockSelector` config option

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### Masking Text

To mask the text content of an element (text is replaced but the element's shape remains visible), add one of the following:

- CSS class: `rr-mask`
- Data attribute: `data-rj-mask`, `data-rejourney-mask`, `data-private`, or any `data-testid` containing `"password"`
- Custom CSS selector via `maskTextSelector` config option

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### Ignoring Elements

To capture an element's shape but suppress all interaction events (clicks, inputs) on it, add:

- CSS class: `rr-ignore`
- Data attribute: `data-rj-ignore` or `data-rejourney-ignore`

### Custom Masking Functions

For programmatic masking logic, use `maskInputFn` or `maskTextFn`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### User Consent & GDPR

> [!IMPORTANT]
> **You are the Data Controller.** Rejourney acts as a Data Processor on your behalf. You are responsible for ensuring your end-users are informed about session recording and that you have a valid legal basis for processing their data (e.g. consent or legitimate interests).

#### What you must do

1. **Disclose session recording in your privacy policy.** Include language such as:

   > *"We use Rejourney to record anonymized and non-anonymized session replays of your activity on our website to help us improve the product and reduce friction. Session data may include page interactions, browser information, and approximate location. Text inputs and sensitive elements are automatically masked and never captured."*

2. **Gate recording behind consent** (recommended for EEA users):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Respect opt-outs.** If a user withdraws consent, stop recording and clear their identity:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Granular consent via `setConsent`

For finer control, use `setConsent` to independently toggle analytics and replay:

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

Setting `analytics: false` and `replay: false` together stops the session and clears all queued data. Setting `replay: false` alone stops the rrweb recorder but keeps event tracking running.

#### Console log capture

Console log capture is disabled by default (`trackConsoleLogs: false`). Enable it only if you need it, as console logs can contain PII depending on your logging practices:

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### Geolocation

IP-derived geolocation (country, region, city) is collected by default. When `collectGeoLocation` is `false`, the SDK passes a flag that suppresses the IP geolocation lookup on the backend — no location data is stored for that session:

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Observe-Only Mode (No Visual Recording)

To capture errors, long tasks, network activity, and analytics **without** recording visual replays, set `observeOnly: true`:

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

When enabled, all telemetry is collected but no rrweb recording runs — sessions will not appear in your Replays page, but full analytics, error, and network data is still captured. Useful when a user has opted out of visual recording but you still want observability.

> **Note:** You can set this conditionally per user, for example based on a stored consent preference:
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### Bot Detection

Bots and automated browsers are ignored by default (`ignoreBots: true`). Playwright, Puppeteer, Selenium, and other webdriver-based clients are suppressed. To record automation sessions (e.g. for internal tooling):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

To provide a custom bot detection pattern:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### Network Request Capture

Network requests (fetch and XHR) are intercepted and logged by default (`autoTrackNetwork: true`). Request and response body sizes are **not** captured by default (`networkCaptureSizes: false`). URLs, methods, status codes, and durations are always captured.

To exclude specific URLs:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

To filter or redact requests before they are sent:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## Configuration Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | Call `start()` automatically after `init()` completes |
| `disableInDev` | `boolean` | `false` | Suppress recording on `localhost` and `127.0.0.1` |
| `debug` | `boolean` | `false` | Enable verbose SDK logging to the browser console |
| `enabled` | `boolean` | `true` | Master kill switch — set to `false` to prevent any recording |
| `observeOnly` | `boolean` | `false` | Capture analytics/errors/network without visual replay |
| `captureReplay` | `boolean` | `true` | Enable rrweb visual replay capture |
| `allowedDomains` | `string[]` | `[]` | Restrict recording to specific domains. Empty means all domains allowed. Supports `*.example.com` wildcards |
| `maxSessionDuration` | `number` | `1800000` | Max session length in milliseconds (default: 30 minutes) |
| `collectGeoLocation` | `boolean` | `true` | Collect IP-derived country/region/city |
| `captureAttribution` | `boolean` | `true` | Capture UTM params, referrer, and entry URL on session start |
| `ignoreBots` | `boolean` | `true` | Suppress recording for detected bots and webdrivers |
| `recordAutomation` | `boolean` | `false` | Allow recording of Playwright/Puppeteer/Selenium sessions |
| `autoTrackRoutes` | `boolean` | `true` | Automatically track route changes via History API |
| `routeName` | `(location: Location) => string` | — | Custom function to derive the screen name from `window.location` |
| `autoTrackNetwork` | `boolean` | `true` | Intercept and log fetch/XHR requests |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | URLs to exclude from network tracking |
| `networkCaptureSizes` | `boolean` | `false` | Include request/response body sizes in network logs |
| `trackConsoleLogs` | `boolean` | `false` | Capture `console.log/warn/error` output |
| `trackLongTasks` | `boolean` | `true` | Detect and log long tasks (JS thread blocks > 50ms) |
| `trackResourceErrors` | `boolean` | `true` | Capture failed resource loads (images, scripts, stylesheets) |
| `maskAllInputs` | `boolean` | `true` | Mask all text input values in replays |
| `blockClass` | `string \| RegExp` | `'rr-block'` | CSS class to fully block an element from replay |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | CSS selector to fully block elements from replay |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | CSS class to ignore interaction events on an element |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | CSS selector to ignore interaction events |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | CSS class to mask text content in replay |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | CSS selector to mask text content |
| `maskInputFn` | `(value, element) => string` | — | Custom function to transform input values before capture |
| `maskTextFn` | `(text, element) => string` | — | Custom function to transform text content before capture |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | Custom function to decide per-page-load whether to record |
| `beforeSendEvent` | `(event) => event \| null` | — | Filter or modify events before they are queued. Return `null` to drop |
| `beforeSendNetwork` | `(request) => request \| null` | — | Filter or modify network entries before they are queued. Return `null` to drop |
| `onAuthError` | `(error) => void` | — | Called when the SDK fails to authenticate with the backend |

## Stopping Recording

Call `stop()` to end the session, flush any pending events, and clean up all SDK listeners:

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()` is safe to call multiple times. After stopping, call `start()` again to begin a new session.

## Session ID

Access the current session ID to correlate Rejourney sessions with your own logs or support tools:

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

Returns `null` if no session is active.

## Status Helpers

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```
