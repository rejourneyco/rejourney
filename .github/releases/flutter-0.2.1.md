# Rejourney Flutter SDK 0.2.1

Rejourney `0.2.1` fixes Android Flutter replays that could still show a black
application surface with only native toast or overlay content visible.

## Highlights

- Detects sparse native overlays without accepting the black Flutter layer
  underneath them
- Captures complete retained Flutter scenes—including complex Impeller and
  Flame content—without replacing the application's live `FlutterSurfaceView`
- Uses reduced replay dimensions, paced periodic capture, and a short
  visual-settle delay to contain fallback work on slower renderers
- Works across Android Impeller renderer backends without requiring host-app
  texture-mode changes
- Keeps explicit widget masking and project privacy redaction in the final
  replay frame
- Redacts only a widget's measured bounds on its first frame instead of briefly
  replacing the complete replay viewport with a mask
- Closes Android SDK HTTP responses after registration, presign, upload,
  completion, and session finalization to prevent connection-pool leaks
- Adds forced-fallback Android integration coverage, high-density pixel
  validation, black-frame regression tests, and capture timing diagnostics

## Compatibility

- No public Dart API changes
- The fast `FlutterSurfaceView` PixelCopy path remains the default
- Renderer capture metrics report retained-layer compatibility captures
- iOS capture behavior is unchanged

Install or upgrade with:

```bash
flutter pub add rejourney
```

See the [Flutter SDK guide](https://rejourney.co/docs/flutter/overview) for
integration and verification details.
