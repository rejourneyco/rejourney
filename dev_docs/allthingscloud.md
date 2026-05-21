# All Things Cloud

Last updated: 2026-05-21

Operator-facing map of production: traffic path, pod placement, storage, HA failover, and the reasoning behind every architectural decision.

Related docs: [admin-tools-private-access.md](./admin-tools-private-access.md) · [rejourney-ci.md](./rejourney-ci.md) · [postgres-backup-and-restore.md](./postgres-backup-and-restore.md) · [clickhouse-api-endpoint-daily-stats-migration.md](./clickhouse-api-endpoint-daily-stats-migration.md)

---

## Nodes

| Hetzner / k8s name | Type | DC | vCPU | RAM | Role |
|---|---|---|---|---|---|
| `rejourney-fsn1-1` | CPX52 | FSN1 (Falkenstein) | 12 | 24 GB | API · ingress · primary DB · monitoring |
| `rejourney-hel1-worker-1` | CX43 | HEL1 (Helsinki) | 8 | 16 GB | Bulk workers · standby DB |
| `rejourney-hel1-quorum-1` | CX43 | HEL1 (Helsinki) | 8 | 16 GB | Bulk workers · etcd quorum · excluded from LB |

Hetzner server names and k8s node names are the same (aligned 2026-04-27). **Never rename a Hetzner server without also changing `node-name` in `/etc/rancher/k3s/config.yaml` and rebuilding all PV nodeAffinity entries** — mismatches cause CCM `network-unavailable` taints and block pod scheduling cluster-wide.

**FSN1 ↔ HEL1 RTT: ~25ms.** Every serial cross-DC call adds 25ms. API handlers make 5–10 serial DB calls — a HEL1 API pod adds 125–250ms of pure wire overhead per request.

All nodes carry `rejourney.co/datacenter=fsn1|hel1`. New nodes must get this label on join.

---

## Setup

```mermaid
graph TD
    USER[Browser / Mobile SDK]
    CF["Cloudflare\nDNS · TLS · WAF"]
    LB["Hetzner Load Balancer\nFSN1 · private-IP backends\nexternalTrafficPolicy: Local"]

    subgraph FSN1["FSN1 — Falkenstein · rejourney-fsn1-1"]
        TR["Traefik\n(sole ingress in normal operation)"]
        APIING["api-ingest\n/api/ingest/* · /api/sdk/config\ncolocated with primary"]
        FSN1_SVC["ingest-upload · web · monitoring\npostgres primary · redis master\npgbouncer (rw)"]
    end

    subgraph HEL1["HEL1 — Helsinki · worker-1 + quorum-1"]
        APIDASH["api-dashboard\neverything else\nuses dbRead for analytics"]
        WORKERS["ingest-worker · replay-worker\nalert-worker · session-lifecycle-worker\nretention-worker · stripe-sync-worker"]
        STANDBY["postgres standby · redis replicas\npgbouncer (rw replicas)\npgbouncer-ro → standby"]
    end

    S3["S3-compatible object storage\nHetzner · OVH · Scaleway via storage_endpoints"]
    R2["Cloudflare R2\nWAL archive · session backups"]

    USER --> CF
    CF --> LB
    LB -->|"ETP:Local → FSN1 nodeport only"| TR
    TR -->|"/api/ingest/* · /api/sdk/config"| APIING
    TR -->|"everything else"| APIDASH
    APIING --> FSN1_SVC
    APIDASH -->|"writes (rare): pgbouncer → primary"| FSN1_SVC
    APIDASH -->|"reads (heavy): pgbouncer-ro → standby"| STANDBY
    FSN1_SVC -->|"WAL stream · sync replication"| STANDBY
    FSN1_SVC --> S3
    FSN1_SVC -->|"WAL archive"| R2
    WORKERS --> FSN1_SVC
    WORKERS --> S3

    classDef dc fill:#1a2a3a,stroke:#4fc3f7,color:#fff
    class FSN1,HEL1 dc
```

**Public path:** Internet → Cloudflare → Hetzner LB (FSN1) → Traefik → backends

**Admin path:** Tailscale tailnet → SSH / kubectl / port-forward over `100.x` addresses. Admin UIs (Grafana, Traefik dashboard) are not public.

---

## Pod topology (current)

