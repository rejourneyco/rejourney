# React Native SDK 1.3.1

Published to npm as `@rejourneyco/react-native@1.3.1`.

## Highlights

- Improves view hierarchy capture fidelity by capturing a hierarchy snapshot for every successfully captured visual frame on iOS and Android. Hierarchy timestamps now line up with screenshot frame timestamps, including sessions whose FPS is controlled remotely.
- Improves replay inspection stability by keeping the existing hierarchy depth and time-budget guards while allowing frame-synced snapshots to bypass duplicate suppression.
- Reduces noisy development logging by removing the automatic upload stats poll that printed frequent `Upload Stats` lines during active recordings. Upload behavior and the manual `getSDKMetrics()` API are unchanged.
- Keeps periodic hierarchy capture for screen-change and non-frame cases, while frame-synced captures provide denser replay context when visual recording is enabled.

## Compatibility

- No breaking API changes.
- Existing capture settings still control visual recording cadence. When visual frames are skipped, matching frame-synced hierarchy snapshots are skipped too.
- Applications that rely on `getSDKMetrics()` can continue calling it manually.

## Upgrade

```bash
npm install @rejourneyco/react-native@1.3.1
```
