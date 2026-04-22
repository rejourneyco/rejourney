# Plan: Kubernetes Scaling — Two-Part Migration

## Context

Current state: single Hetzner CPX42 (8 vCPU, 16 GB RAM) running k3s with all workloads colocated on local-path storage. Critical data (Postgres, Redis) is permanently lost if the node is replaced.

**Strategy:**
- **Part 1** — Everything on the single node: migrate Postgres to CloudNativePG (hcloud-volumes + WAL archiving), migrate Redis to Bitnami Sentinel (hcloud-volumes + Sentinel protocol active), add Hetzner LB, fix all hygiene issues. After Part 1, the node can be replaced without data loss, and HA can be enabled by adding nodes.
- **Part 2** — Add 2 worker nodes. Because Part 1 already deployed CNPG and Bitnami Sentinel, scaling to HA is just changing instance counts and quorum settings.

---

## What Gets Fixed

| Issue | Part |
|---|---|
| Postgres on local-path — lost if node replaced | 1 |
| Redis on local-path — lost if node replaced | 1 |
| Redis is a Deployment — can't remount RWO PVC after reschedule | 1 |
| `edoburu/pgbouncer:latest` — silent breaking changes | 1 |
| No `startingDeadlineSeconds` on CronJobs — stops firing after 100 missed slots | 1 |
| VictoriaMetrics, Grafana, Gatus missing `Recreate` strategy — rolling update deadlocks on RWO PVC | 1 |
| No Pod Disruption Budgets — `kubectl drain` evicts all API pods simultaneously | 1 |
| Web has 1 replica — single pod = SPOF | 1 |
| `admin-tools.yaml` redis-commander broken after Redis auth | 1 |
| No Hetzner LB — all traffic tied to single node IP | 1 |
| No PostgreSQL HA — failover requires manual recovery | 2 |
| No Redis HA — failover requires manual recovery | 2 |
| API pods can land on same node — no cross-node spread | 2 |

---

# PART 1 — Single-Node Hardening + Infrastructure Migration

**Goal:** After Part 1:
- Postgres is managed by CloudNativePG (single instance, Hetzner Volume, WAL archiving to R2)
- Redis is managed by Bitnami with Sentinel protocol active (single master, ready to scale in Part 2)
- Hetzner LB handles all ingress (node IP is no longer a SPOF)
- All hygiene issues resolved

**Total planned downtime: ~10 min in one maintenance window + one 30s CNPG cutover window (can be scheduled independently).**

```
Phase 1-A  Code & manifest changes → CI push (zero downtime, do this first)
Phase 1-B  Hetzner infrastructure prep (zero downtime, 1+ hours before window)
Phase 1-C  Maintenance window — ~10 min
Phase 1-D  CNPG background import (zero downtime, after window)
Phase 1-E  CNPG cutover (~30s downtime, separate window)
Phase 1-F  Verify + cleanup
```

---

## Phase 1-A — Code & Manifest Changes → CI Push (zero downtime)

Bundle all of the following into one PR and deploy to production before the maintenance window. Everything here is a rolling zero-downtime change. After this deploy, the codebase is ready for the maintenance window — the window only needs infrastructure commands.

### Step A-1: Fix `scripts/k8s/deploy-release.sh`

Three changes needed:

**1. Add PodDisruptionBudget to the prune allowlist.**

`pdb.yaml` objects carry `app.kubernetes.io/part-of: rejourney` so they're already applied by the main `kubectl apply -f "${RENDER_DIR}/"`. The prune allowlist entry just enables cleanup if you ever remove a PDB — without it, old PDBs linger forever. In the `kubectl apply --prune` block add:

```bash
--prune-allowlist=policy/v1/PodDisruptionBudget \
```

Do **not** add `pdb.yaml` to `apply_unlabeled_support_manifests()` — that function is only for resources that lack the `part-of=rejourney` label (exporters, ingress).

**2. Fix `wait_for_postgres` for CNPG pod labels** (required for Phase 1-E onwards — safe to add now):

```bash
wait_for_postgres() {
  section "Waiting For PostgreSQL"
  local label="app=postgres"
  if kubectl get cluster postgres -n "${NAMESPACE}" >/dev/null 2>&1; then
    label="cnpg.io/cluster=postgres,cnpg.io/instanceRole=primary"
  fi
  if ! kubectl wait --for=condition=ready pod -l "${label}" -n "${NAMESPACE}" --timeout=180s; then
    kubectl describe pod -l "${label}" -n "${NAMESPACE}" || true
    echo "[deploy-release] PostgreSQL did not become ready" >&2
    exit 1
  fi
}
```

**3. Fix `print_migration_status` for CNPG pod naming.**

After CNPG cutover, `postgres-0` is scaled to 0 and CNPG pods are named `postgres-1`, `postgres-2`, etc. The current `kubectl exec postgres-0` silently fails. Update it:

```bash
print_migration_status() {
  local phase="$1"
  section "Migration Status (${phase})"

  # Determine the correct postgres exec target
  local pg_pod
  if kubectl get cluster postgres -n "${NAMESPACE}" >/dev/null 2>&1; then
    # CNPG: primary pod has instanceRole=primary label
    pg_pod=$(kubectl get pod -n "${NAMESPACE}" \
      -l "cnpg.io/cluster=postgres,cnpg.io/instanceRole=primary" \
      -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  else
    pg_pod="postgres-0"
  fi

  if [ -n "${pg_pod}" ]; then
    kubectl exec -n "${NAMESPACE}" "${pg_pod}" -- \
      psql -U rejourney -d rejourney -At -F $'\t' \
        -c "select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 10;" \
      || log "Could not query drizzle.__drizzle_migrations yet"
  else
    log "No postgres pod found yet"
  fi
}
```

### Step A-2: Add Sentinel support to `backend/src/config.ts`

Add these optional fields. The app falls back to URL mode when `REDIS_SENTINEL_HOST` is empty — no behavior change until the sentinel is live.

```typescript
REDIS_SENTINEL_HOST: z.string().optional(),
REDIS_SENTINEL_PORT: z.coerce.number().optional().default(26379),
REDIS_MASTER_NAME: z.string().optional().default('mymaster'),
REDIS_PASSWORD: z.string().optional(),
```

### Step A-3: Update `backend/src/db/redis.ts`

Change the constructor to be Sentinel-aware:

```typescript
redis = config.REDIS_SENTINEL_HOST
  ? new Redis({
      sentinels: [{ host: config.REDIS_SENTINEL_HOST, port: config.REDIS_SENTINEL_PORT! }],
      name: config.REDIS_MASTER_NAME,
      password: config.REDIS_PASSWORD,
      sentinelPassword: config.REDIS_PASSWORD,
      role: 'master',
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      lazyConnect: true,
    })
  : new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      lazyConnect: true,
    });
```

### Step A-4: Add Sentinel env vars to `k8s/api.yaml` and `k8s/workers.yaml`

For every Deployment and CronJob that currently mounts `REDIS_URL`, add these alongside it. Set `REDIS_SENTINEL_HOST` to **empty string** for now — this keeps URL fallback mode active until you push the second commit during the maintenance window.

```yaml
- name: REDIS_SENTINEL_HOST
  value: ""        # will be set to "redis.rejourney.svc.cluster.local" in the window
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: redis-secret
      key: REDIS_PASSWORD
```

