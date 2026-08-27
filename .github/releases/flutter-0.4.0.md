## Flutter SDK 0.4.0

This release moves the recording core to a single shared source with the native
iOS and React Native SDKs, so a fix now lands on every platform at once instead
of in whichever copy it was written against.

### Changed

- **Identical screenshots are no longer stored.** On measured sessions 93-98% of
  uploaded frames were byte-identical to one already sent. The player holds the
  last frame until the next one, so a duplicate rendered exactly the same as its
  absence while consuming replay quota, storage, battery and bandwidth.
- **Android retained-layer capture is paced for the viewer.** The interactive
  minimum drops from 5s to 1.5s and the settle window from 2.5s to 600ms, and a
  deferral ceiling stops continuous interaction from starving capture: every new
  visual change used to push the settle window forward, so the most active part
  of a session was the least recorded. Measured on an emulator, median frame
  interval went from 4.3s to 1.0s and the worst gap from 38.6s to 3.0s. The idle
  heartbeat stays at 15s.
- Screenshot capture throttles only on a sustained severe stall.
- View hierarchies capture 24 levels rather than 12, and trees cut by the depth
  limit now say so.
- A view marked for occlusion through the accessibility hint is masked even when
  that lookup fails.

- The Android plugin classes moved from `co.rejourney.rejourney` to
  `com.rejourney`, where the rest of the plugin already lived. Flutter
  regenerates the plugin registrant on every build, so applications need no
  changes. If you hand-wrote a ProGuard rule keeping `co.rejourney.**`, it is
  now stale and can be removed; the plugin ships its own rules.
- Rage-tap detection reads its threshold, window and radius from remote config
  on every platform, defaulting to a 500ms window.

### Added

- Consumer ProGuard rules for the Android plugin, which previously shipped none
  while the same reflection-based Google Maps and Mapbox integration was kept by
  rules on the React Native side.

### Fixed

- **White boxes no longer appear over map annotations on iOS.** Both view scans
  descended into map views and produced redaction rects for annotation subviews.
  A map SDK lays annotations out in its own coordinate space with anchors that
  are not the view's frame origin, so a rect converted out of that hierarchy
  landed beside the thing it meant to cover, and because the sensitive-view pass
  holds a reference and recomputes the rect every frame, the stray box tracked
  the pin as the map was panned. Map tiles and pins are app chrome rather than
  user content, so neither scan descends into a map now. A map a caller does
  want hidden is still honoured through `rejourney_occlude`.
- A leaked heartbeat timer. Starting a session scheduled a new 5-second timer
  without cancelling the previous one, and a self-reposting `Runnable` stays
  queued on its `Handler` after its reference is replaced, so every session left
  another uploader running for the life of the process.
- View-hierarchy scanning resolved React Native resource ids by name for every
  view of every scan. On a Flutter application those lookups always fail, so the
  work was repeated and always wasted. The result is now resolved once and
  cached, including the misses.

### Compatibility

- No breaking Dart or native API changes.
- Telemetry payload shape is unchanged.
- Stored device identity, user identity and incident records written by earlier
  versions remain readable.

### Validation

- Dart and Flutter unit tests.
- Android native bridge unit tests.
- iOS simulator build for the package and example.
- Shared-core parity check across all SDK packages.

### Upgrade

```bash
flutter pub add rejourney:^0.4.0
```
