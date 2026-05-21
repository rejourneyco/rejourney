# Ingest + Session Recording Lifecycle (Visual)

Last updated: 2026-05-21

This doc is the ingest/runtime view: package start, upload lanes, relay, workers, Redis, and Postgres session state.

Deploy topology (which process runs where) lives in [All things cloud](/Users/mora/Desktop/Dev-mac/rejourney/dev_docs/allthingscloud.md). Deploy, `db-setup`, GitHub Actions, and local parity are in [Rejourney CI + Deploy Path](/Users/mora/Desktop/Dev-mac/rejourney/dev_docs/rejourney-ci.md).

Shortest correct mental model:

- The package usually creates a client-side `session_{timestamp}_{uuid}` ID and uploads under that ID.
- The first successful presign materializes the session row and counts billing once.
- Postgres is the source of truth for session lifecycle, artifact lifecycle, metrics, and usage.
- Redis is the write-ahead buffer + job queue plane: tiny relay uploads land in `artifact:buf:{artifactId}` first, then BullMQ workers flush them to S3 and process them.
- Replay becomes visible when at least one screenshot or rrweb artifact reaches `ready`.
- Dashboard replay open should load the cheap session core first, then a replay manifest. rrweb segment bytes and materialized screenshot frames should normally come from signed object-storage URLs, with API proxy routes as fallback.
- `/api/ingest/session/end` is a strong hint, but the backend must still work if the SDK never calls it.
- The backend decides "live vs closed" from `ended_at`, `last_ingest_activity_at`, open replay work (`pending`, `buffered`, or `uploaded`), newer-session rollover, and the platform's finalization window; not from a single client callback.
- A session stops presenting as live ingest after 60 seconds without ingest touches, or immediately once `ended_at` is set. For web, that 60-second live-badge timeout is not the same as final session closure: the row stays resumable until the web max observability window expires, unless the tab explicitly ends or a newer same-visitor session supersedes it.
- Late uploads may still arrive after close. They can finish artifact processing, but they must not clear `ended_at`, must not clear `duration_seconds`, and must not make the old row look live again.
- Hard ingest stops are intentionally narrow: `failed`, `deleted`, `recording_deleted`, or `is_replay_expired`.
- The web SDK must not record Rejourney ingest/upload traffic as customer network activity. Ingest API routes and upload relay URLs are ignored by default so artifact uploads cannot recursively create more `network_request` events.
- A visible web tab with no meaningful user activity enters an idle pause after 60 seconds: the SDK emits `app_background` with `reason=idle_timeout`, flushes once, pauses rrweb/upload timers, and resumes as an `app_foreground` gap if the user interacts again before the max session window.
- Web startup time comes from browser performance timing. The SDK emits one `app_startup` event per session using `loadEventEnd` when available, with DOMContentLoaded/response/current-time fallbacks if it starts before load completes.
- Web same-tab hard navigations use tab-scoped `sessionStorage` to continue the active session across reloads, Next 404s, and browser Back/Forward. Closing the tab clears that storage, so reopening starts a new session.
- Web user identity is project-scoped in `localStorage` once `setUserIdentity()` is called. Refreshes and same-tab restores re-emit `user_identity_changed`; `clearUserIdentity()` removes the stored value and sends a clearing event so the backend does not leave a stale dashboard identity.
- If a plain JavaScript customer passes a numeric user id, the web SDK normalizes it to a string. Identity set before `initRejourney()` is carried into the first initialized project, while re-initializing with a different public key does not reuse another project's identity.
- Replay playback compresses both paired background/foreground gaps and final open-ended background tails. A user who leaves and never returns sees a short "user left" segment and then replay ends; the player must not show a long blank tail.
- Visual replay duration comes from replay/session timing, not from every telemetry marker. Late analytics, close, or lifecycle events remain in the activity feed, but they must not stretch rrweb/screenshot playback or pile markers at the end of the timeline.

## Web SDK Behavior Matrix

These are the case-by-case rules the web SDK and dashboard replay viewer should hold. The storage model is:

- Anonymous visitor id: first-party `localStorage`, currently browser-profile scoped.
- User identity: project-scoped `localStorage`, set only by `setUserIdentity()`.
- Active session restore state: project-scoped `sessionStorage`, so it survives same-tab reloads and hard navigations but is absent on a normal fresh tab.
- Restore guard: the stored session must match project key + visitor id, still be inside the max session duration, and have a non-expired upload token.
- Active-tab ownership guard: a `localStorage` lease prevents a duplicated tab from reusing a session that another live document still owns.

### Start, Sampling, and Identity

| Behavior | SDK session decision | Upload / backend result | Replay result | Dashboard / developer expectation |
| --- | --- | --- | --- | --- |
| `initRejourney()` with `autoStart=false` | No session until `start()` is called. | No ingest until `start()`. | No replay. | SDK is initialized but not recording. |
| `initRejourney()` with `autoStart=true`, or explicit `start()` | Starts a new session unless a same-tab stored session can be restored. | First successful presign materializes the backend row and counts billing once. | Replay starts if sampled in and replay is enabled. | Session appears live once artifacts/events arrive. |
| Remote config disabled, billing blocked, domain blocked, or bot suppressed | No session starts. | No ingest. | No replay. | Nothing should appear for that page load. |
| Sampled out but analytics still allowed | Session may start with `sampledIn=false`; replay is disabled. | Event lane can upload analytics; replay presign is skipped/rejected. | No visual replay. | Developer may see analytics-only data, not a playable replay. |
| `observeOnly=true` or replay consent false | Session can start; `replayEnabled=false`. | Event lane uploads; rrweb is not started. | No visual replay. | Useful for analytics without replay capture. |
| `setUserIdentity()` before `initRejourney()` | Identity is kept in memory and attached once a project is initialized. | First event batch carries the user id. | No direct visual change. | Refresh/new same-profile sessions re-identify under that project. |
| `setUserIdentity()` during an active session | Same active session continues. | Emits `user_identity_changed`; backend updates `userDisplayId`. | Replay remains continuous. | Dashboard row should switch from anonymous name to provided user id after processing. |
| `setUserIdentity()` then refresh | Same-tab session restores if inside max duration; otherwise a new session starts. | SDK re-emits `user_identity_changed` from project-scoped storage. | Same replay if restored; new replay if expired/new tab. | User id should not randomly disappear on refresh. |
| `clearUserIdentity()` | Same session continues; stored project identity is removed. | Emits clearing `user_identity_changed`; backend clears stale `userDisplayId` / anonymous display id. | Replay remains continuous. | Logout should stop showing the previous logged-in user on that session after processing. |
| Local/session storage unavailable | SDK falls back to in-memory state for the current page. | Uploads can still work for that page. | Current page can replay; refresh/close cannot restore identity/session. | Private/quota-restricted browsers may create more new sessions. |

