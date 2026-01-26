#!/bin/bash
# Sync .env file secrets to Kubernetes secrets
# Usage: ./scripts/k8s/k8s-sync-secrets.sh [prod|selfhosted] [.env-file-path]
#
# This script reads a .env file and creates/updates Kubernetes secrets
# for both production and self-hosted deployments.

set -e

NAMESPACE="rejourney"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }

# Check kubectl
if ! command -v kubectl &> /dev/null; then
    error "kubectl not found. Install K3s first: curl -sfL https://get.k3s.io | sh -"
fi

# Parse arguments
DEPLOYMENT_TYPE="${1:-selfhosted}"

if [ "$DEPLOYMENT_TYPE" != "prod" ] && [ "$DEPLOYMENT_TYPE" != "selfhosted" ]; then
    error "Invalid deployment type. Use 'prod' or 'selfhosted'"
fi

# Enforce correct .env file based on deployment type
if [ "$DEPLOYMENT_TYPE" = "prod" ]; then
    ENV_FILE="${2:-$ROOT_DIR/.env}"
    if [ ! -f "$ENV_FILE" ]; then
        error "Production .env file not found: $ENV_FILE"
        error "For production deployments, use: ./scripts/k8s/k8s-sync-secrets.sh prod [.env-file-path]"
    fi
else
    # Self-hosted should use .env.selfhosted
    ENV_FILE="${2:-$ROOT_DIR/.env.selfhosted}"
    if [ ! -f "$ENV_FILE" ]; then
        error "Self-hosted .env.selfhosted file not found: $ENV_FILE"
        error "For self-hosted deployments, use: ./scripts/k8s/k8s-sync-secrets.sh selfhosted [.env.selfhosted-file-path]"
    fi
fi

log "Syncing secrets from $ENV_FILE to Kubernetes ($DEPLOYMENT_TYPE mode)..."

# Source the env file (safely)
set -a
source "$ENV_FILE"
set +a

# Verify namespace exists
if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
    warn "Namespace '$NAMESPACE' does not exist. Creating it..."
    kubectl create namespace "$NAMESPACE"
fi

# Function to create or update secret
create_or_update_secret() {
    local secret_name=$1
    shift
    local args=("$@")
    
    if kubectl get secret "$secret_name" -n "$NAMESPACE" &> /dev/null; then
        log "Updating secret: $secret_name"
        kubectl delete secret "$secret_name" -n "$NAMESPACE" --ignore-not-found
    else
        log "Creating secret: $secret_name"
    fi
    
    kubectl create secret generic "$secret_name" \
        --namespace "$NAMESPACE" \
        "${args[@]}"
}

# 1. Database Secret
log "Creating postgres-secret..."
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-rejourney}"
create_or_update_secret postgres-secret \
    --from-literal=POSTGRES_USER=rejourney \
    --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    --from-literal=POSTGRES_DB=rejourney \
    --from-literal=DATABASE_URL="postgresql://rejourney:${POSTGRES_PASSWORD}@postgres:5432/rejourney"

# 2. Redis Secret
log "Creating redis-secret..."
create_or_update_secret redis-secret \
    --from-literal=REDIS_URL="${REDIS_URL:-redis://redis:6379/0}"

# 3. S3 Secret
log "Creating s3-secret..."
if [ -z "$S3_ENDPOINT" ]; then
    warn "S3_ENDPOINT not set in .env file. Skipping S3 secret."
else
    create_or_update_secret s3-secret \
        --from-literal=S3_ENDPOINT="${S3_ENDPOINT}" \
        --from-literal=S3_PUBLIC_ENDPOINT="${S3_PUBLIC_ENDPOINT:-$S3_ENDPOINT}" \
        --from-literal=S3_BUCKET="${S3_BUCKET:-rejourney}" \
        --from-literal=S3_REGION="${S3_REGION:-us-east-1}" \
        --from-literal=S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID}" \
        --from-literal=S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY}"
fi

# 4. App Secrets (Auth & Encryption)
log "Creating app-secret..."
if [ -z "$JWT_SECRET" ] || [ "$JWT_SECRET" = "generate_with_openssl_rand_hex_32" ]; then
    error "JWT_SECRET not set or still has placeholder value. Generate with: openssl rand -hex 32"
