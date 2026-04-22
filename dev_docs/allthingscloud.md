# All Things Cloud

## Tailscale, public traffic, and admin access

**Public path:** Internet -> **Cloudflare** (DNS / TLS / WAF) -> **Hetzner Load Balancer** (Phase 1-B, with PROXY protocol and trusted private-network IPs) -> **Traefik** on k3s -> `rejourney.co`, `api.rejourney.co`, `ingest.rejourney.co`. The Hetzner LB is what real-client IPs come through; Traefik is configured with the LB's private-network IP in `trustedIPs` so it forwards `X-Forwarded-For` correctly.

**Admin path:** Operators join the **Tailscale tailnet** (Mac + VPS). They use **SSH** and **`kubectl`** over **100.x** addresses. **Admin UIs** (pgweb, Redis Commander, Grafana, Gatus, VictoriaMetrics, Pushgateway, Traefik dashboard) have **no public Ingress**; open them with **`kubectl port-forward`** to `127.0.0.1` on the laptop. The **internal dashboard** repo (`rejourney-internal`) talks to Postgres/S3 the same way: tunnels + local Node.

**Important boundary:** Tailscale is the secure operator/admin doorway into the node and cluster. It is **not** in the normal in-cluster service path. Internal service-to-service traffic such as `Grafana -> VictoriaMetrics`, `VictoriaMetrics -> kube-state-metrics`, or `postgres-exporter -> postgres` stays on Kubernetes service networking. Cloudflare only fronts the public customer hostnames.

```mermaid
flowchart TB
  subgraph publicPath [Public path]
    Users[End users]
    CF[Cloudflare]
    LB[Hetzner LB]
    Traefik[Traefik Ingress]
    Web[Web UI]
    API[API and ingest]
    Users --> CF --> LB --> Traefik
    Traefik --> Web
    Traefik --> API
  end
  subgraph tailnet [Tailscale tailnet]
    Admin[Admin laptop]
    VPS[VPS k3s node]
    Admin -->|WireGuard 100.x| VPS
  end
  Admin -->|kubectl port-forward| Web
  Admin -->|kubectl port-forward| API
  Admin -->|kubectl / SSH| VPS
```

**Docs:** [network-exposure-and-tailscale.md](./network-exposure-and-tailscale.md), [admin-tools-private-access.md](./admin-tools-private-access.md), sibling repo `rejourney-internal/dev_docs/`.

---

## Deployment

```text
┌──────────────┐      ┌─────────────────────────────┐      ┌─────────────────┐
│  GitHub Repo │─────▶│      GitHub Actions         │─────▶│      GHCR       │
│ (rejourney)  │      │  scripts/k8s/deploy-release │      │ (Docker Images) │
└──────────────┘      └──────────────┬──────────────┘      └────────┬────────┘
                                     │                              │
                                     │ 2) kubectl apply --prune     │ 3) Pull
                                     │    (part-of=rejourney)       │    Images
                                     ▼                              ▼
                      ┌────────────────────────────────────────────────────┐
                      │         Hetzner CPX42 k3s node (single)            │
                      │                namespace: rejourney                │
                      └────────────────────────────────────────────────────┘
```

`deploy-release.sh` renders `k8s/*.yaml` into a temp dir with image-tag substitution, then applies with `--prune -l app.kubernetes.io/part-of=rejourney` plus an explicit allowlist (ConfigMap, Service, Deployment, StatefulSet, Ingress, Traefik Middleware, CronJob, Job, PodDisruptionBudget). Anything labeled `part-of=rejourney` but no longer in the repo is removed on the next deploy. Helm-managed resources such as the Bitnami Redis `Service` have that label explicitly stripped so `--prune` never touches them. CNPG is managed by its operator, so `k8s/cnpg/` is not applied by the deploy script.

