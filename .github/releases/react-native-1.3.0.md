# React Native SDK 1.3.0

Published to npm as `@rejourneyco/react-native@1.3.0`.

## Highlights

- Adds dashboard-controlled image/video masking for React Native apps. Images and videos remain visible by default; when enabled in Project Settings, supported iOS and Android apps mask media with clear privacy placeholders before frames are captured.
- Improves replay quality for media-heavy screens. iOS now composites current video frames from AVPlayer-backed views, and Android adds SurfaceView video capture support alongside TextureView capture, reducing black boxes in debugging replays when media masking is off.
- Adds clearer replay placeholders for protected content. Camera, keyboard, text input, image, video, and explicit mask regions now use the same white privacy treatment with type-specific labels or icons where space allows.
- Improves keyboard behavior in mobile replays. Keyboard areas are represented as placeholders, fresh frames are captured after keyboard transitions settle, and keyboard taps no longer appear as rage/dead taps while users are typing.
- Improves touch and device coordinate metadata so taps, overlays, and screen dimensions line up more consistently across iOS points, Android dp, and physical pixels.
- Cleans up network capture for self-hosted and upload-heavy sessions. Rejourney config, ingest, and presigned upload calls are excluded more reliably while your app's own API traffic remains visible.

## Compatibility

- No breaking API changes.
- Image/video masking is controlled remotely and defaults to `none`, so existing apps keep showing images and videos until the project setting is enabled.
- Older SDKs ignore the new remote image/video masking field and keep their existing privacy behavior.

## Upgrade

```bash
npm install @rejourneyco/react-native@1.3.0
```