```mermaid
graph LR
    subgraph fsn1["rejourney-fsn1-1 · CPX52 · 12 vCPU / 24 GB · FSN1"]
        direction TB
        TR0["Traefik ×1\npreferred FSN1"]
        APIING["api-ingest ×3–6\nHPA · required affinity to primary\nall serial DB calls local"]
        WEB0["web ×1"]
        U0["ingest-upload ×1–2\nHPA"]
        PG1["postgres-local-1\nCNPG primary"]
        RD0["redis-node-0\nSentinel master"]
        PGB0["pgbouncer (rw)\npool 60"]
        MON["victoria-metrics · grafana\ngatus · pushgateway\nnode-exporter · cadvisor\nkube-state-metrics · postgres-exporter"]
    end

    subgraph worker1["rejourney-hel1-worker-1 · CX43 · 8 vCPU / 16 GB · HEL1"]
        direction TB
        APIDASH1["api-dashboard ×1\nHPA 2–5 · preferred HEL1\nuses dbRead for analytics"]
        IW1["ingest-worker ×bulk\nHPA 5–12 · preferred HEL1"]
        RW1["replay-worker ×bulk\nHPA 1–10 · preferred HEL1"]
        U1["ingest-upload overflow"]
        PG2["postgres-local-2\nCNPG sync standby"]
        RD2["redis-node-2\nSentinel replica"]
        PGB1["pgbouncer (rw)\npool 60"]
        PGBRO1["pgbouncer-ro ×1\n→ postgres-local-ro\n(standby only)"]
    end

    subgraph quorum1["rejourney-hel1-quorum-1 · CX43 · 8 vCPU / 16 GB · HEL1 · excluded from LB"]
        direction TB
        APIDASH2["api-dashboard ×1\nHPA · preferred HEL1"]
        IW2["ingest-worker ×bulk\nHPA · preferred HEL1"]
        RW2["replay-worker ×bulk\nHPA · preferred HEL1"]
        AW["alert-worker ×1\npreferred HEL1"]
        SLC["session-lifecycle-worker ×1\npreferred HEL1"]
        WEB1["web ×1"]
        RD1["redis-node-1\nSentinel replica"]
        PGB2["pgbouncer (rw)\npool 60"]
        PGBRO2["pgbouncer-ro ×1\n→ postgres-local-ro"]
        CRON["retention-worker CronJob\nstripe-sync-worker CronJob"]
        ETCD["etcd quorum voter"]
    end

    classDef pinned fill:#1a3a1a,stroke:#4caf50,color:#fff
    classDef dash fill:#1f2a3f,stroke:#7e8aff,color:#fff
    classDef data fill:#1a1a3a,stroke:#5c6bc0,color:#fff
    classDef worker fill:#2a1a1a,stroke:#ef5350,color:#fff
    classDef ingress fill:#1a2a2a,stroke:#26c6da,color:#fff
    classDef mon fill:#2a2a1a,stroke:#ffa726,color:#fff

    class APIING pinned
    class APIDASH1,APIDASH2 dash
    class PG1,PG2,PGB0,PGB1,PGB2,PGBRO1,PGBRO2,RD0,RD1,RD2 data
    class IW1,IW2,RW1,RW2,AW,SLC,CRON worker
    class TR0 ingress
    class MON mon
```

**Color key:**
- **Green** — `api-ingest` pods (SDK traffic only): required pod affinity to the CNPG primary node, preferred FSN1. All serial DB calls stay local. Isolated from dashboard traffic so a slow dashboard aggregation can never starve the SDK event loop.
- **Indigo** — `api-dashboard` pods (operator UI + everything else): preferred HEL1 next to the read replica. Writes go to the primary via pgbouncer (rw); heavy reads (`dbRead`) go to the standby via pgbouncer-ro — local-DC for both because writes are rare on this path.
- **Blue** — Data: CNPG primary + Redis master on FSN1, standby + replicas on HEL1. pgbouncer (rw) on all three nodes; pgbouncer-ro only on HEL1 (next to standby).
- **Red** — Workers: prefer HEL1 (preferred affinity, weight 100), fall back to FSN1 only when HEL1 is full. DB latency is acceptable for async processing; ingest/replay writes use `SET LOCAL synchronous_commit = local` to skip the 25ms SyncRep wait.
- **Cyan** — Ingress: Traefik single replica on FSN1. quorum-1 excluded from LB entirely.
- **Orange** — Monitoring: all on FSN1 for simplicity. Goes dark if FSN1 fails — acceptable gap.

---

## Future topology (next FSN1 node)

```mermaid
graph LR
    subgraph fsn1_1["rejourney-fsn1-1 · existing"]
        direction TB
        TR1["Traefik replica-1"]
        API1["api-ingest ×all\nHPA · colocated with primary"]
        PG1F["postgres-local-1\nCNPG primary"]
        RD0F["redis-node-0"]
        PGB0F["pgbouncer (rw)"]
        MONF["monitoring stack"]
    end

    subgraph fsn1_2["rejourney-fsn1-2 · NEW CPX41 or CX32"]
        direction TB
        TR2["Traefik replica-2"]
        PGB3["pgbouncer (rw) replica-4"]
    end

    subgraph hel1["HEL1 — worker-1 + quorum-1 · unchanged"]
        direction TB
        APIDASHF["api-dashboard ×2\nunchanged, HEL1"]
        WK["all workers\n(preferred HEL1, same as today)"]
        DB2["postgres standby · redis replicas\npgbouncer (rw) replicas\npgbouncer-ro replicas"]
    end

    classDef new fill:#1a3a2a,stroke:#66bb6a,color:#fff
    classDef existing fill:#1a3a1a,stroke:#4caf50,color:#fff
    classDef hel fill:#2a1a1a,stroke:#ef5350,color:#fff

    class fsn1_2,TR2,PGB3 new
    class fsn1_1,TR1,API1,PG1F,RD0F,PGB0F,MONF existing
    class hel1,APIDASHF,WK,DB2 hel
```

