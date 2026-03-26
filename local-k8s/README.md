# Local Kubernetes Development

`local-k8s/` is the local counterpart to the production `k8s/` directory.

It keeps the same plain-YAML shape as the prod manifests, but targets a local
`k3d` cluster and a local namespace: `rejourney-local`.

## Files

- `namespace.yaml`: local namespace and labels
- `postgres.yaml`: PostgreSQL with a NodePort for host access
- `redis.yaml`: Redis with a NodePort for host access
- `minio.yaml`: local S3-compatible storage plus bucket bootstrap job
- `api.yaml`: API deployment and `db-setup` job for full-cluster parity
- `web.yaml`: dashboard deployment for full-cluster parity
- `workers.yaml`: worker deployments for full-cluster parity
- `ingress.yaml`: local Traefik ingress using `*.localtest.me`
- `env.example`: template for `.env.k8s.local`

## Default Flow

For daily work:

```bash
cp local-k8s/env.example .env.k8s.local
npm run dev
```

That creates the local cluster if needed, applies infra-only manifests, updates
LAN-safe URLs, syncs secrets, and runs the API, web, and workers from source on
the host.

## Full Parity Flow

```bash
npm run dev:full
```

That builds local images, imports them into `k3d`, applies `api.yaml`,
`web.yaml`, `workers.yaml`, and `ingress.yaml`, and exposes:

- `http://rejourney.localtest.me`
- `http://api.localtest.me`
- `http://ingest.localtest.me`

## Local Ports

- PostgreSQL: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`
- MinIO API: `127.0.0.1:9000`
- MinIO Console: `127.0.0.1:9001`

## Useful Commands

- `npm run dev`: hybrid flow with infra in Kubernetes and app services on the host
- `npm run dev:full`: full local stack in Kubernetes
- `npm run dev:logs`: host-process logs for the hybrid workflow
- `npm run dev:down`: stop host services and remove the local namespace

## Local CI Parity

Use the dedicated local CI runner when you want the GitHub Actions checks plus
the local image build/import/deploy path in one command:

```bash
npm run ci:local
```

That flow:

- updates `.env.k8s.local` and the example app URLs with the current LAN IP
- runs the schema/migration guard
- runs backend lint, unit tests, billing tests, and billing-specific ESLint
- runs web typecheck and build
- builds/imports the local API, web, and migration images
- reapplies the local k8s app manifests, including the same `db-setup` path as production: `migrate + conditional-seed + system-bootstrap + storage-endpoint sync`
- restarts the host-side API/upload/web processes for device testing

For a quicker inner loop that still rebuilds, redeploys, reruns migrations, and
restarts the local stack without reinstalling npm dependencies:

```bash
npm run ci:local:fast
```

If your existing local Postgres volume was created by the older `drizzle-kit push`
workflow, the new migrate-based parity flow will stop with an explicit error.
Reset the local namespace once, then rerun:

```bash
./scripts/local-k8s/deploy.sh down
npm run ci:local:fast
```

## Production Note

The legacy replay cleanup migration now prefers safe deploys over immediate
physical column removal. If production is under load and the `sessions` table
is busy, the migration may be recorded without dropping the old
`replay_promoted*` columns. That is expected and safe because the application no
longer depends on those columns.

If you still want to remove the columns physically, do it during a quiet manual
maintenance window after checking for long-running `sessions` queries.

## Notes

- The production `k8s/` directory is intentionally untouched.
- The self-hosted Docker path is still supported through
  `docker-compose.selfhosted.yml`.
- The old local Docker development stack is no longer part of the supported
  workflow.
