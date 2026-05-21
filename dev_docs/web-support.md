# Web Support Implementation Plan

Research checked: 2026-05-21

This document describes how to add website session replay and general web analytics to Rejourney while preserving the end-user functionality of the existing mobile SDKs. The main recommendation is to build a first-party `@rejourneyco/browser` package on top of rrweb, not to build our own DOM recorder.

The important difference from mobile is the capture model:

- Mobile replay is image based. The SDK captures rendered screenshots and uploads `screenshots` and `hierarchy` artifacts.
- Web replay should be DOM/event based. rrweb records the initial DOM, subsequent DOM mutations, input/mouse/scroll/media events, and optional assets/canvas/console data. The dashboard replays those events with rrweb's replayer.

That means web support is not just "add a package." It needs a web SDK, a new replay artifact kind, backend processing and availability rules, dashboard playback, web-specific privacy defaults, and framework integration helpers.

## Current Rejourney Behavior To Preserve

Local files reviewed:

- `packages/react-native/src/index.ts`
- `packages/react-native/src/types/index.ts`
- `packages/react-native/src/sdk/networkInterceptor.ts`
- `packages/react-native/src/sdk/autoTracking.ts`
- `packages/ios/Sources/Rejourney/Recording/ReplayOrchestrator.swift`
- `backend/src/routes/ingestUploads.ts`
- `backend/src/routes/ingestLifecycle.ts`
- `backend/src/services/ingestEventArtifactProcessor.ts`
- `backend/src/services/ingestReplayArtifactProcessor.ts`
- `backend/src/services/sessionReconciliation.ts`
- `backend/src/services/sessionPresentationState.ts`
- `dashboard/web-ui/app/shared/ui/core/ScreenshotReplayPlayer.tsx`
- `docs/react-native/getting-started.md`
- `dev_docs/ingest-session-recording-lifecycle.md`

The mobile SDK/product surface to keep:

| Capability | Mobile behavior today | Web equivalent |
|---|---|---|
| Initialize/start/stop | `Rejourney.init()`, `Rejourney.start()`, `Rejourney.stop()` | Same names in `@rejourneyco/browser`; no import side effects before `init`/`start` |
| Remote config | `/api/sdk/config` controls enabled, recording, sample rate, max duration, input masking | Reuse endpoint, add web-specific fields without breaking mobile |
| Sampling | Client and backend both guard sampled-out sessions | Same, plus domain abuse protection |
| Observe-only | Telemetry without visual screenshots | Telemetry without rrweb DOM capture |
| Replay | Screenshot artifacts make sessions replayable | rrweb artifact makes sessions replayable |
| Custom events | `logEvent(name, properties)` stored per session and filterable | Same API and dashboard filters |
| Metadata | `setMetadata()` via `$user_property` custom event into `sessions.metadata` | Same API and backend behavior |
| Identity | `setUserIdentity()` and anonymous device ID | Same, using first-party anonymous visitor ID |
| Screen tracking | Expo Router automatic, React Navigation helper, manual `trackScreen` | URL/router tracking, framework adapters, manual `trackScreen` |
| Network | fetch/XHR interception, URL scrubbing, size-only bodies | Same, with browser fetch/XHR patching and ignore list |
| Errors | JS/native errors, crashes, ANRs | JS errors, unhandled rejections, resource errors, long tasks as "ui freeze" |
| Console | Optional console capture with privacy warning | Same feature, but recommended off by default for public websites |
| Heatmaps | Touch/scroll/rage/dead tap counts and coordinate buckets | Click/scroll/rage/dead click buckets normalized per page/viewport |
| Privacy masks | Text inputs masked by default, explicit mask APIs | rrweb masks/blocks plus Rejourney selectors and DOM attributes |
| Lifecycle | 60s inactivity/rollover; backend does not trust final `/session/end` | Same principle, using `visibilitychange`, `pagehide`, periodic flush, and backend inactivity |
| Bot/scraper suppression | Mobile does not have a direct equivalent | Do not record bots, scrapers, link unfurlers, synthetic monitors, or automation by default |
| Upload reliability | Batching, gzip, idempotency, retry/circuit breaker, SDK telemetry | Same, using IndexedDB for offline queue and browser lifecycle-safe small final flushes |

## Use rrweb, But Wrap It

rrweb is the correct capture engine because it already handles the hard browser-specific work:

- DOM serialization and rebuild.
- DOM mutation observation.
- Mouse, click, scroll, input, media, viewport, and custom events.
- Privacy controls such as `blockClass`, `blockSelector`, `ignoreClass`, `maskTextClass`, `maskAllInputs`, `maskInputOptions`, `maskInputFn`, and `maskTextFn`.
- Full snapshot checkpoints via `checkoutEveryNth` and `checkoutEveryNms`.
- Storage optimization hooks such as sampling and `packFn`.
- Asset capture controls for stylesheets, images, object URLs, fonts, and origins.
- Optional console and canvas plugins.
- Replay APIs and `rrweb-player`.

What rrweb does not solve for us:

- Rejourney project auth, upload tokens, sampling, billing gates, storage layout, retention, backup, and dashboard authorization.
- Consent gating and customer privacy defaults.
- Web-specific session lifecycle across reload, bfcache, tab close, background tabs, and offline.
- Framework-specific "start only in the browser" helpers.
- Network/error/custom event parity with mobile.
- Rejourney dashboard player, archive filters, metrics, and thumbnails.
- Abuse protection for public browser keys.

### Version Pinning

As of the research date, npm reports `@rrweb/record`, `@rrweb/replay`, `@rrweb/packer`, and the rrweb console plugins at `2.0.0-alpha.20`, while the main `rrweb` package `latest` tag is older (`2.0.0-alpha.4`) and its `alpha` tag points elsewhere. Do not use `rrweb@latest` or CDN `@latest` in production.

Recommended initial dependencies:

```json
{
  "@rrweb/record": "2.0.0-alpha.20",
  "@rrweb/replay": "2.0.0-alpha.20",
  "@rrweb/packer": "2.0.0-alpha.20",
  "@rrweb/rrweb-plugin-console-record": "2.0.0-alpha.20",
  "@rrweb/rrweb-plugin-console-replay": "2.0.0-alpha.20",
  "fflate": "^0.8.2"
}
```

Pin all rrweb packages together and upgrade only after replay fixture tests pass. If alpha churn becomes painful, vendor a known-good rrweb build or maintain a Rejourney patch package rather than drifting package-by-package.

## Target Package Layout

Create a new workspace package:

```text
packages/browser/
  package.json
  tsconfig.json
  src/
    index.ts
    sdk/
      client.ts
      config.ts
      consent.ts
      domPrivacy.ts
      errors.ts
      lifecycle.ts
      networkInterceptor.ts
      recorder.ts
      replayUploadQueue.ts
      routeTracking.ts
      sdkTelemetry.ts
      storage.ts
      types.ts
      visitorId.ts
    integrations/
      angular.ts
      astro.ts
      gatsby.ts
      next.tsx
      nuxt.ts
      react.tsx
      remix.tsx
      svelte.ts
      vue.ts
```

Package entrypoints:

```json
{
  "name": "@rejourneyco/browser",
  "exports": {
    ".": "./dist/index.js",
    "./react": "./dist/integrations/react.js",
    "./next": "./dist/integrations/next.js",
    "./vue": "./dist/integrations/vue.js",
    "./nuxt": "./dist/integrations/nuxt.js",
    "./svelte": "./dist/integrations/svelte.js",
    "./angular": "./dist/integrations/angular.js",
    "./remix": "./dist/integrations/remix.js",
    "./astro": "./dist/integrations/astro.js",
    "./gatsby": "./dist/integrations/gatsby.js"
  }
}
```

Build requirements:

- ESM first. CJS can be added if customer demand appears.
- `sideEffects: false` except CSS entrypoints if any.
- No `window`, `document`, `navigator`, `localStorage`, or `indexedDB` access at module import time.
- Browser checks must sit inside `initRejourney`, `startRejourney`, adapter hooks, or explicit `isBrowser()` guards.
- Ship a UMD/IIFE browser snippet only after the npm package is stable.

### Monorepo, Docker, And CI Integration

Adding `packages/browser` is not only a package change. The repository has a few hard-coded workspace and build assumptions that must be updated in the same PR as the initial package skeleton.

Current repo facts checked:

- Root `package.json` already includes `"packages/*"` as a workspace.
- Root `build`, `build:sdk`, `clean`, and `postinstall` only build/clean `packages/react-native`.
- `.github/workflows/rejourney-sdk.yml` validates and publishes only `packages/react-native`.
- `backend/Dockerfile` and `dashboard/web-ui/Dockerfile` explicitly copy only `packages/react-native/package.json` before `npm ci`.
- `scripts/local-k8s/rejourney-ci.sh` only runs backend and dashboard checks before building local images.
- The dashboard already depends on `isbot`, but the backend does not.

Required updates:

- Add `packages/browser/package.json` to the package lock with pinned rrweb dependencies.
- Update root scripts:
  - `build:sdk` should build both React Native and web, or split into `build:react-native` and `build:web`.
  - `clean` should remove `packages/browser/dist` or equivalent.
  - Consider whether root `postinstall` should build both packages. If web build is expensive, make postinstall lighter and move package builds to CI/release scripts.
- Update both runtime Dockerfiles:
  - `backend/Dockerfile`
  - `dashboard/web-ui/Dockerfile`
  - Both must copy `packages/browser/package.json` before `npm ci`; otherwise Docker builds can fail when the workspace package exists in `package-lock.json` but the manifest is missing in the build context layer.
- `backend/Dockerfile.migration` probably does not need `packages/browser` because it installs from `backend/package.json`, but it does need any backend dependency used for bot classification, for example `isbot`.
- Add a new web SDK CI job:
  - typecheck;
  - unit tests;
  - bundle/build;
  - package content verification;
  - npm pack smoke install in Vite, Next, and plain-script fixtures.
- Add a web SDK publish path separate from the React Native npm publish path. Do not let changing `packages/browser/package.json` version accidentally publish `@rejourneyco/react-native`, or vice versa.
- Update `scripts/local-k8s/rejourney-ci.sh` so `npm run ci:local` checks `packages/browser` before Docker image builds.
- Update `.github/workflows/rejourney-ci.yml` only if dashboard starts importing `@rejourneyco/browser` directly. If the dashboard only imports `@rrweb/replay`, keep that dependency in `dashboard/web-ui`.

## Public Web SDK API

The web SDK should feel like the mobile SDK:

