## Flutter SDK 0.3.1

This patch makes retained-layer replay validation deterministic on headless
Android emulators while keeping the production foreground-capture privacy
guard unchanged.

### Fixed

- Allow the existing debug-only retained-layer integration hook to capture
  from a headless test activity that can render without Android window focus.
- Preserve the production rule that unfocused activities are not captured.
- Add native Android coverage for foreground, native-sheet, and debug-only
  headless capture eligibility.

### Validation

- Flutter formatting and static analysis.
- Dart and Flutter unit tests.
- Android native bridge unit tests.
- Repeated Android emulator integration tests covering the retained Flutter
  layer, masking route, session lifecycle, and native bridge.
- iOS simulator integration coverage for the package and example.
