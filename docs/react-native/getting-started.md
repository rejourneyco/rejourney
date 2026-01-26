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
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key');
startRejourney();
```

Requires no provider wrapping. Recording starts immediately.

## Screen Tracking

> [!IMPORTANT]
> **Screen changes are tracked automatically if you use Expo Router. No additional code needed.**

For **React Navigation**, pass the tracking hook to your NavigationContainer:

```javascript
import { useNavigationTracking } from '@rejourneyco/react-native';
import { NavigationContainer } from '@react-navigation/native';

function App() {
  const navigationTracking = useNavigationTracking();

  return (
    <NavigationContainer {...navigationTracking}>
      {/* Your screens */}
    </NavigationContainer>
  );
}
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

## Privacy Controls

Text inputs and camera views are automatically masked. To manually hide additional sensitive UI, wrap components in the `Mask` component:

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

Masked content appears as a solid rectangle in replays and is never captured at the source.
