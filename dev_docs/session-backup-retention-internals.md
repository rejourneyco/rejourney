# Session Backup + Retention Internals

Last updated: 2026-04-17

This is the internal/operator doc for how session backup and retention work in the backend and Kubernetes workers.

Use this doc for:

- when a session is considered backupable
- how the backup queue works
- what `session_backup_log` actually means
- when retention is allowed to purge session recording data
- what gets deleted vs what stays

This is not the user-facing product story. It is the worker/runtime story.

## Shortest Correct Mental Model

- Backups copy ready recording artifacts from primary storage into Cloudflare R2.
- A session is not backupable just because it exists. It must be finalized and its ready artifacts must match the expected profile.
- The backup queue is fed both by session finalization and by a periodic queue seeder, then drained by the backup CronJob.
- `session_backup_log` is the ledger that says "this session backup completed successfully for N planned/copied artifacts".
- Retention is fail-safe. It does not purge normal sessions, including `observe_only` sessions, unless backup safety checks pass first.
- Normal retention does not delete the `sessions` row. It deletes recording payloads and marks the row as replay-expired / recording-deleted.
- Full `sessions` row deletion only happens in project/team hard-delete flows.

## Flow Index

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [B1] Components + Tables                                                    │
│ [B2] Backup Eligibility                                                     │
│ [B3] Queue Mechanics                                                        │
│ [B4] Backup Execution + Success Criteria                                    │
│ [B5] Retention Eligibility + Purge Rules                                    │
│ [B6] What Gets Deleted vs What Stays                                        │
│ [B7] Important Safety Nuances                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

## [B1] Components + Tables

Main code paths:

- Backup queue enqueue from backend finalize path:
  - [`backend/src/services/sessionBackupQueue.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionBackupQueue.ts)
- Backup runner / queue drainer:
  - [`scripts/k8s/session-backup.mjs`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/k8s/session-backup.mjs)
- Deployed backup CronJob copy:
  - [`k8s/archive.yaml`](/Users/mora/Desktop/Dev-mac/rejourney/k8s/archive.yaml)
- Retention safety gate:
  - [`backend/src/services/sessionBackupGate.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionBackupGate.ts)
- Empty-session predicate:
  - [`backend/src/services/sessionRetentionEligibility.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionRetentionEligibility.ts)
- Retention worker:
  - [`backend/src/worker/retentionWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/retentionWorker.ts)
- Purge implementation:
  - [`backend/src/services/sessionArtifactPurge.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionArtifactPurge.ts)

Important tables:

- `sessions`
- `recording_artifacts`
- `ingest_jobs`
- `session_metrics`
- `session_backup_queue`
- `session_backup_log`
- `retention_deletion_log`
- `retention_run_lock`
- `session_backup_run_lock`

## [B2] Backup Eligibility

There are two ways a session gets into backup flow:

1. The backend enqueues it when a session finalizes.
2. The backup script can seed the queue in bulk for backfills / catch-up.

### Backend enqueue conditions

[`enqueueSessionBackupCandidate()`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionBackupQueue.ts) only queues a session when all of these are true:

- `s.id = $sessionId`
- `s.status IN ('ready', 'completed')`
- `s.ended_at IS NOT NULL`
- project is not deleted
- session has at least one `recording_artifacts` row with `status = 'ready'`
- session's ready artifacts match one of the supported backup profiles:
  - normal session: ready `events` + `hierarchy` + `screenshots`
  - `observe_only` session: ready `events` + `hierarchy`, and zero ready `screenshots`
- no existing `session_backup_log` row already covers the current ready-artifact count

That last condition now means:

- `bl.artifact_count >= readyArtifactCount`
- `bl.planned_artifact_count >= readyArtifactCount`

So a stale or bad backup-log row with `artifact_count = 0` no longer blocks a later real backup.

### Queue seed conditions

Bulk queue seeding in [`session-backup.mjs`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/k8s/session-backup.mjs) is slightly broader but still conservative:

- `s.status IN ('ready', 'completed')`
- project is not deleted
- session has at least one `ready` artifact
- session's ready artifacts match the same profile rule used by backend enqueue
- session is not already fully backed up for the current ready-artifact count
- queue row does not already exist

The seeder does not separately require `ended_at IS NOT NULL`, but in practice finalized rows should already have it.

### What counts as "provably empty"

The empty-session predicate in [`sessionRetentionEligibility.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionRetentionEligibility.ts) is intentionally strict.

A session is considered empty only if all of these are true:

- no `recording_artifacts`
- no `ingest_jobs`
- `replay_available = false`
- `replay_segment_count = 0`
- `replay_storage_bytes = 0`
- `events` array is empty
- `metadata` is empty
- `session_metrics` has no meaningful payload/activity metrics

This means:

- "no screenshots" is not enough to be empty
- `observe_only` is not enough to be empty
- "no ready artifacts" is not enough to be empty
- a session with meaningful metrics but zero ready artifacts is not empty, but it is also not backupable anymore

## [B3] Queue Mechanics

