# Self-hosted troubleshooting

Use this page if you followed [Self-hosted Rejourney](/docs/selfhosted) and something fails or behaves oddly. Commands are run from the **repository root** (where `docker-compose.selfhosted.yml` lives).

---

## Start Here

Pick the symptom that best matches what you are seeing.

| Symptom | First place to look |
|---|---|
| Install exits during bootstrap | [Install or update fails before or during bootstrap](#1-install-or-update-fails-before-or-during-bootstrap) |
| Dashboard opens, but recordings are empty | [Sessions are counted but Replay stays empty](#2-sessions-are-counted-but-replay-stays-empty) |
| Dashboard loads, but requests fail | [Dashboard loads, but auth or API calls fail](#3-dashboard-loads-but-auth-or-api-calls-fail) |
| Login says a code was sent, but no email arrives | [Dashboard loads, but auth or API calls fail](#3-dashboard-loads-but-auth-or-api-calls-fail) |
| Browser SDK says config is forbidden | [Web SDK config returns 403](#4-web-sdk-config-returns-403) |
| HTTPS does not issue | [TLS or certificate issues](#5-tls-or-certificate-issues) |
| S3 credentials work locally, but uploads fail | [External S3 works in CLI, but Rejourney cannot upload](#6-external-s3-works-in-cli-but-rejourney-cannot-upload) |

### 90-second triage

- [ ] `./scripts/selfhosted/deploy.sh status` shows API and upload relay running.
- [ ] DNS for dashboard, API, ingest, and www points at this server.
- [ ] `.env.selfhosted` is the original file for this deployment.
- [ ] `PUBLIC_API_URL` and `PUBLIC_INGEST_URL` use the public HTTPS hosts.
- [ ] If using the Web SDK, the app origin is in **Web allowed domains**.
- [ ] If using external S3, the `ingest-upload` container can reach the S3 endpoint.

---

## Fast Checks

### Service status

```bash
./scripts/selfhosted/deploy.sh status
```

### API logs

```bash
./scripts/selfhosted/deploy.sh logs api
```

### Upload relay logs

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### Worker logs

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. Install or update fails before or during bootstrap

### Symptoms

- `bootstrap` exits non-zero
- app services never become healthy
- `status` shows API or workers waiting on bootstrap
- install or update exits with `Database authentication failed before bootstrap.`

### Checks

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

Common causes:

- bad `DATABASE_URL`
- credentials mismatch (e.g. from an earlier failed deployment)
- missing `STORAGE_ENCRYPTION_KEY`
- invalid S3 credentials
- broken external S3 endpoint URL
- on **ARM64**, missing image support (set `DOCKER_DEFAULT_PLATFORM=linux/amd64` or use `./scripts/selfhosted/deploy.sh`, which sets it when unset)

Recovery:

1. If you still have the original `.env.selfhosted`, restore it and run:

```bash
./scripts/selfhosted/deploy.sh update
```

2. If you do not need old data, wipe and reinstall:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**Schema / migration messages:** On a normal install, the database starts empty and bootstrap sets everything up. If you **restored Postgres from a backup** into a new server but migration metadata is missing, or you pointed the stack at the **wrong database**, bootstrap may exit with an error about an inconsistent database instead of overwriting your data. Unless you are doing advanced recovery, fix `DATABASE_URL` and restore a consistent backup, or start from a clean volume. For deliberate migrate-only recovery, some setups use `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` in `.env.selfhosted` (see maintainer docs or support before using this).

### Fix

1. If you have the original `.env.selfhosted`, restore it and rerun:

```bash
./scripts/selfhosted/deploy.sh update
```

2. If you do not have the original `.env.selfhosted`, wipe and reinstall:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update` reruns schema, seed, and storage-endpoint sync. `reset` removes self-hosted containers and data volumes so a fresh install can generate new credentials safely.

---

## 2. Sessions are counted but Replay stays empty

### What this usually means now

With the current architecture, this is usually one of two things:

- `ingest-upload` could not store the artifact bytes
- `ingest-worker` could not process an uploaded artifact

The device no longer uploads directly to MinIO/S3, so bucket reachability from the phone is no longer the main suspect.

### Checks

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

Look for:

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### Common causes

- wrong S3 credentials in `.env.selfhosted`
- external S3 bucket missing
- external S3 endpoint unreachable from Docker network
- upload relay unhealthy
- worker stuck retrying failed artifacts

### Fix

- verify `S3_*` values
- if you changed storage config, rerun:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. Dashboard loads, but auth or API calls fail

### Checks

- dashboard host DNS points to the server
- API host DNS points to the server
- ingest host DNS points to the server
- ports `80` and `443` are open
- Let's Encrypt has issued certificates

Inspect:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

If the login form accepts an email but no OTP arrives, check `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and the API logs. Email OTP cannot work with blank SMTP settings. Use `SMTP_SECURE=false` for STARTTLS on port `587`; use `true` for implicit TLS, normally on port `465`. After editing `.env.selfhosted`, run:

```bash
./scripts/selfhosted/deploy.sh update
```

The login response is intentionally generic so it does not reveal whether an account exists. The API log is the source of truth for SMTP delivery errors.

---

## 4. Web SDK config returns 403

The Web SDK enforces the project's allowed browser origins before it returns
configuration or accepts ingest.

Checks:

- The app's browser origin is listed in the project's **Web allowed domains**.
- Include the host and port for local or staging apps, for example `localhost:3100`.
- `PUBLIC_API_URL` points at the public API host that browsers can reach.
- `PUBLIC_INGEST_URL` points at the public ingest upload relay host that browsers can reach.

After changing domain or ingest values in `.env.selfhosted`, rerun:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. TLS or certificate issues

Traefik manages certificates automatically.

### Checks

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

Make sure all names resolve to the server running the stack.

If DNS was wrong during first install, fix DNS and rerun:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. External S3 works in CLI, but Rejourney cannot upload

Remember the upload path is server-side.

The important network path is:

- `ingest-upload` container -> your S3 endpoint

Test from the server by reviewing relay logs and confirming the endpoint/bucket/keys in `.env.selfhosted`.

If you changed them, rerun:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. Built-in MinIO install, but artifacts still fail

### Checks

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

The `minio-setup` one-shot should create the bucket named by `S3_BUCKET`.
The bucket should remain private; replay downloads use the authenticated API proxy. Do not expose MinIO port `9000` just to make replay work.

If you changed the bucket name after first install, run:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 8. Billing pages show disabled billing

That is expected unless Stripe keys are configured.

The stack no longer disables billing because it is "self-hosted". It disables billing because Stripe is unconfigured.

If you do not set Stripe keys:

- billing UI stays in the self-hosted/unlimited state
- Stripe checkout and webhooks stay disabled

---

## 9. Storage endpoint in Postgres is wrong after changing `.env.selfhosted`

Run:

```bash
./scripts/selfhosted/deploy.sh update
```

For the standard self-hosted layout, the update path reruns bootstrap and resyncs the single global, non-shadow `storage_endpoints` row. If more than one global endpoint exists, sync stops rather than overwriting an advanced multi-endpoint configuration.

---

## 10. Need to stop services without losing data

Use:

```bash
./scripts/selfhosted/deploy.sh stop
```

This stops containers only. It does not remove volumes.

---

## 11. Need deeper logs for one service

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
