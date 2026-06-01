# Smart Capture And Replay Billing

Rejourney separates analytics sessions from session replays.

Analytics sessions can continue even when a replay is not retained. Replay usage
counts only when a replay is intentionally kept and made available.

## Decision Order

The capture pipeline is designed to make future smart capture rules server-side.
That means apps do not need package updates just to change which replays are
kept.

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

Smart capture
  -> if replay quota remains, evaluate keep/toss rules
  -> keep only sessions that match the configured rules
  -> count replay usage only for kept, available replays
```

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

## Future Smart Capture Rules

Smart capture rules can be evaluated after the backend receives the session.
Examples include:

- minimum session duration before a replay is worth retaining
- rage taps or dead taps
- crashes or ANRs
- failed onboarding or checkout paths
- users who churn or do not return after a key flow
- customer-defined filters

Immediate rules, such as crash or rage tap, can decide quickly. Delayed rules,
such as churn or failure to return, may require a decision window before the
visual replay data is retained or discarded.

## Observe-Only Is Different

Observe-only mode means the customer or SDK intentionally requested analytics
without visual replay capture.

Smart capture discard means the session was eligible for replay, but the server
decided not to retain the replay because it did not match the configured rules.

Replay quota exhaustion means the session was eligible for replay, but the
current plan had no replay quota remaining.

These states are intentionally distinct so analytics remains trustworthy and
operations dashboards can tell why a replay is unavailable.
