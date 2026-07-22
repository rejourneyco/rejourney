import 'package:flutter/foundation.dart';

import 'models.dart';

/// Runtime capture options for the Rejourney Flutter SDK.
@immutable
final class RejourneyConfig {
  const RejourneyConfig({
    this.apiUrl = 'https://api.rejourney.co',
    this.userId,
    this.enabled = true,
    this.observeOnly = false,
    this.captureFps,
    this.maxSessionDuration,
    this.stopTimeout = const Duration(seconds: 10),
    this.disableInDevelopment = false,
    this.detectRageTaps = true,
    this.rageTapThreshold = 3,
    this.rageTapTimeWindow = const Duration(milliseconds: 500),
    this.rageTapRadius = 50,
    this.debug = false,
    this.captureQuality = RejourneyCaptureQuality.medium,
    this.wifiOnly = false,
    this.captureScreen = true,
    this.captureAnalytics = true,
    this.captureCrashes = true,
    this.captureAnrs = true,
    this.trackConsoleLogs = true,
    this.collectDeviceInfo = true,
    this.collectGeoLocation = true,
    this.autoTrackNetwork = true,
    this.captureNativeSheets = true,
    this.networkIgnoreUrls = const <String>[],
    this.networkCaptureSizes = true,
  })  : assert(captureFps == null || (captureFps >= 1 && captureFps <= 30)),
        assert(rageTapThreshold >= 1),
        assert(rageTapRadius > 0);

  final String apiUrl;
  final String? userId;
  final bool enabled;
  final bool observeOnly;
  final int? captureFps;
  final Duration? maxSessionDuration;

  /// Maximum time [Rejourney.stop] waits for native upload finalization.
  ///
  /// Native teardown and best-effort persistence continue after this deadline.
  final Duration stopTimeout;
  final bool disableInDevelopment;
  final bool detectRageTaps;
  final int rageTapThreshold;
  final Duration rageTapTimeWindow;
  final double rageTapRadius;
  final bool debug;
  final RejourneyCaptureQuality captureQuality;
  final bool wifiOnly;
  final bool captureScreen;
  final bool captureAnalytics;
  final bool captureCrashes;
  final bool captureAnrs;
  final bool trackConsoleLogs;
  final bool collectDeviceInfo;
  final bool collectGeoLocation;
  final bool autoTrackNetwork;
  final bool captureNativeSheets;
  final List<String> networkIgnoreUrls;
  final bool networkCaptureSizes;

  void validate() {
    final uri = Uri.tryParse(apiUrl);
    if (uri == null ||
        !uri.hasScheme ||
        !uri.hasAuthority ||
        (uri.scheme != 'https' && uri.scheme != 'http')) {
      throw ArgumentError.value(
          apiUrl, 'apiUrl', 'Must be an absolute HTTP URL');
    }
    if (maxSessionDuration != null && maxSessionDuration! <= Duration.zero) {
      throw ArgumentError.value(
        maxSessionDuration,
        'maxSessionDuration',
        'Must be greater than zero',
      );
    }
    if (stopTimeout <= Duration.zero) {
      throw ArgumentError.value(
        stopTimeout,
        'stopTimeout',
        'Must be greater than zero',
      );
    }
    if (rageTapTimeWindow <= Duration.zero) {
      throw ArgumentError.value(
        rageTapTimeWindow,
        'rageTapTimeWindow',
        'Must be greater than zero',
      );
    }
  }

  Map<String, Object?> toMap(String publicKey) {
    return <String, Object?>{
      'publicKey': publicKey,
      'apiUrl': apiUrl,
      if (userId != null) 'userId': userId,
      'enabled': enabled,
      'observeOnly': observeOnly,
      if (captureFps != null) 'fps': captureFps,
      if (maxSessionDuration != null)
        'maxSessionDurationMs': maxSessionDuration!.inMilliseconds,
      'disableInDev': disableInDevelopment,
      'detectRageTaps': detectRageTaps,
      'rageTapThreshold': rageTapThreshold,
      'rageTapTimeWindow': rageTapTimeWindow.inMilliseconds,
      'rageTapRadius': rageTapRadius,
      'debug': debug,
      'quality': captureQuality.name,
      'wifiOnly': wifiOnly,
      'captureScreen': captureScreen,
      'captureAnalytics': captureAnalytics,
      'captureCrashes': captureCrashes,
      'captureANR': captureAnrs,
      'captureLogs': trackConsoleLogs,
      'collectDeviceInfo': collectDeviceInfo,
      'collectGeoLocation': collectGeoLocation,
      'autoTrackNetwork': autoTrackNetwork,
      'captureNativeSheets': captureNativeSheets,
      'networkIgnoreUrls': networkIgnoreUrls,
      'networkCaptureSizes': networkCaptureSizes,
    };
  }
}
