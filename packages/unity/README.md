# Rejourney for Unity

Session replay and telemetry for Unity mobile games. The initial SDK targets
Unity 6.3 LTS and 6.6, IL2CPP, iOS 15.1+, and Android API 24+.

Install the `.tgz` from the [GitHub release](https://github.com/rejourneyco/rejourney/releases/tag/unity-v0.1.0)
with **Window → Package Manager → Install package from tarball**, or select this
directory's `package.json` for local development.
Native artifacts must be built before using a source checkout in a player build.

```csharp
using RejourneySDK;

Rejourney.Init("YOUR_CLOUD_PUBLIC_PROJECT_KEY", new RejourneyOptions());
// After the player has consented:
var result = await Rejourney.StartAsync();
Rejourney.SetUserIdentity("synthetic-player");
Rejourney.TrackScreen("Arena");
Rejourney.StartGameplay("level_3");          // play begins
Rejourney.EndGameplay(GameplayOutcome.Completed); // play ends
Rejourney.LogEvent("level_completed");
```

Gameplay markers let the replay, frustration analytics and research exports tell
game input from interface use: taps during play never count as rage or dead taps
and are left out of heatmaps.

Performance monitoring is automatic. Every 5 seconds the SDK samples frame pacing
(FPS, p50/p95/maximum frame time, long frames), managed and Unity memory, and garbage
collections. It also reports game-loop hangs, and records scene load times with
`using (Rejourney.BeginSceneLoad("Shop"))`. The replay's Unity panel charts frame times
and seeks to the slowest moment.

Errors and crashes are captured automatically: unhandled exceptions, `Debug.LogError`,
failed assertions, unobserved task exceptions, and native crashes, which upload when
the game next starts a session. Report exceptions the game catches with
`Rejourney.CaptureException(exception)`.

`Init` does not start recording. Always inspect the start result. The Editor runs
integration diagnostics only; test recording in an iOS or Android player, on a
simulator or a device.

See [integration](Documentation~/integration.md), [architecture](Documentation~/architecture.md),
and [verification](Documentation~/verification.md). The full diagnostic
game lives in the repository's `examples/unity` directory.
