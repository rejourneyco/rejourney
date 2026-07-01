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
Rejourney.logEvent('purchase_completed', {
  transactionId: order.id,
  plan: 'pro',
  amount: 29.99,
  currency: 'USD',
  paymentProvider: 'stripe',
  isRenewal: false
});
Rejourney.logEvent('onboarding_step', { step: 3, stepName: 'profile_setup', skipped: false });
Rejourney.logEvent('feature_used', { feature: 'dashboard_filter', enabled: true });
Rejourney.logEvent('api_error_seen', { endpoint: '/api/checkout', status: 500 });

Rules for events:
- Use snake_case for event names (e.g. 'button_clicked' not 'Button Clicked')
- Property values should be simple types: strings, numbers, booleans (no nested objects)
- Focus on actions that matter for debugging or analytics — don't log every click
- Events appear as markers on the replay timeline AND are filterable in the session archive
- You can filter by event name, by property key, by property key+value, and by event count

COMMON CUSTOM EVENT NAMES:
Use these names when the app has the matching action:
- Account and onboarding: signup_completed, login, onboarding_completed
- Browse and checkout: product_view, add_to_cart, checkout_started
- Revenue and subscriptions: purchase_completed, paywall_view, plan_selected, trial_started, subscription_started, subscription_cancelled, refund_processed, payment_failed
- Ads: ad_viewed, ad_clicked, native_ad_viewed, native_ad_clicked, banner_ad_viewed, banner_ad_clicked, interstitial_ad_viewed, interstitial_ad_clicked, rewarded_ad_viewed, rewarded_ad_clicked, video_ad_viewed, video_ad_clicked, sponsored_ad_viewed, sponsored_ad_clicked
- Product choice and hesitation: variant_selected, size_selected, color_selected, quantity_changed, reviews_viewed, shipping_info_viewed, return_policy_viewed, wishlist_add, share_clicked
- Discounts, upgrades, and churn: coupon_use, discount_offer_viewed, discount_offer_accepted, upgrade_clicked, upgrade_completed, cancel_flow_started, cancel_confirmed
- Engagement: feature_used

REVENUE TRACKING FOR THE GENERAL REVENUE CHART:
- If this app has checkout, subscriptions, paid plans, credits, tips, or in-app purchases, instrument a dedicated money-collected event named 'purchase_completed'. Do not map device/setup/screen events such as 'device_info', 'app_initialized', 'page_view', or 'screen_view' as revenue.
- Fire the revenue event only after payment is confirmed by the backend/payment provider when possible. If client and backend both track it, use the same stable transactionId/orderId so retries do not duplicate revenue.
- Required revenue properties: transactionId, amount, currency. Strongly recommended properties: orderId, productId/sku, planId, priceId, subscriptionId, paymentProvider, platform, country/region, couponCode, isTrialConversion, isRenewal, entitlement.
- Use purchase_completed only when money is actually collected. Log the other events above as their own events when those actions happen.

Web revenue example:
Rejourney.setUserIdentity(currentUser.id);
Rejourney.logEvent("purchase_completed", {
  amount: 29.99,
  currency: "USD",
  transactionId: order.id,
  orderId: order.id,
  productId: item.productId,
  planId: subscription?.planId,
  priceId: subscription?.priceId,
  subscriptionId: subscription?.id,
  paymentProvider: "your_provider",
  platform: "web",
  couponCode: order.couponCode,
  isTrialConversion: Boolean(subscription?.convertedFromTrial),
  isRenewal: Boolean(order.isRenewal)
});

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
- "User purchased a plan" → logEvent('purchase_completed', { transactionId: order.id, amount: 29.99, currency: 'USD', plan: 'pro' })
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
Rejourney.logEvent('purchase_completed', {
  transactionId: order.id,
  plan: 'pro',
  amount: 29.99,
  currency: 'USD',
  paymentProvider: 'stripe',
  isRenewal: false
});
Rejourney.logEvent('onboarding_step', { step: 3, stepName: 'profile_setup', skipped: false });
Rejourney.logEvent('feature_used', { feature: 'dark_mode', enabled: true });
Rejourney.logEvent('payment_failed', { errorCode: 'card_declined', retryCount: 2 });

Rules for events:
- Use snake_case for event names (e.g. 'button_clicked' not 'Button Clicked')
- Property values should be simple types: strings, numbers, booleans (no nested objects)
- Focus on actions that matter for debugging or analytics — don't log every tap
- Events appear as markers on the replay timeline AND are filterable in the session archive
- You can filter by event name, by property key, by property key+value, and by event count