```text
Session finalized
  -> enqueueSessionBackupCandidate()
  -> session_backup_queue(status='pending')

Periodic seed run
  -> fetchSeedCandidates(retention-aware priority, eligible only)
  -> session_backup_queue(status='pending')

session-backup CronJob
  -> claims rows
  -> copies artifacts to R2
  -> writes session_backup_log
  -> deletes queue row
```

### Queue table behavior

`session_backup_queue` tracks:

- `status`: `pending`, `processing`, or terminal `source_missing`
- `attempts`
- `next_retry_at`
- `claimed_by`
- `claimed_at`
- `last_error`

### Drainer behavior

The backup drainer in [`session-backup.mjs`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/k8s/session-backup.mjs):

- acquires a global Postgres run lock in `session_backup_run_lock`
- cleans up completed queue rows
- removes stale queue rows for sessions that are no longer backup-eligible
- removes orphaned queue rows
- recovers stale claims
- claims a batch with `FOR UPDATE SKIP LOCKED`
- processes sessions in parallel
- deletes successful queue rows
- requeues failures with exponential backoff

### What "completed queue row cleanup" means

The drainer only auto-removes a queue row when the existing backup-log row covers the session's current ready-artifact count:

- `bl.artifact_count >= readyArtifactCount`
- `bl.planned_artifact_count >= readyArtifactCount`

So queue cleanup is now aligned with the actual backupable artifact set.

### Retry behavior

Failures are not silently dropped.

The queue row is moved back to `pending` with:

- incremented `attempts`
- `next_retry_at = NOW() + backoff`
- `last_error` populated

Backoff is exponential and capped by env-driven settings in [`session-backup.mjs`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/k8s/session-backup.mjs).

### Terminal `source_missing` parking

There is now one intentionally terminal queue state: `source_missing`.

This is only used for a narrow historical failure pattern where:

- the worker still sees source objects missing after repeated retries
- the session has already hit `SESSION_BACKUP_SOURCE_MISSING_TERMINAL_ATTEMPT` attempts
- all missing artifacts also have `upload_completed_at IS NULL`

That combination is treated as "very likely stale metadata / impossible historical source recovery," not as a healthy backup candidate.

Important consequences:

- the session is **not** marked backed up
- no `session_backup_log` row is written
- retention still will not purge it as a backed-up session
- the row stops re-entering normal `pending` claim order, which prevents old impossible sessions from starving real backupable work

If source storage is later repaired for one of these sessions, operators must move the queue row back to `pending` or delete/re-enqueue it.

## [B4] Backup Execution + Success Criteria

### What the backup worker actually copies

The backup worker only copies `recording_artifacts` rows where:

- `ra.session_id = $sessionId`
- `ra.status = 'ready'`

That fetch happens in [`fetchArtifacts()`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/k8s/session-backup.mjs).

Important implication:

- backup is driven by ready artifacts, not all artifact rows
- pending / uploaded / failed / abandoned rows are not copied into R2
- the worker validates artifact shape before copy:
  - normal sessions require ready `events` + `hierarchy` + `screenshots`
  - `observe_only` sessions require ready `events` + `hierarchy` and must not have ready screenshots

### Manifest + artifact format

For each session, the worker builds:

- `manifest.json`
- copied `events`
- copied or repaired `hierarchy`
- screenshot archives in an archive-friendly format on R2

The backup prefix is canonical:

```text
backups/tenant/{teamId}/project/{projectId}/sessions/{sessionId}/
```

### All-or-nothing success rule

Backup is treated as successful only if all of these are true:

- session has at least one ready artifact
- every ready artifact copies successfully
- no source object is missing
- exactly one `manifest.json` exists in the R2 prefix
- `artifactObjectCount === copiedCount === plannedArtifactCount`

If any of those checks fail:

- the R2 prefix is removed
- no completed backup-log row should remain from that attempt
- the queue entry is retried later unless it matches the narrow terminal `source_missing` rule above

### What goes into `session_backup_log`

After a successful backup, the worker writes:

- `session_id`
- `r2_key_prefix`
- `artifact_count`
- `planned_artifact_count`
- `total_bytes`
- quality fields such as:
  - `high_quality`
  - `quality_tier`
  - `quality_reason`
  - `actual_r2_artifact_count`
  - `actual_r2_object_count`
  - `manifest_present`

Current meaning:

- `artifact_count`: how many ready artifacts were actually copied
- `planned_artifact_count`: how many ready artifacts were expected

These counts are backup-worker counts, not "all artifact rows ever seen by the session."

### Quality scoring

Every successful backup writes quality metadata.

- standard sessions are scored against the full replay profile
- `observe_only` sessions are still scored from the real manifest and copied artifact set
- successful `observe_only` backups use quality tier `observe_only`
- `observe_only` is no longer a synthetic zero-artifact shortcut

## [B5] Retention Eligibility + Purge Rules