### Navigation, Tabs, and Lifecycle

| Behavior | SDK session decision | Upload / backend result | Replay result | Dashboard / developer expectation |
| --- | --- | --- | --- | --- |
| SPA navigation via `pushState`, `replaceState`, `popstate`, or hash change | Same session. | Emits `navigation` if route tracking is on. | Continuous replay, no away overlay. | Page journey gains the new route/screen. |
| Same-tab hard navigation to another app route | Same session if restored inside max duration. | Old document marks background/pagehide and flushes; new document emits foreground on restore. | A short compressed away segment can appear for the reload/navigation gap. | One session/replay, not one per hard route. |
| Same-tab refresh | Same session if restored inside max duration. | Same as hard navigation. | Replay continues after a compressed reload gap. | Refresh should not create a new session by itself. |
| Same-tab Next/Remix 404 then Back | Same session if restored inside max duration. | 404 page still uses the same tab session; Back restores or continues. | One replay including the 404 route and return route. | No new session solely because the route module was missing or 404. |
| Browser Back/Forward cache (`pagehide.persisted=true`, `pageshow`) | Same session if max duration has not expired. | Emits `app_background` / `app_foreground` around the cached gap. | Gap is compressed. | Back/forward should feel like one user journey. |
| Open a normal new tab/window to the same URL | New session. | Same visitor id may be reused from `localStorage`; session id is new. | Separate replay. | Dashboard can show same visitor with multiple sessions. |
| Duplicate tab / opener-cloned `sessionStorage` | New session while the original document still owns the active-tab lease. | The duplicate clears its cloned active session state and authenticates a fresh session. | Separate replay. | Avoids interleaved chunks from two tabs writing to one session. |
| Open and close a tab before the 5s heartbeat | New session. | SDK immediately flushes `session_start` / startup evidence and the initial rrweb snapshot instead of waiting for the normal heartbeat. | Very short but playable replay if capture is enabled. | Bounce sessions should materialize instead of disappearing. |
| Close tab, then manually open URL in a fresh tab | New session. | Old session may not get `/session/end`; the newer same-visitor session lets backend reconciliation finalize the old row. | Old replay gets an open-ended compressed away tail and then ends. | Fresh open should not append to the closed tab's replay. |
| Browser "reopen closed tab" / session restore | Browser-dependent: some browsers restore `sessionStorage`. | If storage is restored and still inside max duration, SDK may restore unless a stronger closed-tab guard is added. | Could append to the prior replay. | Product expectation is new session; browser restore is the hard edge to guard explicitly. |
| `stop()` called by app | Current session ends. | Flushes, sends `/session/end` best-effort, clears tab session queue/state. | Replay ends at stop. | A later `start()` creates a new session. |

### Away, Idle, and Max Duration

| Behavior | SDK session decision | Upload / backend result | Replay result | Dashboard / developer expectation |
| --- | --- | --- | --- | --- |
| Visible tab, normal activity under 60s idle | Same session. | Click/scroll/navigation/custom events update `lastActivityAt`. | Continuous replay. | Normal single session. |
| Visible tab has no meaningful activity for 60s | Same session enters idle pause. | Emits `app_background(reason=idle_timeout)`, flushes once, pauses rrweb/upload timers and network interception. | Replay shows a compressed "user left" segment. | Session should not stay live forever just because the page is open. |
| Idle pause, user interacts again before max duration | Same session resumes. | Emits `app_foreground(reason=idle_activity)`, restarts upload/rrweb/network, queues the wake event. | Away segment lasts about 2 replay seconds, labeled with real away duration. | Developer sees one replay with a clear absence gap. |
| Idle pause, user never returns | No new client event; old session eventually closes server-side. | LIVE badge ages out after 60s; backend finalizes at explicit close, newer same-visitor session, or web max observability expiry. | Final open-ended background interval is compressed, then replay ends. | No long empty tail after the away overlay. |
| Idle pause, user returns after max duration | Old session closes; new session starts. | Old session sends end best-effort on wake; new auth/session begins. | Two separate replays. | Developer should not see one 45-minute replay. |
| Tab becomes hidden and returns before max duration | Same session. | Emits `app_background` on hidden/pagehide and `app_foreground` on visible/pageshow; flushes on hide. | Hidden gap is compressed; rrweb events inside the gap are dropped by the viewer. | One replay with "user left" overlay, then continuation. |
| Tab hidden, user never returns | Old session may not get a client close. | LIVE badge ages out after 60s; backend finalizes at explicit close, newer same-visitor session, or web max observability expiry. | Open-ended background tail compresses and replay ends. | Dashboard should not show live replay forever after ingest goes quiet. |
| Tab hidden, returns after max duration | Old session closes; new session starts. | Old session gets `background_timeout` end best-effort on return. | Old replay ends at the leave point with compressed gap; new replay starts at return. | Max duration boundary wins over continuity. |
| Active visible session reaches max duration | SDK rotates immediately. | Old session closes with `max_duration`; new session starts. | Replay split at the max duration. | No single web session should exceed the max window. |
| Hidden/idle session reaches max duration while user is away | SDK cannot start a visible new session until the page wakes. | Old session is finalized at the web max observability boundary or when a newer same-visitor session appears. | Old replay ends with compressed away tail. | No live replay should keep accumulating events during inactivity, and no resumable session should be closed just because it was quiet for 60s. |

### Event and Replay Alignment

