# Self-hosting Rejourney

This guide is for **anyone** running Rejourney on their own server (typically a single VPS or dedicated machine) using the official **Docker Compose** stack. You do not need access to Rejourney’s internal infrastructure or Kubernetes.

After setup you get:

- A **web dashboard** at your domain (HTTPS via Let’s Encrypt)
- An **API** on a subdomain (for the dashboard and mobile SDK)
- An **ingest (upload) relay** on another subdomain (session uploads go through your server, not directly from phones to object storage)
- **PostgreSQL**, **Redis**, and either **built-in MinIO** or **your own S3-compatible storage**
- Background **workers** that process sessions, retention, and alerts (same roles as in Rejourney’s cloud deployment)

All commands below assume you are in the **repository root** after cloning (the folder that contains `docker-compose.selfhosted.yml`).

---

## What you need beforehand

### Server

- **OS:** Ubuntu 22.04+, Debian 12+, or another Linux that runs Docker well  
- **Docker:** 24 or newer, with the **Docker Compose plugin** (`docker compose version` should work)  
- **Resources (recommended):** 4 vCPU, 8 GB RAM, 40 GB disk (more if you keep many recordings)  
- **Network:** Ports **80** and **443** open to the internet (required for Let’s Encrypt HTTP challenge and HTTPS)

### Domain and DNS

You need **one base domain** you control (for example `example.com`). Before running the installer, create DNS **A** (or **AAAA**) records pointing **all** of these hostnames at your server’s public IP:

| Hostname | Purpose |
|----------|---------|
| `example.com` | Dashboard |
| `www.example.com` | Redirects to the dashboard |
| `api.example.com` | API (and WebSocket where used) |
| `ingest.example.com` | Upload relay (SDK uses this automatically once API is configured) |

Replace `example.com` with your real domain. Propagation can take a few minutes to hours; TLS certificates will not issue until DNS resolves correctly.

### Let’s Encrypt

You will be asked for an **email address** during install. It is used for certificate expiry notices from Let’s Encrypt.

### Tools on your machine

- `git` to clone the repository  
- `openssl` (used by the install script to generate secrets)  
- A shell (bash is fine)

---

## First-time installation

### 1. Clone the repository

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

Stay on the default branch (or a release tag if the project documents one for self-hosting).

### 2. Run the installer

```bash
./scripts/selfhosted/deploy.sh install
```

The script will:

1. Ask for your **base domain** (e.g. `example.com` — not `https://`, no path).  
2. Ask for your **Let’s Encrypt email**.  
3. Ask for **storage**: built-in **MinIO** (recommended) or **external S3-compatible** storage (you will enter endpoint, bucket, region, and keys).  
4. Create **`.env.selfhosted`** in the repo root with generated passwords and secrets. **Restrict permissions** are applied (`chmod 600`).  
5. **Pull** published container images (API, web, workers, databases, Traefik, etc.).  
6. **Build** the **bootstrap / migration** image **from your clone** (it contains the database setup scripts; it is not downloaded from the container registry).  
7. Start databases, Redis, Traefik, and (if chosen) MinIO.
8. Validate database connectivity using the configured `DATABASE_URL` before bootstrap runs.
9. Run a one-shot **bootstrap** container: database schema, optional first-time seed, and storage configuration in the database.
10. Start the API, upload relay, dashboard, and workers.

First install can take several minutes (image pulls and bootstrap).

### 3. Protect `.env.selfhosted`

This file holds **all secrets** for your deployment (database, Redis, JWT, storage encryption, MinIO credentials if used, etc.). **Back it up** to a safe place (password manager, encrypted backup). If you lose it, you may lose the ability to decrypt stored credentials or to reconstruct the same deployment.

Do not commit it to git (it should be ignored by `.gitignore`).

---

## After installation

### URLs

The installer prints the URLs. In general:

- **Dashboard:** `https://<your-base-domain>`  
- **API:** `https://api.<your-base-domain>`  
- **Ingest:** `https://ingest.<your-base-domain>`  

`www.<your-base-domain>` redirects to the dashboard.

### Verify the stack

```bash
./scripts/selfhosted/deploy.sh status
```

You should see containers running; `api` and `ingest-upload` should become **healthy** after a short time.

### First login and test recording

