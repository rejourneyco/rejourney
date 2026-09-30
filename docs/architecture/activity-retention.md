# Activity counts and identity expiry

The dashboard used to recalculate mobile DAU and MAU from session identities on every request. Expiring those identities therefore rewrote history. The unfiltered MAU also summed DAU instead of deduplicating visitors across a 30-day window.

`activity_snapshots` stores project/day/platform counts: DAU, distinct 30-day MAU, version DAU, and country DAU. It contains no visitor IDs, session IDs, identity hashes, or sketches. Projects cascade-delete their counts. Routine expiry and explicit visitor erasure leave these aggregate counts in place.

The daily aggregator writes snapshots. Routine identity expiry also performs one final recount of affected completed windows before its first identity deletion, inside the same transaction. Subsequent historical reruns preserve complete counts when source identities have already been removed. DAU and MAU completeness are tracked independently; erased history is not reconstructed by treating sessions as distinct users.

For session retention shorter than 30 days, `visitor_activity_days` temporarily records a keyed identity hash, platform, and calendar day under a foreign key to the existing visitor ledger. This uses the existing HMAC secret, preserves the dashboard's user-first identity precedence, and does not extend the configured visitor lifetime. The retention worker prunes participation older than 31 days. Visitor deletion/expiry cascades to participation; explicit identity erasure additionally deletes matching hashes across device-ledger rows. If the configured visitor lifetime itself is too short to cover a monthly window, counts remain marked incomplete rather than silently claiming exact MAU.

Snapshots retain only aggregate counts after participation expires. A completeness marker for temporary membership is invalidated when the parent visitor expires early; pruning old participation cannot make a historical rerun overwrite a saved monthly total.

The rollup scheduler resumes missing calendar dates oldest first, at most seven per run. It includes projects active within the preceding 30 days so idle days receive snapshots. Charts include zero-session calendar days through the completed rollup watermark and mark incomplete user-count history. Missing legacy MAU is returned as null rather than an inflated sum of DAU.

## Initialization and verification

Run `node --import tsx scripts/backfillActivitySnapshots.ts` from the backend migration image. `ACTIVITY_BACKFILL_DAYS` defaults to 90 (maximum 366). The initializer processes project-days sequentially with transaction-local statement timeouts. It only initializes projects with surviving identities; it cannot restore erased ones.

PostgreSQL regression tests can be run against a disposable database using `ACTIVITY_TEST_DATABASE_URL`. Tests create a separate schema inside a rolled-back transaction. Coverage includes platform splits, deduplication, the 30-day boundary, identity scrubbing followed by reruns, short-retention monthly counts, and cascade deletion. Unit tests cover transactional expiry ordering, failure rollback, date-gap recovery, and zero-day calendar buckets.
