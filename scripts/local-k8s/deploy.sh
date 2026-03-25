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
    kubectl wait --for=condition=ready pod -l app=redis -n "$NAMESPACE" --timeout=120s
    kubectl wait --for=condition=ready pod -l app=minio -n "$NAMESPACE" --timeout=120s
    kubectl wait --for=condition=complete job/minio-setup -n "$NAMESPACE" --timeout=180s || true
}

wait_full() {
    kubectl wait --for=condition=available deployment/api -n "$NAMESPACE" --timeout=240s
    kubectl wait --for=condition=available deployment/ingest-upload -n "$NAMESPACE" --timeout=240s
    kubectl wait --for=condition=available deployment/web -n "$NAMESPACE" --timeout=240s
    kubectl wait --for=condition=available deployment/ingest-worker -n "$NAMESPACE" --timeout=240s
    kubectl wait --for=condition=available deployment/retention-worker -n "$NAMESPACE" --timeout=240s
    kubectl wait --for=condition=available deployment/alert-worker -n "$NAMESPACE" --timeout=240s
    kubectl wait --for=condition=complete job/db-setup -n "$NAMESPACE" --timeout=240s || true
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

sync_storage_endpoint() {
    if [ ! -f "$ENV_FILE" ]; then
        error "Missing env file: $ENV_FILE"
    fi

    (
        cd "$ROOT_DIR/backend"
        set -a
        source "$ENV_FILE"
        set +a
        node --import tsx scripts/syncLocalStorageEndpoint.ts
    )
}

infra() {
    init
    sync_secrets
    apply_file "$LOCAL_K8S_DIR/postgres.yaml"
    apply_file "$LOCAL_K8S_DIR/redis.yaml"
    kubectl delete job minio-setup -n "$NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
    apply_file "$LOCAL_K8S_DIR/minio.yaml"
    wait_infra
    log "Local infra is ready."
}

full() {
    infra
    "$SCRIPT_DIR/rebuild.sh" "$ENV_FILE"
    log "Full local stack is ready."
}

apps() {
    infra
    apply_apps
    sync_storage_endpoint
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
        redis|minio|web|api|ingest-upload|ingest-worker|retention-worker|alert-worker)
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
