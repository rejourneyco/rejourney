# Billing + Usage Architecture (Visual)

## Flow Index

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [B1] Upload Lanes -> [B2] Ingest Core -> [B3] Usage Aggregation -> [B6] UI │
│                               ↘ [B4] Promotion                              │
│ [B5] Stripe State feeds [B2]/[B3]/[B6]                                      │
│ [B7] Redis Plane supports [B2]/[B4]                                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

## [B1] Upload Lanes (SDK)

```text
┌──────────────────────────────┐             ┌──────────────────────────────┐
│         Events Lane          │             │   Screenshots Segment Lane   │
│                              │             │                              │
│ POST /api/ingest/presign     │             │ POST /api/ingest/segment/presign
│ PUT  upload relay URL        │             │ PUT  upload relay URL        │
│ POST /api/ingest/batch/complete           │ POST /api/ingest/segment/complete
└──────────────┬───────────────┘             └──────────────┬───────────────┘
               │                                            │
               └──────────────────────┬─────────────────────┘
                                      ▼
                              [B2] Ingest Core
```

## [B2] Ingest Core (Captured Sessions + Replay Quota Gate)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Ingest Request Processing                           │
│                                                                              │
│  1) Sampling Gate                                                            │
│     project sampleRate / client isSampledIn is evaluated first               │
│       sampled out => no replay quota decision and no replay quota usage      │
│                                                                              │
│  2) Billing Gate                                                             │
│     checkBillingStatus(teamId)                                               │
│       ├─ teams.payment_failed_at ? -> hard block                             │
│       └─ getTeamSessionUsage(teamId) -> replay quota check                   │
│          quota exhausted => analytics accepted, replay disabled              │
│                                                                              │
│  3) Session Upsert                                                           │
│     ensureIngestSession(projectId, sessionId) -> created?                    │
│                                                                              │
│  4) Captured Session Counting (unlimited analytics)                          │
│     if created == true                                                       │
│       -> incrementProjectSessionCount(projectId, teamId,+1)                  │
│          writes project_usage.sessions                                       │
│          quota-exhausted sessions still count here                           │
│                                                                              │
│  5) Replay Quota Counting (single replay increment)                          │
│     when reconciliation first sets replay_available=true                     │
│       -> incrementProjectSessionReplayIfNeeded(sessionId)                    │
│          writes project_usage.session_replays                                │
│          sets sessions.replay_quota_counted_at                               │
│          invalidates Redis replay cache and checks usage alerts              │
│     if quota exhausted, sessions.replay_quota_billing_exhausted=true         │
│       and analytics artifacts continue without replay quota usage            │
│                                                                              │
│  6) Artifact Complete                                                        │
│     updates recording_artifacts + session_metrics                            │
│                                                                              │
│  7) Idempotency (retry-safe ingest)                                          │
│     get/set ingest:idempotency:* keys in Redis                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
                 ┌──────────────────────────────┐
                 │  writes project_usage table  │
                 └──────────────┬───────────────┘
                                ▼
                        [B3] Usage Aggregation
