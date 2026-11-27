# Changelog

## 0.1.3

Fixes found by reading production sessions and by running a capture matrix (render
settings × capture path × device orientation) on macOS, the iOS simulator and the
Android emulator. Documentation~/verification.md has the runs.

Capture

- Upside-down replays, with masks on the wrong rows, on iOS builds that use "Metal
  Write-Only Backbuffer" with URP. The in-pipeline capture drew the overlay UI inside a
  raster pass, where the engine picked the UI's orientation from whichever render target
  an earlier pass had left bound. That changed with MSAA, HDR, post-processing and camera
  stacking, so a game that switched MSAA on at runtime got flipped sessions. The pass now
  binds the capture texture itself and copies the camera color through the render graph's
  UV-origin bookkeeping, so the capture is upright in every configuration.
- Tile-Only URP renderers: the capture pass asked for the intermediate texture, URP
  rejected the frame's render graph, and the game lost that frame and logged an exception
  at every capture. Such renderers are now left alone; with a write-only back buffer their
  frames are skipped and `SdkHealth.CaptureUnavailableReason` says why. If any other URP
  setup rejects the pass, it turns itself off after the first such frame.
- `Graphics.Blit` left the SDK's texture as the active render target at the end of a
  capture frame, so a game's own end-of-frame screenshot (`ReadPixels`) read the SDK's
  texture instead of the screen. The previous target is restored.
- On-demand rendering (`OnDemandRendering.renderFrameInterval` above 1): captures ran on
  loop iterations that drew nothing, and the in-pipeline capture gave up before the next
  rendered frame. Capture now waits for a frame that renders.
- With domain reload off, each play-mode entry left another frame source subscribed to
  the render pipeline. The previous one is released.
- No capture is taken until the screen size, orientation and display size have held still
  for a few frames after a rotation or resolution change.

Sessions, errors, hangs and crashes

- Nothing was reported after the project's recording-time limit (10 minutes by default).
  Native ended the session at the limit while the SDK still reported `Recording`: errors,
  hangs, frames and crashes for the rest of the run were dropped without a sign. The
  native bridge now reports whether its session is live, and the SDK starts a new session
  at once (`RejourneyOptions.ContinueAfterSessionLimit`, on by default;
  `SdkHealth.SessionsContinued` counts them). An explicit pause carries over. With the
  option off, the state becomes `Error` as the documentation says.
- iOS: the fatal-signal handler passed the signal on by sending it again, which reaches an
  arbitrary thread without the fault address. A crash reporter installed before Rejourney
  (Crashlytics, for example) then recorded the wrong crash. The handler now calls the
  earlier handler directly, on the crashing thread, with the original signal information.
- Game-loop hangs counted time during which the whole process was suspended or frozen, so
  some reports ran to minutes. A stall is now measured in time the watchdog itself saw
  pass.

Performance and memory

- Android: every frame handed to Java went through `AndroidJavaClass.CallStatic`, which
  looks the method up by reflection on each call and makes Unity log two warnings for
  each `byte[]` argument. The three bridge methods are now resolved once and called
  through JNI directly.
- Routine events (logs, touches, custom events, samples) are handed to native about five
  times a second instead of on every frame that has one, with one reused buffer. Errors
  and hangs still go at once. Under 60 logs and 10 events a second the SDK's managed
  allocations fell from about 700 KB/s to about 165 KB/s and its main-thread time from
  7.5 to 3.8 ms per second (macOS player).
- The capture textures and the readback buffer (about 18 MB on a 2796 x 1290 phone) are
  released after five seconds without capture, for example during a long `PauseAsync`,
  in telemetry-only sessions and after `StopAsync`.
- The once-a-second status poll no longer runs a serializer for its request or formats
  `SdkHealth.NativeStatus` (now formatted when read), and the frame-time sample reuses
  its sort buffer.

## 0.1.2

- Bug fixes and performance improvements.

## 0.1.1

- Replays are no longer black on iOS devices when Player Settings > iOS > "Metal
  Write-Only Backbuffer" is on. That setting makes the back buffer unreadable on
  device (the simulator ignores it), so `ScreenCapture` returned black frames. The
  iOS build now records the setting in the app's StreamingAssets, and only those
  builds change capture path: URP projects capture inside the render pipeline (a pass
  enqueued on capture frames copies the post-processed camera color and redraws the
  Screen Space - Overlay UI, uGUI and UI Toolkit, into the capture texture), and
  built-in pipeline projects skip frames instead of uploading black ones, with a build
  warning. Every other build keeps `ScreenCapture` unchanged. `SdkHealth.CaptureSource`
  (`screen`, `urp`, `unreadable`) and `FramesSkippedUnreadable` report the path.

## 0.1.0

Initial Unity mobile integration. Documentation~/verification.md records what was
tested and what each run showed.

