#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.selfhosted.yml"
ENV_FILE="$ROOT_DIR/.env.selfhosted"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
  echo ""
  echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║             REJOURNEY SELF-HOSTED OPERATOR               ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

print_success() { echo -e "${GREEN}✔ $1${NC}"; }
print_warning() { echo -e "${YELLOW}! $1${NC}"; }
print_error() { echo -e "${RED}x $1${NC}"; }
print_info() { echo -e "${BLUE}i $1${NC}"; }

generate_secret() {
  openssl rand -hex 32
}

generate_password() {
  openssl rand -base64 32 | tr -d '/+=' | head -c 32
}

check_prerequisites() {
  if ! command -v docker >/dev/null 2>&1; then
    print_error "Docker is not installed"
    exit 1
  fi

  if docker compose version >/dev/null 2>&1; then
    COMPOSE_BIN=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_BIN=(docker-compose)
  else
    print_error "Docker Compose is not installed"
    exit 1
  fi

  if ! command -v openssl >/dev/null 2>&1; then
    print_error "OpenSSL is required to generate secrets"
    exit 1
  fi
}

load_env() {
  if [ ! -f "$ENV_FILE" ]; then
    print_error "Missing $ENV_FILE. Run ./scripts/selfhosted/deploy.sh install first."
    exit 1
  fi

  set -a
  source "$ENV_FILE"
  set +a

  STORAGE_BACKEND="${STORAGE_BACKEND:-minio}"
  BASE_DOMAIN="${BASE_DOMAIN:-${DASHBOARD_DOMAIN:-}}"
  WWW_DOMAIN="${WWW_DOMAIN:-www.${BASE_DOMAIN}}"
  INGEST_DOMAIN="${INGEST_DOMAIN:-ingest.${BASE_DOMAIN}}"
  PROFILE_ARGS=()
  if [ "$STORAGE_BACKEND" = "minio" ]; then
    PROFILE_ARGS+=(--profile minio)
  fi
}

compose_cmd() {
  load_env
  "${COMPOSE_BIN[@]}" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "${PROFILE_ARGS[@]}" "$@"
}

setup_environment() {
  if [ -f "$ENV_FILE" ]; then
    print_warning "Configuration already exists at $ENV_FILE"
    read -r -p "Overwrite it and regenerate secrets? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      print_info "Keeping existing configuration"
      return
    fi
  fi

  echo "Base domain (example: example.com)"
  read -r -p "> " BASE_DOMAIN
  echo "Let's Encrypt email"
  read -r -p "> " LETSENCRYPT_EMAIL

  DASHBOARD_DOMAIN="$BASE_DOMAIN"
  WWW_DOMAIN="www.$BASE_DOMAIN"
  API_DOMAIN="api.$BASE_DOMAIN"
  INGEST_DOMAIN="ingest.$BASE_DOMAIN"

  echo ""
  print_info "Self-hosted hostnames:"
  echo "  Dashboard: https://$DASHBOARD_DOMAIN"
  echo "  WWW redirect: https://$WWW_DOMAIN -> https://$DASHBOARD_DOMAIN"
  echo "  API: https://$API_DOMAIN"
  echo "  Ingest upload relay: https://$INGEST_DOMAIN"

  echo ""
  echo "Storage backend:"
  echo "  1) Built-in MinIO (recommended default)"
  echo "  2) External S3-compatible storage"
  read -r -p "Choose storage backend [1]: " STORAGE_CHOICE
  STORAGE_CHOICE="${STORAGE_CHOICE:-1}"

  STORAGE_BACKEND="minio"
  S3_ENDPOINT_VALUE="http://minio:9000"
  S3_PUBLIC_ENDPOINT_VALUE=""
  S3_BUCKET_VALUE="rejourney"
  S3_REGION_VALUE="us-east-1"
  S3_ACCESS_KEY_VALUE="rejourney"
  S3_SECRET_KEY_VALUE=""
  MINIO_ROOT_USER_VALUE="rejourney"
  MINIO_ROOT_PASSWORD_VALUE="$(generate_password)"

  if [ "$STORAGE_CHOICE" = "2" ]; then
    STORAGE_BACKEND="s3"
    echo "External S3 endpoint URL"
    read -r -p "> " S3_ENDPOINT_VALUE
    echo "Optional public endpoint URL for direct signed downloads (leave blank to reuse endpoint)"
    read -r -p "> " S3_PUBLIC_ENDPOINT_VALUE
    echo "Bucket name"
    read -r -p "> " S3_BUCKET_VALUE
    echo "Region [us-east-1]"
    read -r -p "> " S3_REGION_VALUE
    S3_REGION_VALUE="${S3_REGION_VALUE:-us-east-1}"
    echo "Access key ID"
    read -r -p "> " S3_ACCESS_KEY_VALUE
    read -r -s -p "Secret access key: " S3_SECRET_KEY_VALUE
    echo ""
    MINIO_ROOT_USER_VALUE=""
    MINIO_ROOT_PASSWORD_VALUE=""
  else
    S3_SECRET_KEY_VALUE="$MINIO_ROOT_PASSWORD_VALUE"
  fi

  POSTGRES_PASSWORD="$(generate_password)"
  REDIS_PASSWORD="$(generate_password)"
  JWT_SECRET="$(generate_secret)"
  JWT_SIGNING_KEY="$(generate_secret)"
  INGEST_HMAC_SECRET="$(generate_secret)"
  STORAGE_ENCRYPTION_KEY="$(generate_secret)"

  cat > "$ENV_FILE" <<ENV
# Rejourney self-hosted configuration
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

BASE_DOMAIN=$BASE_DOMAIN
DASHBOARD_DOMAIN=$DASHBOARD_DOMAIN
WWW_DOMAIN=$WWW_DOMAIN
API_DOMAIN=$API_DOMAIN
INGEST_DOMAIN=$INGEST_DOMAIN
PUBLIC_DASHBOARD_URL=https://$DASHBOARD_DOMAIN
PUBLIC_API_URL=https://$API_DOMAIN
PUBLIC_INGEST_URL=https://$INGEST_DOMAIN
DASHBOARD_ORIGIN=https://$DASHBOARD_DOMAIN
LETSENCRYPT_EMAIL=$LETSENCRYPT_EMAIL

POSTGRES_USER=rejourney
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=rejourney
DATABASE_URL=postgresql://rejourney:$POSTGRES_PASSWORD@postgres:5432/rejourney

REDIS_PASSWORD=$REDIS_PASSWORD
REDIS_URL=redis://:$REDIS_PASSWORD@redis:6379/0

STORAGE_BACKEND=$STORAGE_BACKEND
MINIO_ROOT_USER=$MINIO_ROOT_USER_VALUE
MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD_VALUE
S3_ENDPOINT=$S3_ENDPOINT_VALUE
S3_PUBLIC_ENDPOINT=$S3_PUBLIC_ENDPOINT_VALUE
S3_BUCKET=$S3_BUCKET_VALUE
S3_REGION=$S3_REGION_VALUE
S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_VALUE
S3_SECRET_ACCESS_KEY=$S3_SECRET_KEY_VALUE

JWT_SECRET=$JWT_SECRET
JWT_SIGNING_KEY=$JWT_SIGNING_KEY
INGEST_HMAC_SECRET=$INGEST_HMAC_SECRET
STORAGE_ENCRYPTION_KEY=$STORAGE_ENCRYPTION_KEY

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@$BASE_DOMAIN
SMTP_SECURE=true

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

IMAGE_TAG=latest
LOG_LEVEL=info
ENV

  chmod 600 "$ENV_FILE"
  print_success "Wrote $ENV_FILE"
  print_warning "Back this file up securely. It contains all secrets for the deployment."
}

