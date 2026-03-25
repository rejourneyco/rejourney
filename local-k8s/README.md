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

## Notes

- The production `k8s/` directory is intentionally untouched.
- The self-hosted Docker path is still supported through
  `docker-compose.selfhosted.yml`.
- The old local Docker development stack is no longer part of the supported
  workflow.