fi
if [ -z "$JWT_SIGNING_KEY" ] || [ "$JWT_SIGNING_KEY" = "generate_with_openssl_rand_hex_32" ]; then
    error "JWT_SIGNING_KEY not set or still has placeholder value. Generate with: openssl rand -hex 32"
fi
if [ -z "$INGEST_HMAC_SECRET" ] || [ "$INGEST_HMAC_SECRET" = "generate_with_openssl_rand_hex_32" ]; then
    error "INGEST_HMAC_SECRET not set or still has placeholder value. Generate with: openssl rand -hex 32"
fi
if [ -z "$STORAGE_ENCRYPTION_KEY" ] || [ "$STORAGE_ENCRYPTION_KEY" = "generate_with_openssl_rand_hex_32" ]; then
    error "STORAGE_ENCRYPTION_KEY not set or still has placeholder value. Generate with: openssl rand -hex 32"
fi

# Build app-secret args
APP_SECRET_ARGS=(
    --from-literal=JWT_SECRET="$JWT_SECRET"
    --from-literal=JWT_SIGNING_KEY="$JWT_SIGNING_KEY"
    --from-literal=INGEST_HMAC_SECRET="$INGEST_HMAC_SECRET"
    --from-literal=STORAGE_ENCRYPTION_KEY="$STORAGE_ENCRYPTION_KEY"
    --from-literal=SELF_HOSTED_MODE="$([ "$DEPLOYMENT_TYPE" = "selfhosted" ] && echo "true" || echo "false")"
)

# Add PUBLIC URLs to app-secret (for both prod and self-hosted deployments)
# These come from the .env file and are used by k8s deployments
if [ -n "$PUBLIC_DASHBOARD_URL" ]; then
    APP_SECRET_ARGS+=(--from-literal=PUBLIC_DASHBOARD_URL="$PUBLIC_DASHBOARD_URL")
fi
if [ -n "$PUBLIC_API_URL" ]; then
    APP_SECRET_ARGS+=(--from-literal=PUBLIC_API_URL="$PUBLIC_API_URL")
fi
if [ -n "$PUBLIC_INGEST_URL" ]; then
    APP_SECRET_ARGS+=(--from-literal=PUBLIC_INGEST_URL="$PUBLIC_INGEST_URL")
fi
if [ -n "$DASHBOARD_ORIGIN" ]; then
    APP_SECRET_ARGS+=(--from-literal=DASHBOARD_ORIGIN="$DASHBOARD_ORIGIN")
fi

create_or_update_secret app-secret "${APP_SECRET_ARGS[@]}"

# 5. OAuth Secret (Optional)
if [ -n "$GITHUB_CLIENT_ID" ] && [ -n "$GITHUB_CLIENT_SECRET" ]; then
    log "Creating oauth-secret..."
    OAUTH_REDIRECT="${OAUTH_REDIRECT_BASE:-}"
    if [ "$DEPLOYMENT_TYPE" = "prod" ]; then
        OAUTH_REDIRECT="${OAUTH_REDIRECT_BASE:-https://api.rejourney.co}"
    fi
    
    create_or_update_secret oauth-secret \
        --from-literal=GITHUB_CLIENT_ID="$GITHUB_CLIENT_ID" \
        --from-literal=GITHUB_CLIENT_SECRET="$GITHUB_CLIENT_SECRET" \
        --from-literal=OAUTH_REDIRECT_BASE="$OAUTH_REDIRECT" \
        $([ -n "$GOOGLE_CLIENT_ID" ] && echo "--from-literal=GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" || true) \
        $([ -n "$GOOGLE_CLIENT_SECRET" ] && echo "--from-literal=GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET" || true)
else
    info "OAuth secrets not provided, skipping oauth-secret"
fi

# 6. Stripe Secret (Production only, optional)
if [ "$DEPLOYMENT_TYPE" = "prod" ] && [ -n "$STRIPE_SECRET_KEY" ] && [ -n "$STRIPE_WEBHOOK_SECRET" ]; then
    log "Creating stripe-secret..."
    create_or_update_secret stripe-secret \
        --from-literal=STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
        --from-literal=STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET" \
        --from-literal=VITE_STRIPE_PUBLISHABLE_KEY="${VITE_STRIPE_PUBLISHABLE_KEY:-}"
else
    if [ "$DEPLOYMENT_TYPE" = "selfhosted" ]; then
        info "Stripe secrets skipped (self-hosted mode)"
    else
        info "Stripe secrets not provided, skipping stripe-secret"
    fi