See [Compute Scaling Plan](#compute-scaling-plan) for the exact steps.

---

## Component decisions

### Hetzner Load Balancer

- FSN1 location, round-robin across `fsn1` and `worker-1` backends. quorum-1 excluded via `node.kubernetes.io/exclude-from-external-load-balancers: "true"`.
- Uses private IPs — traffic stays inside the Hetzner private network.
- `externalTrafficPolicy: Local` on the Traefik service. Without this, kube-proxy could VXLAN-forward to the other DC's Traefik pod before the request hits Traefik, adding an invisible 25ms hop.

### Traefik

- **1 replica, preferred FSN1.** With ETP:Local, the LB health check on `worker-1`'s nodeport returns unhealthy when no Traefik pod is there — LB routes 100% to FSN1 automatically. On FSN1 failure, Traefik reschedules to `worker-1` (~90s) and the LB detects it healthy.
- Required to exclude nodes with `node.kubernetes.io/exclude-from-external-load-balancers` (quorum-1).
- Trusts Cloudflare IP ranges for real-IP passthrough on both entry points.
- Middlewares: `https-redirect`, `http-www-redirect`, `www-redirect`, `security-headers`, `rate-limit-api` (1 000 req/min, burst 5 000), `rate-limit-ingest` (20 000 req/min, burst 40 000).
- Metrics on a separate `metrics` entry point, scraped by VictoriaMetrics.

### API (split into `api-ingest` and `api-dashboard`)

Background: a single `api` deployment served both SDK ingest (~500 req/min/pod) and the operator dashboard (~10 req/min/pod). Same Node.js event loop, same pgbouncer pool. A heavy dashboard aggregation could block ingest writes behind it, and an ingest spike could push dashboard clicks past 3s. Split into two deployments running the same image with different routing and placement (May 2026).

Both deployments expose port 3000 and load the same Express app — the difference is purely traffic routing at the ingress and pod placement.

A backward-compat `api` Service still exists and aliases `api-ingest` so anything inside the cluster that hardcodes `api:3000` (gatus, monitoring, etc.) keeps working.

#### `api-ingest` — SDK traffic only
- Routed by ingress for `/api/ingest/*` and `/api/sdk/config` on `api.rejourney.co`, and everything on `ingest.rejourney.co` except `/upload`.
- **Required pod affinity to the current CNPG primary hostname** (`cnpg.io/cluster=postgres-local`, `cnpg.io/instanceRole=primary`). Ingest response time regresses sharply when serial DB calls cross nodes/DCs, so new ingest pods must schedule on the same node as the writable Postgres pod.
- **Preferred FSN1, weight 100** (`rejourney.co/datacenter=fsn1`). Secondary to primary-node colocation; preserves normal placement while `postgres-local-1` is primary.
- **No `topologySpreadConstraints`** — tested: `maxSkew:1 ScheduleAnyway` overrides a weight-80 preference and spreads pods to HEL1, causing 6–11s p50.
- **HPA `api-ingest`: min 3, max 6, target 65% CPU.** Min 3 fits entirely on FSN1 in normal operation.
- **Continuous colocation guard** (`api-postgres-colocator` CronJob): every minute, checks the CNPG primary node and evicts at most one healthy `api-ingest` pod if it is not colocated. It only acts when the deployment is fully ready and uses the Eviction API, so the PDB keeps one-at-a-time movement. The CronJob's `API_DEPLOYMENT` env is set to `api-ingest`.
- **Post-deploy colocation check** in CI (`pin_deployment_to_postgres_primary api-ingest` in `scripts/k8s/deploy-release.sh`): after every rollout, evicts any `api-ingest` pods not on the CNPG primary node one at a time and waits for replacements. Fixes rollout-time drift immediately; the CronJob handles later CNPG primary movement.

#### `api-dashboard` — operator UI + everything else
- Routed by ingress for everything else on `api.rejourney.co` (`/`, dashboard, analytics, auth, webhooks, etc.).
- **Preferred HEL1, weight 100** — colocated with the Postgres read replica so heavy analytics aggregations are local-DC.
- **`podAntiAffinity` (preferred) on hostname** — spreads the two replicas across different HEL1 nodes so a single-node loss doesn't take both pods.
- **No required affinity to the primary** — most queries on this deployment use `dbRead` (read replica). The occasional write (login, settings, Stripe webhook) goes through `pgbouncer` (rw) → primary, which crosses 25ms cross-DC, acceptable at that frequency.
- **HPA `api-dashboard`: min 2, max 5, target 60% CPU.**
- Sets the `DATABASE_URL_READ` env var (interpolated from `POSTGRES_*` secrets — those keys must be declared before `DATABASE_URL_READ` in the env list because Kubernetes `$(VAR)` interpolation only resolves vars listed earlier in the same container).

#### Read replica path (`dbRead`)
- `backend/src/db/client.ts` exports `db` (primary) and `dbRead`. `dbRead` uses `DATABASE_URL_READ` if set, otherwise falls back to `db`. Writes via `dbRead` would fail at the standby with `cannot execute INSERT in a read-only transaction` — that's the intentional guardrail.
- `api-ingest` does not set `DATABASE_URL_READ`, so its `dbRead` aliases `db`. Tests, local dev, and the legacy `api` Service backers all use the same fallback path.
- Today only the two heaviest aggregations in `dashboardOverview.ts` (`loadUserFirstSeenMap`, `loadTopUsersPreview`) use `dbRead`. Other dashboard reads are still on `db` — incremental migration is safe to do later.

### `ingest-worker`, `replay-worker`

- **Preferred HEL1, weight 100.** Fall back to FSN1 only when HEL1 is full.
- HPA: `ingest-worker` 5–12, `replay-worker` 1–10.
- IO-bound, not CPU-bound — HPA undershoots during queue spikes (workers sit at 30–40% CPU while waiting on S3 round-trips). If the queue grows: manually scale and patch the HPA max first.
- Workers are **event-driven via BullMQ** — no SQL polling. Three queues are backed by the Redis Sentinel cluster: `rj-artifact-flush` (Redis buffered relay uploads waiting for S3), `rj-ingest-artifacts` (events, crashes, anrs), and `rj-replay-artifacts` (screenshots, hierarchy). Workers block on the queue and consume jobs as they arrive.
- BullMQ deduplication uses `jobId = artifact-{artifactId}`. Stalled jobs (worker died mid-process) are automatically re-queued after `stalledInterval = 30s`, up to `maxStalledCount = 3`.
- Retry policy: 5 attempts, exponential backoff starting at 1s. Failed jobs are kept in the failed set for 7 days (DLQ window). Completed jobs retained 1h for observability.
- Queue depth monitoring: `LLEN bull:rj-artifact-flush:wait`, `LLEN bull:rj-ingest-artifacts:wait`, and `LLEN bull:rj-replay-artifacts:wait` in Redis. All should be near zero in steady state.

### `ingest-upload`

- HPA: min 1, max 2.
- Upload relay path: collect tiny artifact bodies, write `artifact:buf:{artifactId}` to Redis with a 30-minute TTL, mark `recording_artifacts.status='buffered'`, enqueue `rj-artifact-flush`, and return 204. S3 latency is moved out of the SDK request path.

### `alert-worker`, `session-lifecycle-worker`

- Single-replica, preferred HEL1.

### `retention-worker`, `stripe-sync-worker`

- CronJobs, preferred HEL1. Periodic, not latency-sensitive.

### `web`

- 2 replicas, no affinity. Static/SSR, no DB calls.

### pgbouncer (rw)

- **3 replicas, one per node, pool 60 connections each.** Total: 180 server connections, under `max_connections: 200`.
- All connect to `postgres-app-rw` (CNPG label selector `cnpg.io/instanceRole: primary`) — always resolves to current primary after failover.
- `trafficDistribution: PreferClose` — kube-proxy routes to local-node pgbouncer, falls back automatically.
- **`required` anti-affinity on hostname** — exactly one per node, always. Do not change to `preferred` and do not add `maxSurge: 1`. With 3 nodes, a surge pod has nowhere to go and deadlocks the rollout.
- Rolling update: `maxSurge: 0, maxUnavailable: 1`.
- **When adding a node, bump replicas to match new node count before deploying.** Also raise `max_connections` if total pool × 60 approaches 200.

### pgbouncer-ro (read replica pool)

- **2 replicas, preferred HEL1**, pool 30 connections each. Fronts the Postgres standby for dashboard analytics reads.
- Connects to `postgres-local-ro` — **not** `postgres-app-ro`. See operational gotcha #14: `postgres-app-ro` is a custom alias in this cluster with a broken selector that matches both primary AND standby, so it round-robins between them. The CNPG-default `postgres-local-ro` correctly filters by `cnpg.io/instanceRole=replica`.
- `trafficDistribution: PreferClose` — `api-dashboard` pods on HEL1 hit the local pgbouncer-ro pod; FSN1 pod is only used as a fallback.
- Soft anti-affinity on hostname — preferred spread, but doesn't block scheduling if HEL1 is full (one replica may end up on FSN1 during rollout; that's fine — the cross-DC hop only matters when HEL1 is unavailable).
- Used only by `api-dashboard` via the `DATABASE_URL_READ` env var → `dbRead` Drizzle client.

