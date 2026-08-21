# Smart Capture And Replay Billing

Rejourney separates analytics sessions from session replays.

Analytics sessions can continue even when a replay is not retained. Replay usage
counts only when a replay is intentionally kept and made available.

## Decision Order

Smart Capture rules are evaluated server-side. Apps do not need browser, React
Native, iOS, or Android package updates to change which replays are kept.

```text
SDK and project controls
  -> project enabled / disabled
  -> recording enabled / disabled
  -> sampling
  -> observe-only or no-record mode

Session ingest
  -> accept analytics, events, metrics, errors, crashes, and network context
  -> count the captured analytics session

Replay quota
  -> if replay quota is exhausted, skip or discard replay data
  -> keep analytics data
  -> do not count replay usage

Smart Capture
  -> Scale entitlement + project config decide whether rules apply
  -> delayed rules can place visual artifacts in a hidden buffer
  -> immediate rules can promote during reconciliation
  -> delayed rules are revisited by the session lifecycle worker
  -> count replay usage only after a final kept decision
```

## Layered Architecture

The replay decision pipeline has four layers:

```text
sessionEvidence
  -> artifact/event readiness, pending evidence, replay counts
smartCapture
  -> normalized project config + side-effect-free rule decision
replayRetention
  -> replay_available, replay_retention_state, quota/buffer effects
public presentation
  -> canOpenReplay and archive/detail/dashboard visibility
```

`sessionReconciliation` orchestrates those layers and writes denormalized
session columns. New logic should land in the owning layer rather than expanding
reconciliation into a second rule engine or UI visibility helper.

## What Counts As Usage

`Sessions captured` means analytics sessions ingested for the project or team.
This can be unlimited.

`Session replays recorded` means sessions whose replay was retained and made
available. Replay quotas are based on this number.

Old API field names such as `sessionsUsed` remain compatibility aliases for
session replay usage. New integrations should prefer explicit replay fields such
as `sessionReplaysUsed`, `sessionReplayLimit`, and `sessionsCaptured`.

## Quota Exhaustion

When replay quota is exhausted, Rejourney keeps non-visual analytics and skips
visual replay retention.

The session is not treated as a failed upload. It is an intentional
analytics-only session caused by replay quota. Internally, those sessions are
marked separately from observe-only mode so operations dashboards can avoid
confusing quota behavior with broken replay uploads.

## Smart Capture Rules

Project-level config lives on `projects`:

- `smart_capture_enabled`
- `smart_capture_mode`: `record_all`, `smart_capture`, or `analytics_only`
- `smart_capture_preset`
- `smart_capture_rules`
- `smart_capture_decision_window_hours`

Backend config normalization is intentionally simple: if Smart Capture is not
enabled or the team is not entitled, the effective capture mode is `record_all`.
That means disabled Smart Capture is represented as a normal kept replay when
visual artifacts exist, not as a distinct product state.

Operators manage this config from the Replays page capture icon, which opens the
Smart Capture modal. Project Settings does not expose a second Smart Capture
surface; the modal is the user-facing home for rule editing.

Session decisions are stored on `sessions`:

- `replay_retention_state`: `NULL` for legacy rows, then `saved`, `buffered`,
  `analytics_only`, or `not_available` once new code reconciles the session
- `smart_capture_status`: `not_applicable`, `pending`, `kept`, or `discarded`
- `smart_capture_reason`
- `smart_capture_rule_id`
- `smart_capture_decided_at`

For the canonical visibility, quota, migration, and backfill matrix, see
the maintainer runbook `replay-state-columns.md` in the private infra repo.

Public replay openability is derived, not stored. Use the backend
`canOpenReplayFromSessionFields()` helper and the dashboard
`canOpenReplayFromSession()` helper; do not duplicate retention checks in route
or UI code.

The deploy migration does not run a full-table historical backfill on
`sessions`. It adds nullable `replay_retention_state`; `NULL` means legacy row,
so existing rows keep the old visibility behavior through `replay_available`,
`recording_deleted`, `is_replay_expired`, and quota guards. New reconciliation
writes precise states going forward; any historical cleanup can run later as a
low-priority maintenance job.

Rules are evaluated after the backend receives the session. Examples include:

- minimum session duration before a replay is worth retaining
- rage taps or dead taps
- crashes or ANRs
- failed onboarding or checkout paths
- users who churn or do not return after a key flow
- customer-defined filters

Immediate rules, such as crash or rage tap, decide during session
reconciliation. Delayed rules, such as churn or failure to return, stay
`pending` until the decision window elapses. Pending sessions use
`replay_retention_state=buffered`: visual artifacts can exist and
`replay_available=true` can reflect that artifact truth, but normal dashboard
replay surfaces filter buffered rows out. The buffer is capped by
`RJ_SMART_CAPTURE_BUFFER_MAX_REPLAYS`, defaulting to `200000`, and the decision
window is capped at 7 days.

When a delayed session is buffered, `smart_capture_decided_at` and
`replay_quota_counted_at` remain null. When a session is finally kept,
`replay_retention_state=saved` and `project_usage.session_replays` increments
exactly once via `replay_quota_counted_at`. When a session is discarded,
analytics/events/metrics remain queryable, `replay_available=false` is set,
`replay_retention_state=analytics_only`, visual replay artifacts are abandoned,
and replay usage does not increment. Replay quota is re-checked at promotion
time; if exhausted, the visual replay is discarded and analytics remains intact.

Rules are normalized JSON. The backend evaluator does not know or care whether a
rule was created manually or by the AI builder. Compound `all` clauses and scoped
metrics, such as rage taps on a specific screen/page, use the same evaluator.

## Observe-Only Is Different

Observe-only mode means the customer or SDK intentionally requested analytics
without visual replay capture.

Smart capture discard means the session was eligible for replay, but the server
decided not to retain the replay because it did not match the configured rules.

Replay quota exhaustion means the session was eligible for replay, but the
current plan had no replay quota remaining.

These states are intentionally distinct so analytics remains trustworthy and
operations dashboards can tell why a replay is unavailable.