```

## [B3] Usage Aggregation (Replay Quota vs Captured Analytics)

```text
┌─────────────────────────────────────┐      ┌──────────────────────────────────┐
│        FREE (Owner Scoped)          │      │         PAID (Team Scoped)       │
│                                     │      │                                  │
│ users.id (owner)                    │      │ teamId                           │
│   -> teams.owner_user_id = owner    │      │   -> teams.stripe_subscription_id│
│      AND no subscription            │      │      exists                      │
│   -> projects in those free teams   │      │   -> projects in that team       │
│   -> SUM(session_replays)           │      │   -> SUM(session_replays)        │
│      for replay quota               │      │      for replay quota            │
│   -> SUM(project_usage.sessions)    │      │   -> SUM(project_usage.sessions) │
│      for unlimited analytics count  │      │      for unlimited analytics     │
│   -> compare replays vs 5000        │      │   -> compare replays vs Stripe   │
│                                     │      │      metadata.session_limit      │
└─────────────────────────────────────┘      └──────────────────────────────────┘
```

`project_usage.sessions` is now captured analytics sessions. It is not a replay
quota ledger and reconciliation may only raise it from `sessions` table ground
truth, never lower preserved usage.

`project_usage.session_replays` is the quota ledger. Billing warnings, SDK
remote config, plan usage, free-tier usage, and quota exhaustion all read this
counter.

Old API fields remain replay aliases:

```text
sessionsUsed      = sessionReplaysUsed
sessionLimit      = sessionReplayLimit
sessionsRemaining = sessionReplaysRemaining
percentUsed       = sessionReplayPercentUsed
```

New API fields expose both concepts:

```text
sessionsCaptured
sessionReplaysUsed
sessionReplayLimit
sessionReplaysRemaining
sessionReplayPercentUsed
```

## [B4] Replay Visibility Branch (Visual Presence + Intent)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                         POST /api/ingest/session/end                         │
│                                      │                                       │
│                                      ▼                                       │
│                 Replay visibility no longer mutates at session end           │
│                                      │                                       │
│             Session appears in replay archive iff visual replay data exists  │
│             (screenshots or rrweb), replay is not deleted/expired, and the   │
│             session was not forced analytics-only by replay quota exhaustion │
│                                                                              │
│        Quota-exhausted sessions remain analytics sessions and carry          │
│        sessions.replay_quota_billing_exhausted=true so missing visuals are   │
│        expected, not treated as an upload failure.                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

## [B4a] Future Smart Capture Decision Layer

The replay usage split is intentionally shaped so server-side smart capture can
be added without changing iOS, RN iOS, RN Android, or Web packages.

The intended order is:

```text
SDK / project gates
  -> SDK master switch / rejourneyEnabled
  -> project recording switch
  -> sampleRate / sampled-out decision
  -> observe-only or no-record configuration

Captured session ingest
  -> session row materializes
  -> analytics/events/metrics are accepted
  -> project_usage.sessions increments as unlimited captured analytics

Replay quota gate
  -> if replay quota is exhausted:
       discard or skip visual replay data
       keep analytics/events/metrics
       sessions.observe_only remains false
       sessions.replay_quota_billing_exhausted = true
       sessions.replay_available = false
       do not increment project_usage.session_replays

Smart capture rules
  -> if replay quota remains:
       evaluate server-side keep/toss rules
       examples: minimum session duration, rage/dead taps, crashes, ANRs,
                 failed onboarding return, churn/retention outcome, sampled
                 funnels, requested customer predicates
  -> if qualified:
       retain replay artifacts
       sessions.replay_available = true
       incrementProjectSessionReplayIfNeeded(sessionId)
       project_usage.session_replays += 1 exactly once
  -> if not qualified:
       keep analytics/events/metrics
       do not expose replay
       do not increment project_usage.session_replays
       optionally purge visual artifacts after the decision window
```

Important semantics:

- Sampling and explicit observe-only/no-record decisions are first-layer controls.
- Replay quota exhaustion is not observe-only mode; it uses
  `replay_quota_billing_exhausted` as the audit marker.
- Smart capture should run after hard first-layer gates and after replay quota is
  known to be available.
- `replay_available=true` should mean "this replay was intentionally retained
  and is available to view."
- `replay_quota_counted_at` should be set only for retained, available replays
  that count toward replay usage.
- Some smart capture rules are immediate (`duration >= N seconds`, crash, rage
  tap); others are delayed/offline (`failed to return after onboarding`,
  churned later). Delayed rules need a decision window before visual artifacts
  are purged.

Likely future schema for full auditability:

```text
sessions.smart_capture_decision        kept | discarded | pending
sessions.smart_capture_reason          min_duration | rage_tap | crash | ...
sessions.smart_capture_decided_at      timestamp
sessions.smart_capture_discarded_at    timestamp null
```

Do not overload `observe_only` for smart capture. Observe-only means the customer
or SDK intentionally requested non-visual analytics. Smart-capture discard means
the session was eligible for replay capture but the server chose not to retain it.

## [B5] Stripe State + Webhooks

```text
┌──────────────┐      ┌──────────────────────────────┐      ┌─────────────────┐
│  Dashboard   │─────▶│  Stripe API / Billing Portal │─────▶│ Stripe Webhooks │
└──────────────┘      └──────────────┬───────────────┘      └────────┬────────┘
                                     │                               │
                                     │ updates teams fields          │ idempotency
                                     ▼                               ▼
                      ┌────────────────────────────────────────────────────┐
                      │ teams:                                              │
                      │ - stripe_subscription_id                            │
                      │ - stripe_price_id                                   │
                      │ - billing_cycle_anchor                              │
                      │ - payment_failed_at                                 │
                      │                                                     │
                      │ stripe_webhook_events: processed event ids          │
                      └────────────────────────────────────────────────────┘
