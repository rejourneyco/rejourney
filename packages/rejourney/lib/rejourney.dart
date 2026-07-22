import 'dart:async';

import 'package:flutter/foundation.dart';

import 'rejourney_platform_interface.dart';
import 'src/config.dart';
import 'src/models.dart';

export 'src/config.dart';
export 'src/error_capture.dart';
export 'src/http_client.dart';
export 'src/mask.dart';
export 'src/models.dart';
export 'src/navigation.dart';

/// Rejourney's Flutter session-replay and observability API.
///
/// Initialize once, then start only after any consent required by your product:
///
/// ```dart
/// await Rejourney.init('pk_live_your_public_key');
/// await Rejourney.start();
/// ```
abstract final class Rejourney {
  static const String version = '0.1.1';

  static String? _publicKey;
  static RejourneyConfig? _config;
  static bool _recording = false;

  static bool get isInitialized => _publicKey != null;
  static bool get isRecording => _recording;
  static RejourneyConfig? get config => _config;
  static Stream<Map<String, Object?>> get nativeEvents =>
      RejourneyPlatform.instance.events;

  /// Configures the SDK without beginning capture.
  static Future<void> init(
    String publicKey, {
    RejourneyConfig config = const RejourneyConfig(),
  }) async {
    if (publicKey.trim().isEmpty) {
      throw ArgumentError.value(publicKey, 'publicKey', 'Must not be empty');
    }
    config.validate();
    _publicKey = publicKey.trim();
    _config = config;
    await RejourneyPlatform.instance.invoke<void>(
      'configure',
      config.toMap(_publicKey!),
    );
  }

  /// Starts a new native recording and telemetry session.
  static Future<RejourneyStartResult> start() async {
    final key = _publicKey;
    final options = _config;
    if (key == null || options == null) {
      throw StateError('Call Rejourney.init() before Rejourney.start().');
    }
    if (!options.enabled) {
      return const RejourneyStartResult(success: false, error: 'disabled');
    }
    if (options.disableInDevelopment && kDebugMode) {
      return const RejourneyStartResult(
        success: false,
        error: 'disabled_in_development',
      );
    }

    final response =
        await RejourneyPlatform.instance.invoke<Map<Object?, Object?>>('start');
    final result = RejourneyStartResult.fromMap(response ?? const {});
    _recording = result.success;
    return result;
  }

  /// Flushes and stops the current native session.
  static Future<RejourneyStopResult> stop() async {
    final timeout = _config?.stopTimeout ?? const Duration(seconds: 10);
    String? activeSessionId;
    try {
      activeSessionId = await getSessionId().timeout(
        timeout < const Duration(seconds: 1)
            ? timeout
            : const Duration(seconds: 1),
      );
    } on TimeoutException {
      // The stop request below remains authoritative even if this optional
      // preflight lookup cannot complete quickly.
    }

    try {
      final response = await RejourneyPlatform.instance
          .invoke<Map<Object?, Object?>>('stop')
          .timeout(timeout);
      return RejourneyStopResult.fromMap(response ?? const {});
    } on TimeoutException {
      return RejourneyStopResult(
        success: true,
        sessionId: activeSessionId,
        uploadSuccess: false,
        warning: 'native_flush_timeout',
      );
    } finally {
      _recording = false;
    }
  }

  static Future<String?> getSessionId() {
    return RejourneyPlatform.instance.invoke<String>('getSessionId');
  }

  /// Associates current and future sessions with an internal user identifier.
  static Future<void> setUserIdentity(String userId) async {
    if (userId.trim().isEmpty) {
      throw ArgumentError.value(userId, 'userId', 'Must not be empty');
    }
    await RejourneyPlatform.instance.invoke<void>(
      'setUserIdentity',
      <String, Object?>{'userId': userId},
    );
  }

  static Future<void> clearUserIdentity() {
    return RejourneyPlatform.instance.invoke<void>('clearUserIdentity');
  }

  /// Records a stable product or diagnostic event.
  static Future<void> logEvent(
    String name, [
    Map<String, Object?> properties = const <String, Object?>{},
  ]) async {
    if (name.trim().isEmpty) {
      throw ArgumentError.value(name, 'name', 'Must not be empty');
    }
    await RejourneyPlatform.instance.invoke<void>(
      'logEvent',
      <String, Object?>{
        'name': name,
        'properties': _channelMap(properties),
      },
    );
  }

  /// Sets one metadata key or a map of session metadata values.
  static Future<void> setMetadata(
    Object keyOrMetadata, [
    Object? value,
  ]) async {
    final Map<String, Object?> metadata;
    if (keyOrMetadata is String) {
      if (keyOrMetadata.isEmpty) {
        throw ArgumentError.value(keyOrMetadata, 'key', 'Must not be empty');
      }
      metadata = <String, Object?>{keyOrMetadata: _channelValue(value)};
    } else if (keyOrMetadata is Map<String, Object?>) {
      metadata = _channelMap(keyOrMetadata);
    } else {
      throw ArgumentError.value(
        keyOrMetadata,
        'keyOrMetadata',
        'Must be a String or Map<String, Object?>',
      );
    }
    await RejourneyPlatform.instance.invoke<void>(
      'setMetadata',
      <String, Object?>{'metadata': metadata},
    );
  }