| Behavior | SDK session decision | Upload / backend result | Replay result | Dashboard / developer expectation |
| --- | --- | --- | --- | --- |
| Customer app network request | Same session. | Emits `network_request` unless ignored by config. | Timeline marker is compressed into playback time. | API density should align with the replay moment. |
| Rejourney SDK config/ingest/upload traffic | Same session. | Ignored by default by the network interceptor. | No recursive upload/API markers. | Developer sees app traffic, not Rejourney's own plumbing. |
| Click/scroll after idle pause | Same session resumes before the user event is queued. | Wake event is uploaded after `app_foreground`. | Marker lands after the compressed away segment. | First return interaction should not vanish. |
| rrweb event timestamp inside background gap | Same session. | Raw artifact can contain noisy events. | Viewer drops visual events inside the gap and freezes at gap start. | Cursor/background noise should not play under the grey overlay. |
| Analytics event timestamp inside background gap | Same session. | Event remains in analytics. | Marker maps into compressed gap timing. | Timeline should still show that a background event happened without stretching playback. |
| Final `app_background` with no `app_foreground` | Same session until server/client closes. | Viewer uses session/replay terminal end to close the gap. | Shows short away overlay, then replay ends. | No empty replay tail after "user left". |
| Event after the final playable replay frame | Same session if it belongs to that session. | Event stays queryable in logs/analytics. | Marker is hidden from the visual timeline if it falls outside playable time. | Telemetry must not create a blank tail or misleading dot cluster. |
| Late foreground/event artifact after a pre-background rrweb close | Same session if still inside the web max window. | Events artifacts store client `start_time` / `end_time`; reconciliation uses later client event evidence for close math while replay playback still uses visual timing. | Away gap is compressed and the replay does not grow an empty tail. | Duration/background math must not claim `background_time_seconds` is larger than total wall time. |
| Input values or placeholders inside rrweb snapshots | Same session. | Serialized input `value` and `placeholder` attributes are masked when all-input masking or sensitive input types apply. | Replay shows masked controls. | Developers should not see typed secrets or sensitive placeholder examples in stored rrweb JSON. |

## Mobile SDK Behavior Matrix

The mobile package is not a web-style tab/session restore system. It is a React Native + native runtime:

- Replay is screenshot + hierarchy based, not rrweb DOM based.
- `initRejourney()` configures lifecycle/auth plumbing but does not start recording. `startRejourney()` starts after consent.
- Native creates a fresh `session_{timestamp}_{uuid}` every time replay begins.
- User identity is persisted natively (`UserDefaults` on iOS, SharedPreferences on Android) and restored for future sessions.
- Background rollover threshold is 60 seconds. This is intentionally much shorter than the web max-session window.
- Mobile max recording duration comes from `maxRecordingMinutes`, clamped to 1-10 minutes.
- `/session/end` is best-effort. iOS force-quit, Android OEM task killing, crash, and process death can prevent final callbacks.

### Start, Sampling, and Identity

| Behavior | SDK session decision | Upload / backend result | Replay result | Dashboard / developer expectation |
| --- | --- | --- | --- | --- |
| Import package | No native module access should be required at import time. | No ingest. | No replay. | Safe for React Native 0.81+ / bridgeless startup. |
| `initRejourney(publicKey)` | Initializes JS/native lifecycle listeners and auth-error handling; does not start a session. | No session row until start/upload. | No replay. | App can wait for consent before recording. |
| `startRejourney()` before `initRejourney()` | No session starts. | No ingest. | No replay. | SDK logs a warning. |
| Local `enabled=false` or `disableInDev=true` in dev | No session starts. | No ingest. | No replay. | Local config can suppress mobile capture. |
| Remote config access denied (`401/403/404`) | No session starts; cached config is cleared. | No ingest. | No replay. | Invalid key/project/bundle/package mismatch fails closed. |
| Remote config network error with cached config | Start decision uses cached remote config. | Normal ingest if cached config allows. | Replay/telemetry follows cached config. | Mobile can keep working through transient config outages. |
| Remote config network error with no cache | Starts with default mobile config. | Normal ingest. | Replay defaults to enabled, sample rate 100%, max 10 minutes. | Mobile fails open for server/network outages, but not for access denial. |
| `rejourneyEnabled=false` or billing blocked | No native session starts. | No ingest. | No replay. | Dashboard should not receive new sessions. |
| Sampled out | Aborts before native session start. | Native receives sampled-out remote state; no session/capture. | No replay. | Sampled-out mobile sessions should not consume recording work. |
| `recordingEnabled=false` or local `observeOnly=true` | Native session can start, visual capture is disabled. | Telemetry/events/crashes/ANRs/network can upload. | No screenshots; replay is not visually playable. | Developer gets observability without screen recording. |
| `setUserIdentity()` before start | Stores identity in JS/native state. | Identity is used as the user id on start. | No direct visual effect. | Future sessions attach the known user. |
| `setUserIdentity()` during active session | Same session continues. | Native records `user_identity_changed`; backend updates `userDisplayId`. | Replay remains continuous. | Dashboard should show the user id after processing. |
| `clearUserIdentity()` | Same session continues; native persisted identity is removed. | Current code sends native identity `"anonymous"` while active. | Replay remains continuous. | Future sessions fall back to anonymous/device identity. |
| App restarts after identity was set | New start uses persisted identity. | Native re-associates restored identity on new session and background rollover restarts. | Separate replay for the new mobile session. | User id should persist across app launches until cleared. |

### Foreground, Background, and Termination