```

These fields affect [B2] gate behavior and [B3] aggregation mode.

## [B6] UI Counters (Why Values Can Differ)

```text
┌─────────────────────────────────────┐      ┌──────────────────────────────────┐
│ Top Bar Project Sessions            │      │ Billing / Account Free Tier      │
│                                     │      │                                  │
│ Source: sessions stats              │      │ Source: aggregated project_usage │
│ (project list / last 7 days)        │      │ (replay quota + captured count)  │
└─────────────────────────────────────┘      └──────────────────────────────────┘
```

Mismatch pattern:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ sessions > 0 but project_usage empty -> Top Bar shows sessions, Billing 0   │
│                                                                              │
│ New ingest flow in [B2] prevents this for new captured sessions.            │
│ Replay usage only rises after replay_available=true and counted_at is set. │
└──────────────────────────────────────────────────────────────────────────────┘
```

Billing UI should show both:

```text
Session replays recorded: quota progress bar
Sessions captured: unlimited analytics sessions
```

Pricing/public pages should describe plans as `session replays/mo` and include
`Unlimited analytics sessions`.

## [B7] Redis Plane (What It Does In This System)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                                  Redis                                       │
│                                                                              │
│  A) Replay Limit Cache + Stampede Lock                                       │
│     keys: sessions:{teamId}:{period}                                         │
│           session_lock:{teamId}:{period}                                     │
│     used by getSessionLimitCacheWithLock() in billing gate                   │
│     stores replay aliases plus explicit replay/captured fields               │
│                                                                              │
│  B) Ingest Idempotency                                                       │
│     keys: ingest:idempotency:{projectId}:{idempotencyKey}                    │
│     prevents duplicate counting/processing on retries                        │
│                                                                              │
│  C) Replay Promotion Reason Rate Limits                                      │
│     keys: replay_rate:{projectId}:{reason}:{windowId}                        │
│     limits floods (crash/anr/rage/etc.)                                      │
│                                                                              │
│  D) Upload Token State (short-lived)                                         │
│     keys: upload:token:{projectId}:{deviceId}                                │
│                                                                              │
│  Degradation behavior:                                                       │
│  - if Redis cache/lock fails: fallback to DB path                            │
│  - v1 cache fields sessionsUsed/sessionLimit remain replay aliases           │
│  - if idempotency key is missing/unavailable: less retry dedupe protection   │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Schema View (Billing-Relevant)

```text
┌───────────┐      ┌─────────┐      ┌─────────────┐      ┌──────────────┐
│   users   │◀────▶│  teams  │◀────▶│  projects   │◀────▶│ project_usage │
└───────────┘      └─────────┘      └─────────────┘      └──────────────┘
                        │
                        ├────────────▶ billing_usage
                        ├────────────▶ billing_notifications
                        └────────────▶ stripe_webhook_events
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Redis keys (runtime plane, not SQL schema):                                 │
│ sessions:*  session_lock:*  ingest:idempotency:*  replay_rate:* upload:token:* │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
┌───────────┐
│ sessions  │  (analytics/session timeline)
└─────┬─────┘
      ├────────────▶ replay_promoted / replay_promoted_reason (promotion only)
      ├────────────▶ replay_quota_billing_exhausted (analytics-only by quota)
      └────────────▶ replay_quota_counted_at (idempotent replay quota count)
```

## Screenshot-Only Session Trace (End-to-End)

```text
SDK screenshots
   -> /api/ingest/segment/presign
   -> ensureIngestSession(created=true)
   -> incrementProjectSessionCount (+1 captured session)
   -> project_usage.sessions updated
   -> /api/ingest/segment/complete
   -> session_metrics.screenshot_segment_count += 1
   -> replay archive visibility becomes true
   -> incrementProjectSessionReplayIfNeeded(sessionId)
   -> project_usage.session_replays += 1
   -> sessions.replay_quota_counted_at set
```

If the replay quota is exhausted before the session materializes, the events
lane still creates/updates the session row, but visual presign routes skip
upload and the row is marked:

```text
sessions.replay_quota_billing_exhausted = true
sessions.replay_available = false
```