COMMON CUSTOM EVENT NAMES:
Use these names when the app has the matching action:
- Account and onboarding: signup_completed, login, onboarding_completed
- Browse and checkout: product_view, add_to_cart, checkout_started
- Revenue and subscriptions: purchase_completed, paywall_view, plan_selected, trial_started, subscription_started, subscription_cancelled, refund_processed, payment_failed
- Ads: ad_viewed, ad_clicked, native_ad_viewed, native_ad_clicked, banner_ad_viewed, banner_ad_clicked, interstitial_ad_viewed, interstitial_ad_clicked, rewarded_ad_viewed, rewarded_ad_clicked, video_ad_viewed, video_ad_clicked, sponsored_ad_viewed, sponsored_ad_clicked
- Product choice and hesitation: variant_selected, size_selected, color_selected, quantity_changed, reviews_viewed, shipping_info_viewed, return_policy_viewed, wishlist_add, share_clicked
- Discounts, upgrades, and churn: coupon_use, discount_offer_viewed, discount_offer_accepted, upgrade_clicked, upgrade_completed, cancel_flow_started, cancel_confirmed
- Engagement: feature_used

REVENUE TRACKING FOR THE GENERAL REVENUE CHART:
- If this app has checkout, subscriptions, paid plans, credits, tips, or in-app purchases, instrument a dedicated money-collected event named 'purchase_completed'. Do not map device/setup/screen events such as 'device_info', 'app_initialized', or 'screen_view' as revenue.
- Fire the revenue event only after payment is confirmed by the backend/payment provider when possible. If client and backend both track it, use the same stable transactionId/orderId so retries do not duplicate revenue.
- Required revenue properties: transactionId, amount, currency. Strongly recommended properties: orderId, productId/sku, planId, priceId, subscriptionId, paymentProvider, platform, country/region, couponCode, isTrialConversion, isRenewal, entitlement.
- Use purchase_completed only when money is actually collected. Log the other events above as their own events when those actions happen.

React Native revenue example:
Rejourney.setUserIdentity(currentUser.id);
Rejourney.logEvent("purchase_completed", {
  amount: 29.99,
  currency: "USD",
  transactionId: order.id,
  orderId: order.id,
  productId: item.productId,
  planId: subscription?.planId,
  priceId: subscription?.priceId,
  subscriptionId: subscription?.id,
  paymentProvider: "your_provider",
  platform: Platform.OS,
  couponCode: order.couponCode,
  isTrialConversion: Boolean(subscription?.convertedFromTrial),
  isRenewal: Boolean(order.isRenewal)
});

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
- "User purchased a plan" → logEvent('purchase_completed', { transactionId: order.id, amount: 29.99, currency: 'USD', plan: 'pro' })
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
  .package(url: "https://github.com/rejourneyco/rejourney", from: "0.3.0")
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
Rejourney.logEvent("purchase_completed", properties: [
    "transactionId": order.id,
    "plan": "pro",
    "amount": 29.99,
    "currency": "USD",
    "paymentProvider": "stripe",
    "isRenewal": false
])
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

COMMON CUSTOM EVENT NAMES:
Use these names when the app has the matching action:
- Account and onboarding: signup_completed, login, onboarding_completed
- Browse and checkout: product_view, add_to_cart, checkout_started
- Revenue and subscriptions: purchase_completed, paywall_view, plan_selected, trial_started, subscription_started, subscription_cancelled, refund_processed, payment_failed
- Ads: ad_viewed, ad_clicked, native_ad_viewed, native_ad_clicked, banner_ad_viewed, banner_ad_clicked, interstitial_ad_viewed, interstitial_ad_clicked, rewarded_ad_viewed, rewarded_ad_clicked, video_ad_viewed, video_ad_clicked, sponsored_ad_viewed, sponsored_ad_clicked
- Product choice and hesitation: variant_selected, size_selected, color_selected, quantity_changed, reviews_viewed, shipping_info_viewed, return_policy_viewed, wishlist_add, share_clicked
- Discounts, upgrades, and churn: coupon_use, discount_offer_viewed, discount_offer_accepted, upgrade_clicked, upgrade_completed, cancel_flow_started, cancel_confirmed
- Engagement: feature_used

REVENUE TRACKING FOR THE GENERAL REVENUE CHART:
- If this app has checkout, subscriptions, paid plans, credits, tips, or in-app purchases, instrument a dedicated money-collected event named "purchase_completed". Do not map device/setup/screen events such as "device_info", "app_initialized", or "screen_view" as revenue.
- Fire the revenue event only after payment is confirmed by the backend/payment provider when possible. If client and backend both track it, use the same stable transactionId/orderId so retries do not duplicate revenue.
- Required revenue properties: transactionId, amount, currency. Strongly recommended properties: orderId, productId/sku, planId, priceId, subscriptionId, paymentProvider, platform, country/region, couponCode, isTrialConversion, isRenewal, entitlement.
- Use purchase_completed only when money is actually collected. Log the other events above as their own events when those actions happen.