| Behavior | SDK session decision | Upload / backend result | Replay result | Dashboard / developer expectation |
| --- | --- | --- | --- | --- |
| App remains active/foreground | Same native session until stop, duration limit, crash, or process death. | Telemetry heartbeat flushes about every 5 seconds; screenshot batches upload by frame batch. | Continuous screenshot replay. | Live ingest stays active while events/frames upload. |
| User is idle while app stays foreground | Same session; no web-style idle pause. | Heartbeat can continue flushing while foregrounded. | Replay continues capturing screenshots at configured FPS. | Mobile idle foreground is considered active app usage. |
| App goes background | Session moves to paused state. | Records `app_background`, flushes events and frames, ships pending screenshots, pauses telemetry heartbeat. | Visual capture stops while app is backgrounded. | Live badge should age out after ingest goes quiet. |
| Background < 60s, then foreground | Same session resumes. | Records `app_foreground` with background duration; heartbeat/capture resume. | One replay; dashboard duration subtracts background time. | Short app switches remain one mobile journey. |
| Background > 60s, then foreground | Old session is ended with `background_timeout`; new native session starts. | Old session sends `/session/end` best-effort with `closeAnchorAtMs` at background entry and total background time; new session reuses cached credentials if valid. | Two replays. Old replay ends at background point; new replay starts on return. | Mobile rollover threshold is 60s, not 30 minutes. |
| Background > 60s but old session end upload is slow | Restart races against a 2s rollover grace. | If end callback is slow, new session starts after grace timeout. | Two replays; backend reconciliation prevents overlap. | User return should not wait on slow network. |
| Session ended while backgrounded, then foregrounds before 60s | New session starts instead of resuming a dead session. | New replay/session begins on foreground. | Separate replay. | Covers duration-limit or native teardown while backgrounded. |
| User force-quits iOS from app switcher | No reliable final callback after suspension. | Last background flush may exist; backend closes by inactivity/reconciliation or crash recovery. | Replay ends from latest evidence/background anchor. | Missing `/session/end` is expected on iOS force-quit. |
| Android recent-apps swipe-away | `SessionLifecycleService.onTaskRemoved()` may fire, but does not do blocking network finalization. | Recovery/reconciliation handles closure; callback reliability depends on OEM. | Replay ends from latest evidence/background anchor. | Pixel/stock is more reliable; aggressive OEMs may skip callbacks. |
| Android Samsung false `onTaskRemoved()` near launch | Ignored if it fires too soon after service start. | No premature close. | Replay continues. | Filters known Samsung false positives. |
| Low-memory/system kill | No reliable client close. | Recovery checkpoint and backend reconciliation close later. | Replay ends from latest uploaded frames/events. | Backend must not depend on mobile termination callbacks. |
| Native crash/fatal JS error | Current process can die before normal stop. | Recovery checkpoint and stored crash incident are finalized on next launch when possible. | Previous replay is closed with crash evidence after recovery. | Crash sessions may appear after the next app launch/worker processing. |
| `stopRejourney()` / explicit user stop | Current active/paused session ends. | Sends metrics and `/session/end` best-effort, disables network/capture. | Replay ends at stop. | A later start creates a fresh session. |

### Duration, Network, and Replay Capture

| Behavior | SDK session decision | Upload / backend result | Replay result | Dashboard / developer expectation |
| --- | --- | --- | --- | --- |
| Active session reaches `maxRecordingMinutes` | Native replay is ended with `duration_limit`. Current JS wrapper does not immediately start a replacement while app stays foregrounded. | Backend stores closed timing; late uploads may still process. | Replay ends at duration limit. | Current behavior is "close at cap"; QA should not expect automatic foreground rollover. |
| App backgrounds after duration limit ended the replay | Foreground reconciliation detects no live orchestrator session and starts fresh. | New session starts on foreground if SDK still has API config. | Separate replay. | Lifecycle can recover from duration-limit closure. |
| `wifiOnly=true`, iOS path is cellular/expensive | iOS waits for an acceptable network before starting capture. | No session artifacts until network is acceptable. | Replay starts later or not at all. | Wi-Fi-only can delay session creation on iOS. |
| `wifiOnly=true`, Android active network not Wi-Fi | Android network gate prevents `beginRecording()` until Wi-Fi; if no active network exists it currently starts anyway and retries uploads. | Uploads retry through queue/dispatcher. | Capture may start offline on Android no-network fallback. | Android network behavior is best-effort and not identical to iOS. |
| Network drops during an active session | Session remains active. | Events/frames are queued and retried; pending sessions upload on later activation. | Replay may become available after network returns. | Temporary offline should not split the session by itself. |
| Native replay starts | New session id is generated natively. | First presign/upload materializes the backend row. | Screenshot/hierarchy replay starts if visual capture enabled. | Session count increments once per created row. |
| Screenshot capture enabled | Same session. | Frames upload in small bundles; hierarchy uploads separately when changed. | Dashboard uses `ScreenshotReplayPlayer`. | Mobile replay is image based. |
| Screenshot capture disabled / observe-only | Same telemetry session. | Events, crashes, ANRs, network, metadata can upload; no screenshot artifacts. | No visual replay. | Session may be useful for stability/API analysis only. |
| Native sheets/dialog capture enabled | Same session. | Eligible app-owned native windows can appear in screenshots. | Replay may include native modal surfaces. | Disable `captureNativeSheets` for privacy-sensitive surfaces. |
| App-owned sensitive views masked | Same session. | Screenshot pixels are redacted before upload. | Masked/blocked areas in replay. | Privacy masking is native screenshot redaction, not DOM masking. |
| JS/native network requests | Same session. | JS fetch/XHR is patched; native URLProtocol/OkHttp interception is supplementary. Rejourney ingest routes are ignored where configured. | API timeline should show app traffic, not SDK upload plumbing. | Native-originated HTTP coverage can differ by platform/runtime. |
| Console tracking enabled | Same session. | Console logs are captured up to the session cap. | Replay/event detail can show logs. | Privacy-sensitive apps should disable/sanitize console logs. |
| Screen tracking via Expo Router/React Navigation/manual `trackScreen` | Same session. | Screen events and hierarchy capture update current screen. | Page journey/screen markers align to mobile replay. | Mobile screen names are app routes/screens, not URLs. |

## Flow Index

![Session lifecycle diagram](./assets/diagrams/session-lifecycle.svg)

## [I1] Package Start / Rollover

