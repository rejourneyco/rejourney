# @rejourneyco/react-native

Lightweight session replay and observability SDK for React Native. Pixel-perfect video capture with real-time incident detection.

## Installation

```bash
npm install @rejourneyco/react-native
```

## Quick Start

```typescript
import { Rejourney } from '@rejourneyco/react-native';

// Initialize with your public key
Rejourney.init('rj_your_public_key');

// Start recording after obtaining user consent
Rejourney.start();
```

## Pause and resume (Beta, React Native 1.5.1+)

Pause Rejourney around a foreground camera, AR, or graphics-heavy screen without
ending the current session:

```typescript
const paused = await Rejourney.pause();
// Present the high-cost experience.
const resumed = await Rejourney.resume();
```

The standalone aliases `pauseRejourney()` and `resumeRejourney()` are equivalent.
Both calls are idempotent. Pause flushes pending work, emits `sdk_paused`, then
stops screenshots, hierarchy and interaction capture, live hang sampling, JS
tracking hooks, network instrumentation, and ordinary telemetry intake. Resume
continues the same foreground session and emits `sdk_resumed` with the matching
`pauseId` and `gapDurationMs`, making the gap explicit in replay.

Fatal-process hooks remain installed during a pause so crashes can still be
recovered without periodic capture work. A background interval longer than the
intentional 60-second lifecycle boundary still creates a replacement session;
that replacement stays paused until resume. Resume returns `false` while the app
is backgrounded. This Beta API requires 1.5.1 or newer and needs no Android
manifest or iOS Info.plist additions.

## Navigation Tracking

Rejourney automatically tracks screen changes to provide context for your session replays.

### Expo Router (Automatic)
If you use **Expo Router**, simply add this import at your root layout (`app/_layout.tsx`):
```ts
import '@rejourneyco/react-native/expo-router';
```

### React Navigation
If you are using **React Navigation** (`@react-navigation/native`), use the `useNavigationTracking` hook in your root `NavigationContainer`:
```tsx
import { Rejourney } from '@rejourneyco/react-native';
import { NavigationContainer } from '@react-navigation/native';

const navigationTracking = Rejourney.useNavigationTracking();
return <NavigationContainer {...navigationTracking}>{/*...*/}</NavigationContainer>;
```

### Custom Screen Names
If you want to manually specify screen names or use a different library:

#### For Expo Router users:
Disable automatic tracking in your initialization:
```ts
Rejourney.init('rj_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### Manual tracking call:
Notify Rejourney of screen changes using `trackScreen`:
```ts
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.trackScreen('Custom Screen Name');
```

> [!NOTE]
> `expo-router` and `@react-navigation/native` are **optional peer dependencies**. Install them only if you use the related navigation helpers. The core SDK keeps those integrations out of the main bundle so apps that do not use them do not fail Metro resolution at build time.

## Custom Events & Metadata

Track user actions and attach session-level context for filtering and segmentation in the dashboard.

```typescript
import { Rejourney } from '@rejourneyco/react-native';

// Log custom events with optional properties
Rejourney.logEvent('signup_completed');
Rejourney.logEvent('purchase_completed', {
  plan: 'pro',
  amount: 29.99
});

// Attach session-level metadata (key-value context)
Rejourney.setMetadata('plan', 'premium');
Rejourney.setMetadata({
  role: 'admin',
  ab_variant: 'checkout_v2'
});
```

**Events** = things that happened (actions, timestamped, can occur multiple times)
**Metadata** = who the user is / what state they're in (session-level, one value per key)

## Network Capture

Network capture is enabled by default. Rejourney SDK calls to `/api/sdk/config`, `/api/ingest`, and `/upload/artifacts` are always excluded from monitoring; use `networkIgnoreUrls` or `autoTrackNetwork: false` for your own app traffic.

With `collectDeviceInfo` enabled, the SDK also sends coarse, permissionless
battery, thermal, memory-pressure/headroom, UI environment, orientation, and
display-refresh context. It uses lifecycle reads and OS callbacks only (no
polling), needs no Android manifest permission or iOS usage-description key,
and is omitted when `collectDeviceInfo` is disabled.

## API Reference & Compatibility

Rejourney supports both a standardized `Rejourney.` namespace and standalone function exports (AKA calls). Both are fully supported.

| Standardized Method | Standalone Alias (AKA) |
| --- | --- |
| `Rejourney.init()` | `initRejourney()` |
| `Rejourney.start()` | `startRejourney()` |
| `Rejourney.stop()` | `stopRejourney()` |
| `Rejourney.pause()` **Beta** | `pauseRejourney()` |
| `Rejourney.resume()` **Beta** | `resumeRejourney()` |
| `Rejourney.useNavigationTracking()` | `useNavigationTracking()` |

> [!TIP]
> We recommend using the `Rejourney.` prefix for better discoverability and a cleaner import surface.

## Documentation

Full integration guides and API reference: https://rejourney.co/docs/reactnative/overview

## License

Licensed under Apache 2.0