```ts
import { Rejourney, initRejourney, startRejourney } from '@rejourneyco/browser';

initRejourney('rj_live_xxxxxxxxxxxx', {
  apiUrl: 'https://api.rejourney.co',
  captureReplay: true,
  autoStart: false,
  autoTrackRoutes: true,
  autoTrackNetwork: true,
  trackConsoleLogs: false,
  maskAllInputs: true,
  blockSelector: '[data-rj-block], [data-rejourney-block]',
  maskTextSelector: '[data-rj-mask], [data-rejourney-mask]',
});

// Call after consent when required.
startRejourney();

Rejourney.setUserIdentity('user_123');
Rejourney.setMetadata({ plan: 'pro', role: 'admin' });
Rejourney.logEvent('checkout_started', { source: 'pricing_page' });
Rejourney.trackScreen('Pricing');
Rejourney.stop();
```

Key naming:

- Keep the public API name `publicKey` to match the existing mobile SDK language.
- Example key values should use Rejourney's `rj_...` prefix, not Stripe-style `pk_...`.
- Environment variable names may still need framework-required public prefixes such as `NEXT_PUBLIC_`, `PUBLIC_`, `GATSBY_`, or `VITE_`, but the value itself should be an `rj_...` key.
- Match the mobile SDK endpoint model: expose one public `apiUrl`, and let ingress route `/api/ingest/*` to the ingest API deployment.

Recommended types:

```ts
export interface WebRecordingContext {
  userAgent: string;
  url: string;
  origin: string;
  referrer: string;
  webdriver: boolean;
  prerendering: boolean;
}

export interface WebAttributionContext {
  entryUrl: string;
  entryPath: string;
  entryQuery: Record<string, string>;
  referrer: string | null;
  referrerDomain: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
  clickIds: Record<string, string>;
  landingRoute: string;
  navigationType: 'navigate' | 'reload' | 'back_forward' | 'prerender' | 'unknown';
}

export interface RejourneyWebConfig {
  publicKey?: string;
  apiUrl?: string;
  enabled?: boolean;
  autoStart?: boolean;
  disableInDev?: boolean;
  debug?: boolean;

  observeOnly?: boolean;
  captureReplay?: boolean;
  maxSessionDuration?: number;
  collectGeoLocation?: boolean;
  captureAttribution?: boolean;
  attribution?: {
    allowedQueryParams?: string[];
    preserveClickIds?: boolean;
    captureReferrer?: boolean | 'domain-only';
    captureEntryUrl?: boolean | 'path-only';
    beforeSendAttribution?: (context: WebAttributionContext) => WebAttributionContext | null;
  };
  ignoreBots?: boolean;
  recordAutomation?: boolean;
  botUserAgentPattern?: RegExp;
  shouldRecord?: (context: WebRecordingContext) => boolean;

  autoTrackRoutes?: boolean;
  routeName?: (location: Location) => string;
  autoTrackNetwork?: boolean;
  networkIgnoreUrls?: (string | RegExp)[];
  networkCaptureSizes?: boolean;
  trackConsoleLogs?: boolean;
  trackLongTasks?: boolean;
  trackResourceErrors?: boolean;

  maskAllInputs?: boolean;
  maskInputOptions?: Record<string, boolean>;
  blockClass?: string | RegExp;
  blockSelector?: string;
  ignoreClass?: string | RegExp;
  ignoreSelector?: string;
  maskTextClass?: string | RegExp;
  maskTextSelector?: string;
  maskInputFn?: (value: string, element: HTMLElement) => string;
  maskTextFn?: (text: string, element: HTMLElement) => string;

  rrweb?: {
    checkoutEveryNms?: number;
    checkoutEveryNth?: number;
    sampling?: Record<string, unknown>;
    inlineStylesheet?: boolean | 'all';
    inlineImages?: boolean;
    collectFonts?: boolean;
    captureAssets?: {
      objectURLs?: boolean;
      origins?: string[] | true | false;
      images?: boolean;
      video?: boolean;
      audio?: boolean;
      stylesheets?: boolean | 'without-fetch';
      processStylesheetsWithin?: number;
      stylesheetsRuleThreshold?: number;
    };
    recordCanvas?: boolean;
    canvasSamplingFps?: number;
  };

  beforeSendEvent?: (event: unknown) => unknown | null;
  beforeSendNetwork?: (request: NetworkRequestParams) => NetworkRequestParams | null;
  onAuthError?: (error: { code: number; message: string; domain?: string }) => void;
}
```

Defaults should be privacy-first for websites:

```ts
const DEFAULT_WEB_CONFIG = {
  enabled: true,
  autoStart: false,
  observeOnly: false,
  captureReplay: true,
  autoTrackRoutes: true,
  autoTrackNetwork: true,
  trackConsoleLogs: false,
  trackLongTasks: true,
  trackResourceErrors: true,
  collectGeoLocation: true,
  captureAttribution: true,
  attribution: {
    allowedQueryParams: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'],
    preserveClickIds: false,
    captureReferrer: 'domain-only',
    captureEntryUrl: 'path-only'
  },
  ignoreBots: true,
  recordAutomation: false,

  maskAllInputs: true,
  maskInputOptions: {
    password: true,
    email: true,
    tel: true,
    text: true,
    number: true,
    search: true,
    url: true
  },
  blockClass: 'rr-block',
  ignoreClass: 'rr-ignore',
  maskTextClass: 'rr-mask',
  blockSelector: '[data-rj-block], [data-rejourney-block]',
  ignoreSelector: '[data-rj-ignore], [data-rejourney-ignore]',
  maskTextSelector: '[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]',

  rrweb: {
    checkoutEveryNms: 60_000,
    checkoutEveryNth: 200,
    sampling: {
      mousemove: 50,
      scroll: 150,
      media: 800,
      input: 'last'
    },
    inlineStylesheet: true,
    inlineImages: false,
    collectFonts: false,
    captureAssets: {
      objectURLs: false,
      origins: false,
      images: false,
      stylesheets: 'without-fetch',
      processStylesheetsWithin: 2000
    },
    recordCanvas: false
  }
};
```

Do not silently collect all text content just because rrweb can. Website replay has materially higher privacy exposure than mobile screenshot capture because DOM snapshots can include hidden text, rendered user data, prefilled fields, and app state embedded in markup.

Security fixes from the plan review:

- `collectGeoLocation` can stay on by default for web, but it must mean approximate IP-derived geo only. Never call `navigator.geolocation`, never request browser location permission, and always support the project-level "Disable IP geolocation" control.
- `captureAssets.objectURLs` should be off by default. Object URLs commonly represent user-selected files, generated private previews, canvas exports, or app-only blobs.
- Click IDs should not be preserved by default. UTM params are enough for baseline acquisition analytics; ad click IDs are persistent identifiers and often require stronger consent/legal review.
- Referrer capture should default to domain-only and entry URL capture should default to path-only plus allowlisted attribution params.
- Do not require inline scripts for the CDN snippet. Inline snippets conflict with a strict CSP story.

### Bot And Scraper Suppression

Do not record bots, scrapers, link unfurlers, SEO crawlers, synthetic monitors, or test automation by default. This should be a launch requirement, not a dashboard cleanup task.

Use layered detection:

- SDK preflight before config fetch. If the visitor is bot-like, return a local disabled state and do not call `/api/sdk/config`, create a visitor id, start rrweb, patch network APIs, or upload anything.
- Backend classification on `/api/sdk/config`, auth, presign, complete, and lifecycle routes. Public `rj_...` keys are visible by design, so the server must still reject bot-like and abuse traffic.
- Dashboard/accounting should count suppressed bot attempts separately from billable sessions.

Client-side skip conditions:

- `navigator.userAgent` matches known crawler/link-preview/synthetic-monitor patterns. Start with a small vendored wrapper around `isbot` instead of maintaining a large regex by hand.
- `navigator.webdriver === true`, unless `recordAutomation: true` is set for an explicit test project or local QA.
- `document.prerendering === true`. Defer startup until activation; do not record prerender speculation.
- Obvious non-browser user agents such as `curl`, `wget`, `python-requests`, headless fetchers, link checkers, and uptime probes.
- Customer-provided `shouldRecord(context) === false`.

Do not depend only on user agent. It is easy to spoof and many bots do not execute JavaScript anyway. Treat it as cost/privacy suppression, not security.

Suggested server response for a classified bot:

```json
{
  "enabled": false,
  "recording": false,
  "reason": "bot"
}
```

Implementation notes:

- Keep a shared `classifyWebClient()` helper in the web SDK and backend so behavior is consistent.
- Allow explicit overrides only through project config or SDK config, never through URL query params.
- Include bot suppression in SDK telemetry at aggregate level only; do not store full bot page views as sessions.
- Add tests for Googlebot/Bingbot/DuckDuckBot, link unfurlers like Slackbot/Discordbot/facebookexternalhit, SEO crawlers like AhrefsBot/SemrushBot, Lighthouse/PageSpeed/GTmetrix, `navigator.webdriver`, and a normal Chrome/Safari/Firefox UA.

## Web Session Lifecycle

The web SDK should use the same high-level lifecycle contract as mobile:

1. `initRejourney(publicKey, options)` stores the Rejourney `rj_...` public key and prepares browser-safe state.
2. `startRejourney()`:
   - runs bot/scraper/automation suppression locally before any network call;
   - fetches `/api/sdk/config`;
   - applies remote gates;
   - samples locally;
   - obtains an upload token;
   - creates a client session id `session_{Date.now()}_{cryptoRandom}`;
   - starts telemetry;
   - starts rrweb only when visual replay is allowed.
3. Events and rrweb chunks flush periodically.
4. `stopRejourney()` stops capture, drains queues, and sends `/api/ingest/session/end`.
5. If the page dies before stop completes, backend reconciliation still closes the session.

Browser lifecycle constraints:

- Use `visibilitychange` as the last reliable moment to persist/drain a small amount of data.
- Use `pagehide` as a fallback and for bfcache-aware cleanup.
- Avoid `unload`. It is unreliable, harms bfcache, and may not run.
- Avoid `beforeunload` except for app-owned unsaved-work prompts. It is not a reliable analytics close signal.
- `navigator.sendBeacon()` and `fetch(..., { keepalive: true })` are useful only for small final payloads. Both have practical body limits around 64 KiB.
- Treat final close as best-effort. The backend already has the right posture: session end is a hint, not the source of truth.

Session rollover recommendation:

- Keep the existing 60 second live ingest window on the server.
- Do not copy the mobile "backgrounded for 60 seconds means new session" rule directly to web. It is right for native apps because background usually means the app is not usable. On the web, background tabs, quick tab switches, reading another tab, OAuth/payment redirects, and bfcache restores are normal parts of one browsing session.
- For web, keep the same session across short and medium hidden periods as long as the page is still alive and the max session duration has not been reached.
- Roll over on explicit boundaries: max recording duration, user identity switch, domain/origin change, storage/auth reset, very long inactivity, or a new top-level page load after the old session has already been finalized server-side.
- Recommended client hidden rollover threshold: 30 minutes, configurable from remote config. Use 60 seconds only for the backend live-ingest badge/fail-safe, not for splitting web sessions.
- If the page is restored from bfcache with `pageshow.persisted === true`, resume the same tab session if the local session is still valid; otherwise start a new one and send a best-effort close for the old session.
- If multiple tabs for the same site are open, either:
  - create a separate Rejourney session per tab, recommended for replay fidelity; or
  - coordinate with `BroadcastChannel` and a tab id if product wants one active tab per visitor.

