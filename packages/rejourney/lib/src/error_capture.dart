import 'dart:async';
import 'dart:math';
import 'dart:ui';

import 'package:flutter/foundation.dart';

import '../rejourney.dart';

final Random _incidentRandom = Random.secure();

String _newIncidentId() {
  final timestamp = DateTime.now().microsecondsSinceEpoch.toRadixString(36);
  final random = List<int>.generate(16, (_) => _incidentRandom.nextInt(256))
      .map((value) => value.toRadixString(16).padLeft(2, '0'))
      .join();
  return 'flutter-$timestamp-$random';
}

String _exceptionCategory(Object exception) {
  final runtimeName = exception.runtimeType.toString();
  if (!RegExp(r'^_[A-Za-z0-9]{1,5}$').hasMatch(runtimeName)) {
    return runtimeName;
  }

  final message = exception.toString();
  final category = RegExp(r'\b([A-Za-z][A-Za-z0-9]*(?:Error|Exception))\b')
      .firstMatch(message)
      ?.group(1);
  return category ?? 'FlutterRuntimeError';
}

/// Installs Flutter framework and platform-dispatcher error capture.
final class RejourneyErrorCapture {
  RejourneyErrorCapture._(
    this._previousFlutterHandler,
    this._previousPlatformHandler,
  );

  final FlutterExceptionHandler? _previousFlutterHandler;
  final ErrorCallback? _previousPlatformHandler;
  bool _disposed = false;

  static RejourneyErrorCapture install() {
    final previousFlutterHandler = FlutterError.onError;
    final previousPlatformHandler = PlatformDispatcher.instance.onError;

    final capture = RejourneyErrorCapture._(
      previousFlutterHandler,
      previousPlatformHandler,
    );

    FlutterError.onError = (FlutterErrorDetails details) {
      final incidentId = _newIncidentId();
      unawaited(
        Rejourney.logEvent('error', <String, Object?>{
          'incidentId': incidentId,
          'name': _exceptionCategory(details.exception),
          'exceptionCategory': _exceptionCategory(details.exception),
          'message': details.exceptionAsString(),
          'stack': details.stack?.toString(),
          if (details.context != null) 'context': details.context.toString(),
          'source': 'flutter_framework',
          'handled': false,
        }),
      );
      if (previousFlutterHandler != null) {
        previousFlutterHandler(details);
      } else {
        FlutterError.presentError(details);
      }
    };

    PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
      final incidentId = _newIncidentId();
      unawaited(
        Rejourney.logEvent('error', <String, Object?>{
          'incidentId': incidentId,
          'name': _exceptionCategory(error),
          'exceptionCategory': _exceptionCategory(error),
          'message': error.toString(),
          'stack': stack.toString(),
          'source': 'platform_dispatcher',
          'handled': false,
        }),
      );
      return previousPlatformHandler?.call(error, stack) ?? false;
    };

    return capture;
  }

  /// Restores the handlers that were active before [install].
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    FlutterError.onError = _previousFlutterHandler;
    PlatformDispatcher.instance.onError = _previousPlatformHandler;
  }

  /// Runs an app entrypoint in a guarded zone and records uncaught Dart errors.
  static R? runGuarded<R>(R Function() body) {
    return runZonedGuarded<R>(
      body,
      (Object error, StackTrace stack) {
        final incidentId = _newIncidentId();
        unawaited(
          Rejourney.logEvent('error', <String, Object?>{
            'incidentId': incidentId,
            'name': _exceptionCategory(error),
            'exceptionCategory': _exceptionCategory(error),
            'message': error.toString(),
            'stack': stack.toString(),
            'source': 'dart_zone',
            'handled': false,
          }),
        );
      },
    );
  }
}
