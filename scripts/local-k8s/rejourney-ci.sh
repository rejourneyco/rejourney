#!/bin/bash
# Local GitHub Actions parity runner for the k3d stack.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEFAULT_ENV_FILE="$ROOT_DIR/.env.k8s.local"
CI_BILLING_TEST_PATTERN="billing|Billing|renewal|Renewal|downgrade|Downgrade"
MODE="${1:-full}"
ENV_FILE="${2:-$DEFAULT_ENV_FILE}"

log() { echo "[local-k8s-ci] $1"; }
error() { echo "[local-k8s-ci] ERROR: $1" >&2; exit 1; }

usage() {
    cat <<EOF
Usage: $0 [full|fast|checks|deploy] [env-file]

Modes:
  full    Run the local CI-parity flow with fresh npm installs, image builds, local k8s deploy, migrations, and host restart.
  fast    Same as full, but skip npm reinstall steps and reuse the current node_modules state.
  checks  Run the GitHub Actions-like validation steps only.
  deploy  Rebuild/import/deploy the local k8s app stack without re-running the validation steps.
EOF
}

require_bin() {
    command -v "$1" >/dev/null 2>&1 || error "$1 is required"
}

warn_if_node_version_differs() {
    local node_major
    node_major="$(node -p "process.versions.node.split('.')[0]")"
    if [ "$node_major" != "24" ]; then
        log "WARNING: Local Node is v$node_major, but rejourney-ci uses Node 24."
    fi
}

load_env() {
    [ -f "$ENV_FILE" ] || error "Missing env file: $ENV_FILE"
    set -a
    source "$ENV_FILE"
    set +a
}

run_install_steps() {
    if [ "$MODE" = "fast" ] || [ "$MODE" = "deploy" ]; then
        log "Skipping npm ci steps in $MODE mode"
        return
    fi

    log "Installing backend dependencies (backend job parity)"
    (
        cd "$ROOT_DIR/backend"
        npm ci --ignore-scripts
    )

    log "Installing workspace dependencies (web job parity)"
    (
        cd "$ROOT_DIR"
        npm ci --ignore-scripts
    )
}

run_ci_checks() {
    if [ "$MODE" = "deploy" ]; then
        log "Skipping validation steps in deploy mode"
        return
    fi

    log "Running schema / migration guard"
    node "$ROOT_DIR/scripts/check-worker-parity.mjs"
    bash "$ROOT_DIR/scripts/check-schema-migration.sh"

    log "Running backend checks"
    (
        cd "$ROOT_DIR/backend"
        npm run lint --if-present
        npm test
        npm test -- --testNamePattern="$CI_BILLING_TEST_PATTERN" --reporter=verbose
        npx eslint src/services/stripe.ts src/services/stripeProducts.ts src/utils/billing.ts --max-warnings=0
    )

    log "Running web checks"
    (
        cd "$ROOT_DIR/dashboard/web-ui"
        ls -R app/shared/lib || true
        cat app/shared/lib/cn.ts || echo "shared lib cn.ts not found"
        npm run typecheck
        npm run build
    )
}

prepare_root_build_deps() {
    if [ "$MODE" = "fast" ] || [ "$MODE" = "deploy" ]; then
        log "Skipping root npm ci before Docker builds in $MODE mode"
        return
    fi

    log "Installing root dependencies for image-build parity"
    (
        cd "$ROOT_DIR"
        npm ci
    )
}

build_images() {
    log "Building API image"
    docker build -t rejourney-local/api:dev -f "$ROOT_DIR/backend/Dockerfile" "$ROOT_DIR"

    log "Building web image"
    docker build \
        -t rejourney-local/web:dev \
        -f "$ROOT_DIR/dashboard/web-ui/Dockerfile" \
        --build-arg "VITE_STRIPE_PUBLISHABLE_KEY=${VITE_STRIPE_PUBLISHABLE_KEY:-}" \
        --build-arg "VITE_MAPBOX_TOKEN=${VITE_MAPBOX_TOKEN:-}" \
        --build-arg "VITE_DASHBOARD_URL=${PUBLIC_DASHBOARD_URL:-http://rejourney.localtest.me}" \
        --build-arg "VITE_API_URL=${PUBLIC_API_URL:-http://api.localtest.me}" \
        --build-arg "VITE_DOCS_URL=${VITE_DOCS_URL:-http://rejourney.localtest.me/docs}" \
        --build-arg "VITE_TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY:-}" \
        "$ROOT_DIR"

    log "Building migration image"
    docker build -t rejourney-local/migration:dev -f "$ROOT_DIR/backend/Dockerfile.migration" "$ROOT_DIR"
}

import_images() {
    log "Importing images into k3d"
    k3d image import rejourney-local/api:dev -c rejourney-dev
    k3d image import rejourney-local/web:dev -c rejourney-dev
    k3d image import rejourney-local/migration:dev -c rejourney-dev
}

deploy_local_apps() {
    log "Refreshing local cluster app deployments"
    "$SCRIPT_DIR/deploy.sh" apps "$ENV_FILE"
}

restart_host_services() {
    log "Restarting host services for device testing"
    ENV_FILE="$ENV_FILE" "$SCRIPT_DIR/dev.sh" host-restart
}

stop_host_services() {
    log "Stopping host services before local CI parity run"
    ENV_FILE="$ENV_FILE" "$SCRIPT_DIR/dev.sh" down
}

run_full_like_flow() {
    require_bin docker
    require_bin k3d
    require_bin kubectl
    require_bin npm

    "$SCRIPT_DIR/update-ips.sh" "$ENV_FILE"
    load_env
    stop_host_services
    run_install_steps
    run_ci_checks
    prepare_root_build_deps
    build_images
    import_images
    deploy_local_apps
    restart_host_services
}

run_checks_only() {
    require_bin npm
    run_install_steps
    run_ci_checks
}

main() {
    case "$MODE" in
        full|fast|deploy|checks)
            ;;
        help|-h|--help)
            usage
            exit 0
            ;;
        *)
            usage
            exit 1
            ;;
    esac

    warn_if_node_version_differs

    case "$MODE" in
        checks)
            run_checks_only
            ;;
        full|fast|deploy)
            run_full_like_flow
            ;;
    esac
}

main "$@"
