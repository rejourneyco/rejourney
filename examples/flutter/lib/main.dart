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

const _defaultPublicKey = 'rj_63bf781af9fc20fad303abaa4325eed0';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  RejourneyErrorCapture.install();
  runApp(const ConsumerExampleApp());
}

class ConsumerExampleApp extends StatelessWidget {
  const ConsumerExampleApp({super.key, this.connectNativeSdk = true});

  final bool connectNativeSdk;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Rejourney consumer example',
      debugShowCheckedModeBanner: false,
      navigatorObservers: <NavigatorObserver>[RejourneyNavigatorObserver()],
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2563EB)),
        useMaterial3: true,
      ),
      routes: <String, WidgetBuilder>{
        '/': (_) => ExampleHome(connectNativeSdk: connectNativeSdk),
        '/checkout': (_) => const ExampleCheckout(),
      },
    );
  }
}

class ExampleHome extends StatefulWidget {
  const ExampleHome({super.key, required this.connectNativeSdk});

  final bool connectNativeSdk;

  @override
  State<ExampleHome> createState() => _ExampleHomeState();
}

class _ExampleHomeState extends State<ExampleHome> {
  String _status = 'Preparing native bridge…';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    if (widget.connectNativeSdk) {
      unawaited(_configure());
    } else {
      _status = 'Widget test mode';
    }
  }

  Future<void> _configure() async {
    try {
      await Rejourney.init(
        _publicKey,
        config: RejourneyConfig(
          apiUrl: _apiUrl,
          enabled: _publicKey.isNotEmpty,
          debug: true,
          networkIgnoreUrls: const <String>['example.invalid'],
        ),
      );
      await Rejourney.setMetadata(<String, Object?>{
        'example': 'standalone_flutter',
        'sdkVersion': Rejourney.version,
      });
      final metrics = await Rejourney.getSdkMetrics();
      if (!mounted) return;
      setState(() {
        _status = _publicKey == _defaultPublicKey
            ? 'Native bridge ready · Rejourney example project'
            : 'Native bridge ready · queue ${metrics.currentQueueDepth}';
      });
    } catch (error) {
      if (mounted) setState(() => _status = 'Bridge error: $error');
    }
  }

  Future<void> _start() async {
    setState(() {
      _busy = true;
      _status = 'Starting…';
    });
    try {
      final result = await Rejourney.start();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = result.success
            ? 'Active session ${result.sessionId}'
            : 'Not started: ${result.error ?? 'unknown'}';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = 'Start error: $error';
      });
    }
  }

  Future<void> _emitEvent() async {
    await Rejourney.logEvent('consumer_example_tapped', <String, Object?>{
      'platform': Theme.of(context).platform.name,
      'at': DateTime.now(),
    });
    if (mounted) setState(() => _status = 'Custom event sent to native SDK');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Rejourney Flutter')),
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
                    'Standalone example',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 8),
                  Text(_status, key: const Key('sdk-status')),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            key: const Key('start-session'),
            onPressed: _busy || !widget.connectNativeSdk ? null : _start,
            icon: const Icon(Icons.fiber_manual_record),
            label: const Text('Start consented session'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            key: const Key('emit-event'),
            onPressed: widget.connectNativeSdk ? _emitEvent : null,
            icon: const Icon(Icons.bolt),
            label: const Text('Emit product event'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            key: const Key('open-checkout'),
            onPressed: () => Navigator.of(context).pushNamed('/checkout'),
            icon: const Icon(Icons.lock_outline),
            label: const Text('Open masked checkout'),
          ),
          const SizedBox(height: 28),
          const Text(
            'This app consumes packages/flutter by path, exercises the native '
            'plugin, supplies named navigation, emits typed events, reads SDK '
            'metrics, and masks payment content from replay.',
          ),
        ],
      ),
    );
  }
}

class ExampleCheckout extends StatelessWidget {
  const ExampleCheckout({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Masked checkout')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: <Widget>[
          Text(
            'Sensitive payment region',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 16),
          const RejourneyMask(
            child: Card(
              key: Key('payment-mask'),
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Column(
                  children: <Widget>[
                    TextField(
                      decoration: InputDecoration(labelText: 'Card number'),
                      keyboardType: TextInputType.number,
                    ),
                    SizedBox(height: 12),
                    TextField(
                      decoration: InputDecoration(labelText: 'Security code'),
                      obscureText: true,
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 18),
          FilledButton(
            key: const Key('complete-checkout'),
            onPressed: () async {
              await Rejourney.logEvent('purchase_completed', <String, Object?>{
                'transactionId': 'flutter_example_order',
                'amount': 49.0,
                'currency': 'USD',
              });
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Purchase event recorded')),
                );
              }
            },
            child: const Text('Complete example purchase'),
          ),
        ],
      ),
    );
  }
}
