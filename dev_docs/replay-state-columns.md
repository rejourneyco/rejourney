# Replay State Columns

This doc defines the session columns that decide replay artifact truth, replay
visibility, Smart Capture state, and replay quota counting.

## Mental Model

Keep four concepts separate:

```text
replay_available
= retained replay artifact truth
= replay artifacts exist and can technically be loaded if product state allows it

replay_retention_state
= product/display/billing state
= saved, hidden buffer, analytics-only, unavailable, or legacy

canOpenReplay
= derived public presentation field
= never stored; computed from replay_available + retention + deleted/expired/quota guards

replay_quota_counted_at
= billing idempotency marker
= this saved replay has already counted against replay quota
```

Do not overload `replay_available` with product decisions. Smart Capture can
temporarily keep artifacts while hiding the replay, so artifact truth and product
visibility must stay separate.

## Layer Ownership

The backend keeps these decisions split:

| Layer | File | Owns |
| --- | --- | --- |
| Ingest evidence | `sessionEvidence.ts` | Artifact readiness, pending event evidence, latest client evidence, replay counts. |
| Capture policy | `smartCapture.ts` | Normalized project config and rule evaluation. Disabled Smart Capture maps to `record_all`. |
| Retention outcome | `replayRetention.ts` | `replay_available`, `replay_retention_state`, quota/buffer exhaustion, count eligibility. |
| Public presentation | `replayAvailability.ts`, `sessionPresentationState.ts` | `canOpenReplay`, live/background/ready status. |

`sessionReconciliation.ts` coordinates those layers and writes denormalized
session columns. Do not add new rule, artifact-evidence, quota, or public
visibility policy directly into reconciliation when it belongs to one of the
layers above.

## Columns

| Column | Owner | Meaning | Controls |
| --- | --- | --- | --- |
| `sessions.replay_available` | evidence/replay retention | Retained replay artifacts exist. Buffered Smart Capture rows may have this true while hidden. | Low-level artifact/player availability, not public visibility by itself. |
| `sessions.replay_retention_state` | reconciliation/Smart Capture/retention | Product state for replay visibility and replay billing. | Dashboard visibility and replay quota eligibility. |
| `sessions.replay_quota_counted_at` | quota counting | Idempotency marker for replay quota usage. | Prevents double-counting a saved replay. |
| `sessions.replay_quota_billing_exhausted` | ingest/quota gate | Replay quota was exhausted before or at promotion. | Blocks replay quota counting and hides replay as expected billing behavior. |
| `sessions.smart_capture_status` | Smart Capture | Decision lifecycle: not applicable, pending, kept, discarded. | Worker/audit state; not the primary visibility guard. |
| `sessions.smart_capture_reason` | Smart Capture | Why the decision happened. | UI/debug/audit copy. |
| `sessions.smart_capture_rule_id` | Smart Capture | Matching rule id, when a rule caused the decision. | UI/debug/audit traceability. |
| `sessions.smart_capture_decided_at` | Smart Capture | Timestamp when a keep/discard decision finalized. | Worker/audit state. |

## Retention States

`replay_retention_state` can be:

| State | Meaning | Visible/playable? | Counts replay quota? | Artifact expectation |
| --- | --- | ---: | ---: | --- |
| `NULL` | Legacy row created before this column was actively written. Use old guards. | Only if old guards pass. | Only if old quota guards pass. | Whatever old columns say. |
| `saved` | Normal retained replay. | Yes. | Yes, once. | Artifacts should exist. |
| `buffered` | Smart Capture is holding artifacts during a delayed decision. | No. | No. | Artifacts may exist temporarily. |
| `analytics_only` | Analytics/events/metrics are kept, but replay is intentionally not retained. | No. | No. | Visual artifacts should be purged/abandoned. |
| `not_available` | No usable replay exists. | No. | No. | Missing, failed, expired, or deleted replay. |

## Visibility Guard

Normal dashboard replay surfaces should treat a session as playable only when:

```sql
replay_available = true
AND COALESCE(replay_retention_state, 'saved') = 'saved'
AND recording_deleted = false
AND is_replay_expired = false
AND replay_quota_billing_exhausted = false
```

The `COALESCE(..., 'saved')` exists only for legacy rows where
`replay_retention_state IS NULL`. It lets historical replay rows keep old
behavior without a deploy-time full-table backfill.

