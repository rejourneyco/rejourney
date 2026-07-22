# Flutter SDK benchmarks

This benchmark measures the Dart-facing work performed before a Flutter platform-channel call: argument validation, supported-value conversion, event/metadata map construction, and network-marker serialization. A replaceable in-process platform implementation removes network and native capture time so results identify regressions in the public Dart layer.

Run it from the repository root:

```bash
cd packages/rejourney
flutter pub get
flutter test benchmark/rejourney_benchmark_test.dart --reporter expanded
```

The runner warms each operation, executes 20,000 iterations, and emits one `REJOURNEY_FLUTTER_BENCHMARK` JSON line. It also applies a deliberately broad 100 µs/operation ceiling to catch severe regressions without treating shared CI hosts as laboratory hardware.

## Interpreting results

- `async_noop` is the local async-loop baseline.
- `log_event` includes nested property conversion and bridge dispatch.
- `set_metadata` includes metadata conversion and bridge dispatch.
- `network_marker` includes request model serialization, SDK-endpoint filtering, event construction, and bridge dispatch.

These numbers do not measure screenshots, compression, disk I/O, uploads, backend latency, application frame rendering, or battery use. Native builds and the on-device integration test are separate release gates. Use a profile build and Flutter DevTools on representative physical devices for app-specific frame, memory, CPU, and energy analysis.

The latest checked-in local result is in [`results/latest.md`](results/latest.md).
