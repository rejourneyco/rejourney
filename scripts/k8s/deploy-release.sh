#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
K8S_DIR="${ROOT_DIR}/k8s"
NAMESPACE="${NAMESPACE:-rejourney}"
CNPG_CLUSTER_NAME="${CNPG_CLUSTER_NAME:-postgres}"
ALLOW_LEGACY_POSTGRES_REMOVAL="${ALLOW_LEGACY_POSTGRES_REMOVAL:-false}"
IMAGE_TAG="${1:?usage: deploy-release.sh <image-tag> [repository]}"
REPOSITORY="${2:-rejourneyco/rejourney}"
RENDER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rejourney-release.XXXXXX")"

cleanup() {
  rm -rf "${RENDER_DIR}"
}

trap cleanup EXIT

log() {
  echo "[deploy-release] $1"
}

section() {
  echo
  echo "[deploy-release] =================================================="
  echo "[deploy-release] $1"
  echo "[deploy-release] =================================================="
}

dump_db_setup_diagnostics() {
  kubectl describe job db-setup -n "${NAMESPACE}" || true
  kubectl logs job/db-setup -n "${NAMESPACE}" -c wait-postgres --tail=50 || true
  kubectl logs job/db-setup -n "${NAMESPACE}" -c setup --tail=100 || true
}

dump_workload_diagnostics() {
  local kind="$1"
  local name="$2"

  kubectl describe "${kind}" "${name}" -n "${NAMESPACE}" || true
  kubectl get pods -n "${NAMESPACE}" -l "app=${name}" -o wide || true
  kubectl describe pods -n "${NAMESPACE}" -l "app=${name}" || true

  if [ "${kind}" = "deployment" ]; then
    kubectl logs deployment/"${name}" -n "${NAMESPACE}" --tail=100 || true
  else
    kubectl logs -n "${NAMESPACE}" -l "app=${name}" --tail=100 --all-containers=true || true
  fi
}

require_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[deploy-release] ERROR: $1 is required" >&2
    exit 1
  }
}

render_manifests() {
  cp -R "${K8S_DIR}/." "${RENDER_DIR}/"

  # Manual cutover assets are staged in the repo but must never be applied by CI.
  rm -rf "${RENDER_DIR}/manual"

  # Ignore macOS AppleDouble metadata files and Finder artifacts if they slip into the repo/worktree.
  find "${RENDER_DIR}" \( -name '._*' -o -name '.DS_Store' \) -type f -delete

  find "${RENDER_DIR}" -name '*.yaml' -type f -print0 | while IFS= read -r -d '' file; do
    perl -0pi -e "s|image:\\s*ghcr\\.io/${REPOSITORY}/api:[^\\s]+|image: ghcr.io/${REPOSITORY}/api:${IMAGE_TAG}|g; s|image:\\s*ghcr\\.io/${REPOSITORY}/web:[^\\s]+|image: ghcr.io/${REPOSITORY}/web:${IMAGE_TAG}|g; s|image:\\s*ghcr\\.io/${REPOSITORY}/migration:[^\\s]+|image: ghcr.io/${REPOSITORY}/migration:${IMAGE_TAG}|g" "${file}"
  done
}

ensure_grafana_secret() {
  if kubectl get secret grafana-secret -n "${NAMESPACE}" >/dev/null 2>&1; then
    log "grafana-secret already exists, skipping"
    return
  fi

  log "Creating grafana-secret with random admin password..."
  local pass
  pass="$(openssl rand -hex 16)"
  kubectl create secret generic grafana-secret \
    --namespace "${NAMESPACE}" \
    --from-literal=admin-password="${pass}"
  log "grafana-secret created. Retrieve password: kubectl get secret grafana-secret -n ${NAMESPACE} -o jsonpath='{.data.admin-password}' | base64 -d"
}

ensure_cert_manager() {
  if kubectl get namespace cert-manager >/dev/null 2>&1; then
    return
  fi

  log "cert-manager not found. Installing..."
  kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.2/cert-manager.yaml
  log "Waiting for cert-manager to be ready..."
  kubectl wait --for=condition=Available deployment/cert-manager-webhook -n cert-manager --timeout=300s
}

apply_unlabeled_support_manifests() {
  # The main apply step targets app.kubernetes.io/part-of=rejourney, so it skips
  # intentionally unlabeled RBAC / ServiceAccount objects and kube-system helper services.
  kubectl apply -f "${RENDER_DIR}/exporters.yaml"
  kubectl apply -f "${RENDER_DIR}/ingress.yaml"
  kubectl apply -f "${RENDER_DIR}/storage-class-db-local.yaml"
}

