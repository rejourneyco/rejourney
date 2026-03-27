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

Rejourney.init('PUBLIC_KEY_HERE'); // initializes SDK, nothing starts yet
Rejourney.start(); // starts recording

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
// After login:
Rejourney.setUserIdentity('user_abc123');
// On logout:
Rejourney.clearUserIdentity();

CUSTOM EVENTS — Track actions that happened (timestamped, can occur multiple times per session):

API: Rejourney.logEvent(name: string, properties?: Record<string, unknown>)

// Simple event (name only)
Rejourney.logEvent('signup_completed');

// Event with properties — attach context to each occurrence
Rejourney.logEvent('button_clicked', { buttonName: 'signup', screen: 'onboarding' });
Rejourney.logEvent('purchase_completed', { plan: 'pro', amount: 29.99, currency: 'USD' });
Rejourney.logEvent('onboarding_step', { step: 3, stepName: 'profile_setup', skipped: false });
Rejourney.logEvent('feature_used', { feature: 'dark_mode', enabled: true });
Rejourney.logEvent('payment_failed', { errorCode: 'card_declined', retryCount: 2 });

Rules for events:
- Use snake_case for event names (e.g. 'button_clicked' not 'Button Clicked')
- Property values should be simple types: strings, numbers, booleans (no nested objects)
- Focus on actions that matter for debugging or analytics — don't log every tap
- Events appear as markers on the replay timeline AND are filterable in the session archive
- You can filter by event name, by property key, by property key+value, and by event count

METADATA — Describe who the user is / what state they're in (session-level, one value per key):

API: Rejourney.setMetadata(key: string, value: string | number | boolean)
API: Rejourney.setMetadata(properties: Record<string, string | number | boolean>)

// Single property
Rejourney.setMetadata('plan', 'premium');

// Multiple properties at once
Rejourney.setMetadata({
  role: 'admin',
  segment: 'enterprise',
  ab_variant: 'checkout_v2'
});

Rules for metadata:
- Use for traits: plan, role, team, A/B variant, locale, etc.
- NOT for actions — use logEvent for those
- Capped at 100 properties per session
- Setting the same key again overwrites the previous value

WHEN TO USE EVENTS VS METADATA:
- "User purchased a plan" → logEvent('purchase_completed', { plan: 'pro' })
- "User is on the pro plan" → setMetadata('plan', 'pro')
- "User clicked signup" → logEvent('button_clicked', { buttonName: 'signup' })
- "User is an admin" → setMetadata('role', 'admin')
Rule of thumb: If it describes SOMETHING THAT HAPPENED, use logEvent. If it describes WHO THE USER IS, use setMetadata.

PRIVACY MASKING (for sensitive data):
import { Mask } from '@rejourneyco/react-native';
<Mask>
  <Text>Sensitive content here</Text>
</Mask>

GOOD PRACTICES:
- Wrap SDK calls in try-catch for safety
- Never track PII (emails, names, passwords) via logEvent or setMetadata
- Use internal IDs or UUIDs for setUserIdentity

IMPORTANT:
- Expo users must use development builds (npx expo run:ios or npx expo run:android), NOT Expo Go
- Replace PUBLIC_KEY_HERE with the actual key from the Rejourney dashboard. Not a secret.
- A pod install is required for iOS to link native modules.
- Recording starts automatically after Rejourney.start().
- Remind the user to put their project key in the init function.
- Remind the user it is up to them to ensure privacy and consent beyond this simple integration.

POST-INTEGRATION STEPS:
Once the integration is successfully implemented:
1. Inform the user that the Rejourney integration is now complete and active.
2. Proactively ask the user if they would like to enrich their session data with custom events and metadata.
3. Analyze the user's code and suggest 3-5 specific examples of:
   - Events with properties that would be valuable to track (e.g., 'checkout_completed' with { total: amount, items: count })
   - Metadata that would help filter sessions (e.g., subscription_tier, user_role, app_theme)
   Base your suggestions on the actual business logic you see in the user's code.`;
