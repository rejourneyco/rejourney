# Rejourney CI + Deploy Path (Visual)

Last updated: 2026-04-22

This doc owns the CI, image-build, deploy, `db-setup`, and local parity flow.

## Flow Index

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [C1] GitHub Actions Pipeline                                                │
│ [C2] Production Deploy On The VPS                                           │
│ [C3] db-setup / Migrations / Bootstrap                                      │
│ [C4] Local CI Parity Flow                                                   │
│ [C5] Safety Rails / Failure Modes                                           │
│ [C6] Commands / Primary Files                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

## GitHub Secrets Required

| Secret | Used by | Value |
|--------|---------|-------|
| `VPS_SSH_KEY` | check-version, deploy | SSH private key for `root@VPS` |
| `VPS_HOST` | check-version, deploy | VPS host / IP (can be Tailscale IP if SSH is locked to tailnet) |
| `GITHUB_TOKEN` | deploy | Auto-provided by Actions |
| `VITE_STRIPE_PUBLISHABLE_KEY` | build-images | Stripe publishable key |
| `TURNSTILE_SITE_KEY` | build-images | Cloudflare Turnstile site key |

## [C1] GitHub Actions Pipeline

```text
┌──────────────────────┐
│ push / pull_request  │
│ workflow_dispatch    │
└──────────┬───────────┘
           │
           ├────────────────────┐
           │                    │
           ▼                    ▼
┌──────────────────────┐  ┌──────────────────────┐
│ backend job          │  │ web job              │
│ npm ci               │  │ npm ci               │
│ schema guard         │  │ typecheck            │
│ lint                 │  │ SSR build            │
│ unit tests           │  └──────────┬───────────┘
│ billing tests        │             │
│ billing lint         │             │
└──────────┬───────────┘             │
           └──────────────┬──────────┘
                          ▼
               ┌──────────────────────┐
               │ build-images         │
               │ main only            │
               │ build + push         │
               │ api / web / migration│
               └──────────┬───────────┘
                          │
                          ▼
               ┌──────────────────────┐
               │ deploy               │
               │ main only            │
               │ version changed OR   │
               │ workflow_dispatch    │
               └──────────────────────┘
```

```text
check-version job

main branch only
  -> compare package.json version in repo vs /opt/rejourney/package.json on VPS
  -> if changed == true, deploy may proceed
  -> if unchanged, deploy is skipped unless manually dispatched
```

Backend job contents:

- install backend dependencies
- run schema / migration guard
- run backend lint
- run full backend tests
- run billing-focused tests
- run targeted billing ESLint pass

Web job contents:

- install workspace dependencies
- run TypeScript check
- run SSR build

Image build contents:

- build/push `api`
- build/push `web`
- build/push `migration`

Primary workflow file:

- [`/.github/workflows/rejourney-ci.yml`](/Users/mora/Desktop/Dev-mac/rejourney/.github/workflows/rejourney-ci.yml)

## [C2] Production Deploy On The VPS

```text
┌──────────────────────────────┐      SSH       ┌──────────────────────────────┐
│ GitHub Actions deploy job    │───────────────▶│ VPS: /opt/rejourney         │
│ appleboy/ssh-action          │                │ fetch/reset origin/main      │
└──────────────┬───────────────┘                └──────────────┬───────────────┘
               │                                               │
               │ bash scripts/k8s/deploy-release.sh            │
               ▼                                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Kubernetes release flow                                                     │
│                                                                              │
│ 1. Render manifests with the target image tag                               │
│ 2. Apply namespace / Traefik / exporters / ingress / storage-class support  │
│ 3. If DEPLOY_CLICKHOUSE=true, install Altinity operator, patch watch ns,    │
│    then apply ClickHouse CRs                                               │
│ 4. Apply the CNPG postgres-local Cluster manifest                           │
│ 5. Verify archive.yaml matches session-backup.mjs                           │
│ 6. Print current drizzle migration status                                   │
│ 7. Apply/wait pgbouncer and PDB data-plane manifests                        │
│ 8. Delete old db-setup job                                                  │
│ 9. Apply db-setup by itself and wait for migration/bootstrap success        │
│ 10. If DEPLOY_CLICKHOUSE=true, run clickhouse-setup by itself               │
│ 11. Print migration status again                                            │
│ 12. Server-side apply grafana-dashboards ConfigMap                          │
│ 13. kubectl apply rendered manifests with prune                             │
│ 14. Reconcile the Helm-managed redis Service label/restore guard            │
│ 15. Wait for Deployments, then colocate api-ingest with the CNPG primary    │
│ 16. Wait for cadvisor/node-exporter                                         │
│ 17. Cleanup imported dashboards / restart seed jobs / clean finished pods   │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
Important deploy behavior

set -euo pipefail is enabled in the remote deploy script
  -> if deploy-release.sh fails, the GitHub Actions job fails red
  -> later cleanup steps do not hide the real failure anymore

DEPLOY_CLICKHOUSE=false by default
  -> normal CI deploys do not create ClickHouse, install the operator, or require clickhouse-secret
  -> when true, the operator config is patched to watch the rejourney namespace before CR readiness is expected
  -> when true, clickhouse.yaml and clickhouse-setup.yaml are applied explicitly and removed from the bulk prune path
  -> clickhouse-backfill-api-rollups runs only when RUN_CLICKHOUSE_ROLLUP_BACKFILL=true
```

