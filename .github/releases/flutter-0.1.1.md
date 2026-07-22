# Rejourney Flutter SDK is now available

Rejourney `0.1.1` brings privacy-first session replay and mobile observability
to Flutter applications on iOS and Android.

## Highlights

- Native iOS and Android replay capture from one Flutter package
- `RejourneyMask` for capture-only masking of sensitive widget regions
- Navigator-based screen tracking, identity, metadata, and custom events
- Flutter, crash, ANR, and sanitized network timing context
- Lifecycle-aware session rollover and bounded offline finalization
- Runnable package and standalone consumer examples
- Automated tests, native integration gates, and Dart API benchmarks

## 0.1.1 corrections

- Declare the Flutter SDK, examples, and documentation under the repository's
  Apache-2.0 client SDK license
- Use the Replay Workbench screenshot as the package and documentation showcase
- Keep the Flutter, Android, iOS, and native bridge version metadata synchronized
  at `0.1.1`

Install it with:

```bash
flutter pub add rejourney
```

Then follow the [Flutter SDK guide](https://rejourney.co/docs/flutter/overview).