### Step A-5: Fix update strategies for monitoring deployments

`k8s/victoria-metrics.yaml`, `k8s/grafana.yaml`, `k8s/gatus.yaml` all have local-path RWO PVCs. Without `Recreate`, a rolling update hangs forever when the old pod holds the PVC.

Add to each:
```yaml
spec:
  strategy:
    type: Recreate
```

### Step A-6: Add `startingDeadlineSeconds` to all CronJobs

After 100 missed schedule slots, Kubernetes stops scheduling the CronJob entirely.

In `k8s/workers.yaml` (retention-worker, stripe-sync-worker) and `k8s/backup.yaml` (postgres-backup):
```yaml
spec:
  startingDeadlineSeconds: 300
```

### Step A-7: Pin PgBouncer image

`k8s/pgbouncer.yaml`:
```yaml
image: edoburu/pgbouncer:1.23.1   # was :latest
```

### Step A-8: Scale Web to 2 replicas

`k8s/web.yaml`:
```yaml
spec:
  replicas: 2
```

### Step A-9: Add `k8s/pdb.yaml` (new file)

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
  namespace: rejourney
  labels:
    app.kubernetes.io/part-of: rejourney
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: api
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ingest-upload-pdb
  namespace: rejourney
  labels:
    app.kubernetes.io/part-of: rejourney
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: ingest-upload
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: replay-worker-pdb
  namespace: rejourney
  labels:
    app.kubernetes.io/part-of: rejourney
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: replay-worker
```

### Step A-10: Replace `k8s/redis.yaml` with Bitnami values file

Delete the old `k8s/redis.yaml` (Deployment). The Bitnami chart is installed via `helm install` — **not** via `kubectl apply`. Store the values file in a subdirectory so `deploy-release.sh`'s `kubectl apply -f "${RENDER_DIR}/"` (which is non-recursive) never touches it.

Create `k8s/helm/redis-values.yaml`:

```yaml
# k8s/helm/redis-values.yaml
# Usage: helm install redis bitnami/redis -n rejourney -f k8s/helm/redis-values.yaml
sentinel:
  enabled: true
  quorum: 1        # single-node for now; Part 2 raises to 2

replica:
  replicaCount: 0  # no replicas until Part 2

global:
  storageClass: hcloud-volumes

master:
  persistence:
    size: 2Gi
  configuration: |
    maxmemory 900mb
    maxmemory-policy allkeys-lru
    save 900 1
  resources:
    requests:
      cpu: 200m
      memory: 384Mi
    limits:
      cpu: "1"
      memory: 1280Mi

auth:
  existingSecret: redis-secret
  existingSecretPasswordKey: REDIS_PASSWORD

metrics:
  enabled: true           # deploys redis-exporter sidecar on port 9121
  serviceMonitor:
    enabled: false        # we use VictoriaMetrics static scrape, not prometheus-operator
```

> **Why `k8s/helm/` subdirectory:** `deploy-release.sh` runs `kubectl apply -f "${RENDER_DIR}/"` which only reads the top-level directory, not subdirectories. A Helm values file is not a k8s manifest — applying it would fail. The `helm/` subdirectory keeps it in the repo and in the deploy artifact without being mistakenly applied.

Also update `k8s/admin-tools.yaml` — redis-commander's `REDIS_HOSTS` needs to point to Bitnami's master service (not the sentinel service):
```yaml
- name: REDIS_HOSTS
  value: "local:redis-master:6379:0:$(REDIS_PASSWORD)"
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: redis-secret
      key: REDIS_PASSWORD
```

### Step A-11: Add `k8s/cnpg/postgres-cnpg.yaml` (new file — subdirectory)

Store in a subdirectory so `deploy-release.sh`'s non-recursive `kubectl apply -f "${RENDER_DIR}/"` never touches it before the CNPG CRD is installed. If placed in `k8s/` root, every CI deploy before Phase 1-D would fail with `"unknown resource: clusters.postgresql.cnpg.io"`.

Fill in your R2 bucket name before committing.

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: postgres
  namespace: rejourney
spec:
  instances: 1           # single instance; Part 2 raises to 2

  # Must match the existing Postgres major version — currently PostgreSQL 18.
  # Check https://cloudnative-pg.io/documentation/ to confirm your CNPG version
  # supports PG 18 before proceeding (CNPG 1.25 supports up to PG 17; use 1.26+ for PG 18).
  imageName: ghcr.io/cloudnative-pg/postgresql:18

  postgresql:
    parameters:
      max_connections: "60"
      shared_buffers: "1536MB"
      effective_cache_size: "4GB"
      work_mem: "16MB"
      maintenance_work_mem: "128MB"

  storage:
    storageClass: hcloud-volumes
    size: 60Gi    # DB is already 27.7 GB; 60 Gi gives reasonable headroom for growth

  bootstrap:
    initdb:
      import:
        type: monolith
        databases:
          - rejourney
        roles:
          - rejourney
        source:
          externalCluster: legacy-postgres

  externalClusters:
    - name: legacy-postgres
      connectionParameters:
        host: postgres.rejourney.svc.cluster.local   # old StatefulSet, still running during import
        user: postgres                                 # superuser — password set in Phase 1-D
        dbname: postgres
        sslmode: disable
      password:
        name: cnpg-import-secret                      # created in Phase 1-D
        key: password

  backup:
    barmanObjectStore:
      destinationPath: s3://<YOUR_R2_BUCKET>/cnpg-wal   # hardcode your bucket name (get from r2-backup-secret R2_BUCKET key)
      s3Credentials:
        accessKeyId:
          name: r2-backup-secret
          key: AWS_ACCESS_KEY_ID      # actual key name in the secret
        secretAccessKey:
          name: r2-backup-secret
          key: AWS_SECRET_ACCESS_KEY  # actual key name in the secret
      endpointURL:
        name: r2-backup-secret
        key: R2_ENDPOINT
      wal:
        compression: gzip
    retentionPolicy: "7d"
```

### Step A-12: Update `k8s/pgbouncer.yaml` for CNPG

Change `DB_HOST` from `postgres.rejourney.svc.cluster.local` to `postgres-rw.rejourney.svc.cluster.local`. Commit now. Apply during Phase 1-E cutover.

```yaml
- name: DB_HOST
  value: postgres-rw.rejourney.svc.cluster.local
```

### Step A-13: Update `k8s/backup.yaml` for CNPG

The backup CronJob uses `DATABASE_URL` (pointing to old StatefulSet) for `pg_dump`. After CNPG it must point to `postgres-rw`. Add a new secret key `DATABASE_URL_DIRECT` to `postgres-secret` that points to `postgres-rw`, or update the CronJob env directly:

```yaml
- name: DATABASE_URL
  value: postgresql://postgres:$(POSTGRES_SUPERUSER_PASSWORD)@postgres-rw.rejourney.svc.cluster.local:5432/rejourney
```

Or reference a new secret key. Either way: commit now, apply in Phase 1-E.

**Push Phase 1-A to CI and deploy to production before continuing.**

After this deploy: PgBouncer is pinned, monitoring can't deadlock on RWO PVCs, CronJobs have deadlines, web has 2 replicas, PDBs are active. The codebase is Sentinel-aware but still uses URL mode.