## Attribution And Entry Source Tracking

The web SDK should capture where the user came from as session-level attribution, not as replay data. This is a core web analytics feature and should be implemented alongside route tracking.

Capture once at session start:

- `entryUrl`: the first URL seen by the SDK for this session, after URL scrubbing.
- `entryPath`: pathname without sensitive query values.
- `entryQuery`: allowlisted query params only.
- `referrer`: `document.referrer`, scrubbed and length-capped.
- `referrerDomain`: parsed hostname from `document.referrer`.
- `landingRoute`: router-derived route name if available, otherwise pathname.
- `navigationType`: from `performance.getEntriesByType('navigation')[0].type` when available.
- UTM fields:
  - `utm_source`
  - `utm_medium`
  - `utm_campaign`
  - `utm_term`
  - `utm_content`
- Click IDs, optional but useful for acquisition debugging:
  - `gclid`
  - `gbraid`
  - `wbraid`
  - `fbclid`
  - `msclkid`
  - `ttclid`
  - `twclid`
  - `li_fat_id`

Default attribution classification:

```ts
type AcquisitionChannel =
  | 'direct'
  | 'organic_search'
  | 'paid_search'
  | 'paid_social'
  | 'organic_social'
  | 'referral'
  | 'email'
  | 'affiliate'
  | 'display'
  | 'unknown';
```

Rules:

- If UTM params exist, prefer them over referrer heuristics.
- If a known ad click ID exists with no UTM, infer paid search/social where possible.
- If `document.referrer` is empty and no UTM/click ID exists, classify as `direct`.
- If referrer hostname equals the current hostname, classify as internal and do not overwrite external acquisition.
- For SPAs, keep original session attribution stable across route changes. Route changes should emit navigation events, not mutate the original entry source.
- For multi-page apps, each top-level page load may create a new Rejourney session depending on SDK session continuity. Preserve first-touch attribution in visitor storage only after consent when allowed.

Privacy and safety:

- Never store raw full URLs without scrubbing.
- Use a denylist at least as broad as mobile network URL scrubbing: `token`, `key`, `secret`, `password`, `auth`, `access_token`, `api_key`.
- Also redact common web-sensitive params: `code`, `state`, `session`, `sid`, `jwt`, `id_token`, `refresh_token`, `email`, `phone`, `otp`, `magic`, `invite`, `coupon` if customers consider coupon codes sensitive.
- Prefer an allowlist for attribution params. Default allowlist should include UTM params and known click IDs, not arbitrary query strings.
- Default capture should store referrer domain only, not full referrer path/query.
- Default capture should store entry path plus allowlisted query params only, not the full raw entry URL.
- Treat ad click IDs as opt-in. They can identify a person or browser across systems.
- Cap URL/referrer strings, for example 2 KB each, and cap each query value, for example 256 chars.
- Run attribution through `beforeSendAttribution` so customers can remove campaign params they consider sensitive.
- Do not transmit attribution before consent when the site requires consent for analytics. If a customer wants to remember pre-consent landing attribution, keep it in memory or `sessionStorage` only until consent, and make that opt-in with clear docs.

Upload model:

- Include attribution in the first `events` artifact as a `session_start` or `attribution` event.
- Mirror the normalized attribution object into `sessions.metadata.acquisition` for dashboard filtering.
- Do not put attribution into rrweb chunks.
- Include attribution in session archive filters:
  - channel;
  - source;
  - medium;
  - campaign;
  - referrer domain;
  - entry path.

## Web Upload Model

Do not send every rrweb event directly to the API. Use the existing artifact pattern:

```text
Browser SDK
  rrweb emits events
  event buffer accumulates
  gzip JSON chunk
  POST /api/ingest/rrweb/presign
  PUT upload relay URL
  POST /api/ingest/rrweb/complete

Backend
  recording_artifacts(kind='rrweb')
  Redis buffer + flush worker
  S3 canonical object
  artifact worker validates JSON
  session reconciliation marks replayAvailable
```

Chunk format:

```json
{
  "version": 1,
  "format": "rrweb",
  "sessionId": "session_1770000000000_abcd",
  "sdk": {
    "name": "@rejourneyco/browser",
    "version": "0.1.0"
  },
  "page": {
    "url": "https://example.com/pricing",
    "title": "Pricing",
    "referrer": "https://example.com/"
  },
  "viewport": {
    "width": 1440,
    "height": 900,
    "devicePixelRatio": 2
  },
  "startedAt": 1770000000000,
  "chunkStartedAt": 1770000000200,
  "chunkEndedAt": 1770000005200,
  "sequence": 0,
  "isCheckout": false,
  "events": []
}
```

Flush policy:

- Flush rrweb chunks every 5 seconds, 250 events, or 512 KiB uncompressed, whichever comes first.
- Flush event/analytics chunks every 5 seconds or 100 events.
- Compress chunks as gzip before upload, preferably off the main thread.
- Persist unsent chunks to IndexedDB with a session-scoped queue.
- Cap local queue size, for example 20 MB or 100 chunks, then evict oldest replay chunks before telemetry/error chunks.
- Use idempotency keys and deterministic client upload ids:

```text
rrweb_{sessionId}_{sequence}_{chunkStartedAt}_{sha1(gzipBytes).slice(0,8)}
```

Final flush:

- On `visibilitychange:hidden`, write in-memory buffers to IndexedDB first.
- Attempt a small `sendBeacon` or `fetch(keepalive)` only for `/session/end` and a tiny telemetry summary.
- Do not attempt to flush large rrweb chunks during page hide. Let the next page load/service worker/background queue retry when possible.

Local browser storage security:

- Prefer IndexedDB over `localStorage`; never store upload tokens, public key config, or replay chunks in cookies.
- Keep upload tokens in memory when possible. If retry across reload is required, store only short-lived, scope-limited upload state in IndexedDB and expire it aggressively.
- Set a hard TTL on queued chunks, for example 24 hours or less for retryable web replay.
- Clear queued chunks on `stop()`, consent revocation, logout when the customer calls `clearUserIdentity()`, and project key change.
- Do not encrypt queued chunks with a key stored next to them and call that a security boundary. Browser-side encryption does not protect against XSS running in the same origin. The real mitigations are minimization, masking before storage, short TTLs, and customer CSP hygiene.
- Do not install a Service Worker by default. Background sync/retry sounds attractive, but a third-party SDK-owned worker is a large site-level capability and complicates customer security reviews. If added later, make it a separate, explicit integration with clear scope, cache behavior, and uninstall docs.

## Backend Changes

### Current Backend Code Cross-Check

The current backend already has most of the mobile ingest machinery we should reuse, but several places are screenshot/hierarchy-specific today:

- `backend/src/routes/sdk.ts`
  - `/api/sdk/config` reads `x-public-key`.
  - Its Redis cache key is currently based on public key only.
  - Web config cannot cache the final response by public key alone because `Origin`, platform, bot classification, and dev-domain allowance can change the response. Cache the project row separately, or include platform/origin/classification in the response cache key.
- `backend/src/routes/ingestDeviceAuth.ts`
  - `/api/ingest/auth/device` accepts `x-rejourney-key` or `x-api-key`, not `x-public-key`.
  - For web, either accept `x-public-key` here too or have the web SDK consistently send `x-rejourney-key` after `initRejourney(publicKey)`.
  - Internally rename concepts from "device" to "client" over time, but keep wire compatibility for mobile.
- `backend/src/routes/ingestUploads.ts`
  - `/api/ingest/segment/presign` currently rejects anything except `screenshots` and `hierarchy`.
  - `/api/ingest/presign` maps content types to `events`, `crashes`, and `anrs`.
  - New rrweb routes avoid changing the mobile segment parser, but if we reuse `/segment/*`, `ingestProtocol.ts` and validators must support `rrweb`.
- `backend/src/services/artifactBullQueue.ts`
  - `REPLAY_KINDS` is currently `screenshots` and `hierarchy`.
  - Add `rrweb`, or rrweb artifacts will be routed to the ingest worker queue instead of the replay worker.
- `backend/src/worker/workerDefinitions.ts`
  - `REPLAY_ARTIFACT_WORKER.allowedKinds` is currently `screenshots` and `hierarchy`.
  - Add `rrweb`, and decide priority so web replay cannot starve existing mobile replay.
- `backend/src/worker/startArtifactWorker.ts`
  - Replay-worker detection checks whether allowed kinds include `screenshots` or `hierarchy`.
  - If we add a dedicated rrweb worker later, do not rely on that heuristic. Add an explicit queue name or `artifactQueue: 'replay' | 'ingest'`.
- `backend/src/services/artifactJobProcessor.ts`
  - `artifactProcessors` has no `rrweb` processor.
  - Add `rrweb: processRrwebArtifact(...)`.
- `backend/src/services/ingestReplayArtifactProcessor.ts`
  - Only verifies screenshot archives and hierarchy JSON today.
  - Add rrweb envelope validation, gzip handling, full-snapshot check, timestamp bounds, event-count limits, and size limits.
- `backend/src/services/ingestArtifactLifecycle.ts`
  - `isReplayArtifactKind()` is currently screenshot/hierarchy only.
  - Update replay logging, queue decisions, and replay-pending recovery to include `rrweb`.
- `backend/src/services/sessionPresentationState.ts`
  - `loadSessionWorkAggregate()` only counts screenshots/hierarchy.
  - Add `readyRrwebCount`, `readyRrwebBytes`, and include `rrweb` in open replay work and latest replay end time.
- `backend/src/services/sessionReconciliation.ts`
  - `replayAvailable` is currently `readyScreenshotCount > 0`.
  - `reconcileDueSessions()` SQL looks for pending screenshot/hierarchy work and ready screenshots.
  - Update both paths so a ready rrweb artifact makes web sessions openable and finalizable.
- `backend/src/services/sessionTiming.ts`
  - Comments and derived duration logic say replay end means screenshots/hierarchy.
  - Include rrweb chunk end time in the same concept.
- `backend/src/routes/sessions.ts`
  - Detail/bootstrap used to be screenshot-first; keep checking for hidden screenshot-only branches when changing replay availability.
  - Current replay loading uses `/api/session/:id/replay-manifest` for rrweb chunk metadata and screenshot frame metadata. Keep raw rrweb events out of bootstrap/core payloads.
- `dashboard/web-ui/app/shared/ui/core/ScreenshotReplayPlayer.tsx`
  - Keep this for mobile. Add a separate rrweb player instead of overloading the screenshot player.

This cross-check also means implementation should include repository-wide `rg` checks for `screenshots`, `hierarchy`, `replayAvailable`, `readyScreenshot`, `REPLAY_KINDS`, and `/segment/presign` before declaring backend support complete.

