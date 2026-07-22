import 'dart:async';

import 'package:flutter/widgets.dart';

import '../rejourney.dart';

typedef RejourneyRouteNameResolver = String? Function(Route<dynamic> route);

/// A Navigator observer that records Flutter route changes automatically.
///
/// Add the same observer instance to `MaterialApp.navigatorObservers`.
final class RejourneyNavigatorObserver extends NavigatorObserver {
  RejourneyNavigatorObserver({this.routeNameResolver});

  final RejourneyRouteNameResolver? routeNameResolver;
  String? _lastScreen;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPush(route, previousRoute);
    _record(route);
  }

  @override
  void didReplace({
    Route<dynamic>? newRoute,
    Route<dynamic>? oldRoute,
  }) {
    super.didReplace(newRoute: newRoute, oldRoute: oldRoute);
    if (newRoute != null) _record(newRoute);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPop(route, previousRoute);
    if (previousRoute != null) _record(previousRoute);
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didRemove(route, previousRoute);
    if (previousRoute != null) _record(previousRoute);
  }

  void _record(Route<dynamic> route) {
    if (!route.isActive) return;
    final resolved = routeNameResolver?.call(route);
    final settingsName = route.settings.name;
    final name = resolved?.trim().isNotEmpty == true
        ? resolved!.trim()
        : settingsName?.trim().isNotEmpty == true
            ? settingsName!.trim()
            : route.runtimeType.toString();
    if (name == _lastScreen) return;
    _lastScreen = name;
    unawaited(Rejourney.trackScreen(name));
  }
}
