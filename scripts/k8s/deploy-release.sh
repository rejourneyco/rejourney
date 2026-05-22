#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
K8S_DIR="${ROOT_DIR}/k8s"
NAMESPACE="${NAMESPACE:-rejourney}"
CNPG_CLUSTER_NAME="${CNPG_CLUSTER_NAME:-postgres-local}"
ALLOW_LEGACY_POSTGRES_REMOVAL="${ALLOW_LEGACY_POSTGRES_REMOVAL:-false}"
DB_SETUP_TIMEOUT_SECONDS="${DB_SETUP_TIMEOUT_SECONDS:-900}"
DEPLOY_CLICKHOUSE="${DEPLOY_CLICKHOUSE:-false}"
CLICKHOUSE_OPERATOR_NAMESPACE="${CLICKHOUSE_OPERATOR_NAMESPACE:-clickhouse}"
CLICKHOUSE_OPERATOR_VERSION="${CLICKHOUSE_OPERATOR_VERSION:-0.26.3}"
CLICKHOUSE_SETUP_TIMEOUT_SECONDS="${CLICKHOUSE_SETUP_TIMEOUT_SECONDS:-900}"
RUN_CLICKHOUSE_ROLLUP_BACKFILL="${RUN_CLICKHOUSE_ROLLUP_BACKFILL:-false}"
CLICKHOUSE_ROLLUP_BACKFILL_TIMEOUT_SECONDS="${CLICKHOUSE_ROLLUP_BACKFILL_TIMEOUT_SECONDS:-1800}"
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

redact_ci_output() {
  sed -E \
    -e 's#(postgres(ql)?://)[^[:space:]]+#\1[REDACTED]#g' \
    -e 's#(redis://)[^[:space:]]+#\1[REDACTED]#g' \
    -e 's#(rj_(live|test)_[A-Za-z0-9._=-]+)#rj_[REDACTED]#g' \
    -e 's#(sk_live_|sk_test_|rk_live_|rk_test_|whsec_)[A-Za-z0-9._-]+#[REDACTED]#g' \
    -e 's#(AKIA|ASIA)[A-Z0-9]{16}#[REDACTED]#g' \
    -e 's#([A-Za-z0-9/+=]{40,})#[REDACTED-LONG-TOKEN]#g'
}

dump_db_setup_diagnostics() {
  kubectl describe job db-setup -n "${NAMESPACE}" || true

  # Pods may be running, terminated, or already cleaned up. Try every pod owned
  # by the job (current + any retry attempts) and fall back to --previous so
  # crash-loop logs survive container restart. Migration logs are SQL/drizzle
  # output — safe to dump verbatim, no user PII.
  local job_pods
  job_pods="$(kubectl get pods -n "${NAMESPACE}" -l job-name=db-setup -o name 2>/dev/null || true)"
  for pod in ${job_pods}; do
    echo "[deploy-release] --- Logs from ${pod} (current attempt) ---"
    (kubectl logs "${pod}" -n "${NAMESPACE}" -c setup --tail=200 2>&1 || true) | redact_ci_output
    echo "[deploy-release] --- Logs from ${pod} (previous attempt) ---"
    (kubectl logs "${pod}" -n "${NAMESPACE}" -c setup --tail=200 --previous 2>&1 || true) | redact_ci_output
  done
}

dump_clickhouse_setup_diagnostics() {
  kubectl describe job clickhouse-setup -n "${NAMESPACE}" || true

  local job_pods
  job_pods="$(kubectl get pods -n "${NAMESPACE}" -l job-name=clickhouse-setup -o name 2>/dev/null || true)"
  for pod in ${job_pods}; do
    echo "[deploy-release] --- Logs from ${pod} (wait-clickhouse) ---"
    (kubectl logs "${pod}" -n "${NAMESPACE}" -c wait-clickhouse --tail=100 2>&1 || true) | redact_ci_output
    echo "[deploy-release] --- Logs from ${pod} (setup current attempt) ---"
    (kubectl logs "${pod}" -n "${NAMESPACE}" -c setup --tail=200 2>&1 || true) | redact_ci_output
    echo "[deploy-release] --- Logs from ${pod} (setup previous attempt) ---"
    (kubectl logs "${pod}" -n "${NAMESPACE}" -c setup --tail=200 --previous 2>&1 || true) | redact_ci_output
  done
}