```text
┌──────────────┐      GET /api/sdk/config       ┌─────────────────────────────┐
│ JS SDK       │───────────────────────────────▶│ SDK config route            │
│ public key   │◀───────────────────────────────│ recording/sample/max config │
└──────┬───────┘                                │ Redis may cache sdk:config:*│
       │                                        └──────────────┬──────────────┘
       │ sampled in?                                          │
       ▼                                                      ▼
┌──────────────┐     POST /ingest/auth/device    ┌────────────────────────────┐
│ Native layer │───────────────────────────────▶│ device auth route          │
│ startSession │◀───────────────────────────────│ x-upload-token credential  │
└──────┬───────┘                                └──────────────┬─────────────┘
       │
       │ create session_{timestamp}_{uuid}
       │ start replay capture + event pipeline + visual capture
       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ First /presign or /segment/presign starts uploading under that session ID   │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Package rollover / stop rules                                               │
│                                                                              │
│ Active -> background < 60s       : keep same session                        │
│ Active -> background >= 60s      : old session should close; next launch or │
│                                    resume may start a new session           │
│ Web visible idle >= 60s          : emit idle background, flush once, pause  │
│                                    capture/upload until user activity       │
│ Web idle resume within max       : emit foreground and continue same replay │
│ Web idle resume after max        : close old session and start a new one    │
│ Web hard navigation / reload     : restore the same tab session if it is    │
│                                    still inside the max duration window      │
│ Web closed tab -> reopened       : start a new session                      │
│ Web identify -> refresh          : keep the stored user ID and re-emit      │
│                                    identity on the restored/new session      │
│ Active -> user stop              : flush and close best-effort              │
│ Active -> duration limit reached : flush and close                          │
│ Process death / next launch      : backend may finalize old one later       │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
Background rollover threshold       60s
Web visible idle pause              60s
Rollover grace window                2s
Event heartbeat flush                5s
Max web observability duration       backend-configured, currently supports
                                     up to 30 minutes
```

### iOS: multitasking and force-quit (no guaranteed `/session/end`)

A common user path is: swipe up to the app switcher, then swipe the app away to force-quit it. On that path the OS has usually already delivered `UIApplication.didEnterBackgroundNotification`. The app becomes suspended; the later swipe kills the process with no reliable opportunity to run teardown code.

Why `/api/ingest/session/end` may be missing:

- After background, the native layer usually pauses and flushes best-effort; it does not treat every background as a guaranteed final close.
- `UIApplication.willTerminateNotification` is not guaranteed when the user force-quits from the switcher, especially after the app is already backgrounded or suspended.
- The client may therefore never emit a final end signal. The backend must be able to close the row from ingest inactivity and artifact evidence alone.

Expectations:

- This is normal iOS platform behavior, not a backend defect.
- The authoritative closure path is server-side reconciliation plus the 60-second inactivity rule. `/session/end` is helpful when present, not required.
- The same principle applies on Android: lifecycle callbacks differ across OEMs, so the backend must not depend on every kill path emitting `/session/end`.

Package-side rules that matter downstream:

- In the normal React Native flow, the session ID is generated on-device.
- There is still a backend fallback for `/api/ingest/presign` without a `sessionId`; it mints `session_{timestamp}_{randomHex}`.
- The timestamp embedded in the session ID is later used by the backend to infer `started_at`.
- JS fetches [`/api/sdk/config`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/sdk.ts) before start and can disable replay before any visual upload happens.
- Native obtains the upload credential from [`/api/ingest/auth/device`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestDeviceAuth.ts) and sends it as `x-upload-token`.

Relevant package files:

- [`packages/browser/src/sdk/client.ts`](/Users/mora/Desktop/Dev-mac/rejourney/packages/browser/src/sdk/client.ts)
- [`packages/browser/src/sdk/startup.ts`](/Users/mora/Desktop/Dev-mac/rejourney/packages/browser/src/sdk/startup.ts)
- [`packages/browser/src/sdk/networkInterceptor.ts`](/Users/mora/Desktop/Dev-mac/rejourney/packages/browser/src/sdk/networkInterceptor.ts)
- [`packages/browser/src/sdk/replayUploadQueue.ts`](/Users/mora/Desktop/Dev-mac/rejourney/packages/browser/src/sdk/replayUploadQueue.ts)
- [`packages/react-native/src/index.ts`](/Users/mora/Desktop/Dev-mac/rejourney/packages/react-native/src/index.ts)
- [`packages/react-native/android/src/main/java/com/rejourney/recording/ReplayOrchestrator.kt`](/Users/mora/Desktop/Dev-mac/rejourney/packages/react-native/android/src/main/java/com/rejourney/recording/ReplayOrchestrator.kt)
- [`packages/react-native/android/src/main/java/com/rejourney/recording/TelemetryPipeline.kt`](/Users/mora/Desktop/Dev-mac/rejourney/packages/react-native/android/src/main/java/com/rejourney/recording/TelemetryPipeline.kt)
- [`packages/react-native/android/src/main/java/com/rejourney/engine/DeviceRegistrar.kt`](/Users/mora/Desktop/Dev-mac/rejourney/packages/react-native/android/src/main/java/com/rejourney/engine/DeviceRegistrar.kt)
- [`packages/react-native/ios/Engine/RejourneyImpl.swift`](/Users/mora/Desktop/Dev-mac/rejourney/packages/react-native/ios/Engine/RejourneyImpl.swift)

## [I2] Upload Lanes / Session Creation

```text
                          same sessionId
                                │
          ┌─────────────────────┴─────────────────────┐
          ▼                                           ▼
┌─────────────────────────┐                 ┌──────────────────────────┐
│ Events lane             │                 │ Replay lane              │
│ POST /presign           │                 │ POST /segment/presign    │
│ PUT relay upload        │                 │ PUT relay upload         │
│ POST /batch/complete    │                 │ POST /segment/complete   │
└─────────────┬───────────┘                 └──────────────┬───────────┘
              └─────────────────────┬──────────────────────┘
                                    ▼
                    sessions + recording_artifacts + metrics
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Presign request path                                                        │
│                                                                              │
│ 1. Billing gate / project recording rules                                   │
│ 2. Session-limit check                                                      │
│ 3. ensureIngestSession(projectId, sessionId)                                │
│ 4. If created == true -> increment project_usage.sessions exactly once      │
│ 5. register pending artifact row                                            │
│ 6. return upload relay URL                                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Session-creation rules:

- New sessions are inserted with `status='processing'` and a matching `session_metrics` row.
- Billing/session counting happens only when the session row is first created.
- Replay screenshot uploads are rejected if the project disables recording or the session is sampled out.
- The backend does not depend on `/session/end` to create or close sessions.
- `ready` is not a hard-ingest terminal state. The backend may still accept later artifact work for the same session, but closed timing stays sticky once `ended_at` and `duration_seconds` are stored.
- True hard stops are enforced only for `failed`, `deleted`, retention-purged recordings, or replay-expired recordings.

Relevant routes:

- [`backend/src/routes/ingestUploads.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestUploads.ts)
- [`backend/src/routes/ingestLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestLifecycle.ts)
- [`backend/src/routes/ingestUploadRelay.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestUploadRelay.ts)
- [`backend/src/routes/ingestFaults.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestFaults.ts)
- [`backend/src/services/ingestSessionLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestSessionLifecycle.ts)
- [`backend/src/services/ingestArtifactLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestArtifactLifecycle.ts)
- [`backend/src/services/sessionIngestImmutability.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionIngestImmutability.ts)

