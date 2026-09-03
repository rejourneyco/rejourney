# Self-hosting Rejourney

<!-- AI_PROMPT_SECTION -->
**Using Cursor, Claude, or ChatGPT?** Copy a concise AI deployment brief with a link to this live guide and critical reminders for SDK endpoint routing, login, private storage, backups, and end-to-end recording verification.

<!-- /AI_PROMPT_SECTION -->

This guide walks you through running Rejourney on your own server with the official single-node **Docker Compose** stack. The default storage path is built-in **MinIO**. You can choose external S3-compatible storage during setup if you already have a bucket.

You do not need Kubernetes, Rejourney cloud infrastructure, or a complicated multi-node setup. You need one server, one domain, Docker, and a little patience while images pull.

After setup you get:

- A dashboard at your domain with HTTPS from Let's Encrypt.
- An API host for the dashboard and SDKs.
- An ingest upload relay host for replay bytes.
- Postgres, Redis, and either built-in MinIO or your own S3-compatible storage.
- Background workers for ingest, replay processing, retention, lifecycle, and alerts.

> [!NOTE]
> **Leaks and Automations are not included in the open-source self-hosted stack.** They depend on Rejourney's managed AI services, so the self-hosted dashboard hides those pages and their GitHub automation setup. The public demo may still show them as a product preview.

All commands below assume you are in the repository root, the folder that contains `docker-compose.selfhosted.yml`.

---

## Quick Path

Use this when you are doing a fresh install on a VPS.

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
./scripts/selfhosted/deploy.sh install
```

The installer asks for your domain, Let's Encrypt email, storage choice, and SMTP settings for passwordless login. It creates `.env.selfhosted`, starts the stack, waits for the public services to become healthy, and prints your URLs.

> [!IMPORTANT]
> Save `.env.selfhosted` somewhere secure right after install. It contains all deployment secrets, including the key used to decrypt stored storage credentials.

---

## Before You Start

Use this checklist before running the installer.

- [ ] I have a Linux server that can run Docker.
- [ ] `docker compose version` works on the server.
- [ ] Ports `80` and `443` are reachable from the internet.
- [ ] I control a base domain, for example `example.com`.
- [ ] I know which storage path I want: built-in MinIO or external S3-compatible storage.
- [ ] I have an email address for Let's Encrypt certificate notices.
- [ ] I have SMTP credentials for passwordless email login, or I will configure GitHub OAuth before signing in.
- [ ] I have a safe place to store `.env.selfhosted`.

### Recommended server

| Item | Recommendation |
|---|---|
| OS | Ubuntu 22.04+, Debian 12+, or another Docker-friendly Linux |
| Docker | Docker 24+ with the Docker Compose plugin |
| CPU/RAM | 4 vCPU and 8 GB RAM |
| Disk | 40 GB minimum; more if you keep many recordings |
| Network | Public inbound `80` and `443` |

### Domain worksheet

Replace `example.com` with your real domain and point each hostname at the server public IP.

| Hostname | Purpose | DNS record |
|---|---|---|
| `example.com` | Dashboard | `A` or `AAAA` to your server |
| `www.example.com` | Redirects to dashboard | `A` or `AAAA` to your server |
| `api.example.com` | API and SDK config | `A` or `AAAA` to your server |
| `ingest.example.com` | Upload relay | `A` or `AAAA` to your server |

DNS can take a few minutes to settle. Let's Encrypt certificates will not issue until these names resolve to the machine running Rejourney.

---

## Choose Storage

The installer asks which storage backend to use.

| Choose this | Best for | What you provide |
|---|---|---|
| Built-in MinIO | Most single-server installs | Nothing extra; the installer generates MinIO credentials |
| External S3-compatible storage | Teams that already operate object storage | Endpoint, bucket, region, access key, and secret key |

### Built-in MinIO

Built-in MinIO is the default and recommended path for a simple VPS. It runs inside Docker and is not exposed publicly by default. Session bytes are uploaded to your Rejourney ingest relay first, then written server-side to MinIO. The dashboard reads replay segments through an authenticated same-origin API proxy, so you do not need to publish port `9000` or make the bucket public.

The Compose stack pins the final official community MinIO container line rather than a mutable tag. MinIO's community repository is archived, so security-conscious or long-lived installations should prefer a maintained external S3-compatible service and include storage-provider replacement in their upgrade plan.

### External S3-compatible storage

Use AWS S3, Cloudflare R2, Hetzner Object Storage, Wasabi, or any S3-compatible API. The important network path is:

```text
ingest-upload container -> your S3 endpoint
```

Browsers and phones do not need direct write access to the bucket.

Common endpoint shapes:

| Provider | Endpoint example |
|---|---|
| AWS S3 | `https://s3.<region>.amazonaws.com` |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` |
| Hetzner | `https://<location>.your-objectstorage.com` |

If your provider gives you a separate public download URL, set `S3_PUBLIC_ENDPOINT` in `.env.selfhosted` and run `./scripts/selfhosted/deploy.sh update`.

