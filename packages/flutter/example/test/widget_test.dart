import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rejourney_example/main.dart';

void main() {
  testWidgets('example exposes recording and checkout flows', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const RejourneyExampleApp(initializeSdk: false));

    expect(find.text('Rejourney Flutter'), findsOneWidget);
    expect(find.byKey(const Key('start-recording')), findsOneWidget);
    expect(find.byKey(const Key('track-event')), findsOneWidget);

    await tester.tap(find.byKey(const Key('open-checkout')));
    await tester.pumpAndSettle();
    expect(find.text('Payment details'), findsOneWidget);
    expect(find.byKey(const Key('masked-payment-card')), findsOneWidget);
    expect(find.byKey(const Key('complete-purchase')), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 2));
  });
}
