import 'dart:async';

import 'package:flutter/material.dart';
import 'package:rejourney/rejourney.dart';

const _publicKey = String.fromEnvironment(
  'REJOURNEY_PUBLIC_KEY',
  defaultValue: 'rj_63bf781af9fc20fad303abaa4325eed0',
);
const _apiUrl = String.fromEnvironment(
  'REJOURNEY_API_URL',
  defaultValue: 'https://api.rejourney.co',
);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  RejourneyErrorCapture.install();
  runApp(const RejourneyExampleApp());
}

class RejourneyExampleApp extends StatelessWidget {
  const RejourneyExampleApp({super.key, this.initializeSdk = true});

  final bool initializeSdk;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Rejourney Flutter',
      debugShowCheckedModeBanner: false,
      navigatorObservers: <NavigatorObserver>[RejourneyNavigatorObserver()],
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF4F46E5),
          brightness: Brightness.light,
        ),
        useMaterial3: true,
      ),
      routes: <String, WidgetBuilder>{
        '/': (_) => DemoHome(initializeSdk: initializeSdk),
        '/checkout': (_) => const CheckoutPage(),
      },
    );
  }
}

class DemoHome extends StatefulWidget {
  const DemoHome({super.key, required this.initializeSdk});

  final bool initializeSdk;

  @override
  State<DemoHome> createState() => _DemoHomeState();
}

class _DemoHomeState extends State<DemoHome> {
  String _status = 'Ready';
  String? _sessionId;
  bool _busy = false;
  StreamSubscription<Map<String, Object?>>? _nativeEventSubscription;

  @override
  void initState() {
    super.initState();
    _nativeEventSubscription = Rejourney.nativeEvents.listen(
      _handleNativeEvent,
    );
    if (widget.initializeSdk) {
      unawaited(_initialize());
    }
  }

  @override
  void dispose() {
    unawaited(_nativeEventSubscription?.cancel());
    super.dispose();
  }

  void _handleNativeEvent(Map<String, Object?> event) {
    if (event['type'] != 'sessionRolledOver') return;
    final nextSessionId = event['sessionId'] as String?;
    if (!mounted || nextSessionId == null || nextSessionId.isEmpty) return;
    setState(() {
      _sessionId = nextSessionId;
      _status = 'Recording active · session rolled over';
    });
  }

  Future<void> _initialize() async {
    try {
      await Rejourney.init(
        _publicKey,
        config: const RejourneyConfig(
          apiUrl: _apiUrl,
          debug: true,
          networkIgnoreUrls: <String>['example.invalid'],
        ),
      );
      await Rejourney.setUserIdentity('flutter_example_tester');
      await Rejourney.setMetadata(<String, Object?>{
        'example': 'package_flutter',
        'sdkVersion': Rejourney.version,
        'validation': true,
      });
      if (mounted) setState(() => _status = 'SDK initialized');
    } catch (error) {
      if (mounted) setState(() => _status = 'Setup failed: $error');
    }
  }

  Future<void> _start() async {
    setState(() {
      _busy = true;
      _status = 'Starting recording…';
    });
    try {
      final started = await Rejourney.start();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _sessionId = started.sessionId;
        _status = started.success
            ? started.telemetryOnly
                  ? 'Telemetry session active'
                  : 'Recording active'
            : 'Not started: ${started.error ?? 'unknown reason'}';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = 'Start failed: $error';
      });
    }
  }

  Future<void> _stop() async {
    setState(() {
      _busy = true;
      _status = 'Flushing session…';
    });
    final stopped = await Rejourney.stop();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _sessionId = null;
      _status = stopped.uploadSuccess
          ? 'Session stopped and flushed'
          : 'Session stopped; upload queued';
    });
  }

  Future<void> _trackEvent() async {
    await Rejourney.logEvent('example_cta_tapped', <String, Object?>{
      'source': 'flutter_example',
      'timestamp': DateTime.now(),
    });
    await Rejourney.addSessionTag('flutter_example_validation');
    await Rejourney.markVisualChange(
      'example_event_suite',
      importance: RejourneyVisualImportance.high,
    );
    await Rejourney.onScroll(120);
    await Rejourney.onOAuthStarted('example_provider');
    await Rejourney.onOAuthCompleted('example_provider', success: true);
    await Rejourney.onExternalUrlOpened('rejourney-example');
    await Rejourney.logNetworkRequest(
      RejourneyNetworkRequest(
        requestId: 'flutter-example-${DateTime.now().microsecondsSinceEpoch}',
        method: 'GET',
        url: 'https://example.com/flutter-validation',
        statusCode: 200,
        duration: const Duration(milliseconds: 42),
        responseBodySize: 128,
        responseContentType: 'application/json',
      ),
    );
    await Rejourney.logFeedback(5, 'Flutter example validation');
    final metrics = await Rejourney.getSdkMetrics();
    if (mounted) {
      setState(
        () => _status =
            'SDK event suite recorded · queue ${metrics.currentQueueDepth}',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Rejourney Flutter'),
        actions: const <Widget>[
          Padding(
            padding: EdgeInsets.only(right: 16),
            child: Chip(label: Text('Example')),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: <Widget>[
          Card(
            color: Theme.of(context).colorScheme.primaryContainer,
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    _status,
                    key: const Key('status-text'),
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _sessionId == null
                        ? 'No active session'
                        : 'Session: $_sessionId',
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            key: const Key('start-recording'),
            onPressed: _busy ? null : _start,
            icon: const Icon(Icons.fiber_manual_record),
            label: const Text('Start recording'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            key: const Key('stop-recording'),
            onPressed: _busy ? null : _stop,
            icon: const Icon(Icons.stop_circle_outlined),
            label: const Text('Stop and flush'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            key: const Key('track-event'),
            onPressed: _trackEvent,
            icon: const Icon(Icons.bolt),
            label: const Text('Track custom event'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            key: const Key('open-checkout'),
            onPressed: () => Navigator.of(context).pushNamed('/checkout'),
            icon: const Icon(Icons.shopping_bag_outlined),
            label: const Text('Open checkout demo'),
          ),
          const SizedBox(height: 28),
          Text(
            'Covered by this example',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          const Text(
            'Navigation tracking, user identity, custom events, metadata, '
            'network markers, error capture, lifecycle rollover, and '
            'capture-only privacy masking.',
          ),
        ],
      ),
    );
  }
}

class CheckoutPage extends StatelessWidget {
  const CheckoutPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: <Widget>[
          Text(
            'Payment details',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 16),
          const RejourneyMask(
            child: Card(
              key: Key('masked-payment-card'),
              child: ListTile(
                leading: Icon(Icons.credit_card),
                title: Text('4242 4242 4242 4242'),
                subtitle: Text('12/30 · 123'),
              ),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton(
            key: const Key('complete-purchase'),
            onPressed: () async {
              await Rejourney.logEvent('purchase_completed', <String, Object?>{
                'transactionId': 'example_transaction',
                'amount': 49,
                'currency': 'USD',
              });
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Purchase event recorded')),
                );
              }
            },
            child: const Text('Complete purchase'),
          ),
        ],
      ),
    );
  }
}
