## 1.5.1

- Capture Apple Maps, Google Maps, and Mapbox on the next main-loop turn after
  confirmed idle instead of waiting an additional second. After a real map
  gesture, retry once after a 350 ms renderer-settle window and perform one
  final verification capture at two seconds of quiet time. Movement is tracked
  throughout pans and pinches; renewed movement cancels pending retries, and
  unchanged output is removed by frame deduplication.
- Fix a narrow iOS timing race where a new map gesture could begin while an old
  verification or retry capture timer was still queued, which could delay or
  miss near-immediate post-move map frames. The new logic now always cancels
  those pending map timers at gesture start/change before re-arming capture.
- Keep suppressing map readback only while the camera is actually moving. A map
  screen is mostly not map -- sheets, search results, callouts, overlays -- so
  capture resumes at the normal cadence the moment the camera settles, and an
  explicitly requested frame (session start, a high-importance visual change, a
  screen change, resume) is never dropped, even mid-gesture.
- Hook each map delegate callback independently instead of requiring a host
  delegate to own both sides of the motion lifecycle. A Google Maps host that
  implements `mapView:idleAtCameraPosition:` without `mapView:willMove:` keeps
  its idle signal, and the gesture observer still covers the missing half. A
  callback is no longer discarded when a second map view is mounted behind the
  visible one.
- Add permissionless, callback-driven battery start/end, thermal, memory
  pressure/headroom, UI environment, orientation, and display refresh context,
  with no new Android manifest permission or iOS usage-description key.
- Keep the capture-when-idle map strategy while removing Mapbox's synchronous
  Android snapshot readback, confirming camera stability after fling, finding
  deeper wrappers, bounding stalled/failed snapshot retries, ignoring touches
  outside the map, and preserving later iOS delegate hooks during cleanup.
- Add Beta `Rejourney.pause()` / `resume()` plus standalone aliases across both
  architectures and platforms, with paired timeline gap markers and no new
  Android manifest or iOS Info.plist requirements.
- Use Android 11+ historical process-exit reasons to recover system-classified
  ANRs, Java crashes, and native crashes that an in-process watchdog cannot see.
- Post Android watchdog probes through an asynchronous main-thread handler so
  display-vsync synchronization barriers cannot be misreported as five-second
  ANRs. Genuine stalls now include the main thread's observed state instead of
  always being labeled `blocked`.
- Replace unsafe iOS signal-handler work with a next-launch native marker and
  move pending fault records out of purgeable caches.
- Stop delaying the pre-existing React Native fatal handler by 1.2 seconds,
  preserve handlers installed after Rejourney, and remove JS/network hooks while
  Beta-paused.

## 1.5.0

- Identical screenshots are no longer stored. On measured sessions 93-98% of
  uploaded frames were byte-identical to one already sent. The player holds the
  last frame until the next, so a duplicate rendered exactly the same as its
  absence while consuming replay quota, storage, battery and bandwidth.
- Screenshot capture now throttles only on a sustained severe stall, rather than
  on any capture over 34ms with a recovery bar it rarely cleared.
- View hierarchies are captured to 24 levels rather than 12, and trees cut by
  the depth limit now say so.
- A view marked for occlusion through React Native's accessibility hint is now
  masked even if that lookup fails. The failure was swallowed and treated as
  "not sensitive", which is the wrong direction for a privacy check.
- The Android and iOS recording cores are now one shared source rather than
  per-SDK copies, so a fix lands on every platform at once. CI fails if a
  vendored copy is edited instead of the original.
- Fixed five OkHttp responses that were never closed. Reading only the status
  code leaves the body open, and an unclosed body holds its connection until
  the pool evicts it.
- Fixed attribute payloads being built by string interpolation, which produced
  malformed JSON whenever a key or value contained a quote, a backslash or a
  newline. They now go through JSONSerialization.
- Fixed white boxes drawn over map annotations on iOS. Both view scans descended
  into map views and produced redaction rects for annotation subviews, which a
  map SDK lays out in its own coordinate space with anchors that are not the
  view's frame origin, so the rect landed beside what it meant to cover. The
  sensitive-view pass holds a reference and recomputes the rect every frame, so
  the stray box tracked the pin while panning. Neither scan descends into a map
  now; `rejourney_occlude` still hides one on request.
- Fixed a leaked heartbeat timer: starting a new session scheduled another
  5-second timer without cancelling the previous one, so every session added
  another uploader that ran for the life of the process.
- Manual redaction through an `rj_occlude` accessibility identifier now works;
  it was previously honoured only by the native iOS SDK.
- Debug configuration logging printed its own interpolation syntax instead of
  the values.
- Removed a per-call read and JSON parse of a metadata file whose result was
  discarded.
- Map scanning is throttled after the first few passes rather than rescanning
  unthrottled.
- Rage-tap detection reads its threshold, window and radius from remote config,
  defaulting to a 500ms window.

- Sessions now report capture accounting in their end-of-session metrics:
  `framesCaptured`, `framesSkippedDuplicate`, `framesSkippedThrottle`,
  `framesSkippedBacklog` and `framesSkippedMapMoving`. Frame loss was previously
  invisible -- a session that dropped most of its frames looked identical in the
  data to a complete one. Note the ingest metrics schema must accept these keys
  before they are persisted; until then they are sent and discarded.

## 1.4.1

- Android: JPEG compression moves off the main thread onto the encode executor
  (it ran on main during every capture), and the same adaptive capture throttle
  now applies. The retry drain on Android was already asynchronous.
- Never block the main thread when the app backgrounds: the upload retry drain
  is now fire-and-forget instead of parking the main thread on a utility-QoS
  network queue (priority inversion that froze apps at every backgrounding,
  including tapping outbound links).
- Screenshot capture now self-throttles: a frame whose main-thread cost exceeds
  the 34ms budget stretches the capture interval (up to 4x) and recovers when
  the screen becomes cheap to render again, eliminating visible hitches on
  blur- and glass-heavy screens (iOS 26 Liquid Glass).
- Capture also skips ticks while the JPEG encode queue is backlogged, so a slow
  device can never accumulate memory or main-thread pressure from the recorder.

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
