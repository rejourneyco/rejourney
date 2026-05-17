/**
 * Unified AI Integration Prompts
 *
 * This file contains all AI prompts used throughout the application.
 * All copy buttons should reference these constants to ensure consistency.
 */

export const AI_INTEGRATION_PROMPT = `FIRST: Detect whether this project is a Web app, a React Native app, or a Swift (native iOS) app by checking imports, dependencies, and file types. Then follow ONLY the matching section below.

==========================================================
IF WEB — follow this section:
==========================================================

Integrate Rejourney session replay into this browser/web app based on the official documentation below.

INSTALLATION:
npm install @rejourneyco/browser

SETUP (add to the app entry point - main.tsx, main.jsx, app/layout.tsx, _app.tsx, or equivalent):
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('PUBLIC_KEY_HERE'); // initializes SDK and fetches remote config
await Rejourney.start(); // starts the session and recording

FRAMEWORK INTEGRATIONS:
Use the dedicated entry point if this project uses a supported framework:

React:
import { RejourneyProvider, useRejourney } from '@rejourneyco/browser/react';
<RejourneyProvider publicKey="PUBLIC_KEY_HERE" startOnMount>
  <App />
</RejourneyProvider>

Next.js:
import { RejourneyNext } from '@rejourneyco/browser/next';
<RejourneyNext publicKey="PUBLIC_KEY_HERE" />

Also check for Vue, Nuxt, SvelteKit, Remix, Gatsby, Astro, and Angular integrations if the app uses those frameworks.

ROUTE TRACKING:
- If using a framework integration, prefer its built-in route tracking.
- If using the vanilla browser API in a single-page app, call trackRoute after navigation changes:
import { Rejourney } from '@rejourneyco/browser';
Rejourney.trackRoute(window.location.pathname);

USER IDENTITY (Hook this up immediately using a non-PII ID like a UUID):
import { Rejourney } from '@rejourneyco/browser';
// After login:
Rejourney.setUserIdentity('user_abc123');
// On logout:
Rejourney.clearUserIdentity();

CUSTOM EVENTS — Track actions that happened (timestamped, can occur multiple times per session):

API: Rejourney.logEvent(name: string, properties?: Record<string, unknown>)

// Simple event (name only)
Rejourney.logEvent('signup_completed');

// Event with properties — attach context to each occurrence
Rejourney.logEvent('button_clicked', { buttonName: 'signup', page: 'pricing' });
Rejourney.logEvent('checkout_completed', { plan: 'pro', amount: 29.99, currency: 'USD' });
Rejourney.logEvent('onboarding_step', { step: 3, stepName: 'profile_setup', skipped: false });
Rejourney.logEvent('feature_used', { feature: 'dashboard_filter', enabled: true });
Rejourney.logEvent('api_error_seen', { endpoint: '/api/checkout', status: 500 });

Rules for events:
- Use snake_case for event names (e.g. 'button_clicked' not 'Button Clicked')
- Property values should be simple types: strings, numbers, booleans (no nested objects)
- Focus on actions that matter for debugging or analytics — don't log every click
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
- Use for traits: plan, role, team, A/B variant, locale, browser cohort, etc.
- NOT for actions — use logEvent for those
- Capped at 100 properties per session
- Setting the same key again overwrites the previous value

WHEN TO USE EVENTS VS METADATA:
- "User purchased a plan" → logEvent('checkout_completed', { plan: 'pro' })
- "User is on the pro plan" → setMetadata('plan', 'pro')
- "User clicked signup" → logEvent('button_clicked', { buttonName: 'signup' })
- "User is an admin" → setMetadata('role', 'admin')
Rule of thumb: If it describes SOMETHING THAT HAPPENED, use logEvent. If it describes WHO THE USER IS, use setMetadata.

PRIVACY CONTROLS:
- Do not send PII (emails, names, passwords) via logEvent or setMetadata.
- Mask sensitive DOM areas using the browser SDK's masking utilities or documented privacy attributes/classes if present in the app.
- Gate Rejourney.start() behind consent if this product requires explicit analytics/session replay consent.

GOOD PRACTICES:
- Wrap SDK calls in try-catch for safety
- Never track PII via logEvent or setMetadata
- Use internal IDs or UUIDs for setUserIdentity
- Initialize once near the app root, not inside frequently re-rendered components

IMPORTANT:
- Replace PUBLIC_KEY_HERE with the actual key from the Rejourney dashboard. Not a secret.
- Recording starts after Rejourney.start().
- Remind the user to put their project key in the init/provider function.
- Remind the user it is up to them to ensure privacy and consent beyond this simple integration.
- Remind the user they must add their domain to allowed domains in project settings if not done via project creation already.

POST-INTEGRATION STEPS:
Once the integration is successfully implemented:
1. Inform the user that the Rejourney Web integration is now complete and active.
2. Proactively ask the user if they would like to enrich their session data with custom events and metadata.
3. Analyze the user's code and suggest 3-5 specific examples of:
   - Events with properties that would be valuable to track (e.g., 'checkout_completed' with { total: amount, items: count })
   - Metadata that would help filter sessions (e.g., subscription_tier, user_role, app_theme)
   Base your suggestions on the actual business logic you see in the user's code.

==========================================================
IF REACT NATIVE — follow this section:
==========================================================

Integrate Rejourney session replay into this React Native app based on the official documentation below.

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
   Base your suggestions on the actual business logic you see in the user's code.

==========================================================
IF SWIFT (native iOS) — follow this section:
==========================================================

Integrate Rejourney session replay into this native Swift iOS app based on the official documentation below.

INSTALLATION:
Add the Rejourney Swift package in Xcode via File → Add Package Dependencies and enter:
  https://github.com/rejourneyco/rejourney
Or add to Package.swift:
  .package(url: "https://github.com/rejourneyco/rejourney", from: "0.2.0")
Requires iOS 15.1 or later.

SETUP — add to your @main App struct (SwiftUI):
import SwiftUI
import Rejourney

@main
struct MyApp: App {
    @MainActor
    init() {
        Rejourney.configure(publicKey: "PUBLIC_KEY_HERE")
        Task { await Rejourney.start() }
    }
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

If using UIApplicationDelegate, call configure in application(_:didFinishLaunchingWithOptions:):
import UIKit
import Rejourney

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    @MainActor
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        Rejourney.configure(publicKey: "PUBLIC_KEY_HERE")
        Task { await Rejourney.start() }
        return true
    }
}

SCREEN TRACKING RULES (implement the appropriate one):
1. FOR SWIFTUI — call trackScreen in .onAppear on each view:
   struct MyView: View {
       var body: some View {
           List { /* ... */ }
               .onAppear { Rejourney.trackScreen("Screen Name") }
       }
   }
2. FOR UIKIT — call trackScreen inside viewDidAppear:
   override func viewDidAppear(_ animated: Bool) {
       super.viewDidAppear(animated)
       Rejourney.trackScreen("Screen Name")
   }
3. FOR NAVIGATIONSTACK — observe the path and track on change:
   @State private var path = NavigationPath()
   NavigationStack(path: $path) { ContentView() }
       .onChange(of: path) { _ in Rejourney.trackScreen(currentScreenName(from: path)) }

USER IDENTITY (hook this up immediately using a non-PII ID like a UUID):
import Rejourney
// After login:
Rejourney.identify("user_abc123")
// On logout:
Rejourney.clearIdentity()

CUSTOM EVENTS — track actions that happened (timestamped, can occur multiple times per session):

API: Rejourney.logEvent(_ name: String, properties: [String: RejourneyMetadataValue] = [:])

// Simple event (name only)
Rejourney.logEvent("signup_completed")

// Event with properties — attach context to each occurrence
Rejourney.logEvent("button_tapped", properties: ["buttonName": "signup", "screen": "onboarding"])
Rejourney.logEvent("purchase_completed", properties: ["plan": "pro", "amount": 29.99, "currency": "USD"])
Rejourney.logEvent("onboarding_step", properties: ["step": 3, "stepName": "profile_setup", "skipped": false])
Rejourney.logEvent("feature_used", properties: ["feature": "dark_mode", "enabled": true])
Rejourney.logEvent("payment_failed", properties: ["errorCode": "card_declined", "retryCount": 2])

RejourneyMetadataValue accepts Swift literals directly — String, Double, Int, and Bool. No wrapping needed.

Rules for events:
- Use snake_case for event names (e.g. 'button_tapped' not 'Button Tapped')
- Property values should be simple types: strings, numbers, booleans (no nested objects)
- Focus on actions that matter for debugging or analytics — don't log every tap
- Events appear as markers on the replay timeline AND are filterable in the session archive
- You can filter by event name and event count

PRIVACY MASKING (for sensitive UIKit views):
import UIKit
import Rejourney
// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)
// Remove masking if needed
Rejourney.unmask(balanceLabel)
For SwiftUI views, get the underlying UIView via a UIViewRepresentable wrapper or introspect.

STOPPING RECORDING (e.g. on consent withdrawal):
func onUserOptedOut() {
    Task { @MainActor in
        await Rejourney.stop()
        Rejourney.clearIdentity()
    }
}

GOOD PRACTICES:
- Never track PII (emails, names, passwords) via logEvent
- Use internal IDs or UUIDs for identify()
- Call configure() before start() — options cannot be changed after start() is called

IMPORTANT:
- Replace PUBLIC_KEY_HERE with the actual key from the Rejourney dashboard. Not a secret.
- Recording starts as soon as start() resolves.
- Remind the user to put their project key in the configure call.
- Remind the user it is up to them to ensure privacy and consent beyond this simple integration.

POST-INTEGRATION STEPS:
Once the integration is successfully implemented:
1. Inform the user that the Rejourney integration is now complete and active.
2. Proactively ask the user if they would like to enrich their session data with custom events.
3. Analyze the user's code and suggest 3-5 specific examples of:
   - Events with properties that would be valuable to track (e.g., 'checkout_completed' with properties: ["total": amount, "items": count])
   Base your suggestions on the actual business logic you see in the user's code.`;

type ProjectForPrompt = {
  publicKey?: string;
  platforms?: string[];
  bundleId?: string;
  packageName?: string;
} | null;

export function buildProjectAIIntegrationPrompt(project: ProjectForPrompt): string {
  const key = project?.publicKey ?? 'YOUR_PUBLIC_KEY';
  return AI_INTEGRATION_PROMPT.replace(/PUBLIC_KEY_HERE/g, key);
}
