# Flutter SDK 0.3.0

Published to pub.dev as `rejourney 0.3.0`.

## Highlights

- Adds stable incident identifiers across live telemetry and fault recovery so
  duplicate crash and ANR transports can be merged reliably.
- Adds iOS MetricKit crash and hang diagnostics with attributed call trees and
  correlation to the session that first detected a main-thread freeze.
- Improves iOS ANR accuracy by marking watchdog reports without a trustworthy
  main-thread stack as incomplete.
- Queues every pending Android and iOS incident and removes only the
  successfully delivered record, preventing diagnostics from overwriting one
  another.
- Preserves original Android Java/Kotlin crash frames and uncaught iOS
  exception stacks through next-launch recovery.
- Reports descriptive Flutter exception categories together with incident ID,
  source, and handled state through both native bridges.
- Makes the Android debug crash hook exercise the real uncaught-exception,
  persistence, and next-launch delivery path.
- Adds Android, iOS, Dart, and integration coverage for incident correlation,
  durable queues, and backward-compatible recovery.

## Compatibility

- No breaking public Dart API changes.
- Pending crash and ANR records written by earlier Flutter SDK versions remain
  readable.
- Existing backend integrations remain compatible.
- No backfill or API v2 migration is required.

## Upgrade

```bash
flutter pub add rejourney:^0.3.0
```