## K3s Details

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Kubernetes Cluster (k3s)                           │
│                                                                              │
│  ┌────────────────────────┐          ┌────────────────────────────────────┐  │
│  │      Networking        │          │            Entrypoints             │  │
│  │ ┌──────────────────┐   │          │  ┌──────────┐        ┌──────────┐  │  │
│  │ │ Traefik Ingress  │◀──┼──────────┼──┤  Web UI  │        │ API+ingest│  │  │
│  │ └─────────┬────────┘   │          │  │  (Node)  │        │ Backend  │  │  │
│  └───────────┼────────────┘          │  └──────────┘        └────┬─────┘  │  │
│              │                       └───────────────────────────┼────────┘  │
│              │                                                   │           │
│  ┌───────────▼────────────┐          ┌───────────────────────────▼────────┐  │
│  │      Monitoring        │          │           Storage Layer            │  │
│  │ ┌──────────────────┐   │          │  ┌───────────────┐  ┌────────────┐ │  │
│  │ │ Grafana / Gatus /│   │          │  │  PgBouncer    │  │ Redis      │ │  │
│  │ │ VictoriaMetrics  │   │          │  │  (pooler)     │  │ (Bitnami)  │ │  │
│  │ │ (admin port-fwd) │   │          │  └───────┬───────┘  │ + Sentinel │ │  │
│  │ └──────────────────┘   │          │          ▼          │ 10Gi PVC   │ │  │
│  │ exporters + pushgw +   │          │  ┌───────────────┐  └────────────┘ │  │
│  │ Traefik metrics (svc)  │          │  │  CNPG Postgres│                 │  │
│  └────────────────────────┘          │  │  postgres-rw  │                 │  │
│                                      │  │  60Gi Hetzner │                 │  │
│                                      │  │  vol, PG 18.3 │                 │  │
│                                      │  └───────────────┘                 │  │
│                                      └────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                     Background workers (Deployments)                   │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐│
│  │  │ ingest-worker    │  │ replay-worker    │  │ session-lifecycle-worker ││
│  │  │ events, crashes, │  │ screenshots,     │  │ lifecycle sweeps +       ││
│  │  │ ANRs             │  │ hierarchy        │  │ session reconcile        ││
│  │  └────────┬─────────┘  └────────┬─────────┘  └────────────┬─────────────┘│
│  │           │                     │                         │               │
│  │           └─────────────────────┴─────────────────────────┘               │
│  │                                   │                                       │
│  │  ┌──────────────────┐             │  CronJobs (on schedule)               │
│  │  │ alert-worker     │             │  retention-worker · session-backup ·  │
│  │  │ (alert pipeline) │             │  postgres-backup                      │
│  │  └──────────────────┘             │                                       │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Ingest pathway detail is below: SDK -> API -> storage -> queue -> workers.

## Ingest Pathway (Workers + Data Plane)

```text
┌─────────────┐   presign / complete / relay    ┌─────────────────────────────────────┐
│ JS / native │ ───────────────────────────────▶│ API (+ ingest routes)               │
│ SDK         │                                 │ sessions · recording_artifacts ·    │
└─────────────┘                                 │ metrics · ingest_jobs               │
       │                                        └───────────────┬─────────────────────┘
       │                                                        │
       │  PUT uploads (relay)                                   │ enqueue + state
       ▼                                                        ▼
┌─────────────┐   object payloads                      ┌────────────────┐
│ Hetzner S3  │ ◀───────────────────────────────────── │ PgBouncer ->   │
│ (artifacts) │                                        │ CNPG Postgres  │
└──────┬──────┘                                        │ (source of     │
       │                                               │  truth)        │
       │                                               └───────┬────────┘
       │                                                       │
       │                                                       │ job rows / locks
       ▼                                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Redis - cache, idempotency, ingest job coordination, worker-side limits     │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐     ┌─────────────────┐     ┌──────────────────────────┐
│ ingest-worker │     │ replay-worker   │     │ session-lifecycle-worker │
│ drain jobs:   │     │ drain jobs:     │     │ sweeps + session         │
│ events,       │     │ screenshots,    │     │ reconciliation           │
│ crashes, ANRs │     │ hierarchy       │     │                          │
└───────┬───────┘     └────────┬────────┘     └────────────┬─────────────┘
        │                      │                           │
        └──────────────────────┴───────────────────────────┘
                               │
                               ▼
                    updates artifacts, sessions, replay readiness,
                    lifecycle flags (still Postgres + S3 as above)
```

## External Boundary

Admins use **Tailscale** (`100.x`) for SSH, `kubectl`, and `port-forward`, not Cloudflare.

## Monitoring Runtime Path

- **Grafana** reads from **VictoriaMetrics** over internal Kubernetes DNS. Dashboards ship via the `grafana-dashboards` ConfigMap (generated by `scripts/k8s/gen-grafana-dashboards.py` into `k8s/grafana-dashboards.yaml`). Eight dashboards, numbered `00 — Overview` through `70 — VictoriaMetrics & Self`, covering cluster health, Kubernetes resources, Postgres/CNPG, Redis + Sentinel, Traefik, application pipeline (artifacts/ingest/backup/retention), storage, and self-monitoring. The legacy community-imported dashboards are deleted on every deploy by `scripts/k8s/patch-imported-grafana-dashboards.py`.
- **VictoriaMetrics** scrapes `node-exporter`, `cadvisor`, `kube-state-metrics`, `postgres-exporter`, `pushgateway`, Traefik metrics, Redis (Bitnami exporter sidecar, `redis-metrics:9121`), CNPG instance metrics (pod service-discovery on `cnpg.io/cluster=postgres`), and the kubelet (`/api/v1/nodes/<node>/proxy/metrics`). Pod and node discovery needs RBAC, so VM has a dedicated `ServiceAccount` + `ClusterRole` with get/list/watch on nodes, pods, endpoints, and services.
- **Gatus** should prefer internal service URLs for app-health checks because public HTTP checks can be blocked by Cloudflare managed challenge or bot protection even while the app is healthy. The PostgreSQL TCP check now probes `postgres-rw.rejourney.svc.cluster.local:5432` (CNPG primary service), not the legacy `postgres` service.
- **TLS checks** still intentionally use the public hostnames because they validate the public certificate chain at the edge.
- `postgres-exporter -> postgres-rw` is an in-cluster connection using the `monitoring` user (`sslmode=disable`). The `monitoring` role is not bundled by `pg_dump`, so it was recreated on CNPG by hand during Phase 1-E. One pre-existing warning is noise: `stat_bgwriter: column "checkpoints_timed" does not exist`. The exporter's `queries.yaml` predates the PG 17 rename, so it is safe to ignore or update the YAML.

