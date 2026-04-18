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

APP_SECRET_ARGS=(
    --from-literal=JWT_SECRET="$JWT_SECRET"
    --from-literal=JWT_SIGNING_KEY="$JWT_SIGNING_KEY"
    --from-literal=INGEST_HMAC_SECRET="$INGEST_HMAC_SECRET"
    --from-literal=STORAGE_ENCRYPTION_KEY="$STORAGE_ENCRYPTION_KEY"
    --from-literal=SELF_HOSTED_MODE=false
)

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

create_or_update_secret app-secret "${APP_SECRET_ARGS[@]}"

if [ -n "${GITHUB_CLIENT_ID:-}" ] && [ -n "${GITHUB_CLIENT_SECRET:-}" ]; then
    create_or_update_secret oauth-secret \
        --from-literal=GITHUB_CLIENT_ID="$GITHUB_CLIENT_ID" \
        --from-literal=GITHUB_CLIENT_SECRET="$GITHUB_CLIENT_SECRET" \
        --from-literal=OAUTH_REDIRECT_BASE="${OAUTH_REDIRECT_BASE:-http://127.0.0.1:3000}"
fi

if [ -n "${STRIPE_SECRET_KEY:-}" ] || [ -n "${STRIPE_WEBHOOK_SECRET:-}" ] || [ -n "${VITE_STRIPE_PUBLISHABLE_KEY:-}" ]; then
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
