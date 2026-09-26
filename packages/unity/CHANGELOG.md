# Changelog

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