Retention runs in [`retentionWorker.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/worker/retentionWorker.ts).

### Normal expiry candidate conditions

A session is considered for retention expiry when:

- `sessions.retention_tier = retentionPolicies.tier`
- `sessions.started_at < now - retention_days`
- `sessions.recording_deleted = false`
- `sessions.status = 'ready'`
- project is not deleted

### Backup safety gate

Before purge, retention partitions candidates into backed-up vs not-backed-up using [`partitionBackedUpSessions()`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionBackupGate.ts).

A session counts as safe to purge when either:

1. it has a `session_backup_log` row whose counts cover all `recording_artifacts` rows, or
2. it is provably empty by the empty-session predicate

Important nuance:

- retention is stricter than backup
- backup copies only `ready` artifacts
- retention compares `session_backup_log` counts against total `recording_artifacts` rows

That means if a session still has extra non-ready artifact rows, retention may conservatively skip it even if the ready artifacts were already backed up.

Important consequence:

- `observe_only` sessions do not bypass this gate anymore
- they must have a real `session_backup_log` row from the backup worker before retention can purge them

### Repair path

Retention also has a repair path for sessions already marked expired/deleted but still carrying leftover artifact rows:

- `recordingDeleted = true` or `isReplayExpired = true`
- still has `recording_artifacts`
- still must pass the same backup safety gate first

That path is implemented in [`repairExpiredSessionArtifactsBatch()`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionArtifactPurge.ts).

## [B6] What Gets Deleted vs What Stays

### Normal retention purge deletes

[`purgeSessionArtifacts()`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/sessionArtifactPurge.ts) deletes:

- canonical storage objects under:
  - `tenant/{teamId}/project/{projectId}/sessions/{sessionId}/`
- `recording_artifacts` rows
- `ingest_jobs` rows
- screenshot/hierarchy counters in `session_metrics`
- replay/cache state on the `sessions` row
- Redis cache entries for frames, hierarchy, timelines, and session-core views

It then marks the session row as:

- `recording_deleted = true`
- `recording_deleted_at = now`
- `is_replay_expired = true`
- `replay_available = false`
- `replay_segment_count = 0`
- `replay_storage_bytes = 0`

### What normal retention does not delete

Normal retention keeps:

- the `sessions` row itself
- non-recording analytics/fault history attached elsewhere
- most session metadata and identity fields
- the R2 backup copy for non-empty sessions
- the `session_backup_log` row for non-empty sessions

### When retention deletes backup copy + backup log too

Retention only deletes the backup R2 prefix and removes the `session_backup_log` row when the session is classified as truly empty.

That is controlled by:

- `deleteBackupCopy: purgeMetadata.empty_session`
- `deleteBackupLogEntry: purgeMetadata.empty_session`

So for a real backed-up recording session:

- canonical runtime payloads are purged
- archive backup stays

### When the actual session row is fully deleted

Session rows are only hard-deleted as part of project/team deletion flows, not routine retention.

That happens in [`hardDeleteProject()`](/Users/mora/Desktop/Dev-mac/rejourney/backend/src/services/deletion.ts), which:

- marks project deleted
- revokes API keys
- deletes project storage
- deletes `ingest_jobs`
- deletes `project_usage`
- deletes `storage_endpoints`
- deletes `sessions`
- deletes the `projects` row

## [B7] Important Safety Nuances

### 1. Backupability is not the same as "not empty"

A session can be:

- not empty
- finalized
- meaningful
- but still not backupable

Example: it has metadata / metrics / maybe failed artifacts, but zero ready artifacts.

That session now:

- will not be queued for backup
- will not produce a manifest-only backup-log row

### 2. Backup success and retention safety use different counts

Backup success:

- based on ready artifacts copied to R2

Retention safety:

- based on `session_backup_log` coverage vs total artifact rows

This is intentionally conservative, but it means some sessions can remain ineligible for retention longer than expected.

### 3. `observe_only` is a real backup profile, not a retention bypass

`observe_only` means "no screenshots by design", not "nothing to archive".

- backup still runs
- backup still writes a real manifest
- backup still writes `session_backup_log`
- retention still waits for that ledger row

### 4. Backup is fail-safe, not best-effort complete

If source objects are missing or the prefix parity check fails:

- the run rolls back the R2 prefix
- the queue row is retried, unless it is repeatedly hitting the historical stale `source_missing` pattern
- the session is not considered backed up

Parking a row as `source_missing` is not a success path. It is only an anti-starvation queue-control path.

### 5. Retention is fail-safe too

If `session_backup_log` is missing, or counts do not satisfy the safety gate:

- retention skips the session
- the session is not purged

### 6. Useful places to inspect

- queue state:
  - `session_backup_queue`
  - note: `status = 'source_missing'` means "blocked on historical missing source objects", not "backed up"
- completed backups:
  - `session_backup_log`
- purge attempts:
  - `retention_deletion_log`
- retention lock:
  - `retention_run_lock`
- backup run lock:
  - `session_backup_run_lock`
- deployed backup logic:
  - [`k8s/archive.yaml`](/Users/mora/Desktop/Dev-mac/rejourney/k8s/archive.yaml)
- source-of-truth backup script:
  - [`scripts/k8s/session-backup.mjs`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/k8s/session-backup.mjs)
