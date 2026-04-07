# Self-hosted troubleshooting

Use this page if you followed [Self-hosted Rejourney](/docs/selfhosted) and something fails or behaves oddly. Commands are run from the **repository root** (where `docker-compose.selfhosted.yml` lives).

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

## 1. Install or update fails during bootstrap

### Symptoms

- `bootstrap` exits non-zero
- app services never become healthy
- `status` shows API or workers waiting on bootstrap

### Checks

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

Common causes:

- bad `DATABASE_URL`
- missing `STORAGE_ENCRYPTION_KEY`
- invalid S3 credentials
- broken external S3 endpoint URL
- on **ARM64**, missing image support (set `DOCKER_DEFAULT_PLATFORM=linux/amd64` or use `./scripts/selfhosted/deploy.sh`, which sets it when unset)

**Schema / migration messages:** On a normal install, the database starts empty and bootstrap sets everything up. If you **restored Postgres from a backup** into a new server but migration metadata is missing, or you pointed the stack at the **wrong database**, bootstrap may exit with an error about an inconsistent database instead of overwriting your data. Unless you are doing advanced recovery, fix `DATABASE_URL` and restore a consistent backup, or start from a clean volume. For deliberate migrate-only recovery, some setups use `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` in `.env.selfhosted` (see maintainer docs or support before using this).

### Fix

1. correct `.env.selfhosted`
2. rerun:

```bash
./scripts/selfhosted/deploy.sh update
```

That reruns schema, seed, and storage-endpoint sync.

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
- Let’s Encrypt has issued certificates

Inspect:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS or certificate issues

Traefik manages certificates automatically.

### Checks

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

Make sure both names resolve to the server running the stack.

If DNS was wrong during first install, fix DNS and rerun:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. External S3 works in CLI, but Rejourney cannot upload

Remember the upload path is server-side.

The important network path is:

- `ingest-upload` container -> your S3 endpoint

Test from the server by reviewing relay logs and confirming the endpoint/bucket/keys in `.env.selfhosted`.

If you changed them, rerun:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. Built-in MinIO install, but artifacts still fail

### Checks

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

The `minio-setup` one-shot should create the bucket named by `S3_BUCKET`.

If you changed the bucket name after first install, run:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. Billing pages show disabled billing

That is expected unless Stripe keys are configured.

The stack no longer disables billing because it is “self-hosted”. It disables billing because Stripe is unconfigured.

If you do not set Stripe keys:

- billing UI stays in the self-hosted/unlimited state
- Stripe checkout and webhooks stay disabled

---

## 8. Storage endpoint in Postgres is wrong after changing `.env.selfhosted`

Run:

```bash
./scripts/selfhosted/deploy.sh update
```

The update path reruns bootstrap and resyncs the active `storage_endpoints` row.

---

## 9. Need to stop services without losing data

Use:

```bash
./scripts/selfhosted/deploy.sh stop
```

This stops containers only. It does not remove volumes.

---

## 10. Need deeper logs for one service

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
