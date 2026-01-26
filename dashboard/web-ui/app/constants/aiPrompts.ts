/**
 * Unified AI Integration Prompts
 * 
 * This file contains all AI prompts used throughout the application.
 * All copy buttons should reference these constants to ensure consistency.
 */

export const AI_INTEGRATION_PROMPT = `Integrate Rejourney session replay into this React Native app.

INSTALLATION:
npm install @rejourneyco/react-native

SETUP (add to app entry point - _layout.tsx or App.tsx usually):
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('PUBLIC_KEY_HERE'); //just creates init nothing starts
// Start recording 
startRejourney();

FOR BARE REACT NATIVE APPS (not Expo, skip if EXPO):
Add screen tracking to NavigationContainer:
import { useNavigationTracking } from '@rejourneyco/react-native';
const navigationTracking = useNavigationTracking();
<NavigationContainer {...navigationTracking}>

USER IDENTITY (optional, after login):
import Rejourney from '@rejourneyco/react-native';
Rejourney.setUserIdentity('user_id');
// On logout: Rejourney.clearUserIdentity();

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
- Remind the user it is up to them to ensure privacy and consent beyond this simiple integration. 


Once done ask the user for their project key to put in.`;