apply_cnpg_cluster_manifest() {
  local cnpg_manifest="${RENDER_DIR}/cnpg/postgres-cnpg.yaml"
  if [ ! -f "${cnpg_manifest}" ]; then
    log "Skipping CNPG manifest apply (file not found)"
    return
  fi

  section "Applying CNPG Cluster"
  kubectl apply -f "${cnpg_manifest}"
}

legacy_postgres_can_be_removed() {
  local direct_url pooled_url
  direct_url="$(kubectl get secret postgres-secret -n "${NAMESPACE}" -o jsonpath='{.data.DATABASE_URL}' 2>/dev/null | base64 -d 2>/dev/null || true)"
  pooled_url="$(kubectl get secret postgres-secret -n "${NAMESPACE}" -o jsonpath='{.data.PGBOUNCER_URL}' 2>/dev/null | base64 -d 2>/dev/null || true)"

  if [[ "${direct_url}" == *"@postgres:"* ]]; then
    log "Legacy postgres removal skipped: postgres-secret DATABASE_URL still points at postgres service."
    return 1
  fi

  if [[ "${pooled_url}" == *"@postgres:"* ]]; then
    log "Legacy postgres removal skipped: postgres-secret PGBOUNCER_URL still points at postgres service."
    return 1
  fi

  return 0
}

remove_legacy_postgres() {
  section "Removing Legacy PostgreSQL"

  if [ "${ALLOW_LEGACY_POSTGRES_REMOVAL}" != "true" ]; then
    log "Skipping legacy postgres removal (ALLOW_LEGACY_POSTGRES_REMOVAL is not true)."
    return
  fi

  if ! legacy_postgres_can_be_removed; then
    return
  fi

  log "Deleting legacy postgres StatefulSet/service now that prod points at CNPG..."
  kubectl delete statefulset postgres -n "${NAMESPACE}" --ignore-not-found
  kubectl delete service postgres -n "${NAMESPACE}" --ignore-not-found
}

wait_for_postgres() {
  section "Waiting For PostgreSQL"
  local label="cnpg.io/cluster=${CNPG_CLUSTER_NAME},cnpg.io/instanceRole=primary"
  if ! kubectl wait --for=condition=ready pod -l "${label}" -n "${NAMESPACE}" --timeout=180s; then
    kubectl describe pod -l "${label}" -n "${NAMESPACE}" || true
    echo "[deploy-release] PostgreSQL did not become ready" >&2
    exit 1
  fi
}

wait_for_job() {
  section "Waiting For db-setup"
  local deadline
  deadline=$(( $(date +%s) + 360 ))

  while true; do
    local succeeded failed
    succeeded="$(kubectl get job db-setup -n "${NAMESPACE}" -o jsonpath='{.status.succeeded}' 2>/dev/null || true)"
    failed="$(kubectl get job db-setup -n "${NAMESPACE}" -o jsonpath='{.status.failed}' 2>/dev/null || true)"

    succeeded="${succeeded:-0}"
    failed="${failed:-0}"

    if [ "${succeeded}" = "1" ]; then
      return 0
    fi

    if [ "${failed}" != "0" ]; then
      dump_db_setup_diagnostics
      echo "[deploy-release] db-setup failed" >&2
      exit 1
    fi

    if [ "$(date +%s)" -ge "${deadline}" ]; then
      dump_db_setup_diagnostics
      echo "[deploy-release] db-setup timed out" >&2
      exit 1
    fi

    sleep 5
  done
}