### CNPG (postgres-local)

- 2 instances: `postgres-local-1` (primary, FSN1) + `postgres-local-2` (sync standby, worker-1).
- `synchronous_commit = remote_write`, `minSyncReplicas: 1`, `maxSyncReplicas: 1`. Adds ~25ms to write commits. `maxSyncReplicas: 1` means postgres degrades to async rather than blocking if standby is down.
- **SyncRep is the write throughput ceiling.** 33 concurrent SyncRep waits = 33 blocked connections. Ingest workers mitigate with `SET LOCAL synchronous_commit = local`. For any new write-heavy path: check `pg_stat_activity WHERE wait_event = 'SyncRep'` first.
- WAL archived to Cloudflare R2 (gzip). See `postgres-backup-and-restore.md`.
- Storage: `rejourney-db-local-retain` (local-path, Retain). Data is on the node's local disk — not Hetzner cloud volumes. PVCs survive pod/cluster deletion. Standby + R2 WAL archive are the recovery paths.

### ClickHouse analytics projection (deploy-gated)

ClickHouse is the next analytics scale-out path, starting with the workload behind `api_endpoint_daily_stats`. It is **not** a replacement for Postgres as the source of truth for sessions, recording artifacts, auth, billing, storage configuration, or ingest lifecycle state.

Production deployment is gated:

