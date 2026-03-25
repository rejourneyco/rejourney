# Self-Hosted Rejourney

Run Rejourney as a single-node Docker Compose deployment with the same backend shape as prod and local-k8s:

- Traefik handles TLS and routing
- API and ingest-upload are separate services
- Postgres, Redis, and MinIO stay internal-only
- storage_endpoints in Postgres remain the source of truth for object storage
- bootstrap reruns schema, seed, and storage-endpoint sync on every install and update

This is the official self-hosted path for a single server or VPS.

---

## Architecture

The self-hosted stack now mirrors prod’s public hostname shape more closely:

- `https://example.com` -> dashboard web app
- `https://www.example.com` -> redirects to `https://example.com`
- `https://api.example.com` -> API routes
- `https://ingest.example.com` -> upload relay URLs returned to the SDK

Behind Traefik, the stack runs these services:

- `traefik`
- `postgres`
- `redis`
- `minio` (default) or external S3
- `bootstrap` (one-shot schema + seed + storage sync)
- `api`
- `ingest-upload`
- `web`
- `ingest-worker`
- `retention-worker`
- `alert-worker`

Two important behavior changes compared with the old self-hosted path:

1. Session uploads no longer rely on the mobile device talking directly to MinIO or your S3 bucket.
   The SDK still gets a `presignedUrl`, but it now uploads to Rejourney’s `ingest-upload` relay, which writes to storage server-side.

2. Storage routing no longer falls back to `.env` values at runtime.
   The active storage endpoint is written into Postgres and encrypted in `storage_endpoints`, the same pattern used in prod and local-k8s.

---

## Requirements

Minimum recommended server:

- Ubuntu 22.04+ or Debian 12+
- Docker 24+
- Docker Compose plugin
- 4 vCPU
- 8 GB RAM
- 40 GB SSD
- ports `80` and `443` open
- DNS records already pointing at your server

You also need:

- one base domain
- DNS records for the dashboard, API, and ingest hosts
- an email address for Let’s Encrypt

Examples:

- dashboard: `example.com`
- www redirect: `www.example.com`
- api: `api.example.com`
- ingest: `ingest.example.com`

---

## Install

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
./scripts/selfhosted/deploy.sh install
```

The operator script will:

1. prompt for your base domain and storage choice
2. generate `.env.selfhosted`
3. pull images
4. start infrastructure services
5. run `bootstrap` to apply schema, seed defaults, and sync `storage_endpoints`
6. start API, upload relay, dashboard, and workers

After install, the main commands are:

```bash
./scripts/selfhosted/deploy.sh status
./scripts/selfhosted/deploy.sh logs
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh update
./scripts/selfhosted/deploy.sh stop
```

`stop` preserves volumes and data. It does not wipe Postgres or object storage.

---

## Generated Config

The install script writes `.env.selfhosted` in the repo root.

Important fields:

```bash
BASE_DOMAIN=example.com
DASHBOARD_DOMAIN=example.com
WWW_DOMAIN=www.example.com
API_DOMAIN=api.example.com
INGEST_DOMAIN=ingest.example.com
PUBLIC_DASHBOARD_URL=https://example.com
PUBLIC_API_URL=https://api.example.com
PUBLIC_INGEST_URL=https://ingest.example.com

DATABASE_URL=postgresql://rejourney:...@postgres:5432/rejourney
REDIS_URL=redis://:...@redis:6379/0

STORAGE_BACKEND=minio
S3_ENDPOINT=http://minio:9000
S3_BUCKET=rejourney
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=rejourney
S3_SECRET_ACCESS_KEY=...

JWT_SECRET=...
JWT_SIGNING_KEY=...
INGEST_HMAC_SECRET=...
STORAGE_ENCRYPTION_KEY=...
```

Treat `.env.selfhosted` as critical backup material. It contains the credentials needed to decrypt storage secrets and run the stack.

---

## Storage Modes

### Built-in MinIO

Default and recommended for first install.

- `STORAGE_BACKEND=minio`
- `minio` and `minio-setup` run inside Docker
- object storage is private to the Docker network
- `bootstrap` writes the active MinIO endpoint into `storage_endpoints`

This is the easiest way to match prod/dev behavior without managing a separate S3 service.

### External S3

Supported for advanced installs.

Use this when you want AWS S3, Cloudflare R2, Hetzner Object Storage, Wasabi, or another S3-compatible backend.

The operator script still writes the selected endpoint into Postgres. Runtime reads the database row, not the raw `.env` values.

Provider examples:

- AWS S3: `https://s3.us-east-1.amazonaws.com`
- Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`
- Hetzner: `https://fsn1.your-objectstorage.com`
- Wasabi: `https://s3.wasabisys.com`

If you use a different public hostname for direct signed downloads, set `S3_PUBLIC_ENDPOINT` in `.env.selfhosted` before running `update`.

---

## SDK Configuration

Your mobile SDK must point to your self-hosted API domain.

### React Native

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

That `apiUrl` must match the API hostname from your self-hosted install. Upload relay URLs will use `ingest.example.com` automatically.

---

## Upgrades

Use the operator script for upgrades:

```bash
./scripts/selfhosted/deploy.sh update
```

`update` does all of the following again:

- pulls new images
- starts infrastructure if needed
- reruns `bootstrap`
- reapplies schema
- reruns normal seed
- resyncs the active storage endpoint row in Postgres
- restarts API, upload relay, web, and workers

That means storage endpoint changes in `.env.selfhosted` are applied on update without shelling into the API container manually.

---

## First Smoke Test

After install:

1. open the dashboard and create an account
2. create a project
3. point a test build of your app at `https://api.example.com`
4. record one short session
5. confirm the session appears in Replay

If usage increases but Replay stays empty, the first places to check are:

- `./scripts/selfhosted/deploy.sh logs ingest-upload`
- `./scripts/selfhosted/deploy.sh logs ingest-worker`
- `./scripts/selfhosted/deploy.sh logs api`

With the current architecture, a session should only fail to appear if the relay or worker path is unhealthy. The device no longer needs direct connectivity to MinIO.

---

## Backup and Restore

Back up at minimum:

- Postgres
- `.env.selfhosted`
- MinIO data if you use built-in MinIO

Helper script:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Use `--full` when you want MinIO object storage included.

More detail:

- [Backup & Recovery](/docs/selfhosted/backup-recovery)
- [Troubleshooting](/docs/selfhosted/troubleshooting)

---

## Common Checks

### Services

```bash
./scripts/selfhosted/deploy.sh status
```

### API health

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs api
```

### Upload relay health

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs ingest-upload
```

### Worker health

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs ingest-worker
```

### Bootstrap rerun after config change

```bash
./scripts/selfhosted/deploy.sh update
```

---

## Related Docs

- [Backup & Recovery](/docs/selfhosted/backup-recovery)
- [Troubleshooting](/docs/selfhosted/troubleshooting)
- [Distributed vs Single-Node Cloud](/docs/architecture/distributed-vs-single-node)
