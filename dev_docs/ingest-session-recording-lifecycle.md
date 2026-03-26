# Ingest + Session Recording Lifecycle (Visual)

Last updated: 2026-03-25

This doc is the ingest/runtime view: package start, upload lanes, relay, worker reconciliation, Redis, and Postgres.

Deploy, `db-setup`, GitHub Actions, and local parity now live in [Rejourney CI + Deploy Path](/Users/mora/Desktop/Dev-mac/rejourney/dev_docs/rejourney-ci.md).

Shortest correct mental model:

- The package usually creates a client-side `session_{timestamp}_{uuid}` ID and uploads under that ID.
- Postgres is the source of truth for session lifecycle, artifact lifecycle, metrics, jobs, and usage.
- Redis is the runtime helper plane for cache, idempotency, and limit coordination.
- A replay becomes visible when at least one screenshot artifact reaches `ready`.
- A session is finalized by the ingest worker reconciliation path, not just by calling `/session/end`.

## Flow Index

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [I1] Package Start / Rollover                                               │
│ [I2] Upload Lanes / Session Creation                                        │
│ [I3] Upload Relay / Worker / Artifact States                                │
│ [I4] Reconciliation / Auto-Finalizer / endedAt Math                         │
│ [I5] Redis vs Postgres Ownership                                            │
│ [I6] Quick Answers / Constants                                              │
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
- If a late artifact appears for a finalized session, `registerPendingArtifact()` reopens it by touching the session with `reopen: true`.

Relevant routes:

- [`backend/src/routes/ingestUploads.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestUploads.ts)
- [`backend/src/routes/ingestLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestLifecycle.ts)
- [`backend/src/services/ingestSessionLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestSessionLifecycle.ts)
- [`backend/src/services/ingestArtifactLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestArtifactLifecycle.ts)

## [I3] Upload Relay / Worker / Artifact States

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
│ ingest route │──────────────────────────────────▶│ ingest worker            │
│ merge metrics│                                   │ process / normalize      │
└──────────────┘                                   └─────────────┬────────────┘
                                                                 ▼
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
│ Worker sweeps                                                               │
│                                                                              │
│ Every 10s  : reconcile due sessions                                         │
│ > 10m      : abandon expired pending artifacts                              │
│ > 5m       : requeue stale processing jobs                                  │
│ uploaded   : recover artifacts that are missing a usable job                │
│ startup    : reset stuck processing jobs back to pending                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Important worker nuance:

- `events` artifacts update session metadata, `session_metrics`, and downstream analytics side effects.
- `crashes` and `anrs` artifacts create issue records and increment crash/ANR counters.
- `screenshots` and `hierarchy` artifacts mostly feed replay availability and session finalization.
- The heavy full-table artifact lifecycle backfill is manual by default. Normal worker startup skips it unless `INGEST_ENABLE_STARTUP_BACKFILL=true`.
- Manual backfill command: `cd backend && npm run db:backfill:artifact-lifecycle`

Relevant files:

- [`backend/src/routes/ingestUploadRelay.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestUploadRelay.ts)
- [`backend/src/worker/ingestWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/ingestWorker.ts)
- [`backend/src/services/ingestArtifactLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestArtifactLifecycle.ts)

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
  The ingest worker sweep plus reconcileDueSessions() / reconcileSessionState()

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
Worker reconciliation sweep            10s
Pending artifact abandonment           10m
Stale processing job retry window      5m
Upload relay token TTL                 1h
SDK background rollover threshold      60s
SDK rollover grace window              2s
SDK event heartbeat                    5s
```

## Primary Files

- [`backend/src/routes/ingestUploads.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestUploads.ts)
- [`backend/src/routes/ingestLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestLifecycle.ts)
- [`backend/src/routes/ingestUploadRelay.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestUploadRelay.ts)
- [`backend/src/routes/ingestDeviceAuth.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/routes/ingestDeviceAuth.ts)
- [`backend/src/services/ingestSessionLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestSessionLifecycle.ts)
- [`backend/src/services/ingestArtifactLifecycle.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/ingestArtifactLifecycle.ts)
- [`backend/src/services/sessionReconciliation.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionReconciliation.ts)
- [`backend/src/services/sessionTiming.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionTiming.ts)
- [`backend/src/worker/ingestWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/ingestWorker.ts)
