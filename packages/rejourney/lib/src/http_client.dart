import 'dart:async';

import 'package:http/http.dart' as http;

import '../rejourney.dart';

/// A drop-in `package:http` client that adds request timeline markers.
class RejourneyHttpClient extends http.BaseClient {
  RejourneyHttpClient({
    http.Client? inner,
    this.closeInnerClient = true,
  }) : _inner = inner ?? http.Client();

  final http.Client _inner;
  final bool closeInnerClient;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final startedAt = DateTime.now();
    final stopwatch = Stopwatch()..start();

    try {
      final response = await _inner.send(request);
      var receivedBytes = 0;
      var emitted = false;

      void emit({String? error}) {
        if (emitted) return;
        emitted = true;
        stopwatch.stop();
        unawaited(
          Rejourney.logNetworkRequest(
            RejourneyNetworkRequest(
              method: request.method,
              url: request.url.toString(),
              statusCode: response.statusCode,
              duration: stopwatch.elapsed,
              startedAt: startedAt,
              endedAt: DateTime.now(),
              requestBodySize:
                  request.contentLength != null && request.contentLength! >= 0
                      ? request.contentLength
                      : null,
              responseBodySize:
                  receivedBytes > 0 ? receivedBytes : response.contentLength,
              requestContentType: request.headers['content-type'],
              responseContentType: response.headers['content-type'],
              errorMessage: error,
              success: error == null &&
                  response.statusCode >= 200 &&
                  response.statusCode < 400,
            ),
          ),
        );
      }

      final trackedStream = response.stream.transform<List<int>>(
        StreamTransformer<List<int>, List<int>>.fromHandlers(
          handleData: (List<int> data, EventSink<List<int>> sink) {
            receivedBytes += data.length;
            sink.add(data);
          },
          handleError: (
            Object error,
            StackTrace stack,
            EventSink<List<int>> sink,
          ) {
            emit(error: error.toString());
            sink.addError(error, stack);
          },
          handleDone: (EventSink<List<int>> sink) {
            emit();
            sink.close();
          },
        ),
      );

      return http.StreamedResponse(
        trackedStream,
        response.statusCode,
        contentLength: response.contentLength,
        request: response.request,
        headers: response.headers,
        isRedirect: response.isRedirect,
        persistentConnection: response.persistentConnection,
        reasonPhrase: response.reasonPhrase,
      );
    } catch (error, stack) {
      stopwatch.stop();
      unawaited(
        Rejourney.logNetworkRequest(
          RejourneyNetworkRequest(
            method: request.method,
            url: request.url.toString(),
            statusCode: 0,
            duration: stopwatch.elapsed,
            startedAt: startedAt,
            endedAt: DateTime.now(),
            requestBodySize:
                request.contentLength != null && request.contentLength! >= 0
                    ? request.contentLength
                    : null,
            requestContentType: request.headers['content-type'],
            errorMessage: error.toString(),
            success: false,
          ),
        ),
      );
      Error.throwWithStackTrace(error, stack);
    }
  }

  @override
  void close() {
    if (closeInnerClient) _inner.close();
    super.close();
  }
}