### 1. Project/Auth Changes

`projects.web_allowed_domains` is the source of truth for web origin restrictions. `projects.webDomain` remains as a compatibility alias for the first allowed domain.

Add web-specific auth checks:

- Extend `/api/sdk/config` response with platform fields when `x-platform: web`.
- Validate `Origin` and/or `Referer` against `projects.web_allowed_domains` for browser SDK config, device auth, and ingest.
- Accept localhost/dev origins when project settings explicitly allow development domains.
- Do not treat Origin as perfect security. It protects normal browsers, not curl abuse.
- For browser SDK routes, require `Origin` on state-changing requests and exact-match it against configured domains. Treat missing `Origin` as suspicious for web traffic even if mobile/native routes still allow it.
- Return `Vary: Origin` on CORS responses so caches do not reuse one origin's decision for another origin.
- Do not use `Access-Control-Allow-Origin: *` with any credentialed response. Prefer no cookies and no `Access-Control-Allow-Credentials` for SDK ingest.
- Keep CORS and auth separate: CORS protects browser reads, not server-side abuse. Still verify project key, upload token, origin, byte budget, and bot classification server-side.
- Classify bots/scrapers/synthetic monitors before materializing a session, issuing an upload token, counting usage, or accepting replay bytes.
- Keep existing byte budgets and rate limits.
- Add per-project domain abuse dashboards/alerts.

Bot/scraper handling on the backend:

- Add `classifyWebClient({ userAgent, origin, referer, platform, webdriverHint })`.
- Use an established UA classifier such as `isbot` behind a tiny Rejourney wrapper so rules can be pinned, tested, and patched.
- Return disabled config for classified bots on `/api/sdk/config`.
- Reject classified bot traffic on auth/presign/complete with a non-retryable response, for example `403` with code `bot_suppressed`.
- Log aggregate suppression counts by project/origin/reason, but do not create full sessions for bot traffic.
- Keep a project-level escape hatch for QA/synthetic monitoring, default off.

Web upload token:

- Reuse `/api/ingest/auth/device` if practical, but rename internally from "device" to "client" over time.
- Use a browser visitor id as `deviceId`, for example `web_anon_{uuid}`.
- Include `platform: 'web'`, `origin`, `projectId`, and allowed artifact kinds in the upload token payload.
- Bind web upload tokens to the configured origin and reject presign/complete requests when request origin and token origin differ.
- Keep the upload token out of URLs. Send it in a header.
- Relay upload URLs currently use query tokens. For web, prefer moving relay auth to a header. If query tokens remain, make them artifact-scoped, short-lived, single-use where practical, and never log full URLs.
- Token TTL can stay 1 hour.
- For web, do not require a native bundle id/package name.

### 2. New Artifact Kind

Add `recording_artifacts.kind = 'rrweb'`.

The schema currently stores artifact kind as a varchar, so a migration is not required for the kind itself. Still update:

- comments in `backend/src/db/schema.ts`;
- worker kind priority in `backend/src/worker/workerDefinitions.ts`;
- artifact lifecycle helpers where replay kinds are hard-coded;
- session backup reports and quality checks;
- stats/bytes displays;
- cache invalidation;
- retention/purge safety checks if they filter by replay kinds.

Recommended replay-kind helper:

```ts
export function isReplayArtifactKind(kind: string | null | undefined): boolean {
  return kind === 'screenshots' || kind === 'hierarchy' || kind === 'rrweb';
}

export function isReplayAvailabilityArtifactKind(kind: string | null | undefined): boolean {
  return kind === 'screenshots' || kind === 'rrweb';
}
```

Do not make `hierarchy` alone openable; it is auxiliary on mobile.

### 3. Ingest Routes

Lowest-risk path:

- Add new routes:
  - `POST /api/ingest/rrweb/presign`
  - `POST /api/ingest/rrweb/complete`
- Internally reuse `prepareReplayArtifactForUpload`, `completeArtifactUpload`, upload relay URLs, idempotency, byte budgets, and project gates.

Presign body:

```json
{
  "sessionId": "session_1770000000000_abcd",
  "sequence": 0,
  "startTime": 1770000000200,
  "endTime": 1770000005200,
  "eventCount": 225,
  "sizeBytes": 88421,
  "compression": "gzip",
  "platform": "web",
  "sdkVersion": "0.1.0",
  "isCheckout": false,
  "isSampledIn": true
}
```

Storage path:

```text
tenant/{teamId}/project/{projectId}/sessions/{sessionId}/rrweb/rrweb_{sequence}_{startTime}.json.gz
```

Keep mobile `events` artifacts separate. rrweb contains replay data and may be very large; product events/network/errors stay in existing `events` artifacts so dashboard analytics can continue to use `processEventsArtifact`.

### 4. Artifact Processor

Add `processRrwebArtifact`:

- Gunzip if needed.
- Parse JSON.
- Accept either `{ events: [...] }` or a raw array only for migration convenience. New SDK should send the envelope.
- Verify non-empty events.
- Verify event timestamps are finite.
- Verify at least one full snapshot exists in the first chunk or in a known earlier chunk. rrweb event types are numeric, so use `@rrweb/types` in backend only if it does not bloat production builds too much; otherwise define a tiny local validator.
- Enforce event count and size ceilings per chunk.
- Strip or reject events that exceed maximum serialized node sizes.
- Reject unexpected top-level fields and cap string lengths for URL, title, text, attributes, style values, and serialized nodes.
- Treat every rrweb artifact as hostile input. Do not log raw event bodies or raw DOM text on validation failure.
- Detect and reject obvious script/resource abuse in replay payloads where possible, such as `javascript:` URLs, oversized `srcdoc`, and data URLs above strict limits.
- Persist a validation summary only: event count, first/last timestamp, full-snapshot presence, byte size, and rejection reason.
- Save size, start/end, event count.
- Mark artifact ready.

Important: do not inline rrweb events into `sessions.events`. Store rrweb in object storage only. Keep Postgres rows as metadata and searchable analytics only.

### 5. Session Reconciliation

Current code marks `replayAvailable` from ready screenshot artifacts:

```ts
const replayAvailable = readyScreenshotCount > 0;
```

Update to:

```ts
const replayAvailable = readyScreenshotCount > 0 || readyRrwebCount > 0;
```

Update `loadSessionWorkAggregate`:

- `readyRrwebCount`
- `readyRrwebBytes`
- `openReplayArtifactCount` includes `rrweb`
- `latestReplayArtifactEndMs` includes `rrweb`
- `latestReadyAt` includes `rrweb`

Update metrics:

- Add `rrwebSegmentCount`
- Add `rrwebTotalBytes`
- Keep `screenshotSegmentCount` for mobile.

This likely needs a migration for `session_metrics` if we want first-class columns. If not, stats can compute from `recording_artifacts`, but columns are better for archive list performance.

### 6. Session Detail API

Current replay open uses a split read path:

- `GET /api/session/:id/core?includeReplay=false` returns the cheap session shell and does not build the replay payload.
- `GET /api/session/:id/replay-manifest?frameUrlMode=signed` returns the visual replay manifest.
- `GET /api/session/:id/frames?frameUrlMode=signed` returns screenshot frame metadata when the player needs the frame list separately.

Do not return all rrweb events in `/bootstrap` or `/core`. The manifest endpoint is the current replacement for the older proposed `/rrweb/events` or `/rrweb/chunks` endpoints.

The manifest endpoint should:

- authorize via existing session auth;
- load ready `rrweb` and `screenshots` artifacts;
- use Redis cache and request coalescing so concurrent opens share cold builds;
- return ordered rrweb segments with `artifactId`, time bounds, event count, signed direct URL, and `proxyUrl`;
- return screenshot frames with timestamp, index, signed direct JPEG URL, and `proxyUrl`;
- set short cache headers for unstable sessions and longer private cache headers for stable sessions;
- keep payloads metadata-only so timeline, stats, network, and full replay parsing do not run just because the replay page opened.

The dashboard should try signed direct object-storage URLs first. The same-origin fallback routes are:

```text
GET /api/session/rrweb-segment/:sessionId/:artifactId
GET /api/session/frame/:sessionId/:timestamp
```

Those routes are for CORS, CSP, expired signed URLs, or object-storage reachability failures. Normal warm playback should not stream most replay bytes through `api-dashboard`.

### 7. Event Analytics Processor

The web SDK should continue uploading normalized analytics events as `events` artifacts. Add web event normalization to `processEventsArtifact`:

- `type: 'navigation'` or `type: 'screen_change'` from route changes.
- `type: 'click'`, `type: 'tap'`, `type: 'rage_click'`, `type: 'dead_click'`.
- `type: 'scroll'`.
- `type: 'network_request'`.
- `type: 'error'`.
- `type: 'resource_error'`.
- `type: 'long_task'` or `type: 'ui_freeze'`.
- `type: 'session_start'` or `type: 'attribution'` for entry URL, referrer, UTM fields, click IDs, and derived acquisition channel.
- `type: 'custom'`.
- `type: '$user_property'`.

Coordinate heatmap changes:

- Web coordinates should include page route, viewport width/height, document scroll offset, and target bounding box when available.
- Normalize to viewport for click heatmaps.
- Consider page-specific heatmaps, not mobile screen-only heatmaps.

## Dashboard Changes

### Player

Add:

```text
dashboard/web-ui/app/shared/ui/core/RrwebReplayPlayer.tsx
```

Security requirement: rrweb playback is rendering customer-controlled HTML-like data. Treat it as untrusted content with stored-XSS risk.

Playback isolation:

- Prefer rendering rrweb replay in a sandboxed, cookie-less iframe on a separate origin such as `replay.rejourney.co`.
- If a separate origin is not available for MVP, use a sandboxed iframe without `allow-same-origin` and without `allow-scripts` unless rrweb playback absolutely requires scripts. If scripts are required, keep the iframe on a distinct origin with no dashboard cookies or local storage.
- Apply a dedicated replay CSP, for example `default-src 'none'`, with narrowly allowed `img-src`, `style-src`, `font-src`, and `media-src` needed for replay assets.
- Block top navigation, popups, form submission, downloads, clipboard, camera, microphone, geolocation, payment, and pointer lock from the replay frame.
- Intercept links inside replay so clicks do not navigate the dashboard or leak operator context.
- Set `referrerpolicy="no-referrer"` on the replay iframe and replay asset loads where possible.
- Do not let replay fetch arbitrary private-network, loopback, link-local, or cloud metadata URLs. If a future asset proxy or thumbnail renderer fetches customer URLs server-side, add SSRF defenses: DNS/IP allow/deny checks, no redirects to private ranges, byte/time limits, and content-type checks.
- Prefer replaying captured/cached same-origin assets over loading live third-party URLs from the operator's browser. Live asset fetches can leak dashboard operator IP/referrer and can make old replays visually drift.
- Do not render rrweb content directly inside the dashboard React tree.
- Never use `dangerouslySetInnerHTML` for replay metadata, DOM inspector labels, attributes, URLs, or error messages. Escape all displayed strings.
- Disable rrweb canvas replay by default. If enabled, isolate it in the same replay sandbox and document the unsafe replay caveat.