  /// Adds a screen transition to the current session.
  static Future<void> trackScreen(
    String screenName, [
    Map<String, Object?> parameters = const <String, Object?>{},
  ]) async {
    if (screenName.trim().isEmpty) return;
    await RejourneyPlatform.instance.invoke<void>(
      'trackScreen',
      <String, Object?>{
        'screenName': screenName,
        if (parameters.isNotEmpty) 'parameters': _channelMap(parameters),
      },
    );
  }

  static Future<void> addSessionTag(String tag) {
    return logEvent('session_tag', <String, Object?>{'tag': tag});
  }

  static Future<bool> markVisualChange(
    String reason, {
    RejourneyVisualImportance importance = RejourneyVisualImportance.medium,
  }) async {
    return await RejourneyPlatform.instance.invoke<bool>(
          'markVisualChange',
          <String, Object?>{
            'reason': reason,
            'importance': importance.name,
          },
        ) ??
        false;
  }

  static Future<void> onScroll(double offset) {
    return RejourneyPlatform.instance.invoke<void>(
      'onScroll',
      <String, Object?>{'offset': offset},
    );
  }

  static Future<bool> onOAuthStarted(String provider) {
    return _booleanOperation('onOAuthStarted', <String, Object?>{
      'provider': provider,
    });
  }

  static Future<bool> onOAuthCompleted(
    String provider, {
    required bool success,
  }) {
    return _booleanOperation('onOAuthCompleted', <String, Object?>{
      'provider': provider,
      'success': success,
    });
  }

  static Future<bool> onExternalUrlOpened(String urlScheme) {
    return _booleanOperation('onExternalUrlOpened', <String, Object?>{
      'urlScheme': urlScheme,
    });
  }

  static Future<void> logNetworkRequest(RejourneyNetworkRequest request) {
    if (_shouldIgnoreNetworkUrl(request.url)) return Future<void>.value();
    final properties = request.toMap();
    if (_config?.networkCaptureSizes == false) {
      properties
        ..remove('requestBodySize')
        ..remove('responseBodySize');
    }
    return logEvent('network_request', properties);
  }

  static Future<void> logFeedback(int rating, String message) {
    return logEvent('feedback', <String, Object?>{
      'rating': rating,
      'message': message,
    });
  }

  static Future<RejourneySdkMetrics> getSdkMetrics() async {
    final response = await RejourneyPlatform.instance
        .invoke<Map<Object?, Object?>>('getSdkMetrics');
    return RejourneySdkMetrics.fromMap(response ?? const {});
  }

  /// Triggers an intentional native crash. Debug builds only.
  static Future<void> debugCrash() {
    return RejourneyPlatform.instance.invoke<void>('debugCrash');
  }

  /// Blocks the native main thread to validate ANR reporting. Debug builds only.
  static Future<void> debugTriggerAnr({
    Duration duration = const Duration(seconds: 5),
  }) {
    return RejourneyPlatform.instance.invoke<void>(
      'debugTriggerAnr',
      <String, Object?>{'durationMs': duration.inMilliseconds},
    );
  }

  @visibleForTesting
  static void resetForTesting() {
    _publicKey = null;
    _config = null;
    _recording = false;
  }

  static Future<bool> _booleanOperation(
    String method,
    Map<String, Object?> arguments,
  ) async {
    return await RejourneyPlatform.instance.invoke<bool>(method, arguments) ??
        false;
  }

  static bool _shouldIgnoreNetworkUrl(String value) {
    final config = _config;
    if (config == null || !config.autoTrackNetwork) return true;
    final url = value.toLowerCase();
    final sdkHost = Uri.tryParse(config.apiUrl)?.host.toLowerCase();
    if (sdkHost != null && sdkHost.isNotEmpty && url.contains(sdkHost)) {
      return true;
    }
    return config.networkIgnoreUrls.any(url.contains);
  }

  static Map<String, Object?> _channelMap(Map<String, Object?> input) {
    return input.map(
      (String key, Object? value) =>
          MapEntry<String, Object?>(key, _channelValue(value)),
    );
  }

  static Object? _channelValue(Object? value) {
    if (value == null || value is String || value is bool || value is num) {
      return value;
    }
    if (value is DateTime) return value.toIso8601String();
    if (value is Duration) return value.inMilliseconds;
    if (value is Uri) return value.toString();
    if (value is List<Object?>) return value.map(_channelValue).toList();
    if (value is Map<String, Object?>) return _channelMap(value);
    throw ArgumentError.value(
      value,
      'value',
      'Platform-channel values must be null, scalar, List, or String-keyed Map',
    );
  }

  static Future<void> updateMaskRegion(
    String id, {
    required double left,
    required double top,
    required double width,
    required double height,
  }) {
    return RejourneyPlatform.instance.invoke<void>(
      'updateMaskRegion',
      <String, Object?>{
        'id': id,
        'left': left,
        'top': top,
        'width': width,
        'height': height,
      },
    );
  }

  static Future<void> removeMaskRegion(String id) {
    return RejourneyPlatform.instance.invoke<void>(
      'removeMaskRegion',
      <String, Object?>{'id': id},
    );
  }
}