- `DEPLOY_CLICKHOUSE=false` by default in `scripts/k8s/deploy-release.sh`, so normal CI deploys do not create ClickHouse or require `clickhouse-secret`.
- App flags default off: `CLICKHOUSE_ENABLED=false`, `CLICKHOUSE_DUAL_WRITE_ENABLED=false`, `CLICKHOUSE_READS_ENABLED=false`.
- All app/workers ClickHouse secret refs are `optional: true`, so the application can deploy before ClickHouse exists.
- `api-ingest` and SDK request handlers must never synchronously depend on ClickHouse. If ClickHouse is down, session capture must continue.

Topology when enabled:

| Component | Placement | Purpose |
|---|---|---|
| ClickHouse Keeper | 3 replicas, one voter per node | quorum for replicated ClickHouse tables |
| ClickHouse data | 1 shard, 2 replicas on HEL1 nodes | analytics facts and imported daily aggregates |
| `clickhouse-setup` Job | manual/explicit deploy step | creates `api_endpoint_request_events`, `api_endpoint_daily_stats_imported`, and `schema_migrations` |
| `clickhouse-backfill-api-stats` Job | manual only | imports historical Postgres `api_endpoint_daily_stats` rows before read cutover |

Why HEL1 for the data replicas: the first writer is `ingest-worker`, which already lives in HEL1 and processes artifacts asynchronously; the first reader is `api-dashboard`, which also lives in HEL1. Keeping ClickHouse data on HEL1 avoids loading the FSN1 Postgres primary node with analytical storage and merge work. This topology only makes sense because ClickHouse is outside the synchronous `/api/ingest/*` return path. The earlier FSN1 primary colocation incident showed what happens when ingest makes serial cross-DC calls: ingest latency can jump into seconds. Do not move any synchronous ingest write to a HEL1-only ClickHouse endpoint.

Resource impact expected after the full cutover:

- largest direct win: lower Postgres CPU, WAL, index churn, autovacuum work, and disk I/O from removing hot aggregate upserts on `api_endpoint_daily_stats`
- secondary win: lower Postgres buffer/cache pressure because `api_endpoint_daily_stats` and its indexes stop competing with transactional tables
- dashboard API endpoint analytics should become steadier under larger date ranges because ClickHouse handles grouped scans better than Postgres OLTP tables
- not a magic fix for `sessions` or `recording_artifacts` bloat; those remain Postgres source-of-truth tables until a separate lifecycle/archive design exists
- not a fix for synchronous ingest latency by itself; `api-ingest` must still colocate with the writable Postgres primary

Rollout gates:

1. Enable infrastructure only: `DEPLOY_CLICKHOUSE=true`, app flags still false.
2. Enable dual-write from artifact processing: `CLICKHOUSE_ENABLED=true`, `CLICKHOUSE_DUAL_WRITE_ENABLED=true`, `CLICKHOUSE_READS_ENABLED=false`.
3. Run `clickhouse-backfill-api-stats` with an exclusive `CLICKHOUSE_CUTOVER_DATE`.
4. Compare Postgres and ClickHouse totals by date and by project.
5. Enable reads: `CLICKHOUSE_READS_ENABLED=true`, `CLICKHOUSE_CUTOVER_DATE=<date dual-write became reliable>`.
6. Only after at least a clean week, remove Postgres writes for this workload. Do not drop `api_endpoint_daily_stats` in the same release that removes writes.

Local verification completed on 2026-05-21: the backfill imported 832 local `api_endpoint_daily_stats` rows; Postgres and ClickHouse `FINAL` totals matched exactly at 27,505 calls, 262 errors, and 11,229,944 summed latency ms. See the migration runbook for commands and details.

### Redis

- 3-node StatefulSet: `redis-node-0` (FSN1, master), `redis-node-1` (quorum-1, replica), `redis-node-2` (worker-1, replica).
- Sentinel quorum = 2/3. On FSN1 failure, HEL1 Sentinels elect a new master.
- 8 GiB volumes per node, `reclaimPolicy: Retain`.
- **`maxmemory-policy: noeviction` is required.** BullMQ stores job state as Redis hashes. With LRU eviction Redis silently drops job records under memory pressure — workers never see those jobs and artifacts are permanently stuck in `uploaded`. Production Redis at steady state uses ~28 MB for BullMQ state; the 8 GiB limit is effectively unlimited headroom.
- BullMQ connections require `maxRetriesPerRequest: null` on the ioredis client — this is handled by `createBullMQRedisConnection()` in `artifactBullQueue.ts`, which creates dedicated connections separate from the app's general Redis client (BullMQ internally needs a commands connection + a blocking subscribe connection).

### Monitoring (all on FSN1)

| Component | Purpose |
|---|---|
| VictoriaMetrics | Metrics store. Scraped from node-exporter, cadvisor, kube-state-metrics, postgres-exporter, redis-metrics, Traefik, pushgateway. |
| Grafana | Dashboard UI. Port-forwarded for operator access. |
| Gatus | Public endpoint + internal service health checks. |
| Pushgateway | Push metrics from CronJobs and short-lived pods. |
| node-exporter | DaemonSet — one per node. |
| cadvisor | DaemonSet — one per node. |
| kube-state-metrics | Cluster-level k8s object metrics. |
| postgres-exporter | Scrapes CNPG primary. |

### CoreDNS

