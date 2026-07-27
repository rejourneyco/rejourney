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
