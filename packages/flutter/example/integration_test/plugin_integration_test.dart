import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:rejourney/rejourney.dart';
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
        debug: true,
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

    await tester.tap(find.byKey(const Key('open-checkout')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.byKey(const Key('masked-payment-card')), findsOneWidget);
    // Give the native 1 FPS recorder real wall-clock time to capture the
    // settled masked route; pumpAndSettle is intentionally avoided because
    // an active recorder can keep frame callbacks pending.
    await Future<void>.delayed(const Duration(seconds: 3));
    await tester.pump();

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
