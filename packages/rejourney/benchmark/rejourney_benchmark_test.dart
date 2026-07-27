import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rejourney/rejourney.dart';
import 'package:rejourney/rejourney_platform_interface.dart';
import 'package:rejourney/src/flutter_frame_capture.dart';

final class BenchmarkPlatform extends RejourneyPlatform {
  int callCount = 0;

  @override
  Stream<Map<String, Object?>> get events => const Stream.empty();

  @override
  Future<T?> invoke<T>(
    String method, [
    Map<String, Object?>? arguments,
  ]) async {
    callCount += 1;
    return null;
  }
}

Future<double> _measureMicrosPerOperation(
  int iterations,
  Future<void> Function(int index) operation,
) async {
  for (var index = 0; index < 500; index += 1) {
    await operation(index);
  }
  final stopwatch = Stopwatch()..start();
  for (var index = 0; index < iterations; index += 1) {
    await operation(index);
  }
  stopwatch.stop();
  return stopwatch.elapsedMicroseconds / iterations;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('reports reproducible Dart API overhead measurements', () async {
    final platform = BenchmarkPlatform();
    RejourneyPlatform.instance = platform;
    await Rejourney.init('pk_benchmark');

    const iterations = 20000;
    final noOp = await _measureMicrosPerOperation(iterations, (_) async {});
    final event = await _measureMicrosPerOperation(
      iterations,
      (index) => Rejourney.logEvent('benchmark_event', <String, Object?>{
        'index': index,
        'enabled': true,
        'labels': <String>['flutter', 'benchmark'],
      }),
    );
    final metadata = await _measureMicrosPerOperation(
      iterations,
      (index) => Rejourney.setMetadata(<String, Object?>{
        'index': index,
        'variant': 'control',
      }),
    );
    final networkMarker = await _measureMicrosPerOperation(
      iterations,
      (index) => Rejourney.logNetworkRequest(
        RejourneyNetworkRequest(
          requestId: 'request_$index',
          method: 'GET',
          url: 'https://api.example.com/items/$index',
          statusCode: 200,
          duration: const Duration(milliseconds: 12),
        ),
      ),
    );

    final result = <String, Object>{
      'iterations': iterations,
      'unit': 'microseconds_per_operation',
      'async_noop': noOp,
      'log_event': event,
      'set_metadata': metadata,
      'network_marker': networkMarker,
      'platform_calls': platform.callCount,
    };
    // A single machine-readable line makes local and CI runs easy to compare.
    // ignore: avoid_print
    print('REJOURNEY_FLUTTER_BENCHMARK ${jsonEncode(result)}');

    expect(event, lessThan(100));
    expect(metadata, lessThan(100));
    expect(networkMarker, lessThan(100));
  });

  testWidgets('benchmarks retained Flutter layer replay capture', (
    WidgetTester tester,
  ) async {
    tester.view.devicePixelRatio = 3;
    tester.view.physicalSize = const Size(1920, 1080);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: <Color>[Color(0xff0f172a), Color(0xff2563eb)],
              ),
            ),
            child: Center(child: Text('Retained layer benchmark')),
          ),
        ),
      ),
    );
    await tester.pump();

    const iterations = 10;
    const targetWidth = 640;
    const targetHeight = 360;
    final stopwatch = Stopwatch()..start();
    for (var index = 0; index < iterations; index += 1) {
      final frame = await tester.runAsync(
        () => FlutterFrameCapture.capture(
          targetWidth: targetWidth,
          targetHeight: targetHeight,
        ),
      );
      expect(frame, isNotNull);
    }
    stopwatch.stop();

    final averageMs = stopwatch.elapsedMicroseconds / iterations / 1000;
    // ignore: avoid_print
    print(
      'REJOURNEY_FLUTTER_CAPTURE_BENCHMARK '
      '${jsonEncode(<String, Object>{
            'iterations': iterations,
            'width': targetWidth,
            'height': targetHeight,
            'average_ms': averageMs,
          })}',
    );
    expect(averageMs, lessThan(100));
  });
}
