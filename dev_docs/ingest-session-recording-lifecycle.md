# Ingest + Session Recording Lifecycle (Visual)

Last updated: 2026-04-05

This doc is the ingest/runtime view: package start, upload lanes, relay, worker reconciliation, Redis, and Postgres.

Deploy topology (which process runs where) lives in [All things cloud](/Users/mora/Desktop/Dev-mac/rejourney/dev_docs/allthingscloud.md). Deploy, `db-setup`, GitHub Actions, and local parity are in [Rejourney CI + Deploy Path](/Users/mora/Desktop/Dev-mac/rejourney/dev_docs/rejourney-ci.md).

Shortest correct mental model:

- The package usually creates a client-side `session_{timestamp}_{uuid}` ID and uploads under that ID.
- Postgres is the source of truth for session lifecycle, artifact lifecycle, metrics, jobs, and usage.
- Redis is the runtime helper plane for cache, idempotency, and limit coordination.
- A replay becomes visible when at least one screenshot artifact reaches `ready`.
- A session is finalized by **`reconcileSessionState()`** (driven by artifact workers after jobs complete and by the **session-lifecycle worker** sweep), not just by calling `/session/end`.
- After a session is **closed to ingest** (see [I8]), the API rejects new presigns, relay `PUT` uploads to S3, fault ingestion, and mutating duplicate `/session/end` calls so Postgres + object storage for that session are not altered by late clients.

## Flow Index

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [I1] Package Start / Rollover                                               │
│ [I2] Upload Lanes / Session Creation                                        │
│ [I3] Upload Relay / Artifact + lifecycle workers / Artifact States            │
│ [I4] Reconciliation / Auto-Finalizer / endedAt Math                         │
│ [I5] Redis vs Postgres Ownership                                            │
│ [I6] Quick Answers / Constants                                              │
│ [I7] Archive list duration + read model (dashboard)                         │
│ [I8] Closed-session immutability (ingest + relay)                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

## [I1] Package Start / Rollover

```text
┌──────────────┐      GET /api/sdk/config       ┌─────────────────────────────┐
│ JS SDK       │───────────────────────────────▶│ SDK config route            │
│ public key   │◀───────────────────────────────│ recording/sample/max config │
└──────┬───────┘                                │ Redis may cache sdk:config:*│
       │                                        └──────────────┬──────────────┘
       │ sampled in?                                          │
       ▼                                                      ▼
┌──────────────┐     POST /ingest/auth/device    ┌────────────────────────────┐
│ Native layer │───────────────────────────────▶│ device auth route          │
│ startSession │◀───────────────────────────────│ x-upload-token credential  │
└──────┬───────┘                                └──────────────┬─────────────┘
       │
       │ create session_{timestamp}_{uuid}
       │ start replay capture + event pipeline + visual capture
       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ First /presign or /segment/presign starts uploading under that session ID   │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Package rollover / stop rules                                               │
│                                                                              │
│ Active -> background < 60s       : keep same session                        │
│ Active -> background >= 60s      : end old session, then start a new one    │
│ Active -> user stop              : flush and close                          │
│ Active -> duration limit reached : flush and close                          │
│ Process death / next launch      : recovery checkpoint can finalize old one │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
Background rollover threshold      60s
Rollover grace window               2s
Event heartbeat flush               5s
Max recording duration              backend-configured, clamped server-side
                                    to 1..10 minutes
```

### iOS: multitasking and force-quit (no guaranteed `/session/end`)

A common user path is: swipe up to the **app switcher**, then swipe the app away to **force-quit** it (fully terminate the process, not merely leaving it in the background). On that path the OS has usually **already delivered** `UIApplication.didEnterBackgroundNotification`. The app becomes **suspended**; the later swipe **kills the process** with **no reliable opportunity** to run teardown code.

**Why `/api/ingest/session/end` and `explicit_ended_at` may be missing**

