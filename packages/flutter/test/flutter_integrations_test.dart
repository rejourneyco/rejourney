import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:rejourney/rejourney.dart';
import 'package:rejourney/rejourney_platform_interface.dart';

final class IntegrationFakePlatform extends RejourneyPlatform
    with MockPlatformInterfaceMixin {
  final List<(String, Map<String, Object?>?)> calls =
      <(String, Map<String, Object?>?)>[];

  @override
  Stream<Map<String, Object?>> get events => const Stream.empty();

  @override
  Future<T?> invoke<T>(
    String method, [
    Map<String, Object?>? arguments,
  ]) async {
    calls.add((method, arguments));
    return null;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late IntegrationFakePlatform fake;

  setUp(() {
    fake = IntegrationFakePlatform();
    RejourneyPlatform.instance = fake;
    Rejourney.resetForTesting();
  });

  testWidgets('RejourneyMask reports and removes its global region',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const Directionality(
        textDirection: TextDirection.ltr,
        child: Center(
          child: RejourneyMask(
            child: SizedBox(width: 120, height: 48),
          ),
        ),
      ),
    );
    await tester.pump();

    final update = fake.calls.where((call) => call.$1 == 'updateMaskRegion');
    expect(update, isNotEmpty);
    expect(update.first.$2!['width'], greaterThanOrEqualTo(120));

    await tester.pump(const Duration(milliseconds: 750));
    expect(update.last.$2!['width'], 120);
    expect(update.last.$2!['height'], 48);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    expect(fake.calls.any((call) => call.$1 == 'removeMaskRegion'), isFalse);

    await tester.pump(const Duration(seconds: 2));
    expect(fake.calls.any((call) => call.$1 == 'removeMaskRegion'), isTrue);
  });

  testWidgets('RejourneyMask follows retained ancestor transforms',
      (WidgetTester tester) async {
    final offset = ValueNotifier<Offset>(Offset.zero);
    addTearDown(offset.dispose);

    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: ValueListenableBuilder<Offset>(
          valueListenable: offset,
          builder: (BuildContext context, Offset value, Widget? child) {
            return Transform.translate(offset: value, child: child);
          },
          child: const RepaintBoundary(
            child: Align(
              alignment: Alignment.topLeft,
              child: RejourneyMask(
                child: SizedBox(width: 120, height: 48),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 750));

    Map<String, Object?> lastRegion() =>
        fake.calls.lastWhere((call) => call.$1 == 'updateMaskRegion').$2!;

    expect(lastRegion()['left'], 0);
    expect(lastRegion()['top'], 0);

    offset.value = const Offset(175, 90);
    await tester.pump();
    await tester.pump();

    // The capture pipeline may observe either side of an animation frame, so
    // movement conservatively masks the swept area.
    expect(lastRegion()['left'], 0);
    expect(lastRegion()['top'], 0);
    expect(lastRegion()['width'], 295);
    expect(lastRegion()['height'], 138);

    await tester.pump(const Duration(seconds: 2));
    expect(lastRegion()['left'], 175);
    expect(lastRegion()['top'], 90);
    expect(lastRegion()['width'], 120);
    expect(lastRegion()['height'], 48);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 2));
  });

  testWidgets('navigator observer records named route transitions',
      (WidgetTester tester) async {
    final observer = RejourneyNavigatorObserver();
    await tester.pumpWidget(
      MaterialApp(
        navigatorObservers: <NavigatorObserver>[observer],
        initialRoute: '/home',
        routes: <String, WidgetBuilder>{
          '/home': (_) => const SizedBox(),
        },
      ),
    );
    await tester.pump();

    final tracks = fake.calls.where((call) => call.$1 == 'trackScreen');
    expect(tracks, isNotEmpty);
    expect(tracks.last.$2!['screenName'], '/home');
  });
}