fi

# 7. SMTP Secret (Optional)
if [ -n "$SMTP_HOST" ] && [ -n "$SMTP_USER" ] && [ -n "$SMTP_PASS" ]; then
    log "Creating smtp-secret..."
    create_or_update_secret smtp-secret \
        --from-literal=SMTP_HOST="$SMTP_HOST" \
        --from-literal=SMTP_PORT="${SMTP_PORT:-587}" \
        --from-literal=SMTP_USER="$SMTP_USER" \
        --from-literal=SMTP_PASS="$SMTP_PASS" \
        --from-literal=SMTP_FROM="${SMTP_FROM:-Rejourney <noreply@rejourney.co>}" \
        --from-literal=SMTP_SECURE="${SMTP_SECURE:-false}"
else
    info "SMTP secrets not provided, skipping smtp-secret"
fi

# 8. Turnstile Secret (Optional)
if [ -n "$TURNSTILE_SITE_KEY" ] && [ -n "$TURNSTILE_SECRET_KEY" ]; then
    log "Creating turnstile-secret..."
    create_or_update_secret turnstile-secret \
        --from-literal=TURNSTILE_SITE_KEY="$TURNSTILE_SITE_KEY" \
        --from-literal=TURNSTILE_SECRET_KEY="$TURNSTILE_SECRET_KEY"
else
    info "Turnstile secrets not provided, skipping turnstile-secret"
fi

# 11. Cloudflare R2 Backup Secret (PostgreSQL Backups)
if [ -n "$R2_ENDPOINT" ] && [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ]; then
    log "Creating r2-backup-secret..."
    create_or_update_secret r2-backup-secret \
        --from-literal=R2_ENDPOINT="$R2_ENDPOINT" \
        --from-literal=R2_BUCKET="${R2_BUCKET:-rejourney-backup}" \
        --from-literal=AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
        --from-literal=AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
else
    info "R2 backup credentials not provided, skipping r2-backup-secret"
fi

# 12. Monitoring Auth Secret (Uptime Kuma Basic Auth)
if [ -n "$MONITORING_AUTH_USERS" ]; then
    log "Creating monitoring-auth-secret..."
    create_or_update_secret monitoring-auth-secret \
        --from-literal=users="$MONITORING_AUTH_USERS"
else
    info "MONITORING_AUTH_USERS not provided, skipping monitoring-auth-secret"
fi

# 13. Monitoring Tokens (Worker heartbeat tokens)
if [ -n "$MONITORING_TOKENS" ] || [ -n "$MONITORING_DEBUG_TOKEN" ]; then
    log "Creating monitoring-tokens..."
    ARGS=()
    if [ -n "$MONITORING_TOKENS" ]; then
        ARGS+=(--from-literal=tokens="$MONITORING_TOKENS")
    fi
    if [ -n "$MONITORING_DEBUG_TOKEN" ]; then
        ARGS+=(--from-literal=debug-token="$MONITORING_DEBUG_TOKEN")
    fi
    create_or_update_secret monitoring-tokens "${ARGS[@]}"
else
    info "Monitoring tokens not provided, skipping monitoring-tokens"
fi

# 14. Traefik Dashboard Auth Secret (kube-system namespace)
if [ -n "$TRAEFIK_DASHBOARD_AUTH_USERS" ]; then
    log "Creating traefik-dashboard-auth-secret in kube-system..."
    # Custom function for kube-system
    kubectl delete secret traefik-dashboard-auth-secret -n kube-system --ignore-not-found
    kubectl create secret generic traefik-dashboard-auth-secret \
        --namespace kube-system \
        --from-literal=users="$TRAEFIK_DASHBOARD_AUTH_USERS"
else
    info "TRAEFIK_DASHBOARD_AUTH_USERS not provided, skipping traefik-dashboard-auth-secret"
fi

log "✅ Secrets synced successfully!"
echo ""
info "Summary of secrets created:"
kubectl get secrets -n "$NAMESPACE" | grep -v 'default-token' | grep -v 'NAME'
echo ""
info "Next steps:"
echo "  1. Create ghcr-secret manually (see above)"
echo "  2. Deploy with: ./scripts/k8s/deploy.sh deploy"
echo "  3. Run migrations: ./scripts/k8s/deploy.sh migrate"