- After background, the native layer typically **pauses** the session and flushes best-effort; it does not treat every background as an immediate session end (see the rollover rules above).
- **`UIApplication.willTerminateNotification`** (and `applicationWillTerminate:`) is **not guaranteed** when the user force-quits from the switcher, especially if the app **was already backgrounded/suspended**. The iOS package observes `willTerminate` in [`RejourneyImpl.swift`](/Users/mora/Desktop/Dev-mac/rejourney/packages/react-native/ios/Engine/RejourneyImpl.swift) for final flush, but that notification **often never fires** in this scenario.
- The client may therefore **never** emit a final end signal; Postgres may lack **`explicit_ended_at`** for that closure until **server-side reconciliation** infers completion (idle window, artifacts, etc.—see [I4]).

**Expectations**

- This is **normal iOS platform behavior** (the system may terminate a suspended app without running `willTerminate`), not a defect in “failure to detect kill.”
- Ingest design treats **`reconcileSessionState()`** as the authority for when a row is done; explicit `/session/end` is a strong hint when present, not a prerequisite for every real-world exit.

**Optional tightening (still best-effort)**

- On `didEnterBackground`, a **`beginBackgroundTask`**-bounded flush can improve the odds of shipping pending bytes before suspension; iOS still grants **limited time** and may kill the app without further callbacks. Nothing on the client can **promise** `explicit_ended_at` for every force-quit.


The SAME THING WITH ANDROID but with android we detect background in different ways according to OEMs which means we need more background tests on different devices in simulator (TODO. So far we only tested pixel devices).

Package-side rules that matter downstream:

- In the normal React Native flow, the session ID is generated on-device.
- There is still a backend fallback for `/api/ingest/presign` without a `sessionId`; it now mints the same shaped ID family: `session_{timestamp}_{randomHex}`.
- The timestamp embedded in the session ID is later used by the backend to infer `started_at`.
- JS fetches [`/api/sdk/config`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/sdk.ts) before start and can disable replay before any visual upload happens.
- Native obtains the upload credential from [`/api/ingest/auth/device`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestDeviceAuth.ts) and sends it as `x-upload-token`.

Relevant package files:

- [`packages/react-native/src/index.ts`](/Users/mora/Desktop/Dev-mac/rejourney/packages/react-native/src/index.ts)
- [`packages/react-native/android/src/main/java/com/rejourney/recording/ReplayOrchestrator.kt`](/Users/mora/Desktop/Dev-mac/rejourney/packages/react-native/android/src/main/java/com/rejourney/recording/ReplayOrchestrator.kt)
- [`packages/react-native/android/src/main/java/com/rejourney/recording/TelemetryPipeline.kt`](/Users/mora/Desktop/Dev-mac/rejourney/packages/react-native/android/src/main/java/com/rejourney/recording/TelemetryPipeline.kt)
- [`packages/react-native/android/src/main/java/com/rejourney/engine/DeviceRegistrar.kt`](/Users/mora/Desktop/Dev-mac/rejourney/packages/react-native/android/src/main/java/com/rejourney/engine/DeviceRegistrar.kt)
- [`packages/react-native/ios/Engine/RejourneyImpl.swift`](/Users/mora/Desktop/Dev-mac/rejourney/packages/react-native/ios/Engine/RejourneyImpl.swift) (foreground / background / `willTerminate` lifecycle, pause and rollover)

## [I2] Upload Lanes / Session Creation

```text
                          same sessionId
                                │
          ┌─────────────────────┴─────────────────────┐
          ▼                                           ▼
┌─────────────────────────┐                 ┌──────────────────────────┐
│ Events lane             │                 │ Replay lane              │
│ POST /presign           │                 │ POST /segment/presign    │
│ PUT relay upload        │                 │ PUT relay upload         │
│ POST /batch/complete    │                 │ POST /segment/complete   │
└─────────────┬───────────┘                 └──────────────┬───────────┘
              └─────────────────────┬──────────────────────┘
                                    ▼
                    sessions + recording_artifacts + metrics
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Presign request path                                                        │
│                                                                              │
│ 1. Billing gate / project recording rules                                   │
│ 2. Session-limit check                                                      │
│ 3. ensureIngestSession(projectId, sessionId)                                │
│ 4. If created == true -> increment project_usage.sessions exactly once      │
│ 5. register pending artifact row                                            │
│ 6. return upload relay URL                                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Session-creation rules:

- New sessions are inserted with `status='processing'` and a matching `session_metrics` row.
- Billing/session counting happens only when the session row is first created.
- Replay screenshot uploads are rejected if the project disables recording or the session is sampled out.
- Closed sessions (see [I8]) cannot receive new presigns or relay uploads; `registerPendingArtifact()` is guarded so a finalized session is not reopened by late clients.

Relevant routes:

- [`backend/src/routes/ingestUploads.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestUploads.ts)
- [`backend/src/routes/ingestLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestLifecycle.ts)
- [`backend/src/routes/ingestUploadRelay.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestUploadRelay.ts)
- [`backend/src/routes/ingestFaults.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestFaults.ts)
- [`backend/src/services/ingestSessionLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestSessionLifecycle.ts)
- [`backend/src/services/ingestArtifactLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestArtifactLifecycle.ts)
- [`backend/src/services/sessionIngestImmutability.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionIngestImmutability.ts)

