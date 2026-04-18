#!/bin/bash
# Local Kubernetes deployment helper.

set -euo pipefail

NAMESPACE="rejourney-local"
CLUSTER_NAME="rejourney-dev"
EXPECTED_CONTEXT="k3d-${CLUSTER_NAME}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCAL_K8S_DIR="$ROOT_DIR/local-k8s"
ENV_FILE="${2:-$ROOT_DIR/.env.k8s.local}"

log() { echo "[local-k8s] $1"; }
error() { echo "[local-k8s] ERROR: $1" >&2; exit 1; }

dump_db_setup_diagnostics() {
    kubectl describe job db-setup -n "$NAMESPACE" || true
    kubectl logs job/db-setup -n "$NAMESPACE" -c wait-postgres --tail=50 || true
    kubectl logs job/db-setup -n "$NAMESPACE" -c setup --tail=100 || true
}

wait_for_db_setup() {
    local deadline
    deadline=$(( $(date +%s) + 240 ))

    while true; do
        local succeeded failed
        succeeded="$(kubectl get job db-setup -n "$NAMESPACE" -o jsonpath='{.status.succeeded}' 2>/dev/null || true)"
        failed="$(kubectl get job db-setup -n "$NAMESPACE" -o jsonpath='{.status.failed}' 2>/dev/null || true)"

        succeeded="${succeeded:-0}"
        failed="${failed:-0}"

        if [ "$succeeded" = "1" ]; then
            return 0
        fi

        if [ "$failed" != "0" ]; then
            dump_db_setup_diagnostics
            error "db-setup failed"
        fi

        if [ "$(date +%s)" -ge "$deadline" ]; then
            dump_db_setup_diagnostics
            error "db-setup timed out"
        fi

        sleep 5
    done
}

check_local_db_setup_compatibility() {
    local postgres_pod
    local state
    local migration_count
    local legacy_marker

    postgres_pod="$(kubectl get pods -n "$NAMESPACE" -l app=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    [ -n "$postgres_pod" ] || return 0

    state="$(kubectl exec -n "$NAMESPACE" "$postgres_pod" -- \
        psql -U rejourney -d rejourney -At -F $'\t' \
        -c "select case when to_regclass('drizzle.__drizzle_migrations') is null then -1 else (select count(*) from drizzle.__drizzle_migrations) end; select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'teams' and column_name = 'retention_tier');" \
        2>/dev/null || true)"

    migration_count="$(echo "$state" | sed -n '1p')"
    legacy_marker="$(echo "$state" | sed -n '2p')"

    if [ "$legacy_marker" = "t" ] && { [ "$migration_count" = "-1" ] || [ "$migration_count" = "0" ]; }; then
        error "Legacy local PostgreSQL detected: schema exists but drizzle migration history is empty. This local DB was created with the old push-based flow. Run './scripts/local-k8s/deploy.sh down' once to recreate the namespace and database, then rerun your ci:local command."
    fi
}

require_bin() {
    command -v "$1" >/dev/null 2>&1 || error "$1 is required"
}

ensure_context() {
    local context
    context="$(kubectl config current-context 2>/dev/null || true)"
    if [ "$context" != "$EXPECTED_CONTEXT" ]; then
        kubectl config use-context "$EXPECTED_CONTEXT" >/dev/null 2>&1 || error "Expected kubectl context '$EXPECTED_CONTEXT'"
    fi
}

cluster_exists() {
    k3d cluster list 2>/dev/null | awk '{print $1}' | grep -qx "$CLUSTER_NAME"
}

create_cluster() {
    if cluster_exists; then
        log "k3d cluster '$CLUSTER_NAME' already exists"
        return
    fi

    log "Creating k3d cluster '$CLUSTER_NAME'"
    k3d cluster create "$CLUSTER_NAME" \
        --wait \
        -p "80:80@loadbalancer" \
        -p "443:443@loadbalancer" \
        -p "5432:30432@server:0" \
        -p "6379:30379@server:0" \
        -p "9000:30900@server:0" \
        -p "9001:30901@server:0"
}

apply_file() {
    kubectl apply -f "$1"
}

wait_infra() {
    kubectl wait --for=condition=ready pod -l app=postgres -n "$NAMESPACE" --timeout=180s
    # Deployments can briefly run two pods during a rolling update; `kubectl wait` on every
    # pod then blocks on the terminating replica. Rollout status waits for the deployment to finish.
    kubectl rollout status deployment/redis -n "$NAMESPACE" --timeout=180s
    kubectl rollout status deployment/minio -n "$NAMESPACE" --timeout=180s
    kubectl wait --for=condition=complete job/minio-setup -n "$NAMESPACE" --timeout=180s || true
}