- 2 replicas (1 FSN1, 1 HEL1). Without a HEL1 replica, FSN1 failure causes 30–60s cluster-wide DNS outage.
- **Not CI-managed** — k3s controls CoreDNS via its internal addon mechanism. Verify after any k3s upgrade with `kubectl get pods -n kube-system -l k8s-app=kube-dns`.

### Storage classes

| Class | Driver | Reclaim | Used by |
|---|---|---|---|
| `rejourney-db-local-retain` | local-path | Retain | postgres, redis |
| `local-path` | local-path | Delete | grafana, victoria-metrics, gatus, pgadmin |

**Retain policy on DB volumes is critical.** Deleting a PVC does NOT delete the underlying data. Recreating CNPG or Redis without verifying volumes creates orphaned data silently.

---

## HA failover

| Failure | What happens |
|---|---|
| FSN1 `api-ingest` pods | Reschedule to HEL1 (the required affinity follows the promoted primary, so they land wherever Postgres lands). Slower until postgres/Redis failover completes (~30s). |
| HEL1 `api-dashboard` pods | Reschedule to whichever HEL1 node is still up; if both HEL1 nodes are gone, spill to FSN1. `dbRead` queries still work because `pgbouncer-ro` follows the standby — on full HEL1 loss, the standby itself is gone, so `dbRead` queries error until CNPG promotes and a new standby is rebuilt. Mitigation: `dbRead` falls back gracefully only via app retry; consider switching `DATABASE_URL_READ=DATABASE_URL` during prolonged standby outages. |
| CNPG primary | `postgres-local-2` auto-promotes. `postgres-app-rw` selector follows new primary. pgbouncer (rw) on HEL1 reconnects to local primary. `postgres-local-ro` momentarily has zero endpoints until CNPG rebuilds the standby — `dbRead` queries error during that window. |
| In-flight writes at crash | Postgres writes: no data loss — `remote_write` means every committed write was already buffered on standby. BullMQ jobs that were active at crash time are detected as stalled after `stalledInterval = 30s` and automatically re-queued. Relay uploads already ACKed to the SDK depend on the Redis `artifact:buf:{artifactId}` key surviving until flush; buffered flush jobs are recoverable while that 30-minute key exists. Artifact processing is idempotent — safe to reprocess. |
| Redis master | Sentinel elects new master within seconds. |
| ClickHouse Keeper voter | Any single node loss leaves 2/3 Keeper quorum. ClickHouse data remains available if at least one HEL1 data replica is healthy. |
| ClickHouse data replica | One HEL1 node loss leaves the other data replica serving analytics. Full HEL1 loss takes ClickHouse reads down; while Postgres fallback still exists, set `CLICKHOUSE_READS_ENABLED=false` or rely on the route fallback. After Postgres writes are removed, treat full HEL1 ClickHouse loss as an analytics outage, not an ingest outage. |
| Traefik | Reschedules to `worker-1` (~90s). LB detects `worker-1` nodeport healthy and resumes routing. |
| CoreDNS | Second replica on HEL1 keeps DNS alive. |
| Monitoring | victoria-metrics, Grafana, Gatus go offline. Accepted gap. |

**Post-failover:** once CNPG promotes (~30s) and Redis elects master (~5s), `api-ingest` pods reschedule onto whatever node now holds the primary and hit local pgbouncer → local postgres → local Redis. Latency recovers close to FSN1 levels. The dashboard read path is degraded until the new standby finishes initial sync (minutes); during that window dashboard queries should be temporarily routed back to the primary (set `DATABASE_URL_READ=` on `api-dashboard`).

---

## Ingress routing

| Host | Path | Backend | Middlewares |
|---|---|---|---|
| `rejourney.co` | `/` | `web:80` | security-headers |
| `www.rejourney.co` | `/` HTTP | — | http-www-redirect |
| `www.rejourney.co` | `/` HTTPS | `web:80` | www-redirect |
| `api.rejourney.co` | `/api/ingest`, `/api/sdk/config` | `api-ingest:3000` | security-headers, rate-limit-ingest |
| `api.rejourney.co` | `/` | `api-dashboard:3000` | security-headers, rate-limit-api |
| `ingest.rejourney.co` | `/upload` | `ingest-upload:3001` | security-headers, rate-limit-ingest |
| `ingest.rejourney.co` | `/` | `api-ingest:3000` | security-headers, rate-limit-ingest |
| `*.rejourney.co` HTTP | `/` | — | https-redirect |

The `api-ingest` ingress carries priority `110` so the more-specific paths win against the catch-all `/` route on `api.rejourney.co` (priority `10`) which goes to `api-dashboard`.

Dashboard replay object reads are intentionally dynamic. Production can sign URLs for Hetzner, OVH, Scaleway, or any active `storage_endpoints` row, so the web CSP should allow HTTPS object-storage reads by scheme rather than a hardcoded provider host list:

```text
connect-src 'self' https: wss://api.rejourney.co
media-src 'self' https: blob:
```

Local k8s uses the same idea with `http:` allowed for MinIO/local endpoints. Buckets still need CORS that permits dashboard origins to `GET`/`HEAD`; otherwise rrweb segments and screenshot frames will fall back to the API proxy routes and put replay traffic back on `api-dashboard`.

---

## Operational gotchas

