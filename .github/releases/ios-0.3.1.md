# iOS SDK 0.3.1

## Highlights

- Improves view hierarchy capture fidelity by capturing a hierarchy snapshot for every successfully captured visual frame. Hierarchy timestamps now line up with screenshot frame timestamps, including sessions whose FPS is controlled remotely.
- Improves replay inspection stability by keeping the existing hierarchy depth and time-budget guards while allowing frame-synced snapshots to bypass duplicate suppression.
- Keeps periodic hierarchy capture for screen-change and non-frame cases, while frame-synced captures provide denser replay context when visual recording is enabled.
- Preserves existing visual capture behavior: hierarchy snapshots are only added for frames that are actually captured.

## Compatibility

- No breaking API changes.
- Existing capture settings still control visual recording cadence. When visual frames are skipped, matching frame-synced hierarchy snapshots are skipped too.

## Upgrade

Use the SwiftPM package tag `v0.3.1`:

```swift
.package(url: "https://github.com/rejourneyco/rejourney", from: "0.3.1")
```