wait_full() {
    kubectl wait --for=condition=available deployment/api -n "$NAMESPACE" --timeout=240s
    kubectl wait --for=condition=available deployment/ingest-upload -n "$NAMESPACE" --timeout=240s
    kubectl wait --for=condition=available deployment/web -n "$NAMESPACE" --timeout=240s
    kubectl wait --for=condition=available deployment/ingest-worker -n "$NAMESPACE" --timeout=240s
    kubectl wait --for=condition=available deployment/replay-worker -n "$NAMESPACE" --timeout=240s
    kubectl wait --for=condition=available deployment/session-lifecycle-worker -n "$NAMESPACE" --timeout=240s
    kubectl wait --for=condition=available deployment/retention-worker -n "$NAMESPACE" --timeout=240s
    kubectl wait --for=condition=available deployment/alert-worker -n "$NAMESPACE" --timeout=240s
    wait_for_db_setup
}

apply_apps() {
    kubectl delete job db-setup -n "$NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
    apply_file "$LOCAL_K8S_DIR/api.yaml"
    apply_file "$LOCAL_K8S_DIR/web.yaml"
    apply_file "$LOCAL_K8S_DIR/workers.yaml"
    apply_file "$LOCAL_K8S_DIR/ingress.yaml"

    kubectl rollout restart deployment/api -n "$NAMESPACE" >/dev/null 2>&1 || true
    kubectl rollout restart deployment/ingest-upload -n "$NAMESPACE" >/dev/null 2>&1 || true
    kubectl rollout restart deployment/web -n "$NAMESPACE" >/dev/null 2>&1 || true
    kubectl rollout restart deployment/ingest-worker -n "$NAMESPACE" >/dev/null 2>&1 || true
    kubectl rollout restart deployment/replay-worker -n "$NAMESPACE" >/dev/null 2>&1 || true
    kubectl rollout restart deployment/session-lifecycle-worker -n "$NAMESPACE" >/dev/null 2>&1 || true
    kubectl rollout restart deployment/retention-worker -n "$NAMESPACE" >/dev/null 2>&1 || true
    kubectl rollout restart deployment/alert-worker -n "$NAMESPACE" >/dev/null 2>&1 || true

    wait_full
}

init() {
    require_bin kubectl
    require_bin k3d
    require_bin docker
    create_cluster
    ensure_context
    apply_file "$LOCAL_K8S_DIR/namespace.yaml"
    log "Cluster and namespace are ready."
}

sync_secrets() {
    if [ ! -f "$ENV_FILE" ]; then
        error "Missing env file: $ENV_FILE"
    fi
    "$SCRIPT_DIR/k8s-sync-secrets.sh" "$ENV_FILE"
}

infra() {
    init
    sync_secrets
    apply_file "$LOCAL_K8S_DIR/postgres.yaml"
    apply_file "$LOCAL_K8S_DIR/redis.yaml"
    kubectl delete job minio-setup -n "$NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
    apply_file "$LOCAL_K8S_DIR/minio.yaml"
    wait_infra
    apply_file "$LOCAL_K8S_DIR/pgbouncer.yaml"
    kubectl rollout status deployment/pgbouncer -n "$NAMESPACE" --timeout=60s
    log "Local infra is ready."
}

full() {
    infra
    "$SCRIPT_DIR/rebuild.sh" "$ENV_FILE"
    log "Full local stack is ready."
}

apps() {
    infra
    check_local_db_setup_compatibility
    apply_apps
    log "Local app deployments are ready."
}

status() {
    ensure_context
    kubectl get pods -n "$NAMESPACE" -o wide
    echo ""
    kubectl get svc -n "$NAMESPACE"
    echo ""
    kubectl get ingress -n "$NAMESPACE" 2>/dev/null || true
}

logs() {
    ensure_context
    local target="${2:-api}"
    case "$target" in
        postgres)
            kubectl logs -f statefulset/postgres -n "$NAMESPACE" --tail=100
            ;;
        redis|minio|web|api|ingest-upload|ingest-worker|replay-worker|session-lifecycle-worker|retention-worker|alert-worker)
            kubectl logs -f deployment/"$target" -n "$NAMESPACE" --tail=100
            ;;
        db-setup|minio-setup)
            kubectl logs -f job/"$target" -n "$NAMESPACE" --tail=100
            ;;
        *)
            error "Unknown log target: $target"
            ;;
    esac
}

down() {
    ensure_context
    kubectl delete namespace "$NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
    log "Deleted namespace '$NAMESPACE'."
}

case "${1:-help}" in
    init)
        init
        ;;
    infra)
        infra
        ;;
    full)
        full
        ;;
    apps)
        apps
        ;;
    status)
        status
        ;;
    logs)
        logs "$@"
        ;;
    down)
        down
        ;;
    sync-secrets)
        init
        sync_secrets
        ;;
    *)
        echo "Usage: $0 {init|infra|apps|full|status|logs|down|sync-secrets} [env-file-or-target]"
        exit 1
        ;;
esac
