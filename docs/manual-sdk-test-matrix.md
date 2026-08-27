# Manual SDK test matrix

What to exercise by hand on a simulator before shipping an SDK, what each case
should produce, and how to confirm it actually arrived.

Automated tests cover units and compilation. They do not cover what this
document does: whether a real app on a real simulator produces a replay whose
events are complete, correctly shaped, and correctly attributed to a session.

## Setup

Run the local stack and point the example app at it, so replays land somewhere
you can inspect:

```bash
npm run dev:resume
```

| Piece | Where | Used for |
| --- | --- | --- |
| API | `http://127.0.0.1:3000` | ingest, presign, session conclude |
| Dashboard | `http://127.0.0.1:8080` | watching the replay back |
| MinIO | NodePort `30900` | the stored segment and frame objects |
| Postgres | `127.0.0.1:5432` | `sessions`, `events`, `replay_available` |

The iOS Simulator shares the host network, so `127.0.0.1:3000` works directly.
A physical device needs the LAN address in `PUBLIC_API_URL` instead.

Useful checks while testing:

```bash
psql "postgresql://rejourney:rejourney@127.0.0.1:5432/rejourney" -c "select id, started_at, ended_at, end_reason, replay_available from sessions order by started_at desc limit 5;"
```

## Session lifecycle

Worth stating plainly, because it is easy to assume otherwise: **backgrounding
does not end a session.** The SDK records the background entry, accumulates the
time in `_bgTimeMs`, and continues the same session on return. There is no
inactivity timer.

There *is* a maximum recording duration, and it comes from remote config
(`maxRecordingMinutes`, 10 minutes by default). When it elapses the session ends
on its own with reason `duration_limit`. So a session ends on: explicit stop,
the duration limit, or next-launch finalization after a crash.

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| L1 | Cold start | Launch app fresh | One `app_startup` event; new session id; `started_at` set |
| L2 | Background and return quickly | Home, wait 5s, reopen | **Same session id.** `app_background` then `app_foreground`. No second `app_startup` |
| L3 | Background and return after a long gap | Home, wait 10 min, reopen | **Still the same session id** — there is no resume window. Background duration accumulates |
| L4 | Explicit stop | Call stop from the example app | Session concluded, `end_reason` set, `replay_available` becomes true |
| L5 | Kill from app switcher | Swipe away while recording | Session left open; finalized on next launch |
| L6 | Relaunch after kill | Reopen the app | Log line `Crash recovery finalize: success=true`; prior session gets `end_reason=recovery_finalize`; a **new** session starts |
| L7 | Two sessions in one launch | stop, then start again | Two distinct session ids; the first is complete and playable |
| L8 | Duration limit | Leave a session running past `maxRecordingMinutes` | Session ends by itself, reason `duration_limit`, replay complete and playable |
| L9 | Double start | Call start twice without stopping | One session, not two. No duplicate timers or observers |
| L10 | Stop with no session | Call stop while idle | No-op, no crash |
| L11 | Start before configure | Call start first | Fails cleanly with a clear message; no half-started state |
| L12 | Rapid start/stop | 10 cycles as fast as the UI allows | 10 clean sessions; no orphans; allocations flat |
| L13 | Sampled out | Set `sampleRate` low enough to exclude | No replay uploaded, and the app still behaves normally |
| L14 | Remote kill switch | `rejourneyEnabled=false` | Recording never starts; no network traffic beyond config |
| L15 | Observe-only | `observeOnly=true` | Events observed, nothing uploaded |

## Capture correctness

| # | Case | Steps | Expected event |
| --- | --- | --- | --- |
| C1 | Tap | Tap a button | `touch`, `isInteractive: true`, plausible `x`/`y` |
| C2 | Dead tap | Tap a non-responsive area | `touch` followed by a dead-tap event ~400ms later |
| C3 | Rage tap | Tap the same spot 3+ times inside 500ms | One rage-tap event with `count >= 3`. **The window is 500ms** — slower taps correctly produce none |
| C4 | Scroll / swipe / pan | Scroll a long list | `gesture` events, throttled rather than one per pixel |
| C5 | Pinch and rotate | Two-finger gestures | `gesture` with `scale` / `angle` |
| C6 | Text input | Type into a field | `input` event; **the typed value must be masked** |
| C7 | Password field | Type into a secure field | Masked, always, regardless of remote config |
| C8 | Navigation | Push and pop a screen | `navigation` events with entering/leaving |
| C9 | Screenshots | Move through several screens | Frames present and in order; timestamps monotonic |
| C10 | Manual redaction | Mark a view `rj_occlude` | The region is masked in the played-back frame |
| C11 | Duplicate frames dropped | Start a session, leave the screen untouched for 60s | **Frames stored should be ~1, not ~60.** Identical screenshots are not uploaded |
| C12 | Change after a static stretch | Sit idle, then navigate | The new screen is captured promptly — dedup must not suppress a real change |
| C13 | Static session still flushes | Start, stay on one screen, stop | The single frame reaches storage. Dedup must skip only the append, never the flush |
| C14 | Dedup resets per session | Stop, start again on the same screen | The new session stores its own first frame rather than treating it as a duplicate of the last |
| C15 | Playback of a deduped session | Play back C11 in the dashboard | The screen is shown for the whole duration, not blank between sparse frames |

