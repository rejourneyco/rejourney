# Rejourney Unity SDK is now available

Rejourney `0.1.0` brings session replay and game observability to Unity mobile games on iOS and Android.

## Highlights

- Session replay of the Unity viewport, with text inputs and marked objects masked on the device
- Performance monitoring: frame pacing, long frames, memory, garbage collection, game-loop hangs and scene loads
- Gameplay markers that keep play out of frustration signals, heatmaps and research exports
- Unhandled exceptions, Unity errors, unobserved task exceptions and native crashes, with the screen they happened on
- Automatic timing for `UnityWebRequest` and `HttpClient`, with no code changes
- Unity 6.3 LTS and 6.6, IL2CPP, iOS 15.1+ and Android API 24+

Install it by downloading `co.rejourney.unity-0.1.0.tgz` below and choosing **Window → Package Manager → + → Install package from tarball**, or add this line to `Packages/manifest.json`:

```json
"co.rejourney.unity": "https://github.com/rejourneyco/rejourney.git?path=/packages/unity#unity-v0.1.0"
```

Then follow the [Unity SDK guide](https://rejourney.co/docs/unity/overview). The `.sha256` file lets you verify the download.