Swift revenue example:
Rejourney.identify(currentUser.id)
Rejourney.logEvent("purchase_completed", properties: [
    "amount": 29.99,
    "currency": "USD",
    "transactionId": order.id,
    "orderId": order.id,
    "productId": item.productId,
    "planId": subscription?.planId ?? "",
    "priceId": subscription?.priceId ?? "",
    "subscriptionId": subscription?.id ?? "",
    "paymentProvider": "your_provider",
    "platform": "ios",
    "couponCode": order.couponCode ?? "",
    "isTrialConversion": subscription?.convertedFromTrial ?? false,
    "isRenewal": order.isRenewal
])

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

export const EXAMPLE_PROJECT_KEY = 'rj_example_public_key';

export const SELF_HOSTED_DEPLOYMENT_PROMPT = `You are my deployment copilot for Rejourney self-hosted. Use the official self-hosted Docker Compose guide as the source of truth.

Deployment goal:
- Run Rejourney on one Linux server with docker-compose.selfhosted.yml.
- Use scripts/selfhosted/deploy.sh for install, update, status, logs, stop, reset, and bootstrap.
- Default to built-in MinIO for object storage.
- Offer external S3-compatible storage only when I explicitly choose it.
- Keep the stack single-node and Docker Compose based. Do not turn this into Kubernetes, Helm, Terraform, or a multi-server design unless I ask.
- Keep data safe. Never suggest wiping volumes, deleting .env.selfhosted, rotating secrets, or running reset unless I explicitly confirm that data loss is acceptable.

First ask me for any missing values:
1. Base domain, for example example.com.
2. Public server IP address.
3. Server OS and whether docker compose version works.
4. Let's Encrypt email.
5. Storage choice: built-in MinIO or external S3-compatible storage.
6. If external S3: endpoint, bucket, region, access key, secret key, and optional public endpoint.
7. Whether this is a fresh install, update, restore, or broken install.
8. Which SDKs I need to configure: React Native, Swift iOS, Web SDK, or all three.

Then give me an interactive runbook with checkboxes:
- DNS records for dashboard, www redirect, API, and ingest hostnames.
- Server readiness checks for Docker, Docker Compose, git, openssl, ports 80 and 443, disk, CPU, and RAM.
- Storage choice explanation: built-in MinIO for simple single-server installs; external S3 for teams already operating object storage.
- Exact commands to clone Rejourney, enter the repo root, and run ./scripts/selfhosted/deploy.sh install.
- What the installer will ask and what each answer should look like.
- A reminder to immediately back up .env.selfhosted securely and never commit it.
- Verification commands after install.
- SDK configuration examples for React Native, Swift iOS, and Web SDK using https://api.<domain>.
- A first recording test plan.
- Backup and recovery steps.
- A troubleshooting decision tree for the most common failures.

Required DNS shape:
- <base-domain> points to the server and serves the dashboard.
- www.<base-domain> points to the server and redirects to the dashboard.
- api.<base-domain> points to the server and serves the API and SDK config.
- ingest.<base-domain> points to the server and serves the upload relay.
- Let's Encrypt will not issue certificates until DNS points at the server and ports 80/443 are reachable.

Install commands to include:
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
./scripts/selfhosted/deploy.sh install

Verification commands to include:
./scripts/selfhosted/deploy.sh status
curl -fsS https://api.<base-domain>/health
curl -fsS https://api.<base-domain>/health/ingest
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker

Successful status should mean:
- api is running and healthy.
- ingest-upload is running and healthy.
- web is running.
- postgres and redis are healthy.
- minio is running if built-in MinIO was selected.
- worker services are running.

SDK examples to include:

React Native:
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('rj_your_public_key', {
  apiUrl: 'https://api.<base-domain>',
});

startRejourney();

Swift iOS:
import SwiftUI
import Rejourney

@main
struct MyApp: App {
    @MainActor
    init() {
        Rejourney.configure(
            publicKey: "rj_your_public_key",
            options: RejourneyOptions(
                apiURL: URL(string: "https://api.<base-domain>")!
            )
        )
        Task { await Rejourney.start() }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

Web SDK:
import { initRejourney, startRejourney } from '@rejourneyco/browser';

await initRejourney('rj_your_public_key', {
  apiUrl: 'https://api.<base-domain>',
});

await startRejourney();

Web SDK requirements:
- Add the browser app origin to the project Web allowed domains.
- Use host plus port for local/staging apps, for example localhost:3100.
- If config returns 403, check Web allowed domains first.
- PUBLIC_API_URL must be the public API host browsers can reach.
- PUBLIC_INGEST_URL must be the public ingest host browsers can reach.

Storage rules:
- Built-in MinIO is the default and recommended for a simple VPS.
- Built-in MinIO is not exposed publicly by default.
- Devices and browsers upload to the Rejourney ingest relay, not directly to MinIO/S3.
- For external S3-compatible storage, the important path is ingest-upload container -> S3 endpoint.
- If S3 works from a laptop but not Rejourney, inspect ingest-upload logs and test from the server/Docker network.
- After changing domain or storage values in .env.selfhosted, run ./scripts/selfhosted/deploy.sh update.

Bootstrap and update rules:
- The bootstrap container applies schema, seed data, and storage endpoint config.
- On an empty database, bootstrap initializes the schema.
- On an initialized database, bootstrap applies only pending migrations.
- If the database already has tables but migration metadata is missing, stop and ask for recovery context instead of guessing.
- update pulls newer images, rebuilds bootstrap from the checkout, restarts services, and reruns bootstrap without wiping Postgres or object storage.

Recovery and safety rules:
- .env.selfhosted contains deployment secrets, including STORAGE_ENCRYPTION_KEY.
- If .env.selfhosted is missing but Docker volumes exist, do not suggest reset first. Tell me to find or restore the original .env.selfhosted.
- If database authentication fails before bootstrap, explain that stored Postgres credentials may not match the current .env.selfhosted.
- Use reset only for a fully fresh install when I confirm existing data can be deleted.
- Before recovery, ask whether I have Postgres backup, .env.selfhosted, and MinIO backup if using built-in MinIO.
- For backups, include ./scripts/selfhosted/backup.sh and ./scripts/selfhosted/backup.sh --full.

Troubleshooting hints to include:
- Install/bootstrap failure: inspect bootstrap logs and verify DATABASE_URL, STORAGE_ENCRYPTION_KEY, S3 values, and ARM64 platform behavior.
- Replay empty but sessions counted: inspect ingest-upload, ingest-worker, and api logs; look for artifact.upload_received, artifact.upload_stored, artifact.retry, artifact.failed, session.reconciled, and session.finalized.
- Dashboard loads but API fails: check DNS, ports 80/443, Traefik logs, and API logs.
- TLS failure: verify all four hostnames resolve to the server before rerunning update.
- Built-in MinIO artifact failures: inspect minio and minio-setup logs.
- ARM64 servers: mention that deploy.sh sets DOCKER_DEFAULT_PLATFORM=linux/amd64 when needed if I have not set it myself.

Style:
- Be friendly and practical.
- Give exact commands I can run.
- Explain what success looks like after each step.
- When a step can destroy data, pause and ask for confirmation.
- Prefer short checklists and clear next actions over long theory.`;

