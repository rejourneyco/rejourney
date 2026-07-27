import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'rejourney_platform_interface.dart';
import 'src/flutter_frame_capture.dart';

/// Method-channel implementation for Android and iOS.
class MethodChannelRejourney extends RejourneyPlatform {
  MethodChannelRejourney() {
    methodChannel.setMethodCallHandler(_handleNativeCall);
  }

  @visibleForTesting
  final MethodChannel methodChannel =
      const MethodChannel('co.rejourney.flutter/methods');

  final StreamController<Map<String, Object?>> _events =
      StreamController<Map<String, Object?>>.broadcast(sync: true);

  @override
  Stream<Map<String, Object?>> get events => _events.stream;

  @override
  Future<T?> invoke<T>(
    String method, [
    Map<String, Object?>? arguments,
  ]) {
    return methodChannel.invokeMethod<T>(method, arguments);
  }

  Future<Object?> _handleNativeCall(MethodCall call) async {
    final raw = call.arguments;
    final payload = raw is Map
        ? raw.map<String, Object?>(
            (Object? key, Object? value) =>
                MapEntry<String, Object?>(key.toString(), value),
          )
        : <String, Object?>{};

    if (call.method == '_captureFlutterFrame') {
      return FlutterFrameCapture.capture(
        targetWidth: (payload['width'] as num?)?.toInt() ?? 0,
        targetHeight: (payload['height'] as num?)?.toInt() ?? 0,
      );
    }

    _events.add(<String, Object?>{'type': call.method, ...payload});
    return null;
  }
}