dump_clickhouse_rollup_backfill_diagnostics() {
  kubectl describe job clickhouse-backfill-api-rollups -n "${NAMESPACE}" || true

  local job_pods
  job_pods="$(kubectl get pods -n "${NAMESPACE}" -l job-name=clickhouse-backfill-api-rollups -o name 2>/dev/null || true)"
  for pod in ${job_pods}; do
    echo "[deploy-release] --- Logs from ${pod} (wait-clickhouse) ---"
    (kubectl logs "${pod}" -n "${NAMESPACE}" -c wait-clickhouse --tail=100 2>&1 || true) | redact_ci_output
    echo "[deploy-release] --- Logs from ${pod} (backfill current attempt) ---"
    (kubectl logs "${pod}" -n "${NAMESPACE}" -c backfill --tail=200 2>&1 || true) | redact_ci_output
    echo "[deploy-release] --- Logs from ${pod} (backfill previous attempt) ---"
    (kubectl logs "${pod}" -n "${NAMESPACE}" -c backfill --tail=200 --previous 2>&1 || true) | redact_ci_output
  done
}

# Dump deployment/daemonset state on rollout failure. We INTENTIONALLY do not
# dump application logs here — `kubectl logs` on the api/web pods would print
# the last 100 request lines, which include user cookies, CSRF tokens, upload
# JWTs, and IP addresses. Anyone with access to the GitHub Actions log (i.e.
# every repo collaborator and the GitHub support team) would see them. State
# info from describe + events is enough to diagnose rollout failures (image
# pull, scheduling, OOM, probe failure). For runtime debugging, run
# `kubectl logs` directly against the cluster.
dump_workload_diagnostics() {
  local kind="$1"
  local name="$2"

  kubectl describe "${kind}" "${name}" -n "${NAMESPACE}" || true
  kubectl get pods -n "${NAMESPACE}" -l "app=${name}" -o wide || true
  kubectl describe pods -n "${NAMESPACE}" -l "app=${name}" || true
}

require_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[deploy-release] ERROR: $1 is required" >&2
    exit 1
  }
}

