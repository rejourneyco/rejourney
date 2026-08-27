# iOS SDK 0.5.0

This release moves the recording core to a single shared source with the React
Native and Flutter SDKs, so a fix now lands on every platform at once instead of
in whichever copy it was written against.

## Changed

- **Identical screenshots are no longer stored.** On measured sessions 93-98% of
  uploaded frames were byte-identical to one already sent, with a single image
  appearing 53 times. The player holds the last frame until the next one, so a
  duplicate rendered exactly the same as its absence while consuming replay
  quota, storage, battery and bandwidth. Expect a large drop in stored frames
  per session with no loss of visual detail.
- Screenshot capture throttles only on a sustained severe stall. The previous
  bar was a single capture over 34ms with recovery requiring half that, which a
  busy screen rarely reached; measured sessions sat at the stretched 4x interval
  for 92-98% of their captures. It now takes three consecutive captures over
  150ms to back off, and any capture inside budget steps the rate back up.
- View hierarchies capture 24 levels rather than 12. Sampled sessions showed 76%
  of trees ending at exactly 12 -- truncation, not depth -- while the 16ms scan
  budget that bounds the cost never fired. Trees cut by the depth limit now
  carry `truncated`, matching the existing `bailout` marker.

- Rage-tap detection now honours remote configuration. Its threshold, window and
  radius were hardcoded in this SDK, so server-side settings were accepted and
  silently ignored. **The shared default window is 500ms, where this SDK
  previously used 1.0s**, which makes rage taps slightly harder to trigger. Send
  `rageTapTimeWindow: 1000` in remote config to keep the previous behaviour.
- Uploads no longer wait for connectivity inside `URLSession`. With
  `waitsForConnectivity` enabled, an offline request parks in memory until the
  network returns, so it never fails, never reaches the on-disk retry queue, and
  is lost outright if the process is killed first. Requests now fail fast and the
  segment is persisted for retry. The request timeout is 15s (inactivity) and the
  resource timeout stays at 60s so large segments still complete on slow links.

## Added

- `collectDeviceInfo`, a remote-config privacy control that omits hardware, OS,
  vendor and network identifiers from telemetry batches when disabled.

## Fixed

- **White boxes no longer appear over map annotations.** Both view scans
  descended into map views and produced redaction rects for annotation subviews.
  A map SDK lays annotations out in its own coordinate space with anchors that
  are not the view's frame origin, so a rect converted out of that hierarchy
  landed beside the thing it meant to cover, and because the sensitive-view pass
  holds a reference and recomputes the rect every frame, the stray box tracked
  the pin as the map was panned. Map tiles and pins are app chrome rather than
  user content, so neither scan descends into a map now. A map a caller does
  want hidden is still honoured through `rejourney_occlude`.
- A leaked heartbeat timer. Starting a session scheduled a new 5-second timer
  without invalidating the previous one, and a run loop retains a scheduled
  timer, so replacing the reference did not stop it. Every session left another
  uploader firing for the life of the process.

## Compatibility

- No breaking API changes. `recordJSErrorEvent` gained optional trailing
  parameters, all defaulted, so existing call sites are unaffected.
- Telemetry payload shape is unchanged: the same keys are sent as in 0.4.1 while
  `collectDeviceInfo` is enabled, which is the default.
- Device fingerprints, stored user identity and cached remote config are all
  preserved across the upgrade.

## Install

```
.package(url: "https://github.com/rejourneyco/rejourney.git", from: "0.5.0")
```
