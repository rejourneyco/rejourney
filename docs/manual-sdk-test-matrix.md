# Manual SDK release matrix

Use this matrix after automated checks pass and before publishing an affected
mobile SDK. It validates the packages inside representative applications
against the real local stack, then records dashboard replay links for review.

Do not use the old bare React Native or minimal native iOS fixtures as the
manual release gate. They remain useful compile fixtures, but they do not cover
enough real UI behavior. The manual gate uses these applications:

| Fixture | SDK coverage | Why it owns this coverage |
| --- | --- | --- |
| `examples/react-native-boilerplate` | React Native on iOS and Android | Expo Router, New Architecture, Replay Lab, Google Maps, Mapbox, nested video, masks, long image list, and dense view tree |
| `examples/brew-coffee-labs` | React Native compatibility on iOS and Android | Older Expo/React Native integration and realistic tabs, forms, images, camera/media, authentication, and network activity |
| `examples/swift-clean-arch` | Native Swift SDK on iOS | SwiftUI list/search/detail flow, URLSession, MapKit, image/video masking, sheets, and dense native UI |
| `packages/rejourney/example` | Flutter on iOS and Android | Plugin controls, checkout masking, errors, ANR/crash recovery, video, image scroll, dense widgets, and GPU/Impeller capture |

## Run rules

1. Test the local SDK source that will be released, not the last published
   package. Do not use Expo Go; native changes require a development or Release
   build.
2. Run the smoke flow for every affected package and supported platform.
3. Run a targeted row only when the change can affect that behavior or shared
   native core. Do not repeat the same engine-level test in every app.
4. Use synthetic values in inputs. Never enter real credentials, payment data,
   or personal information.
5. A run passes only when its replay is playable in the dashboard and its
   session row is concluded correctly. Console output alone is not evidence.
6. Record one row and replay link per app/platform run in the results table at
   the end of this document. Add extra links for rollover and recovery sessions.

### Change-aware selection

| Changed area | Required manual runs |
| --- | --- |
| React Native TypeScript, Expo Router, or RN bridge | Expo Boilerplate on iOS and Android; Brew on iOS and Android |
| Shared Swift core or native iOS SDK | Swift Countries; one Expo iOS smoke; one Flutter iOS smoke if its synced core changed |
| Shared Kotlin core or RN Android native code | Expo Android; Flutter Android if its synced core changed |
| Flutter Dart/plugin code | Flutter example on iOS and Android |
| Capture, masking, hierarchy, maps, or media | Relevant capture rows for each affected native renderer |
| Lifecycle, upload, retry, offline persistence, or recovery | Lifecycle and delivery rows for every affected wrapper |
| Documentation-only change | No simulator run unless behavior or expected payload changed |

## Local setup

Bring up the real local stack once:

```bash
npm run ci:local
```

For an already prepared stack, `npm run dev:resume` is sufficient. Confirm the
API, dashboard, object storage, and database are healthy before launching an
app.

| Service | Local address |
| --- | --- |
| API | `http://127.0.0.1:3000` |
| Dashboard | `http://127.0.0.1:8080` |
| MinIO | NodePort `30900` |
| Postgres | `127.0.0.1:5432` |

The iOS Simulator can use `127.0.0.1:3000`. An Android Emulator normally uses
the endpoint already configured by the example; verify it reaches the same
local API rather than production. A physical device must use the host LAN
address.

Point the compatibility fixtures at this checkout before building:

```bash
(cd examples/brew-coffee-labs && npm run sdk:new)
npm run example:swift:sdk:new
```

Expo Boilerplate and the Flutter example already use local package paths.
Native edits require rebuilding the application.

Launch the requested target from the repository root:

```bash
npm run example:boilerplate:ios
npm run example:boilerplate:android
npm run example:brew:ios
npm run example:brew:android
npm run example:swift
# Flutter iOS Simulator
(cd packages/rejourney/example && flutter run --dart-define=REJOURNEY_API_URL=http://127.0.0.1:3000)
# Flutter Android Emulator
(cd packages/rejourney/example && flutter run --dart-define=REJOURNEY_API_URL=http://10.0.2.2:3000)
```

Useful database confirmation:

```bash
psql "postgresql://rejourney:rejourney@127.0.0.1:5432/rejourney" -c "select id, started_at, ended_at, end_reason, replay_available from sessions order by started_at desc limit 10;"
```

