# Manual SDK release matrix

Use this matrix after automated checks pass and before publishing an affected
mobile SDK. It validates the packages inside representative applications
against Rejourney Cloud production, then records both device videos and
dashboard replay links for review. Docker and the local stack stay stopped
while this matrix runs so the simulators and profilers get the host resources.

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
2. Run one full smoke flow for each changed native engine/platform, then a
   compact integration check for each additional affected wrapper. A second
   app using the same built RN bridge does not need to repeat engine-level map,
   lifecycle, or profiler work when its other-platform integration has passed.
3. Run a targeted row only when the change can affect that behavior or shared
   native core. Record every equivalence-based skip and its supporting run; do
   not silently omit a row or repeat the same engine-level test in every app.
4. Use synthetic values in inputs. Never enter real credentials, payment data,
   or personal information.
5. A run passes only when its replay is playable in the dashboard and its
   session row is concluded correctly. Console output alone is not evidence.
6. Drive ordinary interactions at human speed. Do not insert multi-second waits
   between taps merely to make automation easier; long waits are reserved for
   the documented 5s, 30s, 60s, and 70s lifecycle/dedup cases.
7. Record one row, device-video path/link, automation result path, and replay
   link per app/platform run in the results table. Add extra replay links for
   rollover and recovery sessions.
8. Once the matrix starts, an SDK code change invalidates every completed row
   that exercises the changed code. Apply the fix, add a regression test,
   rerun automated gates, and rerun those affected rows. Rows on an unaffected
   platform remain valid; documentation and harness-only corrections do not
   invalidate runtime evidence.

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

## Production test isolation

Use the production account `m.rashid.dev@proton.me`, team `Test Matrix`, and one
project per fixture:

| Fixture | Production project |
| --- | --- |
| Expo Boilerplate | `Matrix · Expo Boilerplate` |
| Brew Coffee Labs | `Matrix · Brew Coffee Labs` |
| Swift Countries | `Matrix · Swift Countries` |
| Flutter example | `Matrix · Flutter Example` |

Create a missing team/project once; otherwise reuse it. Each fixture's public
project key lives only in its ignored matrix environment file. Keep the
existing local key file intact. The checked-in switch defaults matrix launches
to `production`, accepts an explicit `local` override, and fails closed if the
selected ignored file is absent. Never paste a key into source, a Maestro flow,
a test report, or this document.

| Service | Matrix target |
| --- | --- |
| API | `https://api.rejourney.co` |
| Dashboard | `https://rejourney.co/dashboard` |
| Team | `Test Matrix` |

Before each matrix batch, confirm Docker Desktop is stopped and verify the
selected account, team, project, package version, commit, and device clock.
Do not infer success from an HTTP 2xx alone. Inspect production state through
the deployment host and store the resulting database/artifact report beside
the device evidence. Record the dashboard replay URL for later human playback,
but the matrix operator does not need to sign in to the website.

The ignored production environment file contains both `REJOURNEY_PUBLIC_KEY`
and `REJOURNEY_PROJECT_ID`. Read production through the deployment host only:

```bash
scripts/test-matrix/inspect-production-session.sh <fixture> [session-id] \
  | tee test-results/sdk-matrix/<run-id>/production-session.txt
```

The inspector uses `ssh -i ~/.ssh/vps_deploy root@46.224.98.62`, discovers the
current PostgreSQL primary, constrains the lookup to the fixture project, and
reports lifecycle state, pause ownership, artifact counts/timing, SDK quality
metrics, and pause markers. It never prints the project key.

Point the compatibility fixtures at this checkout before building:

```bash
(cd examples/brew-coffee-labs && npm run sdk:new)
npm run example:swift:sdk:new
```

Expo Boilerplate and the Flutter example already use local package paths.
Native edits require rebuilding the application.

Launch the requested target from the repository root with the checked-in matrix
launcher. Production is the default; pass `local` only for an intentional local
investigation outside the release matrix:

```bash
scripts/test-matrix/launch.sh expo ios
scripts/test-matrix/launch.sh expo android
scripts/test-matrix/launch.sh brew ios
scripts/test-matrix/launch.sh brew android
scripts/test-matrix/launch.sh swift ios
scripts/test-matrix/launch.sh flutter ios
scripts/test-matrix/launch.sh flutter android
```

## Human-speed automation and evidence

Use Maestro for repeatable app interaction and native device recording. Keep
one simulator/emulator and one app build active at a time. Build once per target
and run compact flows against that installed build; do not rebuild between
cases that use the same binary.

- ordinary tap cadence: 100–350ms apart when the UI is ready;
- normal scroll: 250–500ms swipes, including rapid direction changes;
- map pan/zoom: continuous 400–900ms gestures plus a burst of back-to-back
  gestures with settling capped at 500ms;
- assertions and screenshots occur at semantic checkpoints, not after every
  tap;
- use explicit waits only for asynchronous content or the lifecycle timings in
  this matrix;