## [I3] Upload Relay / Artifact + lifecycle workers / Artifact states

```text
┌──────────┐   /presign or /segment/presign   ┌──────────────────────────────┐
│ Package  │─────────────────────────────────▶│ recording_artifacts          │
│ / SDK    │◀─────────────────────────────────│ status = pending             │
└────┬─────┘        relay URL returned        └──────────────┬───────────────┘
     │                                                      │
     │ PUT /upload/artifacts/:artifactId                    │
     ▼                                                      ▼
┌──────────────┐                                   ┌──────────────────────────┐
│ upload relay │──────────────────────────────────▶│ artifact = uploaded      │
└────┬─────────┘                                   │ ingest_jobs queued       │
     │                                             └─────────────┬────────────┘
     │ /batch/complete or /segment/complete                      │
     ▼                                                           ▼
┌──────────────┐                                   ┌──────────────────────────┐
│ ingest route │──────────────────────────────────▶│ same ingest_jobs table;   │
│ merge metrics│                                   │ each worker claims by kind │
└──────────────┘                                   └─────────────┬────────────┘
                                                                 ▼
              ┌──────────────────────────────────────────────────────────────────┐
              │ Artifact workers (two deployments; see workerDefinitions.ts)    │
              │  ┌──────────────────────────┐    ┌──────────────────────────────┐  │
              │  │ ingest-artifact worker   │    │ replay-artifact worker       │  │
              │  │ events, crashes, ANRs    │    │ screenshots, hierarchy       │  │
              │  └────────────┬─────────────┘    └──────────────┬───────────────┘  │
              └───────────────┴──────────────────────────────────┴──────────────────┘
                                            │
                                            ▼
                              process / normalize (artifactJobProcessor)
                              artifact = ready / failed
                              reconcileSessionState()
```

```text
Artifact state machine

pending   -> uploaded -> ready
pending   -> abandoned
uploaded  -> failed
failed    -> uploaded    (recoverable retry path)
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Session-lifecycle worker (sessionLifecycleWorker.ts)                        │
│ Poll ~500ms; session sweep interval 10s between runs of:                    │
│                                                                              │
│ Each sweep (at most every 10s):                                             │
│   reconcileDueSessions (batched)                                            │
│   abandon expired pending artifacts (> 10m)                                 │
│   requeue stale processing jobs (> 5m)                                      │
│   queueRecoverableArtifacts (uploaded but missing a usable job)             │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Artifact workers (startArtifactWorker.ts → poll ~500ms per deployment)      │
│                                                                              │
│ Startup: recoverStuckArtifactJobs() — stuck processing jobs → pending       │
│ Each tick: selectRunnableArtifactJobs (filtered by worker kind allowlist)   │
│            → processArtifactJob → reconcileSessionState() as needed         │
└──────────────────────────────────────────────────────────────────────────────┘
```

Important worker nuance:

- **ingest-artifact worker** ([`ingestArtifactWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/ingestArtifactWorker.ts)): drains jobs whose artifact kinds are `events`, `crashes`, `anrs` (see [`workerDefinitions.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/workerDefinitions.ts) `INGEST_ARTIFACT_WORKER`). Monitoring name is still `ingestWorker`.
- **replay-artifact worker** ([`replayArtifactWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/replayArtifactWorker.ts)): drains `screenshots` and `hierarchy` (`REPLAY_ARTIFACT_WORKER`).
- **session-lifecycle worker** ([`sessionLifecycleWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/sessionLifecycleWorker.ts)): periodic sweeps in the first box; does not run the per-job [`artifactJobProcessor`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/artifactJobProcessor.ts) loop (that is only in artifact workers).
- `events` artifacts update session metadata, `session_metrics`, and downstream analytics side effects.
- `crashes` and `anrs` artifacts create issue records and increment crash/ANR counters.
- `screenshots` and `hierarchy` artifacts mostly feed replay availability and session finalization.
- [`ingestWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/ingestWorker.ts) is a thin entry that loads **ingest-artifact** only (same as the `ingest-worker` k8s command); replay and lifecycle are separate entrypoints.
- The heavy full-table artifact lifecycle backfill is manual by default. Normal worker startup skips it unless `INGEST_ENABLE_STARTUP_BACKFILL=true`.
- Manual backfill command: `cd backend && npm run db:backfill:artifact-lifecycle`

Relevant files:

- [`backend/src/routes/ingestUploadRelay.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestUploadRelay.ts) (enforces [I8] before streaming to S3)
- [`backend/src/worker/ingestArtifactWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/ingestArtifactWorker.ts)
- [`backend/src/worker/replayArtifactWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/replayArtifactWorker.ts)
- [`backend/src/worker/sessionLifecycleWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/sessionLifecycleWorker.ts)
- [`backend/src/worker/workerDefinitions.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/workerDefinitions.ts)
- [`backend/src/worker/startArtifactWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/startArtifactWorker.ts)
- [`backend/src/services/artifactJobProcessor.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/artifactJobProcessor.ts)
- [`backend/src/services/ingestArtifactLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestArtifactLifecycle.ts)

## [I8] Closed-session immutability (ingest + relay)

When the dashboard would show **no live ingest** for a row, the server treats that session as **immutable for ingest clients**: further mutations from the SDK are rejected with **409 Conflict** (except idempotent success paths noted below).

**Predicate** (single source of truth: [`sessionIngestImmutability.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionIngestImmutability.ts) `isSessionIngestImmutable`):

- `status` is `failed`, `deleted`, or `ready`, **or**
- `finalized_at` is set, **or**
- `explicit_ended_at` is set (client already called `/session/end`).

**What is blocked**

- `POST /api/ingest/presign` and `POST /api/ingest/segment/presign` — no new artifact rows / relay URLs.
- `PUT /upload/artifacts/:artifactId` (relay) — no new bytes into S3 for that session (even if an old presign URL is reused).
- `POST /api/ingest/fault` — no new crash/ANR rows or session_metrics bumps for that session.

**What is still allowed (winding down)**

