#!/bin/bash
# ============================================================
# Rejourney Self-Hosted Deployment Script
# ============================================================
# Deploys Rejourney with:
#   - Automatic HTTPS via Traefik + Let's Encrypt
#   - Secure auto-generated passwords
#   - No exposed internal ports
#
# Usage:
#   ./scripts/selfhosted/deploy.sh          # Interactive setup
#   ./scripts/selfhosted/deploy.sh update   # Update images
#   ./scripts/selfhosted/deploy.sh status   # Check status
#   ./scripts/selfhosted/deploy.sh logs     # View logs
#   ./scripts/selfhosted/deploy.sh stop     # Stop all services
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.selfhosted.yml"
ENV_FILE="$ROOT_DIR/.env.selfhosted"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║            REJOURNEY SELF-HOSTED DEPLOYMENT                ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }
print_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }

generate_secret() {
    openssl rand -hex 32
}

generate_password() {
    openssl rand -base64 24 | tr -d '/+=' | head -c 24
}

check_prerequisites() {
    echo "🔍 Checking prerequisites..."
    
    # Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed"
        echo "   Install: curl -fsSL https://get.docker.com | sh"
        exit 1
    fi
    print_success "Docker installed"
    
    # Docker Compose
    if docker compose version &> /dev/null 2>&1; then
        COMPOSE_CMD="docker compose"
    elif command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        print_error "Docker Compose is not installed"
        exit 1
    fi
    print_success "Docker Compose installed"
    
    # OpenSSL for secret generation
    if ! command -v openssl &> /dev/null; then
        print_error "OpenSSL is not installed (required for generating secrets)"
        exit 1
    fi
    print_success "OpenSSL installed"
    
    echo ""
}

setup_environment() {
    if [ -f "$ENV_FILE" ]; then
        print_warning "Environment file already exists: $ENV_FILE"
        read -p "Overwrite and regenerate secrets? (y/N): " confirm
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            print_info "Using existing configuration"
            return
        fi
    fi
    
    echo ""
    echo "📝 Interactive Setup"
    echo "===================="
    echo ""
    
    # Get domain information
    read -p "Dashboard domain (e.g., yourdomain.com): " DASHBOARD_DOMAIN
    read -p "API domain (e.g., api.yourdomain.com): " API_DOMAIN
    read -p "Let's Encrypt email for SSL certificates: " LETSENCRYPT_EMAIL
    
    # Storage choice
    echo ""
    echo "Storage Options:"
    echo "  1) Built-in MinIO (simpler, good for getting started)"
    echo "  2) External S3 (AWS, Cloudflare R2, Hetzner, Wasabi)"
    read -p "Choose storage option [1]: " STORAGE_CHOICE
    STORAGE_CHOICE=${STORAGE_CHOICE:-1}
    
    USE_MINIO="true"
    S3_ENDPOINT="http://minio:9000"
    
    if [ "$STORAGE_CHOICE" == "2" ]; then
        USE_MINIO="false"
        echo ""
        read -p "S3 Endpoint URL: " S3_ENDPOINT
        read -p "S3 Bucket Name: " S3_BUCKET_INPUT
        read -p "S3 Region: " S3_REGION_INPUT
        read -p "S3 Access Key ID: " S3_ACCESS_KEY_INPUT
        read -sp "S3 Secret Access Key: " S3_SECRET_KEY_INPUT
        echo ""
    fi
    
    echo ""
    echo "🔐 Generating secure secrets..."
    
    # Generate all secrets
    POSTGRES_PASSWORD=$(generate_password)
    REDIS_PASSWORD=$(generate_password)
    MINIO_PASSWORD=$(generate_password)
    JWT_SECRET=$(generate_secret)
    JWT_SIGNING_KEY=$(generate_secret)
    INGEST_HMAC_SECRET=$(generate_secret)
    STORAGE_ENCRYPTION_KEY=$(generate_secret)
    
    # Create .env file
    cat > "$ENV_FILE" << EOF
# ===================================================
# REJOURNEY SELF-HOSTED PRODUCTION CONFIGURATION
# Generated: $(date)
# ===================================================

# DOMAINS
DASHBOARD_DOMAIN=$DASHBOARD_DOMAIN
API_DOMAIN=$API_DOMAIN
PUBLIC_DASHBOARD_URL=https://$DASHBOARD_DOMAIN
PUBLIC_API_URL=https://$API_DOMAIN
PUBLIC_INGEST_URL=https://$API_DOMAIN
DASHBOARD_ORIGIN=https://$DASHBOARD_DOMAIN
LETSENCRYPT_EMAIL=$LETSENCRYPT_EMAIL

# DATABASE
POSTGRES_USER=rejourney
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=rejourney
DATABASE_URL=postgresql://rejourney:$POSTGRES_PASSWORD@postgres:5432/rejourney

# REDIS
REDIS_PASSWORD=$REDIS_PASSWORD
REDIS_URL=redis://:$REDIS_PASSWORD@redis:6379/0

# S3 STORAGE
USE_MINIO=$USE_MINIO
EOF

    if [ "$USE_MINIO" == "true" ]; then
        cat >> "$ENV_FILE" << EOF
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=$MINIO_PASSWORD
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=
S3_BUCKET=rejourney
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=admin
S3_SECRET_ACCESS_KEY=$MINIO_PASSWORD
EOF
    else
        cat >> "$ENV_FILE" << EOF
S3_ENDPOINT=$S3_ENDPOINT
S3_PUBLIC_ENDPOINT=$S3_ENDPOINT
S3_BUCKET=${S3_BUCKET_INPUT:-rejourney}
S3_REGION=${S3_REGION_INPUT:-us-east-1}
S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_INPUT
S3_SECRET_ACCESS_KEY=$S3_SECRET_KEY_INPUT
EOF
    fi
    
    cat >> "$ENV_FILE" << EOF

# APPLICATION SECRETS
JWT_SECRET=$JWT_SECRET
JWT_SIGNING_KEY=$JWT_SIGNING_KEY
INGEST_HMAC_SECRET=$INGEST_HMAC_SECRET
STORAGE_ENCRYPTION_KEY=$STORAGE_ENCRYPTION_KEY

# OPTIONAL: EMAIL (configure for team invites, alerts)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@$DASHBOARD_DOMAIN
SMTP_SECURE=true

# OPTIONAL: GITHUB OAUTH
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# DOCKER
IMAGE_TAG=latest
EOF

    chmod 600 "$ENV_FILE"
    print_success "Configuration saved to $ENV_FILE"
    print_warning "Back up this file securely - it contains all your secrets!"
    echo ""
}

