# Rejourney for Flutter

[![pub package](https://img.shields.io/pub/v/rejourney.svg)](https://pub.dev/packages/rejourney)
[![Flutter platforms](https://img.shields.io/badge/Flutter-iOS%20%7C%20Android-02569B?logo=flutter)](https://rejourney.co/docs/flutter/overview)
[![license: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)

Privacy-first session replay, mobile observability, crash reporting, and product analytics for Flutter applications on iOS and Android.

## Requirements

- Flutter 3.22 or newer
- Dart 3.3 or newer
- iOS 15.1 or newer
- Android API 24 or newer

## Installation

```yaml
dependencies:
  rejourney: ^0.1.1
```

Then install packages:

```bash
flutter pub get
```

## Quick start

Initialize the SDK once and start recording only after any consent your product requires:

```dart
import 'package:flutter/widgets.dart';
import 'package:rejourney/rejourney.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Rejourney.init('pk_live_your_public_key');
  await Rejourney.start();
  runApp(const App());
}
```

`init` configures the SDK but does not record. `start` begins a native session, fetches project recording settings, and respects sampling and the remote kill switch. Call `stop` when the user revokes consent or explicitly signs out of an instrumented experience.

## Route tracking

Use `RejourneyNavigatorObserver` with `MaterialApp`, `CupertinoApp`, or a root `Navigator`:

```dart
final rejourneyObserver = RejourneyNavigatorObserver();

MaterialApp(
  navigatorObservers: <NavigatorObserver>[rejourneyObserver],
  routes: <String, WidgetBuilder>{
    '/': (_) => const HomeScreen(),
    '/checkout': (_) => const CheckoutScreen(),
  },
);
```

For Router-based packages, call `Rejourney.trackScreen('checkout')` from the router's navigation callback or provide your own `NavigatorObserver` integration.

## Privacy masking

Wrap sensitive Flutter content with `RejourneyMask`. The widget remains unchanged for the user; only its captured region is covered in replay frames.

```dart
RejourneyMask(
  child: TextField(
    obscureText: true,
    decoration: const InputDecoration(labelText: 'Card number'),
  ),
)
```

Native secure text fields are masked by default. Project-level text and media privacy settings are also applied by the native capture pipeline.

## Identity, events, and metadata

```dart
await Rejourney.setUserIdentity('user_abc123');
await Rejourney.logEvent('purchase_completed', <String, Object?>{
  'transactionId': 'order_123',
  'amount': 29.99,
  'currency': 'USD',
});
await Rejourney.setMetadata(<String, Object?>{
  'plan': 'pro',
  'checkoutVariant': 'v2',
});

// On logout:
await Rejourney.clearUserIdentity();
```

Use stable `snake_case` event names and internal user IDs rather than raw personal information.

## Flutter and Dart errors

Install framework and platform-dispatcher handlers before `runApp`:

```dart
final errorCapture = RejourneyErrorCapture.install();

RejourneyErrorCapture.runGuarded(() {
  runApp(const App());
});

// Restore prior handlers if your application owns a shorter lifecycle.
errorCapture?.dispose();
```

The native SDK also captures supported iOS crashes and Android crashes/ANRs when enabled.

## HTTP instrumentation

`RejourneyHttpClient` is a drop-in `package:http` client that records method, sanitized URL, status, timing, content type, and payload sizes. It never records request or response bodies.

```dart
final client = RejourneyHttpClient();
final response = await client.get(Uri.parse('https://api.example.com/items'));
client.close();
```

SDK ingestion endpoints are ignored automatically. Add product-specific patterns through `networkIgnoreUrls` or disable this integration with `autoTrackNetwork: false`.

## Configuration

```dart
await Rejourney.init(
  'pk_live_your_public_key',
  config: const RejourneyConfig(
    captureQuality: RejourneyCaptureQuality.medium,
    detectRageTaps: true,
    captureCrashes: true,
    captureAnrs: true,
    networkIgnoreUrls: <String>['/health', 'analytics.example.com'],
    disableInDevelopment: true,
  ),
);
```

Important options include `enabled`, `observeOnly`, `captureFps`, `maxSessionDuration`, `stopTimeout`, `captureScreen`, `captureAnalytics`, `captureCrashes`, `captureAnrs`, `wifiOnly`, `captureQuality`, `trackConsoleLogs`, `autoTrackNetwork`, and the privacy/device collection controls. `stopTimeout` defaults to 10 seconds; native teardown and best-effort persistence continue if an offline flush exceeds that deadline. Dashboard recording settings may further restrict local capture settings.

## Additional API

- `Rejourney.getSessionId()` returns the active session identifier.
- `Rejourney.trackScreen()` records a screen manually.
- `Rejourney.markVisualChange()` requests an immediate capture when allowed.
- `Rejourney.onScroll()` supplies scroll activity to adaptive capture.
- `Rejourney.onOAuthStarted()`, `onOAuthCompleted()`, and `onExternalUrlOpened()` preserve capture boundaries around external experiences.
- `Rejourney.logFeedback()` adds user feedback to the session timeline.
- `Rejourney.getSdkMetrics()` returns upload, retry, queue, memory, and session health counters.
- `Rejourney.nativeEvents` reports native lifecycle events such as session rollover where supported.
- `Rejourney.debugCrash()` and `debugTriggerAnr()` are debug-only validation helpers and intentionally terminate or block the app.

## Example and documentation

The package includes a runnable application in [`example/`](example/). The complete integration guide is available at [rejourney.co/docs/flutter/overview](https://rejourney.co/docs/flutter/overview).

## License

The Flutter API, platform bridges, native core, examples, and documentation are licensed under the Apache License 2.0. See `LICENSE`, `LICENSE-APACHE`, and `THIRD_PARTY_NOTICES.md`.
