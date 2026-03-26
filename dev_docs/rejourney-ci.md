# Rejourney CI + Deploy Path (Visual)

Last updated: 2026-03-25

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
│ 2. Apply namespace / Traefik / cert-manager prerequisites                   │
│ 3. Verify archive.yaml matches session-backup.mjs                           │
│ 4. Print current drizzle migration status                                   │
│ 5. Delete old db-setup job                                                  │
│ 6. kubectl apply rendered manifests                                         │
│ 7. Wait for Postgres                                                        │
│ 8. Wait for db-setup success                                                │
│ 9. Print migration status again                                             │
│ 10. Wait for api / ingest-upload / web / workers rollouts                   │
│ 11. Cleanup finished pods                                                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
Important deploy behavior

set -euo pipefail is enabled in the remote deploy script
  -> if deploy-release.sh fails, the GitHub Actions job fails red
  -> later cleanup steps do not hide the real failure anymore
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
  -> apply local postgres / redis / minio infra
  -> run local db compatibility guard
  -> apply api / web / workers / ingress
  -> wait for deployments
  -> wait for db-setup success
```

Local parity nuance:

- `ci:local*` uses `migrate`, not `push`, so it is the production-parity path.
- If the local DB was created by the old `push` flow and has no migration history, the deploy guard stops early with an explicit error instead of letting `db-setup` hang.
- The one-time reset path for that old local state is `./scripts/local-k8s/deploy.sh down`.

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
│ archive.yaml must match session-backup.mjs before deploy                    │
│ local legacy push-era DBs are blocked by the compatibility guard            │
│ hot-table replay cleanup migration avoids wedging production traffic         │
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
```

Primary files:

- [`/.github/workflows/rejourney-ci.yml`](/Users/mora/Desktop/Dev-mac/rejourney/.github/workflows/rejourney-ci.yml)
- [`scripts/k8s/deploy-release.sh`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/k8s/deploy-release.sh)
- [`scripts/local-k8s/rejourney-ci.sh`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/local-k8s/rejourney-ci.sh)
- [`scripts/local-k8s/deploy.sh`](/Users/mora/Desktop/Dev-mac/rejourney/scripts/local-k8s/deploy.sh)
- [`k8s/api.yaml`](/Users/mora/Desktop/Dev-mac/rejourney/k8s/api.yaml)
- [`local-k8s/api.yaml`](/Users/mora/Desktop/Dev-mac/rejourney/local-k8s/api.yaml)
