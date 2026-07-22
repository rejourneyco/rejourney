import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:rejourney/rejourney.dart';
import 'package:rejourney/rejourney_platform_interface.dart';

final class HttpFakePlatform extends RejourneyPlatform
    with MockPlatformInterfaceMixin {
  final List<(String, Map<String, Object?>?)> calls =
      <(String, Map<String, Object?>?)>[];

  @override
  Stream<Map<String, Object?>> get events => const Stream.empty();

  @override
  Future<T?> invoke<T>(
    String method, [
    Map<String, Object?>? arguments,
  ]) async {
    calls.add((method, arguments));
    return null;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('records package:http status, duration, and response size', () async {
    final fake = HttpFakePlatform();
    RejourneyPlatform.instance = fake;
    Rejourney.resetForTesting();
    await Rejourney.init('pk_live_test');

    final client = RejourneyHttpClient(
      inner: MockClient(
        (_) async => http.Response(
          jsonEncode(<String, bool>{'ok': true}),
          201,
          headers: <String, String>{'content-type': 'application/json'},
        ),
      ),
    );

    final response = await client.get(Uri.parse('https://example.test/orders'));
    expect(response.statusCode, 201);
    await Future<void>.delayed(Duration.zero);

    final networkCall = fake.calls.lastWhere(
      (call) => call.$1 == 'logEvent' && call.$2?['name'] == 'network_request',
    );
    final properties = networkCall.$2!['properties'] as Map<Object?, Object?>;
    expect(properties['statusCode'], 201);
    expect(properties['responseBodySize'], response.bodyBytes.length);
    client.close();
  });
}