## [I3] Upload Relay / Artifact + lifecycle workers / Artifact states

```text
┌──────────┐   /presign or /segment/presign   ┌──────────────────────────────┐
│ Package  │─────────────────────────────────▶│ recording_artifacts          │
│ / SDK    │◀─────────────────────────────────│ status = pending             │
└────┬─────┘        relay URL returned        └──────────────┬───────────────┘
     │                                                       │
     │ PUT /upload/artifacts/:artifactId                    │
     ▼                                                       ▼
┌──────────────┐    collect body + Redis SET EX 30m  ┌────────────────────────┐
│ upload relay │────────────────────────────────────▶│ artifact:buf:{id}      │
└────┬─────────┘                                      │ status = buffered      │
     │ 204 after Redis buffer + DB status             └──────────┬─────────────┘
     │                                                           │ enqueue
     │ /batch/complete or /segment/complete                      ▼
     ▼                                                ┌────────────────────────┐
┌──────────────┐                                      │ rj-artifact-flush      │
│ ingest route │                                      │ ingest-worker flushes  │
│ merge metrics│                                      │ buffer to selected S3  │
└──────────────┘                                      └──────────┬─────────────┘
                                                                 │ mark uploaded
                                                                 ▼
                                               ┌────────────────────────────────────┐
                                               │ Redis (BullMQ)                     │
                                               │  rj-ingest-artifacts (events/...)  │
                                               │  rj-replay-artifacts (screens/...) │
                                               └────────────────┬───────────────────┘
                                                                │ event-driven consume
                                                                ▼
              ┌──────────────────────────────────────────────────────────────────┐
              │ Artifact workers (BullMQ Workers; two deployments)              │
              │  ┌──────────────────────────┐    ┌──────────────────────────────┐│
              │  │ ingest-artifact worker   │    │ replay-artifact worker       ││
              │  │ events, crashes, ANRs    │    │ screenshots, hierarchy       ││
              │  └────────────┬─────────────┘    └──────────────┬───────────────┘│
              └───────────────┴──────────────────────────────────┴────────────────┘
                                            │
                                            ▼
                              process / normalize (artifactJobProcessor)
                              artifact = ready / failed
                              reconcileSessionState()
```

```text
Artifact state machine

pending   -> buffered -> uploaded -> ready
pending   -> abandoned
buffered  -> failed       (Redis buffer expired/lost, or flush retries exhausted)
uploaded  -> failed       (processing retries exhausted)
abandoned -> pending      (SDK retries same clientUploadId)
failed    -> pending      (SDK retries same clientUploadId)
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Session-lifecycle worker (sessionLifecycleWorker.ts)                        │
│ Session sweep interval: 10s between sweep runs                              │
│                                                                              │
│ Each sweep (at most every 10s):                                             │
│   abandon expired pending artifacts (> 10m)                                 │
│   queueRecoverableArtifacts (uploaded artifacts + buffered flush jobs)      │
│   reconcileDueSessions (batched)                                            │
│                                                                              │
│ Stalled job recovery: BullMQ detects stalled workers automatically          │
│   (stalledInterval = 30s, maxStalledCount = 3). No Postgres sweep needed.  │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Artifact workers (BullMQ Workers)                                           │
│                                                                              │
│ ingest-worker consumes rj-ingest-artifacts and hosts rj-artifact-flush      │
│ replay-worker consumes rj-replay-artifacts                                  │
│ On job: processArtifactJob -> reconcileSessionState() as needed             │
│ On fail: exponential backoff, up to 5 attempts                              │
│ Flush jobs: 8 attempts, exponential backoff starting at 500ms               │
│ On stall: BullMQ auto re-queues (no manual sweep needed)                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Important worker nuance:

- **ingest-artifact worker** ([`ingestArtifactWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/ingestArtifactWorker.ts)) consumes from `rj-ingest-artifacts`: `events`, `crashes`, and `anrs`.
- The same ingest-worker process also runs the `rj-artifact-flush` worker. It reads `artifact:buf:{artifactId}`, writes the bytes to the selected S3 endpoint, calls `markArtifactUploadStored()` to enqueue normal processing, then deletes the Redis buffer.
- **replay-artifact worker** ([`replayArtifactWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/replayArtifactWorker.ts)) consumes from `rj-replay-artifacts`: `screenshots`, `hierarchy`, and `rrweb`.
- **session-lifecycle worker** ([`sessionLifecycleWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/sessionLifecycleWorker.ts)) runs periodic sweeps only; it does not process artifact bytes itself.
- `events` artifacts update session metadata, `session_metrics`, and downstream analytics side effects.
- `crashes` and `anrs` artifacts create issue rows and increment crash/ANR counters.
- `screenshots`, `hierarchy`, and `rrweb` mostly affect replay availability and final session presentation.
- BullMQ job deduplication uses `jobId = artifact-{artifactId}`. A duplicate enqueue while a job is active/waiting returns without creating a second job.
- Flush job deduplication uses `jobId = flush-{artifactId}`. If the Redis buffer is missing after TTL expiry or Redis loss, the flush worker marks the artifact failed instead of crashing or pretending S3 has the bytes.
- The heavy full-table artifact lifecycle backfill is manual by default. Normal worker startup skips it unless `INGEST_ENABLE_STARTUP_BACKFILL=true`.
- Manual backfill command: `cd backend && npm run db:backfill:artifact-lifecycle`

Relevant files:

