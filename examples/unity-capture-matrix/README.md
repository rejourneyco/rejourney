# Rejourney capture matrix

A small Unity player that checks what the SDK captures, instead of assuming it.
It draws fixed colour markers, walks through render settings, and inspects every
frame the SDK hands to its native bridge:

- camera-rendered quads fill the left half of the screen, red above blue;
- Screen Space - Overlay UI fills the right half, green above yellow, with a
  masked white box in the top-right corner;
- an overlay camera, when stacked, draws a magenta box in the top-left corner.

A frame passes when both layers are upright, the masked box arrives as the mask's
grey and nowhere as white, and the stacked camera's box is present. While a
capture runs the lab also reads the real back buffer at the end of every frame,
the way a game's own screenshot would, and requires the same picture there.

## What it covers

| Axis | Values |
|---|---|
| Capture path | `ScreenCapture`; inside URP (as with a write-only Metal back buffer) |
| Renderer | Universal (default, intermediate texture always, Tile-Only), 2D, built-in pipeline |
| Settings | MSAA 1/2/4, HDR, render scale 1 and 0.8, post-processing with and without FXAA, camera stacking, depth and opaque textures, dynamic resolution, on-demand rendering |
| Device | all four orientations on mobile players |

`REJOURNEY_COLORSPACE=gamma`, `REJOURNEY_GRAPHICS=gles3`,
`REJOURNEY_VULKAN_PRETRANSFORM=1`, `REJOURNEY_ANDROID_BLIT=always|auto|never` and
`REJOURNEY_METAL_WRITE_ONLY=1` select build lanes.

The same app runs fatal-fault probes against the real native bridge
(`--crash-probe abort|segv|thread|java[:paused|:rolled|:late|:late-paused|:reporter-first|:reporter-last]`,
then `--crash-recover` on the next launch). `late` waits past the project's
recording-time limit first. `reporter-first` and `reporter-last` install a stand-in
for another crash reporter before or after Rejourney and record the signal it
receives.

`--matrix-pause-rotation` is a control: the SDK is paused across each rotation, and
errors logged meanwhile are reported as `errorsWhileSdkPaused`, which shows whether a
rotation error is the engine's own. (GLES3 logs two render-pass errors on a rotation
that changes the screen's dimensions, with or without the SDK.)

`--perf` runs the performance lab instead: the same scene with the SDK off, telemetry
only, replay at 1 and 3 FPS on both capture paths, and replay under 60 logs and 10
events a second, each for 15 seconds. It reports frame times, main-thread time, managed
allocations per frame (development players), memory and the SDK's own main-thread
counter. `--perf-native` uses the real bridge on mobile. Simulators and emulators give
relative numbers only; an emulated GPU can stall on readback in a way phones do not.

## Running

Scripts are in `scripts/test-matrix/unity-capture`:

```sh
./build.sh mac && ./run.sh mac local            # loopback bridge, no network
./build.sh ios-sim && ./run.sh ios-sim cloud    # real bridge, real cloud session
./build.sh android && ./run.sh android loop --matrix-loopback
./crash.sh ios-sim segv:reporter-first
./report.py <report.json> fails
REJOURNEY_DEVELOPMENT=1 ./build.sh mac && ./run.sh mac perf --perf && ./perf.py <perf.json>
```

After a cloud run, `./dump-production-session.sh <session-id> frames.jsonl` downloads
the session's stored frames read-only and `./check-cloud-frames.py frames.jsonl` checks
them against the same markers.

Mobile lanes read the project key from
`scripts/test-matrix/environments/unity.production.env`. Reports and logs go to
`test-results/sdk-matrix/unity-capture`. On mobile, `--matrix-loopback` keeps the run off the
network; without it the run is also a cloud session, and its stored frames can be
checked the same way after download.

The lab reaches SDK internals through `InternalsVisibleTo("Rejourney.Lab")`.
