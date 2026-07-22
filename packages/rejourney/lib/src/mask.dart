import 'dart:async';

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import '../rejourney.dart';

/// Excludes the child's screen region from every captured replay frame.
///
/// The child remains unchanged for the user. Only the recorded bitmap is
/// covered by a privacy placeholder in the native capture pipeline.
class RejourneyMask extends StatefulWidget {
  const RejourneyMask({
    super.key,
    required this.child,
    this.enabled = true,
  });

  final Widget child;
  final bool enabled;

  @override
  State<RejourneyMask> createState() => _RejourneyMaskState();
}

class _RejourneyMaskState extends State<RejourneyMask> {
  late final String _id = 'flutter_mask_${identityHashCode(this)}';

  @override
  Widget build(BuildContext context) {
    return _MaskRenderObjectWidget(
      id: _id,
      enabled: widget.enabled,
      child: widget.child,
    );
  }
}

class _MaskRenderObjectWidget extends SingleChildRenderObjectWidget {
  const _MaskRenderObjectWidget({
    required this.id,
    required this.enabled,
    required super.child,
  });

  final String id;
  final bool enabled;

  @override
  RenderObject createRenderObject(BuildContext context) {
    return _RenderRejourneyMask(id: id, enabled: enabled);
  }

  @override
  void updateRenderObject(
    BuildContext context,
    _RenderRejourneyMask renderObject,
  ) {
    renderObject
      ..id = id
      ..enabled = enabled;
  }
}

class _RenderRejourneyMask extends RenderProxyBox {
  _RenderRejourneyMask({required String id, required bool enabled})
      : _id = id,
        _enabled = enabled;

  String _id;
  bool _enabled;
  Rect? _lastRect;
  Rect? _reportedRect;
  bool _measurementScheduled = false;
  int _attachmentGeneration = 0;
  int _settleGeneration = 0;
  Timer? _settleTimer;
  bool _initialPrimeActive = false;

  static const Duration _detachSafetyWindow = Duration(seconds: 2);
  static const Duration _movementSafetyWindow = Duration(seconds: 2);
  static const Duration _initialSafetyWindow = Duration(milliseconds: 750);

  set id(String value) {
    if (_id == value) return;
    _cancelSettleTimer();
    unawaited(Rejourney.removeMaskRegion(_id));
    _id = value;
    _lastRect = null;
    _reportedRect = null;
    _initialPrimeActive = false;
    markNeedsPaint();
  }

  set enabled(bool value) {
    if (_enabled == value) return;
    _enabled = value;
    _lastRect = null;
    if (!value) {
      _cancelSettleTimer();
      _reportedRect = null;
      _initialPrimeActive = false;
      unawaited(Rejourney.removeMaskRegion(_id));
    }
    markNeedsPaint();
  }

  @override
  void paint(PaintingContext context, Offset offset) {
    // Register the laid-out bounds before Flutter submits this paint to the
    // surface. A post-frame-only update can arrive after an asynchronous
    // native screenshot has already copied the newly visible pixels.
    _measureAndReport();
    super.paint(context, offset);
    _scheduleMeasurement();
  }

  void _measureAndReport() {
    if (!_enabled || !attached || !hasSize) return;
    final origin = localToGlobal(Offset.zero);
    final rect = origin & size;
    if (!rect.isEmpty && rect != _lastRect) {
      _reportMovingRect(rect);
    }
  }

  void _scheduleMeasurement() {
    if (!_enabled || _measurementScheduled || !attached || !hasSize) return;
    _measurementScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _measurementScheduled = false;
      if (!_enabled || !attached || !hasSize) return;
      _measureAndReport();

      // Route transitions, scrolling, and ancestor transforms can move a
      // retained/repaint-boundary child without repainting this render object.
      // Keep one callback pending so the mask follows the next produced frame
      // even when [paint] itself is not called again. This does not schedule
      // frames and therefore adds no idle animation or polling timer.
      _scheduleMeasurement();
    });
  }

  void _reportMovingRect(Rect rect) {
    _lastRect = rect;

    // Pixel capture and Flutter's transform callbacks are asynchronous. During
    // a route or scroll animation the bitmap can therefore contain either the
    // prior or current position. Keep their union masked until movement has
    // settled so neither side of a sensitive widget can flash into one frame.
    final safeRect = _reportedRect?.expandToInclude(rect) ?? rect;
    if (safeRect != _reportedRect) {
      _reportedRect = safeRect;
      _sendRegion(safeRect);
    }

    _settleTimer?.cancel();
    final settleGeneration = ++_settleGeneration;
    final safetyWindow =
        _initialPrimeActive ? _initialSafetyWindow : _movementSafetyWindow;
    _settleTimer = Timer(safetyWindow, () {
      if (!_enabled ||
          !attached ||
          settleGeneration != _settleGeneration ||
          _lastRect != rect) {
        return;
      }
      _initialPrimeActive = false;
      _reportedRect = rect;
      _sendRegion(rect);
    });
  }

  void _sendRegion(Rect rect) {
    unawaited(
      Rejourney.updateMaskRegion(
        _id,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      ),
    );
  }

  void _cancelSettleTimer() {
    _settleTimer?.cancel();
    _settleTimer = null;
    _settleGeneration += 1;
  }

  @override
  void attach(PipelineOwner owner) {
    super.attach(owner);
    _attachmentGeneration += 1;
    _lastRect = null;
    _primeInitialRegion();
  }

  void _primeInitialRegion() {
    if (!_enabled) return;
    final views = WidgetsBinding.instance.platformDispatcher.views;
    if (views.isEmpty) return;
    final view = views.first;
    final pixelRatio = view.devicePixelRatio;
    if (pixelRatio <= 0 || view.physicalSize.isEmpty) return;

    final logicalSize = view.physicalSize / pixelRatio;
    final fullScreenRect = Offset.zero & logicalSize;
    _initialPrimeActive = true;
    _reportedRect = fullScreenRect;
    _sendRegion(fullScreenRect);
  }

  @override
  void detach() {
    _cancelSettleTimer();
    final generation = ++_attachmentGeneration;
    final detachedId = _id;
    // Flutter can retain the pixels of an outgoing route after this render
    // object detaches. Removing the native mask immediately would expose that
    // cached frame. Keep redaction in place through the transition; a brief
    // stale mask on the destination is safer than leaking sensitive content.
    Future<void>.delayed(_detachSafetyWindow, () {
      if (!attached && generation == _attachmentGeneration) {
        _reportedRect = null;
        _initialPrimeActive = false;
        return Rejourney.removeMaskRegion(detachedId);
      }
    });
    _lastRect = null;
    super.detach();
  }
}
