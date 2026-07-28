# Changelog

## 1.4.0

- Add stable incident identifiers shared by telemetry and fault-recovery
  delivery on Android and iOS so duplicate crash and ANR transports can be
  merged reliably.
- Add iOS MetricKit crash and hang diagnostics with attributed call trees and
  correlation of hangs to the session that first detected a main-thread freeze.
- Mark incomplete live iOS watchdog reports accurately instead of presenting
  the SDK watchdog thread as the blocked application thread.
- Preserve pending crash and ANR records created by earlier React Native SDK
  versions.
- Queue every pending native incident on Android and iOS and remove only the
  successfully delivered record so diagnostics cannot overwrite one another.
- Retry persisted iOS crash reports only after the JavaScript-provided API
  endpoint and project key are available, including custom and local endpoints.
- Preserve an uncaught iOS exception's original call stack when the process
  later terminates through `SIGABRT`.
- Preserve Android crash stack frames when a persisted incident is decoded and
  delivered after the next application launch.
- Include error source, exception category, and handled state for manually
  captured and automatically observed JavaScript errors.
- Keep React Native CLI autolinking warning-free on current releases by relying
  on automatic root podspec discovery.

## 1.3.1

- Previous React Native SDK release.