print_migration_status() {
  local phase="$1"

  section "Migration Status (${phase})"
  log "Repo migration directories:"
  find "${K8S_DIR}/../backend/drizzle" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort | tail -n 10

  log "Applied drizzle migrations in cluster:"
  local pg_pod
  pg_pod=$(kubectl get pod -n "${NAMESPACE}" \
    -l "cnpg.io/cluster=${CNPG_CLUSTER_NAME},cnpg.io/instanceRole=primary" \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

  if [ -n "${pg_pod}" ]; then
    kubectl exec -n "${NAMESPACE}" "${pg_pod}" -c postgres -- \
      psql -U postgres -d rejourney -At -F $'\t' \
        -c "select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 10;" \
      || log "Could not query drizzle.__drizzle_migrations yet"
  else
    log "No CNPG primary pod found yet"
  fi
}

wait_for_deployment() {
  local name="$1"
  local deployment_exists
  local cronjob_exists
  local replicas

  deployment_exists="$(kubectl get deployment "${name}" -n "${NAMESPACE}" -o name 2>/dev/null || true)"
  if [ -z "${deployment_exists}" ]; then
    cronjob_exists="$(kubectl get cronjob "${name}" -n "${NAMESPACE}" -o name 2>/dev/null || true)"
    if [ -n "${cronjob_exists}" ]; then
      log "Skipping rollout wait for ${name} (CronJob resource)"
    else
      log "Skipping rollout wait for ${name} (no Deployment resource)"
    fi
    return
  fi

  replicas="$(kubectl get deployment "${name}" -n "${NAMESPACE}" -o jsonpath='{.spec.replicas}')"
  if [ -z "${replicas}" ] || [ "${replicas}" = "0" ]; then
    log "Skipping rollout wait for ${name} (Deployment scaled to 0)"
    return
  fi

  log "Waiting for rollout: ${name}"
  if ! kubectl rollout status deployment/"${name}" -n "${NAMESPACE}" --timeout=300s; then
    dump_workload_diagnostics deployment "${name}"
    exit 1
  fi
}

wait_for_daemonset() {
  local name="$1"

  if ! kubectl get daemonset "${name}" -n "${NAMESPACE}" -o name >/dev/null 2>&1; then
    log "Skipping rollout wait for ${name} (no DaemonSet resource)"
    return
  fi

  log "Waiting for rollout: ${name}"
  if ! kubectl rollout status daemonset/"${name}" -n "${NAMESPACE}" --timeout=300s; then
    dump_workload_diagnostics daemonset "${name}"
    exit 1
  fi
}

cleanup_finished_pods() {
  kubectl delete pods -n "${NAMESPACE}" --field-selector=status.phase==Succeeded --ignore-not-found >/dev/null 2>&1 || true
  kubectl delete pods -n "${NAMESPACE}" --field-selector=status.phase==Failed --ignore-not-found >/dev/null 2>&1 || true
}

restart_seeder_jobs() {
  # Kill all running session-backup-seed jobs so they immediately restart with the
  # updated ConfigMap (session-backup-script). The CronJob reschedules automatically.
  # Without this, running pods keep using the script that was baked into their
  # volume mount at pod start — they won't see the new ConfigMap until they restart.
  section "Restarting Session-Backup-Seed Jobs"
  log "Deleting active session-backup-seed jobs (will reschedule from CronJob)..."
  kubectl get jobs -n "${NAMESPACE}" --no-headers -o custom-columns=":metadata.name" \
    | grep "^session-backup-seed-" \
    | xargs -r kubectl delete job -n "${NAMESPACE}" --ignore-not-found || true

  # Also clean up stuck long-running session-backup drain jobs that pre-date this
  # deploy (older than 23h) — they're running the old script and blocking the queue.
  log "Deleting stale session-backup drain jobs (>23h old)..."
  local cutoff
  cutoff="$(date -u -d '23 hours ago' +%s 2>/dev/null || date -u -v-23H +%s)"
  kubectl get jobs -n "${NAMESPACE}" --no-headers \
    -o custom-columns=":metadata.name,:metadata.creationTimestamp" \
    | grep "^session-backup-[0-9]" \
    | while read -r name ts; do
        local ts_epoch
        ts_epoch="$(date -u -d "${ts}" +%s 2>/dev/null || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "${ts}" +%s 2>/dev/null || echo 0)"
        if [ "${ts_epoch}" -lt "${cutoff}" ]; then
          log "  Deleting stale job: ${name} (created ${ts})"
          kubectl delete job "${name}" -n "${NAMESPACE}" --ignore-not-found || true
        fi
      done
}

main() {
  require_bin kubectl
  require_bin perl
  require_bin python3

  section "Rendering Release"
  log "Repository: ${REPOSITORY}"
  log "Image tag: ${IMAGE_TAG}"
  render_manifests

  section "Applying Cluster Prerequisites"
  kubectl apply -f "${K8S_DIR}/namespace.yaml"
  kubectl apply -f "${K8S_DIR}/traefik-config.yaml"
  ensure_cert_manager
  ensure_grafana_secret
  apply_unlabeled_support_manifests
  apply_cnpg_cluster_manifest

  bash "${ROOT_DIR}/scripts/k8s/check-archive-sync.sh"

  print_migration_status "before"

  section "Resetting db-setup Job"
  log "Deleting old db-setup job..."
  kubectl delete job db-setup -n "${NAMESPACE}" --ignore-not-found --wait=true --timeout=120s || true
  kubectl delete pods -n "${NAMESPACE}" -l job-name=db-setup --ignore-not-found --wait=true --timeout=60s || true

  # ── Grafana dashboards ConfigMap (server-side apply) ────────────────────
  # The grafana-dashboards ConfigMap is ~290KB, which exceeds client-side
  # apply's 262144-byte last-applied-configuration annotation limit. Apply
  # it separately with --server-side (field-manager metadata, no annotation)
  # and remove it from the bulk apply dir. It's intentionally NOT labeled
  # app.kubernetes.io/part-of=rejourney so the bulk --prune pass ignores it.
  section "Applying Grafana dashboards (server-side)"
  if [[ -f "${RENDER_DIR}/grafana-dashboards.yaml" ]]; then
    kubectl apply --server-side --force-conflicts \
      -f "${RENDER_DIR}/grafana-dashboards.yaml"
    rm -f "${RENDER_DIR}/grafana-dashboards.yaml"
  fi

  section "Applying Rendered Manifests"
  log "Applying rendered manifests..."
  kubectl apply -f "${RENDER_DIR}/" \
    --prune \
    -l app.kubernetes.io/part-of=rejourney \
    --prune-allowlist=core/v1/ConfigMap \
    --prune-allowlist=core/v1/Service \
    --prune-allowlist=apps/v1/Deployment \
    --prune-allowlist=apps/v1/StatefulSet \
    --prune-allowlist=networking.k8s.io/v1/Ingress \
    --prune-allowlist=traefik.io/v1alpha1/Middleware \
    --prune-allowlist=batch/v1/CronJob \
    --prune-allowlist=batch/v1/Job \
    --prune-allowlist=policy/v1/PodDisruptionBudget

  # ── Helm-managed resources guard ─────────────────────────────────────────
  # The kubectl apply --prune above can delete resources that were previously
  # applied with app.kubernetes.io/part-of=rejourney but are now managed by
  # Helm (e.g. the Bitnami redis Service).  Restore them and strip the label
  # so future prune passes never touch them again.
  section "Ensuring Helm-managed Redis Service"
  if ! kubectl get svc redis -n "${NAMESPACE}" >/dev/null 2>&1; then
    log "redis Service was pruned — restoring via helm upgrade (--reuse-values)..."
    KUBECONFIG=/etc/rancher/k3s/k3s.yaml helm upgrade redis bitnami/redis \
      -n "${NAMESPACE}" --reuse-values --wait --timeout=120s
    log "redis Service restored."
  else
    log "redis Service present — no restore needed."
  fi
  # Strip the rejourney part-of label so --prune never targets this Helm-managed Service
  kubectl label svc redis -n "${NAMESPACE}" "app.kubernetes.io/part-of-" 2>/dev/null || true
  log "Removed app.kubernetes.io/part-of label from redis Service (if present)."

  # Traefik dashboard Ingress lived in kube-system without part-of=rejourney, so --prune never removed it.
  log "Removing legacy Traefik dashboard Ingress if present..."
  kubectl delete ingress traefik-dashboard-ingress -n kube-system --ignore-not-found

  # NetData RBAC was cluster-scoped (no part-of=rejourney label) so --prune never removes it.
  log "Removing legacy NetData cluster resources if present..."
  kubectl delete clusterrole netdata --ignore-not-found
  kubectl delete clusterrolebinding netdata --ignore-not-found
  kubectl delete serviceaccount netdata -n "${NAMESPACE}" --ignore-not-found

  wait_for_postgres
  wait_for_deployment pgbouncer
  wait_for_job
  remove_legacy_postgres
  print_migration_status "after"

  section "Waiting For Rollouts"
  wait_for_deployment api
  wait_for_deployment ingest-upload
  wait_for_deployment web
  wait_for_deployment ingest-worker
  wait_for_deployment replay-worker
  wait_for_deployment session-lifecycle-worker
  wait_for_deployment retention-worker
  wait_for_deployment alert-worker
  wait_for_deployment postgres-exporter
  wait_for_deployment kube-state-metrics
  wait_for_deployment victoria-metrics
  wait_for_deployment grafana
  wait_for_deployment gatus
  wait_for_deployment pushgateway
  wait_for_daemonset cadvisor
  wait_for_daemonset node-exporter

  section "Cleaning up legacy Grafana dashboards"
  python3 "${ROOT_DIR}/scripts/k8s/patch-imported-grafana-dashboards.py" "${NAMESPACE}"

  restart_seeder_jobs
  cleanup_finished_pods
  log "Release applied successfully for image tag ${IMAGE_TAG}"
}

main "$@"