Use either:

- `@rrweb/replay` plus our existing Rejourney controls, recommended for visual consistency; or
- `rrweb-player`, faster for MVP but harder to make look like the current player.

Recommendation: use `@rrweb/replay` directly and keep current Rejourney controls/timeline.

Player responsibilities:

- Fetch the cheap core payload first, then request `/api/session/:id/replay-manifest`.
- For rrweb, load the first playable segment before trying to initialize playback, then prefetch nearby and next segments in the background.
- Use adaptive segment concurrency: about 6 desktop, 4 mobile, and 3 on slower mobile/network conditions.
- Try each signed direct segment URL with `credentials: omit`; fall back to `proxyUrl` with dashboard credentials only if the direct object-storage read fails.
- Instantiate rrweb `Replayer` inside a sandboxed container.
- Use `skipInactive` and `inactivePeriodThreshold` to match current playback expectations.
- Map Rejourney custom/network/error events to timeline markers.
- Expose `seekTo`, `play`, `pause`, `getCurrentTime` like `ScreenshotReplayPlayer`.
- Destroy the replayer on unmount to release iframe/memory.
- Load console replay plugin only when console events are present.
- For canvas replay, use `UNSAFE_replayCanvas` only if that session explicitly opted into canvas and the dashboard warns internally that the rrweb sandbox is reduced.

### Replay Selection

In session detail:

```tsx
if (playbackMode === 'rrweb') {
  return <RrwebReplayPlayer ... />;
}
return <ScreenshotReplayPlayer ... />;
```

Do not try to convert rrweb into screenshot frames for initial launch.

### Thumbnails

Mobile thumbnails come from screenshot archives. Web rrweb has no image frames. Options:

1. MVP: use a generic web replay thumbnail plus metadata.
2. Better: async thumbnail worker uses headless Chromium to replay first N seconds and capture a PNG/JPEG.
3. Later: capture a customer-provided page preview or first full snapshot render.

Recommendation:

- MVP generic thumbnail is acceptable for launch if the replay opens reliably.
- Add headless thumbnail generation after replay playback is stable.

### Timeline And Network

Keep the existing timeline shape:

- custom events;
- network requests;
- JS errors;
- resource errors;
- long tasks;
- console logs;
- clicks/rage clicks/dead clicks;
- route changes.

Do not rely only on rrweb custom events for product analytics. Store normalized events in existing event artifacts so archive filters and dashboards remain fast.

## Privacy And Legal Guardrails

Web session replay is legally and reputationally riskier than mobile replay. The implementation should bias toward source-side minimization.

### Consent

Recommended product behavior:

- Web SDK should not auto-start visual replay unless the customer explicitly passes `autoStart: true`.
- Documentation should show consent-gated startup by default.
- For EEA/UK users, customers should be able to initialize after CMP consent or start in `observeOnly` until consent is granted.
- The SDK must provide `stop()` and `clearUserIdentity()`.
- The SDK should expose `setConsent({ replay: boolean, analytics: boolean })` or document a simple consent integration pattern.

CNIL's 2026 draft recommendation specifically treats session replay as needing prior consent in France. CNIL also warns that replay should be limited to explicit purposes and configured according to those purposes. Even outside France, this is the safer default posture.

### Source-Side Masking

Default:

- `maskAllInputs: true`.
- Password/secure fields always masked.
- Common data attributes:
  - `data-rj-mask`
  - `data-rejourney-mask`
  - `data-rj-block`
  - `data-rejourney-block`
  - `data-rj-ignore`
  - `data-rejourney-ignore`
- Common classes:
  - `rr-mask`
  - `rr-block`
  - `rr-ignore`

Blocking vs masking:

- Mask text when the layout is useful but content is sensitive.
- Block entire elements for payment forms, account numbers, health data, legal documents, private messages, admin notes, and third-party widgets.
- Always block third-party payment iframes, chat widgets, CAPTCHA, one-time-code inputs, and file previews unless the customer explicitly opts in.

### Console And Network

Default recommendation:

- `trackConsoleLogs: false` on web.
- `autoTrackNetwork: true`, but never capture request or response bodies by default.
- Capture URL, method, status, duration, size, and content type only.
- Scrub query params using sensitive-key denylist:
  - `token`
  - `key`
  - `secret`
  - `password`
  - `auth`
  - `access_token`
  - `id_token`
  - `refresh_token`
  - `api_key`
  - `code`
  - `state`
  - `session`
  - `email`
  - `phone`
- Allow customers to add URL ignore patterns.
- Always ignore Rejourney endpoints.

### Data Processing

Update Rejourney docs/contracts to distinguish:

- Rejourney as processor for customer-owned replay/analytics.
- Any Rejourney-owned product-improvement telemetry, if collected, as a separate purpose and toggle.

Do not reuse customer replay content for Rejourney model/product improvement unless the customer explicitly opts in contractually and technically.

### Security Controls

Threat model web replay as:

- public-key abuse and storage exhaustion;
- bot/scraper/synthetic monitor noise;
- accidental PII capture;
- malicious customer or end-user content becoming stored XSS in the dashboard;
- leaked upload or replay URLs;
- supply-chain risk from CDN snippets and vendored examples.

Required controls:

- Origin allowlist and exact-match CORS for browser SDK routes.
- Per-project, per-origin, per-client, and per-IP byte budgets.
- Short-lived, scope-bound upload and relay tokens.
- No raw replay payloads or full upload URLs in logs.
- Replay rendering isolated from dashboard cookies and storage.
- Replay asset loading cannot access private networks, metadata services, or arbitrary live third-party resources without proxy/allowlist controls.
- Version-pinned CDN assets with SRI.
- Source-side masking and blocking before data leaves the customer browser.
- Server-side validation of rrweb envelope, size, string lengths, timestamps, and event count.
- Security regression tests for XSS payloads in text nodes, attributes, URLs, `srcdoc`, SVG, MathML, and CSS.

### Retention

Use existing retention tiers, but document that web replay can contain more personal data than mobile screenshots because DOM text can include hidden or server-rendered data.

Add admin controls:

- Disable replay by project.
- Disable console capture by project.
- Force mask all inputs by project.
- Disable IP geolocation by project.
- Domain allowlist by project.
- Delete recordings by session/user/project.

## Web-Specific Replay Limitations

Customers need honest docs. rrweb is excellent, but not magic.

| Area | Expected behavior |
|---|---|
| CSS | Best if stylesheets are same-origin/CORS-readable or captured as assets. CSS that changes after the session can alter old replay unless captured. |
| Images | Not captured by default. Replays may load current image URLs. Offer same-origin/allowlist asset capture for apps that need long-lived exactness. |
| Fonts | `collectFonts` can improve fidelity but increases data. Off by default. |
| Canvas/WebGL/maps/charts | Not recorded by default. `recordCanvas` can capture snapshots but increases storage and requires unsafe canvas replay. |
| Video/audio | Media interactions can be captured; media pixels/audio are not replayed as a recorded video unless assets are available/captured. |
| Cross-origin iframes | Cannot inspect third-party frame DOM. rrweb can record cross-origin iframes only when the recorder is injected into the child frame too. |
| Payment/CAPTCHA iframes | Should be blocked, not captured. |
| Shadow DOM | Open shadow roots should be tested. Closed shadow roots cannot be inspected by page JavaScript by design; treat as opaque and require manual block/mask if sensitive. |
| Browser extensions | Extension-injected DOM may appear. Consider default ignore selectors for common extension roots if this becomes noisy. |
| Ad blockers | Some users may block the SDK or ingest endpoint. Dashboard should tolerate missing sessions. |

## Framework Support

The core SDK should work in any browser. Framework adapters should be thin wrappers that solve "when do I start in the browser?" and "how do I track routes?".

### Plain HTML / Script Tag

Needed for Webflow, WordPress, Rails, Laravel, Django, Shopify custom themes, and simple static sites.

```html
<script
  async
  src="https://cdn.rejourney.co/web/v0.1.0/rejourney.min.js"
  integrity="sha384-REPLACE_WITH_VERSIONED_HASH"
  crossorigin="anonymous"
  data-rj-public-key="rj_live_xxxxxxxxxxxx"
  data-rj-auto-start="false"
  data-rj-api-url="https://api.rejourney.co"
></script>
```

After consent:

```html
<script>
  window.Rejourney.start();
</script>
```

For CSP:

- Offer a self-hosted script URL.
- Use immutable versioned CDN URLs. Never document `@latest` or floating `/v0/` URLs for production installs.
- Publish SRI hashes per exact version and include `crossorigin="anonymous"`.
- Document the required `connect-src` domain for `apiUrl`; for dashboard replay, also document that signed object-storage reads need provider access or a same-origin API proxy fallback.
- Do not require `unsafe-inline` or `unsafe-eval`.
- If a customer chooses inline config anyway, document nonce/hash-based CSP rather than relaxing the whole site.

### React / Vite / CRA

Use an effect in the app root:

```tsx
import { useEffect } from 'react';
import { initRejourney, startRejourney } from '@rejourneyco/browser';

export function RejourneyWeb() {
  useEffect(() => {
    initRejourney('rj_live_xxxxxxxxxxxx');
    startRejourney();
  }, []);

  return null;
}
```

React Strict Mode runs effect setup/cleanup extra in development. The SDK must be idempotent: multiple `init()` or `start()` calls should not create duplicate sessions or double-patch fetch/XHR.

Adapter:

```tsx
import { RejourneyProvider } from '@rejourneyco/browser/react';

<RejourneyProvider publicKey="rj_live_xxxxxxxxxxxx" startOnMount />
```

### Next.js App Router

Next App Router layouts/pages are Server Components by default. Browser APIs must live in a Client Component.

```tsx
// app/rejourney-client.tsx
'use client';

import { useEffect } from 'react';
import { initRejourney, startRejourney } from '@rejourneyco/browser';

export function RejourneyClient() {
  useEffect(() => {
    initRejourney(process.env.NEXT_PUBLIC_REJOURNEY_KEY!);
    startRejourney();
  }, []);

  return null;
}
```

```tsx
// app/layout.tsx
import { RejourneyClient } from './rejourney-client';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <RejourneyClient />
        {children}
      </body>
    </html>
  );
}
```

Adapter:

```tsx
import { RejourneyNext } from '@rejourneyco/browser/next';
```

`next/script` can be supported for CDN installs, but handler callbacks only work in Client Components.

### Next.js Pages Router

Initialize in `_app.tsx` with a browser-only effect.