1. **Never rename a Hetzner server without a coordinated k3s migration.** CCM matches Hetzner server names to k8s node names. Mismatch → `network-unavailable:NoSchedule` taint → no pods schedule there. Also breaks PV nodeAffinity (immutable field — must delete/recreate PVs). Requires: k3s `node-name` config change on all nodes, cluster-reset if etcd gets corrupted, flannel FDB repopulation (k3s restart on all nodes), PV rebuild.

2. **API and Traefik affinity use `rejourney.co/datacenter=fsn1`.** New nodes must be labelled on join. Workers and `api-dashboard` use `rejourney.co/datacenter=hel1`.

3. **Do not add `topologySpreadConstraints` to `api-ingest`.** `maxSkew:1 ScheduleAnyway` overrides the preferred affinity and spreads pods to HEL1, causing 6–11s p50 response times. (Same constraint previously applied to the unified `api` deployment.) Workers had a similar issue with topologySpread fighting the HEL1 affinity and overflowing to FSN1; both were removed in May 2026.

4. **Do not change `externalTrafficPolicy` back to `Cluster`.** Adds an invisible 25ms kube-proxy VXLAN hop before every Traefik request.

5. **quorum-1 is excluded from the Hetzner LB** via `node.kubernetes.io/exclude-from-external-load-balancers: "true"`. Do not remove this label.

6. **pgbouncer anti-affinity is `required`.** One per node, always. Do not change to `preferred`, do not add `maxSurge: 1` — with 3 nodes and 3 pods, a surge pod deadlocks the rollout. When adding a node, bump replicas first.

7. **CNPG sync replication degrades to async when standby is down.** `maxSyncReplicas: 1` — intentional. You briefly lose the sync guarantee during CNPG upgrades.

8. **HPA undershoots for IO-bound workers.** `ingest-worker` and `replay-worker` stay at 30–40% CPU while waiting on S3 and DB. If the BullMQ queue grows, HPA won't fire — CPU is the wrong signal. Monitor queue depth: `LLEN bull:rj-artifact-flush:wait`, `LLEN bull:rj-ingest-artifacts:wait`, and `LLEN bull:rj-replay-artifacts:wait` in Redis. If any are non-zero and growing, manually scale: `kubectl scale deployment ingest-worker --replicas=12`, patch HPA max first.

9. **`api-ingest`/Postgres colocation is enforced twice.** `api-ingest` has required pod affinity to the current CNPG primary, CI auto-corrects via `pin_deployment_to_postgres_primary api-ingest`, and the `api-postgres-colocator` CronJob handles later failovers (its `API_DEPLOYMENT` env is set to `api-ingest`). `api-dashboard` does NOT colocate with the primary — it lives on HEL1. If you see slow ingest: compare `kubectl get pods -n rejourney -l app=api-ingest -o wide` with `kubectl get pods -n rejourney -l cnpg.io/cluster=postgres-local,cnpg.io/instanceRole=primary -o wide`, then inspect `kubectl get jobs -n rejourney -l app=api-postgres-colocator`.

10. **SyncRep is the write throughput ceiling.** Every committed write waits ~25ms for standby ACK. For any new write-heavy path that becomes slow: check `pg_stat_activity WHERE wait_event = 'SyncRep'` first, then add `SET LOCAL synchronous_commit = local` if the path is safe to skip (idempotent retries are acceptable). The BullMQ migration eliminated the former hottest path (`ingest_jobs` INSERT/UPDATE churn) — artifact job dispatch now goes through Redis, and only the `recording_artifacts` status update remains in Postgres.

11. **DB storage is local-path, not Hetzner cloud volumes.** PVCs survive pod deletion (Retain) but permanent node destruction loses local data. Standby + R2 WAL archive are the recovery paths.

12. **CoreDNS replica count may reset on k3s upgrades.** Verify after any upgrade and re-apply `k8s/coredns-config.yaml`.

13. **Cloudflare WAF silently blocks ingest PUT requests.** No logs, no 4xx to the client — Cloudflare drops the request without notifying you. If ingest stops working and the API/ingest-upload pods look healthy: add a custom WAF pass-rule for PUT on `ingest.rejourney.co` first, before touching anything else. There are zero logs until that rule is in place.

14. **`postgres-app-ro` is broken in this cluster — use `postgres-local-ro` for read-only traffic.** The `postgres-app-*` services were configured as custom aliases at some point and `postgres-app-ro` has selector `cnpg.io/podRole=instance`, which matches BOTH primary and standby — so it round-robins between them and is NOT actually read-only. The CNPG-default `postgres-local-ro` has the correct selector (`cnpg.io/instanceRole=replica`) and only routes to the standby. `pgbouncer-ro` points at `postgres-local-ro` for this reason. Verify any new read pool with `kubectl get endpoints postgres-local-ro` (should be exactly one IP — the standby).

15. **`DATABASE_URL_READ` env var ordering matters.** On `api-dashboard`, `DATABASE_URL_READ` is interpolated from `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` via `$(VAR)` syntax. Kubernetes only resolves `$(VAR)` against env vars that appear EARLIER in the same container's env list. If you reorder env entries and put `DATABASE_URL_READ` before its inputs, the value becomes the literal string `postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@pgbouncer-ro:5432/$(POSTGRES_DB)` and Postgres connections fail with cryptic auth errors.

