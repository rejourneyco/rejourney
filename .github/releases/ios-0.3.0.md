# iOS SDK 0.3.0

## Highlights

- Adds dashboard-controlled image/video masking for the native Swift package. Images and videos remain visible by default; when enabled in Project Settings, supported apps mask media with clear privacy placeholders before frames are captured.
- Improves replay quality for video surfaces by compositing current AVPlayer-backed video frames into the captured replay frame when media masking is off.
- Adds clearer privacy placeholders for protected replay regions, including keyboard, text input, image, video, and manually masked views.
- Improves keyboard handling in replays. Keyboard areas are represented as placeholders, fresh frames are captured after keyboard transitions settle, and keyboard-area taps are treated as normal typing instead of rage/dead taps.
- Keeps masked regions aligned as views move during scrolling, pull-to-refresh, and other animations.
- Cleans up network capture for self-hosted and upload-heavy sessions. Rejourney config, ingest, and presigned upload calls are excluded more reliably while your app's own API traffic remains visible.
- Restores the app startup event for new iOS sessions so startup context appears consistently in session timelines.

## Compatibility

- No breaking API changes.
- Image/video masking is controlled remotely and defaults to `none`, so existing apps keep showing images and videos until the project setting is enabled.
- Older SDK versions ignore the new remote image/video masking field and keep their existing privacy behavior.

## Upgrade

Use the SwiftPM package tag `v0.3.0`:

```swift
.package(url: "https://github.com/rejourneyco/rejourney", from: "0.3.0")
```