- record the whole compact smoke flow and separate long lifecycle/performance
  flows so a failed case remains easy to locate.

Store automation output under the ignored `test-results/sdk-matrix/<run-id>/`
directory. Each run must retain the Maestro command/flow name, structured
result, screenshots on failure, native device video, build log, and profiler
export when required. A screen recording is evidence for visible stutter; it is
not a substitute for replay, payload, queue, and profiler checks.

Use two inspection layers to increase coverage without multiplying runtime:

1. During the run, assert launch, navigation, foreground recovery, pause state,
   and expected visible controls; inspect video for frame pacing, blank frames,
   touch lag, and micro-stutter.
2. After the run, inspect every generated production session through SSH for
   ownership, event/frame ordering, gaps, metrics, end reason, and storage
   completeness. Inspect the downloaded/stored frames for masks and blank or
   stale images, and record the replay link for the user's later dashboard
   playback. Cross-check session timestamps against the device recording rather
   than rerunning the same engine case in every fixture.

Example artifact-producing invocation:

```bash
TEST_MATRIX_RUN_ID=<run-id> scripts/test-matrix/run-flow.sh <fixture> <platform>
TEST_MATRIX_RUN_ID=<run-id>-lifecycle scripts/test-matrix/run-lifecycle.sh <fixture> <platform>
```

The wrapper emits a detailed HTML report, command manifest, logs, failure
screenshots, and the flow's native device recording into that run directory.
The lifecycle wrapper preserves app state across separately timed foreground
and background phases, covering active and paused 5-second returns plus the
intentional 70-second rollover. It also drives roughly 30 seconds of
human-cadence scrolling while paused so an idle-only gap cannot hide capture
work that still reacts to touches.

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
| L6 · Beta pause/resume | On each owner fixture, enter a camera/media/heavy screen; note the session id; pause twice; interact for 30s; remain foreground-paused for more than 70s; inspect production; resume twice; then repeat with a 5s background and a separate 70s background while paused | During the foreground pause there are no new frames, hierarchy, interaction, network, or ordinary telemetry records and no periodic SDK work; production keeps the row `processing` with `sdk_paused_at` and the matching `sdk_pause_id` instead of stale-finalizing it; `sdk_paused` is the final pre-gap event and exactly one paired `sdk_resumed` carries the same `pauseId` and a credible `gapDurationMs`; resume clears `sdk_paused_at` and retains the same session id; duplicate calls add no marker or state transition; the first resume frame arrives promptly; a 5s background keeps the session id; a 70s background explicitly ends the old row, sets `explicit_ended_at`, creates exactly one replacement, and that replacement remains paused until resume |

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

Profiler acceptance must include a saved baseline and SDK-enabled trace for the
same interaction script. Compare main-thread stalls, CPU time, allocations,
resident memory, thread count, and network/upload activity. Fail on a repeatable
SDK-correlated hitch, unbounded growth, retained app/map/media owner, periodic
work while paused, or a queue that does not drain. A single noisy peak without
repeatable correlation is recorded but is not by itself a regression.

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
- the stored replay assets and timing are inspected through production SSH,
  and a dashboard replay URL is recorded for later human playback;
- `capture_health_reported=true` for the new SDKs, and capture/SDK counters
  agree with what was retained or explain intentional skips; an older SDK may
  leave the presence bit false, in which case its zero defaults are treated as
  unavailable rather than as measured zeros;
- no private input or masked region is visible in events, hierarchy, or frames.

## Release run record

Add one row per required app/platform run. Paste the dashboard replay URL, not
only a session id, so another person can inspect it. Include the device video
and automation-artifact path/link. For L2 and L4, put both the old and
new/recovered replay links in Notes.

