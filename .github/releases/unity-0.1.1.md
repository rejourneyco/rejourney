# Rejourney Unity SDK 0.1.1

A fix for iOS games that enable **Metal Write-Only Backbuffer**.

## Fixed

- Session replays are no longer black on iOS devices when Player Settings → iOS → **Metal Write-Only Backbuffer** is on. That setting makes the screen unreadable on device (the iOS simulator ignores it), so replay frames came through black. URP projects now capture inside the render pipeline in that case, including Screen Space - Overlay UI, so the setting can stay on.
- Built-in render pipeline projects with that setting skip frames instead of uploading black ones, and the iOS build prints a warning explaining how to fix it.

Every other build captures exactly as in 0.1.0. `Rejourney.Health.CaptureSource` reports the active path (`screen`, `urp` or `unreadable`).

## Install

Download `co.rejourney.unity-0.1.1.tgz` below and choose **Window → Package Manager → + → Install package from tarball**, or add this line to `Packages/manifest.json`:

```json
"co.rejourney.unity": "https://github.com/rejourneyco/rejourney.git?path=/packages/unity#unity-v0.1.1"
```

Then follow the [Unity SDK guide](https://rejourney.co/docs/unity/overview). The `.sha256` file lets you verify the download.
