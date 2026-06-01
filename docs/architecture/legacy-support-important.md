# Legacy Support IMPORTANT

This document is for developers changing SDK config, mobile ingest, replay timeline normalization, or capture masking. Mobile app binaries can remain installed for months, so the backend and dashboard must keep accepting old package payloads after a server deploy.

## Non-Negotiable Rule

Do not remove compatibility handling just because the current Swift or React Native package emits a cleaner payload. Old binaries cannot be forced to update, and old sessions may be replayed after the backend/dashboard has changed.

## Current Legacy Surface

Known mobile payloads we must keep supporting:

```json
{ "type": "touch", "gestureType": "tap", "label": "UIView", "x": 100, "y": 120, "touches": [{ "x": 100, "y": 120, "timestamp": 1780000000000 }] }
```

```json
{ "type": "gesture", "gestureType": "rage_tap", "frustrationKind": "rage_tap", "label": "UIButton", "x": 100, "y": 120 }
```

```json
{ "type": "gesture", "gestureType": "dead_tap", "frustrationKind": "dead_tap", "label": "UIView", "x": 100, "y": 120 }
```

Older browser/RN payloads may also use top-level `type: "rage_tap"`, `type: "rage_click"`, `type: "dead_tap"`, or `type: "dead_click"`.

Native packages historically used `label` for the tapped view. Dashboard code now prefers `targetLabel`, but backend and dashboard normalizers must continue copying `label` into `targetLabel`.

## Mobile Frustration Compatibility

The shared backend rules live in [mobileFrustration.ts](/Volumes/devDrive/Dev-mac/rejourney/backend/src/utils/mobileFrustration.ts).

Keep these semantics aligned across ingest and timeline:

- Rage inference for old tap-only streams is `3` nearby taps within `1000 ms` and `50 px`.
- UIKit keyboard taps must not seed rage/dead tap detection.
- Keyboard filtering must stay narrow: match UIKit/system tokens like `UIKeyboard`, `UIInputSet`, `UITextEffects`, and `UIRemoteKeyboard`.
- Do not suppress app UI merely because product copy contains the word `keyboard`.
- Explicit frustration payloads must be counted from `type`, `gestureType`, or `frustrationKind`.
- Do not trust mobile `/session/end` `metrics.rageTapCount` for Swift `0.2.x` / RN `1.2.x`; those clients can include keyboard typing in the aggregate. Use backend-derived event artifact counts for mobile frustration metrics. Treat mobile platform aliases such as `ios`, `android`, `swift`, `expo`, `rn`, `react-native`, `mobile`, and `native` as untrusted for client frustration summaries.

Important limitation: dead taps cannot be reconstructed reliably from old touch-only artifacts after the fact because response/no-response state was only known in the SDK at capture time. The backend can count explicit old `dead_tap` payloads, and new Swift builds emit dead taps more reliably.

## Replay Timeline Compatibility

The timeline loader in [sessions.ts](/Volumes/devDrive/Dev-mac/rejourney/backend/src/routes/sessions.ts) synthesizes `rage_tap` events for old tap-only streams so the replay marker and overlay are visible even when the old SDK did not upload an explicit `rage_tap`.

When changing timeline normalization:

- Preserve `label -> targetLabel`.
- Preserve top-level `x`/`y` as a fallback when `touches` is missing.
- Avoid duplicating synthetic rage markers when an explicit rage marker already exists nearby.
- Bump `SESSION_DETAIL_CACHE_VERSION` when timeline normalization changes.
- Bump the dashboard `SESSION_DETAIL_CACHE_VERSION` when client-side session-detail cache keys need invalidation.

## Remote Config Compatibility

SDK config is returned by `/api/sdk/config` and built in [sdkConfig.ts](/Volumes/devDrive/Dev-mac/rejourney/backend/src/services/sdkConfig.ts).

Defaults are part of the compatibility contract:

- `textInputMasking`: default `all`.
- `imageVideoMasking`: default `none`.
- `recordingFps`: default `1`, clamped to `1...3`.
- `sampleRate`: default `100`, clamped to `0...100`.
- `maxRecordingMinutes`: default `10`, clamped to the supported mobile range.

Older SDKs ignore unknown remote config fields. That is intentional. New fields must default to the least surprising behavior for old users. For image/video masking, that means images and videos remain unmasked unless a supported SDK reads `imageVideoMasking: "all"`.

When adding or changing config fields:

- Update the SDK config cache key version in [sdk.ts](/Volumes/devDrive/Dev-mac/rejourney/backend/src/routes/sdk.ts).
- Delete all active SDK config cache versions from project update/delete paths in [projects.ts](/Volumes/devDrive/Dev-mac/rejourney/backend/src/routes/projects.ts).
- Add or update backend tests in [sdkConfig.test.ts](/Volumes/devDrive/Dev-mac/rejourney/backend/src/__tests__/sdkConfig.test.ts) and project validation tests.
- Confirm Swift/RN decoders tolerate missing fields and unknown fields.

## Capture And Masking Compatibility

Media masking is capture-time behavior. The backend cannot retroactively mask old visual frames.

Current intent:

- Old packages keep their historical behavior.
- New packages read `imageVideoMasking`.
- Default is visible images/videos.
- When masked, placeholders should use the unified mask style rather than plain black.
- Text input masking remains default-on.
- Camera and explicit mask regions remain protected.

## Swift/RN Package Notes

Swift `0.2.x` and React Native `1.2.x` are the package generations this compatibility work was written for. If package versions change, do not delete the old handling until we have deliberately ended support for those deployed binaries.

Swift-specific behavior changed in the package:

- Keyboard-area taps are recorded as normal interactive taps and do not become rage/dead taps.
- Dead tap timers capture each tap's own label/coordinates so a later tap does not erase the pending dead tap.
- Random white-space taps can become dead taps again instead of being suppressed by broad SwiftUI accessibility-element heuristics.

React Native iOS kept the broader accessibility interactivity heuristic because RN touchables/pressables can rely on it.

## Diff Audit Checklist

Before merging backend/dashboard changes that touch these paths:

1. Check `git diff` for changes to SDK config shape, cache keys, ingest event classification, timeline event normalization, and dashboard replay overlay logic.
2. Verify old payloads with `label`, `type: "touch"`, `gestureType: "tap"`, explicit `gestureType: "rage_tap"`, and explicit `gestureType: "dead_tap"` still work.
3. Verify UIKit keyboard labels are ignored for frustration detection, but app labels like `Keyboard shortcuts button` still count normally.
4. Verify config defaults keep old users stable when their app binary ignores new fields.
5. Run focused backend tests:

```bash
npm --prefix backend test -- src/__tests__/ingestEventArtifactProcessor.test.ts src/__tests__/sdkConfig.test.ts src/__tests__/projectValidation.test.ts
```

6. For Swift package changes, run:

```bash
swift build --package-path packages/ios --sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" --triple arm64-apple-ios18.0-simulator
```
