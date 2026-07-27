import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';

/// Captures Flutter's retained layer tree without reading the Android surface.
///
/// Android uses this only after SurfaceView PixelCopy has returned a false
/// success (a correctly sized but black bitmap). Capturing the retained layer
/// tree works with both Impeller backends and does not replace the app's live
/// render surface, avoiding a visible transition in the host application.
final class FlutterFrameCapture {
  const FlutterFrameCapture._();

  static Future<Map<String, Object?>?> capture({
    required int targetWidth,
    required int targetHeight,
  }) async {
    if (targetWidth <= 0 || targetHeight <= 0) return null;

    final renderer = RendererBinding.instance;
    if (renderer.renderViews.isEmpty) return null;

    // A native request normally arrives between frames. If it arrives while a
    // frame is being built, wait until that frame's layer mutations are done.
    final phase = SchedulerBinding.instance.schedulerPhase;
    if (phase == SchedulerPhase.transientCallbacks ||
        phase == SchedulerPhase.midFrameMicrotasks ||
        phase == SchedulerPhase.persistentCallbacks) {
      await SchedulerBinding.instance.endOfFrame;
    }

    final renderView = renderer.renderViews.first;
    if (!renderView.hasConfiguration || renderView.size.isEmpty) return null;

    // RenderView is a repaint boundary whose production layer is the root
    // TransformLayer. Access to RenderObject.layer is protected because most
    // widgets should use a RepaintBoundary; this SDK intentionally captures
    // the whole retained Flutter scene.
    // ignore: invalid_use_of_protected_member
    final layer = renderView.layer;
    if (layer is! OffsetLayer) return null;

    final physicalSize =
        renderView.configuration.toPhysicalSize(renderView.size);
    if (physicalSize.isEmpty) return null;

    final scale = math.min(
      targetWidth / physicalSize.width,
      targetHeight / physicalSize.height,
    );
    if (!scale.isFinite || scale <= 0) return null;

    ui.Image? image;
    try {
      image = await layer.toImage(
        Offset.zero & physicalSize,
        pixelRatio: scale,
      );
      final bytes = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
      if (bytes == null) return null;

      final rgba = bytes.buffer.asUint8List(
        bytes.offsetInBytes,
        bytes.lengthInBytes,
      );
      final expectedBytes = image.width * image.height * 4;
      if (rgba.lengthInBytes != expectedBytes) return null;

      // Copy before disposing the engine image. Some engines expose ByteData
      // backed by image-owned storage.
      return <String, Object?>{
        'width': image.width,
        'height': image.height,
        'rgba': Uint8List.fromList(rgba),
      };
    } finally {
      image?.dispose();
    }
  }
}
