# React Native SDK 1.5.0

Published to npm as `@rejourneyco/react-native@1.5.0`.

This release moves the recording core to a single shared source with the native
iOS and Flutter SDKs. Most of the fixes below are cases where a bug had already
been fixed in one SDK and never reached the copies in the others.

## Changed

- **Identical screenshots are no longer stored.** On measured sessions 93-98% of
  uploaded frames were byte-identical to one already sent. The player holds the
  last frame until the next one, so a duplicate rendered exactly the same as its
  absence while consuming replay quota, storage, battery and bandwidth.
- Screenshot capture throttles only on a sustained severe stall rather than on
  any capture over 34ms.
- View hierarchies capture 24 levels rather than 12, and trees cut by the depth
  limit now say so.
- A view marked for occlusion through React Native's accessibility hint is now
  masked even when that lookup fails. The failure was swallowed and treated as
  "not sensitive", the wrong direction for a privacy check.
- Rage-tap detection now reads its threshold, window and radius from remote
  config, defaulting to a 500ms window.
- The `collectDeviceInfo` remote-config control is now honoured, omitting
  hardware, OS, vendor and network identifiers from telemetry batches when
  disabled. Telemetry payloads are unchanged while it is enabled, which is the
  default.
- View-hierarchy scanning resolves React Native resource ids by name at runtime
  and caches the result, rather than binding them at compile time.

## Fixed

- **White boxes no longer appear over map annotations on iOS.** Both view scans
  descended into map views and produced redaction rects for annotation subviews.
  A map SDK lays annotations out in its own coordinate space with anchors that
  are not the view's frame origin, so a rect converted out of that hierarchy
  landed beside the thing it meant to cover, and because the sensitive-view pass
  holds a reference and recomputes the rect every frame, the stray box tracked
  the pin as the map was panned. Map tiles and pins are app chrome rather than
  user content, so neither scan descends into a map now. A map a caller does
  want hidden is still honoured through `rejourney_occlude`.

- Five OkHttp responses were never closed. Reading only the status code leaves
  the response body open, and an unclosed body holds its connection until the
  pool evicts it, which OkHttp reports as a leaked connection. Three were
  unclosed outright; two were closed only when no exception was thrown.
- Attribute payloads were assembled by interpolating values into a JSON string,
  producing malformed JSON as soon as a key or value contained a quote, a
  backslash or a newline. They now go through `JSONSerialization`.
- Starting a session scheduled a new 5-second heartbeat without cancelling the
  previous one. A self-reposting `Runnable` stays queued on its `Handler` after
  its reference is replaced, so each session left another uploader running for
  the life of the process.
- Manual redaction through an `rj_occlude` accessibility identifier prefix was
  ignored; only the native iOS SDK honoured it.
- Debug configuration logging printed its own interpolation syntax rather than
  the configured values.
- Every buffer flush read and JSON-parsed a metadata file and then discarded
  the result.
- Map scanning repeated unthrottled instead of backing off after the first
  few passes.
- `SessionDelegateAdapter` was missing its `@unchecked Sendable` conformance.

## Compatibility

- No breaking JavaScript or native API changes.
- Telemetry payload shape is unchanged: the same keys are sent as in 1.4.1.
- Device fingerprints are preserved. The SHA-256 helper moved from CommonCrypto
  to CryptoKit and was verified to produce byte-identical output.
- Records written by earlier versions remain readable.

## Upgrade

```bash
npm install @rejourneyco/react-native@1.5.0
```
