/// Visual capture quality preset.
enum RejourneyCaptureQuality {
  low,
  medium,
  high,
}

/// Importance hint for an explicit visual-change marker.
enum RejourneyVisualImportance {
  low,
  medium,
  high,
  critical,
}

/// Result returned when a recording session starts.
final class RejourneyStartResult {
  const RejourneyStartResult({
    required this.success,
    this.sessionId,
    this.error,
    this.telemetryOnly = false,
  });

  factory RejourneyStartResult.fromMap(Map<Object?, Object?> map) {
    return RejourneyStartResult(
      success: map['success'] == true,
      sessionId: map['sessionId'] as String?,
      error: map['error'] as String?,
      telemetryOnly: map['telemetryOnly'] == true,
    );
  }

  final bool success;
  final String? sessionId;
  final String? error;
  final bool telemetryOnly;

  @override
  String toString() {
    return 'RejourneyStartResult(success: $success, sessionId: $sessionId, '
        'error: $error, telemetryOnly: $telemetryOnly)';
  }
}

/// Result returned after a session is finalized.
final class RejourneyStopResult {
  const RejourneyStopResult({
    required this.success,
    this.sessionId,
    required this.uploadSuccess,
    this.warning,
    this.error,
  });

  factory RejourneyStopResult.fromMap(Map<Object?, Object?> map) {
    return RejourneyStopResult(
      success: map['success'] == true,
      sessionId: map['sessionId'] as String?,
      uploadSuccess: map['uploadSuccess'] != false,
      warning: map['warning'] as String?,
      error: map['error'] as String?,
    );
  }

  final bool success;
  final String? sessionId;
  final bool uploadSuccess;
  final String? warning;
  final String? error;
}

/// Health and upload measurements from the native SDK.
final class RejourneySdkMetrics {
  const RejourneySdkMetrics({
    this.uploadSuccessCount = 0,
    this.uploadFailureCount = 0,
    this.retryAttemptCount = 0,
    this.circuitBreakerOpenCount = 0,
    this.memoryEvictionCount = 0,
    this.offlinePersistCount = 0,
    this.sessionStartCount = 0,
    this.crashCount = 0,
    this.uploadSuccessRate = 1,
    this.averageUploadDurationMs = 0,
    this.currentQueueDepth = 0,
    this.lastUploadTime,
    this.lastRetryTime,
    this.totalBytesUploaded = 0,
    this.totalBytesEvicted = 0,
  });

  factory RejourneySdkMetrics.fromMap(Map<Object?, Object?> map) {
    int integer(String key) => (map[key] as num?)?.toInt() ?? 0;
    double decimal(String key, [double fallback = 0]) =>
        (map[key] as num?)?.toDouble() ?? fallback;
    DateTime? timestamp(String key) {
      final value = map[key] as num?;
      return value == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(value.toInt());
    }

    return RejourneySdkMetrics(
      uploadSuccessCount: integer('uploadSuccessCount'),
      uploadFailureCount: integer('uploadFailureCount'),
      retryAttemptCount: integer('retryAttemptCount'),
      circuitBreakerOpenCount: integer('circuitBreakerOpenCount'),
      memoryEvictionCount: integer('memoryEvictionCount'),
      offlinePersistCount: integer('offlinePersistCount'),
      sessionStartCount: integer('sessionStartCount'),
      crashCount: integer('crashCount'),
      uploadSuccessRate: decimal('uploadSuccessRate', 1),
      averageUploadDurationMs: decimal('avgUploadDurationMs'),
      currentQueueDepth: integer('currentQueueDepth'),
      lastUploadTime: timestamp('lastUploadTime'),
      lastRetryTime: timestamp('lastRetryTime'),
      totalBytesUploaded: integer('totalBytesUploaded'),
      totalBytesEvicted: integer('totalBytesEvicted'),
    );
  }

  final int uploadSuccessCount;
  final int uploadFailureCount;
  final int retryAttemptCount;
  final int circuitBreakerOpenCount;
  final int memoryEvictionCount;
  final int offlinePersistCount;
  final int sessionStartCount;
  final int crashCount;
  final double uploadSuccessRate;
  final double averageUploadDurationMs;
  final int currentQueueDepth;
  final DateTime? lastUploadTime;
  final DateTime? lastRetryTime;
  final int totalBytesUploaded;
  final int totalBytesEvicted;
}

/// A network request marker shown on the session timeline.
final class RejourneyNetworkRequest {
  const RejourneyNetworkRequest({
    required this.method,
    required this.url,
    required this.statusCode,
    required this.duration,
    this.requestId,
    this.startedAt,
    this.endedAt,
    this.requestBodySize,
    this.responseBodySize,
    this.requestContentType,
    this.responseContentType,
    this.errorMessage,
    this.cached = false,
    this.success,
  });

  final String? requestId;
  final String method;
  final String url;
  final int statusCode;
  final Duration duration;
  final DateTime? startedAt;
  final DateTime? endedAt;
  final int? requestBodySize;
  final int? responseBodySize;
  final String? requestContentType;
  final String? responseContentType;
  final String? errorMessage;
  final bool cached;
  final bool? success;

  Map<String, Object?> toMap() {
    final end = endedAt ?? DateTime.now();
    final start = startedAt ?? end.subtract(duration);
    return <String, Object?>{
      if (requestId != null) 'requestId': requestId,
      'method': method.toUpperCase(),
      'url': url,
      'statusCode': statusCode,
      'duration': duration.inMicroseconds / 1000,
      'startTimestamp': start.millisecondsSinceEpoch,
      'endTimestamp': end.millisecondsSinceEpoch,
      if (requestBodySize != null) 'requestBodySize': requestBodySize,
      if (responseBodySize != null) 'responseBodySize': responseBodySize,
      if (requestContentType != null) 'requestContentType': requestContentType,
      if (responseContentType != null)
        'responseContentType': responseContentType,
      if (errorMessage != null) 'errorMessage': errorMessage,
      'cached': cached,
      'success': success ?? (statusCode >= 200 && statusCode < 400),
    };
  }
}
