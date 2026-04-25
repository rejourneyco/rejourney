# PostgreSQL Backup + Restore (CNPG + R2)

Last updated: 2026-04-22

This is the operator runbook for the current production PostgreSQL backup and restore path after the local-storage cutover.

## Current backup model

Production Postgres is now:

- CNPG `Cluster`: `postgres-local`
- Storage class: `rejourney-db-local-retain`
- PVC size: `100Gi`
- Stable app-facing service aliases:
  - `postgres-app-rw`
  - `postgres-app-r`
  - `postgres-app-ro`

Backups now come from CloudNativePG itself, not a custom `postgres-backup` CronJob:

- continuous WAL archive to Cloudflare R2 from `k8s/cnpg/postgres-cnpg.yaml`
- daily CNPG `ScheduledBackup` named `postgres-daily-backup` from `k8s/cnpg-backups.yaml`
- current schedule: `0 0 3 * * *` (03:00:00 UTC, six-field CNPG cron format)
- CNPG retention policy in the cluster spec: `30d`

Important detail: the object-store path is `s3://rejourney-backup/cnpg-wal`, but CNPG/Barman use that location for both the base-backup catalog and WAL archive. The name is historical; treat it as the whole physical-backup recovery source.

## What to check routinely

```bash
kubectl get cluster postgres-local -n rejourney
kubectl get scheduledbackup postgres-daily-backup -n rejourney
kubectl get backup -n rejourney -l cnpg.io/cluster=postgres-local --sort-by=.metadata.creationTimestamp
kubectl describe cluster postgres-local -n rejourney
```

Grafana also shows the same signals:

- `20 — PostgreSQL (CNPG)`
- `60 — Storage & Backups`

The key healthy signs are:

- CNPG cluster phase is healthy
- recent `Backup` CRs exist for `postgres-daily-backup`
- WAL archiver is moving
- last available backup age is reasonable
- recoverability point age is reasonable

If the cluster was created recently and the first 03:00 UTC backup window has not happened yet, `LAST BACKUP` on the `ScheduledBackup` and the list of `Backup` CRs can still be empty even while WAL archiving is healthy.

## Restore rules that matter

- CNPG recovery is **not in-place** on an existing cluster. Restore means creating a new `Cluster` from a physical backup.
- If you want a safe dry run, restore into a temporary cluster name such as `postgres-restore`.
- If you need the restored cluster to become production without changing service aliases, restore into a **newly created** `Cluster` named `postgres-local` after the broken one is removed.
- Keep the recovered cluster on the same PostgreSQL major version and with compatible PostgreSQL parameters.
- Physical backup restores database roles and data, but Kubernetes secrets are not part of the backup. Keep or recreate:
  - `postgres-secret`
  - `postgres-exporter-secret`
  - `postgres-app-secret`
  - `r2-backup-secret`

`postgres-app-secret` is the CNPG bootstrap/app-owner secret. `postgres-secret` is the application wiring secret used by the rest of the stack.

## Restore manifest template

Use a new CNPG `Cluster` with `bootstrap.recovery`. This example restores from the current R2 backup catalog while keeping the source backup server name pinned to `postgres-local`.

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: postgres-restore
  namespace: rejourney
  labels:
    app.kubernetes.io/part-of: rejourney
spec:
  instances: 1
  imageName: ghcr.io/cloudnative-pg/postgresql:18

  postgresql:
    parameters:
      max_connections: "60"
      shared_buffers: "1536MB"
      effective_cache_size: "4GB"
      work_mem: "16MB"
      maintenance_work_mem: "128MB"
      pg_stat_statements.max: "10000"
      pg_stat_statements.track: "all"

  resources:
    requests:
      cpu: "1"
      memory: "2Gi"
    limits:
      cpu: "3"
      memory: "6Gi"

  storage:
    storageClass: rejourney-db-local-retain
    size: 100Gi

  bootstrap:
    recovery:
      source: postgres-local-backup
      database: rejourney
      owner: rejourney
      secret:
        name: postgres-app-secret
      # Optional PITR:
      # recoveryTarget:
      #   targetTime: "2026-04-22 15:30:00+00"

  externalClusters:
    - name: postgres-local-backup
      barmanObjectStore:
        serverName: postgres-local
        destinationPath: s3://rejourney-backup/cnpg-wal
        endpointURL: https://bea95e0d46f34ef18361f2537571d720.eu.r2.cloudflarestorage.com
        s3Credentials:
          accessKeyId:
            name: r2-backup-secret
            key: AWS_ACCESS_KEY_ID
          secretAccessKey:
            name: r2-backup-secret
            key: AWS_SECRET_ACCESS_KEY
        wal:
          maxParallel: 8