---

## Install

### 1. Clone Rejourney

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

Stay on the default branch unless the project documents a release tag for self-hosting.

### 2. Run the installer

```bash
./scripts/selfhosted/deploy.sh install
```

The installer will:

1. Ask for your base domain, for example `example.com`.
2. Ask for your Let's Encrypt email.
3. Ask whether to use built-in MinIO or external S3-compatible storage.
4. Ask for SMTP settings. SMTP is required for email OTP login; leave it blank only if you will configure GitHub OAuth.
5. Create `.env.selfhosted` with generated passwords and secrets.
6. Pull published application images.
7. Build the bootstrap image from your local checkout.
8. Start Postgres, Redis, Traefik, and MinIO when selected.
9. Validate database connectivity before bootstrap.
10. Apply the database schema, seed first-time system data, and configure storage.
11. Start the API, upload relay, web dashboard, and workers, then wait for their health checks.

First install can take several minutes.

### 3. Save the generated config

```bash
ls -l .env.selfhosted
```

Back up `.env.selfhosted` in a password manager or encrypted backup. Do not commit it.

---

## Verify The Install

Run:

```bash
./scripts/selfhosted/deploy.sh status
```

You want to see:

- `api` running and healthy.
- `ingest-upload` running and healthy.
- `web` running.
- Postgres and Redis healthy.
- MinIO running if you chose built-in MinIO.
- Worker services running.

The installer prints your URLs:

| Service | URL shape |
|---|---|
| Dashboard | `https://example.com` |
| API | `https://api.example.com` |
| Ingest upload relay | `https://ingest.example.com` |
| WWW redirect | `https://www.example.com` -> `https://example.com` |

### Health checks

From the server, you can also check:

```bash
curl -fsS https://api.example.com/health
curl -fsS https://api.example.com/health/ingest
```

Replace `example.com` with your domain.

### First recording

- [ ] Open the dashboard.
- [ ] Confirm SMTP is configured (or GitHub OAuth is enabled) before requesting the first login code.
- [ ] Create an account.
- [ ] Create a project.
- [ ] Add the SDK to a test app.
- [ ] Record a short session.
- [ ] Confirm the session appears in Replay.

If sessions are counted but Replay is empty, check [Troubleshooting](/docs/selfhosted/troubleshooting).

---

## Configure Your Apps

Point SDKs at your API host. The API host must match `PUBLIC_API_URL` / `API_DOMAIN`.

> [!IMPORTANT]
> This is a required self-hosting step. Rejourney SDKs default to `https://api.rejourney.co` when `apiUrl` / `apiURL` is omitted, so recordings will go to Rejourney Cloud instead of your server. Use a project public key created in your self-hosted dashboard and explicitly set the self-hosted API URL in every app's initialization code.

