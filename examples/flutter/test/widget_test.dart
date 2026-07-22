import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rejourney_flutter_example/main.dart';

void main() {
  testWidgets('consumer example navigates to its masked checkout', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const ConsumerExampleApp(connectNativeSdk: false));

    expect(find.text('Standalone example'), findsOneWidget);
    await tester.tap(find.byKey(const Key('open-checkout')));
    await tester.pumpAndSettle();

    expect(find.text('Sensitive payment region'), findsOneWidget);
    expect(find.byKey(const Key('payment-mask')), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 2));
  });
}
