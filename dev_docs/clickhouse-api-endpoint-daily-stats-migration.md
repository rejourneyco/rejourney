# ClickHouse Migration Plan: API Endpoint Daily Stats

Last updated: 2026-05-22

This is the implementation runbook for the first Rejourney table/workload to move from Postgres to ClickHouse.

The first target is the workload formerly represented by Postgres `api_endpoint_daily_stats`, not `sessions` and not `recording_artifacts`.

## Current Final-State Change Set

The migration has moved past the dual-read/fallback phase. The local change set for the final cutover does this:

- ClickHouse runtime reads use `api_endpoint_daily_rollups`.
- `api_endpoint_daily_rollups` is filled by a materialized view from `api_endpoint_request_events`.
- `backend/scripts/backfillClickHouseApiEndpointRollups.ts --replace` rebuilds rollups from ClickHouse imported history plus existing raw request facts.
- Artifact processing no longer writes Postgres `api_endpoint_daily_stats`.
- API endpoint analytics, region performance, dashboard insights, issue generation, and API degradation emails no longer read Postgres `api_endpoint_daily_stats`.
- Drizzle migration `20260522010000_drop_api_endpoint_daily_stats` drops the heavy historical Postgres table, then creates an empty no-op compatibility shell with the same name so old pods do not crash during the rolling deploy window.

After this ships, Postgres is not a rollback source for API endpoint analytics. Rollback means reverting application code and restoring historical data from backup, or keeping ClickHouse reads healthy.

Older sections below still preserve the phase history for auditability. Any instruction that references `backfillClickHouseApiEndpointStats.ts`, `clickhouse-backfill-api-stats`, `CLICKHOUSE_CUTOVER_DATE`, or `CLICKHOUSE_RAW_READS_AFTER` is from the earlier dual-read cutover phase and is superseded by the rollup rebuild path above.

Local verification on 2026-05-22:

- `npm run ci:local` passed end to end.
- `clickhouse-setup` recorded `004_api_endpoint_daily_rollups.sql`.
- `api_endpoint_daily_rollups` and `api_endpoint_daily_rollups_mv` existed in local ClickHouse.
- `npm --prefix backend run clickhouse:backfill:api-rollups -- --replace` completed locally.
- Local rollup smoke after the backfill returned 558 rollup rows, 13,330 calls, and 113 errors.
- Local Postgres drop migration was re-run after finalizing the compatibility shell; the shell existed with 0 rows, and a legacy `INSERT ... ON CONFLICT` returned `INSERT 0 0` while the table remained empty.

Production deploy note: for the cutover release, use `DEPLOY_CLICKHOUSE=true RUN_CLICKHOUSE_ROLLUP_BACKFILL=true` so `clickhouse-setup` applies migration `004`, `clickhouse-backfill-api-rollups` rebuilds the rollup, and only then do the new app deployments roll.

## Decision

Move the API endpoint analytics workload first.

Do not copy the current Postgres shape into ClickHouse 1:1. The Postgres table is a daily mutable aggregate maintained by high-frequency upserts. ClickHouse should receive append-only API request facts and then serve daily aggregates from those facts.

The replacement is:

- new ClickHouse fact table: `api_endpoint_request_events`
- optional imported historical aggregate table: `api_endpoint_daily_stats_imported`
- daily ClickHouse rollup table: `api_endpoint_daily_rollups`
- materialized view: `api_endpoint_daily_rollups_mv`
- compatibility query/service that returns the same logical shape the dashboard expected from the old Postgres table

This choice is deliberate:

- Postgres is currently paying write-amplification costs for aggregate upserts.
- ClickHouse is strongest for append-heavy analytical facts and grouped scans.
- Raw request facts preserve future p50/p90/p99 latency capability.
- The existing Postgres daily table cannot be used to reconstruct historical per-request facts, so historical backfill must be aggregate-only.

## Why This Table First

Production read-only inspection on 2026-05-21 showed this table as one of the worst write-amplification sources:

- `api_endpoint_daily_stats` was about 4.0 GiB total with about 9.4 million live rows.
- Its upsert query had about 5.3 million calls in `pg_stat_statements`.
- It was one of the top WAL producers, about 15 GiB in the observed stats window.

The current schema is in `backend/src/db/schema.ts`:

- `apiEndpointDailyStats` starts at `backend/src/db/schema.ts:843`.
- Unique key: `(project_id, date, endpoint, region)`.
- Fields: `total_calls`, `total_errors`, `sum_latency_ms`, `status_code_breakdown`, and nullable p50/p90/p99 columns.

The current writer is in `backend/src/services/ingestEventArtifactProcessor.ts`:

- events are scanned for `api_call` and `network_request`.
- per-endpoint aggregates are built in memory.
- each endpoint is written with `INSERT ... ON CONFLICT DO UPDATE` at `backend/src/services/ingestEventArtifactProcessor.ts:746`.

Current readers:

- `backend/src/routes/analytics.ts`
- `backend/src/routes/dashboardInsights.ts`
- `backend/src/routes/issues.ts`
- `backend/src/services/alertService.ts`

## Expected Resource Impact

This migration is primarily about removing analytical write/read pressure from the transactional Postgres primary and standby. The biggest expected wins after Phase 5, when Postgres writes for this workload are actually removed:

- lower Postgres CPU from eliminating high-frequency `INSERT ... ON CONFLICT DO UPDATE` aggregate churn
- lower WAL generation and replication pressure from fewer aggregate row rewrites
- lower index maintenance and autovacuum pressure on `api_endpoint_daily_stats`
- lower disk I/O and bloat growth for this workload
- lower Postgres buffer/page-cache competition between endpoint analytics and source-of-truth tables such as `sessions`, `recording_artifacts`, auth, billing, and storage config
- steadier dashboard API endpoint analytics latency for larger date ranges because ClickHouse is doing the grouped scans

Memory improvement is secondary. Postgres may retain more useful cache for core OLTP tables once `api_endpoint_daily_stats` is no longer hot, but this should be described as reduced cache pressure rather than a guaranteed large RSS drop.

What this does not solve:

- it does not make `sessions` or `recording_artifacts` smaller; those need separate archive/projection work
- it does not remove the need for `api-ingest` to be colocated with the Postgres primary
- it does not reduce Postgres SyncRep waits until the old Postgres aggregate writes are removed
- it does not make ClickHouse part of session capture availability; ClickHouse outage must be an analytics degradation, not an ingest outage

## What Not To Move First

Do not move canonical `sessions` first.

