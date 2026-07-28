# React Native SDK 1.4.0

Published to npm as `@rejourneyco/react-native@1.4.0`.

## Highlights

- Adds stable incident identifiers across Android and iOS live telemetry and
  fault recovery so duplicate crash and ANR transports can be merged reliably.
- Adds iOS MetricKit crash and hang diagnostics with attributed call trees and
  correlation to the session that first detected a main-thread freeze.
- Improves iOS ANR accuracy by marking watchdog reports without a trustworthy
  main-thread stack as incomplete.
- Queues every pending Android and iOS incident and removes only the
  successfully delivered record, preventing diagnostics from overwriting one
  another.
- Preserves original Android Java/Kotlin crash frames and uncaught iOS
  exception stacks through next-launch recovery.
- Includes incident source, exception category, and handled state for manually
  captured and automatically observed JavaScript errors.
- Retries persisted iOS incidents only after the JavaScript-provided endpoint
  and project key are available, including custom and self-hosted endpoints.
- Keeps React Native CLI autolinking warning-free on current releases through
  automatic root podspec discovery.

## Compatibility

- No breaking JavaScript or native API changes.
- Pending crash and ANR records written by earlier React Native SDK versions
  remain readable.
- Existing backend integrations remain compatible.
- No backfill or API v2 migration is required.

## Upgrade

```bash
npm install @rejourneyco/react-native@1.4.0
```
