# Rejourney Redux replay audit

- Project: Redux Commerce Lab (`85313cde-4a08-43f0-aa50-31f72d608ce4`)
- Session: `session_1784226185785_9f8000c6184a5af14d7c911a5c34155b`
- Raw artifacts: 74 (55 event chunks, 19 rrweb chunks)
- Captured Redux transitions: 13
- Captured rrweb events: 93

## Result

PASS — the stored replay contains Redux Toolkit action types and payloads, reducer duration and sequence, and sanitized before/after state synchronized by event timestamp. The journey includes filtering, cart mutations, promotion state, a rejected async checkout, recovery, a fulfilled checkout, and cart cleanup.

Sensitive Redux keys are redacted before upload, the demo payment token is absent from telemetry, and the replay contains no React Redux selector-stability warning.

## Verification

- PASS — everyRequiredActionCaptured
- PASS — everyRequiredRouteCaptured
- PASS — secretTokenAbsentFromTelemetry
- PASS — reduxEmailRedacted
- PASS — noReduxSelectorWarnings
- PASS — hasRrwebFullSnapshot
- PASS — hasRrwebIncrementalSnapshots
- PASS — checkoutRecovered

## Redux actions

| Action type | Count |
|---|---:|
| `catalog/categoryChanged` | 2 |
| `cart/productAdded` | 3 |
| `cart/quantityChanged` | 1 |
| `cart/promoApplied` | 1 |
| `checkout/placeOrder/pending` | 2 |
| `checkout/placeOrder/rejected` | 1 |
| `checkout/checkoutReset` | 1 |
| `checkout/placeOrder/fulfilled` | 1 |
| `cart/cartCleared` | 1 |

## Navigation

| Timestamp | Route |
|---|---|
| 2026-07-16T18:23:01.547Z | `/` |
| 2026-07-16T18:23:01.549Z | `/` |
| 2026-07-16T18:23:09.288Z | `/products` |
| 2026-07-16T18:23:10.758Z | `/products` |
| 2026-07-16T18:24:48.040Z | `/cart` |
| 2026-07-16T18:24:48.049Z | `/cart` |
| 2026-07-16T18:27:23.213Z | `/orders` |
| 2026-07-16T18:27:23.251Z | `/orders` |

The complete event envelopes, Redux before/after states, and rrweb event stream are in `replay-dump.json`.
