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