pull_images() {
  print_info "Pulling container images"
  compose_cmd pull
}

start_infrastructure() {
  print_info "Starting infrastructure services"
  compose_cmd up -d traefik postgres redis

  if [ "$STORAGE_BACKEND" = "minio" ]; then
    compose_cmd up -d minio
    print_info "Ensuring MinIO bucket exists"
    compose_cmd rm -sf minio-setup >/dev/null 2>&1 || true
    compose_cmd up --no-deps minio-setup
  fi
}

run_bootstrap() {
  print_info "Running schema, seed, and storage endpoint bootstrap"
  compose_cmd rm -sf bootstrap >/dev/null 2>&1 || true
  compose_cmd up --no-deps bootstrap
}

start_application_services() {
  print_info "Starting API, upload relay, web, and workers"
  compose_cmd up -d api ingest-upload web ingest-worker replay-worker session-lifecycle-worker retention-worker alert-worker
}

deploy_stack() {
  pull_images
  start_infrastructure
  run_bootstrap
  start_application_services
  print_success "Deployment complete"
  echo ""
  echo "Dashboard: https://$DASHBOARD_DOMAIN"
  echo "WWW redirect: https://$WWW_DOMAIN"
  echo "API: https://$API_DOMAIN"
  echo "Ingest: https://$INGEST_DOMAIN"
}

show_status() {
  compose_cmd ps
  echo ""
  echo "Dashboard: ${PUBLIC_DASHBOARD_URL}"
  echo "API: ${PUBLIC_API_URL}"
  echo "Ingest: ${PUBLIC_INGEST_URL}"
}

show_logs() {
  local service="${2:-}"
  if [ -n "$service" ]; then
    compose_cmd logs -f "$service"
  else
    compose_cmd logs -f
  fi
}

stop_services() {
  print_info "Stopping self-hosted services without deleting data"
  compose_cmd stop
  print_success "Services stopped"
}

update_services() {
  print_info "Updating self-hosted stack"
  deploy_stack
}

main() {
  print_header
  check_prerequisites

  case "${1:-install}" in
    install)
      setup_environment
      load_env
      deploy_stack
      ;;
    update)
      load_env
      update_services
      ;;
    status)
      load_env
      show_status
      ;;
    logs)
      load_env
      show_logs "$@"
      ;;
    stop)
      load_env
      stop_services
      ;;
    *)
      print_error "Unknown command: ${1:-}"
      echo "Usage: ./scripts/selfhosted/deploy.sh [install|update|status|logs|stop]"
      exit 1
      ;;
  esac
}

main "$@"