`sessions` is an operational state table with session lifecycle transitions, mutable status, auth-adjacent access control, reconciliation state, retention flags, and many dashboard list filters. It can get ClickHouse projections later, but Postgres should remain the source of truth during this migration.

Do not move canonical `recording_artifacts` first.

`recording_artifacts` is a hot artifact ledger and recovery/control-plane table. The objects already live in S3/R2. ClickHouse is useful later for artifact facts and historical analytics, but not as the first source-of-truth move.

## Three-Node HA Reality

With the current three-node k3s cluster, ClickHouse HA is possible for a single-node failure, not a whole-region failure.

Current topology from `dev_docs/allthingscloud.md`:

- one FSN1 node: Postgres primary, API ingest, ingress-heavy services
- two HEL1 nodes: Postgres standby/read path, workers, quorum capacity
- FSN1 to HEL1 latency is about 25 ms

Recommended production ClickHouse topology for the first migration:

- 3 ClickHouse Keeper voters, one per Kubernetes node
- 1 ClickHouse shard
- either 2 ClickHouse data replicas on the two HEL1 nodes, or 3 replicas with one per node

Preferred first production topology:

- Keeper: 3 replicas, one per node
- ClickHouse data: 2 replicas, both HEL1 nodes
- ClickHouse is internal-only
- Postgres remains the source of truth while dual-write is active
- ClickHouse can be rebuilt from Postgres aggregate history and future event artifacts if needed

Why not 3 data replicas immediately:

- the FSN1 node already carries Postgres primary, API ingest, upload ingress, web, and monitoring
- adding a ClickHouse data replica to FSN1 increases CPU, disk, and page-cache pressure on the write-critical Postgres node
- a second FSN1 node should come before putting heavier analytics storage on FSN1

Failure semantics with 3 Keeper voters:

| Failure | Expected behavior |
|---|---|
| any one node lost | Keeper quorum remains; ClickHouse remains available if at least one data replica remains |
| FSN1 lost | two HEL1 Keeper voters remain; two-HEL1 data topology remains queryable |
| one HEL1 lost | FSN1 plus the other HEL1 keep Keeper quorum; one ClickHouse data replica remains |
| both HEL1 nodes lost | FSN1 alone loses Keeper quorum; this is not regional HA |

Rule: ClickHouse must not be required for SDK ingest success. If ClickHouse is down, Postgres ingest and artifact processing must continue.

## Operator Choice

Use the Altinity Kubernetes Operator for the first implementation unless we intentionally switch to the newer official ClickHouse Operator before writing manifests.

Reasoning:

- Altinity operator has mature `ClickHouseInstallation` and `ClickHouseKeeperInstallation` resources.
- It supports ClickHouse Keeper without needing a separate ZooKeeper deployment.
- Its docs currently show operator version `0.26.3` and recommend pinning versions.
- The official ClickHouse Operator is now available and promising, but it is newer. It requires cert-manager for webhooks in the published getting-started flow. Production already has cert-manager, but local k3d currently does not.

Keep the application endpoint abstract enough that the operator can be swapped later:

- app talks to `CLICKHOUSE_URL`
- app code does not depend on Altinity resource names
- DDL files live in `backend/clickhouse/`
- setup job applies SQL, not operator-specific application behavior

Docs checked:

- ClickHouse Operator overview: https://clickhouse.com/docs/clickhouse-operator/overview
- ClickHouse Operator announcement: https://clickhouse.com/blog/clickhouse-kubernetes-operator
- Altinity operator install docs: https://docs.altinity.com/altinitykubernetesoperator/quickstartinstallation/
- Altinity Keeper replication docs: https://docs.altinity.com/altinitykubernetesoperator/kubernetesquickstartguide/quickzookeeper/

## ClickHouse Schema

### New Fact Table

Write one row per observed API/network request from event artifacts.

Table name:

```sql
rejourney.api_endpoint_request_events
```

DDL sketch:

```sql
CREATE DATABASE IF NOT EXISTS rejourney;

CREATE TABLE IF NOT EXISTS rejourney.api_endpoint_request_events_local
(
    project_id UUID,
    event_date Date,
    event_time DateTime64(3, 'UTC'),
    session_id String,
    artifact_id String,
    event_index UInt32,
    method LowCardinality(String),
    path String,
    endpoint String,
    region LowCardinality(String),
    status_code UInt16,
    is_error UInt8,
    duration_ms UInt32,
    source String DEFAULT 'event_artifact',
    schema_version UInt16 DEFAULT 1,
    inserted_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/rejourney/api_endpoint_request_events_local',
    '{replica}'
)
PARTITION BY toYYYYMM(event_date)
ORDER BY (project_id, event_date, endpoint, region, artifact_id, event_index)
TTL event_date + INTERVAL 400 DAY DELETE
SETTINGS index_granularity = 8192;
```

If the operator manages replicated database/table paths for us, prefer the operator's recommended replicated database/table form over hard-coding the Keeper path above. Keep this SQL in `backend/clickhouse/001_api_endpoint_request_events.sql`.

The logical unique source key is:

```text
artifact_id + event_index
```

The application should insert all API request rows for one artifact in one batch with:

```text
insert_deduplication_token = api-endpoint-events:<artifact_id>:v1
```

This protects job retries from double-inserting the same artifact block in ReplicatedMergeTree deduplication windows. It is not a substitute for careful backfill/checkpointing.

### Historical Aggregate Import Table

Existing Postgres history only has daily aggregate rows. It cannot reconstruct individual request events or true historical quantiles.

Create an imported history table:

```sql
CREATE TABLE IF NOT EXISTS rejourney.api_endpoint_daily_stats_imported_local
(
    project_id UUID,
    date Date,
    endpoint String,
    region LowCardinality(String),
    total_calls UInt64,
    total_errors UInt64,
    sum_latency_ms Int64,
    status_code_breakdown_json String,
    p50_latency_ms Nullable(UInt32),
    p90_latency_ms Nullable(UInt32),
    p99_latency_ms Nullable(UInt32),
    imported_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/rejourney/api_endpoint_daily_stats_imported_local',
    '{replica}'
)
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, date, endpoint, region);
```

Use this only for history before the ClickHouse cutover date.

### Compatibility Query

The API layer should expose the same logical shape the dashboard expects:

```sql
SELECT
    project_id,
    date,
    endpoint,
    region,
    sum(total_calls) AS total_calls,
    sum(total_errors) AS total_errors,
    sum(sum_latency_ms) AS sum_latency_ms,
    any(status_code_breakdown_json) AS status_code_breakdown_json,
    any(p50_latency_ms) AS p50_latency_ms,
    any(p90_latency_ms) AS p90_latency_ms,
    any(p99_latency_ms) AS p99_latency_ms
FROM rejourney.api_endpoint_daily_stats_imported
WHERE date < {cutover_date:Date}
GROUP BY project_id, date, endpoint, region

UNION ALL

SELECT
    project_id,
    event_date AS date,
    endpoint,
    region,
    count() AS total_calls,
    countIf(is_error = 1) AS total_errors,
    sum(duration_ms) AS sum_latency_ms,
    '{}' AS status_code_breakdown_json,
    toUInt32OrNull(quantileTDigest(0.50)(duration_ms)) AS p50_latency_ms,
    toUInt32OrNull(quantileTDigest(0.90)(duration_ms)) AS p90_latency_ms,
    toUInt32OrNull(quantileTDigest(0.99)(duration_ms)) AS p99_latency_ms
FROM rejourney.api_endpoint_request_events
WHERE event_date >= {cutover_date:Date}
GROUP BY project_id, event_date, endpoint, region;
```

The production implementation should include status code breakdown generation from raw `status_code` rows. The first SQL can return a map-like JSON object assembled in application code if that is easier and safer than forcing complex ClickHouse map SQL into the first release.

### Optional Materialized Rollup

Add a materialized daily rollup only after the raw fact insert path is proven idempotent.

Do not start with a materialized view if duplicate protection is not verified. ClickHouse materialized views react to inserts; if the same source rows are inserted twice outside the deduplication window, the rollup will double count them.

Docs checked:

- Replicated table engines: https://clickhouse.com/docs/engines/table-engines/mergetree-family/replication
- Deduplication strategies: https://clickhouse.com/docs/guides/developer/deduplication
- Bulk inserts: https://clickhouse.com/docs/optimize/bulk-inserts
- Async inserts: https://clickhouse.com/docs/optimize/asynchronous-inserts
- Node.js client: https://clickhouse.com/integrations/nodejs

## Backend Code Changes

### Dependencies

Add to `backend/package.json`:

```json
"@clickhouse/client": "<pinned-current-version>"
```

Run `npm install` from the repo root so both `package-lock.json` files update as needed.

### Config

Update `backend/src/config.ts` with optional ClickHouse settings:

```ts
CLICKHOUSE_ENABLED: z.string().transform(v => v === 'true').default('false'),
CLICKHOUSE_DUAL_WRITE_ENABLED: z.string().transform(v => v === 'true').default('false'),
CLICKHOUSE_READS_ENABLED: z.string().transform(v => v === 'true').default('false'),
CLICKHOUSE_URL: z.string().optional(),
CLICKHOUSE_USER: z.string().default('default'),
CLICKHOUSE_PASSWORD: z.string().optional(),
CLICKHOUSE_DATABASE: z.string().default('rejourney'),
CLICKHOUSE_ASYNC_INSERT: z.string().transform(v => v !== 'false').default('true'),
CLICKHOUSE_CUTOVER_DATE: z.string().optional(),
CLICKHOUSE_RAW_READS_AFTER: z.string().optional(),
CLICKHOUSE_REQUEST_TIMEOUT_MS: z.string().transform(Number).default('5000'),
```

Defaults must keep production safe:

- ClickHouse disabled by default.
- Dual-write disabled by default.
- Read cutover disabled by default.
- Missing ClickHouse secret must not crash pods while flags are false.

### Client

Add:

```text
backend/src/db/clickhouse.ts
```

Responsibilities:

- create the `@clickhouse/client` instance only when enabled
- expose `isClickHouseConfigured()`
- expose `pingClickHouse()`
- expose `insertApiEndpointRequestEvents(rows, options)`
- set a short request timeout
- use `JSONEachRow`
- set `async_insert=1` and `wait_for_async_insert=1` when configured
- pass `insert_deduplication_token` for artifact-scoped inserts
- log failures without including request URLs that may contain secrets

The official Node.js client supports `insert` with `format: 'JSONEachRow'`.

### API Stats Sink

Add:

```text
backend/src/services/clickhouseApiStatsSink.ts
```

Responsibilities:

- receive rows produced while scanning event artifacts
- batch rows by artifact
- write asynchronously outside the Postgres transaction
- never throw back into artifact processing when ClickHouse fails
- increment metrics/log counters for dropped or failed ClickHouse writes

Preferred durability path:

- use a BullMQ queue `rj-clickhouse-api-stats`
- job id: `api-endpoint-events:<artifact_id>:v1`
- worker batches jobs and inserts to ClickHouse
- retry with exponential backoff
- on final failure, leave enough log context to re-backfill by artifact/date

Acceptable first release if we keep Postgres as truth:

- in-process bounded buffer with periodic flush
- only while `CLICKHOUSE_DUAL_WRITE_ENABLED=true` and Postgres remains authoritative

Do not synchronously insert per endpoint in the current loop. ClickHouse docs recommend large batches and low insert-query rates; many tiny synchronous inserts will create too many parts.

### Artifact Processor

Update `backend/src/services/ingestEventArtifactProcessor.ts`:

- while iterating `eventsData`, build raw API request rows
- include deterministic `event_index`
- include `artifact_id`, `session_id`, `project_id`, method, normalized path, endpoint, status code, duration, and client timestamp
- keep the existing Postgres upsert while dual-write is being validated
- enqueue ClickHouse rows after the artifact is successfully parsed
- do not block artifact success on ClickHouse availability

The current aggregate object:

```ts
const endpointStats: Record<string, { calls: number; errors: number; latencySum: number; statusCodeBreakdown: Record<string, number> }> = {};
```

can remain for the Postgres dual-write period. The new ClickHouse rows should come from the raw event loop so future quantiles are possible.

### Query Service

Add:

```text
backend/src/services/apiEndpointStatsClickHouse.ts
```

Responsibilities:

- provide ClickHouse read helpers for API endpoint analytics reads
- use ClickHouse when `CLICKHOUSE_READS_ENABLED=true`
- fallback to Postgres on ClickHouse error while Postgres writes are still enabled
- return the same DTO shape currently built from `apiEndpointDailyStats`
- centralize internal endpoint filtering behavior so Postgres and ClickHouse paths match

Implemented first:

- `backend/src/routes/analytics.ts` can read API endpoint stats and region performance from ClickHouse
- ClickHouse failures fall back to the existing Postgres route path
- `backend/src/services/apiEndpointStatsClickHouse.ts` uses raw request facts only when `CLICKHOUSE_CUTOVER_DATE` is unset
- when `CLICKHOUSE_CUTOVER_DATE` is set, API endpoint and region reads combine imported historical aggregates before the cutover date with raw facts on/after the cutover date

