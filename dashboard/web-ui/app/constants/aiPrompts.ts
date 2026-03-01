/**
 * Unified AI Integration Prompts
 * 
 * This file contains all AI prompts used throughout the application.
 * All copy buttons should reference these constants to ensure consistency.
 */

export const AI_INTEGRATION_PROMPT = `Integrate Rejourney session replay into this React Native app based on the official documentation below.

INSTALLATION:
npm install @rejourneyco/react-native

SETUP (add to app entry point - _layout.tsx or App.tsx usually):
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('PUBLIC_KEY_HERE'); //just creates init nothing starts
// Start recording 
Rejourney.start();

SCREEN TRACKING RULES (Implement the appropriate one):
1. FOR EXPO ROUTER: DO NOT add manual tracking. Screens are automatically tracked natively.
2. FOR REACT NAVIGATION: Use the tracking hook in your root NavigationContainer:
import { Rejourney } from '@rejourneyco/react-native';
const navigationTracking = Rejourney.useNavigationTracking();
<NavigationContainer {...navigationTracking}>
3. IF NONE ARE USED: You must implement manual screen tracking for screen changes:
import { Rejourney } from '@rejourneyco/react-native';
Rejourney.trackScreen('ScreenName');

USER IDENTITY (Hook this up immediately using a non-PII ID like a UUID):
import { Rejourney } from '@rejourneyco/react-native';

// On logout: Rejourney.clearUserIdentity();

CUSTOM EVENTS & METADATA (Please proactively add tracking for key user flows & settings):
// Add rich tracking for key steps like checkout, login, or role changes without sensitive info
import { Rejourney } from '@rejourneyco/react-native';
// Log custom events for important actions
Rejourney.logEvent('action_completed', { target: 'feature_x', count: 1 });
// Track non-sensitive metadata 
Rejourney.setMetadata('plan', 'premium');
Rejourney.setMetadata({ role: 'admin', segment: 'enterprise' });

PRIVACY MASKING (for sensitive data):
import { Mask } from '@rejourneyco/react-native';
<Mask>
  <Text>Sensitive content here</Text>
</Mask>

GOOD Practice:
- Try Catch For Saftey

IMPORTANT:
- Expo users must use development builds (npx expo run:ios or npx expo run:android), NOT Expo Go
- Replace PUBLIC_KEY_HERE with the actual key from the Rejourney dashboard. Not a secret.
- That's it! Recording starts automatically.
- Remind the user to put their project key in the initRejourney function.
- Remind the user it is up to them to ensure privacy and consent beyond this simple integration. 

A pod install is required for iOS to link native modules.

POST-INTEGRATION STEPS:
Once the integration is successfully implemented:
1. Inform the user that the Rejourney integration is now complete and active.
2. Proactively ask the user if they would like to enrich their session data by assigning custom metadata or logging custom events.
3. Suggest 3-5 specific examples of metadata (e.g., subscription_tier: 'gold') or events (e.g., 'checkout_completed') that would be valuable to track based on the specific business logic you see in the user's provided code.

RELEVANT API DOCS:
- Rejourney.setMetadata(keyOrProperties, value?): Use for traits like 'plan', 'role', 'team_id'.
- Rejourney.logEvent(name, properties?): Use for actions like 'signup_success', 'video_played'.
- Privacy: Always warn the user to never track PII (emails, names, passwords) via these methods.`;
