import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rejourney/rejourney_method_channel.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('co.rejourney.flutter/methods');
  late MethodChannelRejourney platform;
  late MethodCall received;

  setUp(() {
    platform = MethodChannelRejourney();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (MethodCall call) async {
      received = call;
      return <Object?, Object?>{
        'success': true,
        'sessionId': 'native_session',
      };
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('forwards methods and typed arguments to the native channel', () async {
    final response = await platform.invoke<Map<Object?, Object?>>(
      'start',
      <String, Object?>{'consent': true},
    );

    expect(received.method, 'start');
    expect(received.arguments, <String, Object?>{'consent': true});
    expect(response, containsPair('sessionId', 'native_session'));
  });
}
