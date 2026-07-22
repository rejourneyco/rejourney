import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:rejourney/rejourney.dart';
import 'package:rejourney/rejourney_method_channel.dart';
import 'package:rejourney/rejourney_platform_interface.dart';

final class FakeRejourneyPlatform extends RejourneyPlatform
    with MockPlatformInterfaceMixin {
  final List<(String, Map<String, Object?>?)> calls =
      <(String, Map<String, Object?>?)>[];
  final Map<String, Object?> responses = <String, Object?>{};
  final Map<String, Duration> delays = <String, Duration>{};
  final StreamController<Map<String, Object?>> eventController =
      StreamController<Map<String, Object?>>.broadcast();

  @override
  Stream<Map<String, Object?>> get events => eventController.stream;

  @override
  Future<T?> invoke<T>(
    String method, [
    Map<String, Object?>? arguments,
  ]) async {
    calls.add((method, arguments));
    final delay = delays[method];
    if (delay != null) await Future<void>.delayed(delay);
    return responses[method] as T?;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late FakeRejourneyPlatform fake;

  setUp(() {
    fake = FakeRejourneyPlatform();
    RejourneyPlatform.instance = fake;
    Rejourney.resetForTesting();
  });

  tearDown(() async {
    await fake.eventController.close();
  });

  test('method channel is the production default implementation type', () {
    expect(MethodChannelRejourney(), isA<RejourneyPlatform>());
  });

  test('init validates and sends the complete native configuration', () async {
    await Rejourney.init(
      'pk_live_test',
      config: const RejourneyConfig(
        userId: 'user_42',
        observeOnly: true,
        captureFps: 2,
        collectGeoLocation: false,
      ),
    );

    expect(Rejourney.isInitialized, isTrue);
    expect(fake.calls.single.$1, 'configure');
    expect(fake.calls.single.$2, containsPair('publicKey', 'pk_live_test'));
    expect(fake.calls.single.$2, containsPair('userId', 'user_42'));
    expect(fake.calls.single.$2, containsPair('observeOnly', true));
    expect(fake.calls.single.$2, containsPair('collectGeoLocation', false));
  });

  test('start requires init', () {
    expect(Rejourney.start, throwsStateError);
  });

  test('start and stop preserve native result data and recording state',
      () async {
    fake.responses['start'] = <Object?, Object?>{
      'success': true,
      'sessionId': 'session_1',
      'telemetryOnly': false,
    };
    fake.responses['stop'] = <Object?, Object?>{
      'success': true,
      'sessionId': 'session_1',
      'uploadSuccess': true,
    };

    await Rejourney.init('pk_live_test');
    final start = await Rejourney.start();
    expect(start.sessionId, 'session_1');
    expect(Rejourney.isRecording, isTrue);

    final stop = await Rejourney.stop();
    expect(stop.uploadSuccess, isTrue);
    expect(Rejourney.isRecording, isFalse);
  });

  test('stop is bounded while native finalization continues', () async {
    fake.responses['start'] = <Object?, Object?>{
      'success': true,
      'sessionId': 'session_slow_flush',
    };
    fake.responses['getSessionId'] = 'session_slow_flush';
    fake.delays['stop'] = const Duration(milliseconds: 50);

    await Rejourney.init(
      'pk_live_test',
      config: const RejourneyConfig(
        stopTimeout: Duration(milliseconds: 2),
      ),
    );
    await Rejourney.start();

    final stop = await Rejourney.stop();
    expect(stop.success, isTrue);
    expect(stop.sessionId, 'session_slow_flush');
    expect(stop.uploadSuccess, isFalse);
    expect(stop.warning, 'native_flush_timeout');
    expect(Rejourney.isRecording, isFalse);
  });

  test('metadata and events serialize supported channel values', () async {
    await Rejourney.init('pk_live_test');
    await Rejourney.setMetadata(<String, Object?>{
      'plan': 'pro',
      'renewal': true,
    });
    await Rejourney.logEvent('purchase_completed', <String, Object?>{
      'at': DateTime.utc(2026, 7, 21),
      'amount': 29.99,
      'items': <Object?>['pro', 1],
    });

    expect(fake.calls[1].$1, 'setMetadata');
    expect(
      (fake.calls[1].$2!['metadata'] as Map<Object?, Object?>)['plan'],
      'pro',
    );
    expect(fake.calls[2].$1, 'logEvent');
    final properties = fake.calls[2].$2!['properties'] as Map<Object?, Object?>;
    expect(properties['at'], '2026-07-21T00:00:00.000Z');
  });

  test('native events are exposed as a broadcast stream', () async {
    final eventFuture = Rejourney.nativeEvents.first;
    fake.eventController.add(<String, Object?>{
      'type': 'sessionRolledOver',
      'sessionId': 'session_2',
    });
    expect(await eventFuture, containsPair('sessionId', 'session_2'));
  });

  test('network byte sizes respect the capture-size privacy option', () async {
    await Rejourney.init(
      'pk_live_test',
      config: const RejourneyConfig(networkCaptureSizes: false),
    );
    await Rejourney.logNetworkRequest(
      const RejourneyNetworkRequest(
        method: 'POST',
        url: 'https://example.com/orders',
        statusCode: 201,
        duration: Duration(milliseconds: 5),
        requestBodySize: 100,
        responseBodySize: 50,
      ),
    );

    final properties =
        fake.calls.last.$2!['properties'] as Map<Object?, Object?>;
    expect(properties, isNot(contains('requestBodySize')));
    expect(properties, isNot(contains('responseBodySize')));
  });
}