Hardening and performance work before release:

- IL2CPP stripping: Unity ignores `link.xml` inside packages, so the package's
  preservation rules never reached UnityLinker and high stripping removed the uGUI
  privacy adapter from player builds. `RejourneyLinkerProcessor` now hands the file
  to the linker, the optional adapters carry `AlwaysLinkAssembly`, and frames with
  active uGUI/TMP inputs are dropped if the uGUI adapter is still missing.
- Frame uploads are bundled (three per bundle, matching the other SDKs), consecutive
  identical frames are skipped, and each frame stays on disk until its bundle is
  delivered or durably queued, so crash recovery keeps the final seconds.
- Hierarchy snapshots are sent when their content changes: at once for a new session
  or viewport, otherwise at most every two seconds.
- Hot paths allocate less: readback reuses one pixel buffer instead of allocating a
  full frame per capture, mask bounds no longer allocate per mask (per-capture object
  scans still allocate small arrays), logs, touches and custom events serialize
  without reflection, and event batches are serialized once.
- The wire format no longer follows a game's global `JsonConvert.DefaultSettings`;
  a custom naming strategy or null handling could previously rename bridge keys.
- A hierarchy snapshot that arrives while another is uploading is kept and sent next
  rather than dropped, so a viewport change is never lost.
- `WaitForEndOfFrame` is used only on frames that capture.
- Android: the pre-API-30 signal marker chains to earlier handlers with the original
  fault context. It clears itself only when a hardware fault was repaired in place
  (our handler still installed, nothing re-queued, program counter moved), so a Mono
  managed null reference is neither a crash nor a false fatal report, while debuggerd
  and abort() paths keep the marker. Frame bytes are no longer copied twice.
- IL weaving no longer skips game assemblies whose names merely start with
  `System`, `UnityEngine` or `UnityEditor` (for example `Systems.Gameplay`).
- `CollectGeoLocation` option (default on, like the other SDKs); iOS previously
  always disabled server-side geolocation.
- Unity errors and unhandled exceptions are reported even when `CaptureLogs` is off;
  like the other SDKs, that option governs console lines only.
- `DiagnosticFaults` is available in every build and acts only in development
  players (`Debug.isDebugBuild`), replacing `DEVELOPMENT_BUILD`, which Unity 6.6
  deprecates.
- API parity: `LogFeedback(rating, message)`, `SetMetadata(IDictionary)`,
  `OnExternalUrlOpened`, `OnOAuthStarted`, `OnOAuthCompleted`, and a cumulative
  `SdkHealth.MainThreadMilliseconds` cost counter.
- Gameplay markers: `StartGameplay`, `EndGameplay`, the `Gameplay` scope,
  `IsGameplayActive`, `ActiveGameplayId` and `GameplayOutcome`. Each recording
  session gets its own start marker for an active segment, stopping a session
  writes `session_end` without ending the segment, and touches during play carry
  the segment id and are never rage-eligible. The cloud leaves play out of
  rage/dead-tap counts, heatmaps and research exports, and the replay shows it as
  a timeline lane.
- Gameplay markers that could not be written while collection was suspended (in the
  background, while paused, or during a session rollover) are written as soon as it
  resumes, with their original times. Ending play from a game's own pause handler no
  longer loses the end marker when Unity calls the SDK's handler first.
- Background rollover: while native replaces the session after a background of 60
  seconds or more, the SDK keeps its state instead of reporting `Error` for a moment,
  and picks up the new session within 250 ms. Only a gap longer than 10 seconds is
  reported as an error. A restart after an error no longer writes the session's
  screen view and gameplay start twice.
- Event, touch and frame times come from the wall clock. They were a start time plus
  a monotonic stopwatch, which stops while the device sleeps: after the phone slept
  with the game in the background, everything was stamped in the past (47 minutes
  in one run), and native rejected every frame of the session that followed as
  older than its start.
- Error events match the other SDKs, so the issue feed titles and groups them by
  exception type rather than one "managed" bucket. They carry the exception type as
  `exceptionCategory`, `handled` (false for exceptions from Unity's log, true for
  `CaptureException`), a `source` (`unity_log`, `unity_capture` or
  `unity_unobserved_task`), the current screen, and an `incidentId` so a retried
  upload is not counted twice. ANR events also carry the screen.
- Unobserved task exceptions (a faulted `Task` that nothing awaited) are reported as
  unhandled errors when .NET collects the task. The game's own policy is unchanged.
- `CaptureException` with an exception that was never thrown records the caller's
  stack instead of an empty one.
- Game-loop hangs are reported when the loop resumes, with the full stall duration
  (a 7-second stall was previously reported as 5.2–5.9 seconds, the time at
  detection). The report cannot reach native earlier, since events are forwarded
  from the main thread.
