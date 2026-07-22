# Rejourney Flutter consumer example

This standalone Flutter application consumes `packages/rejourney` through a relative path, the same way a separate application consumes a published plugin. It covers native registration, SDK configuration, health metrics, route observation, custom/revenue events, Flutter error hooks, and replay-only privacy masking.

The app defaults to the Rejourney Flutter example project's public key, so a normal run exercises capture and upload:

```bash
cd examples/flutter
flutter run
```

Override the project public key when validating another project:

```bash
flutter run --dart-define=REJOURNEY_PUBLIC_KEY=rj_your_public_key
```

For a local or self-hosted backend, override the API base URL as well:

```bash
flutter run --dart-define=REJOURNEY_API_URL=http://127.0.0.1:3000
```

Tests and builds:

```bash
flutter analyze
flutter test
flutter build apk --debug
flutter build ios --simulator --no-codesign
```

The example application and local Rejourney package are licensed under the Apache License 2.0. The package contains its own license and third-party notices.
