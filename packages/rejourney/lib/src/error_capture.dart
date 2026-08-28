import 'dart:async';
import 'dart:math';
import 'dart:isolate';
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
    this._isolateErrorPort,
  );

  final FlutterExceptionHandler? _previousFlutterHandler;
  final ErrorCallback? _previousPlatformHandler;
  final RawReceivePort _isolateErrorPort;
  FlutterExceptionHandler? _installedFlutterHandler;
  ErrorCallback? _installedPlatformHandler;
  bool _disposed = false;

  static RejourneyErrorCapture install() {
    final previousFlutterHandler = FlutterError.onError;
    final previousPlatformHandler = PlatformDispatcher.instance.onError;
    final isolateErrorPort = RawReceivePort();

    final capture = RejourneyErrorCapture._(
      previousFlutterHandler,
      previousPlatformHandler,
      isolateErrorPort,
    );

    isolateErrorPort.handler = (Object? payload) {
      if (payload is! List<Object?> || payload.isEmpty) return;
      final error = payload.first ?? 'Unknown isolate error';
      final rawStack = payload.length > 1 ? payload[1] : null;
      final stack = rawStack is StackTrace
          ? rawStack
          : StackTrace.fromString(rawStack?.toString() ?? '');
      unawaited(
        Rejourney.logEvent('error', <String, Object?>{
          'incidentId': _newIncidentId(),
          'name': _exceptionCategory(error),
          'exceptionCategory': _exceptionCategory(error),
          'message': error.toString(),
          'stack': stack.toString(),
          'source': 'dart_isolate',
          'handled': false,
        }),
      );
    };
    Isolate.current.addErrorListener(isolateErrorPort.sendPort);

    capture._installedFlutterHandler = (FlutterErrorDetails details) {
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
    FlutterError.onError = capture._installedFlutterHandler;

    capture._installedPlatformHandler = (Object error, StackTrace stack) {
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
    PlatformDispatcher.instance.onError = capture._installedPlatformHandler;

    return capture;
  }

  /// Restores the handlers that were active before [install].
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    Isolate.current.removeErrorListener(_isolateErrorPort.sendPort);
    _isolateErrorPort.close();
    if (identical(FlutterError.onError, _installedFlutterHandler)) {
      FlutterError.onError = _previousFlutterHandler;
    }
    if (identical(
      PlatformDispatcher.instance.onError,
      _installedPlatformHandler,
    )) {
      PlatformDispatcher.instance.onError = _previousPlatformHandler;
    }
    _installedFlutterHandler = null;
    _installedPlatformHandler = null;
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