## Required smoke flows

Each row should produce one primary replay. Expo Boilerplate, Brew, and Swift
Countries auto-start and have no manual Stop control, so finish their primary
flow with L2's intentional background rollover. That both concludes the replay
and validates lifecycle ownership without modifying the fixture. Flutter owns
the explicit stop/restart controls. Run process-death recovery separately.

| Run | App and platform | One-pass flow | Required evidence |
| --- | --- | --- | --- |
| RN-IOS | Expo Boilerplate · iOS | Launch; use Home and Details; open Replay Lab; type synthetic public and secret values; exercise the explicit mask and nested video; scroll Stress images; open and settle a map; background for 5s and return; finish with a 70s background and return | Expo Router navigation is attributed once; input and mask privacy pass; media/map frames are usable; the short background keeps the session; the rollover concludes a playable primary replay and starts exactly one new session |
| RN-AND | Expo Boilerplate · Android | Repeat RN-IOS in the Android development build; exercise both Google Maps and Mapbox when its token is configured | Same functional result with Android coordinates; map listeners remain owned by the host app; no blank frames, growing backlog, or leaked callbacks |
| BREW-IOS | Brew Coffee Labs · iOS | Open every available tab; scroll the community/feed content; open Add Post; type synthetic form values; exercise image selection if configured; background for 5s and return; finish with a 70s background and return | Real-world Expo Router, forms, images, and network traffic remain usable; no startup or navigation duplication; the primary replay concludes at rollover and exactly one replacement session starts |
| BREW-AND | Brew Coffee Labs · Android | Repeat the Brew flow in its Android development build | Compatibility with the older Expo/RN stack; replay is visually faithful and the app retains normal behavior |
| SWIFT-IOS | Swift Countries · iOS | Search countries; open a detail and flag sheet; return; use Map Test; use Media Masking/Nested Video; scroll Stress Test; background for 5s and return; finish with a 70s background and return | SwiftUI navigation and URLSession events are present; MapKit/media settle correctly; declared masks hide content; the short background keeps the session and rollover concludes its replay |
| FLUTTER-IOS | Flutter example · iOS | Start; record a custom event; open Checkout; exercise the mask; run video, image scroll, dense tree, and animated/settled 3D screens; background for 5s; return; stop and flush | Navigator events, Dart-to-native metadata, masks, and frames are present; no torn transitions; replay plays from start to finish |
| FLUTTER-AND | Flutter example · Android | Repeat FLUTTER-IOS on the default Impeller renderer | JPEGs contain real UI rather than black frames; compatibility masking works; retained capture does not replace or stall the live Flutter surface |

If an external service in Brew is unavailable, record that limitation and use
the reachable tabs/forms. A Rejourney regression is not excused by an unrelated
Supabase, Gemini, camera, or media-service failure.

## Lifecycle and session ownership

Run L1, L2, L4, and L6 once per affected SDK wrapper, using its owner fixture above.
The required auto-start smoke flows already include L1 and L2. L3 and L5 belong
to the Flutter control fixture unless another fixture gains equivalent controls.

| ID | Action | Pass condition |
| --- | --- | --- |
| L1 · short background | Background for 5 seconds, then foreground | Same session id; one `app_background`, then one `app_foreground`; no second `app_startup` |
| L2 · intentional rollover | Background for at least 70 seconds, then foreground | On foreground, the original session ends with `background_timeout` because it crossed the intentional 60-second boundary; a new session starts with identity and metadata restored; no new events append to the old session |
| L3 · explicit restart | In the Flutter example, stop and start again without relaunching | Two distinct playable sessions; first is complete before the second begins |
| L4 · process death recovery | Kill from the app switcher while recording, then relaunch | Prior session finalizes as `recovery_finalize`; durable segments arrive; a clean new session starts |
| L5 · idempotence | In the Flutter example, start twice, stop twice, then perform 10 quick start/stop cycles | No duplicate session, timer, listener, observer, orphan row, crash, or upward allocation trend |
| L6 · Beta pause/resume | On each owner fixture, enter a camera/media/heavy screen; note the session id; pause twice; interact for 30s; resume twice; then repeat with a 5s background and a separate 70s background while paused | During the foreground pause there are no new frames, hierarchy, interaction, network, or ordinary telemetry records and no periodic SDK work; `sdk_paused` is the final pre-gap event and exactly one paired `sdk_resumed` carries the same `pauseId` and a credible `gapDurationMs`; duplicate calls add no marker; the first resume frame arrives promptly; a 5s background keeps the session id; a 70s background performs the intentional rollover and the replacement remains paused until resume |