For TypeScript helper code, use `canOpenReplayFromSessionFields()` from
`backend/src/services/replayAvailability.ts`. The helper treats explicit
`replayAvailable=false` as authoritative; ready-artifact fallback is only for
legacy/missing fields.

```ts
const canOpenReplay = canOpenReplayFromSessionFields(session);
```

## Replay Quota Guard

Replay quota usage increments only when the replay is retained:

```sql
replay_available = true
AND COALESCE(replay_retention_state, 'saved') = 'saved'
AND replay_quota_billing_exhausted = false
AND replay_quota_counted_at IS NULL
```

After a successful increment, set:

```text
sessions.replay_quota_counted_at = now()
```

Pre-cutover sessions covered by the preserved legacy ledger may be marked
`replay_quota_counted_at` without incrementing `project_usage.session_replays`.
New post-cutover sessions increment `project_usage.session_replays` exactly once.

## Smart Capture Flow

Smart Capture is backend-only; no SDK package behavior changes.

```text
Session starts
  -> analytics/events/metrics are accepted and count in project_usage.sessions
  -> visual artifacts may upload as usual

Smart Capture disabled
  -> normalized capture mode is record_all
  -> ready replay artifacts become saved replays

Immediate keep rule matches
  -> replay_available=true
  -> replay_retention_state=saved
  -> smart_capture_status=kept
  -> count replay quota once

Delayed rule still pending
  -> replay_available=true
  -> replay_retention_state=buffered
  -> smart_capture_status=pending
  -> hidden from replay surfaces
  -> no replay quota count yet

Delayed rule keeps
  -> replay_retention_state=saved
  -> smart_capture_status=kept
  -> re-check replay quota
  -> count replay quota once if quota remains

Rule discards or quota/buffer exhausted
  -> replay_available=false after artifact purge
  -> replay_retention_state=analytics_only
  -> smart_capture_status=discarded
  -> analytics remains queryable
  -> no replay quota count
```

Buffered sessions are capped by `RJ_SMART_CAPTURE_BUFFER_MAX_REPLAYS`, defaulting
to `200000`. Delayed decisions are capped at 7 days. Pending immediate rules can
also remain buffered briefly while event evidence is still settling; stale
pending event preflights stop blocking decisions after the evidence window.

## Existing Rows And CI Migration

The deploy migration must not rewrite the hot `sessions` table.

For existing production rows:

```text
replay_retention_state = NULL
```

That means legacy behavior. Old visible replays stay visible because
`replay_available=true` still passes the guard. Old expired, deleted,
quota-exhausted, or missing replays stay hidden because their old guard columns
still block playback.

The CI migration should only add columns. It should not:

- run `UPDATE "sessions"` across historical rows.
- build regular blocking indexes on `sessions`.

Build session indexes later with:

```text
backend/drizzle/manual/smart-capture-session-indexes-concurrent.sql
```

That script uses `CREATE INDEX CONCURRENTLY`, so it must run from a client that
does not wrap the file in a transaction.

## Safe Historical Backfill

After deploy, historical rows can be backfilled in small batches. The backfill is
safe to stop and resume because `NULL` remains a valid legacy state.

Suggested state mapping:

```sql
CASE
  WHEN smart_capture_status = 'pending' AND replay_available = true THEN 'buffered'
  WHEN smart_capture_status = 'discarded' THEN 'analytics_only'
  WHEN replay_quota_billing_exhausted = true THEN 'analytics_only'
  WHEN replay_available = true
    AND recording_deleted = false
    AND is_replay_expired = false THEN 'saved'
  ELSE 'not_available'
END
```

Operational rules:

- batch by primary key or `started_at`.
- keep transactions small.
- sleep between batches.
- monitor locks, CPU, WAL, replication lag, and query latency.
- build concurrent indexes before large backfills when possible.
- never send billing warnings from a backfill.

## Invariants

These invariants should stay true:

- `buffered` sessions are hidden and do not count replay quota.
- `analytics_only` sessions keep analytics but do not expose replay.
- `not_available` sessions do not expose replay.
- `saved` sessions require `replay_available=true` to be playable.
- public routes and dashboard code derive `canOpenReplay`; they must not copy
  ad-hoc retention checks.
- quota is counted only once through `replay_quota_counted_at`.
- `NULL` is only for legacy compatibility and can be cleaned up later.
