Billing + Usage Architecture (Visual)


Flow Index:
┌──────────────────────────────────────────────────────────────────────────────┐
│ [B1] Upload Lanes → [B2] Ingest Core → [B3] Usage Aggregation → [B6] UI    │
│                                ↘ [B4] Promotion                              │
│ [B5] Stripe State feeds [B2]/[B3]/[B6]                                       │
│ [B7] Redis Plane supports [B2]/[B4]                                           │
└──────────────────────────────────────────────────────────────────────────────┘


[B1] Upload Lanes (SDK)

┌──────────────────────────────┐             ┌──────────────────────────────┐
│         Events Lane          │             │   Screenshots Segment Lane   │
│                              │             │                              │
│ POST /api/ingest/presign     │             │ POST /api/ingest/segment/presign
│ PUT  presigned S3 URL        │             │ PUT  presigned S3 URL        │
│ POST /api/ingest/batch/complete           │ POST /api/ingest/segment/complete
└──────────────┬───────────────┘             └──────────────┬───────────────┘
               │                                            │
               └──────────────────────┬─────────────────────┘
                                      ▼
                              [B2] Ingest Core


[B2] Ingest Core (Counting + Gate)

┌──────────────────────────────────────────────────────────────────────────────┐
│                          Ingest Request Processing                           │
│                                                                              │
│  1) Billing Gate                                                             │
│     checkBillingStatus(teamId)                                               │
│       ├─ teams.payment_failed_at ? -> block                                 │
│       └─ canUserRecord(ownerUserId, teamId) -> limit check                  │
│          (uses Redis-backed session limit cache+lock)                       │
│                                                                              │
│  2) Session Upsert                                                           │
│     ensureIngestSession(projectId, sessionId) -> created?                   │
│                                                                              │
│  3) Session Counting (single increment)                                      │
│     if created == true -> incrementProjectSessionCount(projectId, teamId,+1)│
│                          writes project_usage.sessions                       │
│                          invalidates Redis session cache                     │
│                                                                              │
│  4) Artifact Complete                                                        │
│     updates recording_artifacts + session_metrics                            │
│                                                                              │
│  5) Idempotency (retry-safe ingest)                                          │
│     get/set ingest:idempotency:* keys in Redis                               │
└──────────────────────────────────────────────────────────────────────────────┘

                 ┌──────────────────────────────┐
                 │  writes project_usage table  │
                 └──────────────┬───────────────┘
                                ▼
                        [B3] Usage Aggregation


[B3] Usage Aggregation (Free vs Paid)

┌─────────────────────────────────────┐      ┌──────────────────────────────────┐
│        FREE (Owner Scoped)          │      │         PAID (Team Scoped)       │
│                                     │      │                                  │
│ users.id (owner)                    │      │ teamId                           │
│   -> teams.owner_user_id = owner    │      │   -> teams.stripe_subscription_id│
│      AND no subscription            │      │      exists                      │
│   -> projects in those free teams   │      │   -> projects in that team       │
│   -> SUM(project_usage.sessions)    │      │   -> SUM(project_usage.sessions) │
│      per team current period        │      │      for team current period     │
│   -> compare vs 5000                │      │   -> compare vs Stripe price     │
│                                     │      │      metadata.session_limit      │
└─────────────────────────────────────┘      └──────────────────────────────────┘

                     feeds canUserRecord() and billing dashboards


[B4] Promotion Branch (Replay Visibility, NOT Billing)

┌──────────────────────────────────────────────────────────────────────────────┐
│                         POST /api/ingest/session/end                         │
│                                      │                                       │
│                                      ▼                                       │
│                        evaluateAndPromoteSession()                           │
│                                      │                                       │
│                    ┌─────────────────┴─────────────────┐                     │
│                    ▼                                   ▼                     │
│           promoted = true                      promoted = false              │
│      sessions.replay_promoted = true      sessions.replay_promoted = false  │
│                                                                              │
│      Redis replay_rate:* window counters throttle promotion reasons          │
│                                                                              │
│                      Billing usage is unchanged here.                        │
│            Billing was already counted in [B2] on session creation.          │
└──────────────────────────────────────────────────────────────────────────────┘


