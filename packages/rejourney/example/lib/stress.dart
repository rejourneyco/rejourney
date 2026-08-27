// Stress screens for manual SDK testing (matrix cases S1-S8).
//
// The capture path is cheap on a plain form and expensive on the screens users
// actually complain about. These exist to exercise the expensive ones: a video
// surface that changes every frame, many decoded images, deep scroll, a dense
// widget tree, and GPU-backed 3D.
//
// Every remote asset here is royalty-free:
//   - Images come from picsum.photos, which serves public-domain photography.
//   - The video is Big Buck Bunny, released by the Blender Foundation under
//     Creative Commons Attribution 3.0.
//
// They are fetched over the network rather than bundled so the example package
// stays small. Each screen degrades to a visible placeholder when offline, so a
// capture test still has something deterministic to record.

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_scene/scene.dart';
import 'package:video_player/video_player.dart';

/// Royalty-free, Creative Commons Attribution 3.0 (Blender Foundation).
const _bigBuckBunny =
    'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

String _photo(int seed, {int w = 400, int h = 300}) =>
    'https://picsum.photos/seed/rejourney$seed/$w/$h';

class StressMenuScreen extends StatelessWidget {
  const StressMenuScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final items = <(String, String, Widget)>[
      ('S4 · Video', 'A surface that changes every frame', const StressVideoScreen()),
      ('S5 · Single image', 'One large decoded image', const StressImageScreen()),
      ('S6 · Image scroll', 'Fling through many decoded images', const StressImageScrollScreen()),
      ('S7 · Dense tree', 'Hundreds of deeply nested widgets', const StressDenseScreen()),
      ('S1-S3 · 3D scene', 'Continuously animating GPU content', const Stress3DScreen()),
    ];
    return Scaffold(
      appBar: AppBar(title: const Text('Stress screens')),
      body: ListView.separated(
        itemCount: items.length,
        separatorBuilder: (_, _) => const Divider(height: 1),
        itemBuilder: (context, i) {
          final (title, subtitle, screen) = items[i];
          return ListTile(
            title: Text(title),
            subtitle: Text(subtitle),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => screen),
            ),
          );
        },
      ),
    );
  }
}

/// S4. A playing video is the hardest case for a screenshot pipeline: the
/// surface changes on every frame, so nothing deduplicates and every capture
/// costs a full readback.
class StressVideoScreen extends StatefulWidget {
  const StressVideoScreen({super.key});

  @override
  State<StressVideoScreen> createState() => _StressVideoScreenState();
}

class _StressVideoScreenState extends State<StressVideoScreen> {
  VideoPlayerController? _controller;
  String? _error;

  @override
  void initState() {
    super.initState();
    final controller =
        VideoPlayerController.networkUrl(Uri.parse(_bigBuckBunny));
    _controller = controller;
    controller.initialize().then((_) {
      if (!mounted) return;
      controller
        ..setLooping(true)
        ..play();
      setState(() {});
    }).catchError((Object e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    });
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return Scaffold(
      appBar: AppBar(title: const Text('S4 · Video')),
      body: Center(
        child: _error != null
            ? _Placeholder(label: 'Video unavailable offline', detail: _error)
            : (controller != null && controller.value.isInitialized)
                ? AspectRatio(
                    aspectRatio: controller.value.aspectRatio,
                    child: VideoPlayer(controller),
                  )
                : const CircularProgressIndicator(),
      ),
    );
  }
}

/// S5. One large image, decoded and held.
class StressImageScreen extends StatelessWidget {
  const StressImageScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('S5 · Single image')),
      body: Center(
        child: Image.network(
          _photo(1, w: 1200, h: 900),
          errorBuilder: (_, _, _) =>
              const _Placeholder(label: 'Image unavailable offline'),
          loadingBuilder: (context, child, progress) =>
              progress == null ? child : const CircularProgressIndicator(),
        ),
      ),
    );
  }
}

/// S6. Scroll depth over many images. Watch `framesSkippedBacklog`: if it
/// climbs, JPEG encoding is not keeping up with capture.
class StressImageScrollScreen extends StatelessWidget {
  const StressImageScrollScreen({super.key});