- [`backend/src/routes/ingestUploadRelay.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestUploadRelay.ts)
- [`backend/src/services/artifactBullQueue.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/artifactBullQueue.ts)
- [`backend/src/services/artifactFlushJobProcessor.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/artifactFlushJobProcessor.ts)
- [`backend/src/worker/ingestArtifactWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/ingestArtifactWorker.ts)
- [`backend/src/worker/replayArtifactWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/replayArtifactWorker.ts)
- [`backend/src/worker/sessionLifecycleWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/sessionLifecycleWorker.ts)
- [`backend/src/services/artifactJobProcessor.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/artifactJobProcessor.ts)
- [`backend/src/services/ingestArtifactLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestArtifactLifecycle.ts)

## [I4] Reconciliation / Auto-Finalizer / Close-Time Math

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ reconcileSessionState(sessionId)                                            │
│                                                                              │
│ readyScreenshotCount > 0 ?                                                  │
│   yes -> replay_available = true                                            │
│   no  -> replay_available = false                                           │
│                                                                              │
│ deriveSessionPresentationState():                                           │
│   - ended_at present => not live ingest                                     │
│   - newer visitor session => old row is not live ingest                     │
│   - last_ingest_activity_at older than 60s => not live ingest               │
│   - open replay work blocks final ready state                               │
│     (pending, buffered, or uploaded)                                        │
│                                                                              │
│ shouldFinalize?                                                             │
│   yes -> status = ready                                                     │
│          preserve stored ended_at/duration if already closed                │
│          otherwise derive authoritative close                               │
│   no  -> status = processing (unless hard terminal)                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Authoritative close resolution                                               │
│                                                                              │
│ 1. closeAnchorAtMs (best signal for background-time rollover)               │
│ 2. reported endedAt from /session/end                                       │
│ 3. latest replay artifact end_time                                          │
│ 4. last_ingest_activity_at                                                  │
│ 5. recording policy upper bound                                             │
│                                                                              │
│ then clamp:                                                                 │
│   started_at <= ended_at <= started_at + maxRecordingMinutes + 2 minutes    │
│   and cap to successor session start on the same visitor when applicable    │
│                                                                              │
│ duration_seconds = max(1, wall_clock_seconds - background_time_seconds)     │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
/api/ingest/session/end
  -> resolveLifecycleSession()
  -> merge session_metrics + sdk telemetry
  -> if sticky close already exists: return success without rewriting timing
  -> else resolveAuthoritativeSessionClose()
  -> markSessionIngestActivity(at = resolvedClose.endedAt, endedAt = resolvedClose.endedAt)
  -> reconcileSessionState()
```

Important reconciliation rules:

- Replay availability is artifact-driven, not `/session/end`-driven.
- `/session/end` is optional. The backend must still finalize a non-web row after 60 seconds of ingest inactivity even if the SDK never sends an end event. Web rows use the 60-second timeout only for the LIVE badge; finalization waits for explicit close, newer same-visitor session rollover, or the configured web max observability window.
- The live-ingest window is 60 seconds. The lifecycle worker sweeps every 10 seconds.
- `ended_at` plus positive `duration_seconds` is sticky close timing. Once those are stored, later replay uploads must not clear them.
- Later `/session/end` calls for an already-closed row return success while preserving the stored close timing instead of recomputing a smaller duration.
- Late artifact uploads still update artifact rows and jobs, but on already-closed sessions they only touch activity; they do not reopen the session clock.
- A newer session for the same visitor suppresses the LIVE badge on the older row.
- Only open replay work blocks final ready state (`pending`, `buffered`, or `uploaded`). Non-replay ingest work may still complete after the session is already presented as `ready`.
- If `closeAnchorAtMs` ends the session earlier than the later reported `/session/end` time, the backend trims the post-close background tail before computing playable duration. This prevents an older session from collapsing when the app resumes long after backgrounding.

Canonical lifecycle fields in Postgres:

- `sessions.status`
- `sessions.started_at`
- `sessions.ended_at`
- `sessions.last_ingest_activity_at`
- `sessions.duration_seconds`
- `sessions.background_time_seconds`
- `sessions.replay_available`
- `sessions.replay_segment_count`
- `sessions.replay_storage_bytes`

Legacy compatibility fields may still exist physically in the schema, but they are not the authoritative lifecycle model anymore.

Relevant files:

- [`backend/src/services/sessionReconciliation.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionReconciliation.ts)
- [`backend/src/services/sessionTiming.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionTiming.ts)
- [`backend/src/routes/ingestLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestLifecycle.ts)

## [I5] Redis vs Postgres Ownership