deploy() {
    echo "🚀 Deploying Rejourney..."
    
    cd "$ROOT_DIR"
    
    # Determine which profile to use
    source "$ENV_FILE"
    if [ "$USE_MINIO" == "true" ]; then
        PROFILE="--profile minio"
        print_info "Using built-in MinIO for storage"
    else
        PROFILE="--profile external-s3"
        print_info "Using external S3 storage"
    fi
    
    # Pull latest images
    echo ""
    echo "📦 Pulling Docker images..."
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE pull
    
    # Start services
    echo ""
    echo "🔄 Starting services..."
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE up -d
    
    # Wait for services to be healthy
    echo ""
    echo "⏳ Waiting for services to start..."
    sleep 10
    
    # Run database migrations
    echo ""
    echo "🗄️  Running database migrations..."
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE exec -T api npm run db:migrate || true
    
    echo ""
    print_success "Deployment complete!"
    echo ""
    echo "📊 Service Status:"
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE ps
    echo ""
    echo "🌐 Your Rejourney instance is available at:"
    echo "   Dashboard: https://$DASHBOARD_DOMAIN"
    echo "   API:       https://$API_DOMAIN"
    echo ""
    echo "📝 Next steps:"
    echo "   1. Ensure DNS is pointing to this server"
    echo "   2. Wait a few minutes for SSL certificates"
    echo "   3. Create your first account at https://$DASHBOARD_DOMAIN"
    echo ""
}

show_status() {
    cd "$ROOT_DIR"
    if [ -f "$ENV_FILE" ]; then
        source "$ENV_FILE"
        PROFILE=$([ "$USE_MINIO" == "true" ] && echo "--profile minio" || echo "--profile external-s3")
    else
        PROFILE=""
    fi
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE ps
}

show_logs() {
    cd "$ROOT_DIR"
    SERVICE=${2:-}
    if [ -f "$ENV_FILE" ]; then
        source "$ENV_FILE"
        PROFILE=$([ "$USE_MINIO" == "true" ] && echo "--profile minio" || echo "--profile external-s3")
    else
        PROFILE=""
    fi
    if [ -n "$SERVICE" ]; then
        $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE logs -f "$SERVICE"
    else
        $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE logs -f
    fi
}

update_services() {
    echo "🔄 Updating Rejourney..."
    cd "$ROOT_DIR"
    
    if [ -f "$ENV_FILE" ]; then
        source "$ENV_FILE"
        PROFILE=$([ "$USE_MINIO" == "true" ] && echo "--profile minio" || echo "--profile external-s3")
    else
        print_error "No configuration found. Run setup first."
        exit 1
    fi
    
    # Pull new images
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE pull
    
    # Rolling restart
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE up -d
    
    # Run migrations
    echo "Running database migrations..."
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE exec -T api npm run db:migrate || true
    
    print_success "Update complete!"
}

stop_services() {
    echo "🛑 Stopping Rejourney..."
    cd "$ROOT_DIR"
    
    if [ -f "$ENV_FILE" ]; then
        source "$ENV_FILE"
        PROFILE=$([ "$USE_MINIO" == "true" ] && echo "--profile minio" || echo "--profile external-s3")
    else
        PROFILE=""
    fi
    
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE down
    print_success "All services stopped"
}

# ============================================================
# MAIN
# ============================================================

print_header

case "${1:-}" in
    status)
        show_status
        ;;
    logs)
        show_logs "$@"
        ;;
    update)
        check_prerequisites
        update_services
        ;;
    stop)
        stop_services
        ;;
    *)
        check_prerequisites
        setup_environment
        deploy
        ;;
esac
