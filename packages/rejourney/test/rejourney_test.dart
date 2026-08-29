import 'dart:async';

import 'package:flutter/foundation.dart';
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
  final Map<String, List<Object?>> responseQueues = <String, List<Object?>>{};
  final Map<String, Duration> delays = <String, Duration>{};
  final Map<String, List<Duration>> delayQueues = <String, List<Duration>>{};
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
    final queuedResponses = responseQueues[method];
    final response = queuedResponses != null && queuedResponses.isNotEmpty
        ? queuedResponses.removeAt(0)
        : responses[method];
    final queuedDelays = delayQueues[method];
    final delay = queuedDelays != null && queuedDelays.isNotEmpty
        ? queuedDelays.removeAt(0)
        : delays[method];
    if (delay != null) await Future<void>.delayed(delay);
    return response as T?;
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

  test('Beta pause and resume are idempotent and suppress ordinary events',
      () async {
    fake.responses['start'] = <Object?, Object?>{
      'success': true,
      'sessionId': 'session_pause',
    };
    fake.responses['pause'] = true;
    fake.responses['resume'] = true;

    await Rejourney.init('pk_live_test');
    await Rejourney.start();

    expect(await Rejourney.pause(), isTrue);
    expect(await Rejourney.pause(), isTrue);
    expect(Rejourney.isPaused, isTrue);
    await Rejourney.logEvent('must_not_cross_pause');

    expect(await Rejourney.resume(), isTrue);
    expect(await Rejourney.resume(), isTrue);
    expect(Rejourney.isPaused, isFalse);

    expect(fake.calls.where((call) => call.$1 == 'pause'), hasLength(1));
    expect(fake.calls.where((call) => call.$1 == 'resume'), hasLength(1));
    expect(
      fake.calls.where(
        (call) =>
            call.$1 == 'logEvent' && call.$2?['name'] == 'must_not_cross_pause',
      ),
      isEmpty,
    );
  });

  test(
      'paused Flutter error hooks stay chained without formatting or forwarding',
      () async {
    fake.responses['start'] = <Object?, Object?>{
      'success': true,
      'sessionId': 'session_paused_error_hook',
    };
    fake.responses['pause'] = true;

    await Rejourney.init('pk_live_test');
    await Rejourney.start();
    await Rejourney.pause();

    final previous = FlutterError.onError;
    var chainedCalls = 0;
    FlutterError.onError = (_) => chainedCalls++;
    final capture = RejourneyErrorCapture.install();
    final before = fake.calls.length;
    try {
      FlutterError.onError!(
        FlutterErrorDetails(exception: StateError('paused failure')),
      );
      await Future<void>.delayed(Duration.zero);

      expect(chainedCalls, 1);
      expect(fake.calls.length, before);
    } finally {
      capture.dispose();
      FlutterError.onError = previous;
    }
  });

  test('opposing pause transitions preserve API call order', () async {
    fake.responses['start'] = <Object?, Object?>{
      'success': true,
      'sessionId': 'session_serial_pause',
    };
    fake.responses['pause'] = true;
    fake.responses['resume'] = true;
    fake.delays['pause'] = const Duration(milliseconds: 20);

    await Rejourney.init('pk_live_test');
    await Rejourney.start();

    final pause = Rejourney.pause();
    final resume = Rejourney.resume();

    expect(await pause, isTrue);
    expect(await resume, isTrue);
    expect(Rejourney.isPaused, isFalse);
    expect(
      fake.calls
          .where((call) => call.$1 == 'pause' || call.$1 == 'resume')
          .map((call) => call.$1),
      <String>['pause', 'resume'],
    );
  });

  test('a rejected native pause does not mutate Dart state', () async {
    fake.responses['start'] = <Object?, Object?>{
      'success': true,
      'sessionId': 'session_rejected_pause',
    };
    fake.responses['pause'] = false;

    await Rejourney.init('pk_live_test');
    await Rejourney.start();

    expect(await Rejourney.pause(), isFalse);
    expect(Rejourney.isPaused, isFalse);
    // Resume is already satisfied locally and must not issue a native call.
    expect(await Rejourney.resume(), isTrue);
    expect(fake.calls.where((call) => call.$1 == 'resume'), isEmpty);
  });

  test('stop supersedes an in-flight pause without reviving paused state',
      () async {
    fake.responses['start'] = <Object?, Object?>{
      'success': true,
      'sessionId': 'session_stop_during_pause',
    };
    fake.responses['getSessionId'] = 'session_stop_during_pause';
    fake.responses['stop'] = <Object?, Object?>{
      'success': true,
      'sessionId': 'session_stop_during_pause',
      'uploadSuccess': true,
    };
    fake.responses['pause'] = true;
    fake.delays['pause'] = const Duration(milliseconds: 20);

    await Rejourney.init('pk_live_test');
    await Rejourney.start();

    final pause = Rejourney.pause();
    final stop = Rejourney.stop();

    expect(await pause, isFalse);
    expect((await stop).success, isTrue);
    expect(Rejourney.isRecording, isFalse);
    expect(Rejourney.isPaused, isFalse);
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

  test('an older stop completion cannot clear a replacement session', () async {
    fake.responseQueues['start'] = <Object?>[
      <Object?, Object?>{'success': true, 'sessionId': 'session_old'},
      <Object?, Object?>{'success': true, 'sessionId': 'session_new'},
    ];
    fake.responses['getSessionId'] = 'session_old';
    fake.responses['stop'] = <Object?, Object?>{
      'success': true,
      'sessionId': 'session_old',
      'uploadSuccess': true,
    };
    fake.delays['stop'] = const Duration(milliseconds: 30);

    await Rejourney.init('pk_live_test');
    await Rejourney.start();
    final oldStop = Rejourney.stop();
    await Future<void>.delayed(Duration.zero);

    final replacement = await Rejourney.start();
    expect(replacement.sessionId, 'session_new');
    expect(Rejourney.isRecording, isTrue);

    await oldStop;
    expect(Rejourney.isRecording, isTrue);
  });

  test('a superseded start cannot stop a replacement session', () async {
    fake.responseQueues['start'] = <Object?>[
      <Object?, Object?>{'success': true, 'sessionId': 'session_old'},
      <Object?, Object?>{'success': true, 'sessionId': 'session_new'},
    ];
    fake.delayQueues['start'] = <Duration>[
      const Duration(milliseconds: 30),
      Duration.zero,
    ];
    fake.responses['stop'] = <Object?, Object?>{
      'success': true,
      'sessionId': 'session_old',
      'uploadSuccess': true,
    };

    await Rejourney.init('pk_live_test');
    final oldStart = Rejourney.start();
    await Future<void>.delayed(Duration.zero);
    await Rejourney.stop();
    final replacement = await Rejourney.start();
    final superseded = await oldStart;

    expect(replacement.sessionId, 'session_new');
    expect(superseded.error, 'start_superseded');
    expect(Rejourney.isRecording, isTrue);
    expect(fake.calls.where((call) => call.$1 == 'stop'), hasLength(1));
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

  test('capture diagnostics are parsed from native SDK metrics', () async {
    fake.responses['getSdkMetrics'] = <Object?, Object?>{
      'captureAttemptCount': 12,
      'captureSuccessCount': 11,
      'windowPixelCopyCaptureCount': 2,
      'flutterSurfaceCaptureCount': 1,
      'flutterImageViewCaptureCount': 9,
      'flutterRendererCaptureCount': 1,
      'flutterBlackFrameFallbackCount': 1,
      'averageCaptureDurationMs': 18.25,
      'maxCaptureDurationMs': 31.5,
      'averageFlutterImageViewReadbackMs': 4.25,
      'maxFlutterImageViewReadbackMs': 8.5,
      'averageFlutterRendererReadbackMs': 7.75,
      'maxFlutterRendererReadbackMs': 12.5,
      'lastCaptureSource': 'flutter_renderer',
    };

    final metrics = await Rejourney.getSdkMetrics();

    expect(metrics.captureAttemptCount, 12);
    expect(metrics.captureSuccessCount, 11);
    expect(metrics.windowPixelCopyCaptureCount, 2);
    expect(metrics.flutterSurfaceCaptureCount, 1);
    expect(metrics.flutterImageViewCaptureCount, 9);
    expect(metrics.flutterRendererCaptureCount, 1);
    expect(metrics.flutterBlackFrameFallbackCount, 1);
    expect(metrics.averageCaptureDurationMs, 18.25);
    expect(metrics.maxCaptureDurationMs, 31.5);
    expect(metrics.averageFlutterImageViewReadbackMs, 4.25);
    expect(metrics.maxFlutterImageViewReadbackMs, 8.5);
    expect(metrics.averageFlutterRendererReadbackMs, 7.75);
    expect(metrics.maxFlutterRendererReadbackMs, 12.5);
    expect(metrics.lastCaptureSource, 'flutter_renderer');
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