The maximum session duration is still controlled by `maxRecordingMinutes` and
ends with `duration_limit`; test it only when duration configuration or timer
ownership changed.

## Capture and privacy

| ID | Owner fixture and action | Pass condition |
| --- | --- | --- |
| C1 · interaction semantics | Expo Replay Lab: tap, rage-tap the same spot three times inside 500ms, tap a genuinely non-interactive blank area, scroll, and use nested gestures | Touch/gesture events have plausible coordinates; one rage-tap is produced; ordinary slow taps do not become rage taps; dead-tap classification is not duplicated |
| C2 · input privacy | Expo Replay Lab and Brew Add Post: type synthetic plain, numeric, secure, and multiline values | Input interaction is visible but typed values, secure values, private placeholders, and accessibility text do not leak |
| C3 · explicit masks | Expo Replay Lab, the Swift Countries list privacy demo, and Flutter Checkout | Every affected wrapper's explicit mask hides the full descendant region in stored frames, including nested text |
| C4 · static dedup | Leave an unchanged screen for 60s; navigate; conclude with Flutter Stop or L2 rollover; begin the next session on the same screen | Initial frame is stored; duplicates are sparse; the changed screen appears promptly; conclusion flushes the last frame; the next session stores its own first frame |
| C5 · maps | Expo Google Maps and Mapbox; Swift Map Test: idle, tap a control outside the map, pan/zoom for 30s, fling and release, then trigger one programmatic camera animation | An outside control tap does not mark the map moving; capture is suppressed while the camera moves and resumes only after a stable camera sample/SDK idle callback; the first settled Mapbox frame is nonblank; Android performs no synchronous Mapbox snapshot readback and recovers from a delayed/failed callback without retrying every frame; host callbacks still fire; leaving the screen releases cache/observers; repeatedly entering/leaving does not grow memory |
| C6 · media | Expo nested video, Swift nested/media video, and Flutter Video: play, pause, navigate away, return | Media is masked or represented according to config; controls remain responsive; no runaway frame growth, stale player observer, or blank replay |
| C7 · image/dense stress | Use the Stress image list and dense tree in the affected fixture for 10 minutes | Main thread remains responsive; queues stay bounded; memory settles; hierarchy emits truncation/bailout rather than blocking when its budget is exceeded |
| C8 · final playback | Watch each recorded session in the dashboard from beginning to end | Frames are ordered and nonblank, sparse-frame playback holds the prior frame, interactions align with the UI, and masked content never flashes |

## Network, offline delivery, and faults

| ID | Action | Pass condition |
| --- | --- | --- |
| D1 · app network | Use Swift Countries search/detail and a normal RN/Flutter network action | App requests contain URL, status/error, and realistic duration; Authorization and configured sensitive headers are redacted |
| D2 · SDK exclusion | Inspect network events during any upload | Rejourney configuration, presign, segment, and conclude requests never appear as captured app traffic |
| D3 · offline recovery | Go offline, interact, stop or kill, restore connectivity, relaunch | Persisted events and frames upload exactly once and the replay remains complete |
| D4 · background flush | Generate activity and immediately background the app | The app does not freeze; the upload finishes within the allowed background window or remains durably queued |
| D5 · handled and fatal faults | Use the Flutter example's built-in handled-error, ANR, and native-crash controls when stability code changed; on Android 11+ also trigger a system ANR/process termination and relaunch; on iOS validate one NSException/Swift fatal path and inspect MetricKit delivery when available | Handled/framework/platform/current-isolate errors have the expected source and are not duplicated; the live ANR duration is credible; Android historical exits include `source=application_exit_info` and the OS reason without inventing a stack; the iOS signal record has `source=async_signal_safe_marker` and does not claim frames; a native crash is delivered on relaunch; any pre-existing Crashlytics/error handler still runs; recovery produces a playable prior session |

Use network throttling only when timeout, retry, or transport code changed. A
slow-link pass must show realistic duration without blocking the UI.

