import 'package:plugin_platform_interface/plugin_platform_interface.dart';

import 'rejourney_method_channel.dart';

/// Replaceable platform boundary used by the native Flutter plugin.
abstract class RejourneyPlatform extends PlatformInterface {
  RejourneyPlatform() : super(token: _token);

  static final Object _token = Object();
  static RejourneyPlatform _instance = MethodChannelRejourney();

  static RejourneyPlatform get instance => _instance;

  static set instance(RejourneyPlatform instance) {
    PlatformInterface.verifyToken(instance, _token);
    _instance = instance;
  }

  /// Invokes a native SDK operation.
  Future<T?> invoke<T>(String method, [Map<String, Object?>? arguments]) {
    throw UnimplementedError('$method has not been implemented.');
  }

  /// Events emitted by the native SDK, including session rollover.
  Stream<Map<String, Object?>> get events {
    throw UnimplementedError('Native events have not been implemented.');
  }
}