  static const _count = 60;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('S6 · Image scroll')),
      body: ListView.builder(
        itemCount: _count,
        itemBuilder: (context, i) => Card(
          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                height: 180,
                width: double.infinity,
                child: Image.network(
                  _photo(i + 10),
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => const _Placeholder(
                    label: 'offline',
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(12),
                child: Text('Item ${i + 1} of $_count'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// S7. A deep, wide widget tree. This is the case the hierarchy scanner's depth
/// cap and 16ms budget exist for -- expect `truncated` or `bailout` markers on
/// the captured tree rather than a blocked main thread.
class StressDenseScreen extends StatelessWidget {
  const StressDenseScreen({super.key});

  static const _rows = 40;
  static const _columns = 6;
  static const _nesting = 14;

  Widget _nest(Widget child, int depth) {
    var current = child;
    for (var i = 0; i < depth; i++) {
      current = Padding(
        padding: const EdgeInsets.all(0.5),
        child: DecoratedBox(
          decoration: BoxDecoration(
            border: Border.all(
              color: Colors.deepPurple.withValues(alpha: 0.05),
              width: 0.5,
            ),
          ),
          child: current,
        ),
      );
    }
    return current;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('S7 · Dense tree')),
      body: ListView.builder(
        itemCount: _rows,
        itemBuilder: (context, row) => Row(
          children: List.generate(
            _columns,
            (col) => Expanded(
              child: _nest(
                Container(
                  height: 44,
                  alignment: Alignment.center,
                  color: Color.lerp(
                    Colors.deepPurple.shade50,
                    Colors.teal.shade100,
                    ((row * _columns + col) % 20) / 20,
                  ),
                  child: Text(
                    '$row.$col',
                    style: const TextStyle(fontSize: 9),
                  ),
                ),
                _nesting,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// S1-S3. Continuously animating GPU-backed content.
///
/// This stands in for the map case on Flutter: a scene that repaints every
/// frame while the user interacts, then settles. Drawn with a CustomPainter on
/// the same Impeller surface the SDK reads back, so it exercises the retained
/// layer path without pulling in a native map SDK and its API keys.
class Stress3DScreen extends StatefulWidget {
  const Stress3DScreen({super.key});

  @override
  State<Stress3DScreen> createState() => _Stress3DScreenState();
}

class _Stress3DScreenState extends State<Stress3DScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 8),
  )..repeat();

  bool _animating = true;

  /// Real GPU-backed 3D via flutter_scene. The model is Khronos' BoxTextured
  /// glTF sample, which is public domain. If Flutter GPU is unavailable the
  /// screen falls back to the CPU-drawn wireframe below, so the stress case
  /// still renders something on every device.
  Scene? _scene;
  Object? _sceneError;

  @override
  void initState() {
    super.initState();
    _loadScene();
  }

  Future<void> _loadScene() async {
    try {
      // The base shader bundle is read from an asset, which is asynchronous on
      // every backend. Building geometry before it has loaded throws, so this
      // has to be awaited ahead of the model.
      await Scene.initializeStaticResources();
      final node = await Node.fromGlbAsset('assets/model.glb');
      final scene = Scene()..add(node);
      if (!mounted) return;
      setState(() => _scene = scene);
    } catch (e) {
      debugPrint('[stress] flutter_scene load failed: $e');
      if (!mounted) return;
      setState(() => _sceneError = e);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('S1-S3 · 3D scene')),
      body: Column(
        children: [
          Expanded(
            child: _scene != null
                ? SceneView(_scene!)
                : AnimatedBuilder(
                    animation: _controller,
                    builder: (context, _) => CustomPaint(
                      painter: _RotatingMeshPainter(_controller.value),
                      size: Size.infinite,
                    ),
                  ),
          ),
          if (_sceneError != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                'GPU scene unavailable; showing CPU wireframe fallback.\n'
                '$_sceneError',
                style: const TextStyle(fontSize: 11),
                maxLines: 4,
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: FilledButton.icon(
              onPressed: () {
                setState(() {
                  _animating = !_animating;
                  if (_animating) {
                    _controller.repeat();
                  } else {
                    _controller.stop();
                  }
                });
              },
              icon: Icon(_animating ? Icons.pause : Icons.play_arrow),
              label: Text(_animating ? 'Settle (stop motion)' : 'Animate'),
            ),
          ),
        ],
      ),
    );
  }
}

class _RotatingMeshPainter extends CustomPainter {
  _RotatingMeshPainter(this.t);

  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final centre = Offset(size.width / 2, size.height / 2);
    final radius = math.min(size.width, size.height) * 0.35;
    final angle = t * 2 * math.pi;

    // A wireframe cube projected by hand -- enough geometry to make the GPU
    // work on every frame without depending on an experimental 3D toolchain.
    const verts = <List<double>>[
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    ];
    const edges = <List<int>>[
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];

    Offset project(List<double> v) {
      final x = v[0] * math.cos(angle) - v[2] * math.sin(angle);
      final z = v[0] * math.sin(angle) + v[2] * math.cos(angle);
      final y = v[1] * math.cos(angle * 0.6) - z * math.sin(angle * 0.6);
      final depth = 3 / (3 + z);
      return centre + Offset(x * radius * depth, y * radius * depth);
    }

    for (var layer = 0; layer < 12; layer++) {
      final scale = 1 - layer * 0.06;
      final paint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5
        ..color = Color.lerp(
          Colors.deepPurple,
          Colors.tealAccent,
          layer / 12,
        )!.withValues(alpha: 0.8 - layer * 0.05);
      for (final e in edges) {
        final a = project(verts[e[0]].map((c) => c * scale).toList());
        final b = project(verts[e[1]].map((c) => c * scale).toList());
        canvas.drawLine(a, b, paint);
      }
    }
  }

  @override
  bool shouldRepaint(_RotatingMeshPainter old) => old.t != t;
}

class _Placeholder extends StatelessWidget {
  const _Placeholder({required this.label, this.detail});

  final String label;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      color: Colors.black12,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off),
          const SizedBox(height: 8),
          Text(label),
          if (detail != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                detail!,
                style: const TextStyle(fontSize: 10),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
        ],
      ),
    );
  }
}
