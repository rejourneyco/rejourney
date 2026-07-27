import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rejourney/src/flutter_frame_capture.dart';

void main() {
  testWidgets('captures the retained Flutter scene at replay resolution', (
    WidgetTester tester,
  ) async {
    tester.view.devicePixelRatio = 3;
    tester.view.physicalSize = const Size(1200, 600);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(
      const Directionality(
        textDirection: TextDirection.ltr,
        child: ColoredBox(color: Color(0xff2563eb)),
      ),
    );
    await tester.pump();

    const width = 400;
    const height = 200;
    final result = await tester.runAsync(
      () => FlutterFrameCapture.capture(
        targetWidth: width,
        targetHeight: height,
      ),
    );

    expect(result, isNotNull);
    expect(result!['width'], width);
    expect(result['height'], height);

    final rgba = result['rgba']! as Uint8List;
    expect(rgba.length, width * height * 4);
    final center = ((height ~/ 2) * width + (width ~/ 2)) * 4;
    expect(rgba.sublist(center, center + 4), <int>[37, 99, 235, 255]);
  });
}