```tsx
import type { AppProps } from 'next/app';
import { useEffect } from 'react';
import { initRejourney, startRejourney } from '@rejourneyco/browser';

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    initRejourney(process.env.NEXT_PUBLIC_REJOURNEY_KEY!);
    startRejourney();
  }, []);

  return <Component {...pageProps} />;
}
```

Route tracking can patch History API generically, but the adapter should also listen to Next router events for cleaner route names.

### Remix

Best integration point is `app/entry.client.tsx`, because Remix documents it as the browser entrypoint where client libraries can be initialized.

```tsx
import { RemixBrowser } from '@remix-run/react';
import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { initRejourney, startRejourney } from '@rejourneyco/browser';

initRejourney(window.ENV.REJOURNEY_KEY);
startRejourney();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RemixBrowser />
    </StrictMode>
  );
});
```

Alternative: root route `useEffect`. Avoid browser-only side effects in route modules that render on the server.

### Vue

Offer a Vue plugin:

```ts
import { createApp } from 'vue';
import { createRejourney } from '@rejourneyco/browser/vue';
import App from './App.vue';
import router from './router';

const app = createApp(App);
app.use(createRejourney({
  publicKey: 'rj_live_xxxxxxxxxxxx',
  router
}));
app.mount('#app');
```

The plugin should:

- initialize after `app.use`;
- start based on config/consent;
- use `router.afterEach` for route names when a router is supplied;
- expose `$rejourney` on app config and `useRejourney()` for Composition API.

### Nuxt 3

Use a client-only plugin. Nuxt supports `.client` plugin suffixes.

```ts
// plugins/rejourney.client.ts
import { defineNuxtPlugin, useRuntimeConfig } from '#app';
import { initRejourney, startRejourney } from '@rejourneyco/browser';

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();
  initRejourney(config.public.rejourneyKey);
  startRejourney();
});
```

Adapter:

```ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';
```

### Angular

Angular v19+ deprecates `APP_INITIALIZER`; current docs recommend `provideAppInitializer`.

```ts
import { ApplicationConfig, provideAppInitializer } from '@angular/core';
import { initRejourney, startRejourney } from '@rejourneyco/browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAppInitializer(() => {
      initRejourney('rj_live_xxxxxxxxxxxx');
      startRejourney();
    })
  ]
};
```

Adapter should also provide:

- `RejourneyService`
- router event tracking for `NavigationEnd`
- `rejourneyMask` directive that writes `data-rj-mask`
- `rejourneyBlock` directive that writes `data-rj-block`

For older NgModule apps, document `APP_INITIALIZER` as legacy.

### SvelteKit

Use `onMount` or a `browser` guard. Svelte `onMount` does not run during server rendering.

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { initRejourney, startRejourney } from '@rejourneyco/browser';

  onMount(() => {
    initRejourney('rj_live_xxxxxxxxxxxx');
    startRejourney();
  });
</script>

<slot />
```

SvelteKit-specific route tracking can use `$app/navigation` hooks later, but History API patching is enough for MVP.

### Astro

Astro pages are server-rendered by default and only hydrate client islands when directed. For a global SDK, plain script integration is simplest:

```astro
---
const key = import.meta.env.PUBLIC_REJOURNEY_KEY;
---

<script define:vars={{ key }}>
  window.RejourneySettings = { publicKey: key, autoStart: true };
</script>
<script async src="https://cdn.rejourney.co/web/v0/rejourney.min.js"></script>
```

If using a React/Vue/Svelte island, hydrate it with `client:load`:

```astro
<RejourneyClient client:load />
```

### Gatsby

Use `gatsby-browser.ts` because Gatsby documents it as the browser-side API file.

```ts
// gatsby-browser.ts
import { initRejourney, startRejourney, Rejourney } from '@rejourneyco/browser';

export const onClientEntry = () => {
  initRejourney(process.env.GATSBY_REJOURNEY_KEY!);
  startRejourney();
};

export const onRouteUpdate = ({ location }) => {
  Rejourney.trackScreen(location.pathname);
};
```

### SolidStart

Use `onMount` in a root client component and guard server rendering:

```tsx
import { onMount } from 'solid-js';
import { isServer } from 'solid-js/web';
import { initRejourney, startRejourney } from '@rejourneyco/browser';

