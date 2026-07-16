# Redux Commerce Lab

A multi-page Redux Toolkit commerce fixture for auditing Rejourney browser replay.

```bash
npm install
npm run dev
```

Open `http://localhost:4173`. The app uses the dedicated local `Redux Commerce Lab`
project and captures Redux actions with `createRejourneyReduxMiddleware`.

Suggested audit journey: Products → add two products → Cart → adjust quantity →
apply `NORTH20` → simulate checkout failure → dismiss → place order → Orders.

The fixture uses only fictional shopper data on the reserved `.invalid` domain.
Redux email and token fields are redacted before capture.

To inspect downloaded MinIO artifacts directly:

```bash
node scripts/dump-replay.mjs /path/to/session-artifacts audit
```

This writes a human-readable `audit/REPORT.md` and a complete
`audit/replay-dump.json` containing the event envelopes, Redux transitions, and
rrweb stream.

The separate `audit/LIFECYCLE.md` records the live-ingest/tab-close verification
and the dashboard presentation state after the two-minute inactivity check.