## Stress screens

The capture path is cheap on a plain form and expensive on the screens users
actually complain about. These are the ones that have historically driven both
the throttle and the map heuristic, so they are where a regression shows up
first — and where a change that looks harmless on a settings screen stops being
harmless.

Every case here needs three things checked together, because they trade against
each other: **the replay is still faithful**, **the main thread is not blocked**,
and **memory does not climb**. A screen that captures perfectly while hitching is
a fail, and so is one that stays smooth by recording nothing.

> These screens do not exist in the example apps yet. Adding a stress section to
> each example (map, media, long image list, dense layout) is a prerequisite for
> running S1-S8 as written.

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| S1 | Map idle | Open a map, leave it still | Captured normally at the configured interval |
| S2 | Map panning | Pan and zoom continuously for 30s | Capture suppressed while the camera moves — this is the capture-when-idle heuristic, not a bug. `framesSkippedMapMoving` reflects the cost |
| S3 | Map settle | Stop panning | Capture resumes promptly once the SDK reports idle; the settled map is in the replay |
| S4 | Embedded video | Play an inline video | Video surface masked or captured per config. **No stall**, and no runaway frame growth from a constantly-changing surface |
| S5 | Embedded image | Screen with a large image | Captured; masking rules still applied |
| S6 | Long image scroll | Fling through a list of many images | Frames throttle rather than queue without bound. `framesSkippedBacklog` should stay at or near zero — if it climbs, encoding is not keeping up |
| S7 | Dense screen | Hundreds of elements, deep nesting | Hierarchy scan stays inside its 16ms budget. Expect `truncated` or `bailout` markers rather than a blocked main thread |
| S8 | Sustained stress | Cycle S1-S7 for 10 minutes | Memory flat, no thread growth, session still concludes cleanly and plays back |

Watch during all of these: `framesCaptured` against the frames actually stored.
A large gap is the throttle or the backlog gate working, and the counters say
which. On a simulator the numbers are pessimistic — software rendering makes
capture far more expensive than on device — so treat them as an upper bound.

## Errors, crashes and hangs

| # | Case | How to trigger | Expected |
| --- | --- | --- | --- |
| E1 | Handled error | Report one from the example app | `error` event with `name`, `message`, `stack` |
| E2 | Unhandled JS error (RN) | Throw in a component | `error` with `handled: false` and a `source` |
| E3 | Native uncaught exception | Force an NSException | Incident stored; delivered on next launch with the **original** exception stack, not the signal handler's |
| E4 | Signal crash | Force a segfault | Incident recorded; session finalized with `recovery_finalize` on relaunch |
| E5 | ANR / main-thread hang | Block main for 5s+ | `anr` event with `durationMs`. The watchdog must **not** publish its own stack as app evidence |
| E6 | MetricKit hang report | Background the app after a hang | Diagnostics attach on a later launch |
| E7 | Crash during upload | Crash mid-flush | Segments already on disk survive and upload on relaunch — no lost replay |

## Network and API capture

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| N1 | Successful request | Trigger a GET | Network event with URL, status, duration |
| N2 | Failing request | Point at a dead host | Recorded with the error, no crash |
| N3 | Slow request | Throttle the network | Duration reflects reality; no main-thread stall |
| N4 | SDK's own uploads | Watch during any activity | **Rejourney's own requests must not appear** — `RejourneyURLProtocol` is stripped from the upload session |
| N5 | Header redaction | Send an Authorization header | Value not stored in plain text |
| N6 | Native API call | Use a native module | Recorded distinctly from JS-originated calls |

