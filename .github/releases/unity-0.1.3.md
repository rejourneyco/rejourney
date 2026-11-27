# Rejourney Unity SDK 0.1.3

Capture and reliability fixes.

- Replays could be upside down, with masks on the wrong rows, on iOS builds that use "Metal Write-Only Backbuffer" with URP, depending on MSAA, HDR, post-processing and camera stacking. Fixed for every combination.
- Tile-Only URP renderers lost a frame and logged an exception at every capture. Fixed.
- Nothing was reported after the project's recording-time limit (10 minutes by default): errors, hangs, frames and crashes were dropped while the SDK still said it was recording. The SDK now starts the next session at once (`ContinueAfterSessionLimit`, on by default).
- iOS: another crash reporter installed before Rejourney (Crashlytics, for example) now receives the original crash signal.
- A game's own end-of-frame screenshot no longer reads the SDK's texture on capture frames.
- On-demand rendering (`OnDemandRendering.renderFrameInterval` above 1) no longer breaks capture.
- Game-loop hang reports no longer count time the process was suspended.

The package changelog has the details.

## Install

Download `co.rejourney.unity-0.1.3.tgz` below and choose **Window → Package Manager → + → Install package from tarball**, or add this line to `Packages/manifest.json`:

```json
"co.rejourney.unity": "https://github.com/rejourneyco/rejourney.git?path=/packages/unity#unity-v0.1.3"
```

Then follow the [Unity SDK guide](https://rejourney.co/docs/unity/overview). The `.sha256` file lets you verify the download.