### React Native

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('rj_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

Upload URLs are derived from server config when `PUBLIC_INGEST_URL` is correct.

### Flutter

```dart
import 'package:rejourney/rejourney.dart';

await Rejourney.init(
  'rj_your_public_key',
  config: const RejourneyConfig(
    apiUrl: 'https://api.example.com',
  ),
);

await Rejourney.start();
```

Flutter reads its upload relay configuration from the self-hosted API, so `apiUrl` must point at `PUBLIC_API_URL` rather than the ingest hostname.

### Swift iOS

After adding the Rejourney Swift package, configure the SDK with your self-hosted API URL.

```swift
import SwiftUI
import Rejourney

@main
struct MyApp: App {

    @MainActor
    init() {
        Rejourney.configure(
            publicKey: "rj_your_public_key",
            options: RejourneyOptions(
                apiURL: URL(string: "https://api.example.com")!
            )
        )
        Task { await Rejourney.start() }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

Swift reads project recording settings from `PUBLIC_API_URL` and uses the server-provided upload relay configuration. If you use `UIApplicationDelegate`, call the same `Rejourney.configure(...)` before `Rejourney.start()`.

### Web SDK

```ts
import { initRejourney, startRejourney } from '@rejourneyco/browser';

await initRejourney('rj_your_public_key', {
  apiUrl: 'https://api.example.com',
});

await startRejourney();
```

For browser apps, also add your app origin to the project **Web allowed domains**. If your app runs at `https://app.example.com`, allow `app.example.com`. For local testing, include the port, for example `localhost:3100`.

The Web SDK uses:

- `PUBLIC_API_URL` for config, device auth, and ingest coordination.
- `PUBLIC_INGEST_URL` for signed upload relay URLs.

Both hosts must be reachable from the user's browser.

---

## Daily Operations

| Task | Command |
|---|---|
| Show service status | `./scripts/selfhosted/deploy.sh status` |
| Follow all logs | `./scripts/selfhosted/deploy.sh logs` |
| Follow one service | `./scripts/selfhosted/deploy.sh logs api` |
| Upgrade images and rerun bootstrap | `./scripts/selfhosted/deploy.sh update` |
| Stop services without deleting data | `./scripts/selfhosted/deploy.sh stop` |
| Reset containers and volumes | `./scripts/selfhosted/deploy.sh reset` |

> [!CAUTION]
> `reset` is destructive. It removes self-hosted containers and Docker volumes, including Postgres and MinIO data. Use it only when you want a clean install and old data can be deleted.

### Updating safely

Use:

```bash
./scripts/selfhosted/deploy.sh update
```

`update` pulls newer images, rebuilds the bootstrap image from your checkout, restarts services, and reruns schema/storage bootstrap. It does not wipe Postgres or object storage volumes.

---

## Important Configuration

The installer writes `.env.selfhosted`. These are the values you are most likely to touch later:

| Area | Variables |
|---|---|
| Domains | `BASE_DOMAIN`, `DASHBOARD_DOMAIN`, `API_DOMAIN`, `INGEST_DOMAIN` |
| Public URLs | `PUBLIC_DASHBOARD_URL`, `PUBLIC_API_URL`, `PUBLIC_INGEST_URL` |
| Database | `DATABASE_URL`, `POSTGRES_*` |
| Redis | `REDIS_URL`, `REDIS_PASSWORD` |
| Storage | `STORAGE_BACKEND`, `S3_*`, `MINIO_*` |
| Security | `JWT_SECRET`, `JWT_SIGNING_KEY`, `SHARE_LINK_SECRET`, `INGEST_HMAC_SECRET`, `STORAGE_ENCRYPTION_KEY`, `SUPERWALL_API_KEY_ENCRYPTION_KEY`, `REVENUECAT_API_KEY_ENCRYPTION_KEY` |
| Visitor ledger | `VISITOR_KEY_SECRET` (HMAC key for the pseudonymous returning-visitor ledger; falls back to `JWT_SECRET`, and rotating it makes every visitor look new once), `VISITOR_LEDGER_WRITE_ENABLED` (kill switch, default `true`) |
| Email login | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` |

SMTP is required for passwordless email login. For the usual STARTTLS submission port `587`, set `SMTP_SECURE=false`; use `true` for implicit TLS, normally on port `465`. SMTP may stay blank only if GitHub OAuth is configured as the login path.

Other optional integrations can stay blank until you need them:

- Stripe
- GitHub OAuth

The deployment script reads this file through Docker Compose's dotenv parser; it does not execute it as a shell script. Standard quoted dotenv values are supported for credentials containing spaces or shell metacharacters.

After changing domain or storage settings, run:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## How Bootstrap Works

You normally do not need to run SQL by hand.

| Situation | What bootstrap does |
|---|---|
| Empty database | Applies the current schema, stamps satisfied migrations, seeds system data, and configures storage |
| Existing initialized database | Applies pending migrations and refreshes safe system data; for a standard single-endpoint self-host, syncs the one global storage endpoint from `.env.selfhosted` |
| Database has tables but no migration history | Stops instead of guessing, to avoid damaging data |

If bootstrap stops because credentials do not match existing Postgres data, restore the original `.env.selfhosted` and run `update`. Only use `reset` if losing the existing data is acceptable.

The self-hosted storage sync deliberately stops if it finds multiple global endpoints. Advanced multi-endpoint installations are operator-managed, and an update will not overwrite them.

---

## Apple Silicon And ARM Servers

On ARM64 machines, the deploy script sets `DOCKER_DEFAULT_PLATFORM=linux/amd64` when you have not set it yourself. This helps when published images are amd64-only.

The bootstrap image is always built locally from your checkout, so database setup matches your code.

---

## What Runs In Docker

| Service | Role |
|---|---|
| Traefik | HTTPS certificates and routing |
| Postgres | Application data |
| Redis | Queues, caches, and rate-limit state |
| MinIO | Built-in object storage when selected |
| API | Main dashboard and SDK API |
| ingest-upload | Upload relay for replay/event bytes |
| web | Dashboard UI |
| ingest-worker | Processes event artifacts |
| replay-worker | Processes replay artifacts |
| session-lifecycle-worker | Finalizes and reconciles sessions |
| retention-worker | Runs scheduled retention cleanup |
| alert-worker | Sends alert-related work |
| revenue-sync-worker | Reconciles configured revenue integrations |

---

## Backups

At minimum, back up:

- Postgres
- `.env.selfhosted`
- MinIO data if you use built-in MinIO

Use:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Details: [Backup & Recovery](/docs/selfhosted/backup-recovery).

---

## Where To Go Next

- [Troubleshooting](/docs/selfhosted/troubleshooting) for bootstrap, TLS, Web SDK, and replay ingestion issues.
- [Backup & Recovery](/docs/selfhosted/backup-recovery) for restore order and verification.
- [Distributed vs single-node cloud](/docs/distributed-vs-single-node/distributed-vs-single-node) for the conceptual architecture comparison.
