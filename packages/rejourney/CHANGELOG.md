## 0.4.0

- Identical screenshots are no longer stored. On measured sessions 93-98% of
  uploaded frames were byte-identical to one already sent. The player holds the
  last frame until the next, so a duplicate rendered exactly the same as its
  absence while consuming replay quota, storage, battery and bandwidth.
- Android retained-layer capture is paced for the viewer rather than for the
  readback. The interactive minimum drops from 5s to 1.5s and the settle window
  from 2.5s to 600ms, and a deferral ceiling stops continuous interaction from
  starving capture entirely -- previously every new visual change pushed the
  settle window forward, so the most active part of a session was the least
  recorded. Measured on an emulator: median frame interval 4.3s to 1.0s, worst
  gap 38.6s to 3.0s. The idle heartbeat stays at 15s.
- Screenshot capture now throttles only on a sustained severe stall.
- View hierarchies are captured to 24 levels rather than 12, and trees cut by
  the depth limit now say so.
- A view marked for occlusion through the accessibility hint is now masked even
  if that lookup fails.
- The Android and iOS recording cores are now one shared source rather than
  per-SDK copies, so a fix lands on every platform at once. CI fails if a
  vendored copy is edited instead of the original.
- Fixed white boxes drawn over map annotations on iOS. Both view scans descended
  into map views and produced redaction rects for annotation subviews, which a
  map SDK lays out in its own coordinate space with anchors that are not the
  view's frame origin, so the rect landed beside what it meant to cover. The
  sensitive-view pass holds a reference and recomputes the rect every frame, so
  the stray box tracked the pin while panning. Neither scan descends into a map
  now; `rejourney_occlude` still hides one on request.
- Fixed a leaked heartbeat timer: starting a new session scheduled another
  5-second timer without cancelling the previous one, and the old Runnable
  stayed queued on the Handler, so every session added another uploader that
  ran for the life of the process.
- View-hierarchy scanning no longer resolves React Native resource ids by name
  on every view of every scan. The lookup is resolved once and cached,
  including when it fails, which is the normal case on a Flutter app.
- The Android plugin now ships consumer ProGuard rules. It previously shipped
  none, while the same reflection-heavy map integration code was kept by rules
  on the React Native side.
- The Android plugin classes moved from `co.rejourney.rejourney` to
  `com.rejourney`, matching the rest of the plugin. Flutter regenerates the
  plugin registrant on every build, so no app changes are needed.
- Rage-tap detection reads its threshold, window and radius from remote config
  on every platform, defaulting to a 500ms window.

- Sessions now report capture accounting in their end-of-session metrics:
  `framesCaptured`, `framesSkippedDuplicate`, `framesSkippedThrottle`,
  `framesSkippedBacklog` and `framesSkippedMapMoving`. Frame loss was previously
  invisible -- a session that dropped most of its frames looked identical in the
  data to a complete one. Note the ingest metrics schema must accept these keys
  before they are persisted; until then they are sent and discarded.

## 0.3.2

- Android: JPEG compression moves off the main thread onto the encode executor
  (it ran on main during every capture), and the same adaptive capture throttle
  now applies. The retry drain on Android was already asynchronous.
- Never block the main thread when the app backgrounds: the upload retry drain
  is now fire-and-forget instead of parking the main thread on a utility-QoS
  network queue (priority inversion that froze apps at every backgrounding).
- Screenshot capture now self-throttles: a frame whose main-thread cost exceeds
  the budget stretches the capture interval (up to 4x) and recovers when the
  screen becomes cheap to render again, eliminating visible hitches on blur-
  and glass-heavy screens.

## 0.3.1

- Make the debug-only retained-layer integration hook deterministic on headless
  Android emulators whose test activity can render without receiving window
  focus, while preserving the production foreground-capture guard.
- Add Android unit coverage for foreground, native-sheet, and debug-only
  headless capture eligibility.

## 0.3.0

- Add stable incident identifiers shared across telemetry and fault-recovery
  delivery so duplicate crash and ANR transports can be merged reliably.