1. Open the dashboard in a browser.  
2. Create an account and a project.  
3. Configure your app’s Rejourney SDK with your **API URL** (see [SDK configuration](#configuring-your-mobile-app) below).  
4. Record a short session and confirm it appears in Replay.

If sessions never show up in Replay, see [Troubleshooting](/docs/selfhosted/troubleshooting) (upload relay and ingest worker logs).

---

## Day-to-day operations

All of these run from the repo root.

| Action | Command |
|--------|---------|
| Service status | `./scripts/selfhosted/deploy.sh status` |
| Follow all logs | `./scripts/selfhosted/deploy.sh logs` |
| Logs for one service | `./scripts/selfhosted/deploy.sh logs api` (replace `api` with `web`, `ingest-upload`, `ingest-worker`, etc.) |
| **Upgrade** images and rerun bootstrap | `./scripts/selfhosted/deploy.sh update` |
| Stop everything **without** deleting data | `./scripts/selfhosted/deploy.sh stop` |
| **Reset** containers and volumes (destructive) | `./scripts/selfhosted/deploy.sh reset` |

**`update`** pulls newer images (where applicable), rebuilds the bootstrap image from your current clone, restarts the stack, and runs bootstrap again so the database schema and storage settings stay aligned with your `.env.selfhosted`. It does **not** wipe Postgres or object storage volumes.

Before bootstrap, both `install` and `update` validate database connectivity with the configured credentials. If credentials do not match persisted Postgres data, deployment stops early with recovery guidance instead of failing later in bootstrap.

**`stop`** stops containers only; Docker **volumes** (Postgres data, MinIO data, etc.) remain until you remove them explicitly.

**`reset`** removes the self-hosted containers and Docker volumes (`pgdata`, `redisdata`, `miniodata`, `traefik-certs`) after a confirmation prompt. It also tears down MinIO profile containers even when `.env.selfhosted` is missing, so stale MinIO data does not block the next install. Use this only when you want a fully fresh install.

---

## Storage: MinIO vs external S3

### Built-in MinIO (default)

- Easiest for a single server: object storage runs **inside Docker** and is not exposed to the public internet by default.  
- Session bytes are written by the **ingest-upload** service; devices do not need to reach MinIO directly.  
- Bucket creation is handled during install.

### External S3-compatible storage

Use AWS S3, Cloudflare R2, Hetzner Object Storage, Wasabi, or any S3-compatible API. During install you provide endpoint URL, bucket, region, and access keys.

Examples of endpoint URL styles (your provider’s docs are authoritative):

- AWS: `https://s3.<region>.amazonaws.com`  
- Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`  
- Hetzner: `https://<location>.your-objectstorage.com`  

If you add a **separate public URL** for downloads, set `S3_PUBLIC_ENDPOINT` in `.env.selfhosted` and run `./scripts/selfhosted/deploy.sh update`.

---

## Important configuration (`.env.selfhosted`)

The installer generates this file. Typical variables include:

- **Domains and public URLs:** `BASE_DOMAIN`, `DASHBOARD_DOMAIN`, `API_DOMAIN`, `INGEST_DOMAIN`, `PUBLIC_*_URL`  
- **Database:** `DATABASE_URL` (points at the `postgres` service inside Compose)  
- **Redis:** `REDIS_URL`  
- **Storage:** `STORAGE_BACKEND`, `S3_*`, and optionally `MINIO_*`  
- **Security:** `JWT_SECRET`, `JWT_SIGNING_KEY`, `INGEST_HMAC_SECRET`, `STORAGE_ENCRYPTION_KEY`  

Optional integrations (leave blank if unused): Stripe, SMTP, GitHub OAuth, Turnstile, etc.

**Changing storage or domain-related values:** edit `.env.selfhosted`, then run:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## How database setup works (first boot vs later updates)

You normally do **not** need to run SQL by hand. The **bootstrap** container handles it.

- **Brand-new empty database:** the stack applies the current schema from code, then records which migration versions are already satisfied so future updates only apply **new** migrations.  
- **Existing database (already initialized):** only **pending** migrations are applied. Your data is not rebuilt from scratch on each `update`.  
- If the database **already has tables** but the migration history table is **missing or empty** (for example a partial restore), bootstrap **stops with an error** to avoid accidental damage. Advanced recovery options are documented in [Troubleshooting](/docs/selfhosted/troubleshooting).

---

## Apple Silicon and ARM servers

On **ARM64** machines (many Macs, some cloud instances), the deploy script sets `DOCKER_DEFAULT_PLATFORM=linux/amd64` for image pulls when you have not set it yourself, so prebuilt images that only publish `amd64` still run. If you need a different behavior, set `DOCKER_DEFAULT_PLATFORM` in your environment before running the script.

The **bootstrap** image is always **built on your machine** from the cloned repository, so it always matches your checkout.

---

## What runs in Docker (overview)

- **Traefik:** HTTPS certificates and routing to the dashboard, API, and ingest hostnames.  
- **Postgres / Redis:** Application data and queues.  
- **MinIO:** Optional internal object storage.  
- **API:** Main HTTP API.  
- **ingest-upload:** Dedicated service for upload relay traffic.  
- **web:** Dashboard static UI.  
- **Workers:** Process ingest queues, replay artifacts, session lifecycle, scheduled retention-style work, and alerts.

There is **no** separate billing batch worker in this stack; billing integration is driven by Stripe and the API when you configure keys.

---

## Configuring your mobile app

Point the SDK at **your** API host (must match `API_DOMAIN` / `PUBLIC_API_URL`).

### React Native example

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

Use your real API URL. Upload URLs are derived for `ingest.<your-domain>` automatically when the server is configured correctly.

---

## Backups

At minimum, back up **PostgreSQL**, **`.env.selfhosted`**, and (if you use built-in MinIO) **object storage data**.

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Details: [Backup & Recovery](/docs/selfhosted/backup-recovery).

---

## Troubleshooting and support

- [Troubleshooting](/docs/selfhosted/troubleshooting) — bootstrap failures, TLS, empty Replay, external S3 issues.  
- [Backup & Recovery](/docs/selfhosted/backup-recovery) — restore order and MinIO.  

For bugs or improvements to these docs, use the project’s public issue tracker on GitHub.

---

## Related documentation

- [Distributed vs single-node cloud](/docs/distributed-vs-single-node/distributed-vs-single-node) — how this compares to a multi-service cloud layout (conceptual).
