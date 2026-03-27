
Deployment:
┌──────────────┐      ┌─────────────────────────────┐      ┌─────────────────┐
│  GitHub Repo │─────▶│      GitHub Actions         │─────▶│      GHCR       │
│ (rejourney)  │      │   (Force Deploy VPS)        │      │ (Docker Images) │
└──────────────┘      └──────────────┬──────────────┘      └────────┬────────┘
                                     │                              │
                                     │ 2) kubectl apply             │ 3) Pull
                                     │    manifests                 │    Images
                                     ▼                              ▼
                      ┌────────────────────────────────────────────────────┐
                      │             Hetzner VPS Cluster (k3s)              │
                      │                namespace: rejourney                │
                      └────────────────────────────────────────────────────┘





K3s Details:

┌──────────────────────────────────────────────────────────────────────────────┐
│                           Kubernetes Cluster (k3s)                           │
│                                                                              │
│  ┌────────────────────────┐          ┌────────────────────────────────────┐  │
│  │      Networking        │          │            Entrypoints             │  │
│  │ ┌──────────────────┐   │          │  ┌──────────┐        ┌──────────┐  │  │
│  │ │ Traefik Ingress  │◀──┼──────────┼──┤  Web UI  │        │   API    │  │  │
│  │ └─────────┬────────┘   │          │  │  (Node)  │        │ Backend  │  │  │
│  └───────────┼────────────┘          │  └──────────┘        └────┬─────┘  │  │
│              │                       └───────────────────────────┼────────┘  │
│              │                                                   │           │
│  ┌───────────▼────────────┐          ┌───────────────────────────▼────────┐  │
│  │      Monitoring        │          │           Storage Layer            │  │
│  │ ┌──────────────────┐   │          │  ┌──────────┐        ┌──────────┐  │  │
│  │ │     Netdata      │   │          │  │ Postgres │        │  Redis   │  │  │
│  │ └──────────────────┘   │          │  │ (PVC 20G)│        │ (In-Mem) │  │  │
│  └────────────────────────┘          │  └──────────┘        └──────────┘  │  │
│                                      └────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                           Async Workers                                │  │
│  │  ┌──────────┐      ┌──────────┐      ┌──────────┐      ┌──────────┐    │  │
│  │  │ Ingest   │      │ Alert    │      │ Retention│      │ Backup   │    │  │
│  │  └──────────┘      └──────────┘      └──────────┘      └──────────┘    │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘



External Beyond:

                        ┌────────────────────────┐
                        │       Cloudflare       │
                        │     (DNS / SSL / Auth)│
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
        ┌─────────────────┬─────────────────┬────────────────┴──────────┐
        │                 │                 │                           │
┌───────▼───────┐ ┌───────▼───────┐ ┌───────▼────────┐        ┌─────────▼────────┐
│   Postgres    │ │     Redis     │ │  Hetzner S3   │        │   External APIs   │
│ (Main Data)   │ │ (Cache/Queue) │ │ (Recordings)  │        │  (Stripe / SMTP)  │
└───────────────┘ └──────────────┘ └────────────────┘        └────────────────────┘


Session Backup Deployment Notes:

- The session backup CronJob is deployed from [archive.yaml](/Users/mora/Desktop/Dev-mac/rejourney/k8s/archive.yaml).
- The source-of-truth script for that job is [session-backup.mjs](/Users/mora/Desktop/Dev-mac/rejourney/scripts/k8s/session-backup.mjs), and GitHub Actions now runs [check-archive-sync.sh](/Users/mora/Desktop/Dev-mac/rejourney/scripts/k8s/check-archive-sync.sh) before `kubectl apply`.
- A deploy from `main` now updates the backup job logic, including legacy hierarchy gzip repair and archive-friendly screenshot repacking for R2.
- The live CronJob can be suspended during reset, but the committed manifest controls whether it resumes after the next deploy.

Current Production Runtime Notes:

- Long-running deployments:
  - API
  - Web UI
  - `ingest-worker`
  - `alert-worker`
- CronJobs:
  - `session-backup` in [archive.yaml](/Users/mora/Desktop/Dev-mac/rejourney/k8s/archive.yaml)
  - `retention-worker` in [workers.yaml](/Users/mora/Desktop/Dev-mac/rejourney/k8s/workers.yaml)
  - `postgres-backup` in [backup.yaml](/Users/mora/Desktop/Dev-mac/rejourney/k8s/backup.yaml)
- There is no separate billing worker anymore. Billing is handled by Stripe webhooks through the API.

Retention + Backup Coordination:

- Production retention now runs as a CronJob every 15 minutes with `concurrencyPolicy: Forbid`.
- The container entrypoint is `node dist/worker/retentionWorker.js --once --drain-backlog --trigger=scheduled`.
- Retention also takes a Postgres run lock in `retention_run_lock`, so a manual backfill and the CronJob cannot overlap.
- Retention only purges a session after that session appears in `session_backup_log`.
- This means retention is intentionally fail-safe on fresh deploys:
  - if `session_backup_log` does not exist yet, retention skips session purges
  - if a session has not been backed up yet, retention skips that session
- Backup is the source that creates and populates `session_backup_log`, so backup must run successfully before retention can start draining expired sessions.
- Retention deletes only the session artifact payloads and cache state:
  - canonical S3 objects under `tenant/{teamId}/project/{projectId}/sessions/{sessionId}/...`
  - legacy disconnected objects under bare `sessions/...`
  - `recording_artifacts` rows
  - `ingest_jobs` rows
  - replay/cache state on the `sessions` row
- Retention keeps the `sessions` row and other analytics/fault data.
- Every purge attempt is logged to `retention_deletion_log`.

Operational Commands:

- Apply schema changes before enabling the new retention behavior:
  - `cd backend && npm run db:migrate`
- Manually drain the backlog once the backup job has populated `session_backup_log`:
  - `cd backend && npm run retention:backfill:expired-artifacts`
- Useful things to inspect during rollout:
  - `retention_deletion_log` for what was deleted or skipped
  - `retention_run_lock` for active retention runs
  - `session_backup_log` to confirm backup eligibility
  - Redis key `retentionWorker:last_summary` for the latest retention cycle summary
