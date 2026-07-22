# Latest Flutter Dart API benchmark

Measured July 22, 2026 on macOS with Flutter 3.44.4 and Dart 3.12.2. Each operation ran 500 warm-up iterations followed by 20,000 measured iterations in `flutter test` debug/JIT mode.

| Operation | Mean time |
|---|---:|
| Async no-op baseline | 9.85 µs |
| `Rejourney.logEvent` | 19.89 µs |
| `Rejourney.setMetadata` | 17.29 µs |
| `Rejourney.logNetworkRequest` | 30.41 µs |

All 61,501 expected platform-boundary calls were observed. This is a Dart-layer regression benchmark, not an end-to-end capture, rendering, upload, energy, or production-mode measurement. Rerun it on the target release toolchain rather than comparing absolute values across machines.

Machine-readable output:

```json
{"iterations":20000,"unit":"microseconds_per_operation","async_noop":9.8521,"log_event":19.886,"set_metadata":17.28705,"network_marker":30.41455,"platform_calls":61501}
```