export function RejourneySolid() {
  onMount(() => {
    if (isServer) return;
    initRejourney('rj_live_xxxxxxxxxxxx');
    startRejourney();
  });
  return null;
}
```

### Qwik

Use a visible/browser task or script integration. Because Qwik's resumability model is sensitive to eager client code, prefer the CDN snippet or a small component that starts after the app is interactive. Treat Qwik as a second-wave adapter unless customers ask for it.

## Local K8s And Production K8s

This section is based on the current `local-k8s/`, `k8s/`, Dockerfile, and deployment script layout.

### Current Topology

Production Kubernetes:

- `k8s/api.yaml`
  - `api-ingest` handles SDK ingest traffic and is colocated with the Postgres primary.
  - `api-dashboard` handles dashboard/general API traffic and prefers the read-replica side.
  - `/api/ingest/*` and exact `/api/sdk/config` on `api.rejourney.co` route to `api-ingest`.
- `k8s/ingress.yaml`
  - `api.rejourney.co` has a high-priority ingest ingress for `/api/ingest` and `/api/sdk/config`.
  - Upload relay routes can still target `ingest-upload` internally when returned by the backend.
  - `rejourney.co` routes to the dashboard `web` service.
- `k8s/workers.yaml`
  - `ingest-worker` processes `events`, `crashes`, and `anrs`.
  - `replay-worker` processes mobile replay artifacts.
  - `session-lifecycle-worker` handles reconciliation/finalization.
- `k8s/hpa.yaml`
  - `api-ingest`, `ingest-worker`, and `replay-worker` already autoscale separately.

Local Kubernetes:

- `local-k8s/README.md` documents two flows:
  - `npm run dev` runs infrastructure in k3d and app services on the host.
  - `npm run dev:full` builds/imports local images and runs full app deployments in k3d.
- `local-k8s/ingress.yaml`
  - `rejourney.localtest.me` for dashboard.
  - `api.localtest.me` for API and SDK ingest paths.
- `local-k8s/api.yaml`
  - Local full parity uses a single `api` deployment instead of splitting `api-ingest` and `api-dashboard`.
  - It still has a separate `ingest-upload` deployment on port 3001.
- `local-k8s/workers.yaml`
  - Mirrors the worker split enough to test rrweb artifact processing.
- `scripts/check-worker-parity.mjs`
  - Currently verifies local/prod worker deployment existence and a few concurrency env vars. It passed at the time of this check.

### Endpoint Placement

Recommended web SDK endpoint behavior:

- `apiUrl` default: `https://api.rejourney.co`
  - Used for `/api/sdk/config`.
  - Used for `/api/ingest/auth/device` or future `/api/ingest/auth/client`.
  - Used for `/api/ingest/rrweb/presign` and `/api/ingest/rrweb/complete`.
  - Upload relay URLs returned by the backend continue to decide where artifact bytes go.

Ingress keeps high-volume rrweb traffic on the ingest data plane in production while the SDK still uses one public base URL, matching mobile:

```ts
initRejourney('rj_live_xxxxxxxxxxxx', {
  apiUrl: 'http://api.localtest.me'
});
```

Do not expose a separate ingest URL in normal customer config. Self-hosted installs should put `/api/ingest/*` behind the same public API base and route internally.

### K8s Manifest Changes For Web Replay

No new Kubernetes deployment is required for the MVP if rrweb artifacts reuse the existing ingest API, upload relay, replay queue, replay worker, and lifecycle worker. The required manifest and config work is still real:

- `k8s/api.yaml`
  - Add any new web ingest env flags to `api-ingest`.
  - Add the same flags to `api-dashboard` only if dashboard routes need them.
  - Consider a higher `NODE_OPTIONS` cap for `api-ingest` if rrweb presign/complete validation grows, but keep raw rrweb processing in workers.
- `k8s/workers.yaml`
  - Add env flags to `replay-worker` for rrweb limits if they are runtime-configured.
  - Watch memory. rrweb chunks are JSON-heavy after gunzip. Keep chunk size small enough that a replay worker can process several jobs concurrently.
  - If mobile replay latency regresses, split web replay into a dedicated `rrweb-worker` deployment and queue instead of letting large rrweb chunks starve screenshot verification.
- `k8s/hpa.yaml`
  - Revisit `replay-worker` max replicas and CPU target after load testing rrweb JSON validation.
  - CPU-only HPA may not react well to Redis queue backlog. Add queue-depth alerts even if HPA stays CPU-based.
- `k8s/ingress.yaml`
  - Existing routing covers `/api/ingest/rrweb/*` if those routes live under `/api/ingest`.
  - Dashboard replay reads signed rrweb segment and screenshot frame URLs directly from object storage, so production CSP must allow HTTPS object-storage reads dynamically (`connect-src 'self' https: wss://api.rejourney.co`, `media-src 'self' https: blob:`). Do not hardcode provider hostnames; active `storage_endpoints` can be Hetzner, OVH, Scaleway, MinIO, or another S3-compatible endpoint.
  - If direct object reads fail because of CSP or bucket CORS, the dashboard falls back to `/api/session/rrweb-segment/*` and `/api/session/frame/*`, which protects playback but moves replay bytes back onto `api-dashboard`.
  - If we introduce `cdn.rejourney.co`, add a separate CDN/storage plan rather than serving versioned SDK bundles from the dashboard pod.
  - If the Rejourney marketing/dashboard site dogfoods the SDK, update CSP `script-src` for the SDK script host and `connect-src` for the API host.
- `local-k8s/api.yaml`, `local-k8s/workers.yaml`, and `local-k8s/ingress.yaml`
  - Mirror production env flags and route assumptions.
  - Local CSP should allow `http:` and `https:` object reads so MinIO/local providers and external test buckets work.
  - Keep local web SDK docs and Playwright fixtures pointed at the API host; ingress should route `/api/ingest/*` internally.
- `local-k8s/env.example`
  - Add example values for any web replay env flags.
  - Existing `PUBLIC_API_URL` should map to the host-local API default.
- `scripts/local-k8s/k8s-sync-secrets.sh` and `scripts/k8s/k8s-sync-secrets.sh`
  - Add new secret/config values only if they are sensitive or environment-specific.
  - Prefer non-secret env literals in manifests for generic limits; use secrets for keys and private endpoints.
- `docker-compose.selfhosted.yml`
  - Mirror any new env vars so self-hosted users can run web replay too.
  - The self-hosted Traefik CSP also needs SDK/CDN/connect updates if dogfooding or snippet hosting depends on it.

### Deployment Risks Specific To rrweb

- Redis memory pressure. The upload relay buffers artifacts in Redis before S3 flush. rrweb chunks must stay small; do not raise chunk size casually just because `INGEST_MAX_OBJECT_BYTES` is 25 MB.
- Replay queue starvation. Today the replay queue is mobile screenshot/hierarchy only. Add `rrweb` carefully and preserve mobile replay latency with priority, per-session limits, or a separate queue.
- Worker memory spikes. Gunzipping and parsing rrweb JSON can temporarily hold compressed bytes, decompressed bytes, parsed objects, and validation copies. Size limits should be based on peak memory, not only object storage size.
- Config cache mistakes. Web config varies by origin and bot classification. A public-key-only response cache can accidentally allow a blocked origin or suppress a valid one.
- CSP mismatches. There are multiple CSP definitions: production Traefik, local Traefik, self-hosted Traefik, and development SSR. Keep them aligned when adding SDK script/CDN/connect hosts.
- Docker workspace drift. Adding `packages/browser` without updating Dockerfile manifest-copy layers can break production and local image builds.
- Local/prod parity drift. If we add an `rrweb-worker`, update `scripts/check-worker-parity.mjs` so CI fails when local manifests forget it.
- Public-key abuse. Public `rj_...` browser keys need origin checks, bot suppression, byte budgets, and non-billable suppression counters in both local and prod paths.

## Implementation Phases

### Phase 0: Spike

Goal: prove rrweb event capture, upload, and dashboard playback inside Rejourney.

- Create throwaway local web test app.
- Record rrweb events with strict masking.
- Store a sample `.json.gz` artifact manually.
- Build a temporary dashboard route that loads events and replays them.
- Verify CSS, route changes, click markers, network markers, errors, and bfcache behavior.

Exit criteria:

- A local rrweb replay opens in the Rejourney dashboard.
- Masked inputs never appear in stored payloads.
- Session closes correctly without `/session/end`.

### Phase 1: Backend Artifact Support

- Add `rrweb` artifact routes or extend ingest with a safe new kind.
- Add processor validation.
- Update `artifactBullQueue.ts`, `workerDefinitions.ts`, and replay-worker detection so rrweb is processed by the intended replay path.
- Update worker kind priorities so web replay does not starve existing mobile replay.
- Update session reconciliation and presentation state.
- Add session detail payload fields.
- Add stats bytes and cache invalidation.
- Update `/api/sdk/config` caching so web-origin/bot-specific responses are not cached by public key only.
- Add backend bot/scraper classification before auth/session materialization.
- Add tests for:
  - rrweb presign/complete;
  - ready rrweb marks replay available;
  - hierarchy alone does not mark replay available;
  - mixed mobile/web artifacts do not break existing sessions;
  - immutable/closed sessions reject new replay work correctly.

### Phase 2: Web SDK Core

- Build `@rejourneyco/browser`.
- Implement config fetch, auth token, session id, sampling, start/stop.
- Implement mobile-style single `apiUrl` handling and rely on ingress for `/api/ingest/*` routing.
- Implement rrweb recorder wrapper.
- Implement event queue, rrweb queue, gzip, retry, IndexedDB persistence.
- Implement lifecycle handling.
- Implement network/error/long task/route tracking.
- Implement privacy selectors and APIs.
- Implement bot/scraper/prerender/automation suppression before config fetch.
- Implement SDK telemetry.
- Add vitest/unit tests and Playwright browser tests.

### Phase 3: Dashboard Playback

- Add `RrwebReplayPlayer`.
- Integrate with session detail route.
- Add `@rrweb/replay` or `rrweb-player` to `dashboard/web-ui` dependencies if the dashboard owns playback directly.
- Add loading/error/empty states.
- Add timeline marker sync.
- Add web stats labels.
- Add generic web thumbnail.
- Add E2E tests with saved rrweb fixtures.

### Phase 4: Framework Adapters And Docs

- React/Next/Vue/Nuxt/SvelteKit/Angular/Remix/Astro/Gatsby docs.
- Thin adapter entrypoints.
- Consent/CMP examples.
- Privacy policy wording.
- CSP/SRI docs.
- Troubleshooting docs for CSS, iframes, canvas, ad blockers, and masking.

### Phase 5: Hardening And Rollout

- Internal dogfood on `rejourney.co`.
- Update CSP in production k8s, local k8s, self-hosted Traefik, and dev SSR before dogfooding.
- Launch behind project-level feature flag.
- Start with low sample rate.
- Monitor:
  - ingest byte volume;
  - chunk failure rate;
  - replay open failure rate;
  - rrweb player crash rate;
  - P95 SDK main-thread overhead;
  - average bytes per minute;
  - bot/scraper suppression count and false-positive reports;
  - Redis memory and artifact flush backlog;
  - replay queue waiting/active/failed counts by kind;
  - privacy-block/mask coverage.
- Expand to beta customers after fixture coverage includes their frameworks.

### Phase 6: Packaging, Local K8s, And Release

- Add `packages/browser` build/typecheck/test/package scripts.
- Vendor the first three web example apps:
  - `examples/web-next/` from `ixartz/Next-js-Boilerplate`;
  - `examples/web-sveltekit/` from `sveltejs/realworld`;
  - `examples/web-nuxt/` from `nuxt-ui-templates/dashboard`.
- Update root build/clean/postinstall behavior for both SDK packages.
- Update `backend/Dockerfile` and `dashboard/web-ui/Dockerfile` to copy `packages/browser/package.json`.
- Add a web SDK GitHub Actions job and publish workflow.
- Update `scripts/local-k8s/rejourney-ci.sh` to check the web SDK.
- Run `npm run ci:local:fast` before release to prove local k8s image-build parity.
- Run prod manifest review for:
  - env vars;
  - HPA/resource limits;
  - CSP;
  - ingress routing;
  - worker queue ownership.

## Test Matrix

Browsers:

- Chrome desktop and Android
- Safari desktop and iOS
- Firefox desktop
- Edge desktop

Framework fixtures:

- Plain HTML
- React + Vite
- Next App Router
- Next Pages Router
- Remix
- Vue
- Nuxt 3
- Angular standalone
- SvelteKit
- Astro
- Gatsby

GitHub example apps to vendor into `examples/` first:

| Example path | Source repo | Stack/config | License and recency | What it proves |
|---|---|---|---|---|
| `examples/web-next/` | `ixartz/Next-js-Boilerplate` | Next.js App Router and Pages Router, React, Tailwind, Playwright | MIT, pushed 2026-05-12 | Browser-only startup, React Strict Mode idempotency, route tracking, env public key setup |
| `examples/web-sveltekit/` | `sveltejs/realworld` | SvelteKit real-world app with auth-like flows, CRUD, forms, routing | MIT, pushed 2026-05-15 | `onMount` startup, SPA navigation, form masking, network/error tracking |
| `examples/web-nuxt/` | `nuxt-ui-templates/dashboard` | Nuxt/Vue/Nuxt UI dashboard template | MIT, pushed 2026-05-14 | `.client` plugin setup, SSR hydration, dashboard-style interactions, route naming |

Vendor rules:

- Preserve each source repo's license file in the example directory.
- Add `examples/web-*/SOURCE.md` with source URL, source commit SHA, license, date imported, and any local patches.
- Keep Rejourney SDK integration in a small clearly named file so future source updates are easy to rebase.
- Prefer pinning source commits over tracking upstream `main`.
- Do not add examples whose license is missing, unclear, GPL/AGPL, or stale.
- Strip or disable upstream GitHub Actions, deploy configs, analytics snippets, production secrets examples, and unrelated release automation before committing examples.
- Review `postinstall`, `prepare`, and dev-server scripts before running them. Do not run arbitrary upstream scripts in CI without pinning and review.
- Keep each example on isolated local ports and isolated test project keys so example traffic cannot contaminate real customer projects.

Replay fidelity fixtures:

- Static DOM
- SPA navigation
- Forms with text, email, password, OTP
- Masked content and blocked content
- Long lists
- CSS animations
- Lazy-loaded images
- Same-origin and cross-origin stylesheets
- Shadow DOM open component
- Closed shadow root component as opaque/blocked
- Canvas chart with recording disabled
- Canvas chart with recording enabled
- Same-origin iframe
- Cross-origin iframe
- Payment iframe blocked
- Offline then reconnect
- bfcache restore
- Multiple tabs

Privacy fixtures:

- Password show/hide toggle.
- Credit-card field.
- Email in input and in normal text.
- API token in URL query params.
- OAuth callback URL with `code` and `state`.
- Entry URL with UTM params plus sensitive params; only attribution allowlist survives.
- Referrer URL with sensitive query params; stored referrer is scrubbed.
- Console log with email/token.
- Hidden DOM node with sensitive text.
- Third-party widget.

Security fixtures:

- rrweb payload containing `<script>`, event-handler attributes, `javascript:` URLs, SVG/MathML payloads, `srcdoc`, forms, and external links does not execute in the dashboard.
- Replay iframe cannot read dashboard cookies, local storage, session storage, CSRF tokens, or parent DOM.
- Replay clicks cannot top-navigate the dashboard, open popups, submit forms, download files, or access clipboard/device APIs.
- Replay asset loads use no-referrer behavior and cannot target private IP ranges, localhost, link-local addresses, or cloud metadata endpoints.
- CORS rejects unapproved origins and sends `Vary: Origin`.
- Web ingest rejects missing/mismatched origin for browser SDK requests.
- Upload token stolen from one origin cannot presign or complete from another origin.
- Relay token cannot upload a different artifact, session, project, or kind.
- Logs do not include raw rrweb bodies, raw full URLs with tokens, upload relay query tokens, or authorization headers.
- IndexedDB queue is cleared on consent revocation, logout hook, stop, and TTL expiry.
- SDK does not install a Service Worker unless the customer explicitly opts into a future dedicated worker integration.
- CDN snippet works with SRI and strict CSP without `unsafe-inline` or `unsafe-eval`.

Attribution fixtures:

- Direct visit with no referrer and no query params.
- Organic search referrer with no UTM params.
- Paid search click with `gclid`, `gbraid`, or `wbraid`.
- Paid social click with `fbclid`, `ttclid`, or `twclid`.
- Email campaign with `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, and `utm_content`.
- Internal navigation after landing does not overwrite original attribution.
- Consent-delayed start preserves only allowed attribution according to config.

### Web session lifecycle

Browser sessions are tab-runtime scoped. A visible page starts one active SDK
session. Calling `start()` while that session exists reuses it; a new session is
created only after the old one is stopped, expires, or the browser creates a new
JavaScript runtime.

The web session duration cap is 30 minutes by default and is controlled by the
project's `webMaxObservabilityMinutes` remote setting. The dashboard allows
1..30 minutes for web projects. Mobile still uses `maxRecordingMinutes` and is
clamped to 1..10 minutes.

Hidden-tab behavior is resumable:

- `visibilitychange` to hidden emits one `app_background` event and flushes
  queued event/rrweb chunks.
- If the tab becomes visible again before the configured web cap is crossed, the
  SDK emits `app_foreground`, adds the background duration to the eventual
  `/session/end` payload, and continues recording into the same session.
- If the tab becomes visible after the cap is crossed, the SDK closes the old
  session anchored at the time the page was hidden, then starts a new session.