| Date | Commit | Package/version | Fixture | Platform/device | Build | Cases | Session id(s) | Replay URL(s) | Video/artifacts | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-28 | `8e648e33` + release working tree | React Native 1.5.1 | Expo Boilerplate | iOS simulator | Debug/local source | smoke; Beta pause/resume; privacy; stress; Google Maps; Mapbox; 60s rollover | `session_1787952005403_f7b16731829948f5bc0b027a0b34976f`; `session_1787952666689_d9446cd6d4644be98541c18c9600118f`; `session_1787953014794_95451780744c48d8b40f57803e0bacbb` | [smoke](https://rejourney.co/dashboard/sessions/session_1787952005403_f7b16731829948f5bc0b027a0b34976f); [rollover source](https://rejourney.co/dashboard/sessions/session_1787952666689_d9446cd6d4644be98541c18c9600118f); [replacement](https://rejourney.co/dashboard/sessions/session_1787953014794_95451780744c48d8b40f57803e0bacbb) | `test-results/sdk-matrix/` | Pass | User also visually inspected the iOS Mapbox and Swift map screens without glitches. |
| 2026-08-28 | `8e648e33` + release working tree | React Native 1.5.1 | Expo Boilerplate | Android 16 / Pixel 9 emulator | Debug/local source | build; navigation; Beta pause/resume; privacy; Google Maps; Mapbox; production payload | `session_1787962577105_997e4a2affdc4149996c3c37a5085361`; `session_1787962724115_6990c55ab24047e4a02c438ed553f125` | [clean explicit end](https://rejourney.co/dashboard/sessions/session_1787962577105_997e4a2affdc4149996c3c37a5085361); [combined interaction session](https://rejourney.co/dashboard/sessions/session_1787962724115_6990c55ab24047e4a02c438ed553f125) | `test-results/sdk-matrix/20260829T022900Z-expo-android-capture-final/device-map-gestures.mp4` | Functional pass; performance sample excluded | The combined session paired a 27.396s pause gap, retained 10 replay frames and 74 hierarchy batches, and uploaded at 98.99% with one retry. A simultaneous unrelated host build starved the emulator for 27.282s in `Choreographer`; the watchdog correctly reported the real runnable-main-thread stall, so this run is not a performance baseline. |
| 2026-08-28 | `8e648e33` + release working tree | React Native 1.5.1 | Brew Coffee Labs | iOS simulator | Debug/local source | compatibility smoke; tabs; pause/resume; media; rollover | `session_1787955542335_aef9596135b4429eb04a69baedd32baf`; `session_1787957109773_a54f97c3a9ac4f929215b0d0b52771fc`; `session_1787957478977_873733c5455848918581c60cbeaf7d69` | [smoke](https://rejourney.co/dashboard/sessions/session_1787955542335_aef9596135b4429eb04a69baedd32baf); [rollover source](https://rejourney.co/dashboard/sessions/session_1787957109773_a54f97c3a9ac4f929215b0d0b52771fc); [replacement](https://rejourney.co/dashboard/sessions/session_1787957478977_873733c5455848918581c60cbeaf7d69) | `test-results/sdk-matrix/` | Pass | Older Expo/RN compatibility fixture. |
| 2026-08-28 | `8e648e33` + release working tree | React Native 1.5.1 | Brew Coffee Labs | Android | Same RN Android bridge as Expo | wrapper-only repeat | — | — | — | Equivalence skip | Skipped at user-directed wrap-up: Expo Android exercised the changed Kotlin/RN bridge; Brew iOS exercised the Brew wrapper; RN Android unit tests and the Expo consumer build passed. |
| 2026-08-28 | `8e648e33` + release working tree | iOS 0.5.2 | Swift Countries | iOS simulator | Debug/local source | SwiftUI; REST Countries; MapKit; pause; stress; payload | `session_1787959154933_9efdbd3ebce74773aae31f4eb5534849` | [replay](https://rejourney.co/dashboard/sessions/session_1787959154933_9efdbd3ebce74773aae31f4eb5534849) | `test-results/sdk-matrix/20260829T002700Z-swift-ios-smoke-final/` | Pass | 67/67 artifacts ready; 20/20 decoded JPEGs nonblank; 6.467s pause gap with no leaked capture. |
| 2026-08-28 | `8e648e33` + release working tree | Flutter 0.4.1 | Flutter example | iOS simulator | Debug/local source | masks; video; image/dense/3D; pause; explicit stop; payload | `session_1787959757505_db3f16c34d8e4791970499aad76f7213` | [replay](https://rejourney.co/dashboard/sessions/session_1787959757505_db3f16c34d8e4791970499aad76f7213) | `test-results/sdk-matrix/20260829T010000Z-flutter-ios-continuation/` | Pass | 76/76 artifacts ready; 51 JPEGs decoded, 47 unique, none blank; 4.402s pause gap with no leaked capture. |
| 2026-08-28 | `8e648e33` + release working tree | Flutter 0.4.1 | Flutter example | Android 16 / Pixel 9 emulator | Debug/local source, Impeller/OpenGLES | full smoke; pause; ANR false/true-positive regression; payload | `session_1787960256875_5fb0750a852242979da0fa48317a7c6e`; `session_1787960788481_1cb2871e6a034e42bfc1fc95aa7e56c8` | [full smoke](https://rejourney.co/dashboard/sessions/session_1787960256875_5fb0750a852242979da0fa48317a7c6e); [post-fix ANR regression](https://rejourney.co/dashboard/sessions/session_1787960788481_1cb2871e6a034e42bfc1fc95aa7e56c8) | `test-results/sdk-matrix/20260829T014000Z-flutter-android-anr-trigger/` | Pass | Normal stress produced zero ANRs after the fix; one deliberate 7s main-thread sleep produced exactly one 5.006s `timed_waiting` ANR with the expected stack. Frames decoded nonblank with no consecutive duplicates. |

Do not publish while a required native engine/platform lacks a passing run, a
recorded equivalence skip lacks supporting evidence, an inspectable replay is
missing, or a row is marked failed. After an SDK code fix, rerun the affected
rows required by Run rule 8; do not mix pre-fix and post-fix evidence for the
same changed code path.
