# Browser SDK 0.5.0

Published to npm as `@rejourneyco/browser@0.5.0`.

## Highlights

- Adds optional Redux and Redux Toolkit replay middleware. Every dispatched Redux action can appear beside the replay with its action type, sanitized payload, sequence number, reducer duration, and previous/next state snapshots.
- Adds privacy and volume controls for Redux capture: default redaction for secret-like keys, bounded depth/array/object/string serialization, a 64 KiB event limit, predicates, action/state sanitizers, custom redaction keys, and `captureState: 'after'` or `'none'` modes.
- Exposes the integration through `@rejourneyco/browser/redux` with TypeScript declarations, while also exporting the middleware and types from `@rejourneyco/browser`.

## Compatibility

- No breaking changes to existing browser SDK initialization or recording behavior.
- Redux replay is opt-in. Existing applications do not need Redux installed unless they use Redux, and no additional Rejourney package is required.

## Upgrade

```bash
npm install @rejourneyco/browser@0.5.0
```

Then append `createRejourneyReduxMiddleware()` to the existing Redux Toolkit middleware chain when Redux action/state replay is wanted.