16. **API split: `api` Service is a backward-compat alias for `api-ingest`.** Anything cluster-internal that hardcoded `api:3000` (gatus, monitoring scrapes) keeps working because the `api` Service still exists with selector `app: api-ingest`. Don't delete it. The colocator and the deploy script reference `api-ingest` directly, not `api`. Ingest traffic goes to `api-ingest`; dashboard/auth/everything-else goes to `api-dashboard`.

17. **`api-dashboard` does writes too — don't assume it's read-only.** Login creates `user_sessions` rows, settings saves, Stripe webhooks (`/api/webhooks/*`) all run on `api-dashboard` and write to the primary via the regular `db` client (which uses `DATABASE_URL` → `pgbouncer` → primary). Only the `dbRead` client targets the standby. If you migrate a route to `dbRead`, verify it does not write — writes via `dbRead` will fail at the standby with `cannot execute INSERT in a read-only transaction`. That's the intentional guardrail but it's user-visible.

18. **ClickHouse must stay off the synchronous ingest path.** It is safe only because artifact processing writes API request facts asynchronously and catches ClickHouse failures. If any `/api/ingest/*` handler starts waiting on ClickHouse before returning to the SDK, revisit placement first — a HEL1-only ClickHouse write endpoint would reintroduce the cross-DC latency pattern that previously pushed ingest latency into seconds.

19. **Do not enable ClickHouse reads before backfill plus cutover date.** `CLICKHOUSE_READS_ENABLED=true` with an empty `CLICKHOUSE_CUTOVER_DATE` reads only raw facts collected since dual-write started. Historical dashboard charts will look empty. Set `CLICKHOUSE_CUTOVER_DATE` to the first reliable dual-write date after the backfill Job succeeds and totals match.

20. **Do not drop `api_endpoint_daily_stats` at read cutover.** First cut over reads, keep Postgres writes and fallback for rollback, soak for at least a week, then remove Postgres writes for this one workload. Archive/drop the old table only in a later release after rollback is no longer needed.

---

## Compute Scaling Plan

Current state: 1 FSN1 node running `api-ingest`, DB primary, ingest-upload, and monitoring; 2 HEL1 nodes running `api-dashboard`, workers, standby, and pgbouncer-ro. Next step is a **second FSN1 node** — more `api-ingest` headroom with local DB latency, not more HEL1 standby capacity.

### Step 0 — affinity labels ✅ done

All nodes carry `rejourney.co/datacenter`. New FSN1 nodes are immediately eligible for `api-ingest`/Traefik with just:
```bash
kubectl label node <new-node> rejourney.co/datacenter=fsn1
```

### Step 1 — add second FSN1 node

Recommended type: **CPX41** (16 vCPU, 32 GB, ~€33/mo) or **CX32** (8 vCPU, 32 GB, ~€19/mo). Add in FSN1 only. With strict `api-ingest`/Postgres-primary colocation, this node is immediate ingress/pgbouncer/general headroom; `api-ingest` pods only use it if the CNPG primary can also run there. After the node joins:
```bash
kubectl label node <new-node> rejourney.co/datacenter=fsn1
# Remove LB exclusion label if present:
kubectl label node <new-node> node.kubernetes.io/exclude-from-external-load-balancers-
```

### Step 2 — scale pgbouncer (rw) to 4

`pgbouncer` (rw) requires one replica per node. With 4 nodes, set replicas = 4 and raise `max_connections` to at least 280 (4 × 60 = 240 connections, need headroom). Update `k8s/pgbouncer.yaml`. (`pgbouncer-ro` does not need a replica per node — it lives on HEL1 next to the standby.)

### Step 3 — raise `api-ingest` HPA max

```yaml
# k8s/hpa.yaml — HorizontalPodAutoscaler/api-ingest
minReplicas: 3   # unchanged
maxReplicas: 8   # was 6
```
Only raise this if the Postgres primary node has CPU/memory headroom, or after adding a CNPG instance/primary path on the new FSN1 node. `api-ingest` pods are required to colocate with the writable Postgres pod. `api-dashboard` HPA scales independently and isn't affected.

### Step 4 — run 2 Traefik replicas across both FSN1 nodes

```yaml
# k8s/traefik-config.yaml
replicas: 2
# affinity: required rejourney.co/datacenter=fsn1, required anti-affinity on hostname
```
Add the new FSN1 node as a Hetzner LB backend.

### What does not change

- CNPG: stays 1 primary + 1 standby. More replicas add sync overhead.
- Redis: stays 3-node Sentinel.
- ClickHouse: keep the first rollout as 1 shard / 2 HEL1 data replicas plus 3 Keeper voters. Do not colocate ClickHouse data with the FSN1 Postgres primary unless ClickHouse becomes part of a synchronous FSN1 write path.
- HEL1 nodes: unchanged — HA standby, bulk worker capacity, and `api-dashboard` home.
- `api-dashboard`: 2 replicas on HEL1 is plenty for current operator load; scale via its own HPA (2–5) if dashboard traffic grows.

ClickHouse changes the Postgres scaling pressure but not the next compute step: once `api_endpoint_daily_stats` writes are removed, Postgres should see less CPU, WAL, autovacuum, bloat, and cache pressure. The next FSN1 node is still the right compute expansion for synchronous ingest headroom because `api-ingest` must stay colocated with the writable Postgres primary.
