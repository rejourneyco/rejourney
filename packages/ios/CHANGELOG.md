## 0.4.1

- Never block the main thread when the app backgrounds: the upload retry drain
  is now fire-and-forget instead of parking the main thread on a utility-QoS
  network queue (priority inversion that froze apps at every backgrounding).
- Screenshot capture now self-throttles: a frame whose main-thread cost exceeds
  the budget stretches the capture interval (up to 4x) and recovers when the
  screen becomes cheap to render again, eliminating visible hitches on blur-
  and glass-heavy screens.

# Changelog

## 0.4.0

- Add stable incident identifiers shared by live telemetry and fault-recovery
  delivery so duplicate crash and ANR transports can be merged reliably.
- Add MetricKit crash and hang diagnostic ingestion, including attributed call
  tree formatting and correlation back to the session that first detected a
  main-thread freeze.
- Mark live watchdog reports without a trustworthy main-thread stack as
  incomplete instead of presenting the SDK watchdog thread as the culprit.
- Preserve decoding of pending crash and ANR records written by earlier SDK
  versions.
- Queue every pending incident and remove only the successfully delivered
  record so batched MetricKit diagnostics cannot overwrite one another.
- Retry persisted crash reports only after the configured API endpoint and
  project key are available, including custom and local endpoints.
- Preserve an uncaught exception's original call stack when the process later
  terminates through `SIGABRT`, instead of replacing it with handler frames.
- Add native coverage for MetricKit call-tree formatting, pending incident
  correlation, and backward-compatible recovery records.

## 0.3.1

- Previous native iOS SDK release.
