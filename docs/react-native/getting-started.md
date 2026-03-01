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

## Custom Events & Metadata

You can track custom events and assign metadata to sessions to filter and segment them later in the dashboard.

```javascript
// Set a single metadata property
Rejourney.setMetadata('plan', 'premium');

// Set multiple metadata properties
Rejourney.setMetadata({
  role: 'admin',
  segment: 'enterprise'
});
```

## Privacy Controls

Text inputs and camera views are automatically masked. To manually hide additional sensitive UI, wrap components in the `Mask` component:

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

Masked content appears as a solid rectangle in replays and is never captured at the source.
