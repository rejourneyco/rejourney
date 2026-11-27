# Verification

What was tested for each release, and what each run showed.

## 0.1.3: capture matrix, recording-time limit, crash-reporter coexistence

Unity 6000.6.10f1, URP 17.6. The lab is `examples/unity-capture-matrix`; its scripts are
in `scripts/test-matrix/unity-capture`.

### What production showed

| Check | Observed |
|---|---|
| Frames of about 1,000 stored sessions of one URP game, sampled across 12 app versions and both platforms, each tested for orientation | Upside down only on iOS in the one app version that turned MSAA on at runtime: 24 of 28 sessions of that version, none of 301 iOS sessions on the two later versions (MSAA off again), none of 360 Android (Vulkan, pre-rotation) sessions. iOS builds of that game use "Metal Write-Only Backbuffer", so they capture inside URP |
| Sessions that reached the 600-second recording-time limit | 3,944 of 156,982 for the same game, although it restarts its session every 540 seconds itself |
| Crashes stored for Unity projects | None for games in production; the largest had `CaptureCrashes` off because it also runs Crashlytics |

### Capture matrix

Each configuration renders fixed markers (camera-rendered quads, overlay UI, a masked
box, an overlay camera's box) and checks one captured frame for orientation, masking,
scale and position (samples just either side of every boundary) and completeness. While a capture runs, the real back buffer is read at the end of every
frame, as a game's own screenshot would be, and must show the same picture.

| Lane | 0.1.2 | 0.1.3 |
|---|---|---|
| macOS player, Metal, Linear: 316 configurations (default renderer run before the fix: 76) | `ScreenCapture` path 38/38. In-pipeline path 0/38: camera image upside down in every configuration, and with MSAA 4, no HDR, no post-processing the UI and its masks were upside down too, leaving the masked box readable. Tile-Only renderer: a render graph exception at every capture | 316/316 |
| macOS player, Metal, Gamma | not run | 316/316 |
| iOS 26.5 simulator, Metal, IL2CPP high stripping, real native bridge, all four orientations: 358 configurations | not run | 358/358 |
| Same run in the cloud: every stored frame downloaded and checked | not run | 246 frames, all upright and masked |
| Android 17 emulator, Vulkan, IL2CPP ARM64, GameActivity, real native bridge: 358 configurations | not run (the emulator crashed in earlier releases) | 358/358, and all 279 stored frames upright and masked |
| Android emulator, Vulkan with pre-rotation (`vulkanEnablePreTransform`) | not run | 358/358 |
| Android emulator, GLES3 (software renderer: ANGLE, OpenGL ES 3.1), default renderer, both capture paths, four orientations | not run | Every frame upright and masked. Only these 21 configurations were run there; the renderer draws about one frame a second. On a rotation that changes the screen's dimensions the engine logs two render-pass errors, with the SDK paused as well |
| EditMode suite | 63/63 | 68/68 |

The matrix covers: both capture paths; URP default, intermediate-texture-always,
Tile-Only and 2D renderers and the built-in pipeline; MSAA 1/2/4; HDR; render scale 1 and
0.8; post-processing with and without FXAA; camera stacking; depth and opaque textures;
dynamic resolution; on-demand rendering every fourth iteration. A write-only back buffer
with the built-in pipeline or a Tile-Only renderer has no readable source: those
configurations pass when their frames are skipped with a reason and nothing is logged.

Not covered: physical devices (the frames above come from a simulator and an emulator;
the production game draws its menus entirely as overlay UI, so its stored frames show
the UI's orientation on phones but not the camera image's),
HDR display output, XR and AR camera backgrounds, split-screen with several base cameras,
and `OnGUI` drawing in the in-pipeline path, which is not captured.

### Sessions, errors and crashes (iOS 26.5 simulator, cloud)

| Check | Observed |
|---|---|
| `abort` and a write to address 16, while recording | Stored as SIGABRT and SIGSEGV crashes on the crashed session when the next session started |
| `abort` while paused, and after `StopAsync` then `StartAsync` | Stored on the paused session and on the second session |
| Unhandled exception on a managed thread | The player survives; stored as an unhandled error |
| Stand-in crash reporter installed before Rejourney, then a write to address 16 | The reporter received signal 11, code 2, address 0x10 on the main thread, and Rejourney stored the crash. Installed after Rejourney: the same. With `abort`: signal 6 on the main thread |
| Recording-time limit, 0.1.2 | At 600 seconds the session ended in the cloud while `State` stayed `Recording`. An error logged and an `abort` 50 seconds later were not stored |
| Recording-time limit, 0.1.3 | A new session started 6 seconds after the limit and `State` never left `Recording`. The error and the `abort` 45 seconds later are stored on the new session |
| Recording-time limit while paused | The new session started paused (`SessionsContinued` 1, `State` `Paused` throughout), `ResumeAsync` returned it to `Recording`, and the later error and crash were stored |

### Sessions, errors and crashes (Android 17 emulator, cloud)

| Check | Observed |
|---|---|
| `abort` and a write to address 16, while recording, while paused, and after `StopAsync` then `StartAsync` | Each stored as a crash on the crashed session when the next session started, from the system's exit record (`REASON_CRASH_NATIVE`, no stack) |
| Exception thrown in a callback on the Android main thread, and on a managed thread | The player survives; stored as unhandled errors |
| Recording-time limit | New session 7 seconds after the limit, `SessionsContinued` 1, `State` `Recording` throughout. An error and an `abort` a minute later are stored on the new session |
| Warnings per frame handed to Java | 0.1.2 development build: two `AndroidJNIHelper` warnings for every frame. 0.1.3: none |

### Performance and memory

The lab's `--perf` mode runs one scene (400 moving quads, 24 UI labels, the markers) for
15 seconds per case and compares each case with the same scene without a session.
Simulator and emulator figures are relative; the device figures come from production.

| Check | Observed |
|---|---|
| Phones in production (0.1.2, one URP game, 1 FPS replay): 119,000 five-second frame-time samples from device models seen both with replay and telemetry-only (163 Android, 44 iOS) | No difference. Android: median 59.6 FPS and p95 16.72 ms with replay, 59.5 FPS and 16.73 ms without. iOS: 59.4 FPS and 17.28 ms with, 59.6 FPS and 17.24 ms without. Long frames per sample 1.08 and 1.03 with replay, 1.15 and 1.39 without |
| Frame times, macOS player and iOS 26.5 simulator, every case | p50, p95 and p99 within noise of the SDK-off run (16.67 / 17.6 ms at 60 FPS) |
| SDK time on the main thread, macOS player (Mono) | Telemetry only 1.1-1.4 ms per second; replay 1.4 (1 FPS) and 2.1 (3 FPS) from the screen, 1.8 and 2.8 inside URP |
| The same, iOS simulator (IL2CPP debug configuration), loopback and native bridge | 2.5 telemetry only; 3.1-4.6 with replay; 3.6-4.6 through the native bridge |
| Managed allocations, macOS development player, over the SDK-off scene | Telemetry only 6 KB/s. Replay adds the JPEG handed to native for each frame (24 KB here) plus about 2 KB: 32 KB/s at 1 FPS, 83 KB/s at 3 FPS |
| 60 logs and 10 events a second, replay at 3 FPS | Before: 7.5 ms/s on the main thread and 700 KB/s of allocations beyond the same calls made without a session. After coalescing hand-overs to native: 3.8 ms/s and 165 KB/s. Native bridge on the simulator: 18 ms/s |
| Memory while recording | macOS at 1280 x 720: 5.5 MB of textures and 2.7 MB managed. iOS simulator at 1206 x 2622: 13.6 MB of textures from the screen; inside URP up to 44 MB while the pipeline's intermediate and depth textures for the capture frame are pooled |
| Memory after capture stops | Textures and the readback buffer released within five seconds; graphics memory back at the SDK-off figure |
| Android emulator | At 1 FPS within noise of SDK-off. At 3 FPS the emulated GPU stalls on every readback and the frame rate collapses; phones in production show no such effect at 1 FPS, and 3 FPS on a phone has not been measured |


## 0.1.1: write-only Metal back buffer

| Gate | Observed result |
|---|---|
| iPhone 15 Pro, iOS 27, Unity 6000.6.4f1, URP 17.6, IL2CPP, Metal Write-Only Backbuffer **on**, SDK 0.1.0 | Every stored frame black (game pixels RGB 0,0,0); only mask boxes visible. `ScreenCapture` cannot read the back buffer |
| Same device and project, render-pipeline capture | Full-colour frames with Screen Space - Overlay UI; first build upside down with masks on mirrored rows, corrected by flipping on UV-top APIs as for `ScreenCapture`; second build upright, masks on the reported elements |
| Compile, Unity 6000.6.4f1 + URP 17.6.0, Android and iOS build targets | Clean, including the iOS build hook that records the setting |
| EditMode suite | 63/63 passed |
| Readable back buffer (default) | Capture path unchanged from 0.1.0 (`ScreenCapture`) |

The 0.1.0 results below still apply to builds with a readable back buffer.

## 0.1.0

### Cloud sessions (production, dedicated Unity validation project)

The scripted Arcade Lab run (all rooms, orientation change, additive scene,
unwrapped HTTP scenarios, handled exception, pause/resume, flush, stop) was
recorded against the deployed cloud and the stored artifacts were decoded.

| Gate | Observed result |
|---|---|
| iOS 26.3 simulator, Metal, URP, IL2CPP high stripping, Unity 6000.6.2f1 | Session ready; explicit end; lifecycle assertion passed; 39–40 frames in 3-frame bundles; screen views, network requests (8, 4 deliberate failures), identity, metadata, scene events, performance samples and pause markers present; Unity runtime metadata on the session |
| Frame orientation and masking (Metal) | **Fixed.** Metal captures arrived upside down with masks on the wrong rows, exposing text-field canaries. Corrected captures are upright in portrait and landscape and every canary (uGUI, TMP, UI Toolkit, world-space, moving label) is masked |
| Handled exception before pause | **Fixed.** Lost when an in-flight event drain was joined; now delivered before native pause (regression test reproduces the old failure) |
| uGUI privacy adapter in IL2CPP players | **Fixed.** Stripped from player builds because Unity ignores package `link.xml`; now linked (verified in IL2CPP output) and fail-closed if absent |
| Gameplay markers, scripted run (iOS 26.3 simulator, Unity 6000.6.2f1) | Two intervals in the stored events: arena ended `quit` at 3.1 s, and arena ended `completed` at 42.4 s (score 3). The backend's research-lake builder, run locally on the downloaded artifacts, reads 0 unrecognized rows, 2 segments and 17 rows inside play, and leaks no raw names or ids |
| Gameplay markers, interactive run (simulator taps) | Arena taps and taps that began during play carry the segment id with `rageEligible: false`; Shop taps and the tap that started the next round do not. `StopAsync` wrote `session_end` for the active segment. The session record stores the markers, and the fallback intervals match the timeline's |
| Background lifecycle (iOS simulator) | Under 60 s: the same session resumes, and the time away is left out of its duration. Over 60 s: the old session ends at the moment it left the foreground, and a new one starts on return with a screen view and a `continued` gameplay start. Killed while in the background: the next launch recovers and closes the session at the moment it left the foreground. **Fixed:** a momentary `Error` state while native replaced the session, and gameplay markers written from a game's pause handler |
| Network traces, unwrapped `UnityWebRequest` and `HttpClient` | All 8 requests stored with status, duration and size: 200; 500 with its status text; a redirect chain ending in 200; a 64 KiB body; a 1 s timeout (status 0); an abort (cancelled); and an `HttpClient` 200 and cancellation. Session metrics: 8 requests, 4 succeeded, 4 failed |
| Errors | Four errors, each stored once with its exception type, handled flag, source, screen and incident id, and grouped into issues titled by type: `CaptureException` (handled, with the caller's stack); `Debug.LogError` from a worker thread; an exception thrown in a UI handler (unhandled, full stack); and an unobserved task exception, collected by the GC on IL2CPP. **Fixed:** every Unity issue had been titled "managed", and unobserved task exceptions were not captured |
| Hangs | A 7 s game-loop stall and a 7 s native UI-thread stall were stored as hangs of 7750 ms and 7483 ms. **Fixed:** hangs had been reported at detection, which stored 7 s stalls as 5.2 s and 5.9 s |
| Native crash (`abort`) | The signal marker recorded SIGABRT. The report was uploaded when the next session started and stored as a crash for the crashed session (crash count 1, one crash issue), and that session was closed at its last activity. In one of two runs the first upload attempt did not land, and the report arrived at the following session start |
| Timestamps after the device sleeps | **Fixed.** C# events and frames were stamped with the start time plus a stopwatch, and the stopwatch stops while the device sleeps. After the host slept 47 min, events were stamped 47 min early and native rejected every frame of the next session. They now use the wall clock, covered by a regression test |
| Android | See matrix below |

### Compatibility matrix (observed)

| Lane | Build | Runtime in the cloud |
|---|---|---|
| Unity 6000.6.2f1 · iOS simulator · Metal · URP · Gamma · legacy input · IL2CPP high stripping | Passed | Upright, masked frames; all event types; delivered |
| Unity 6000.6.2f1 · iOS simulator · Metal · Built-in pipeline · Linear · Input System (both) | Passed; Input System adapter linked | Upright, masked frames; delivered |
| Unity 6000.3.24f1 LTS · iOS simulator · Metal · URP · IL2CPP | Passed | Upright, masked frames; error event; delivered |
| Unity 6000.6.2f1 · iOS device · release and development IL2CPP | Passed (signed with the existing profile) | Not run; the simulator lanes above cover the runtime |
| Unity 6000.6.2f1 · Android IL2CPP ARM64 · GameActivity · Vulkan (development and R8 release) | Passed | Emulator crashed inside its own Vulkan driver's debug-label call (development) or was CPU-starved (release) |
| Unity 6000.6.2f1 · Android IL2CPP ARM64 · GameActivity · GLES3 | Passed | Emulator hung creating a GLES 3.0 context before the SDK started |
| Unity 6000.6.2f1 · Android Mono ARMv7 · Activity · GLES3 | Passed; APK carries the ARMv7 signal library and both Rejourney assemblies | Not run (arm64-only emulator) |

Frame orientation depends on the graphics API's UV origin. Metal was observed upside
down before the fix and upright after it. Vulkan is corrected by the same rule; GLES,
and Vulkan with pre-rotation (`vulkanEnablePreTransform`), have not been run.

### Package tests

| Gate | Observed result |
|---|---|
| Release tarball, fresh projects without optional adapters | 63/63 passed on Unity 6000.3.24f1 LTS and 6000.6.2f1 (`scripts/test-unity-package.mjs`), including the gameplay, rollover and capture tests |
| Unity 6000.3.24f1 (LTS) EditMode, uGUI + Input System installed | 63/63 passed, including linker hand-off, uGUI fail-closed, weaver assembly filter, byte-exact direct-event JSON parity, isolation from global Newtonsoft settings, errors reported with console capture off, the in-flight drain regression, and the gameplay marker contract (start/end pairing, pre-recording start marked continued, rollover restart, stop writes `session_end` without ending the segment, supersede and scope, tagged non-rage-eligible touches during play, oversized properties dropped), markers written from pause handlers and during an explicit pause, the native rollover gap (no `Error` inside the grace period, one set of session markers after a restart), and the capture contract (wall-clock times after a simulated device sleep, exception type and handled flag for Unity log exceptions, log errors and assertions, `CaptureException` with the caller's stack, unobserved task exceptions) |

### Micro-benchmarks (Unity 6000.3 Editor, Mono JIT; lower is better)

Same workloads before and after the optimization pass. Allocations are measured
as heap growth and can under-count small objects; relative changes are reliable.

| Hot path | Before | After |
|---|---|---|
| Log serialization (per Debug.Log) | 8.1–9.3 µs, 1.2–1.5 KB | 0.9–1.0 µs, 0.27 KB |
| Touch event | 36.4 µs | 5.4 µs, 0.72 KB |
| `LogEvent` custom event | 12.5–14.0 µs, 2.3–2.5 KB | 3.2–3.6 µs, 1.1 KB (half is the caller's dictionary) |
| Event batch drain, per event | 11.7 µs, 0.70 KB | 5–6 µs, 0.53 KB |
| Mask bounds, 13-node UI subtree | 7.0 µs, 0.93 KB | 6–7 µs, no per-mask allocation |
| Privacy collection, 8 masks (EditMode measures the fail-closed uGUI scan) | 17.0 µs, 2.6 KB | 11.3 µs; per-capture object scans still allocate small arrays |

Frame capture additionally reuses one readback buffer instead of allocating the
full RGBA frame per capture (about 1.7 MB at 442×960), uploads frames in bundles
of three (about a third of the presign/PUT/confirm requests), and sends hierarchy
snapshots only when their content changes.

### Benchmark suite (iOS 26.3 simulator, Unity 6000.6.2f1, release-compiled SDK)

Eight matched 60-second cases after a 10-second warmup, each SDK case in its own
cloud session, each scene with an SDK-disabled baseline. Unity ships only a
development engine runtime for the simulator, so treat these as relative numbers;
device figures are pending.

| Case | FPS | Main-thread CPU p95 vs scene baseline | SDK main-thread cost | Frames sent / dropped |
|---|---|---|---|---|
| Telemetry only | 60.0 | +0.2 ms (noise level) | 1.29 ms/s | — |
| Replay, 1 FPS, 960 px, q50 | 60.0 | +0.2 ms | 1.56 ms/s | 59 / 0 |
| Replay, 1920 px, q90 | 60.0 | +0.2 ms | 1.87 ms/s | 59 / 0 |
| Replay, privacy room (7 masks, UI Toolkit) | 60.0 | −0.1 ms | 1.58 ms/s | 59 / 0 |
| Replay + 60 logs/s, 10 events/s, HTTP every 2 s | 60.0 | +0.1 ms | 6.45 ms/s | 59 / 0 |

Frame-interval p50/p95/p99 matched the baselines in every case, and no event,
privacy or backpressure drops occurred. The stress case stopped as Queued: uploads
were durably spooled rather than acknowledged at stop, which is the documented
semantics. Per-frame GC figures include the example's own IMGUI strings (which grow
with the session ID) and Unity's log-callback strings, so they are not SDK-only.

### Build and native gates

| Gate | Observed result |
|---|---|
| iOS XCFramework (device + simulator) | Built; all six public C exports present; provenance manifest updated |
| Android AAR | Built; 16 KB ELF alignment passed; provenance manifest updated |
| Core/controller synchronization | Passed |

Coverage limits include opaque DLLs, native/custom transports, system keyboards,
external overlays and XR. All-media masking conservatively suppresses the
viewport. Record replay screenshots, decoded artifacts and measured performance
only after observing them.