Future refactor candidates:

- `backend/src/routes/dashboardInsights.ts`
- `backend/src/routes/issues.ts`
- `backend/src/services/alertService.ts`

Keep route response shapes unchanged.

### Backfill Script

Added:

```text
backend/scripts/backfillClickHouseApiEndpointStats.ts
```

Behavior:

- reads historical rows from Postgres `api_endpoint_daily_stats`
- writes to ClickHouse `api_endpoint_daily_stats_imported`
- pages by `(date, id)` so large imports do not use offset scans
- can run dry-run with `--dry-run`
- can limit to `--since`, `--until`, `--project-id`
- requires `--until YYYY-MM-DD` or `CLICKHOUSE_CUTOVER_DATE`
- treats `--until` as exclusive, matching the read-side cutover split
- uses per-batch `insert_deduplication_token`
- imported reads use `FINAL` on the `ReplacingMergeTree`, so retry duplicates do not double-count during cutover reads

Do not run full historical backfill inside deploy.

### ClickHouse Setup Script

Add:

```text
backend/scripts/setupClickHouse.ts
backend/clickhouse/001_api_endpoint_request_events.sql
backend/clickhouse/002_api_endpoint_daily_stats_imported.sql
```

Behavior:

- connect to ClickHouse
- apply DDL files in lexical order
- record applied files in a small ClickHouse table, for example `rejourney.schema_migrations`
- safe to rerun
- fail loudly if ClickHouse is enabled but unreachable
- local mode creates ordinary `MergeTree` / `ReplacingMergeTree` tables
- production mode sets `CLICKHOUSE_CLUSTER=default`; the setup script adds `ON CLUSTER default` and uses `ReplicatedMergeTree` / `ReplicatedReplacingMergeTree` engines with Keeper macros

This split is intentional: the local k8s stack is single-node and does not run Keeper, while production uses two ClickHouse data replicas behind the Altinity operator.

Add package script:

```json
"clickhouse:setup": "node --import tsx scripts/setupClickHouse.ts",
"clickhouse:backfill:api-stats": "node --import tsx scripts/backfillClickHouseApiEndpointStats.ts"
```

## Production k8s Changes

Production manifests live in `k8s/`.

### New Files

Added:

```text
k8s/clickhouse.yaml
k8s/clickhouse-setup.yaml
k8s/clickhouse-backfill-api-stats.yaml
```

The operator is intentionally installed by `scripts/k8s/deploy-release.sh` with Helm rather than checked into `k8s/`. It is pinned to Altinity operator `0.26.3` by default:

```bash
CLICKHOUSE_OPERATOR_VERSION=0.26.3
```

The historical backfill job is intentionally manual. It has no `app.kubernetes.io/part-of=rejourney` label, so the normal deploy/prune path does not run it. Run it explicitly only after ClickHouse setup succeeds and a cutover date has been chosen.

### Secrets

Update:

```text
scripts/k8s/k8s-sync-secrets.sh
```

Create `clickhouse-secret`:

```bash
--from-literal=CLICKHOUSE_ENABLED="${CLICKHOUSE_ENABLED:-false}"
--from-literal=CLICKHOUSE_DUAL_WRITE_ENABLED="${CLICKHOUSE_DUAL_WRITE_ENABLED:-false}"
--from-literal=CLICKHOUSE_READS_ENABLED="${CLICKHOUSE_READS_ENABLED:-false}"
--from-literal=CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://clickhouse-rejourney:8123}"
--from-literal=CLICKHOUSE_USER="${CLICKHOUSE_USER:-rejourney}"
--from-literal=CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:?CLICKHOUSE_PASSWORD is required when ClickHouse is deployed or enabled}"
--from-literal=CLICKHOUSE_DATABASE="${CLICKHOUSE_DATABASE:-rejourney}"
--from-literal=CLICKHOUSE_CUTOVER_DATE="${CLICKHOUSE_CUTOVER_DATE:-}"
--from-literal=CLICKHOUSE_RAW_READS_AFTER="${CLICKHOUSE_RAW_READS_AFTER:-}"
```

Production defaults are safe:

```bash
CLICKHOUSE_ENABLED=false
CLICKHOUSE_DUAL_WRITE_ENABLED=false
CLICKHOUSE_READS_ENABLED=false
CLICKHOUSE_CUTOVER_DATE=
CLICKHOUSE_RAW_READS_AFTER=
```

Important: GitHub Actions deploy does not run `scripts/k8s/k8s-sync-secrets.sh`. New required secrets can break pods if manifests reference them without `optional: true`. First merge should either:

- app and worker ClickHouse env secret refs are optional so normal deploys do not crash if `clickhouse-secret` is absent
- the operator/cluster path is gated by `DEPLOY_CLICKHOUSE=true`
- `clickhouse-secret` is required only when `DEPLOY_CLICKHOUSE=true` or any ClickHouse feature flag is true

### ClickHouse Cluster Manifest

`k8s/clickhouse.yaml` defines:

- 3 Keeper replicas
- 1 ClickHouse shard
- 2 ClickHouse data replicas on HEL1 for the first rollout
- persistent volumes with `rejourney-db-local-retain`
- resource requests/limits small enough not to starve Postgres
- Keeper anti-affinity across hostname
- ClickHouse `zone`/`distribution` placement on `rejourney.co/datacenter=hel1` with one replica per host
- internal operator service only, no Ingress

Initial sizing:

| Component | CPU request | Memory request | PVC |
|---|---:|---:|---:|
| Keeper | 250m | 512Mi | 10Gi |
| ClickHouse data | 1 CPU | 4Gi | 100Gi |

Review actual disk growth after one week before raising retention.

The app URL defaults to the operator-created CHI service:

```bash
CLICKHOUSE_URL=http://clickhouse-rejourney:8123
```

### App Env

Update `k8s/api.yaml`:

- `api-dashboard`: ClickHouse read env and flags
- `api-ingest`: optional env only; SDK ingest remains independent of ClickHouse

Update `k8s/workers.yaml`:

- `ingest-worker`: ClickHouse write env and flags
- `alert-worker`: ClickHouse read env if alerts move to the service

Do not add ClickHouse env to `ingest-upload`, `replay-worker`, `session-lifecycle-worker`, or `retention-worker` unless code needs it.

### Deploy Script

Update:

```text
scripts/k8s/deploy-release.sh
```

Added functions:

```bash
ensure_clickhouse_operator
apply_clickhouse_manifests
apply_clickhouse_setup_job
wait_for_clickhouse_setup_job
```