`GET /api/sdk/config` represents replay quota exhaustion as
`billingBlocked=false`, `recordingEnabled=false`, and
`replayQuotaBillingExhausted=true`. Existing SDKs therefore continue normal
analytics paths without starting visual replay capture.

These rows are intentionally excluded from replay-availability health metrics,
because no replay was meant to become available.

## Replay Usage Split Migration

Migration `20260601130000_replay_usage_split` adds:

```text
project_usage.session_replays integer default 0 not null
billing_usage.session_replays integer default 0 not null
sessions.replay_quota_counted_at timestamp null
billing_notifications.dedupe_key text null
```

Backfill rules:

- Copy `project_usage.sessions` into `project_usage.session_replays` when the new column is still zero.
- Copy `billing_usage.sessions` into `billing_usage.session_replays` when the new column is still zero.
- Mark existing `sessions.replay_quota_counted_at` so pre-migration sessions already represented in the preserved replay ledger cannot increment replay usage again later.
- Backfill does not call alert sending and does not lower any existing current-period usage.
- Existing `warning_80` and `limit_100` notifications get a canonical dedupe key where possible; duplicate historical rows are left alone and only the oldest row becomes the keyed record.

Stripe metadata stays backward compatible. Active prices may keep `session_limit`;
that key now means monthly session replay limit. Add `session_replay_limit` only
after every active price carries both keys and all runtime consumers have been
migrated.

## Warning Behavior

Billing warnings still use the existing alert types:

```text
warning_80
limit_100
```

The trigger is session replay usage, not captured analytics sessions. Alerts are
checked only after `project_usage.session_replays` increments. Migration/backfill
must never send warning emails.

Email and dashboard copy should say "session replay usage" and "session replays
remaining." Notification metadata keeps old aliases (`sessionsUsed`,
`sessionLimit`) and adds explicit replay fields (`sessionReplaysUsed`,
`sessionReplayLimit`, `sessionsCaptured`, `usageMetric=session_replays`).

## No Package Change Guarantee

This split is server/dashboard/docs only. No iOS, RN iOS, RN Android, or Web
package change is required.

Existing packages already rely on server config and ingest responses:

- Sampling remains the top layer. If a session is sampled out, there is no replay upload and no replay quota usage.
- Replay quota exhaustion is returned server-side as `recordingEnabled=false`, `billingBlocked=false`, and `replayQuotaBillingExhausted=true`.
- Analytics/events are still accepted server-side even when replay quota is exhausted.
- Stale visual uploads for quota-exhausted sessions are skipped/ignored by ingest and the row is marked `replay_quota_billing_exhausted=true`.

## Grafana / Replay Availability

Replay-availability dashboards must count only sessions that were meant to become
available:

```sql
observe_only = false
AND replay_quota_billing_exhausted = false
```

Quota-exhausted analytics-only rows are excluded because their missing
screenshots/rrweb are expected billing behavior, not upload failure.

## Production Rollout

1. Run local tests and type checks for backend/dashboard billing paths.
2. Push/merge only after local verification passes.
3. Wait for CI to go green.
4. After production SSH is provided, run the production migration/backfill.
5. Verify in production:
   - no existing current-period replay usage was reset or lowered.
   - replay quota checks use `project_usage.session_replays`.
   - captured sessions continue beyond replay quota.
   - warning notifications still work and do not duplicate old-period warnings.
   - dashboard/API show both replay and captured counters.
   - Grafana replay-availability panels exclude `replay_quota_billing_exhausted` sessions.

## Legacy Billing Compatibility Cleanup

Do not do these in the replay split deploy. Track them for later cleanup:

- Remove old API aliases (`sessionsUsed`, `sessionLimit`, `sessionsRemaining`, `percentUsed`) after at least two billing cycles and after all dashboard/API consumers use explicit replay fields.
- Optionally rename Stripe metadata to `session_replay_limit` only after active prices carry both `session_limit` and `session_replay_limit`.
- Remove v1 Redis cache fallback after one deploy plus the full cache TTL.
- Keep `project_usage.sessions` permanently as captured analytics sessions.
- Keep old billing notification types (`warning_80`, `limit_100`) unless historical notification rows are migrated.
- Keep `sessions.replay_quota_billing_exhausted` as the audit marker for analytics-only sessions caused by replay quota exhaustion.
