# Verification

What was tested for 0.1.0, and what each run showed.

## Cloud sessions (production, dedicated Unity validation project)

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

## Compatibility matrix (observed)

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

## Package tests

| Gate | Observed result |
|---|---|
| Release tarball, fresh projects without optional adapters | 63/63 passed on Unity 6000.3.24f1 LTS and 6000.6.2f1 (`scripts/test-unity-package.mjs`), including the gameplay, rollover and capture tests |
| Unity 6000.3.24f1 (LTS) EditMode, uGUI + Input System installed | 63/63 passed, including linker hand-off, uGUI fail-closed, weaver assembly filter, byte-exact direct-event JSON parity, isolation from global Newtonsoft settings, errors reported with console capture off, the in-flight drain regression, and the gameplay marker contract (start/end pairing, pre-recording start marked continued, rollover restart, stop writes `session_end` without ending the segment, supersede and scope, tagged non-rage-eligible touches during play, oversized properties dropped), markers written from pause handlers and during an explicit pause, the native rollover gap (no `Error` inside the grace period, one set of session markers after a restart), and the capture contract (wall-clock times after a simulated device sleep, exception type and handled flag for Unity log exceptions, log errors and assertions, `CaptureException` with the caller's stack, unobserved task exceptions) |

## Micro-benchmarks (Unity 6000.3 Editor, Mono JIT; lower is better)

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

## Benchmark suite (iOS 26.3 simulator, Unity 6000.6.2f1, release-compiled SDK)

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

## Build and native gates

| Gate | Observed result |
|---|---|
| iOS XCFramework (device + simulator) | Built; all six public C exports present; provenance manifest updated |
| Android AAR | Built; 16 KB ELF alignment passed; provenance manifest updated |
| Core/controller synchronization | Passed |

Coverage limits include opaque DLLs, native/custom transports, system keyboards,
external overlays and XR. All-media masking conservatively suppresses the
viewport. Record replay screenshots, decoded artifacts and measured performance
only after observing them.
