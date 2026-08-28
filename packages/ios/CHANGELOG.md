## 0.5.2

- Prepare the post-rollback corrective release with the same additive capture,
  stability, device-quality, and Beta pause/resume improvements introduced in
  0.5.1.

## 0.5.1

- Add permissionless, callback-driven battery start/end, thermal, memory
  pressure/headroom, UI environment, orientation, and display refresh context.
  Collection adds no polling timer, Android-style permission, or iOS usage key.
- Harden capture-when-idle maps: precise delegate callbacks no longer race a
  fallback debounce, and cleanup preserves delegate hooks installed later by
  the host or another SDK.
- Add the Beta `Rejourney.pause()` / `resume()` API. It suspends capture,
  telemetry intake, live hang work, and network instrumentation without ending
  the foreground session, then records paired gap markers on resume.
- Replace unsafe Swift work in fatal signal handlers with an async-signal-safe
  native marker that is converted to an incident on the next launch.
- Keep crash and MetricKit hang correlation records in Application Support
  rather than purgeable caches, restore pre-existing exception handlers, and
  remove the crash-path sleep.

## 0.5.0

- Identical screenshots are no longer stored. On measured sessions 93-98% of
  uploaded frames were byte-identical to one already sent, one image appearing
  53 times. The player holds the last frame until the next, so a duplicate
  rendered exactly the same as its absence while consuming replay quota,
  storage, battery and bandwidth.
- Screenshot capture now throttles only on a sustained severe stall. The bar
  was one capture over 34ms, which an ordinary screen crosses; recovery
  required half that, which it rarely reached, so sessions sat at the 4x
  interval for 92-98% of their captures. It is now three consecutive captures
  over 150ms, and any capture back inside budget steps the rate back up.
- View hierarchies are captured to 24 levels rather than 12. Sampled sessions
  showed 76% of trees ending at exactly 12 -- truncation, not depth -- while
  the 16ms scan budget that bounds the cost never fired. Trees cut by the depth
  limit now say so, as budget-exhausted ones already did.
- The recording core is now one shared source with the React Native and Flutter
  SDKs rather than a per-SDK copy, so a fix lands on every platform at once.
  CI fails if a vendored copy is edited instead of the original.
- Rage-tap detection now honours remote configuration. Its threshold, window
  and radius were hardcoded, so server-side settings were silently ignored.
  The shared default window is 500ms, where this SDK previously used 1.0s.
- Added the `collectDeviceInfo` privacy control, which omits hardware, OS,
  vendor and network identifiers from telemetry batches when disabled.
- Fixed white boxes drawn over map annotations. Both view scans descended into
  map views and produced redaction rects for annotation subviews, which a map
  SDK lays out in its own coordinate space with anchors that are not the view's
  frame origin, so the rect landed beside what it meant to cover. The
  sensitive-view pass holds a reference and recomputes the rect every frame, so
  the stray box tracked the pin while panning. Neither scan descends into a map
  now; `rejourney_occlude` still hides one on request.
- Fixed a leaked heartbeat timer: starting a new session scheduled another
  5-second timer without invalidating the previous one. A run loop retains a
  scheduled timer, so the old one kept uploading for the life of the process.
- Uploads no longer wait for connectivity inside URLSession. An offline request
  now fails and is persisted to the on-disk retry queue instead of parking in
  memory, where it was lost if the process was killed.

- Sessions now report capture accounting in their end-of-session metrics:
  `framesCaptured`, `framesSkippedDuplicate`, `framesSkippedThrottle`,
  `framesSkippedBacklog` and `framesSkippedMapMoving`. Frame loss was previously
  invisible -- a session that dropped most of its frames looked identical in the
  data to a complete one. Note the ingest metrics schema must accept these keys
  before they are persisted; until then they are sent and discarded.

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