render_manifests() {
  cp -R "${K8S_DIR}/." "${RENDER_DIR}/"

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
  log "grafana-secret created."
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

clickhouse_deploy_enabled() {
  [ "${DEPLOY_CLICKHOUSE}" = "true" ]
}

clickhouse_rollup_backfill_enabled() {
  [ "${RUN_CLICKHOUSE_ROLLUP_BACKFILL}" = "true" ]
}

remove_clickhouse_rendered_manifests() {
  rm -f "${RENDER_DIR}/clickhouse.yaml" "${RENDER_DIR}/clickhouse-setup.yaml" "${RENDER_DIR}/clickhouse-backfill-api-rollups.yaml"
}

clickhouse_operator_deployment_name() {
  if kubectl get deployment clickhouse-operator-altinity-clickhouse-operator -n "${CLICKHOUSE_OPERATOR_NAMESPACE}" >/dev/null 2>&1; then
    echo "clickhouse-operator-altinity-clickhouse-operator"
  elif kubectl get deployment clickhouse-operator -n "${CLICKHOUSE_OPERATOR_NAMESPACE}" >/dev/null 2>&1; then
    echo "clickhouse-operator"
  else
    kubectl get deployment -l app.kubernetes.io/instance=clickhouse-operator \
      -n "${CLICKHOUSE_OPERATOR_NAMESPACE}" \
      -o jsonpath='{.items[0].metadata.name}'
  fi
}

patch_clickhouse_operator_watch_namespace() {
  local deployment_name configmap_name config_file patch_file
  deployment_name="$(clickhouse_operator_deployment_name)"

  for configmap_name in \
    "${deployment_name}-files" \
    "clickhouse-operator-altinity-clickhouse-operator-files" \
    "clickhouse-operator-files"; do
    if kubectl get configmap "${configmap_name}" -n "${CLICKHOUSE_OPERATOR_NAMESPACE}" >/dev/null 2>&1; then
      break
    fi
  done

  if ! kubectl get configmap "${configmap_name}" -n "${CLICKHOUSE_OPERATOR_NAMESPACE}" >/dev/null 2>&1; then
    echo "[deploy-release] ERROR: ClickHouse operator configmap not found" >&2
    exit 1
  fi

  config_file="$(mktemp)"
  patch_file="$(mktemp)"

  kubectl get configmap "${configmap_name}" -n "${CLICKHOUSE_OPERATOR_NAMESPACE}" \
    -o jsonpath='{.data.config\.yaml}' > "${config_file}"

  if grep -Eq "^[[:space:]]*-[[:space:]]*${NAMESPACE}$" "${config_file}"; then
    log "ClickHouse operator already watches namespace ${NAMESPACE}"
    rm -f "${config_file}" "${patch_file}"
    return
  fi

  perl -0pi -e "s/namespaces: \\[\\]/namespaces:\\n          - ${NAMESPACE}/" "${config_file}"
  python3 - "${config_file}" "${patch_file}" <<'PY'
import json
import pathlib
import sys

config = pathlib.Path(sys.argv[1]).read_text()
pathlib.Path(sys.argv[2]).write_text(json.dumps({"data": {"config.yaml": config}}))
PY

  kubectl patch configmap "${configmap_name}" -n "${CLICKHOUSE_OPERATOR_NAMESPACE}" \
    --type merge --patch-file "${patch_file}"
  kubectl rollout restart deployment/"${deployment_name}" -n "${CLICKHOUSE_OPERATOR_NAMESPACE}"
  kubectl rollout status deployment/"${deployment_name}" -n "${CLICKHOUSE_OPERATOR_NAMESPACE}" --timeout=300s

  rm -f "${config_file}" "${patch_file}"
}

ensure_clickhouse_operator() {
  section "Ensuring ClickHouse Operator"
  require_bin helm

  log "Installing/upgrading Altinity ClickHouse operator ${CLICKHOUSE_OPERATOR_VERSION}..."
  helm repo add altinity https://helm.altinity.com >/dev/null 2>&1 || true
  helm repo update altinity >/dev/null
  helm upgrade --install clickhouse-operator \
    altinity/altinity-clickhouse-operator \
    --version "${CLICKHOUSE_OPERATOR_VERSION}" \
    --namespace "${CLICKHOUSE_OPERATOR_NAMESPACE}" \
    --create-namespace \
    --wait \
    --timeout=5m

  patch_clickhouse_operator_watch_namespace

  kubectl wait --for=condition=Established crd/clickhouseinstallations.clickhouse.altinity.com --timeout=120s
  kubectl wait --for=condition=Established crd/clickhousekeeperinstallations.clickhouse-keeper.altinity.com --timeout=120s
}

require_clickhouse_secret() {
  if ! kubectl get secret clickhouse-secret -n "${NAMESPACE}" >/dev/null 2>&1; then
    echo "[deploy-release] ERROR: clickhouse-secret is required when DEPLOY_CLICKHOUSE=true. Run scripts/k8s/k8s-sync-secrets.sh with DEPLOY_CLICKHOUSE=true and CLICKHOUSE_PASSWORD set." >&2
    exit 1
  fi

  local password_present
  password_present="$(kubectl get secret clickhouse-secret -n "${NAMESPACE}" -o jsonpath='{.data.CLICKHOUSE_PASSWORD}' 2>/dev/null || true)"
  if [ -z "${password_present}" ]; then
    echo "[deploy-release] ERROR: clickhouse-secret is missing CLICKHOUSE_PASSWORD." >&2
    exit 1
  fi
}

wait_for_clickhouse_resource() {
  local kind="$1"
  local name="$2"
  local timeout_seconds="${3:-900}"
  local deadline
  deadline=$(( $(date +%s) + timeout_seconds ))

  while true; do
    local status
    status="$(kubectl get "${kind}" "${name}" -n "${NAMESPACE}" -o jsonpath='{.status.status}' 2>/dev/null || true)"
    if [ "${status}" = "Completed" ]; then
      log "${kind}/${name} is Completed"
      return 0
    fi

    if [[ "${status}" =~ (Failed|Error) ]]; then
      kubectl describe "${kind}" "${name}" -n "${NAMESPACE}" || true
      echo "[deploy-release] ${kind}/${name} failed with status ${status}" >&2
      exit 1
    fi

    if [ "$(date +%s)" -ge "${deadline}" ]; then
      kubectl describe "${kind}" "${name}" -n "${NAMESPACE}" || true
      echo "[deploy-release] ${kind}/${name} timed out after ${timeout_seconds}s (last status: ${status:-unknown})" >&2
      exit 1
    fi

    log "Waiting for ${kind}/${name} (status: ${status:-unknown})..."
    sleep 10
  done
}

apply_clickhouse_manifests() {
  section "Applying ClickHouse Manifests"
  local clickhouse_manifest="${RENDER_DIR}/clickhouse.yaml"

  if [ ! -f "${clickhouse_manifest}" ]; then
    echo "[deploy-release] ERROR: ${clickhouse_manifest} not found" >&2
    exit 1
  fi

  require_clickhouse_secret
  kubectl apply -f "${clickhouse_manifest}"
  wait_for_clickhouse_resource chk clickhouse-keeper 900
  wait_for_clickhouse_resource chi rejourney 900

  if ! kubectl wait --for=condition=ready pod -l app=clickhouse -n "${NAMESPACE}" --timeout=300s; then
    kubectl describe pods -l app=clickhouse -n "${NAMESPACE}" || true
    echo "[deploy-release] ClickHouse pods did not become ready" >&2
    exit 1
  fi
}

apply_clickhouse_setup_job() {
  section "Applying clickhouse-setup Job"
  local clickhouse_setup_manifest="${RENDER_DIR}/clickhouse-setup.yaml"

  if [ ! -f "${clickhouse_setup_manifest}" ]; then
    echo "[deploy-release] ERROR: ${clickhouse_setup_manifest} not found" >&2
    exit 1
  fi

  kubectl apply -f "${clickhouse_setup_manifest}"
}

wait_for_clickhouse_setup_job() {
  section "Waiting For clickhouse-setup"
  local deadline
  deadline=$(( $(date +%s) + CLICKHOUSE_SETUP_TIMEOUT_SECONDS ))

  while true; do
    local succeeded failed
    succeeded="$(kubectl get job clickhouse-setup -n "${NAMESPACE}" -o jsonpath='{.status.succeeded}' 2>/dev/null || true)"
    failed="$(kubectl get job clickhouse-setup -n "${NAMESPACE}" -o jsonpath='{.status.failed}' 2>/dev/null || true)"

    succeeded="${succeeded:-0}"
    failed="${failed:-0}"

    if [ "${succeeded}" = "1" ]; then
      return 0
    fi

    if [ "${failed}" != "0" ]; then
      dump_clickhouse_setup_diagnostics
      echo "[deploy-release] clickhouse-setup failed" >&2
      exit 1
    fi

    if [ "$(date +%s)" -ge "${deadline}" ]; then
      dump_clickhouse_setup_diagnostics
      echo "[deploy-release] clickhouse-setup timed out after ${CLICKHOUSE_SETUP_TIMEOUT_SECONDS}s" >&2
      exit 1
    fi

    sleep 5
  done
}

apply_clickhouse_rollup_backfill_job() {
  section "Applying clickhouse-backfill-api-rollups Job"
  local backfill_manifest="${RENDER_DIR}/clickhouse-backfill-api-rollups.yaml"

  if [ ! -f "${backfill_manifest}" ]; then
    echo "[deploy-release] ERROR: ${backfill_manifest} not found" >&2
    exit 1
  fi

  kubectl apply -f "${backfill_manifest}"
}

wait_for_clickhouse_rollup_backfill_job() {
  section "Waiting For clickhouse-backfill-api-rollups"
  local deadline
  deadline=$(( $(date +%s) + CLICKHOUSE_ROLLUP_BACKFILL_TIMEOUT_SECONDS ))

  while true; do
    local succeeded failed
    succeeded="$(kubectl get job clickhouse-backfill-api-rollups -n "${NAMESPACE}" -o jsonpath='{.status.succeeded}' 2>/dev/null || true)"
    failed="$(kubectl get job clickhouse-backfill-api-rollups -n "${NAMESPACE}" -o jsonpath='{.status.failed}' 2>/dev/null || true)"

    succeeded="${succeeded:-0}"
    failed="${failed:-0}"

    if [ "${succeeded}" = "1" ]; then
      return 0
    fi

    if [ "${failed}" != "0" ]; then
      dump_clickhouse_rollup_backfill_diagnostics
      echo "[deploy-release] clickhouse-backfill-api-rollups failed" >&2
      exit 1
    fi

    if [ "$(date +%s)" -ge "${deadline}" ]; then
      dump_clickhouse_rollup_backfill_diagnostics
      echo "[deploy-release] clickhouse-backfill-api-rollups timed out after ${CLICKHOUSE_ROLLUP_BACKFILL_TIMEOUT_SECONDS}s" >&2
      exit 1
    fi

    sleep 5
  done
}

protect_helm_managed_resources() {
  # The Redis Service is Helm-owned. If an older live object still carries the
  # rejourney prune label, strip it before the prune pass so Redis never
  # disappears and gets restored after the fact.
  kubectl label svc redis -n "${NAMESPACE}" "app.kubernetes.io/part-of-" 2>/dev/null || true
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

apply_db_setup_job() {
  section "Applying db-setup Job"
  local db_setup_manifest="${RENDER_DIR}/db-setup.yaml"

  if [ ! -f "${db_setup_manifest}" ]; then
    echo "[deploy-release] ERROR: ${db_setup_manifest} not found" >&2
    exit 1
  fi

  kubectl apply -f "${db_setup_manifest}"
}

apply_data_plane_manifests() {
  section "Applying Data Plane Manifests"

  kubectl apply -f "${RENDER_DIR}/pdb.yaml"
  kubectl apply -f "${RENDER_DIR}/pgbouncer.yaml"
  wait_for_deployment pgbouncer
  wait_for_deployment pgbouncer-ro
}

wait_for_job() {
  section "Waiting For db-setup"
  local deadline
  deadline=$(( $(date +%s) + DB_SETUP_TIMEOUT_SECONDS ))

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
      echo "[deploy-release] db-setup timed out after ${DB_SETUP_TIMEOUT_SECONDS}s" >&2
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
  # Second arg overrides timeout; default 600s to handle cold image pulls on any node.
  # Critical services (api, ingest-upload, web) are called with 600s explicitly.
  local timeout="${2:-600s}"
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

  log "Waiting for rollout: ${name} (timeout: ${timeout})"
  if ! kubectl rollout status deployment/"${name}" -n "${NAMESPACE}" "--timeout=${timeout}"; then
    dump_workload_diagnostics deployment "${name}"
    exit 1
  fi
}

wait_for_deployment_ready_replicas() {
  local name="$1"
  local timeout="${2:-300}"
  local deadline
  deadline=$(( $(date +%s) + timeout ))

  while true; do
    local desired ready available
    desired="$(kubectl get deployment "${name}" -n "${NAMESPACE}" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")"
    ready="$(kubectl get deployment "${name}" -n "${NAMESPACE}" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")"
    available="$(kubectl get deployment "${name}" -n "${NAMESPACE}" -o jsonpath='{.status.availableReplicas}' 2>/dev/null || echo "0")"

    desired="${desired:-0}"
    ready="${ready:-0}"
    available="${available:-0}"

    if [ "${ready}" -ge "${desired}" ] && [ "${available}" -ge "${desired}" ]; then
      return 0
    fi

    if [ "$(date +%s)" -ge "${deadline}" ]; then
      dump_workload_diagnostics deployment "${name}"
      echo "[deploy-release] ${name} did not return to ${desired}/${desired} ready replicas" >&2
      exit 1
    fi

    sleep 5
  done
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

# Pull the new API and web images onto every node before triggering the rolling
# update.  Without this, pods scheduled to nodes that have never seen the image
# (typically the HEL1 nodes) block in ContainerCreating for >5 min while the
# image downloads, causing the rollout-wait to time out and CI to fail — even
# though the API itself never goes down (maxUnavailable=0 keeps old pods alive).
#
# Approach: create a temporary DaemonSet that tolerates all taints so it lands
# on every node.  Init containers run the real images (pulling them into the
# container-runtime cache) and exit immediately.  The main container is a
# minimal sleep so the pod stays "Ready" long enough for us to check status.
# We delete the DaemonSet as soon as all nodes report Ready.
prepull_images() {
  local api_image="ghcr.io/${REPOSITORY}/api:${IMAGE_TAG}"
  local web_image="ghcr.io/${REPOSITORY}/web:${IMAGE_TAG}"
  local migration_image="ghcr.io/${REPOSITORY}/migration:${IMAGE_TAG}"
  local ds_name="prepull-${IMAGE_TAG:0:12}"

  section "Pre-pulling Images on All Nodes"
  log "Images: ${api_image}"
  log "        ${web_image}"
  log "        ${migration_image}"

  # Remove any leftover prepull DaemonSets from a previous failed deploy
  kubectl delete daemonset -n "${NAMESPACE}" \
    -l app.kubernetes.io/component=image-prepull \
    --ignore-not-found --wait=false 2>/dev/null || true

  kubectl apply -f - <<YAML
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ${ds_name}
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/component: image-prepull
spec:
  selector:
    matchLabels:
      app: ${ds_name}
  template:
    metadata:
      labels:
        app: ${ds_name}
    spec:
      # Pull on every node, including control-plane/quorum nodes
      tolerations:
        - operator: Exists
      imagePullSecrets:
        - name: ghcr-secret
      # Init containers pull the heavy images once each, then exit.
      initContainers:
        - name: pull-api
          image: ${api_image}
          imagePullPolicy: IfNotPresent
          command: ["/bin/sh", "-c", "echo 'api image warmed on '\$(hostname)"]
          resources:
            requests: { cpu: 10m, memory: 32Mi }
            limits:   { cpu: 200m, memory: 256Mi }
        - name: pull-web
          image: ${web_image}
          imagePullPolicy: IfNotPresent
          command: ["/bin/sh", "-c", "echo 'web image warmed on '\$(hostname)"]
          resources:
            requests: { cpu: 10m, memory: 32Mi }
            limits:   { cpu: 200m, memory: 256Mi }
        - name: pull-migration
          image: ${migration_image}
          imagePullPolicy: IfNotPresent
          command: ["/bin/sh", "-c", "echo 'migration image warmed on '\$(hostname)"]
          resources:
            requests: { cpu: 10m, memory: 32Mi }
            limits:   { cpu: 200m, memory: 256Mi }
      # Minimal main container — just keeps the pod Running so we can count Ready pods
      containers:
        - name: done
          image: ${api_image}
          imagePullPolicy: IfNotPresent
          command: ["/bin/sh", "-c", "sleep 60"]
          resources:
            requests: { cpu: 1m, memory: 4Mi }
            limits:   { cpu: 50m, memory: 32Mi }
YAML

  # Fetch desired count (may be 0 briefly while k8s schedules); retry a few times
  local desired=0
  for _ in 1 2 3 4 5; do
    desired=$(kubectl get daemonset "${ds_name}" -n "${NAMESPACE}" \
      -o jsonpath='{.status.desiredNumberScheduled}' 2>/dev/null || echo "0")
    [ "${desired:-0}" -gt 0 ] && break
    sleep 3
  done

  if [ "${desired:-0}" -eq 0 ]; then
    log "⚠️  Could not determine desired node count for pre-pull DaemonSet; skipping wait."
  else
    log "Waiting for image pre-pull on ${desired} nodes (up to 300s)..."
    local deadline=$(( $(date +%s) + 300 ))
    while [ "$(date +%s)" -lt "${deadline}" ]; do
      local ready
      ready=$(kubectl get daemonset "${ds_name}" -n "${NAMESPACE}" \
        -o jsonpath='{.status.numberReady}' 2>/dev/null || echo "0")
      if [ "${ready:-0}" -ge "${desired}" ]; then
        log "✅ Image pre-pull complete — ${ready}/${desired} nodes warmed"
        break
      fi
      log "  Pre-pull: ${ready:-0}/${desired} nodes ready..."
      sleep 10
    done
  fi

  # Delete immediately (don't wait — pods will terminate on their own)
  kubectl delete daemonset "${ds_name}" -n "${NAMESPACE}" \
    --ignore-not-found --wait=false 2>/dev/null || true
}

# Evict any pods for DEPLOYMENT that landed on HEL1 nodes during the rolling
# update. After rollout completes there is no surge pressure, so the evicted
# pod reschedules onto FSN1 (the preferred node). Pods already on FSN1 are
# untouched. Runs wait_for_deployment again to confirm everything comes back up.
pin_deployment_to_fsn1() {
  local name="$1"

  # Find pods not on a node labelled rejourney.co/datacenter=fsn1.
  # Using the label (not a hardcoded hostname) means any FSN1 node qualifies
  # — adding a second FSN1 node requires no change here.
  fsn1_nodes="$(kubectl get nodes -l "rejourney.co/datacenter=fsn1" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' || true)"

  if [ -z "${fsn1_nodes}" ]; then
    log "No nodes with rejourney.co/datacenter=fsn1 found; skipping pin check for ${name}"
    return 0
  fi

  misplaced="$(kubectl get pods -n "${NAMESPACE}" -l "app=${name}" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.nodeName}{"\n"}{end}' \
    | awk -v nodes="${fsn1_nodes}" 'BEGIN{split(nodes,a); for(i in a) fsn1[a[i]]=1} !fsn1[$2]{print $1}' \
    || true)"

  if [ -z "${misplaced}" ]; then
    log "All ${name} pods on FSN1 ✓"
    return 0
  fi

  log "Evicting ${name} pods that landed on HEL1: ${misplaced}"
  for pod in ${misplaced}; do
    kubectl delete pod -n "${NAMESPACE}" "${pod}" --grace-period=30 --ignore-not-found
    wait_for_deployment "${name}"
    wait_for_deployment_ready_replicas "${name}"
  done
  wait_for_deployment "${name}"
  wait_for_deployment_ready_replicas "${name}"
}

postgres_primary_node() {
  kubectl get pod -n "${NAMESPACE}" \
    -l "cnpg.io/cluster=${CNPG_CLUSTER_NAME},cnpg.io/instanceRole=primary" \
    -o jsonpath='{.items[0].spec.nodeName}' 2>/dev/null || true
}

# API latency depends on API pods running on the same node as the current CNPG
# primary. The Deployment has a hard podAffinity for new pods; this post-rollout
# check corrects any older pods that were already running elsewhere.
pin_deployment_to_postgres_primary() {
  local name="$1"
  local primary_node
  primary_node="$(postgres_primary_node)"

  if [ -z "${primary_node}" ]; then
    echo "[deploy-release] ERROR: no CNPG primary node found; cannot pin ${name}" >&2
    exit 1
  fi

  misplaced="$(kubectl get pods -n "${NAMESPACE}" -l "app=${name}" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.nodeName}{"\n"}{end}' \
    | awk -v node="${primary_node}" '$2 != node {print $1}' \
    || true)"

  if [ -z "${misplaced}" ]; then
    log "All ${name} pods colocated with Postgres primary on ${primary_node} ✓"
    return 0
  fi

  log "Evicting ${name} pods not on Postgres primary node ${primary_node}: ${misplaced}"
  for pod in ${misplaced}; do
    kubectl delete pod -n "${NAMESPACE}" "${pod}" --grace-period=30 --ignore-not-found
    wait_for_deployment "${name}"
    wait_for_deployment_ready_replicas "${name}"
  done
  wait_for_deployment "${name}"
  wait_for_deployment_ready_replicas "${name}"
}

cleanup_finished_pods() {
  kubectl delete pods -n "${NAMESPACE}" --field-selector=status.phase==Succeeded --ignore-not-found >/dev/null 2>&1 || true
  kubectl delete pods -n "${NAMESPACE}" --field-selector=status.phase==Failed --ignore-not-found >/dev/null 2>&1 || true
}

cleanup_session_backup_jobs() {
  # Always remove session backup jobs on deploy so no old backup/seed run keeps
  # burning resources after rollout. This intentionally targets only app-level
  # session backup jobs, not CNPG/Postgres backup resources.
  section "Cleaning Session-Backup Jobs"
  log "Deleting all session-backup and session-backup-seed jobs..."

  local jobs_to_delete
  jobs_to_delete="$(
    kubectl get jobs -n "${NAMESPACE}" --no-headers -o custom-columns=":metadata.name" \
      | awk '/^session-backup-[0-9]/ || /^session-backup-seed-[0-9]/'
  )"

  if [ -z "${jobs_to_delete}" ]; then
    log "No session-backup jobs found."
    return
  fi

  while IFS= read -r job_name; do
    [ -z "${job_name}" ] && continue
    log "  Deleting job: ${job_name}"
    kubectl delete job "${job_name}" -n "${NAMESPACE}" --ignore-not-found || true
  done <<< "${jobs_to_delete}"
}