- `POST /api/ingest/batch/complete` and `POST /api/ingest/segment/complete` may still finalize artifacts that were already presigned, but they **do not** update `sessions.last_ingest_activity_at`, session identity fields, or `session_metrics` SDK telemetry while the session is immutable — so the closed session row is not “nudged” by straggling completes.
- Artifact pipeline code still updates `recording_artifacts` / jobs as needed to process data that already landed; [`ingestArtifactLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestArtifactLifecycle.ts) skips `markSessionIngestActivity` when the session is immutable.

**`/session/end`**

- If the session is already immutable, the handler returns `{ success: true, ignored: true, reason: 'session_immutable' }` without changing the database (idempotent).

**Operational note:** If a presign was issued just before the session closed, the client may still attempt a relay `PUT`; that upload is **rejected** once the session is immutable, so the SDK may see 409 on the relay. That is intentional to prevent post-close corruption.

## [I4] Reconciliation / Auto-Finalizer / endedAt Math

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ reconcileSessionState(sessionId)                                            │
│                                                                              │
│ readyScreenshotCount > 0 ?                                                  │
│   yes -> replay_available = true                                            │
│   no  -> replay_available = false                                           │
│                                                                              │
│ blocking work left?                                                         │
│   replay already available -> only open replay artifacts/jobs block done    │
│   replay not yet available -> any open artifact/job blocks done             │
│                                                                              │
│ explicit_ended_at present OR idle >= 60s ?                                  │
│   yes -> status = ready                                                     │
│          finalized_at set                                                   │
│          ended_at derived                                                   │
│          duration_seconds recomputed                                        │
│   no  -> stay processing                                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ended_at priority                                                           │
│                                                                              │
│ 1. explicit_ended_at                                                        │
│ 2. latest ready replay artifact end_time                                    │
│ 3. existing ended_at                                                        │
│ 4. last_ingest_activity_at                                                  │
│ 5. now                                                                      │
│                                                                              │
│ clamp:                                                                      │
│   started_at <= ended_at <= started_at + maxRecordingMinutes + 2 minutes    │
│                                                                              │
│ duration_seconds:                                                           │
│   max(1, wall_clock_seconds - background_time_seconds)                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
/api/ingest/session/end
  -> resolveLifecycleSession()
  -> merge session_metrics + sdk telemetry
  -> markSessionIngestActivity(explicitEndedAt=..., closeSource='explicit')
  -> reconcileSessionState()
```

**Client reality:** Some exits—especially **iOS background-then-force-quit** from the multitasking UI—often **do not** invoke the native path that calls `/session/end`, so **`explicit_ended_at` may stay unset** until reconciliation. See the **iOS: multitasking and force-quit** note in [I1].

Important reconciliation rules:

- Replay availability is artifact-driven, not `/session/end`-driven.
- `/session/end` is a strong signal, but not the only thing that can finalize a session.
- Once screenshots are ready, late `events` or `faults` uploads do not block replay availability.
- Hierarchy alone is not enough to make replay visible.
- A finalized session can reopen if later `registerPendingArtifact()` activity arrives.

Canonical replay lifecycle fields in Postgres:

- `sessions.replay_available`
- `sessions.replay_available_at`

The API still returns compatibility fields like `replayPromoted` and `replayPromotedReason`, but the canonical stored replay state is the `replay_available` family.

Relevant files:

- [`backend/src/services/sessionReconciliation.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionReconciliation.ts)
- [`backend/src/services/sessionTiming.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionTiming.ts)
- [`backend/src/services/ingestSessionEnd.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestSessionEnd.ts)

## [I5] Redis vs Postgres Ownership

```text
┌──────────────────────────────────────┐      ┌──────────────────────────────────────┐
│ Redis (runtime helper plane)         │      │ Postgres (source of truth)           │
│                                      │      │                                      │
│ sdk:config:*                         │      │ sessions                             │
│ ingest:idempotency:*                 │      │ session_metrics                      │
│ sessions:{teamId}:{period}           │      │ recording_artifacts                  │
│ session_lock:{teamId}:{period}       │      │ ingest_jobs                          │
│ upload:token:{projectId}:{deviceId}  │      │ project_usage                        │
│ rate-limit helpers                   │      │ device_usage                         │
└──────────────────────────────────────┘      └──────────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Practical consequence                                                       │
│                                                                              │
│ If Redis is slow or unavailable, ingest can often degrade and keep working. │
│ If Postgres is wrong, the session lifecycle is wrong.                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

Redis owns:

- SDK config cache
- ingest idempotency markers
- session-limit cache plus distributed lock
- best-effort upload token storage
- rate limiting helpers

Postgres owns:

- whether a session exists
- lifecycle fields like `status`, `started_at`, `explicit_ended_at`, `finalized_at`, `last_ingest_activity_at`
- replay availability
- artifact state
- worker job state
- metrics and derived analytics counters
- project/device usage counters

Schema anchors:

- [`backend/src/db/schema.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/db/schema.ts)
- [`backend/src/db/redis.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/db/redis.ts)

## [I6] Quick Answers / Constants

```text
New session created?
  Usually on the first successful:
  - POST /api/ingest/presign
  - POST /api/ingest/segment/presign

Missing session on /session/end?
  Yes, if the session ID is still fresh enough to materialize.

What counts as "fresh enough"?
  session_{timestamp}_{uuid} and timestamp <= 6h old

What exactly is the auto-finalizer?
  Session-lifecycle worker sweep (reconcileDueSessions, abandon, requeue, recover)
  plus reconcileSessionState() after artifact jobs complete (ingest + replay workers)

What makes a replay visible?
  At least one screenshot artifact with status = ready

Can a finalized session reopen?
  Yes. A later pending artifact can clear finalized_at and move it back to processing.

Does Redis store session lifecycle?
  No. Redis helps the pipeline run; Postgres owns the lifecycle.
```

```text
Session ID materialization window      6h
Finalize idle threshold                60s
Session-lifecycle sweep interval       10s (reconcileDueSessions + artifact hygiene)
Pending artifact abandonment           10m
Stale processing job retry window      5m
Upload relay token TTL                 1h
SDK background rollover threshold      60s
SDK rollover grace window              2s
SDK event heartbeat                    5s
```

## [I7] Archive list duration + read model (dashboard)

The sessions **archive** endpoint (`GET /api/sessions`, implemented in [`backend/src/routes/sessions.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/sessions.ts)) is the read path operators use in the dashboard. It is **not** the ingest write path, but it reflects the same lifecycle fields and is worth documenting next to reconciliation.

**List payload shape (performance):**

- Rows are selected **without** large JSONB columns (`events`, `metadata`) so the table stays fast; session detail endpoints load full rows.
- Optional total count can be deferred (`includeTotal: false`) so the first page is not blocked on a slow `count(*)`.
- Supporting indexes include replay-ready and project/device filters (see migration [`backend/drizzle/20260329055326_sessions_archive_perf_indexes/migration.sql`](/Users/mora/Desktop/Dev-mac/rejourney/backend/drizzle/20260329055326_sessions_archive_perf_indexes/migration.sql)).

**How `durationSeconds` is filled on each list row:**

`resolveArchiveListDurationSeconds()` uses the stored `sessions.duration_seconds` when it is already positive. Otherwise it derives playable duration from timestamps, in order:

1. `ended_at`
2. `explicit_ended_at`
3. `finalized_at`
4. **`last_ingest_activity_at`**, only if it is strictly after `started_at` (provisional end while formal end columns are still empty)

That last step matches the spirit of `selectSessionEndedAt()` / reconciliation: replay availability and metrics can move ahead of a single atomic row update, so there is a short window where `duration_seconds` is still `0` and none of `ended_at` / `explicit_ended_at` / `finalized_at` are set yet. Using `last_ingest_activity_at` avoids flashing **0:00** in the archive when ingest activity is already known.

**Dashboard client:**

- [`dashboard/web-ui/app/shared/api/client.ts`](/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/shared/api/client.ts) `transformToRecordingSession()` can re-derive duration from `endedAt` / `explicitEndedAt` when the API sends zeros; list responses already carry resolved `durationSeconds` and `stats.duration` from the server.
- The sessions list UI ([`dashboard/web-ui/app/features/app/sessions/index/route.tsx`](/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/features/app/sessions/index/route.tsx)) shows **LIVE REPLAY** while ingest or replay prep is still in progress (from presentation fields), and **MM:SS** once replay is openable and the session is not live-ingesting—so operators are not blocked from opening a session during processing.

## Primary Files

- [`backend/src/routes/sessions.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/sessions.ts) (archive list, `resolveArchiveListDurationSeconds`)
- [`backend/src/routes/ingestUploads.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestUploads.ts)
- [`backend/src/routes/ingestLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestLifecycle.ts)
- [`backend/src/routes/ingestUploadRelay.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestUploadRelay.ts)
- [`backend/src/routes/ingestDeviceAuth.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestDeviceAuth.ts)
- [`backend/src/services/ingestSessionLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestSessionLifecycle.ts)
- [`backend/src/services/ingestArtifactLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestArtifactLifecycle.ts)
- [`backend/src/services/sessionReconciliation.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionReconciliation.ts)
- [`backend/src/services/sessionTiming.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionTiming.ts)
- [`backend/src/services/artifactJobProcessor.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/artifactJobProcessor.ts)
- [`backend/src/worker/workerDefinitions.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/workerDefinitions.ts)
- [`backend/src/worker/startArtifactWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/startArtifactWorker.ts)
- [`backend/src/worker/ingestArtifactWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/ingestArtifactWorker.ts)
- [`backend/src/worker/replayArtifactWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/replayArtifactWorker.ts)
- [`backend/src/worker/sessionLifecycleWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/sessionLifecycleWorker.ts)
- [`backend/src/worker/ingestWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/ingestWorker.ts) (entry shim → ingest-artifact only)