- Add iOS MetricKit crash and hang diagnostics with attributed call trees and
  correlation to the session that first detected a main-thread freeze.
- Mark incomplete live iOS watchdog reports accurately instead of presenting
  the SDK watchdog thread as the blocked application thread.
- Preserve pending crash and ANR records created by earlier Flutter SDK
  versions.
- Queue every pending native incident on Android and iOS and remove only the
  successfully delivered record so diagnostics cannot overwrite one another.
- Retry persisted iOS crash reports only after the configured API endpoint and
  project key are available, including custom and local endpoints.
- Preserve an uncaught iOS exception's original call stack when the process
  later terminates through `SIGABRT`.
- Report descriptive Flutter exception categories plus handled/source context
  without relying on release-obfuscated runtime type names.
- Preserve Flutter error incident IDs, exception categories, source, and
  handled state through both native bridges.
- Make the Android debug crash hook terminate through the uncaught-exception
  path so crash persistence and next-launch delivery can be validated.
- Persist Android crash frames as a JSON array so next-launch recovery keeps
  the original Java/Kotlin stack trace.
- Add Android, iOS, Dart, and integration coverage for incident correlation and
  backward-compatible recovery.

## 0.2.1

- Fix Android replays that remained black when a small native toast or overlay
  made a failed whole-window Flutter readback look valid.
- Find Flutter's render surface by its typed view hierarchy instead of its
  release-obfuscated class name so minified Android builds use surface capture.
- Capture Flutter's retained layer tree on affected renderers so complex
  Impeller and Flame scenes are recorded without replacing the live
  `FlutterSurfaceView` or requiring a host render-mode change.
- Reduce compatibility readback resolution, space periodic fallback captures,
  and let explicit visual changes settle before capture to limit work on
  software and low-end renderers.
- Use a 15-second retained-layer heartbeat on affected Android renderers while
  capturing settled Navigator transitions on demand, avoiding a heavy fallback
  readback every five seconds during otherwise idle scenes.
- Preserve capture-only privacy masking on compatibility frames and add a
  forced retained-layer integration test that verifies real Android delivery.
- Report a `RejourneyMask` widget's measured bounds on its first painted frame
  instead of briefly masking the complete replay viewport.
- Close every Android registration, presign, upload, completion, and session-end
  HTTP response to prevent connection-pool leaks during long recordings.
- Add high-density retained-layer pixel tests, sparse-overlay black-frame tests,
  capture-source metrics, and performance diagnostics for the compatibility
  path.

## 0.2.0

- Fix black Android Flutter replay frames on renderer/device combinations where
  `PixelCopy` reports success but returns an empty `FlutterSurfaceView` bitmap.
- Detect false-success black frames and switch active recording to Flutter's
  supported image-backed render view, restoring the original surface when
  recording stops.
- Preserve renderer and activity ownership across applications that create more
  than one Flutter engine, including background engines.
- Add capture-source, fallback, and readback timing fields to
  `RejourneySdkMetrics` for integration and performance diagnostics.
- Correct the Flutter error-capture setup guidance so bindings and `runApp`
  remain in the same Dart zone.
- Add Android black-frame analyzer coverage and validate replay upload on
  Impeller-backed Android and iOS simulator builds.

## 0.1.1

- Correct the package, examples, and documentation to use the repository's
  Apache-2.0 client SDK license.
- Replace the package showcase with the Rejourney Replay Workbench view of a
  captured iOS session and synchronized diagnostic evidence.

## 0.1.0

- Initial Flutter SDK for Android and iOS.
- Session replay, remote recording configuration, lifecycle rollover, upload,
  identity, screen tracking, custom events, metadata, crash and ANR capture,
  network markers, SDK metrics, and explicit visual-change markers.
- Flutter Navigator observer, privacy-mask widget, guarded error capture, and
  an instrumented `package:http` client.
- Bounded offline stop/finalization behavior with background best-effort
  persistence and configurable `stopTimeout`.
- Example app, automated tests, integration tests, and benchmarks.