Production deploy entrypoint:

- [`scripts/k8s/deploy-release.sh`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/k8s/deploy-release.sh)

## [C3] db-setup / Migrations / Bootstrap

```text
db-setup job

drizzle-kit migrate
  -> seedIfDatabaseEmpty.ts
  -> bootstrapSystemData.ts
  -> syncStorageEndpoint.ts          (prod)
  -> syncLocalStorageEndpoint.ts     (local)
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Conditional seed                                                            │
│                                                                              │
│ Database empty?                                                             │
│   yes -> run src/db/seed.ts                                                 │
│   no  -> skip seed                                                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ System bootstrap                                                            │
│                                                                              │
│ bootstrapSystemData.ts upserts:                                             │
│ - retention policy tiers                                                    │
│ - global storage endpoint row                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Migration safety                                                            │
│                                                                              │
│ Hot-table replay cleanup favors safe deploys over immediate physical drop.  │
│ The migration uses a short lock timeout and can skip the physical column    │
│ drop if the sessions table is busy, so deploys stay non-blocking.           │
└──────────────────────────────────────────────────────────────────────────────┘
```

Relevant files:

- [`k8s/api.yaml`](/Users/mora/Desktop/Dev-mac/rejourney/k8s/api.yaml)
- [`local-k8s/api.yaml`](/Users/mora/Desktop/Dev-mac/rejourney/local-k8s/api.yaml)
- [`backend/scripts/seedIfDatabaseEmpty.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/scripts/seedIfDatabaseEmpty.ts)
- [`backend/scripts/bootstrapSystemData.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/scripts/bootstrapSystemData.ts)
- [`backend/drizzle/20260326011544_nice_black_bird/migration.sql`](/Users/mora/Desktop/Dev-mac/rejourney/backend/drizzle/20260326011544_nice_black_bird/migration.sql)

## [C4] Local CI Parity Flow

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ npm run ci:local           -> full parity flow                              │
│ npm run ci:local:fast      -> skip npm reinstall steps                      │
│ npm run ci:local:checks    -> checks only                                   │
│ npm run ci:local:deploy    -> rebuild/import/deploy only                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ local ci parity runner                                                      │
│                                                                              │
│ 1. update-ips.sh                                                            │
│ 2. load .env.k8s.local                                                      │
│ 3. stop host services                                                       │
│ 4. optional npm ci steps                                                    │
│ 5. schema guard + backend checks + web checks                               │
│ 6. build local api / web / migration images                                 │
│ 7. import those images into k3d                                             │
│ 8. deploy.sh apps                                                           │
│ 9. restart host services for device testing                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
deploy.sh apps

create cluster if needed
  -> sync secrets
  -> apply local postgres / redis / minio / clickhouse infra
  -> run local db compatibility guard
  -> apply api / web / workers / ingress
  -> wait for deployments
  -> wait for db-setup success
  -> wait for clickhouse-setup success