```

Notes:

- `serverName: postgres-local` matters because the backup catalog in object storage belongs to that source cluster name.
- `postgres-app-secret` should match the real application owner (`rejourney`). If you are rebuilding the namespace and the secret is gone, recreate it as a `kubernetes.io/basic-auth` secret for `rejourney`.
- If you need a known `postgres` superuser password on the restored cluster, add a `superuserSecret`. If you omit it, CNPG can generate one.

## Validation restore flow

Use this when you want proof that backups are restorable without changing production:

1. Apply a restore manifest with `metadata.name: postgres-restore`.
2. Wait for the restored primary pod:

   ```bash
   kubectl wait --for=condition=Ready pod \
     -l cnpg.io/cluster=postgres-restore,cnpg.io/instanceRole=primary \
     -n rejourney --timeout=30m
   ```

3. Verify the cluster object:

   ```bash
   kubectl get cluster postgres-restore -n rejourney
   kubectl describe cluster postgres-restore -n rejourney
   ```

4. Connect from inside the pod and run sanity checks:

   ```bash
   PRIMARY=$(kubectl get pod -n rejourney -l cnpg.io/cluster=postgres-restore,cnpg.io/instanceRole=primary -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -it "$PRIMARY" -n rejourney -c postgres -- psql -U postgres -d rejourney
   ```

5. Check a few real tables and counts, not just cluster health.
6. Delete the test cluster when finished.

This is the preferred periodic recovery drill because it proves the R2 backup catalog is actually usable.

## Production replacement restore flow

Use this when the live `postgres-local` PVC is no longer trustworthy and you need the restored cluster to become production.

1. Freeze writers first.
   Scale down the API, PgBouncer, and worker Deployments or otherwise put the app in maintenance mode before cutover.
2. Confirm the recovery point you want.
   Decide between:
   - latest available WAL
   - PITR to a specific UTC timestamp using `recoveryTarget.targetTime`
3. Preserve any secrets you still need.
   At minimum keep `postgres-secret`, `postgres-exporter-secret`, `postgres-app-secret`, and `r2-backup-secret`.
4. Remove the broken live cluster if you want to keep the stable production cluster name.
   CNPG cannot recover in place on an existing `Cluster`.
5. Apply the same restore manifest, but set:
   - `metadata.name: postgres-local`
6. Wait for the restored `postgres-local` primary to become ready.
7. Bring PgBouncer, API, and workers back up.
8. Verify:
   - app traffic can connect through `postgres-app-rw`
   - `postgres-exporter` is healthy
   - Grafana `20 — PostgreSQL (CNPG)` and `60 — Storage & Backups` look normal
   - a new `Backup` CR appears later from `postgres-daily-backup`

The reason this preserves the rest of the stack is simple: our stable service aliases already select `cnpg.io/cluster=postgres-local`. Reusing that cluster name avoids rewiring `postgres-app-rw`, `postgres-app-r`, and `postgres-app-ro`.

## PITR guidance

If you need to stop before a bad write or bad deploy:

- use `bootstrap.recovery.recoveryTarget.targetTime`
- choose a UTC timestamp before the incident
- restore to a temporary cluster first if there is any doubt

If `recoveryTarget` is omitted, CNPG restores to the latest available WAL by default.

## Recreating the app-owner secret if needed

If the namespace is being rebuilt and `postgres-app-secret` is gone, recreate it before restore:

```bash
kubectl create secret generic postgres-app-secret \
  --namespace rejourney \
  --type=kubernetes.io/basic-auth \
  --from-literal=username=rejourney \
  --from-literal=password='<APP_DB_PASSWORD>'
```

`username` must match the `owner` value in the recovery manifest.

## After restore

Run through this checklist:

- `kubectl get cluster <name> -n rejourney`
- `kubectl get pods -n rejourney -l cnpg.io/cluster=<name>`
- `kubectl get backup -n rejourney -l cnpg.io/cluster=<name>`
- `kubectl logs -n rejourney deployment/postgres-exporter --tail=100`
- `kubectl logs -n rejourney deployment/pgbouncer --tail=100`
- open Grafana and confirm:
  - WAL archiving is healthy
  - last base backup age is sane
  - connection metrics are back
  - PVC usage is normal

If the namespace or secrets were rebuilt from scratch, rerun the normal secret/bootstrap flow afterwards so the rest of the stack has the expected `postgres-secret` and exporter credentials again.
