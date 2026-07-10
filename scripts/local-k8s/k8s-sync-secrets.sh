#!/bin/bash
# Sync .env.k8s.local into local Kubernetes secrets.

set -euo pipefail

NAMESPACE="rejourney-local"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env.k8s.local}"
EXPECTED_CONTEXT="k3d-rejourney-dev"

log() { echo "[local-k8s] $1"; }
error() { echo "[local-k8s] ERROR: $1" >&2; exit 1; }

require_context() {
    local context
    context="$(kubectl config current-context 2>/dev/null || true)"
    if [ "$context" != "$EXPECTED_CONTEXT" ]; then
        error "Current kubectl context is '$context'. Expected '$EXPECTED_CONTEXT'."
    fi
}

require_file() {
    [ -f "$1" ] || error "Missing file: $1"
}

create_or_update_secret() {
    local name="$1"
    shift

    kubectl delete secret "$name" -n "$NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
    kubectl create secret generic "$name" -n "$NAMESPACE" "$@"
}

command -v kubectl >/dev/null 2>&1 || error "kubectl is required"

require_file "$ENV_FILE"
require_context

set -a
source "$ENV_FILE"
set +a

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_REGION:?S3_REGION is required}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"
: "${JWT_SECRET:?JWT_SECRET is required}"
: "${JWT_SIGNING_KEY:?JWT_SIGNING_KEY is required}"
: "${INGEST_HMAC_SECRET:?INGEST_HMAC_SECRET is required}"
: "${STORAGE_ENCRYPTION_KEY:?STORAGE_ENCRYPTION_KEY is required}"

