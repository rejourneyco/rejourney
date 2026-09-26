# Architecture and provenance

Unity owns frame composition, redaction, inputs, scenes, managed logs, HTTP
instrumentation, performance sampling, and the game-loop heartbeat. The native
controller owns remote settings, authentication, lifecycle, durable uploads,
retry limits and native crash recovery. Unity adapters disable native view
hierarchy and interaction capture.

Canonical source is `packages/core`. `node scripts/sync-sdk-core.mjs --check`
checks the Swift/Kotlin copies shipped with every SDK, including Unity. External
events are admitted only for their captured session ID and retain their original
epoch timestamp. Runtime metadata overlays the engine-independent device
metadata. Session platform remains ios/android; sdkFamily is unity.

Gameplay state lives in managed code (`GameplayTracker`), independent of the
recording session, and is swapped atomically so the per-touch read takes no
lock. Markers are ordinary events (`type: "gameplay"`), so they travel through
the same queue, spool and upload path as every other event. The backend pairs
them into intervals with the same rules in ingest, the replay and the research
exports (`backend/src/utils/gameplayIntervals.ts`).

A frame archive is gzip of repeated `[u64 big-endian offset from session epoch]
[u32 big-endian JPEG length][JPEG bytes]`. The existing screenshot worker handles
it. Native adapters bundle frames like the other SDKs (three per bundle unless the
cloud sets `screenshotBatchSize`, or when a batch interval elapses), skip byte-identical
consecutive frames, and hand at most two bundles at a time to the shared bounded
32 MB retry spool. Each accepted frame is also written under `rj_pending/<session>/frames`
until its bundle is delivered or durably queued, so crash recovery still uploads
the final seconds. Native upload callbacks distinguish accepted retries from
durable/server-delivery status at drain time.

Unity does not read `link.xml` files inside packages. `RejourneyLinkerProcessor`
hands `Runtime/link.xml` to UnityLinker, and the optional adapter assemblies carry
`AlwaysLinkAssembly`, because nothing references them directly. If the uGUI adapter
is still absent from a player, frames with active uGUI or TMP input fields are dropped.

Research references:
- Sentry Unity integration and native build organization, MIT:
  https://github.com/getsentry/sentry-unity/tree/4935a87758b4d4a22e3d33dee97a612d28050096
- Embrace Unity compiled HTTP instrumentation:
  https://embrace.io/docs/unity/features/log-network-requests/
- Unity screenshot API:
  https://docs.unity3d.com/6000.0/Documentation/ScriptReference/ScreenCapture.CaptureScreenshotIntoRenderTexture.html
- Jahro's in-engine replay experience was an architectural reference only. Its
  source-available license restricts competing derivatives. No Jahro source is
  included or adapted here:
  https://github.com/jahro-console/unity-package/tree/3af613cfc92119af48f8b85368e60bda62d3a59f

SDK adapters and runtime implementation are independent Rejourney code; shared
native files retain their existing Apache-2.0 notices. Unity dependencies retain
their own package licenses.