main() {
  require_bin kubectl
  require_bin perl
  require_bin python3

  section "Rendering Release"
  log "Repository: ${REPOSITORY}"
  log "Image tag: ${IMAGE_TAG}"
  log "ClickHouse deploy: ${DEPLOY_CLICKHOUSE}"
  log "ClickHouse rollup backfill: ${RUN_CLICKHOUSE_ROLLUP_BACKFILL}"
  render_manifests
  if clickhouse_rollup_backfill_enabled && ! clickhouse_deploy_enabled; then
    echo "[deploy-release] ERROR: RUN_CLICKHOUSE_ROLLUP_BACKFILL=true requires DEPLOY_CLICKHOUSE=true" >&2
    exit 1
  fi
  if ! clickhouse_deploy_enabled; then
    log "Skipping ClickHouse manifests (DEPLOY_CLICKHOUSE is not true)."
    remove_clickhouse_rendered_manifests
  fi

  section "Applying Cluster Prerequisites"
  kubectl apply -f "${K8S_DIR}/namespace.yaml"
  kubectl apply -f "${K8S_DIR}/traefik-config.yaml"
  ensure_cert_manager
  ensure_grafana_secret
  apply_unlabeled_support_manifests
  if clickhouse_deploy_enabled; then
    ensure_clickhouse_operator
    apply_clickhouse_manifests
  fi
  apply_cnpg_cluster_manifest

  # Wait for Postgres to finish its rolling restart (triggered by any parameter
  # changes in postgres-cnpg.yaml) BEFORE rolling the application deployments.
  # Previously this wait happened after the bulk apply, meaning CNPG restart +
  # all deployment rolling restarts fired simultaneously — CPU spike → Redis
  # Sentinel tilt → 504s. The barrier here ensures only one disruption at a time.
  wait_for_postgres

  # Pre-pull the new images onto every node BEFORE triggering the rolling update.
  # This prevents ContainerCreating stalls on nodes that don't have the image
  # cached (typically HEL1 nodes during surge), which previously caused the
  # rollout-wait to time out and CI to report failure.
  prepull_images

  bash "${ROOT_DIR}/scripts/k8s/check-archive-sync.sh"

  print_migration_status "before"

  # Roll shared data-plane app dependencies before migrations and before the
  # customer-facing Deployments move. CNPG is handled separately above; Redis is
  # Helm-owned and protected from prune below.
  apply_data_plane_manifests

  section "Resetting db-setup Job"
  log "Deleting old db-setup job..."
  kubectl delete job db-setup -n "${NAMESPACE}" --ignore-not-found --wait=true --timeout=120s || true
  kubectl delete pods -n "${NAMESPACE}" -l job-name=db-setup --ignore-not-found --wait=true --timeout=60s || true

  # Run migrations/bootstrap before applying app Deployments. This keeps API/web
  # pods on the old version until the schema is ready for the new version.
  apply_db_setup_job
  wait_for_job
  print_migration_status "after db-setup"

  if clickhouse_deploy_enabled; then
    section "Resetting clickhouse-setup Job"
    log "Deleting old clickhouse-setup job..."
    kubectl delete job clickhouse-setup -n "${NAMESPACE}" --ignore-not-found --wait=true --timeout=120s || true
    kubectl delete pods -n "${NAMESPACE}" -l job-name=clickhouse-setup --ignore-not-found --wait=true --timeout=60s || true

    apply_clickhouse_setup_job
    wait_for_clickhouse_setup_job

    if clickhouse_rollup_backfill_enabled; then
      section "Resetting clickhouse-backfill-api-rollups Job"
      log "Deleting old clickhouse-backfill-api-rollups job..."
      kubectl delete job clickhouse-backfill-api-rollups -n "${NAMESPACE}" --ignore-not-found --wait=true --timeout=120s || true
      kubectl delete pods -n "${NAMESPACE}" -l job-name=clickhouse-backfill-api-rollups --ignore-not-found --wait=true --timeout=60s || true

      apply_clickhouse_rollup_backfill_job
      wait_for_clickhouse_rollup_backfill_job
    else
      log "Skipping ClickHouse rollup backfill (RUN_CLICKHOUSE_ROLLUP_BACKFILL is not true)."
    fi

    remove_clickhouse_rendered_manifests
  fi

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
  protect_helm_managed_resources
  log "Applying rendered manifests..."
  kubectl apply -f "${RENDER_DIR}/" \
    --prune \
    -l app.kubernetes.io/part-of=rejourney \
    --prune-allowlist=core/v1/ConfigMap \
    --prune-allowlist=core/v1/ServiceAccount \
    --prune-allowlist=core/v1/Service \
    --prune-allowlist=apps/v1/Deployment \
    --prune-allowlist=apps/v1/StatefulSet \
    --prune-allowlist=networking.k8s.io/v1/Ingress \
    --prune-allowlist=traefik.io/v1alpha1/Middleware \
    --prune-allowlist=autoscaling/v2/HorizontalPodAutoscaler \
    --prune-allowlist=batch/v1/CronJob \
    --prune-allowlist=batch/v1/Job \
    --prune-allowlist=policy/v1/PodDisruptionBudget \
    --prune-allowlist=rbac.authorization.k8s.io/v1/Role \
    --prune-allowlist=rbac.authorization.k8s.io/v1/RoleBinding

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
  kubectl delete daemonset netdata -n "${NAMESPACE}" --ignore-not-found
  kubectl delete clusterrole netdata --ignore-not-found
  kubectl delete clusterrolebinding netdata --ignore-not-found
  kubectl delete serviceaccount netdata -n "${NAMESPACE}" --ignore-not-found

  wait_for_postgres
  wait_for_deployment pgbouncer
  wait_for_deployment pgbouncer-ro
  remove_legacy_postgres

  section "Waiting For Rollouts"
  # Critical user-facing services: 600s to absorb any residual image-pull delay
  # after the pre-pull step (e.g. a node was temporarily unavailable during pre-pull).
  wait_for_deployment api-ingest     600s
  pin_deployment_to_postgres_primary api-ingest
  wait_for_deployment api-dashboard  600s
  wait_for_deployment ingest-upload  600s
  pin_deployment_to_fsn1 ingest-upload
  wait_for_deployment web            600s
  pin_deployment_to_fsn1 web
  # Background workers — standard timeout is fine; they have no inbound traffic.
  wait_for_deployment ingest-worker
  wait_for_deployment replay-worker
  wait_for_deployment session-lifecycle-worker
  wait_for_deployment retention-worker
  wait_for_deployment alert-worker
  # Monitoring stack — not user-facing, standard timeout.
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

  cleanup_session_backup_jobs
  cleanup_finished_pods
  log "Release applied successfully for image tag ${IMAGE_TAG}"
}

main "$@"