if [ -n "${SUPERWALL_API_KEY_ENCRYPTION_KEY:-}" ] && ! [[ "$SUPERWALL_API_KEY_ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
    error "SUPERWALL_API_KEY_ENCRYPTION_KEY must be 64 hex characters when set. Generate with: openssl rand -hex 32"
fi
if [ -n "${REVENUECAT_API_KEY_ENCRYPTION_KEY:-}" ] && ! [[ "$REVENUECAT_API_KEY_ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
    error "REVENUECAT_API_KEY_ENCRYPTION_KEY must be 64 hex characters when set. Generate with: openssl rand -hex 32"
fi

kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || kubectl create namespace "$NAMESPACE" >/dev/null

log "Syncing local secrets from $ENV_FILE"

create_or_update_secret postgres-secret \
    --from-literal=POSTGRES_USER="$POSTGRES_USER" \
    --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    --from-literal=POSTGRES_DB="$POSTGRES_DB" \
    --from-literal=DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
    --from-literal=PGBOUNCER_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@pgbouncer:5432/${POSTGRES_DB}"

create_or_update_secret redis-secret \
    --from-literal=REDIS_URL="redis://redis:6379/0"

create_or_update_secret clickhouse-secret \
    --from-literal=CLICKHOUSE_ENABLED="${CLICKHOUSE_ENABLED:-true}" \
    --from-literal=CLICKHOUSE_DUAL_WRITE_ENABLED="${CLICKHOUSE_DUAL_WRITE_ENABLED:-true}" \
    --from-literal=CLICKHOUSE_READS_ENABLED="${CLICKHOUSE_READS_ENABLED:-true}" \
    --from-literal=CLICKHOUSE_URL="${CLICKHOUSE_K8S_URL:-http://clickhouse:8123}" \
    --from-literal=CLICKHOUSE_USER="${CLICKHOUSE_USER:-rejourney}" \
    --from-literal=CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-rejourney}" \
    --from-literal=CLICKHOUSE_DATABASE="${CLICKHOUSE_DATABASE:-rejourney}"

create_or_update_secret s3-secret \
    --from-literal=S3_ENDPOINT="http://minio:9000" \
    --from-literal=S3_PUBLIC_ENDPOINT="${S3_PUBLIC_ENDPOINT:-http://127.0.0.1:9000}" \
    --from-literal=S3_BUCKET="$S3_BUCKET" \
    --from-literal=S3_REGION="$S3_REGION" \
    --from-literal=S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
    --from-literal=S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"

create_or_update_secret minio-secret \
    --from-literal=MINIO_ROOT_USER="$S3_ACCESS_KEY_ID" \
    --from-literal=MINIO_ROOT_PASSWORD="$S3_SECRET_ACCESS_KEY"

create_or_update_secret research-lake-secret \
    --from-literal=RESEARCH_LAKE_ENABLED="${RESEARCH_LAKE_ENABLED:-false}" \
    --from-literal=RESEARCH_LAKE_ENDPOINT="${RESEARCH_LAKE_ENDPOINT:-http://minio:9000}" \
    --from-literal=RESEARCH_LAKE_BUCKET="${RESEARCH_LAKE_BUCKET:-rejourney-research-lake-local}" \
    --from-literal=RESEARCH_LAKE_REGION="${RESEARCH_LAKE_REGION:-$S3_REGION}" \
    --from-literal=RESEARCH_LAKE_ACCESS_KEY_ID="${RESEARCH_LAKE_ACCESS_KEY_ID:-$S3_ACCESS_KEY_ID}" \
    --from-literal=RESEARCH_LAKE_SECRET_ACCESS_KEY="${RESEARCH_LAKE_SECRET_ACCESS_KEY:-$S3_SECRET_ACCESS_KEY}" \
    --from-literal=RESEARCH_LAKE_HASH_SECRET="${RESEARCH_LAKE_HASH_SECRET:-$JWT_SECRET}"

if [ "${SHARE_LINK_SECRET:-}" = "generate_with_openssl_rand_hex_32" ] \
    || [ "${SHARE_LINK_SECRET:-}" = "generate_with_openssl_rand_base64_48" ] \
    || [ "${SHARE_LINK_SECRET:-}" = "replace_with_openssl_rand_hex_32" ] \
    || [ "${SHARE_LINK_SECRET:-}" = "replace_with_openssl_rand_base64_48" ]; then
    SHARE_LINK_SECRET=""
fi

APP_SECRET_ARGS=(
    --from-literal=JWT_SECRET="$JWT_SECRET"
    --from-literal=JWT_SIGNING_KEY="$JWT_SIGNING_KEY"
    --from-literal=INGEST_HMAC_SECRET="$INGEST_HMAC_SECRET"
    --from-literal=STORAGE_ENCRYPTION_KEY="$STORAGE_ENCRYPTION_KEY"
    --from-literal=SHARE_LINK_SECRET="${SHARE_LINK_SECRET:-$JWT_SECRET}"
    --from-literal=SELF_HOSTED_MODE=false
)

if [ -n "${SUPERWALL_API_KEY_ENCRYPTION_KEY:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=SUPERWALL_API_KEY_ENCRYPTION_KEY="$SUPERWALL_API_KEY_ENCRYPTION_KEY")
fi
if [ -n "${REVENUECAT_API_KEY_ENCRYPTION_KEY:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=REVENUECAT_API_KEY_ENCRYPTION_KEY="$REVENUECAT_API_KEY_ENCRYPTION_KEY")
fi

if [ -n "${PUBLIC_DASHBOARD_URL:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=PUBLIC_DASHBOARD_URL="$PUBLIC_DASHBOARD_URL")
fi
if [ -n "${PUBLIC_API_URL:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=PUBLIC_API_URL="$PUBLIC_API_URL")
fi
if [ -n "${PUBLIC_INGEST_URL:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=PUBLIC_INGEST_URL="$PUBLIC_INGEST_URL")
fi
if [ -n "${DASHBOARD_ORIGIN:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=DASHBOARD_ORIGIN="$DASHBOARD_ORIGIN")
fi
if [ -n "${ADDITIONAL_DASHBOARD_ORIGINS:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=ADDITIONAL_DASHBOARD_ORIGINS="$ADDITIONAL_DASHBOARD_ORIGINS")
fi
if [ -n "${QUERY_BUILDER_KEY:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=QUERY_BUILDER_KEY="$QUERY_BUILDER_KEY")
fi
if [ -n "${QUERY_BUILDER_MODEL:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=QUERY_BUILDER_MODEL="$QUERY_BUILDER_MODEL")
fi
APP_SECRET_ARGS+=(--from-literal=SHOW_ISSUE_DETECTION_UI="${SHOW_ISSUE_DETECTION_UI:-false}")
if [ -n "${ISSUE_DETECTION_API_URL:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=ISSUE_DETECTION_API_URL="$ISSUE_DETECTION_API_URL")
fi
if [ -n "${ISSUE_DETECTION_SERVICE_SECRET:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=ISSUE_DETECTION_SERVICE_SECRET="$ISSUE_DETECTION_SERVICE_SECRET")
fi
if [ -n "${GITHUB_APP_SLUG:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=GITHUB_APP_SLUG="$GITHUB_APP_SLUG")
fi
if [ -n "${GITHUB_APP_STATE_SECRET:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=GITHUB_APP_STATE_SECRET="$GITHUB_APP_STATE_SECRET")
fi
if [ -n "${REJOURNEY_INTERNAL_API_URL:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=REJOURNEY_INTERNAL_API_URL="$REJOURNEY_INTERNAL_API_URL")
fi
if [ -n "${REJOURNEY_INTERNAL_SERVICE_SECRET:-}" ]; then
    APP_SECRET_ARGS+=(--from-literal=REJOURNEY_INTERNAL_SERVICE_SECRET="$REJOURNEY_INTERNAL_SERVICE_SECRET")
fi

create_or_update_secret app-secret "${APP_SECRET_ARGS[@]}"

if [ -n "${GITHUB_CLIENT_ID:-}" ] && [ -n "${GITHUB_CLIENT_SECRET:-}" ]; then
    create_or_update_secret oauth-secret \
        --from-literal=GITHUB_CLIENT_ID="$GITHUB_CLIENT_ID" \
        --from-literal=GITHUB_CLIENT_SECRET="$GITHUB_CLIENT_SECRET" \
        --from-literal=OAUTH_REDIRECT_BASE="${OAUTH_REDIRECT_BASE:-http://127.0.0.1:3000}"
fi

if [ -n "${STRIPE_SECRET_KEY:-}" ] \
    || [ -n "${STRIPE_WEBHOOK_SECRET:-}" ] \
    || [ -n "${VITE_STRIPE_PUBLISHABLE_KEY:-}" ]; then
    create_or_update_secret stripe-secret \
        --from-literal=STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-}" \
        --from-literal=STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-}" \
        --from-literal=VITE_STRIPE_PUBLISHABLE_KEY="${VITE_STRIPE_PUBLISHABLE_KEY:-}"
fi

if [ -n "${VITE_MAPBOX_TOKEN:-}" ]; then
    create_or_update_secret mapbox-secret \
        --from-literal=VITE_MAPBOX_TOKEN="$VITE_MAPBOX_TOKEN"
fi

if [ -n "${TURNSTILE_SITE_KEY:-}" ] || [ -n "${TURNSTILE_SECRET_KEY:-}" ]; then
    create_or_update_secret turnstile-secret \
        --from-literal=TURNSTILE_SITE_KEY="${TURNSTILE_SITE_KEY:-}" \
        --from-literal=TURNSTILE_SECRET_KEY="${TURNSTILE_SECRET_KEY:-}"
fi

if [ -n "${SMTP_HOST:-}" ] && [ -n "${SMTP_USER:-}" ] && [ -n "${SMTP_PASS:-}" ]; then
    create_or_update_secret smtp-secret \
        --from-literal=SMTP_HOST="$SMTP_HOST" \
        --from-literal=SMTP_PORT="${SMTP_PORT:-587}" \
        --from-literal=SMTP_USER="$SMTP_USER" \
        --from-literal=SMTP_PASS="$SMTP_PASS" \
        --from-literal=SMTP_FROM="${SMTP_FROM:-}" \
        --from-literal=SMTP_SECURE="${SMTP_SECURE:-false}"
fi

log "Local secrets synced successfully."