```text
                        ┌────────────────────────┐
                        │       Cloudflare       │
                        │   (DNS / SSL / public) │
                        └────────────┬───────────┘
                                     │
                        ┌────────────▼───────────┐
                        │   Hetzner LB (PROXY)   │
                        └────────────┬───────────┘
                                     │
                        ┌────────────▼───────────┐
                        │     Traefik (k8s)      │
                        └────────────┬───────────┘
                                     │
              ┌──────────────────────┴───────────────────────┐
              │                                              │
      ┌───────▼────────┐                             ┌───────▼────────┐
      │     Web UI     │                             │   API Backend  │
      └────────────────┘                             └───────┬────────┘
                                                             │
        ┌─────────────────────────┬───────────────────┬──────┴──────────┐
        │                         │                   │                 │
┌───────▼────────┐      ┌─────────▼────────┐  ┌───────▼───────┐  ┌──────▼────────────┐
│  PgBouncer ->  │      │  Redis Sentinel  │  │  Hetzner S3   │  │  External APIs    │
│  CNPG Postgres │      │  (Bitnami chart) │  │  (Recordings) │  │  (Stripe / SMTP)  │
│  postgres-rw   │      │  cache / queue   │  │               │  │                   │
│  + postgres-r  │      │  ingest jobs     │  │               │  │                   │
│  + postgres-ro │      │                  │  │               │  │                   │
└───────▲────────┘      └──────────▲───────┘  └───────▲───────┘  └───────────────────┘
        │                          │                  │
        └──────────────────────────┴──────────────────┘
              ingest · replay · session-lifecycle · alert workers
              (drain queues, update sessions/artifacts, alerts)

              CNPG WAL archived to R2 (s3://rejourney-backup/cnpg-wal) via Barman;
              logical daily backup job also dumps to R2 (postgres-backup CronJob).
```

## Session Backup Deployment Notes

- The session backup CronJob is deployed from [archive.yaml](../k8s/archive.yaml).
- Production currently schedules that CronJob hourly so queued backupable sessions do not wait for a once-daily drain.
- Production also runs a `session-backup-seed` CronJob every 5 minutes to enqueue old eligible sessions that were not already inserted from the finalize path.
- The source-of-truth script for that job is [session-backup.mjs](../scripts/k8s/session-backup.mjs), and GitHub Actions now runs [check-archive-sync.sh](../scripts/k8s/check-archive-sync.sh) before `kubectl apply`.
- A deploy from `main` now updates the backup job logic, including legacy hierarchy gzip repair and archive-friendly screenshot repacking for R2.
- The live CronJob can be suspended during reset, but the committed manifest controls whether it resumes after the next deploy.
- The committed `session-backup-seed` manifest should stay `suspend: false`; if prod is manually unsuspended but Git still says `true`, the next deploy will silently turn it off again.
- Detailed queue / backup / retention rules live in [Session Backup + Retention Internals](./session-backup-retention-internals.md).

## Data Plane (Post Phase 1 Migration)

- **Postgres** - CloudNativePG (CNPG) `Cluster` named `postgres` in the `rejourney` namespace, managed by the `cnpg-system` operator. Single instance in Phase 1 and raises to 2 in Phase 2-B. Backed by a 60 Gi Hetzner volume (`hcloud-volumes` `StorageClass`, `reclaimPolicy: Retain`; see `dev_docs/legacy.md` for the volume-churn warning). Running PostgreSQL 18.3 on `ghcr.io/cloudnative-pg/postgresql:18`.
  - Services: `postgres-rw` (primary read-write), `postgres-ro` (replicas only), `postgres-r` (any instance). Apps go through PgBouncer -> `postgres-rw`.
  - Roles: `rejourney` (app, owns all public + drizzle schema objects), `monitoring` (read-only for postgres-exporter), `postgres` (superuser), `streaming_replica` (used by future replicas).
  - Manifest: `k8s/cnpg/postgres-cnpg.yaml`. **Not** applied by `deploy-release.sh`; the cluster spec is managed out-of-band to avoid accidental recreation, which would churn paid Hetzner volumes.
  - Backups: continuous WAL archive to R2 via Barman (`s3://rejourney-backup/cnpg-wal`, 7-day retention, gzip) plus the daily logical dump from the `postgres-backup` CronJob in `k8s/backup.yaml` (R2, 30-day retention).
