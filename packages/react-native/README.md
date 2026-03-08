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
Rejourney.init('pk_live_xxxxxxxxxxxx');

// Start recording after obtaining user consent
Rejourney.start();
```

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
Rejourney.init('pk_live_xxxxxxxxxxxx', {
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
> `expo-router` is an **optional peer dependency**. The SDK is carefully architectural to avoid requiring `expo-router` in the main bundle. This prevents Metro from attempting to resolve it at build time in projects where it's not installed, which would otherwise cause a "Requiring unknown module" crash.

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

## API Reference & Compatibility

Rejourney supports both a standardized `Rejourney.` namespace and standalone function exports (AKA calls). Both are fully supported.

| Standardized Method | Standalone Alias (AKA) |
| --- | --- |
| `Rejourney.init()` | `initRejourney()` |
| `Rejourney.start()` | `startRejourney()` |
| `Rejourney.stop()` | `stopRejourney()` |
| `Rejourney.useNavigationTracking()` | `useNavigationTracking()` |

> [!TIP]
> We recommend using the `Rejourney.` prefix for better discoverability and a cleaner import surface.

## Documentation

Full integration guides and API reference: https://rejourney.co/docs/reactnative/overview

## License

Licensed under Apache 2.0