```

Local parity nuance:

- `ci:local*` uses `migrate`, not `push`, so it is the production-parity path.
- If the local DB was created by the old `push` flow and has no migration history, the deploy guard stops early with an explicit error instead of letting `db-setup` hang.
- The one-time reset path for that old local state is `./scripts/local-k8s/deploy.sh down`.
- Local ClickHouse is enabled by default in `.env.k8s.local` so `npm run ci:local` exercises the API endpoint ClickHouse path.
- The local rollup rebuild check is manual: `cd backend && node --import tsx scripts/backfillClickHouseApiEndpointRollups.ts --replace`.

Relevant files:

- [`scripts/local-k8s/rejourney-ci.sh`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/local-k8s/rejourney-ci.sh)
- [`scripts/local-k8s/deploy.sh`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/local-k8s/deploy.sh)
- [`scripts/local-k8s/update-ips.sh`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/local-k8s/update-ips.sh)
- [`local-k8s/README.md`](/Users/mora/Desktop/Dev-mac/rejourney/local-k8s/README.md)

## [C5] Safety Rails / Failure Modes

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Safety rails                                                                │
│                                                                              │
│ GitHub deploy fails red on remote script errors                             │
│ db-setup waits fail fast on job failure and dump diagnostics                │
│ db-setup diagnostics are redacted before they enter GitHub Actions logs     │
│ CI runs scripts/ci/check-secret-hygiene.sh to block obvious leak patterns   │
│ VPS git remotes are tokenless public HTTPS URLs; CI tokens are not stored   │
│ archive.yaml must match session-backup.mjs before deploy                    │
│ local legacy push-era DBs are blocked by the compatibility guard            │
│ hot-table replay cleanup migration avoids wedging production traffic         │
│ ClickHouse deploy is gated by DEPLOY_CLICKHOUSE and app flags default false │
│ clickhouse-backfill-api-rollups is manual, never part of normal deploy      │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
Common reading rule for deploy logs

db-setup failed / timed out
  -> real deploy problem

crictl RemoveImage DeadlineExceeded during cleanup
  -> cleanup noise after the real failure, not the root cause
```

## [C6] Commands / Primary Files

```text
Primary commands

npm run ci:local
npm run ci:local:fast
npm run ci:local:checks
npm run ci:local:deploy
./scripts/local-k8s/deploy.sh down
bash scripts/k8s/deploy-release.sh <image-tag> [repository]
DEPLOY_CLICKHOUSE=true RUN_CLICKHOUSE_ROLLUP_BACKFILL=true bash scripts/k8s/deploy-release.sh <image-tag> [repository]
cd backend && node --import tsx scripts/backfillClickHouseApiEndpointRollups.ts --replace
```

Primary files:

- [`/.github/workflows/rejourney-ci.yml`](/Users/mora/Desktop/Dev-mac/rejourney/.github/workflows/rejourney-ci.yml)
- [`scripts/k8s/deploy-release.sh`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/k8s/deploy-release.sh)
- [`scripts/local-k8s/rejourney-ci.sh`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/local-k8s/rejourney-ci.sh)
- [`scripts/local-k8s/deploy.sh`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/local-k8s/deploy.sh)
- [`k8s/api.yaml`](/Users/mora/Desktop/Dev-mac/rejourney/k8s/api.yaml)
- [`k8s/clickhouse.yaml`](/Users/mora/Desktop/Dev-mac/rejourney/k8s/clickhouse.yaml)
- [`k8s/clickhouse-setup.yaml`](/Users/mora/Desktop/Dev-mac/rejourney/k8s/clickhouse-setup.yaml)
- [`k8s/clickhouse-backfill-api-rollups.yaml`](/Users/mora/Desktop/Dev-mac/rejourney/k8s/clickhouse-backfill-api-rollups.yaml)
- [`local-k8s/api.yaml`](/Users/mora/Desktop/Dev-mac/rejourney/local-k8s/api.yaml)
- [`local-k8s/clickhouse.yaml`](/Users/mora/Desktop/Dev-mac/rejourney/local-k8s/clickhouse.yaml)
- [`backend/scripts/backfillClickHouseApiEndpointRollups.ts`](/Users/mora/Desktop/Dev-mac/rejourney/backend/scripts/backfillClickHouseApiEndpointRollups.ts)