- **PgBouncer** - `edoburu/pgbouncer:v1.25.1-p0`, transaction pooling, `DEFAULT_POOL_SIZE=15`, `MAX_CLIENT_CONN=300`. All app services connect via `postgres-secret.PGBOUNCER_URL` (`postgresql://rejourney:...@pgbouncer:5432/rejourney`). PgBouncer itself connects upstream to `postgres-rw:5432` using `postgres-secret` credentials.
- **Redis** - Bitnami Helm chart with Sentinel (Phase 1-C). StatefulSet `redis-node` with three containers per pod: `redis`, `sentinel`, `redis-exporter` (metrics). 10 Gi Hetzner volume per replica. Apps read Sentinel for the current master via `redis-headless` + `REDIS_SENTINEL_HOSTS`. The legacy single-Deployment Redis is gone; `k8s/redis.yaml` in the repo is a stub comment pointing at the Helm chart (`k8s/helm/redis-values.yaml`). The Bitnami `redis` `Service` has its `app.kubernetes.io/part-of=rejourney` label stripped so `--prune` never touches it.
- **S3 (Hetzner + R2)** - Hetzner S3 for live session artifacts; Cloudflare R2 for long-term session backups, CNPG WAL, and logical DB dumps. Credentials split into `s3-secret` (Hetzner) and `r2-backup-secret` (Cloudflare R2).

## Current Production Runtime Notes

- Long-running deployments:
  - API
  - Web UI
  - `ingest-worker` ([`ingestArtifactWorker.js`](../backend/src/worker/ingestArtifactWorker.ts) - events, crashes, ANRs)
  - `replay-worker` ([`replayArtifactWorker.js`](../backend/src/worker/replayArtifactWorker.ts) - screenshots, hierarchy)
  - `session-lifecycle-worker` ([`sessionLifecycleWorker.js`](../backend/src/worker/sessionLifecycleWorker.ts) - lifecycle sweeps, session reconciliation)
  - `alert-worker`
- CronJobs:
  - `session-backup` in [archive.yaml](../k8s/archive.yaml)
  - `session-backup-seed` in [archive.yaml](../k8s/archive.yaml)
  - `retention-worker` in [workers.yaml](../k8s/workers.yaml)
  - `postgres-backup` in [backup.yaml](../k8s/backup.yaml)
- There is no separate billing worker anymore. Billing is handled by Stripe webhooks through the API.

## Retention + Backup Coordination

- Production retention now runs as a CronJob every 15 minutes with `concurrencyPolicy: Forbid`.
- The container entrypoint is `node dist/worker/retentionWorker.js --once --drain-backlog --trigger=scheduled`.
- Retention also takes a Postgres run lock in `retention_run_lock`, so a manual backfill and the CronJob cannot overlap.
- Retention only purges a session after backup safety checks pass:
  - normally that means a complete `session_backup_log` row exists
  - truly empty sessions are the intentional exception and may be purged outright
- This means retention is intentionally fail-safe on fresh deploys:
  - if `session_backup_log` does not exist yet, retention skips session purges
  - if a session has not been backed up yet, retention skips that session
- Backup is the source that creates and populates `session_backup_log`, so backup must run successfully before retention can start draining expired sessions.
- Some historical queue rows may now be parked as `status = 'source_missing'` instead of retrying forever. That is an operator safeguard for stale source-storage gaps, not a success path; those sessions still do not count as backed up, and retention still skips them.
- Retention deletes only the session artifact payloads and cache state:
  - canonical S3 objects under `tenant/{teamId}/project/{projectId}/sessions/{sessionId}/...`
  - legacy disconnected objects under bare `sessions/...`
  - `recording_artifacts` rows
  - `ingest_jobs` rows
  - replay and cache state on the `sessions` row
- Retention keeps the `sessions` row and other analytics or fault data.
- Every purge attempt is logged to `retention_deletion_log`.

## Operational Commands

- Apply schema changes before enabling the new retention behavior:
  - `cd backend && npm run db:migrate`
- Manually drain the backlog once the backup job has populated `session_backup_log`:
  - `cd backend && npm run retention:backfill:expired-artifacts`
- Useful things to inspect during rollout:
  - `retention_deletion_log` for what was deleted or skipped
  - `retention_run_lock` for active retention runs
  - `session_backup_log` to confirm backup eligibility
  - Redis key `retentionWorker:last_summary` for the latest retention cycle summary