---

## Phase 1-B — Infrastructure Prep (zero downtime, before window)

### Step B-1: Create Hetzner private network

In Hetzner Cloud console: create private network (`10.0.0.0/16`, zone `eu-central`). Attach CPX42. Required for LB→node private-IP routing and future inter-node traffic.

### Step B-2: Create Hetzner API token + k8s secret

In Hetzner Cloud console: create a Read+Write API token.

```bash
kubectl create secret generic hcloud -n kube-system \
  --from-literal=token=<HCLOUD_API_TOKEN>
```

### Step B-3: Add Helm repos

```bash
helm repo add hcloud https://charts.hetzner.cloud
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
```

### Step B-4: Add Redis password to `redis-secret`

The current `redis-secret` has `REDIS_URL=redis://redis:6379/0` with no password. Add `REDIS_PASSWORD` only — **do NOT change `REDIS_URL` here**. Changing it to `redis-master` now would immediately crash all pods because `redis-master` won't exist until Bitnami is installed in Phase 1-C. `REDIS_URL` stays pointing at the old `redis` service until Step C-4.

```bash
REDIS_PASS=$(openssl rand -hex 24)
echo "Save this password somewhere safe: $REDIS_PASS"

kubectl patch secret redis-secret -n rejourney --type=json -p="[
  {\"op\":\"add\",\"path\":\"/data/REDIS_PASSWORD\",\"value\":\"$(echo -n "${REDIS_PASS}" | base64 | tr -d '\n')\"}
]"

# Verify — REDIS_URL must still read redis://redis:6379/0, not redis-master
kubectl get secret redis-secret -n rejourney \
  -o jsonpath='{.data.REDIS_PASSWORD}' | base64 -d && echo
kubectl get secret redis-secret -n rejourney \
  -o jsonpath='{.data.REDIS_URL}' | base64 -d && echo
```

⚠️ **`REDIS_URL` never needs to be changed to `redis-master`.** Once Step C-7 deploys, apps switch to Sentinel mode (`REDIS_SENTINEL_HOST` is set) and never touch `REDIS_URL` again. Apps currently use `REDIS_SENTINEL_HOST=""` so they fall back to `REDIS_URL` — if `REDIS_URL` pointed at a non-existent service like `redis-master`, every pod would crash immediately.

### Step B-5: Prepare the Traefik LB annotation changes in `k8s/traefik-config.yaml`

In `valuesContent:`, add the Hetzner LB service annotations and include your private network CIDR in the existing `trustedIPs` list alongside the Cloudflare ranges:

```yaml
service:
  annotations:
    load-balancer.hetzner.cloud/location: fsn1   # VPS is in fsn1-dc8 (Falkenstein)
    load-balancer.hetzner.cloud/use-private-ip: "true"
    load-balancer.hetzner.cloud/algorithm-type: round_robin
    load-balancer.hetzner.cloud/health-check-port: "9000"
```

Commit this too. It will be applied during the maintenance window.

---

## Phase 1-C — Maintenance Window (~10 min)

**Before starting:** Enable Cloudflare "Under Attack" mode. Have two terminal windows open — one for cluster commands, one ready to push a git commit.

**What's happening here:** k3s restarts with CCM/CSI flags, Bitnami Redis replaces the old Deployment, the LB is provisioned, and a second CI push switches apps to Sentinel mode. Postgres is untouched during this window — it migrates in Phase 1-D/1-E with zero data risk.

---

### Step C-1: Restart k3s with CCM + LB flags (~30s downtime)

SSH to CPX42. Edit `/etc/systemd/system/k3s.service`. Add to the `ExecStart` line:

```
--disable-cloud-controller \
--disable=servicelb \
--kubelet-arg=cloud-provider=external
```

```bash
systemctl daemon-reload && systemctl restart k3s

# Wait for node Ready
kubectl get nodes --watch
```

All pods restart during the ~30s k3s restart. This is the only hard downtime for this step.

### Step C-2: Install Hetzner CCM

```bash
helm install hccm hcloud/hcloud-cloud-controller-manager \
  -n kube-system \
  --set networking.enabled=true \
  --set networking.clusterCIDR=10.42.0.0/16

kubectl rollout status deployment/hcloud-cloud-controller-manager -n kube-system
```

### Step C-3: Install Hetzner CSI

```bash
helm install hcloud-csi hcloud/hcloud-csi -n kube-system

kubectl get storageclass hcloud-volumes
# Should appear within 30s
```

### Step C-4: Patch StorageClass to Retain

The CSI auto-creates `hcloud-volumes` with `reclaimPolicy: Delete`. Patch it so volumes survive PVC deletion:

```bash
kubectl patch storageclass hcloud-volumes \
  -p '{"reclaimPolicy":"Retain"}'

kubectl get storageclass hcloud-volumes \
  -o jsonpath='{.reclaimPolicy}'
# Expected: Retain
```

### Step C-5: Migrate Redis to Bitnami (~2-3 min Redis degradation)

Redis data is ephemeral (rate limits, idempotency keys, session caches). Losing it is safe.

```bash
# Delete old Deployment + PVC (Redis goes down here)
kubectl delete deployment redis -n rejourney --wait=true
kubectl delete pvc redis-pvc -n rejourney --wait=true
kubectl delete svc redis -n rejourney --wait=true   # Bitnami will recreate it

# Install Bitnami Redis using the values file from Phase 1-A Step A-10
helm install redis bitnami/redis -n rejourney -f k8s/helm/redis-values.yaml

# Watch pod come up (image pull + startup ~90s)
kubectl rollout status statefulset/redis-master -n rejourney --timeout=180s

# Verify Sentinel is running
REDIS_PASS=$(kubectl get secret redis-secret -n rejourney \
  -o jsonpath='{.data.REDIS_PASSWORD}' | base64 -d)
kubectl exec -n rejourney redis-master-0 -- \
  redis-cli -a "$REDIS_PASS" --no-auth-warning PING
# Expected: PONG
```

**Update Gatus Redis TCP check** — the `redis` service is now the Sentinel port (26379), not the data port. The data port lives on `redis-master:6379`. Edit `k8s/gatus.yaml`:

```yaml
# Change:
#   tcp://redis.rejourney.svc.cluster.local:6379
# To:
- name: redis-master
  url: "tcp://redis-master.rejourney.svc.cluster.local:6379"
```

Apply:
```bash
kubectl apply -f k8s/gatus.yaml
kubectl rollout restart deployment/gatus -n rejourney
```

### Step C-6: Apply LB annotations (while Redis is starting)

No downtime — do this in parallel while waiting for Bitnami pods.

```bash
kubectl apply -f k8s/traefik-config.yaml

# Poll for LB IP (CCM provisions it in ~60s)
until LB_IP=$(kubectl get svc traefik -n kube-system \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null) && [ -n "$LB_IP" ]; do
  sleep 5
done
echo "LB IP: $LB_IP"
```

### Step C-7: Push second CI commit — switch apps to Sentinel

From your laptop, update `k8s/api.yaml` and `k8s/workers.yaml` — set `REDIS_SENTINEL_HOST` to the Bitnami sentinel service:

```yaml
- name: REDIS_SENTINEL_HOST
  value: "redis.rejourney.svc.cluster.local"   # was: ""
```

