import 'dart:async';
import 'dart:ui';

import 'package:flutter/foundation.dart';

import '../rejourney.dart';

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
      unawaited(
        Rejourney.logEvent('error', <String, Object?>{
          'name': details.exception.runtimeType.toString(),
          'message': details.exceptionAsString(),
          'stack': details.stack?.toString(),
          if (details.context != null) 'context': details.context.toString(),
          'source': 'flutter_framework',
        }),
      );
      if (previousFlutterHandler != null) {
        previousFlutterHandler(details);
      } else {
        FlutterError.presentError(details);
      }
    };

    PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
      unawaited(
        Rejourney.logEvent('error', <String, Object?>{
          'name': error.runtimeType.toString(),
          'message': error.toString(),
          'stack': stack.toString(),
          'source': 'platform_dispatcher',
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
        unawaited(
          Rejourney.logEvent('error', <String, Object?>{
            'name': error.runtimeType.toString(),
            'message': error.toString(),
            'stack': stack.toString(),
            'source': 'dart_zone',
          }),
        );
      },
    );
  }
}
