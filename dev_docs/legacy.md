# Legacy resource cleanup — post Phase 1-D/1-E

After the CNPG cutover on **2026-04-22** we kept the legacy Postgres StatefulSet + a few orphan admin-tool PVCs running as rollback insurance. This file is the checklist for removing them once we're confident the new stack is stable.

**Do not clean up before: 2026-04-29** (1 week after cutover). Delay longer if there have been any DB incidents since cutover.

Before deleting anything, re-verify the new stack is healthy:

```bash
ssh -i ~/.ssh/vps_deploy root@46.224.98.62 \
  'kubectl get cluster postgres-local -n rejourney -o jsonpath="{.status.phase}"; echo'
# Expect: "Cluster in healthy state"

# CNPG base backup ran successfully at least once recently:
ssh -i ~/.ssh/vps_deploy root@46.224.98.62 \
  'kubectl get backup -n rejourney -l cnpg.io/cluster=postgres-local,cnpg.io/scheduled-backup=postgres-daily-backup --sort-by=.metadata.creationTimestamp | tail -5'
```

---

## 1. Legacy Postgres StatefulSet (rollback path)

The legacy `postgres-0` StatefulSet is still running and still has current data *as of the cutover snapshot*. It's unlabeled so the deploy script's `--prune` won't touch it, and `k8s/postgres.yaml` has been removed from the repo.

**Rollback path** (only if new CNPG stack goes bad within the week):
1. Patch `postgres-secret` DATABASE_URL back to `@postgres:5432`.
2. Patch `postgres-exporter-secret` DATA_SOURCE_NAME back to `@postgres:5432`.
3. Re-apply pgbouncer with `DB_HOST=postgres` and rolling restart.
4. Re-apply gatus / admin-tools with `postgres` hostname.
5. Any writes landed on CNPG during the rollback window are lost — accept or re-migrate.

**Cleanup (after 2026-04-29):**

```bash
# Scale to 0 first — observe for an hour that nothing is trying to connect:
kubectl scale statefulset postgres -n rejourney --replicas=0

# If healthy, delete the StatefulSet + legacy Service:
kubectl delete statefulset postgres -n rejourney
kubectl delete service postgres -n rejourney

# Delete the legacy PVC (local-path, so the underlying data dir on the node
# is removed automatically — no Hetzner volume to worry about here):
kubectl delete pvc postgres-data-postgres-0 -n rejourney
```

---

## 2. Orphan admin-tool PVCs (no workloads)

Three PVCs from long-removed deployments still occupy local-path storage on the node:

| PVC | Size | Last used |
|---|---|---|
| `cloudbeaver-data` | 1 Gi | ~3 months ago |
| `pgadmin-data` | 1 Gi | ~3 months ago |
| `uptime-kuma-data` | 1 Gi | ~3 months ago |

No workloads reference them. Safe to delete any time — included here so it's not forgotten:

```bash
kubectl delete pvc cloudbeaver-data pgadmin-data uptime-kuma-data -n rejourney
```

---

## 3. Phase 1-D historical note

The `k8s/cnpg/postgres-cnpg.yaml` Cluster spec no longer has a `bootstrap.import` block. That monolith-import path was abandoned during the cutover because of the `oid=10` issue. Nothing to clean up there; this note only exists for grep-discoverability.

---

## 4. Repo-side changes already made (for reference)

- `k8s/postgres.yaml` — **deleted** (legacy StatefulSet).
- `k8s/namespace.yaml` — secret-bootstrap comments updated from `@postgres:5432` to `@postgres-app-rw:5432`.
- `k8s/api.yaml` — `db-setup` wait-postgres initContainer now probes `postgres-app-rw`.
- `k8s/pgbouncer.yaml`, `k8s/gatus.yaml`, `k8s/admin-tools.yaml` — all point at `postgres-app-rw`.
- `scripts/k8s/deploy-release.sh`: removed `ensure_pgbouncer_url_secret` (one-time migration, completed) and the dual-path CNPG/legacy branching in `wait_for_postgres` / `print_migration_status`. CNPG-only now.
- Live cluster: `statefulset/postgres` and `service/postgres` had their `app.kubernetes.io/part-of=rejourney` label stripped so the deploy script's `--prune` will not delete them while they sit idle.