Push to main. CI will build and deploy (~4-5 min). While CI runs, proceed with Step C-8.

After CI deploys, all app pods rolling-restart and connect via Sentinel protocol instead of URL. Total Redis degradation time: from Step C-5 deletion to the rolling restart completing in CI (~8-10 min).

### Step C-8: Update Cloudflare DNS

Update A records for `rejourney.co`, `api.rejourney.co`, `ingest.rejourney.co` → the LB IP from Step C-6. With Cloudflare proxy, propagation is instant.

```bash
# Verify traffic via LB (once DNS propagates)
curl -I https://rejourney.co
curl -I https://api.rejourney.co/health
```

### Step C-9: Disable Cloudflare "Under Attack" mode

### Step C-10: Verify CI deploy from Step C-7 completed

```bash
kubectl rollout status deployment/api -n rejourney
kubectl rollout status deployment/ingest-upload -n rejourney

# Verify Sentinel mode is active
kubectl logs deployment/api -n rejourney | grep -i "sentinel\|redis" | tail -5
```

---

## Phase 1-D — CNPG Import (zero downtime, schedule after window)

This runs while the app is fully live. The old Postgres StatefulSet keeps serving traffic throughout. CNPG imports a logical copy in the background — no locks, no downtime. Run this within a day of the maintenance window.