## Performance gate

Use a Release build. Run Instruments on iOS or the Android profiler only for
changes that touch capture, buffers, timers, lifecycle, maps, media, networking,
or upload ownership.

| ID | Exercise | Pass condition |
| --- | --- | --- |
| P1 · sustained capture | Cycle map/media/image/dense/animated screens for 10 minutes | UI remains responsive; memory and thread counts settle; upload and frame queues remain bounded; replay stays faithful |
| P2 · lifecycle leaks | Run L5 in Flutter; in an auto-start fixture cross L2 twice; then leave the app idle for 2 minutes | No accumulating timers, URLSession/OkHttp calls, map subscriptions, callbacks, or observers |
| P3 · background pressure | Repeatedly background during capture and upload | No main-thread wait or freeze; data is uploaded or durably owned by the retry queue |
| P4 · extended session | Record for 30 minutes | Required only after buffer, persistence, capture scheduling, or duration changes; memory remains flat enough to avoid sustained growth and the final replay concludes cleanly |

For Flutter Android also inspect stored JPEGs directly. A replay row and object
count are insufficient: an Impeller readback can arrive as a syntactically valid
black image. Run one release/minified Android build when renderer discovery,
masking, or native capture changed.

## Payload and storage acceptance

With `collectDeviceInfo` enabled, confirm the batch contains the applicable
platform, SDK/app version, app id, model/OS, logical and physical screen size,
scale/density, coordinate space, network type, constrained/expensive flags, and
battery snapshot fields:

- `batteryLevelPercent`, when the OS reports a valid value from 0 through 100;
- normalized `batteryState` (`charging`, `full`, `unplugged`, or `unknown`);
- `lowPowerModeEnabled`.

With `collectDeviceInfo` disabled, identifying device fields and battery fields
must be absent; only the minimal operational envelope may remain.

The same envelope may contain permissionless, low-cardinality current context:
`thermalState`, `memoryPressure`, `memoryHeadroomMbBucket`, `fontScaleBucket`,
`uiStyle`, `layoutDirection`, `orientation`, and `displayMaxRefreshRateHz`.
Verify it changes only at lifecycle boundaries or after an OS callback; an idle
two-minute profile must show no Rejourney polling timer or display link.

At session end, confirm `session_metrics` receives the additive start/peak/end
summary: thermal state and throttled duration; memory pressure/event count and
128 MiB headroom buckets; font scale, UI style, layout direction, orientation
start/end/change count, and maximum refresh rate; plus battery start/end/delta,
start/end state, charging-state change, and low-power-mode observed. Research
Lake V1/V2 must expose the documented coarse battery buckets and the remaining
low-cardinality values. Missing OS values stay null/unknown and must never be
turned into a real zero-percent or zero-headroom observation.

These fields require no Android manifest permission and no iOS usage-description
key. With `collectDeviceInfo` disabled, both the current context and session-end
device-quality summary must be absent.

Every recorded run must satisfy all of the following:

- the session has the expected `end_reason` and `replay_available=true`;
- expected event and frame objects exist in storage;
- the dashboard replay is playable and visually inspected;
- capture/SDK counters agree with what was retained or explain intentional
  skips;
- no private input or masked region is visible in events, hierarchy, or frames.

## Release run record

Add one row per required app/platform run. Paste the dashboard replay URL, not
only a session id, so another person can inspect it. For L2 and L4, put both the
old and new/recovered replay links in Notes.

| Date | Commit | Package/version | Fixture | Platform/device | Build | Cases | Session id(s) | Replay URL(s) | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  | Expo Boilerplate | iOS |  |  |  |  |  |  |
|  |  |  | Expo Boilerplate | Android |  |  |  |  |  |  |
|  |  |  | Brew Coffee Labs | iOS |  |  |  |  |  |  |
|  |  |  | Brew Coffee Labs | Android |  |  |  |  |  |  |
|  |  |  | Swift Countries | iOS |  |  |  |  |  |  |
|  |  |  | Flutter example | iOS |  |  |  |  |  |  |
|  |  |  | Flutter example | Android |  |  |  |  |  |  |

Do not publish while a required row is missing, has no inspectable replay link,
or is marked failed. After a fix, rerun the failed flow and any later flow whose
result depended on it; a full restart of unrelated rows is unnecessary.
