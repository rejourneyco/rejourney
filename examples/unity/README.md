# Rejourney Arcade Lab

A deterministic mobile game and diagnostic lab for the Unity SDK. Use synthetic
data and a dedicated validation project created in the deployed Rejourney cloud.
The package's verification report lists which build and runtime lanes have run.

## Build

Open with Unity 6000.3.24f1 or 6000.6.2f1, with iOS and Android Build Support.
The local UPM reference points to `../../packages/unity` relative to this example
project. Run **Rejourney → Prepare Arcade Lab** once. It generates the scene,
URP assets and UI Toolkit panel, and imports TMP Essential Resources from Unity's
installed uGUI package. Those vendor assets are generated locally, not vendored
into this repository.

Set an ignored `Assets/Resources/RejourneyLocal.json`:

```json
{"publicProjectKey":"CLOUD_ISSUED_PUBLIC_KEY","apiUrl":"https://api.rejourney.co"}
```

Alternatively set `REJOURNEY_PUBLIC_KEY` while building. This is a public upload
project key, never an account credential. The app still waits for consent.

Batch entry points in `ArcadeLabBuild`:

- `Android`: development APK, IL2CPP, high stripping, arm64, GameActivity/Vulkan.
- `AndroidRelease`: release APK with the same settings and R8.
- `IOS` / `IOSRelease`: device Xcode exports.
- `IOSSimulator`: simulator Xcode export.

- `IOSBenchmark` / `IOSSimulatorBenchmark` / `AndroidBenchmark`: release players
  with the `REJOURNEY_LAB_AUTOMATION` define, which honors the operator opt-in
  files below. Ordinary release builds ignore them.

Optional build environment selectors for the compatibility matrix:
`REJOURNEY_ANDROID_ENTRY=activity`, `REJOURNEY_GRAPHICS=gles3`,
`REJOURNEY_PIPELINE=builtin`, `REJOURNEY_COLORSPACE=gamma` (Linear by default),
`REJOURNEY_INPUT=old|new|both`, `REJOURNEY_BACKEND=mono` (Android, ARMv7-only in
Unity 6), `REJOURNEY_VULKAN_PRETRANSFORM=1`, and `REJOURNEY_IL2CPP_FAST=1` (smaller,
Debug-configured C++ for quicker functional lanes; never for benchmarks).
Native build plugins require API 24+ / iOS 15.1+. Every lane sets the Development
flag explicitly: Unity 6 build profiles otherwise persist it across builds.
Keep each lane in a separate checkout/project directory if building concurrently.
The example imports Input System; a separate clean-package fixture verifies
installation with optional uGUI/Input System adapters absent.
Active Input Handling defaults to **Both**, so the Input System adapter is linked
and exercised. To exercise the legacy-only path, build with `REJOURNEY_INPUT=old`
(or select **Input Manager (Old)** in Player settings); both the SDK and game have
legacy input paths. The default color space is Linear (`REJOURNEY_COLORSPACE=gamma`
for the Gamma lane).

## Scenarios

After consent, the deterministic run visits each room, generates synthetic
network calls/errors, records a pause gap and flushes. Its `testRunId` is also
stored as session metadata. The arena is marked as gameplay (`StartGameplay`
on entry, `EndGameplay` with `quit` on leaving, `completed` when a round is
cleared), so a scripted session carries two gameplay intervals: one that ends
`quit` when the run moves to the shop, and one that ends `completed` near the end.
The privacy room includes uGUI and TMP inputs,
passwords, a moving masked label, a world-space panel and UI Toolkit fields.
Search decoded hierarchy/events for canaries and visually check decoded JPEGs;
a successful HTTP upload alone is not acceptance.

Network calls deliberately use ordinary `UnityWebRequest` and `HttpClient`.
Inspect `Library/Rejourney/NetworkReports` and actual IL2CPP output, then verify
requests in the cloud. Public httpbin scenarios depend on external availability;
a timeout must be reported as a transport outcome rather than a test success.

Fatal probes are development-only and intentionally terminate the app. Run
without an attached debugger, restart, and verify recovery belongs to the prior
session. Test airplane/offline recovery, short and >=60-second backgrounding,
remote disable, sampling, 1/3 FPS and telemetry-only via cloud project settings.

Development builds also accept `--rejourney-validation-consent` for an explicitly
authorized synthetic automated run. Optionally pass `--rejourney-project-key KEY`
and `--rejourney-telemetry-only`. This starts, runs the rooms and orientation
changes, flushes/stops, then saves `validation-<testRunId>.json` in persistent
data. These flags have no effect in release builds. They do not synthesize
touch input; test multitouch by hand.

Unity iOS may omit process arguments from managed code. For that lane, copy
`{"consent":true,"telemetryOnly":false}` into the app's persistent data directory
as `rejourney-validation.json` before launching the development build. The app
consumes and deletes this one-use opt-in before recording. It uses the configured
cloud public key; release builds ignore the file. Retrieve the resulting
`validation-*.json` from the same directory after the run.

## Benchmark suite

Copy a `rejourney-benchmark.json` into the app's persistent data directory before
launching a benchmark or development build, for example:

```json
{"cases":["disabled","telemetry","replay","replay-hires","disabled-privacy","replay-privacy","disabled-stress","replay-stress"],"seconds":60,"warmupSeconds":10,"rounds":1}
```

Each case runs the same deterministic scene. SDK cases start their own cloud
session, and every scene has an SDK-disabled baseline (`disabled-privacy`,
`disabled-stress`), so SDK cost is isolated from the scene's own work. The suite
records frame-interval and main-thread CPU histograms (FrameTimingManager),
per-frame GC allocation where the player supports it, the SDK's own main-thread
milliseconds (`Rejourney.Health.MainThreadMilliseconds`) and capture/drop counters,
then writes `benchmark-suite-<runId>.json`. The iOS simulator always uses Unity's
development engine runtime; use a device for absolute numbers.

## Performance evidence

Start matched fresh runs with SDK disabled, telemetry-only, then replay enabled.
Select **Measure matched 30-minute arena run**. It follows the same deterministic
motion, records a fixed-size frame-time histogram and bounded five-second samples,
and writes `benchmark-<testRunId>.json` under `Application.persistentDataPath`.
Do not interact, rotate or background during the matched timing comparison.
Run lifecycle/stress scenarios separately. Set the cloud session limit below
30 minutes for the rollover/memory lane and use each session link in the report.

Compare the p95 frame time with `(replay / disabled - 1) * 100`; the proposed
acceptance target is <5%. Record thermal state and uploaded artifact byte totals
from OS/cloud inspection alongside the report. Battery level is not a thermal
measurement. Measure allocations with Unity Profiler in a separate run so the
profiler does not distort the primary timing comparison. Report backpressure,
privacy drops and capture failures separately.

Before a release, run the lab against the cloud with a cloud-issued key, inspect
the processed replay, and record the application and infra release SHAs.