Deploy sequence is:

1. render manifests
2. remove ClickHouse manifests from the bulk render when `DEPLOY_CLICKHOUSE` is not true
3. apply namespace and cluster prerequisites
4. ensure cert-manager
5. apply storage class/support manifests
6. when `DEPLOY_CLICKHOUSE=true`, ensure Altinity operator/CRDs
7. when `DEPLOY_CLICKHOUSE=true`, apply ClickHouse Keeper/ClickHouse installation and wait for readiness
8. apply CNPG and wait for Postgres
9. pre-pull images
10. run regular Postgres `db-setup`
11. when `DEPLOY_CLICKHOUSE=true`, run `clickhouse-setup`
12. remove ClickHouse manifests from the bulk render path
13. apply app deployments
14. wait for rollouts

Do not let `clickhouse.yaml` be first applied in the bulk `kubectl apply -f "${RENDER_DIR}/"` step before its CRDs exist. Either apply ClickHouse manifests explicitly before the bulk apply and remove them from `RENDER_DIR`, or make the bulk step safe after CRD readiness.

The current deploy uses:

```bash
kubectl apply -f "${RENDER_DIR}/" --prune -l app.kubernetes.io/part-of=rejourney ...
```

Custom resources are not currently in the prune allowlist. That is good for avoiding accidental prune deletion, but it also means we should own ClickHouse CR ordering explicitly.

Important: `k8s/clickhouse.yaml` and `k8s/clickhouse-setup.yaml` intentionally do not carry `app.kubernetes.io/part-of=rejourney`, because the normal bulk apply uses that label as its prune selector. ClickHouse is applied explicitly instead.

### Monitoring

Add Grafana/Prometheus checks for:

- ClickHouse pod ready
- Keeper quorum healthy
- ClickHouse insert failures from app logs/metrics
- ClickHouse disk usage
- ClickHouse parts count
- ClickHouse query latency for API endpoint analytics
- app fallback count from ClickHouse to Postgres

If the operator exposes Prometheus metrics, add scrape config to existing monitoring manifests.

## Local k8s Changes

Local manifests live in `local-k8s/`.

Local does not need production HA. It needs functional parity for code and migrations.

Implementation status on branch `click-and-scale` as of 2026-05-21:

- local ClickHouse is implemented as a single-node StatefulSet in `local-k8s/clickhouse.yaml`
- local ClickHouse is exposed to host processes at `http://127.0.0.1:30123`
- fresh k3d clusters publish ClickHouse NodePorts `30123` and `30124`
- existing k3d clusters get a managed `kubectl port-forward` from `scripts/local-k8s/dev.sh`
- local Kubernetes pods use `http://clickhouse:8123` through `clickhouse-secret`
- `scripts/local-k8s/deploy.sh` now applies ClickHouse during `infra()` and waits for readiness
- `local-k8s/api.yaml` includes a `clickhouse-setup` Job that runs `backend/scripts/setupClickHouse.ts`
- `ingest-worker` dual-writes API request facts when ClickHouse is enabled
- `api` reads API endpoint stats and region performance from ClickHouse when `CLICKHOUSE_READS_ENABLED=true`
- `scripts/local-k8s/update-ips.sh` writes `VITE_API_URL=http://<LAN_IP>:3000` so the dashboard does not accidentally use a stale `127.0.0.1:3000` tunnel

### New Local Files

Add:

```text
local-k8s/clickhouse.yaml
```

Preferred local implementation:

- one `clickhouse/clickhouse-server` StatefulSet
- one NodePort service named `clickhouse` so pods use service DNS and host dev uses localhost
- one PVC on local-path
- no Keeper for the first local loop
- no public Ingress

This keeps `npm run ci:local` and `npm run dev` usable on a laptop.

If we want operator parity locally later, add an explicit `local-k8s/clickhouse-operator.yaml`, but do not make the first migration depend on a full local HA simulation.

### Local Secrets

Update:

```text
local-k8s/env.example
scripts/local-k8s/k8s-sync-secrets.sh
```

Add to `local-k8s/env.example`:

```env
CLICKHOUSE_ENABLED=true
CLICKHOUSE_DUAL_WRITE_ENABLED=true
CLICKHOUSE_READS_ENABLED=true
CLICKHOUSE_URL=http://127.0.0.1:30123
CLICKHOUSE_K8S_URL=http://clickhouse:8123
CLICKHOUSE_USER=rejourney
CLICKHOUSE_PASSWORD=rejourney
CLICKHOUSE_DATABASE=rejourney
CLICKHOUSE_CUTOVER_DATE=
CLICKHOUSE_RAW_READS_AFTER=
```

In local secret sync, create `clickhouse-secret` using `CLICKHOUSE_K8S_URL` for pods. The host keeps `CLICKHOUSE_URL=http://127.0.0.1:30123`.

Local development also needs:

```env
VITE_API_URL=http://<LAN_IP>:3000
```

`scripts/local-k8s/update-ips.sh` owns this value. The LAN IP form avoids collisions with local SSH tunnels bound to `127.0.0.1:3000` and works for mobile/device testing.

For host-side `npm run dev`, also ensure `.env.k8s.local` values point host processes to ClickHouse. If the host process talks through k8s service names, it will fail. Either:

- expose local ClickHouse with a NodePort and set host `CLICKHOUSE_URL=http://127.0.0.1:<port>`
- use `CLICKHOUSE_K8S_URL=http://clickhouse:8123` in the Kubernetes secret

Recommended local port:

```text
8123 -> NodePort 30123
9000 -> optional NodePort 30124 only if native client/debugging is needed
```

### Local Deploy Script

Update:

```text
scripts/local-k8s/deploy.sh
```

In `infra()`:

1. apply namespace
2. sync secrets
3. apply Postgres
4. apply Redis
5. apply MinIO
6. apply ClickHouse
7. wait for ClickHouse ready
8. apply pgbouncer

Add a local wait:

```bash
kubectl wait --for=condition=ready pod -l app=clickhouse -n "$NAMESPACE" --timeout=180s
```

In `wait_full()` or app deploy flow, make sure `clickhouse-setup` has completed before enabling local reads.

For existing clusters created before the ClickHouse NodePort mapping existed, `scripts/local-k8s/dev.sh host-restart` should start a managed port-forward:

```bash
kubectl -n rejourney-local port-forward svc/clickhouse 30123:8123 30124:9000
```

Fresh clusters should still publish the NodePorts directly through `scripts/local-k8s/deploy.sh`.

### Local App Manifests

Update:

```text
local-k8s/api.yaml
local-k8s/workers.yaml
```

Add the same env keys as production to:

- local `api`
- local `ingest-worker`
- local `alert-worker`

Local defaults are enabled so the laptop path exercises ClickHouse during `npm run ci:local`. Production defaults remain disabled until explicit cutover flags are set.

### Local CI Parity

Update:

```text
scripts/local-k8s/rejourney-ci.sh
```

The existing local flow builds API/web/migration images and applies local k8s. After adding ClickHouse:

- local checks should pass with ClickHouse enabled
- `ci:local:deploy` should apply ClickHouse infra
- ClickHouse setup should complete in the local deploy path
- host restart should verify `http://127.0.0.1:30123/ping`

If new env keys must stay mirrored between prod and local workers, update:

```text
scripts/check-worker-parity.mjs
```

The current parity check only validates a few worker env keys. It will not catch missing ClickHouse env unless we extend it.

## CI And Publish Process

Current GitHub Actions behavior:

- checks run on PRs targeting `main`
- image build runs only on `main`
- deploy runs only on `main`
- deploy can be skipped by the version gate if `package.json` version did not change, unless `workflow_dispatch` is used

Process:

1. Work on branch `click-and-scale`.
2. Add backend code, ClickHouse DDL, local k8s, prod k8s, deploy script changes, tests, and docs.
3. Run local checks:

```bash
npm run ci:local:checks
```

4. Run local deploy path:

```bash
npm run ci:local:deploy
```

5. If testing full local bootstrap:

```bash
npm run ci:local
```

6. Commit and push branch.
7. Open PR to `main`.
8. Let GitHub run backend, web, and k8s-config jobs.
9. Before merging the first production ClickHouse manifest change, decide one of:

- bump `package.json` version so the deploy version gate allows deploy, or
- use `workflow_dispatch` after merge

10. Merge to `main`.
11. CI builds and pushes API, web, and migration images.
12. CI SSHes to the VPS, resets `/opt/rejourney` to `origin/main`, and runs `scripts/k8s/deploy-release.sh`.

## Production SSH Process

Use SSH only for verification, secret sync, backfill jobs, and emergency flag changes. Do not make hand-edited live manifests the source of truth.

SSH:

```bash
ssh -i ~/.ssh/vps_deploy root@46.224.98.62
cd /opt/rejourney
```

Preflight:

```bash
kubectl get nodes -o wide
kubectl get pods -n rejourney -o wide
kubectl top nodes
kubectl get pvc -n rejourney
```

After operator deploy:

```bash
kubectl get crd | grep -i clickhouse
kubectl get pods -A | grep -i clickhouse
```

After ClickHouse deploy:

```bash
kubectl get pods,svc,pvc -n rejourney | grep -i clickhouse
kubectl get events -n rejourney --sort-by=.lastTimestamp | tail -n 40
```

ClickHouse smoke:

```bash
kubectl exec -n rejourney <clickhouse-pod> -- clickhouse-client -q "SELECT 1"
kubectl exec -n rejourney <clickhouse-pod> -- clickhouse-client -q "SELECT database, name, engine FROM system.tables WHERE database = 'rejourney'"
```

App rollout:

```bash
kubectl rollout status deployment/api-dashboard -n rejourney --timeout=600s
kubectl rollout status deployment/ingest-worker -n rejourney --timeout=600s
kubectl rollout status deployment/alert-worker -n rejourney --timeout=600s
```

Backfill should be a Kubernetes Job, not an ad hoc process that disappears from history.

Example:

```bash
kubectl apply -f k8s/clickhouse-backfill-api-stats.yaml
kubectl logs -n rejourney job/clickhouse-backfill-api-stats -f
```

Compare Postgres and ClickHouse:

```sql
-- Postgres
SELECT date, count(*), sum(total_calls)
FROM api_endpoint_daily_stats
WHERE date >= current_date - 7
GROUP BY date
ORDER BY date;

-- ClickHouse
SELECT date, count(), sum(total_calls)
FROM rejourney.api_endpoint_daily_stats_imported
WHERE date >= today() - 7
GROUP BY date
ORDER BY date;
```

For new raw facts after cutover:

```sql
SELECT event_date, count(), uniqExact(artifact_id), sum(duration_ms)
FROM rejourney.api_endpoint_request_events
WHERE event_date >= today() - 1
GROUP BY event_date
ORDER BY event_date;
```

## Rollout Phases

### Phase 0: Infrastructure Landed, Disabled

Goal: ClickHouse exists and apps still behave exactly as before.

Flags:

```env
CLICKHOUSE_ENABLED=false
CLICKHOUSE_DUAL_WRITE_ENABLED=false
CLICKHOUSE_READS_ENABLED=false
```

Checks:

- ClickHouse pods ready
- ClickHouse setup job succeeded
- app pods do not crash if `clickhouse-secret` is missing or disabled
- no route reads from ClickHouse

### Phase 1: Dual-Write, Postgres Reads

Goal: write future API request facts to ClickHouse while Postgres remains authoritative.

Flags:

```env
CLICKHOUSE_ENABLED=true
CLICKHOUSE_DUAL_WRITE_ENABLED=true
CLICKHOUSE_READS_ENABLED=false
```

Checks:

- `ingest-worker` logs show ClickHouse insert success
- retries do not double-count artifact rows
- ClickHouse disk and parts count are stable
- SDK ingest latency is unchanged
- Postgres `api_endpoint_daily_stats` still updates

### Phase 2: Historical Aggregate Backfill

Goal: import old Postgres daily aggregate rows into ClickHouse.

Run:

```bash
npm --prefix backend run clickhouse:backfill:api-stats -- --since 2025-01-01 --until <cutover-date> --batch-size 5000
```

Prefer Kubernetes Job invocation with the migration image in production:

```bash
kubectl delete job clickhouse-backfill-api-stats -n rejourney --ignore-not-found
kubectl apply -f k8s/clickhouse-backfill-api-stats.yaml
kubectl logs -n rejourney job/clickhouse-backfill-api-stats -f
```

For local k8s:

```bash
kubectl delete job clickhouse-backfill-api-stats -n rejourney-local --ignore-not-found
kubectl apply -f local-k8s/clickhouse-backfill-api-stats.yaml
./scripts/local-k8s/deploy.sh logs clickhouse-backfill-api-stats
```

Checks:

- row counts by date match
- `sum(total_calls)` by date matches
- `sum(total_errors)` by date matches
- cache keys do not hide stale compare results
- imported rows are visible through `api_endpoint_daily_stats_imported FINAL`