```text
┌──────────────────────────────────────┐      ┌──────────────────────────────────────┐
│ Redis (job queue + helper plane)     │      │ Postgres (source of truth)           │
│                                      │      │                                      │
│ BullMQ queues:                       │      │ sessions                             │
│   rj-ingest-artifacts                │      │ session_metrics                      │
│   rj-artifact-flush                  │      │ recording_artifacts                  │
│   rj-replay-artifacts                │      │ project_usage                        │
│ artifact:buf:{artifactId}            │      │                                      │
│ sdk:config:*                         │      │ device_usage                         │
│ ingest:idempotency:*                 │      │                                      │
│ sessions:{teamId}:{period}           │      │                                      │
│ session_lock:{teamId}:{period}       │      │                                      │
│ upload:token:{projectId}:{deviceId}  │      │                                      │
│ rate-limit helpers                   │      │                                      │
└──────────────────────────────────────┘      └──────────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Practical consequence                                                       │
│                                                                              │
│ If Redis is slow or unavailable:                                            │
│   - Relay uploads cannot be safely ACKed until bytes are buffered, so the  │
│     relay returns a storage/buffer error instead of losing SDK bytes.       │
│   - If the worker crashes after ACK, queueRecoverableArtifacts() re-enqueues│
│     buffered flush jobs and uploaded processing jobs when Redis recovers.   │
│   - If artifact:buf expires before flush, the artifact becomes failed.      │
│ If Postgres is wrong, the session lifecycle is wrong.                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

Redis owns:

- artifact write-ahead buffers: `artifact:buf:{artifactId}` with 30-minute TTL
- artifact job queues (BullMQ): `rj-artifact-flush`, `rj-ingest-artifacts`, `rj-replay-artifacts`
- SDK config cache
- ingest idempotency markers
- session-limit cache plus distributed lock
- best-effort upload token storage
- rate limiting helpers

Postgres owns:

- whether a session exists
- lifecycle fields like `status`, `started_at`, `ended_at`, `last_ingest_activity_at`
- playable duration and background duration
- replay availability and replay counters
- artifact state (`recording_artifacts.status`)
- metrics and derived analytics counters
- project/device usage counters

Schema anchors:

- [`backend/src/db/schema.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/db/schema.ts)
- [`backend/src/db/redis.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/db/redis.ts)

## [I6] Quick Answers / Constants

```text
New session created?
  Usually on the first successful:
  - POST /api/ingest/presign
  - POST /api/ingest/segment/presign

Missing session on /session/end?
  Yes, if the session ID is still fresh enough to materialize.

What counts as "fresh enough"?
  session_{timestamp}_{uuid} and timestamp <= 6h old

What exactly is the auto-finalizer?
  Session-lifecycle worker sweep plus reconcileSessionState() after artifact jobs complete.

What makes a replay visible?
  At least one screenshot or rrweb artifact with status = ready.

Can a ready/closed session reopen?
  Not logically. Later artifact work may still append to the session, but stored close timing
  stays sticky and the old row must not go live again.

Does the backend depend on /session/end?
  No. It must finalize correctly from explicit close, rollover/newer-session evidence,
  max-window expiry, and artifact evidence alone. For non-web runtimes, 60s of
  ingest inactivity is enough to finalize; for web, 60s only removes the LIVE badge.

What hard-stops new ingest?
  failed, deleted, recording_deleted, or replay_expired.
```

```text
Session ID materialization window      6h
Live ingest idle threshold             60s
Web finalization window                project web max observability, max 30m
Session-lifecycle sweep interval       10s
Pending artifact abandonment           10m
Redis artifact buffer TTL              30m
BullMQ stalled job detection           30s  (stalledInterval; auto re-queued)
BullMQ max stall retries               3    (maxStalledCount; then marked failed)
BullMQ job retry attempts              5    (exponential backoff, base 1s)
BullMQ flush job retry attempts        8    (exponential backoff, base 500ms)
BullMQ completed job retention         1h
BullMQ failed job retention            7d   (DLQ window)
Upload relay token TTL                 1h
SDK background rollover threshold      60s
SDK rollover grace window              2s
SDK event heartbeat                    5s
```

## [I7] Archive list duration + read model (dashboard)

The sessions archive endpoint (`GET /api/sessions`, implemented in [`backend/src/routes/sessions.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/sessions.ts)) is the main dashboard read path. It is not the ingest write path, but it reflects the same lifecycle rules.

List payload shape:

- Rows are selected without large JSONB columns (`events`, `metadata`) so the table stays fast; session detail endpoints load full rows.
- Optional total count can be deferred (`includeTotal: false`) so the first page is not blocked on a slow `count(*)`.
- Supporting indexes include replay-ready and project/device filters.

How `durationSeconds` is filled:

- `durationSecondsForDisplay()` uses stored `sessions.duration_seconds` when it is already positive.
- If stored duration is missing, the helper derives from `ended_at`, then replay artifact end time.
- If `ended_at` is far later than the real replay end (for example, structural close vs shorter usable replay), the dashboard can prefer the shorter replay-derived duration for display.
- The display model is still playable time: `wall_clock - background_time_seconds`.

Dashboard client behavior:

- Presentation fields come from `deriveSessionPresentationState()`: `effectiveStatus`, `isLiveIngest`, `isBackgroundProcessing`, `canOpenReplay`.
- A session with `ended_at` set, or one idle for more than 60 seconds, must not keep the LIVE badge. A quiet web session may still remain in `processing` and later become live again if the same tab resumes before the web max observability window.
- If a newer visitor session exists, the older row should not show LIVE even if some stale activity arrives later.

## [I8] Ingest guardrails + late-arrival behavior

Current hard-ingest guard ([`sessionIngestImmutability.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionIngestImmutability.ts)):

- Block only when `status` is `failed` or `deleted`
- Also block when `recording_deleted = true`
- Also block when `is_replay_expired = true`

That means `ready` is intentionally not a hard-stop state.

What is still allowed after close:

- New presigns on a `ready` session are allowed unless the session is in a true hard-stop state.
- Relay uploads and complete calls may finish for already-created artifacts.
- Late replay uploads may arrive after the app backgrounds or after the lifecycle worker already finalized the row.

What must not happen:

- Late uploads must not clear `ended_at`.
- Late uploads must not clear or recompute away `duration_seconds` on an already-closed row.
- Late uploads must not make the older row show LIVE again.
- A later `/session/end` for the same row must preserve the earlier sticky close timing if it already exists.

Operationally, the artifact lifecycle code handles this by splitting "touch activity" from "reopen timing":

- open session -> artifact mutation can move the row back to `processing`
- already-ended session -> artifact mutation only touches `last_ingest_activity_at`
- already-ended session + duplicate `/session/end` -> return success with preserved values

This is the critical rule that keeps "background for >60s, then reopen app" from shrinking the earlier session's playable duration or reviving its live-ingest badge.

## Primary Files

- [`backend/src/routes/sessions.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/sessions.ts)
- [`backend/src/routes/ingestUploads.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestUploads.ts)
- [`backend/src/routes/ingestLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestLifecycle.ts)
- [`backend/src/routes/ingestUploadRelay.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestUploadRelay.ts)
- [`backend/src/routes/ingestDeviceAuth.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestDeviceAuth.ts)
- [`backend/src/services/ingestSessionLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestSessionLifecycle.ts)
- [`backend/src/services/ingestArtifactLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestArtifactLifecycle.ts)
- [`backend/src/services/sessionReconciliation.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionReconciliation.ts)
- [`backend/src/services/sessionTiming.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionTiming.ts)
- [`backend/src/services/sessionPresentationState.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionPresentationState.ts)
- [`backend/src/services/sessionIngestImmutability.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionIngestImmutability.ts)
- [`backend/src/services/artifactJobProcessor.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/artifactJobProcessor.ts)
- [`backend/src/services/artifactBullQueue.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/artifactBullQueue.ts)
- [`backend/src/worker/ingestArtifactWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/ingestArtifactWorker.ts)
- [`backend/src/worker/replayArtifactWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/replayArtifactWorker.ts)
- [`backend/src/worker/sessionLifecycleWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/sessionLifecycleWorker.ts)
