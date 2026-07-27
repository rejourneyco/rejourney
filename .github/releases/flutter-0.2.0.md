# Rejourney Flutter SDK 0.2.0

Rejourney `0.2.0` makes Android Flutter replay capture reliable across
GPU renderer and device combinations that can return false-success black
`PixelCopy` frames.

## Highlights

- Detects effectively black `FlutterSurfaceView` frames after a successful
  Android `PixelCopy`
- Automatically switches affected recordings to Flutter's supported
  image-backed render path
- Restores the application's normal render surface when recording stops
- Preserves the correct UI renderer when applications use background Flutter
  engines
- Adds capture-source, fallback-count, and readback-timing diagnostics to
  `RejourneySdkMetrics`
- Keeps Flutter binding initialization and `runApp` in the same Dart zone in
  the recommended error-capture setup
- Keeps the existing iOS capture path and validates it with an Impeller-backed
  simulator application

Install or upgrade with:

```bash
flutter pub add rejourney
```

See the [Flutter SDK guide](https://rejourney.co/docs/flutter/overview) for
integration and verification details.
