import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:rejourney/rejourney.dart';
import 'package:rejourney/src/flutter_frame_capture.dart';
import 'package:rejourney_example/main.dart';

const _livePublicKey = String.fromEnvironment('REJOURNEY_PUBLIC_KEY');
const _liveApiUrl = String.fromEnvironment('REJOURNEY_API_URL');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('native bridge and real example flow work together', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const RejourneyExampleApp(initializeSdk: false));

    final live = _livePublicKey.isNotEmpty && _liveApiUrl.isNotEmpty;
    await Rejourney.init(
      live ? _livePublicKey : 'pk_integration_test',
      config: RejourneyConfig(
        // CI uses a refused loopback port to exercise native offline fallback.
        // Supplying both dart-defines turns this into a real upload test.
        apiUrl: live ? _liveApiUrl : 'http://127.0.0.1:9',
        debug: false,
        captureFps: 1,
      ),
    );
    final start = await Rejourney.start();
    expect(start.success, isTrue);
    expect(start.sessionId, isNotEmpty);
    await Rejourney.setUserIdentity('integration_user');
    await Rejourney.setMetadata(<String, Object?>{
      'suite': 'flutter_integration',
    });
    await Rejourney.logEvent('integration_started');
    await Rejourney.trackScreen('Integration Test');
    await Rejourney.addSessionTag('flutter_native_integration');
    await Rejourney.markVisualChange(
      'integration_started',
      importance: RejourneyVisualImportance.high,
    );
    await Rejourney.onOAuthStarted('integration_provider');
    await Rejourney.onOAuthCompleted('integration_provider', success: true);
    await Rejourney.onExternalUrlOpened('rejourney-integration');
    await Rejourney.logNetworkRequest(
      const RejourneyNetworkRequest(
        requestId: 'flutter-integration-network',
        method: 'GET',
        url: 'https://example.com/flutter-integration',
        statusCode: 204,
        duration: Duration(milliseconds: 25),
        success: true,
      ),
    );
    await Rejourney.logFeedback(5, 'Flutter native integration');
    expect(await Rejourney.getSessionId(), start.sessionId);
    expect(await Rejourney.getSdkMetrics(), isA<RejourneySdkMetrics>());

    if (defaultTargetPlatform == TargetPlatform.android) {
      final directCaptureTimer = Stopwatch()..start();
      final directCapture = await FlutterFrameCapture.capture(
        targetWidth: 320,
        targetHeight: 720,
      );
      directCaptureTimer.stop();
      expect(directCapture, isNotNull);
      // ignore: avoid_print
      print(
        'REJOURNEY_DIRECT_LAYER_CAPTURE_MS='
        '${directCaptureTimer.elapsedMicroseconds / 1000}',
      );

      await const MethodChannel(
        'co.rejourney.flutter/methods',
      ).invokeMethod<void>('debugForceFlutterLayerCapture', <String, Object?>{
        'enabled': true,
      });
    }

    await tester.tap(find.byKey(const Key('open-checkout')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.byKey(const Key('masked-payment-card')), findsOneWidget);
    if (defaultTargetPlatform == TargetPlatform.android) {
      final captureMetrics = await _waitForRetainedCapture(tester);
      // Print before asserting so a future device-specific failure includes
      // the complete native capture state in CI logs.
      _printCaptureMetrics(captureMetrics);
      expect(captureMetrics.flutterRendererCaptureCount, greaterThan(0));
      expect(captureMetrics.lastCaptureSource, 'flutter_retained_layer');
    } else {
      // Give the native 1 FPS recorder real wall-clock time to capture the
      // settled masked route; pumpAndSettle is intentionally avoided because
      // an active recorder can keep frame callbacks pending.
      await Future<void>.delayed(const Duration(seconds: 8));
      await tester.pump();
    }

    await tester.tap(find.byKey(const Key('complete-purchase')));
    await tester.pump();
    expect(find.text('Purchase event recorded'), findsOneWidget);

    await tester.pageBack();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    await Future<void>.delayed(const Duration(seconds: 3));
    await tester.pump();
    expect(find.byKey(const Key('open-checkout')), findsOneWidget);

    final stop = await Rejourney.stop();
    expect(stop.sessionId, start.sessionId);
    if (live) expect(stop.uploadSuccess, isTrue);
    // Printed in live validation logs so the backend artifact can be audited.
    // ignore: avoid_print
    print('REJOURNEY_SESSION_ID=${start.sessionId}');
  });
}

Future<RejourneySdkMetrics> _waitForRetainedCapture(WidgetTester tester) async {
  var metrics = await Rejourney.getSdkMetrics();

  // A retained capture crosses native -> Dart -> native asynchronously. Slow
  // software-rendered CI emulators can still be finishing an earlier PixelCopy
  // when the first explicit request is made, so wait on the observable outcome
  // instead of assuming a fixed wall-clock delay is sufficient.
  for (var attempt = 1; attempt <= 3; attempt += 1) {
    await Rejourney.markVisualChange(
      'forced_retained_layer_capture_$attempt',
      importance: RejourneyVisualImportance.high,
    );

    final deadline = DateTime.now().add(const Duration(seconds: 10));
    do {
      await Future<void>.delayed(const Duration(seconds: 1));
      await tester.pump();
      metrics = await Rejourney.getSdkMetrics();
      if (metrics.flutterRendererCaptureCount > 0) return metrics;
    } while (DateTime.now().isBefore(deadline));
  }

  return metrics;
}

void _printCaptureMetrics(RejourneySdkMetrics metrics) {
  // ignore: avoid_print
  print(
    'REJOURNEY_CAPTURE_METRICS='
    'attempts:${metrics.captureAttemptCount},'
    'successes:${metrics.captureSuccessCount},'
    'fallbacks:${metrics.flutterBlackFrameFallbackCount},'
    'retained:${metrics.flutterRendererCaptureCount},'
    'avgMs:${metrics.averageCaptureDurationMs},'
    'maxMs:${metrics.maxCaptureDurationMs},'
    'retainedAvgMs:${metrics.averageFlutterRendererReadbackMs},'
    'retainedMaxMs:${metrics.maxFlutterRendererReadbackMs},'
    'source:${metrics.lastCaptureSource}',
  );
}