### Phase 3: Shadow Reads

Goal: compare ClickHouse answers without serving users from ClickHouse yet.

Add shadow mode in the API endpoint stats service:

- run Postgres query
- run ClickHouse query
- return Postgres response
- log structured diff counts and percentage differences

Do this only for limited projects or sampled requests if query load is high.

### Phase 4: Read Cutover

Goal: serve API endpoint analytics reads from ClickHouse.

Flags:

```env
CLICKHOUSE_READS_ENABLED=true
CLICKHOUSE_CUTOVER_DATE=<date dual-write became reliable>
CLICKHOUSE_RAW_READS_AFTER=
```

Keep Postgres writes enabled during this phase.

If the read cutover happens in the middle of a UTC day, do not choose between stale imported totals and incomplete raw facts. Use the same-day bridge:

1. run the final bounded backfill for today's date
2. set `CLICKHOUSE_CUTOVER_DATE` to tomorrow's UTC date
3. set `CLICKHOUSE_RAW_READS_AFTER` to the UTC timestamp immediately after the final backfill completes

That makes ClickHouse serve already-imported daily totals for today and add raw request facts inserted after that timestamp. For exact parity, briefly pause `ingest-worker` while the final same-day backfill runs, then resume it after dashboard reads are restarted.

Checks:

- analytics endpoint latency improves or stays stable
- issue generation still finds slow APIs
- alert worker still sends API degradation alerts
- dashboard response shape unchanged
- fallback-to-Postgres count stays near zero
- pre-cutover history appears from `api_endpoint_daily_stats_imported`
- post-cutover facts appear from `api_endpoint_request_events`
- same-day mid-cutover facts after `CLICKHOUSE_RAW_READS_AFTER` appear from `api_endpoint_request_events.inserted_at`

### Phase 5: Stop Postgres Writes For This Workload

Goal: remove Postgres write pressure from `api_endpoint_daily_stats`.

Only after at least one clean week of ClickHouse reads:

- stop the Postgres upsert in `ingestEventArtifactProcessor.ts`
- keep the table for rollback/history
- keep backfill/import code for repair
- continue serving from ClickHouse

Do not drop the Postgres table in the same release that stops writes.

### Phase 6: Archive Or Drop Old Postgres Table

Only after a longer soak period:

- export/backup `api_endpoint_daily_stats`
- document retention decision
- drop or truncate old partitions/rows if storage pressure warrants it

This should be a separate migration and a separate deploy.

## Rollback

Fast rollback:

```env
CLICKHOUSE_READS_ENABLED=false
```

As long as Postgres dual-write remains active, rollback is config-only.

If dual-write to Postgres has already been removed:

1. disable ClickHouse reads only if Postgres has been caught up
2. run a reverse backfill from ClickHouse aggregate query into Postgres if needed
3. re-enable the old Postgres upsert code

Do not drop the Postgres table until this rollback path is no longer required.

## Testing Checklist

Backend unit tests:

- config parses all ClickHouse env defaults
- ClickHouse disabled path does not initialize client
- ClickHouse insert failure does not fail artifact processing
- API request event extraction produces deterministic `event_index`
- `insert_deduplication_token` is deterministic per artifact
- query service falls back to Postgres when ClickHouse throws
- DTO shape matches existing analytics route responses

Local integration checks:

- `npm run ci:local:checks`
- `npm run ci:local:deploy`
- ClickHouse pod is ready in `rejourney-local`
- `clickhouse-setup` creates tables
- a test event artifact inserts rows when dual-write is enabled
- analytics route still responds when reads are disabled
- analytics route responds from ClickHouse when reads are enabled

Local verification completed on 2026-05-21:

- `npm run ci:local` passed end to end after Docker Desktop was started
- `clickhouse-setup` completed and created `api_endpoint_request_events`, `api_endpoint_daily_stats_imported`, and `schema_migrations`
- host ClickHouse smoke check passed: `curl http://127.0.0.1:30123/ping`
- Next.js example ran on port `3101` because an existing process already owned `3100`
- browser fixture created rrweb replay artifacts and event artifacts for project `879c2380-e4e2-4f91-a54b-3a10ac8f824d`
- ClickHouse stored the fixture API row: `POST /api/fixture`, status `200`, count `1`
- analytics API returned total calls `3` from ClickHouse for the Brew project, including `POST /api/fixture`
- dashboard `/dashboard/analytics/api` displayed API Insights with `POST /api/fixture`
- dashboard `/dashboard/sessions/<session_id>` loaded the generated web replay with rrweb canvas/iframe and timeline/network events
- after the local script fixes, `npm run ci:local` was rerun and passed again

Production manifest verification completed on 2026-05-21:

- `bash -n` passed for production and local k8s shell scripts touched by the migration
- Ruby YAML parsing passed for `k8s/clickhouse.yaml`, `k8s/clickhouse-setup.yaml`, `k8s/api.yaml`, `k8s/workers.yaml`, and local k8s manifests
- Ruby YAML parsing passed for `k8s/clickhouse-backfill-api-stats.yaml` and `local-k8s/clickhouse-backfill-api-stats.yaml`
- `npm --prefix backend run build` passed after adding the cutover union query and backfill script
- `npm --prefix backend test -- apiEndpointStatsClickHouse ingestEventArtifactProcessor` passed
- `node --import tsx scripts/backfillClickHouseApiEndpointStats.ts --until 2026-05-21 --batch-size 10 --dry-run` passed locally and paged 832 historical rows without writing to ClickHouse
- `node --import tsx scripts/backfillClickHouseApiEndpointStats.ts --until 2026-05-21 --batch-size 5000` passed locally and imported 832 historical rows into ClickHouse
- Postgres and ClickHouse `FINAL` totals matched after local import: 832 rows, 27,505 calls, 262 errors, 11,229,944 summed latency ms
- service-level cutover read smoke with `CLICKHOUSE_CUTOVER_DATE=2026-05-21` returned imported history plus raw post-cutover facts for project `879c2380-e4e2-4f91-a54b-3a10ac8f824d`
- `npm run ci:local` passed end to end after adding the cutover union query, backfill script, and production/local backfill Jobs
- authenticated local ClickHouse syntax smoke passed for the cutover `UNION ALL` query against `api_endpoint_daily_stats_imported FINAL` plus `api_endpoint_request_events`
- `git diff --check` passed
- `node scripts/check-worker-parity.mjs` passed
- `scripts/k8s/deploy-release.sh` defaults to `DEPLOY_CLICKHOUSE=false`, so normal CI deploys do not create ClickHouse or require `clickhouse-secret`