type ProjectForPrompt = {
  name?: string;
  teamName?: string;
  publicKey?: string;
  platforms?: string[];
  bundleId?: string;
  packageName?: string;
  webDomain?: string | null;
  webAllowedDomains?: string[] | null;
} | null;

function formatPromptPlatform(platform: string): string {
  if (platform === 'ios') return 'iOS';
  if (platform === 'android') return 'Android';
  if (platform === 'web') return 'Web';
  if (platform === 'react-native') return 'React Native';
  return platform;
}

function buildProjectContextBlock(project: ProjectForPrompt, key: string): string {
  const contextLines = [
    'PROJECT CONTEXT FROM REJOURNEY DASHBOARD:',
    project?.teamName ? `- Team: ${project.teamName}` : null,
    project?.name ? `- Project: ${project.name}` : null,
    `- Public key: ${key}`,
    project?.platforms?.length ? `- Selected platforms: ${project.platforms.map(formatPromptPlatform).join(', ')}` : null,
    project?.webAllowedDomains?.length
      ? `- Web allowed domains: ${project.webAllowedDomains.join(', ')}`
      : project?.webDomain
        ? `- Web allowed domain: ${project.webDomain}`
        : null,
    project?.bundleId ? `- iOS bundle ID: ${project.bundleId}` : null,
    project?.packageName ? `- Android package name: ${project.packageName}` : null,
    '- Before shipping, verify the detected app matches these domains, bundle IDs, and package names. If the repository uses different production identifiers, tell me exactly what to update in Rejourney project settings.',
  ].filter((line): line is string => line !== null);

  return contextLines.join('\n');
}

export function buildProjectAIIntegrationPrompt(project: ProjectForPrompt): string {
  const key = project?.publicKey?.trim() || EXAMPLE_PROJECT_KEY;
  return [
    buildProjectContextBlock(project, key),
    '',
    AI_INTEGRATION_PROMPT.replace(/PUBLIC_KEY_HERE/g, key),
  ].join('\n');
}

export function buildSelfHostedAIDeploymentPrompt(): string {
  return SELF_HOSTED_DEPLOYMENT_PROMPT;
}
