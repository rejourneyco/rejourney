# The shared recording core

One source of truth for the recording code that the native iOS, React Native,
and Flutter SDKs all run.

## Edit here, never in a package

The files under `packages/core/swift` and `packages/core/kotlin` are the
originals. Every SDK package holds a byte-identical vendored copy:

| Surface | Package | Vendored into |
| --- | --- | --- |
| Swift | Native iOS (SPM) | `packages/ios/Sources/Rejourney` |
| Swift | React Native (npm) | `packages/react-native/ios` |
| Swift | Flutter (pub.dev) | `packages/rejourney/ios/rejourney/Sources/rejourney/Core` |
| Kotlin | React Native (npm) | `packages/react-native/android/src/main/java/com/rejourney` |
| Kotlin | Flutter (pub.dev) | `packages/rejourney/android/src/main/kotlin/com/rejourney` |

After changing anything in `packages/core`:

```bash
node scripts/sync-sdk-core.mjs
```

CI runs `node scripts/sync-sdk-core.mjs --check` and fails if a vendored copy
differs from its original, so editing a copy is caught rather than silently
forked.

> If you edit a vendored copy and then run the sync rather than `--check`, your
> edit is overwritten without a word — the sync copies canonical outwards and
> never reads the copies. Run `--check` first when you are unsure which file you
> touched; it names the offending path. This is easy to do by accident.

### Why copies instead of a shared reference

npm publishes `packages/react-native` and pub.dev publishes `packages/rejourney`.
Neither archive can reference files outside its own package root, so a genuinely
shared directory would have to become a separately published artifact that every
consumer takes as a new dependency. Vendoring keeps distribution exactly as it is
today: consumers see normal source files, and the parity gate supplies the
single-source guarantee that the directory layout cannot.

## Platform differences

Real platform differences belong in that platform's own files. A divergent copy
of a shared file is always a bug.

`VisualCapture` is deliberately **not** shared, in either language. The SDKs
capture frames from genuinely different rendering models — the native and React
Native view trees, and Flutter's single rendering surface, which needs redaction
rects pushed from Dart because there are no native views to find. The measured
divergence is 473 semantic lines in Swift and 992 in Kotlin, and it is real
implementation difference, not drift. Each package owns its copy, and
`sync-sdk-core.mjs` lists it under `platformOwned`.

The core reaches `VisualCapture` only through a 12-member interface
(`beginCapture`, `configure`, `snapshotNow`, `halt`, `flushToDisk`,
`flushBufferToNetwork`, `uploadPendingFrames`/`encodeExecutor`,
`waitForEncodingToComplete`, `invalidateMaskCache`, `registerRedaction`,
`unregisterRedaction`, `captureGeneration`) and shares no types with it. That
seam is what makes the split possible — keep it intact.

`RejourneySdkInfo.kt` is also platform-owned: it is just the version constant,
which differs per published package.

### The React dependency

`ViewHierarchyScanner` used to reach React Native's resource ids at compile time
(`com.facebook.react.R.id.view_tag_native_id`), which Flutter cannot do. The
shared version resolves them by name at runtime instead and caches the result,
including the misses, so an app without React on the classpath does not repeat a
failing lookup for every view of every scan. The core is now React-free at
compile time.

## Decisions worth knowing

- **Rage taps** are remote-configurable on every platform, defaulting to a 500ms
  window. The native SDK previously hardcoded these and ignored remote config.
- **Upload timeouts**: `waitsForConnectivity = false` so an offline request fails
  and reaches the on-disk retry queue instead of parking in memory where it is
  lost if the process dies. Request timeout 15s (inactivity), resource timeout
  60s (whole transfer, kept generous for large segments on slow links).
- **`recordJSErrorEvent`** takes optional framework metadata with defaults, so
  native call sites pass three arguments and React Native and Flutter pass more.
  It is not `@objc`: every caller is Swift, and defaults do not cross the bridge.
- **Timer re-scheduling**: `activate()` invalidates the previous heartbeat first.
  A run loop retains a scheduled timer, and a self-reposting Android `Runnable`
  stays queued, so overwriting the reference alone leaves it firing forever.

## Version symbol

The core reads its version as `RejourneySDKInfo.version` on every platform.
Native and Flutter bake the value in at build time; React Native's is handed down
from the JS package at init, so `packages/react-native/ios/RejourneySDKInfo.swift`
forwards to `RejourneyImpl.sdkVersion` rather than duplicating the constant.

## Access levels

The core is `internal`. Each SDK compiles it into a single module — the React
Native pod globs `ios/**/*.swift` into one pod, so `RejourneyImpl` reaches core
types without them being `public`. Only symbols the Objective-C bridge imports
through `-Swift.h` need `public`, and those live in `RejourneyImpl`.