Production live verification on 2026-05-21:

- ClickHouse infra was deployed on commit `4965a9acd51fb9e576233f2b2832db5af8b6073b`.
- The first operator install watched only the operator namespace. The deploy script now patches the operator config so it watches the `rejourney` namespace before applying ClickHouse CRs.
- The first data placement put both replicas on one HEL1 node. `k8s/clickhouse.yaml` now adds required hostname anti-affinity for data pods.
- The HEL1 worker already has the Postgres standby with an 8Gi memory request, so the ClickHouse data pod memory request is 256Mi with a 10Gi limit. Actual ClickHouse memory during backfill was about 1Gi per pod.
- `clickhouse-setup` needed a bootstrap database client against the `default` database before connecting to `rejourney`; the setup script now does that.
- Historical Postgres data contained 4 rows with negative `sum_latency_ms`, so `api_endpoint_daily_stats_imported.sum_latency_ms` is `Int64`.
- Backfill for dates `< 2026-05-21` completed in production: 9,325,058 imported rows.
- Parity for dates `< 2026-05-21` matched exactly using `api_endpoint_daily_stats_imported FINAL`: total diff 0, by-date diff 0, and by-project diff 0. Totals: 180,151,363 calls, 8,322,568 errors, 503,552,981,006 summed latency ms.
- Reads were not enabled. Same-day Postgres totals for `2026-05-21` were much larger than ClickHouse raw facts because the current image wrote raw facts by client event date while Postgres aggregates use processing date.
- The temporary raw ClickHouse rows from that test were truncated and dual-write was disabled again. Current live flags after the safe stop: `CLICKHOUSE_ENABLED=true`, `CLICKHOUSE_DUAL_WRITE_ENABLED=false`, `CLICKHOUSE_READS_ENABLED=false`, `CLICKHOUSE_CUTOVER_DATE=2026-05-21`.
- After commit `44f1e9e1f3415105c9eb8f96503a6bd5012ecf29`, production image semantics were verified: raw facts now write `event_date` from artifact processing day. Dual-write was re-enabled with reads still off and new raw ClickHouse rows landed under `2026-05-21` without worker insert warnings.
- The bounded same-day import for `2026-05-21 <= date < 2026-05-22` copied 519,390 Postgres daily-stat rows into `api_endpoint_daily_stats_imported`.
- Same-day totals keep moving while Postgres writes remain on. For an immediate read cutover on the same UTC day, ship `CLICKHOUSE_RAW_READS_AFTER`, run one final same-day backfill, then enable reads with `CLICKHOUSE_CUTOVER_DATE=2026-05-22` and `CLICKHOUSE_RAW_READS_AFTER=<final backfill completion UTC timestamp>`.

Production pre-cutover checks:

- ClickHouse storage growth under expected rate
- parts count not exploding
- no Keeper quorum issues
- Postgres SyncRep waits decrease only after Postgres writes are actually removed
- no increase in ingest artifact failures

## Missed-Judgment Traps To Avoid

1. Do not call this full HA. Three nodes give single-node HA, not full FSN1/HEL1 regional HA.

2. Do not make SDK ingest depend on ClickHouse. ClickHouse outage must not break session capture.

3. Do not use many tiny ClickHouse inserts from the per-endpoint loop. Batch rows or use async inserts with `wait_for_async_insert=1`.

4. Do not rely on ClickHouse primary keys for immediate uniqueness. ClickHouse does not check an existing primary key before insert. Use deterministic blocks and dedup tokens for retries, and write queries that tolerate duplicates during validation.

5. Do not backfill historical p50/p90/p99 from Postgres daily aggregates unless those columns were already populated. Current event-level detail is gone from that table.

6. Do not put ClickHouse CRs into the production bulk apply path before CRDs are installed.

7. Do not reference a required new Kubernetes secret before it exists. The deploy job does not sync secrets.

8. Do not forget the GitHub Actions version gate. A main merge without a package version bump may not deploy unless manually dispatched.

9. Do not move `sessions` or `recording_artifacts` source-of-truth behavior as part of this first migration.

10. Do not drop Postgres fallback until ClickHouse reads, backfill, and rollback have been exercised in production.

11. Do not overstate the resource win before Phase 5. Dual-write plus ClickHouse reads improves dashboard read scalability, but Postgres CPU/WAL/autovacuum relief only arrives when the old Postgres aggregate upsert is stopped.

12. Do not let raw ClickHouse facts use client event date if the read path is replacing `api_endpoint_daily_stats`. The existing Postgres aggregate uses artifact processing day. Date semantics must match before dual-write can be considered reliable.

13. Do not assume the Altinity operator watches app namespaces by default. In this production install, it initially watched only `clickhouse`; ClickHouse CRs in `rejourney` did not reconcile until the operator config was patched and restarted.

## Implementation File Checklist

Backend:

- `backend/package.json`
- `package-lock.json`
- `backend/src/config.ts`
- `backend/src/db/clickhouse.ts`
- `backend/src/services/clickhouseApiStatsSink.ts`
- `backend/src/services/apiEndpointStatsClickHouse.ts`
- `backend/src/services/ingestEventArtifactProcessor.ts`
- `backend/scripts/setupClickHouse.ts`
- `backend/scripts/backfillClickHouseApiEndpointStats.ts`
- `backend/clickhouse/001_api_endpoint_request_events.sql`
- `backend/clickhouse/002_api_endpoint_daily_stats_imported.sql`
- relevant backend tests under `backend/src/__tests__/`

Production k8s:

- `k8s/clickhouse.yaml`
- `k8s/clickhouse-setup.yaml`
- `k8s/clickhouse-backfill-api-stats.yaml`
- `k8s/api.yaml`
- `k8s/workers.yaml`
- `scripts/k8s/k8s-sync-secrets.sh`
- `scripts/k8s/deploy-release.sh`
- monitoring manifests if metrics are scraped

Local k8s:

- `local-k8s/clickhouse.yaml`
- `local-k8s/clickhouse-backfill-api-stats.yaml`
- `local-k8s/api.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/env.example`
- `scripts/local-k8s/k8s-sync-secrets.sh`
- `scripts/local-k8s/deploy.sh`
- `scripts/local-k8s/dev.sh`
- `scripts/local-k8s/update-ips.sh`
- `scripts/local-k8s/rejourney-ci.sh`
- `scripts/check-worker-parity.mjs` if ClickHouse env parity should be enforced

Docs:

- this file
- `dev_docs/rejourney-ci.md` if deploy sequence changes materially
- `dev_docs/allthingscloud.md` after production topology is actually deployed