## Offline and delivery

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| D1 | Offline capture | Airplane mode, use app, restore network | Nothing lost; segments persisted then uploaded |
| D2 | Offline then killed | Airplane mode, use app, force quit, restore, relaunch | Replay still arrives. **This is the case `waitsForConnectivity=false` fixed** — parked requests used to die with the process |
| D3 | Slow link | Network Link Conditioner, "Edge" | Large segments still complete — the 60s resource timeout matters here |
| D4 | Backgrounded upload | Background immediately after activity | Upload finishes in the background window; app does **not** freeze on backgrounding |

## Performance and leaks

Instruments, on a Release build. These are the cases the SDK has actually
regressed on before.

| # | Case | Method | Expected |
| --- | --- | --- | --- |
| P1 | Backgrounding freeze | Background repeatedly during heavy activity | No hitch. The retry drain is fire-and-forget; the main thread is never parked on a utility queue |
| P2 | Heavy screen | Blur, glass, large lists, maps | Adaptive throttle stretches the capture interval instead of dropping frames on the floor |
| P3 | Map screens | Pan and zoom a map continuously | Hierarchy capture throttles while the map moves |
| P4 | Repeated start/stop | 20 cycles | **Allocations flat.** Regression guard: each `activate()` used to leak a repeating 5s timer |
| P5 | Long session | 30+ minutes of use | Memory flat; disk queue bounded; no unbounded event growth |
| P6 | Deep view tree | A screen with hundreds of views | Scan stays inside its 16ms budget and bails out rather than blocking |
| P7 | Leak check | Instruments Leaks over a full session | No growth in `URLSession` tasks, timers, or observers |
| P8 | Connection leak (Android counterpart) | Many uploads | Connections returned to the pool; no OkHttp "leaked connection" warnings |

## Android: Flutter rendering (Impeller)

Flutter on Android is the hardest capture target in the product, and the
machinery that makes it work is Android-and-Flutter-only:
`FlutterFrameCapture`, `RetainedCapturePolicy`, `FrameContentAnalyzer`. None of
it is shared, and none of it is exercised by any iOS test.

The failure it exists to prevent is **black frames**: a whole-window readback of
an Impeller-backed surface can come back blank, and a small native toast or
overlay could make that blank readback look valid. So a replay that "arrives"
proves nothing here — the frames have to be looked at.

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| A1 | Impeller frames are not black | Record on a default (Impeller) build, then open the stored frames | Real UI in the JPEG, not a black or blank rectangle |
| A2 | Black-frame analyzer | Same run | A failed readback is rejected rather than uploaded as a valid frame |
| A3 | Retained layer capture | Record a complex/animated scene | Captured via the retained layer tree, without replacing the live `FlutterSurfaceView` |
| A4 | Retained heartbeat | Leave a scene idle | Roughly a 15s heartbeat on affected renderers, not a heavy readback every 5s |
| A5 | Masking on compatibility frames | Open the checkout demo | **Card number still masked** on the compatibility path, not just the normal one |
| A6 | Minified build | Run a release/minified build | Surface found by typed view hierarchy, not by obfuscated class name |
| A7 | Navigator transitions | Push and pop routes | Transitions settle before capture; no torn frames |
| A8 | Software renderer | Emulator with software rendering | Reduced readback resolution; no stalls |

## Expected payload shape

`deviceInfo` on a batch, with `collectDeviceInfo` at its default:

`platform`, `time`, `sdkVersion`, `model`, `osVersion`, `vendorId`,
`networkType`, `isConstrained`, `isExpensive`, `appVersion`, `appId`,
`screenWidth`, `screenHeight`, `screenWidthPixels`, `screenHeightPixels`,
`screenScale`, `pixelRatio`, `coordinateSpace`, `systemName`, `name`.

With `collectDeviceInfo` disabled only `platform`, `time` and `sdkVersion`
remain — that is the assertion for the privacy control.

Event `type` values the core emits: `app_startup`, `app_background`,
`app_foreground`, `touch`, `gesture`, `input`, `navigation`, `error`, `anr`,
`log`, `custom`, `user_identity_changed`.

## Per-SDK notes

| | Native iOS | React Native | Flutter |
| --- | --- | --- | --- |
| Example app | `examples/ios-native` | `examples/react-native-bare` | `packages/rejourney/example` |
| View tree | Real UIViews | Real UIViews | Single rendering surface |
| Redaction | View scan | View scan | **Rects pushed from Dart** — test `RejourneyMask` explicitly |
| Errors | Native only | JS + native | Dart + native |

Flutter's masking is the one case where the other two SDKs' coverage tells you
nothing: there are no native views to find, so a mask that works on iOS native
proves nothing about Flutter. Test C10 separately there.
