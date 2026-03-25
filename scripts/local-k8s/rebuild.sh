#!/bin/bash
# Local CI-parity rebuild: run the same validation/build flow as rejourney-ci,
# refresh cluster images/manifests, then restart host services for device testing
# without deleting local data.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env.k8s.local}"
CLUSTER_NAME="rejourney-dev"
CI_BILLING_TEST_PATTERN="billing|Billing|renewal|Renewal|downgrade|Downgrade"

log() { echo "[local-k8s] $1"; }
error() { echo "[local-k8s] ERROR: $1" >&2; exit 1; }

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

run_ci_checks() {
    log "Running CI-parity checks"

    npm ci --ignore-scripts
    bash "$ROOT_DIR/scripts/check-schema-migration.sh"

    (
        cd "$ROOT_DIR/backend"
        npm run lint --if-present
        npm test
        npm test -- --testNamePattern="$CI_BILLING_TEST_PATTERN" --reporter=verbose
        npx eslint src/services/stripe.ts src/services/stripeProducts.ts src/utils/billing.ts --max-warnings=0
    )

    (
        cd "$ROOT_DIR/dashboard/web-ui"
        npm run typecheck
        npm run build
    )
}

run_image_build_setup() {
    log "Installing root dependencies for image parity"
    npm ci
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
        --build-arg "VITE_TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY:-}" \
        "$ROOT_DIR"

    log "Building migration image"
    docker build -t rejourney-local/migration:dev -f "$ROOT_DIR/backend/Dockerfile.migration" "$ROOT_DIR"
}

import_images() {
    log "Importing images into k3d"
    k3d image import rejourney-local/api:dev -c "$CLUSTER_NAME"
    k3d image import rejourney-local/web:dev -c "$CLUSTER_NAME"
    k3d image import rejourney-local/migration:dev -c "$CLUSTER_NAME"
}

main() {
    require_bin docker
    require_bin k3d
    require_bin kubectl
    require_bin npm
    warn_if_node_version_differs

    "$SCRIPT_DIR/update-ips.sh" "$ENV_FILE"
    load_env

    log "Stopping host services before CI-parity rebuild"
    ENV_FILE="$ENV_FILE" "$SCRIPT_DIR/dev.sh" down

    run_ci_checks
    run_image_build_setup
    build_images
    import_images

    log "Refreshing local cluster app deployments"
    "$SCRIPT_DIR/deploy.sh" apps "$ENV_FILE"

    log "Restarting host services for device testing"
    ENV_FILE="$ENV_FILE" "$SCRIPT_DIR/dev.sh" host-restart
}

main "$@"