[B5] Stripe State + Webhooks

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

These fields affect [B2] gate behavior and [B3] aggregation mode.


[B6] UI Counters (why values can differ)

┌─────────────────────────────────────┐      ┌──────────────────────────────────┐
│ Top Bar Project Sessions            │      │ Billing / Account Free Tier      │
│                                     │      │                                  │
│ Source: sessions stats              │      │ Source: aggregated project_usage │
│ (project list / last 7 days)        │      │ (free-tier or team usage APIs)   │
└─────────────────────────────────────┘      └──────────────────────────────────┘

Mismatch pattern:
┌──────────────────────────────────────────────────────────────────────────────┐
│ sessions > 0 but project_usage empty -> Top Bar shows sessions, Billing 0   │
│                                                                              │
│ New ingest flow in [B2] prevents this for new sessions.                     │
│ Historical sessions before fix may require one-time project_usage backfill. │
└──────────────────────────────────────────────────────────────────────────────┘


[B7] Redis Plane (what it does in this system)

┌──────────────────────────────────────────────────────────────────────────────┐
│                                  Redis                                       │
│                                                                              │
│  A) Session Limit Cache + Stampede Lock                                     │
│     keys: sessions:{teamId}:{period}                                        │
│           session_lock:{teamId}:{period}                                    │
│     used by getSessionLimitCacheWithLock() in billing gate                  │
│                                                                              │
│  B) Ingest Idempotency                                                       │
│     keys: ingest:idempotency:{projectId}:{idempotencyKey}                   │
│     prevents duplicate counting/processing on retries                        │
│                                                                              │
│  C) Replay Promotion Reason Rate Limits                                      │
│     keys: replay_rate:{projectId}:{reason}:{windowId}                       │
│     limits floods (crash/anr/rage/etc.)                                     │
│                                                                              │
│  D) Upload Token State (short-lived)                                         │
│     keys: upload:token:{projectId}:{deviceId}                               │
│                                                                              │
│  Degradation behavior:                                                        │
│  - if Redis cache/lock fails: fallback to DB path                            │
│  - if idempotency key is missing/unavailable: less retry dedupe protection   │
└──────────────────────────────────────────────────────────────────────────────┘


Schema View (Billing-Relevant)

┌───────────┐      ┌─────────┐      ┌─────────────┐      ┌──────────────┐
│   users   │◀────▶│  teams  │◀────▶│  projects   │◀────▶│ project_usage │
└───────────┘      └─────────┘      └─────────────┘      └──────────────┘
                        │
                        ├────────────▶ billing_usage
                        ├────────────▶ billing_notifications
                        └────────────▶ stripe_webhook_events

┌──────────────────────────────────────────────────────────────────────────────┐
│ Redis keys (runtime plane, not SQL schema):                                 │
│ sessions:*  session_lock:*  ingest:idempotency:*  replay_rate:* upload:token:* │
└──────────────────────────────────────────────────────────────────────────────┘

┌───────────┐
│ sessions  │  (analytics/session timeline)
└─────┬─────┘
      └────────────▶ replay_promoted / replay_promoted_reason (promotion only)


Screenshot-Only Session Trace (end-to-end)

SDK screenshots
   -> /api/ingest/segment/presign
   -> ensureIngestSession(created=true)
   -> incrementProjectSessionCount (+1)
   -> project_usage updated
   -> /api/ingest/segment/complete
   -> /api/ingest/session/end
   -> evaluateAndPromoteSession
      ├─ promoted true  -> appears in replay archive
      └─ promoted false -> hidden from replay archive

In both promotion outcomes above, billing usage remains counted.
