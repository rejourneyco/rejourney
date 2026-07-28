# Session Backup + Retention Internals

Last updated: 2026-07-27

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
- Retention is deadline-authoritative. Research and archive backup status do not
  extend a customer's configured recording-retention period.
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
  - [`backend/src/services/sessionBackupQueue.ts`](../backend/src/services/sessionBackupQueue.ts)
- Backup runner / queue drainer:
  - [`scripts/k8s/session-backup.mjs`](../scripts/k8s/session-backup.mjs)
- Deployed backup CronJob copy:
  - [`k8s/archive.yaml`](../k8s/archive.yaml)
- Archive backup coverage helper (not a retention prerequisite):
  - [`backend/src/services/sessionBackupGate.ts`](../backend/src/services/sessionBackupGate.ts)
- Empty-session backup predicate:
  - [`backend/src/services/sessionRetentionEligibility.ts`](../backend/src/services/sessionRetentionEligibility.ts)
- Retention worker:
  - [`backend/src/worker/retentionWorker.ts`](../backend/src/worker/retentionWorker.ts)
- Purge implementation:
  - [`backend/src/services/sessionArtifactPurge.ts`](../backend/src/services/sessionArtifactPurge.ts)

Important tables:

- `sessions`
- `recording_artifacts`
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

[`enqueueSessionBackupCandidate()`](../backend/src/services/sessionBackupQueue.ts) only queues a session when all of these are true:

- `s.id = $sessionId`
- `s.status IN ('ready', 'completed')`
- `s.ended_at IS NOT NULL`
- project is not deleted
- session has at least one `recording_artifacts` row with `status = 'ready'`
- session's ready artifacts match one of the supported backup profiles:
  - normal session: ready `events` + `hierarchy` + `screenshots`
  - web rrweb session: ready `events` + `rrweb`
  - `observe_only` session: ready `events` + `hierarchy`, and zero ready `screenshots`
  - `replay_quota_billing_exhausted` session: same non-visual profile as observe-only, but marked separately because replay was disabled by billing quota rather than customer consent/configuration
- no existing `session_backup_log` row already covers the current ready-artifact count

That last condition now means:

- `bl.artifact_count >= readyArtifactCount`
- `bl.planned_artifact_count >= readyArtifactCount`

So a stale or bad backup-log row with `artifact_count = 0` no longer blocks a later real backup.

### Queue seed conditions

Bulk queue seeding in [`session-backup.mjs`](../scripts/k8s/session-backup.mjs) is slightly broader but still conservative:

- `s.status IN ('ready', 'completed')`
- project is not deleted
- session has at least one `ready` artifact
- session's ready artifacts match the same profile rule used by backend enqueue
- session is not already fully backed up for the current ready-artifact count
- queue row does not already exist

The seeder does not separately require `ended_at IS NOT NULL`, but in practice finalized rows should already have it.

### What counts as "provably empty"

The empty-session predicate in [`sessionRetentionEligibility.ts`](../backend/src/services/sessionRetentionEligibility.ts) is intentionally strict.

A session is considered empty only if all of these are true:

- no `recording_artifacts`
- `replay_available = false`
- `replay_segment_count = 0`
- `replay_storage_bytes = 0`
- `events` array is empty
- `metadata` is empty
- `session_metrics` has no meaningful payload/activity metrics

This means:

- "no screenshots" is not enough to be empty
- `observe_only` / `replay_quota_billing_exhausted` is not enough to be empty
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

The backup drainer in [`session-backup.mjs`](../scripts/k8s/session-backup.mjs):

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

Backoff is exponential and capped by env-driven settings in [`session-backup.mjs`](../scripts/k8s/session-backup.mjs).

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
- retention may still purge its canonical replay data when the configured
  retention deadline passes
- the row stops re-entering normal `pending` claim order, which prevents old impossible sessions from starving real backupable work

If source storage is later repaired for one of these sessions, operators must move the queue row back to `pending` or delete/re-enqueue it.

## [B4] Backup Execution + Success Criteria

### What the backup worker actually copies

The backup worker only copies `recording_artifacts` rows where:

- `ra.session_id = $sessionId`
- `ra.status = 'ready'`

That fetch happens in [`fetchArtifacts()`](../scripts/k8s/session-backup.mjs).

Important implication:

- backup is driven by ready artifacts, not all artifact rows
- pending / uploaded / failed / abandoned rows are not copied into R2
- the worker validates artifact shape before copy:
  - normal sessions require ready `events` + `hierarchy` + `screenshots`
  - web rrweb sessions require ready `events` + `rrweb`
  - `observe_only` and `replay_quota_billing_exhausted` sessions require ready `events` + `hierarchy` and must not have ready screenshots

### Manifest + artifact format

For each session, the worker builds:

- `manifest.json`
- copied `events`
- copied or repaired `hierarchy`
- copied `rrweb`
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
- successful replay-quota-exhausted backups use quality tier `replay_quota_billing_exhausted`
- neither analytics-only profile is a synthetic zero-artifact shortcut

## [B5] Retention Eligibility + Purge Rules

Retention runs in [`retentionWorker.ts`](../backend/src/worker/retentionWorker.ts).

### Normal expiry candidate conditions

A session is considered for retention expiry when:

- `sessions.retention_tier = retentionPolicies.tier`
- `sessions.started_at < now - retention_days`
- `sessions.recording_deleted = false`
- `sessions.status IN ('ready', 'completed')`
- project is not deleted
- no failed retention deletion was recorded for the session in the last 24 hours

### Research and backup independence

Research Lake extraction/compaction is best-effort and is not a prerequisite for
retention deletion. The retention candidate query does not inspect research jobs,
research manifests, or `session_backup_log`, so a missing or delayed research copy
does not hold expired replay data past the configured retention period.

This is deliberate: the customer-configured retention deadline is authoritative,
and neither the V1 research format nor a future additive research format requires
a retention backfill or a separate retention implementation.

### Repair path

Retention also has a repair path for sessions already marked expired/deleted but still carrying leftover artifact rows:

- `recordingDeleted = true` or `isReplayExpired = true`
- still has `recording_artifacts`
- its own `retention_days` period has expired

That path is implemented in [`repairExpiredSessionArtifactsBatch()`](../backend/src/services/sessionArtifactPurge.ts).

## [B6] What Gets Deleted vs What Stays

### Normal retention purge deletes

[`purgeSessionArtifacts()`](../backend/src/services/sessionArtifactPurge.ts) deletes:

- canonical storage objects under:
  - `tenant/{teamId}/project/{projectId}/sessions/{sessionId}/`
- derived screenshot frame objects under:
  - `sessions/{sessionId}/`
- `recording_artifacts` rows
- screenshot/hierarchy counters in `session_metrics`
- replay/cache state on the `sessions` row
- fixed Redis cache entries for replay manifests, hierarchy, timelines, and
  session-core views; individual frame payload keys have a hard 10-minute TTL

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

### Backup copies and backup logs

Routine retention does not delete the archive backup prefix or
`session_backup_log`. Project/team hard-delete flows remain responsible for
removing those records and objects.

### When the actual session row is fully deleted

Session rows are only hard-deleted as part of project/team deletion flows, not routine retention.

That happens in [`hardDeleteProject()`](../backend/src/services/deletion.ts), which:

- marks project deleted
- revokes API keys
- deletes project storage
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

### 2. Analytics-only profiles are real backup profiles

`observe_only` means "no screenshots by customer consent/configuration".
`replay_quota_billing_exhausted` means "no screenshots/rrweb by replay quota".
Neither means "nothing to archive".

- backup still runs
- backup still writes a real manifest
- backup still writes `session_backup_log`
- retention remains independent of that ledger row

### 3. Backup is fail-safe, not best-effort complete

If source objects are missing or the prefix parity check fails:

- the run rolls back the R2 prefix
- the queue row is retried, unless it is repeatedly hitting the historical stale `source_missing` pattern
- the session is not considered backed up

Parking a row as `source_missing` is not a success path. It is only an anti-starvation queue-control path.

### 4. Retention fails closed per deletion attempt

An S3 or database failure leaves the session eligible for a later run. Recent
failed attempts receive a 24-hour backoff to avoid hammering a broken storage
endpoint. Research/backup incompleteness is not a deletion failure and does not
block expiry.

### 5. Useful places to inspect

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
  - [`k8s/archive.yaml`](../k8s/archive.yaml)
- source-of-truth backup script:
  - [`scripts/k8s/session-backup.mjs`](../scripts/k8s/session-backup.mjs)