- `pagehide` with `persisted: true` is treated as bfcache entry and does not
  final-close the session.
- `pagehide` with `persisted: false` is treated as navigation/close/reload and
  sends a best-effort `/session/end`. A closed tab later opened again starts a
  new session because the original JS runtime is gone.

Replay behavior compresses background gaps. The real background interval is
stored for duration math, but dashboard playback maps each
`app_background` -> `app_foreground` interval to a short two-second overlay:
`User left the page - Away for X`. Playback then jumps into the foreground
segment instead of waiting for the real wall-clock gap.

Performance fixtures:

- 30 minute web session.
- 1,000 DOM mutations/min.
- Large stylesheet.
- High-frequency scroll.
- Background tab throttling.
- CPU-throttled mobile browser.

Bot/scraper suppression fixtures:

- Googlebot, Bingbot, DuckDuckBot, Applebot.
- Slackbot, Discordbot, facebookexternalhit, Twitterbot/X bot, LinkedInBot.
- AhrefsBot, SemrushBot, MJ12bot, DotBot, CCBot, GPTBot.
- Chrome Lighthouse, PageSpeed Insights, GTmetrix, Pingdom/UptimeRobot.
- `navigator.webdriver === true` in Playwright.
- Normal Chrome, Safari, Firefox, and Edge user agents are not suppressed.

Local k8s fixtures:

- `npm run dev` hybrid flow:
  - web fixture points at `http://127.0.0.1:3000` and `http://127.0.0.1:3001`;
  - rrweb chunks upload through the relay;
  - replay worker running from source marks artifact ready.
- `npm run dev:full` full-cluster flow:
  - web fixture points at `http://api.localtest.me`;
  - MinIO contains `rrweb/*.json.gz`;
  - Postgres has `recording_artifacts.kind = 'rrweb'`;
  - session becomes `replayAvailable = true`;
  - dashboard can open rrweb playback.
- Run `node scripts/check-worker-parity.mjs` after any worker manifest change.

Production-like k8s fixtures:

- `api.rejourney.co/api/sdk/config` routes to `api-ingest`.
- `api.rejourney.co/api/ingest/rrweb/presign` routes to `api-ingest`.
- Backend-returned upload relay URLs route artifact bytes to `ingest-upload`.
- `replay-worker` processes rrweb jobs without increasing mobile screenshot replay latency.
- `session-lifecycle-worker` finalizes web sessions using rrweb readiness and the 60-second server live-ingest fail-safe.
- CSP on `rejourney.co` allows dogfood SDK script/connect hosts and still blocks unexpected third-party script hosts.

## Decisions To Make Before Coding

1. Console default on web.
   - Recommendation: off by default, supported as opt-in.
2. Canvas support at launch.
   - Recommendation: off by default, documented opt-in after security review.
3. CDN snippet at launch.
   - Recommendation: npm first, CDN after package stabilizes and CSP/SRI docs are ready.
4. rrweb event endpoint shape.
   - Resolved for dashboard playback: use `/api/session/:id/replay-manifest` with signed direct segment URLs first and same-origin proxy URLs as fallback. Keep a server-side merged event endpoint only as a future repair/redaction/export tool if needed.
5. Thumbnail strategy.
   - Recommendation: generic web thumbnail for MVP, headless renderer later.
6. Consent API.
   - Recommendation: explicit `start()` after consent, plus helper `setConsent()`.
7. Framework adapter depth.
   - Recommendation: maintain deep adapters only for React/Next/Vue/Nuxt/Angular/SvelteKit; docs-only examples for the rest until demand appears.
8. Web hidden-tab rollover threshold.
   - Recommendation: do not use 60 seconds for client session splitting. Use 30 minutes, configurable remotely, while keeping the server's 60-second live-ingest fail-safe.
9. rrweb worker ownership.
   - Recommendation: start on the existing replay worker only if load tests show mobile replay is not delayed. Split to an `rrweb-worker` and queue if rrweb validation creates backlog or memory pressure.
10. Web SDK endpoint defaults.
   - Recommendation: one customer-facing `apiUrl` for config and ingest endpoints. Ingress should route `/api/ingest/*` to `api-ingest`, matching the mobile SDK model.
11. Attribution storage shape.
   - Recommendation: store normalized acquisition data in `sessions.metadata.acquisition` and the first `events` artifact, with dashboard filters built from normalized fields rather than raw URLs.

## Things That Will Bite Later If Ignored

- Treating rrweb chunks as mobile screenshots. This will fight the entire dashboard and lifecycle model.
- Marking only `screenshots` as replay-available. Web sessions would ingest successfully but never open.
- Adding `packages/browser` without updating Dockerfile workspace manifest-copy layers.
- Caching `/api/sdk/config` web responses by public key only even though origin/bot/platform can change the response.
- Routing rrweb jobs to the ingest worker queue because `REPLAY_KINDS` was not updated.
- Letting rrweb worker load starve mobile screenshot replay.
- Forgetting local-k8s/prod worker parity when adding an rrweb-specific worker or env var.
- Dogfooding the SDK on `rejourney.co` without updating every CSP source of truth.
- Storing unsanitized entry/referrer URLs and accidentally capturing OAuth codes, magic links, emails, or access tokens.
- Letting SPA route changes overwrite the original external attribution source.
- Copying mobile's 60-second background rollover directly to web and splitting normal tab-switch/OAuth/payment flows.
- Recording bots, scrapers, link unfurlers, synthetic monitors, and Playwright/Cypress traffic by default.
- Starting capture before consent on public websites.
- Leaving inputs unmasked by default.
- Capturing console logs by default without clear warning.
- Trying to flush large rrweb chunks on `pagehide`.
- Using `unload` or trusting `/session/end`.
- Loading the SDK in SSR paths without browser guards.
- Using `@latest` rrweb packages.
- Capturing all images/fonts/canvas by default and exploding storage.
- Letting the public browser key become a cheap abuse vector without origin checks and byte budgets.
- Returning full rrweb event arrays from `/bootstrap`.
- Letting old CSS/assets drift so old replays no longer look like the original session.
- Not building replay fixture tests before upgrading rrweb.

## Source Notes

Primary/reference sources used:

- rrweb overview and use cases: https://rrweb.com/
- rrweb guide, install, record/replay options, privacy controls, checkout snapshots: https://rrweb.com/docs/guide
- rrweb asset capture behavior and stylesheet/image options: https://rrweb.com/docs/assets
- rrweb storage optimization, sampling, and compression guidance: https://rrweb.com/docs/recipes/optimize-storage
- rrweb canvas recording and unsafe replay caveat: https://rrweb.com/docs/recipes/canvas
- rrweb console plugin: https://rrweb.com/docs/recipes/console
- `isbot` package for bot/crawler user-agent classification: https://www.npmjs.com/package/isbot
- OWASP XSS Prevention Cheat Sheet for stored/DOM XSS risk in replay rendering: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP Logging Cheat Sheet for avoiding sensitive data in logs: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- OWASP API Security API4 unrestricted resource consumption guidance: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- OWASP File Upload Cheat Sheet for upload size/type/storage controls: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- OWASP CORS testing guidance for origin/credentials pitfalls: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/07-Testing_Cross_Origin_Resource_Sharing
- MDN `sendBeacon`, visibility guidance, and 64 KiB queued-data limit: https://developer.mozilla.org/docs/Web/API/Navigator/sendBeacon
- MDN `fetch` `keepalive` body-size limit: https://developer.mozilla.org/en-US/docs/Web/API/RequestInit
- MDN Subresource Integrity guidance: https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity
- web.dev bfcache guidance against `unload`: https://web.dev/articles/bfcache
- Chrome Page Lifecycle guidance: https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- React `useEffect` as the browser/external-system hook: https://react.dev/reference/react/useEffect
- Next.js Client Components and browser API boundary: https://nextjs.org/docs/app/getting-started/server-and-client-components
- Next.js scripts guide: https://nextjs.org/docs/app/guides/scripts
- Vue plugins: https://vuejs.org/guide/reusability/plugins
- Nuxt client-only plugins: https://nuxt.com/docs/3.x/guide/directory-structure/plugins
- Angular `provideAppInitializer`: https://angular.dev/api/core/provideAppInitializer
- Svelte `onMount`: https://svelte.dev/docs/svelte/lifecycle-hooks
- SvelteKit `$app/environment` browser flag: https://svelte.dev/docs/kit/$app-environment
- Remix `entry.client`: https://remix.run/docs/en/main/file-conventions/entry.client
- Remix module constraints for browser-only code: https://remix.run/docs/en/main/guides/constraints
- Astro client directives: https://docs.astro.build/en/reference/directives-reference/
- Gatsby browser APIs: https://www.gatsbyjs.com/docs/reference/config-files/gatsby-browser/
- CNIL 2026 draft recommendation concerning session replay tools: https://www.cnil.fr/sites/default/files/2026-02/recommendation_draft_session_replay.pdf
- CNIL audience measurement/cookie exemption context: https://www.cnil.fr/fr/cookies-solutions-pour-les-outils-de-mesure-daudience
- FTC PrivacyCon transcript discussing session replay privacy leakage research: https://www.ftc.gov/system/files/documents/videos/privacy-con-2018-part-1/ftc_privacycon_2018_-_transcript_segment_1.pdf
- GitHub example app candidate, Next.js: https://github.com/ixartz/Next-js-Boilerplate
- GitHub example app candidate, SvelteKit: https://github.com/sveltejs/realworld
- GitHub example app candidate, Nuxt: https://github.com/nuxt-ui-templates/dashboard

Additional local deployment/code files checked during the final pass:

- `package.json`
- `backend/Dockerfile`
- `backend/Dockerfile.migration`
- `dashboard/web-ui/Dockerfile`
- `.github/workflows/rejourney-ci.yml`
- `.github/workflows/rejourney-sdk.yml`
- `scripts/local-k8s/rejourney-ci.sh`
- `scripts/check-worker-parity.mjs`
- `local-k8s/README.md`
- `local-k8s/api.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`
- `local-k8s/env.example`
- `k8s/api.yaml`
- `k8s/workers.yaml`
- `k8s/ingress.yaml`
- `k8s/hpa.yaml`
- `k8s/web.yaml`
- `docker-compose.selfhosted.yml`
- `backend/src/config.ts`
- `backend/src/routes/sdk.ts`
- `backend/src/routes/ingestDeviceAuth.ts`
- `backend/src/routes/ingestUploads.ts`
- `backend/src/services/artifactBullQueue.ts`
- `backend/src/services/artifactJobProcessor.ts`
- `backend/src/services/ingestArtifactLifecycle.ts`
- `backend/src/services/sessionPresentationState.ts`
- `backend/src/services/sessionReconciliation.ts`
- `backend/src/worker/workerDefinitions.ts`
- `backend/src/worker/startArtifactWorker.ts`
