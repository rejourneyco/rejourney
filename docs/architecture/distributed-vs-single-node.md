# Distributed vs Single-Node Cloud

Rejourney supports two official self-hosted deployment shapes:

- **Single-node Docker Compose** for one server or VPS
- **Distributed K3s** for production clusters and horizontal scaling

Both now use the same core backend model:

- storage endpoints are database-backed
- ingest uploads go through the backend-owned upload relay
- workers process verified artifacts
- replay visibility is artifact-driven

---

## Feature Comparison

| Feature | Distributed Cloud | Single-Node Cloud |
|---------|--------------------|-------------------|
| Platform | K3s | Docker Compose |
| Scale | Multi-node | Single-node |
| Public entrypoints | Traefik ingress | Traefik container |
| Upload path | API + ingest-upload service | API + ingest-upload service |
| Storage source of truth | `storage_endpoints` table | `storage_endpoints` table |
| Default object storage | External S3 | Built-in MinIO |
| External S3 support | Yes | Yes |
| Secret encryption | `STORAGE_ENCRYPTION_KEY` | `STORAGE_ENCRYPTION_KEY` |
| Update flow | k8s deploy + jobs | `deploy.sh update` |

---

## Shared Storage Model

In both deployment models, runtime storage configuration comes from Postgres, not from an env fallback.

That means:

- the active object storage endpoint is stored in `storage_endpoints`
- secret access keys are encrypted into `key_ref`
- runtime reads the database row
- bootstrap/install scripts are responsible for syncing `.env` input into the database row

This makes self-hosted Docker much closer to prod and local-k8s than the old fallback model.

---

## When to Choose Single-Node Docker Compose

Choose Docker Compose when:

- you are deploying to one VPS or bare-metal host
- you want the fastest install path
- you want built-in MinIO by default
- you do not need multi-node scaling or Kubernetes operations

Official entrypoints:

- `docker-compose.selfhosted.yml`
- `scripts/selfhosted/deploy.sh`
- `docs/selfhosted/README.md`

---

## When to Choose Distributed K3s

Choose K3s when:

- you need multiple nodes
- you want Kubernetes-native ops and secret handling
- you want to scale API, upload, and worker services independently
- you want rolling deploys and stronger infra isolation

The K3s path lives under `k8s/` and `scripts/k8s/`.

---

## Operational Difference

The main difference is not data model anymore. It is operational shape:

- Compose: one machine, one Docker network, one operator script
- K3s: multiple pods, namespaces, cluster ingress, Kubernetes jobs and secrets

---

## Practical Guidance

Start with single-node Compose if you want to self-host quickly.

Move to K3s when you need:

- more throughput
- rolling cluster deploys
- horizontal scaling
- more resilient infrastructure separation

---

## Internal Architecture Docs

For the latest internal engineering visuals and deeper operator detail:

- `dev_docs/ingest-session-recording-lifecycle.md` (session lifecycle diagram)
- `dev_docs/storage-and-endpoints.md` (multi-bucket topology diagram)
- `dev_docs/allthingscloud.md` (k3s cloud setup diagram)

For a graphics-only architecture page, open [`/docs/architecture/diagrams`](/docs/architecture/diagrams).
