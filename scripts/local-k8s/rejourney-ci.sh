#!/bin/bash
# Local GitHub Actions parity runner for the k3d stack.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEFAULT_ENV_FILE="$ROOT_DIR/.env.k8s.local"
CI_BILLING_TEST_PATTERN="billing|Billing|renewal|Renewal|downgrade|Downgrade"
K3D_IMAGE_IMPORT_MODE="${K3D_IMAGE_IMPORT_MODE:-tools-node}"
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

clean_macos_metadata() {
    local dir="$1"
    find "$ROOT_DIR/node_modules" "$dir/node_modules" -name .DS_Store -delete 2>/dev/null || true
}

remove_node_modules_path() {
    local path="$1"
    local attempt

    for attempt in 1 2 3 4 5; do
        [ -d "$path" ] || return 0

        find "$path" -name .DS_Store -delete 2>/dev/null || true
        chmod -R u+w "$path" 2>/dev/null || true
        rm -rf "$path" 2>/dev/null || true

        [ -d "$path" ] || return 0
        sleep 0.5
    done

    if ! rm -rf "$path"; then
        error "Failed to remove $path after repeated attempts"
    fi

    [ ! -d "$path" ] || error "Failed to remove $path after repeated attempts"
}

remove_node_modules_before_ci() {
    local dir="$1"
    local root_node_modules="$ROOT_DIR/node_modules"
    local dir_node_modules="$dir/node_modules"

    if [ -d "$root_node_modules" ] || [ -d "$dir_node_modules" ]; then
        log "Removing existing node_modules before npm ci in $dir"
        remove_node_modules_path "$root_node_modules"

        if [ "$dir_node_modules" != "$root_node_modules" ]; then
            remove_node_modules_path "$dir_node_modules"
        fi
    fi
}

npm_ci() {
    local dir="$1"
    shift
    local attempt
    local cleaner_pid
    local status

    remove_node_modules_before_ci "$dir"

    for attempt in 1 2 3; do
        clean_macos_metadata "$dir"
        (
            while true; do
                clean_macos_metadata "$dir"
                sleep 0.2
            done
        ) &
        cleaner_pid="$!"

        if (
            cd "$dir"
            npm ci "$@"
        ); then
            kill "$cleaner_pid" >/dev/null 2>&1 || true
            wait "$cleaner_pid" 2>/dev/null || true
            clean_macos_metadata "$dir"
            return
        fi
        status="$?"

        kill "$cleaner_pid" >/dev/null 2>&1 || true
        wait "$cleaner_pid" 2>/dev/null || true

        if [ "$attempt" != "3" ]; then
            log "npm ci failed in $dir; cleaning macOS metadata and retrying"
            clean_macos_metadata "$dir"
        fi
    done

    return "$status"
}

use_node24_if_available() {
    local node_major=""
    node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || true)"
    if [ "$node_major" = "24" ]; then
        return
    fi

    if command -v fnm >/dev/null 2>&1; then
        eval "$(fnm env --shell bash)"
        fnm use 24 --install-if-missing --silent-if-unchanged >/dev/null 2>&1 || true
        hash -r
    fi
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
    npm_ci "$ROOT_DIR/backend" --ignore-scripts

    log "Installing workspace dependencies (web job parity)"
    npm_ci "$ROOT_DIR" --ignore-scripts
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

    log "Running web SDK checks"
    (
        cd "$ROOT_DIR/packages/browser"
        npm run typecheck
        npm test
        npm run prepack
    )

    log "Running dashboard web checks"
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
    npm_ci "$ROOT_DIR"
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
    log "Ensuring local k3d cluster is ready for image import"
    "$SCRIPT_DIR/deploy.sh" init "$ENV_FILE"

    log "Importing images into k3d using $K3D_IMAGE_IMPORT_MODE mode"
    k3d image import --mode "$K3D_IMAGE_IMPORT_MODE" -c rejourney-dev \
        rejourney-local/api:dev \
        rejourney-local/web:dev \
        rejourney-local/migration:dev
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

    use_node24_if_available
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