> **Post-execution note (2026-04-21):** The CNPG **monolith logical import path documented in D-1..D-5 below did not work** against our legacy cluster and was abandoned mid-execution. Root cause: the legacy Bitnami-initialized Postgres created the `rejourney` role as the bootstrap superuser (`oid=10`). CNPG's source-role replication query filters with `WHERE oid >= 16384`, silently excluding bootstrap superusers — so every `ALTER ... OWNER TO rejourney` during `pg_restore` failed with `role "rejourney" does not exist`. This cannot be worked around inside the monolith spec.
>
> **What was actually done:** switched `k8s/cnpg/postgres-cnpg.yaml` to a plain `bootstrap.initdb` (no `import`, no `externalClusters`), then migrated data manually by streaming `pg_dump --no-owner --no-acl --format=custom` from the legacy StatefulSet directly into `pg_restore --no-owner --no-acl` on the CNPG primary (no temp file — the CNPG pod's `/tmp` is read-only; logs went to `/var/lib/postgresql/data/pgdata/*.log`). Result: 40/40 tables, row counts match (modulo expected drift on `sessions` from live writes).
>
> **Also learned the hard way:** the `hcloud-volumes` StorageClass uses `reclaimPolicy: Retain`, so every `kubectl delete cluster/pvc` during import-spec iteration leaked a paid Hetzner volume. We ended up cleaning up 3 orphan volumes via the Hetzner API. Future CNPG/PVC iteration: fix the manifest in place, or delete orphan Hetzner volumes in the same operation. (Captured in memory: `feedback_hetzner_volumes.md`.)
>
> D-1..D-5 are left below as historical reference. If redoing from scratch, skip straight to the manual path (plain initdb + streamed `pg_dump | pg_restore --no-owner --no-acl`). D-6 and D-7 are accurate as executed.

### Step D-1: Set postgres superuser password

CNPG's `monolith` import connects as `user: postgres` (superuser). This user has no network password by default (peer-auth only). Set one:

```bash
CNPG_SU_PASS=$(openssl rand -hex 24)
echo "Save this: $CNPG_SU_PASS"

kubectl exec -n rejourney postgres-0 -- \
  psql -U rejourney -c "ALTER USER postgres PASSWORD '${CNPG_SU_PASS}';"
```

### Step D-2: Create import secret

```bash
kubectl create secret generic cnpg-import-secret -n rejourney \
  --from-literal=password="${CNPG_SU_PASS}"
```

### Step D-3: Install CNPG operator

```bash
# Your Postgres is version 18.1. CNPG 1.25.x only supports up to PG 17.
# Use CNPG 1.26.0 or later for PG 18 support.
# Check the latest release at: https://github.com/cloudnative-pg/cloudnative-pg/releases
VERSION=1.26.0   # verify this is the latest stable that supports PG 18

kubectl apply --server-side \
  -f https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/v${VERSION}/releases/cnpg-${VERSION}.yaml

kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/name=cloudnative-pg \
  -n cnpg-system --timeout=120s
```

### Step D-4: Apply CNPG cluster (starts background import)

Fill in `<YOUR_R2_BUCKET>` in `k8s/cnpg/postgres-cnpg.yaml` if you haven't already. Then:

```bash
# Apply directly — NOT via deploy-release.sh (subdirectory is intentionally skipped by CI)
kubectl apply -f k8s/cnpg/postgres-cnpg.yaml
```

CNPG connects to the running old Postgres StatefulSet and begins a logical import. Apps continue using PgBouncer → old StatefulSet throughout.

### Step D-5: Monitor import

```bash
# Install the kubectl-cnpg plugin if not present:
# kubectl krew install cnpg

kubectl cnpg status postgres -n rejourney

# Watch until you see: "Primary instance is healthy" + "1 streaming replica" (actually no replica yet — just primary healthy)
# This takes 10-30 min depending on DB size
```

Repeat until status shows the primary is healthy and the import is complete. The cluster is ready for cutover.

### Step D-6: Update VictoriaMetrics scrape config to add Redis + CNPG metrics

The existing `k8s/victoria-metrics.yaml` uses static scrape config. Add two new scrape jobs — Redis exporter (Bitnami sidecar on port 9121) and CNPG instance metrics (port 9187 on CNPG pods).

In the `scrape_configs:` section of the VictoriaMetrics ConfigMap, add:

```yaml
- job_name: redis
  static_configs:
    - targets:
        - redis-metrics.rejourney.svc.cluster.local:9121
  relabel_configs:
    - target_label: namespace
      replacement: rejourney

- job_name: cnpg
  kubernetes_sd_configs:
    - role: pod
      namespaces:
        names: [rejourney]
  relabel_configs:
    - source_labels: [__meta_kubernetes_pod_label_cnpg_io_cluster]
      action: keep
      regex: postgres
    - source_labels: [__meta_kubernetes_pod_name]
      target_label: pod
    - source_labels: [__meta_kubernetes_pod_label_cnpg_io_instanceRole]
      target_label: role
    - source_labels: [__meta_kubernetes_pod_ip]
      replacement: '$1:9187'
      target_label: __address__
```

Apply:
```bash
kubectl apply -f k8s/victoria-metrics.yaml
kubectl rollout restart deployment/victoria-metrics -n rejourney
```

> **Note for Part 2:** When you add the CNPG replica in Phase 2-B, the `cnpg` scrape job above automatically picks up all pods matching `cnpg.io/cluster=postgres` — no scrape config changes needed.

### Step D-7: Add infra dashboard to `k8s/grafana-s3-dashboard.yaml`

**Architecture note:** Grafana does **not** use a sidecar here. Dashboards are loaded via explicit ConfigMap volume mounts in `k8s/grafana.yaml`. The `grafana-dashboard-s3` ConfigMap is mounted at `/var/lib/grafana/dashboards/rejourney` (the directory the dashboard provider watches). Adding a second JSON key to that same ConfigMap creates a second `.json` file in that directory — Grafana picks it up within 30s automatically, no Deployment restart needed.

Add a second key `infra-dashboard.json` to `k8s/grafana-s3-dashboard.yaml`:

```yaml
# In k8s/grafana-s3-dashboard.yaml, add under data: alongside rejourney-s3.json:
data:
  rejourney-s3.json: |
    # ... existing content unchanged ...
  infra-dashboard.json: |
    {
      "title": "Infrastructure — Volumes · CNPG · Redis",
      "uid": "rejourney-infra",
      "refresh": "30s",
      "schemaVersion": 38,
      "tags": ["infra", "cnpg", "redis", "volumes"],
      "panels": [
        {
          "type": "row", "title": "Hetzner Volumes", "id": 1, "gridPos": {"h":1,"w":24,"x":0,"y":0}, "collapsed": false
        },
        {
          "type": "bargauge",
          "title": "PVC Usage %",
          "id": 2,
          "gridPos": {"h":8,"w":12,"x":0,"y":1},
          "options": {"reduceOptions":{"calcs":["lastNotNull"]},"orientation":"horizontal","displayMode":"gradient"},
          "fieldConfig": {
            "defaults": {
              "unit": "percentunit",
              "min": 0, "max": 1,
              "thresholds": {"mode":"absolute","steps":[{"color":"green","value":null},{"color":"yellow","value":0.7},{"color":"red","value":0.9}]}
            }
          },
          "targets": [{
            "expr": "1 - (kubelet_volume_stats_available_bytes{namespace=\"rejourney\"} / kubelet_volume_stats_capacity_bytes{namespace=\"rejourney\"})",
            "legendFormat": "{{persistentvolumeclaim}}"
          }]
        },
        {
          "type": "timeseries",
          "title": "Volume Used (bytes)",
          "id": 3,
          "gridPos": {"h":8,"w":12,"x":12,"y":1},
          "fieldConfig": {"defaults":{"unit":"bytes"}},
          "targets": [{
            "expr": "kubelet_volume_stats_used_bytes{namespace=\"rejourney\"}",
            "legendFormat": "{{persistentvolumeclaim}}"
          }]
        },
        {
          "type": "row", "title": "Redis Sentinel", "id": 10, "gridPos": {"h":1,"w":24,"x":0,"y":9}, "collapsed": false
        },
        {
          "type": "stat",
          "title": "Redis Role",
          "id": 11,
          "gridPos": {"h":4,"w":4,"x":0,"y":10},
          "options": {"reduceOptions":{"calcs":["lastNotNull"]},"textMode":"value"},
          "fieldConfig": {
            "defaults": {
              "mappings": [{"type":"value","options":{"0":{"text":"replica","color":"blue"},"1":{"text":"master","color":"green"}}}]
            }
          },
          "targets": [{"expr": "redis_master_repl_offset > bool 0", "legendFormat": "role"}]
        },
        {
          "type": "gauge",
          "title": "Memory Used %",
          "id": 12,
          "gridPos": {"h":4,"w":4,"x":4,"y":10},
          "fieldConfig": {"defaults":{"unit":"percentunit","min":0,"max":1,"thresholds":{"mode":"absolute","steps":[{"color":"green","value":null},{"color":"yellow","value":0.7},{"color":"red","value":0.85}]}}},
          "targets": [{"expr": "redis_memory_used_bytes / redis_memory_max_bytes", "legendFormat": "memory"}]
        },
        {
          "type": "stat",
          "title": "Connected Clients",
          "id": 13,
          "gridPos": {"h":4,"w":4,"x":8,"y":10},
          "fieldConfig": {"defaults":{"unit":"short"}},
          "targets": [{"expr": "redis_connected_clients", "legendFormat": "clients"}]
        },
        {
          "type": "stat",
          "title": "Sentinel Masters OK",
          "id": 14,
          "gridPos": {"h":4,"w":4,"x":12,"y":10},
          "fieldConfig": {
            "defaults": {
              "mappings": [{"type":"value","options":{"1":{"text":"OK","color":"green"},"0":{"text":"FAULT","color":"red"}}}]
            }
          },
          "targets": [{"expr": "redis_sentinel_master_ok_sentinels > bool 0", "legendFormat": "sentinel"}]
        },
        {
          "type": "timeseries",
          "title": "Commands / sec",
          "id": 15,
          "gridPos": {"h":4,"w":8,"x":16,"y":10},
          "fieldConfig": {"defaults":{"unit":"ops"}},
          "targets": [{"expr": "rate(redis_commands_processed_total[2m])", "legendFormat": "ops/s"}]
        },
        {
          "type": "timeseries",
          "title": "Replication Offset",
          "id": 16,
          "gridPos": {"h":4,"w":12,"x":0,"y":14},
          "fieldConfig": {"defaults":{"unit":"short"}},
          "targets": [{"expr": "redis_master_repl_offset", "legendFormat": "master offset"}]
        },
        {
          "type": "timeseries",
          "title": "Memory Used (bytes)",
          "id": 17,
          "gridPos": {"h":4,"w":12,"x":12,"y":14},
          "fieldConfig": {"defaults":{"unit":"bytes"}},
          "targets": [
            {"expr": "redis_memory_used_bytes", "legendFormat": "used"},
            {"expr": "redis_memory_max_bytes", "legendFormat": "limit"}
          ]
        },
        {
          "type": "row", "title": "CloudNativePG", "id": 20, "gridPos": {"h":1,"w":24,"x":0,"y":18}, "collapsed": false
        },
        {
          "type": "stat",
          "title": "CNPG Collector Up",
          "id": 21,
          "gridPos": {"h":4,"w":4,"x":0,"y":19},
          "fieldConfig": {
            "defaults": {
              "mappings": [{"type":"value","options":{"1":{"text":"UP","color":"green"},"0":{"text":"DOWN","color":"red"}}}]
            }
          },
          "targets": [{"expr": "cnpg_collector_up{namespace=\"rejourney\"}", "legendFormat": "{{pod}}"}]
        },
        {
          "type": "stat",
          "title": "Instance Role",
          "id": 22,
          "gridPos": {"h":4,"w":4,"x":4,"y":19},
          "fieldConfig": {"defaults":{}},
          "targets": [{"expr": "cnpg_pg_replication_in_recovery{namespace=\"rejourney\"}", "legendFormat": "{{pod}} (1=replica,0=primary)"}]
        },
        {
          "type": "timeseries",
          "title": "Replication Lag (s)",
          "id": 23,
          "gridPos": {"h":4,"w":8,"x":8,"y":19},
          "fieldConfig": {"defaults":{"unit":"s"}},
          "targets": [{"expr": "cnpg_pg_replication_lag{namespace=\"rejourney\"}", "legendFormat": "{{pod}}"}]
        },
        {
          "type": "timeseries",
          "title": "Active Connections by State",
          "id": 24,
          "gridPos": {"h":4,"w":8,"x":16,"y":19},
          "fieldConfig": {"defaults":{"unit":"short"}},
          "targets": [{"expr": "cnpg_pg_stat_activity_count{namespace=\"rejourney\"}", "legendFormat": "{{state}}"}]
        },
        {
          "type": "timeseries",
          "title": "Transactions / sec",
          "id": 25,
          "gridPos": {"h":4,"w":12,"x":0,"y":23},
          "fieldConfig": {"defaults":{"unit":"ops"}},
          "targets": [
            {"expr": "rate(cnpg_pg_stat_database_xact_commit_total{datname=\"rejourney\",namespace=\"rejourney\"}[2m])", "legendFormat": "commit/s"},
            {"expr": "rate(cnpg_pg_stat_database_xact_rollback_total{datname=\"rejourney\",namespace=\"rejourney\"}[2m])", "legendFormat": "rollback/s"}
          ]
        },
        {
          "type": "timeseries",
          "title": "WAL Files Count",
          "id": 26,
          "gridPos": {"h":4,"w":12,"x":12,"y":23},
          "fieldConfig": {"defaults":{"unit":"short"}},
          "targets": [{"expr": "cnpg_pg_wal_count{namespace=\"rejourney\"}", "legendFormat": "WAL files"}]
        }
      ],
      "time": {"from":"now-3h","to":"now"},
      "timepicker": {}
    }
```

Apply:
```bash
kubectl apply -f k8s/grafana-s3-dashboard.yaml
# Grafana's dashboard provider polls /var/lib/grafana/dashboards/rejourney every 30s.
# No restart needed — the new file appears in the already-mounted volume automatically.
```

> **Kubelet metrics prerequisite:** `kubelet_volume_stats_*` metrics are emitted by the kubelet. The current VictoriaMetrics scrape config **does not** have a kubelet job — add it to `k8s/victoria-metrics.yaml` alongside the other static scrape jobs from Step D-6:
> ```yaml
> - job_name: kubelet
>   scheme: https
>   tls_config:
>     insecure_skip_verify: true
>   bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
>   kubernetes_sd_configs:
>     - role: node
>   relabel_configs:
>     - replacement: kubernetes.default.svc:443
>       target_label: __address__
>     - source_labels: [__meta_kubernetes_node_name]
>       replacement: /api/v1/nodes/$1/proxy/metrics
>       target_label: __metrics_path__
> ```

---

## Phase 1-E — CNPG Cutover (~5 min downtime)

Schedule this as a separate small window.

> **Post-execution note (2026-04-22):** The doc previously claimed "~30s downtime via PgBouncer restart." That only applies when CNPG has been catching up via logical replication. Because we took the manual-migration path in D, the CNPG snapshot was ~1h behind legacy by cutover time (416 sessions + 5,508 artifacts drift). A naive PgBouncer flip would have stranded those rows.
>
> **What was actually done:**
> 1. `kubectl scale deploy/{api,ingest-upload,ingest-worker,alert-worker,replay-worker,session-lifecycle-worker,web} --replicas=0` — pause all writers, wait 45s for in-flight drain, confirm `pg_stat_activity` has no app backends.
> 2. On CNPG: `pg_terminate_backend` any stray connections, `DROP DATABASE rejourney`, `CREATE DATABASE rejourney OWNER rejourney`.
> 3. Re-run streamed `pg_dump -Fc --no-owner --no-acl` from legacy piped into `pg_restore --no-owner --no-acl -U postgres -d rejourney` on CNPG (~11 min for 27 GB).
> 4. Reassign ownership of **both** `public` and `drizzle` schemas + all tables/sequences/views/matviews to `rejourney` (pg_restore `--no-owner` leaves everything as `postgres`-owned, which breaks both app auth and the `postgres-backup` CronJob).
> 5. Manually `CREATE ROLE monitoring LOGIN PASSWORD '...'` + `GRANT pg_monitor, CONNECT, USAGE ON SCHEMA public, SELECT ON ALL TABLES IN SCHEMA public` (pg_dump of a single DB does **not** include global roles — they must be recreated).
> 6. Apply updated `k8s/pgbouncer.yaml` (`DB_HOST=postgres-rw`) + rolling restart.
> 7. Smoke-test read via pgbouncer, confirm `inet_server_addr()` = CNPG pod IP.
> 8. Scale writers back up to original replica counts (api/ingest-upload/replay-worker/web=2, others=1).
> 9. Patch `postgres-exporter-secret` + `postgres-secret` DATABASE_URL in-place to `@postgres-rw:5432`.
> 10. Apply updated `k8s/gatus.yaml` + `k8s/admin-tools.yaml`; rollout-restart gatus/postgres-exporter/pgweb.
> 11. Test `postgres-backup` CronJob manually: `kubectl create job --from=cronjob/postgres-backup cutover-test -n rejourney`. Verify 2.5 GiB file uploaded to R2, retention rotation ran. Delete any empty/partial file from the first failed attempt.
>
> **Gotchas captured:**
> - `--no-owner` restore + `CREATE DATABASE ... OWNER rejourney` is not enough — schema and object ownership stays `postgres` and the app sees permission-denied. Always run the ownership-reassign DO block for both `public` and `drizzle` schemas after a plain `pg_restore --no-owner`.
> - `pg_dump` of a single database skips global roles. Any non-default role (`monitoring`, future replication roles, etc.) must be recreated by hand on the target before cutover.
> - Do **not** scale the legacy StatefulSet to 0 immediately after cutover — leave it running idle for ~1 week as warm rollback insurance.

### Step E-1: Verify CNPG primary is healthy

```bash
kubectl cnpg status postgres -n rejourney
# Must show: Primary instance ready, no errors
```

### Step E-2: Cutover PgBouncer

```bash
# Apply updated pgbouncer.yaml (DB_HOST=postgres-rw, from Phase 1-A Step A-12)
kubectl apply -f k8s/pgbouncer.yaml
kubectl rollout restart deployment/pgbouncer -n rejourney
kubectl rollout status deployment/pgbouncer -n rejourney --timeout=60s
```

~30s of connection errors during PgBouncer restart. With `maxUnavailable=0` on API, existing pods queue connections until the new PgBouncer pod is ready.

### Step E-3: Verify writes flow through CNPG

```bash
kubectl exec -n rejourney deployment/pgbouncer -- \
  psql "${PGBOUNCER_URL}" -c 'SELECT COUNT(*) FROM sessions;'

# Verify CNPG primary received the write
kubectl cnpg psql postgres -n rejourney -- \
  -c 'SELECT COUNT(*) FROM sessions;'
```

### Step E-4: Scale down legacy Postgres StatefulSet

```bash
kubectl scale statefulset postgres -n rejourney --replicas=0
# CNPG is now the sole Postgres owner
```

The old local-path PVC (`postgres-data-postgres-0`) is now orphaned. Leave it for a week as insurance, then delete:
```bash
# After 1 week of confirmed stability:
kubectl delete pvc postgres-data-postgres-0 -n rejourney
```

### Step E-5: Update monitoring + admin tools for CNPG

**Gatus postgres check** — the old `postgres.rejourney.svc.cluster.local:5432` StatefulSet service is now scaled to 0. Update `k8s/gatus.yaml` to the CNPG read-write service:

```yaml
# Change:
#   tcp://postgres.rejourney.svc.cluster.local:5432
# To:
- name: postgres-rw
  url: "tcp://postgres-rw.rejourney.svc.cluster.local:5432"
```

**postgres-exporter** — the current DSN uses the `monitoring` user. Update the host from `postgres` to `postgres-rw` while preserving that username:

```bash
# Current DSN is: postgresql://monitoring:<pass>@postgres:5432/rejourney
# Just swap the host — keep the monitoring user and password unchanged
OLD_DSN=$(kubectl get secret postgres-exporter-secret -n rejourney \
  -o jsonpath='{.data.DATA_SOURCE_NAME}' | base64 -d)
NEW_DSN="${OLD_DSN//@postgres:5432/@postgres-rw:5432}"
kubectl patch secret postgres-exporter-secret -n rejourney \
  --type=json \
  -p="[{\"op\":\"replace\",\"path\":\"/data/DATA_SOURCE_NAME\",\"value\":\"$(echo -n "${NEW_DSN}" | base64 | tr -d '\n')\"}]"
echo "Updated DSN: ${NEW_DSN}"
```

**postgres-secret DATABASE_URL** — the postgres-backup CronJob reads `DATABASE_URL` from `postgres-secret`. Update the host in-place so the CronJob automatically uses the new value (no CronJob manifest change needed):

```bash
OLD_DB_URL=$(kubectl get secret postgres-secret -n rejourney \
  -o jsonpath='{.data.DATABASE_URL}' | base64 -d)
NEW_DB_URL="${OLD_DB_URL//@postgres:5432/@postgres-rw:5432}"
kubectl patch secret postgres-secret -n rejourney \
  --type=json \
  -p="[{\"op\":\"replace\",\"path\":\"/data/DATABASE_URL\",\"value\":\"$(echo -n "${NEW_DB_URL}" | base64 | tr -d '\n')\"}]"
echo "Updated DATABASE_URL: ${NEW_DB_URL}"
```

**pgweb** in `k8s/admin-tools.yaml` — update the postgres connection host:

```yaml
# Change the pgweb DATABASE_URL from:
#   postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@postgres:5432/...
# To:
- name: DATABASE_URL
  value: "postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@postgres-rw:5432/$(POSTGRES_DB)?sslmode=disable"
```

Apply all three:
```bash
kubectl apply -f k8s/gatus.yaml
kubectl apply -f k8s/admin-tools.yaml
kubectl rollout restart deployment/gatus -n rejourney
kubectl rollout restart deployment/postgres-exporter -n rejourney
kubectl rollout restart deployment/pgweb -n rejourney
```

### Step E-6: Test backup

The `postgres-backup` CronJob reads `DATABASE_URL` from `postgres-secret`, which was already updated to `postgres-rw` in Step E-5 above. No manifest change is needed — run a test backup to confirm:

```bash
kubectl create job --from=cronjob/postgres-backup post-cnpg-test -n rejourney
kubectl wait --for=condition=complete job/post-cnpg-test -n rejourney --timeout=900s
kubectl logs job/post-cnpg-test -n rejourney
kubectl delete job post-cnpg-test -n rejourney
```

> You can also remove the now-superseded Step A-13 changes from `k8s/backup.yaml` — they're no longer needed since we patched the secret directly.

---

## Phase 1-F — Verify + Cleanup

```bash
# Node is Ready
kubectl get nodes -o wide

# Hetzner LB is external IP
kubectl get svc traefik -n kube-system

# Redis: Bitnami master is healthy
REDIS_PASS=$(kubectl get secret redis-secret -n rejourney \
  -o jsonpath='{.data.REDIS_PASSWORD}' | base64 -d)
kubectl exec -n rejourney redis-master-0 -- \
  redis-cli -a "$REDIS_PASS" --no-auth-warning INFO replication
# Expected: role:master

# Postgres: CNPG primary healthy
kubectl cnpg status postgres -n rejourney

# PVCs: CNPG and Redis on hcloud-volumes
kubectl get pvc -n rejourney

# App traffic via LB
curl -I https://rejourney.co
curl -I https://api.rejourney.co/health

# All pods running
kubectl get pods -n rejourney -o wide
```

---

## After Part 1 — State

| Component | State |
|---|---|
| PostgreSQL | CNPG single instance on Hetzner Volume. WAL archiving to R2. ~1-2 min recovery if pod fails (no failover yet). |
| Redis | Bitnami single master, Sentinel protocol active on port 26379. App connects via Sentinel. ~1-2 min recovery if pod fails (no failover yet). |
| Storage | All critical PVCs on Hetzner Volumes — survive node replacement. |
| Traffic | Hetzner LB → Traefik. Node IP is no longer a SPOF. |
| Monitoring | VM + Grafana + Gatus can update without RWO deadlock. |
| Maintenance | PDBs ensure ≥1 API pod survives drain. |

**Not yet fixed:** No automated failover for either Postgres or Redis (added in Part 2 with worker nodes).

---

---

# PART 2 — Scale to Full HA

**Goal:** Add 2 worker nodes. Because CNPG and Bitnami Sentinel are already deployed, scaling to HA is just changing instance/replica counts.

**Total planned downtime: ~0 min.** All changes are rolling or handled by CNPG/Sentinel automatically.

```
Phase 2-A  Add worker nodes (zero downtime)
Phase 2-B  Scale PostgreSQL to 2 instances (zero downtime)
Phase 2-C  Scale Redis to HA Sentinel (zero downtime)
Phase 2-D  Anti-affinity + final tuning (zero downtime)
```

---

## Phase 2-A — Add Worker Nodes (zero downtime)

### Step A-1: Create additional Hetzner Volumes

In Hetzner Cloud console (same datacenter as CPX42):

| Volume | Size | For |
|---|---|---|
| `postgres-replica` | 40 Gi | CNPG streaming replica storage on worker-1 |
| `redis-replica-0` | 2 Gi | Bitnami Redis replica pod |
| `redis-replica-1` | 2 Gi | Bitnami Redis replica pod |

### Step A-2: Launch 2 CPX31 worker nodes

In Hetzner Cloud console: 2 × CPX31 (2 vCPU, 8 GB RAM, ~€7.55/mo each), same datacenter, same private network.

### Step A-3: Join workers to k3s

Run on each new node:

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="agent \
  --server https://<CPX42-PRIVATE-IP>:6443 \
  --token <K3S_NODE_TOKEN> \
  --kubelet-arg=cloud-provider=external \
  --node-label=rejourney.co/role=worker" sh -
```

```bash
# Verify from CPX42
kubectl get nodes -o wide
# Expected: 3 nodes all Ready
```

The Hetzner LB automatically starts routing to all 3 nodes via CCM.

---

## Phase 2-B — Scale PostgreSQL to 2 Instances (zero downtime)

CNPG handles streaming replication setup automatically. Just update the instance count.

### Step B-1: Update `k8s/cnpg/postgres-cnpg.yaml`

Change `instances: 1` to `instances: 2` and add anti-affinity so primary and replica land on different nodes:

```yaml
spec:
  instances: 2

  affinity:
    podAntiAffinityType: required
    topologyKey: kubernetes.io/hostname
```

### Step B-2: Apply and monitor

```bash
kubectl apply -f k8s/cnpg/postgres-cnpg.yaml

# Watch CNPG provision the replica
kubectl cnpg status postgres -n rejourney --watch

# Done when you see: 1 primary + 1 streaming replica
```

CNPG provisions a new pod on a different node, streams WAL from the primary, and manages automatic failover if the primary goes down. No app changes needed — `postgres-rw` always points to the current primary.

---

## Phase 2-C — Scale Redis to HA Sentinel (zero downtime)

Bitnami handles replication and Sentinel quorum automatically. Just add replicas and raise the quorum.

### Step C-1: Update `k8s/helm/redis-values.yaml`

```yaml
sentinel:
  enabled: true
  quorum: 2          # was: 1 — requires 2 of 3 sentinels to agree on failover

replica:
  replicaCount: 2    # was: 0 — adds 2 replica pods
```

### Step C-2: Helm upgrade

```bash
helm upgrade redis bitnami/redis -n rejourney -f k8s/helm/redis-values.yaml

# Watch pods come up (rolling, no downtime)
kubectl rollout status statefulset/redis-replicas -n rejourney --timeout=180s
```

### Step C-3: Verify replication

```bash
REDIS_PASS=$(kubectl get secret redis-secret -n rejourney \
  -o jsonpath='{.data.REDIS_PASSWORD}' | base64 -d)

kubectl exec -n rejourney redis-master-0 -- \
  redis-cli -a "$REDIS_PASS" --no-auth-warning INFO replication
# Expected: role:master, connected_slaves:2
```

Sentinel quorum is now 2 — losing any 1 of 3 sentinel/pods is tolerated. Failover time: ~30s.

---

## Phase 2-D — Anti-affinity + Final Tuning (zero downtime, rolling)

### Step D-1: Add anti-affinity to API and ingest-upload

`k8s/api.yaml` and `k8s/workers.yaml` (ingest-upload section):

```yaml
spec:
  template:
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchLabels:
                  app: api     # (or app: ingest-upload)
              topologyKey: kubernetes.io/hostname
```

### Step D-2: Remove `storage-node` nodeSelector from any remaining workloads

The `rejourney.co/storage-node: "true"` nodeSelector was used to pin local-path storage to CPX42. Hetzner Volumes attach to whichever node the pod schedules on — the pin is no longer needed. Remove it from any manifest that still has it.

Push via CI.

---

## After Part 2 — Final State

| Component | State |
|---|---|
| PostgreSQL | 2-instance CNPG: primary + replica on different nodes. Automatic failover in ~30s via CNPG operator. WAL archiving to R2. |
| Redis | 3-pod Bitnami Sentinel across all 3 nodes (1 master + 2 replicas). Quorum failover in ~30s. |
| Traefik | Hetzner LB routes to all 3 nodes. Losing any 1 node keeps traffic flowing. |
| API (2 replicas) | Anti-affinity spreads across nodes. PDB ensures ≥1 up during drain. |
| Ingest-upload (2 replicas) | Same. |
| All critical PVCs | Hetzner Volumes — survive node replacement, auto-reattach. |
| Control plane | Still single server (CPX42). See Future Scaling for HA control plane. |

---

## Verification Checklist

```bash
# After Part 1
kubectl get nodes -o wide                                  # CPX42 Ready
kubectl get svc traefik -n kube-system                     # EXTERNAL-IP = Hetzner LB IP
kubectl cnpg status postgres -n rejourney                  # Primary healthy
kubectl exec -n rejourney redis-master-0 -- \
  redis-cli -a $REDIS_PASS --no-auth-warning ping          # PONG
kubectl get pods -n rejourney -o wide                      # all Running
curl -I https://rejourney.co                               # 200 OK via LB
curl -I https://api.rejourney.co/health                    # 200 OK

# After Part 2
kubectl get nodes -o wide                                  # 3 nodes Ready
kubectl cnpg status postgres -n rejourney                  # Primary healthy + 1 streaming replica
kubectl exec -n rejourney redis-master-0 -- \
  redis-cli -a $REDIS_PASS --no-auth-warning \
  INFO replication                                         # role:master, connected_slaves:2
kubectl get pods -n rejourney -o wide -l app=api           # pods on different NODEs
```

---

## Local K8s Testing Parity

`local-k8s/` mirrors production with MinIO instead of Hetzner S3. Test Part 1 changes here before the production window.

### What to update in `local-k8s/`

| Change | Action |
|---|---|
| Redis → Bitnami | `helm install redis bitnami/redis -n rejourney-local -f k8s/helm/redis-values.yaml --set global.storageClass=local-path` |
| Redis auth | Patch `redis-secret` in `rejourney-local` with `REDIS_PASSWORD` + updated `REDIS_URL` |
| CronJob deadlines | Mirror `startingDeadlineSeconds: 300` in `local-k8s/workers.yaml` |
| PDB | Apply `k8s/pdb.yaml` to `rejourney-local` namespace |
| Recreate strategies | Mirror in any local monitoring deployments |

### Hetzner-specific steps — skip locally

- k3s CCM + CSI install (no Hetzner infra locally)
- `hcloud-volumes` StorageClass — substitute `local-path` everywhere in local values
- Hetzner LB — use Traefik NodePort locally

### Local Redis migration test

```bash
REDIS_PASS="localpass"

kubectl patch secret redis-secret -n rejourney-local --type=json -p="[
  {\"op\":\"add\",\"path\":\"/data/REDIS_PASSWORD\",\"value\":\"$(echo -n "${REDIS_PASS}" | base64)\"},
  {\"op\":\"replace\",\"path\":\"/data/REDIS_URL\",\"value\":\"$(echo -n "redis://:${REDIS_PASS}@redis-master.rejourney-local.svc.cluster.local:6379/0" | base64)\"}
]"

# Remove old redis resources
kubectl delete deployment redis -n rejourney-local 2>/dev/null || true
kubectl delete pvc redis-pvc -n rejourney-local 2>/dev/null || true

# Install Bitnami with local-path storage
helm install redis bitnami/redis -n rejourney-local -f k8s/helm/redis-values.yaml \
  --set global.storageClass=local-path

kubectl rollout status statefulset/redis-master -n rejourney-local
kubectl exec -n rejourney-local redis-master-0 -- \
  redis-cli -a "$REDIS_PASS" --no-auth-warning ping   # PONG
```

### Part 2 local testing

- Test **CNPG** in a throwaway `k3d` cluster before running on CPX42
- `local-k8s/` can't replicate multi-node anti-affinity — test stateless app behavior only

---

## Future Scaling

### Adding worker nodes (0 downtime, anytime)

```bash
hcloud server create --type cpx31 --name worker-3 \
  --datacenter fsn1-dc8 --network <private-network-id>   # same datacenter as CPX42

# SSH in and join:
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="agent \
  --server https://<CPX42-PRIVATE-IP>:6443 \
  --token <K3S_NODE_TOKEN> \
  --kubelet-arg=cloud-provider=external \
  --node-label=rejourney.co/role=worker" sh -
```

Hetzner LB adds it automatically. CNPG and Bitnami can be upgraded to use the additional node.

### HA control plane (when CPX42 downtime is unacceptable)

k3s currently uses SQLite. Must convert to embedded etcd first (~2 min maintenance):

```bash
# Add --cluster-init to ExecStart in /etc/systemd/system/k3s.service
systemctl daemon-reload && systemctl restart k3s
```

Then join 2 more server nodes (must reach 3 for etcd quorum — 2 servers is worse than 1):

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
  --server https://<CPX42-PRIVATE-IP>:6443 \
  --token <K3S_NODE_TOKEN> \
  --disable-cloud-controller \
  --disable=servicelb \
  --kubelet-arg=cloud-provider=external" sh -
```

After: losing any 1 of 3 servers keeps the cluster accessible. API stays up.
