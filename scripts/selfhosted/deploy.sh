#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.selfhosted.yml"
ENV_FILE="$ROOT_DIR/.env.selfhosted"
COMPOSE_PROJECT_NAME="rejourney"
SELF_HOSTED_CMD="./scripts/selfhosted/$(basename "$0")"
POSTGRES_VOLUME="${COMPOSE_PROJECT_NAME}_pgdata"
REDIS_VOLUME="${COMPOSE_PROJECT_NAME}_redisdata"
MINIO_VOLUME="${COMPOSE_PROJECT_NAME}_miniodata"
TRAEFIK_CERTS_VOLUME="${COMPOSE_PROJECT_NAME}_traefik-certs"

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

# Official images may not publish arm64; default to amd64 emulation on ARM hosts unless overridden.
maybe_set_docker_platform() {
  if [ -n "${DOCKER_DEFAULT_PLATFORM:-}" ]; then
    return
  fi
  case "$(uname -m 2>/dev/null)" in
    arm64|aarch64)
      export DOCKER_DEFAULT_PLATFORM=linux/amd64
      print_info "ARM host detected: using DOCKER_DEFAULT_PLATFORM=$DOCKER_DEFAULT_PLATFORM for image pulls"
      ;;
  esac
}

volume_exists() {
  docker volume inspect "$1" >/dev/null 2>&1
}

list_existing_data_volumes() {
  local -a existing=()

  if volume_exists "$POSTGRES_VOLUME"; then
    existing+=("$POSTGRES_VOLUME")
  fi
  if volume_exists "$REDIS_VOLUME"; then
    existing+=("$REDIS_VOLUME")
  fi
  if volume_exists "$MINIO_VOLUME"; then
    existing+=("$MINIO_VOLUME")
  fi

  if [ "${#existing[@]}" -gt 0 ]; then
    printf '%s\n' "${existing[@]}"
  fi
}

preflight_install_state() {
  if [ -f "$ENV_FILE" ]; then
    return
  fi

  mapfile -t existing_volumes < <(list_existing_data_volumes)
  if [ "${#existing_volumes[@]}" -eq 0 ]; then
    return
  fi

  print_warning "Detected existing Docker data volumes from a previous self-hosted install:"
  for volume in "${existing_volumes[@]}"; do
    echo "  - $volume"
  done
  echo ""
  print_error "Refusing fresh install without $ENV_FILE because new credentials would not match persisted data."
  echo "Recovery options:"
  echo "  1) Restore the original .env.selfhosted and run $SELF_HOSTED_CMD update"
  echo "  2) Or wipe volumes and install fresh: $SELF_HOSTED_CMD reset && $SELF_HOSTED_CMD install"
  exit 1
}

load_env() {
  if [ ! -f "$ENV_FILE" ]; then
    print_error "Missing $ENV_FILE. Run $SELF_HOSTED_CMD install first."
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

    mapfile -t existing_volumes < <(list_existing_data_volumes)
    if [ "${#existing_volumes[@]}" -gt 0 ]; then
      print_warning "Existing data volumes detected. Regenerating secrets can make persisted services fail to authenticate."
      for volume in "${existing_volumes[@]}"; do
        echo "  - $volume"
      done
      read -r -p "Type OVERWRITE to continue regenerating secrets: " overwrite_confirm
      if [ "$overwrite_confirm" != "OVERWRITE" ]; then
        print_info "Keeping existing configuration"
        return
      fi
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
  # bootstrap builds from Dockerfile.migration (schema scripts); do not overwrite with registry :latest
  compose_cmd pull --ignore-buildable
}

build_bootstrap_image() {
  print_info "Building migration (bootstrap) image from repository"
  compose_cmd build bootstrap
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

verify_database_credentials() {
  print_info "Validating database credentials before bootstrap"

  local attempt=1
  local max_attempts=20
  local output=""
  local -a probe_cmd=(
    node
    -e
    'const pg=require("pg");(async()=>{const client=new pg.Client({connectionString:process.env.DATABASE_URL});try{await client.connect();await client.query("select 1");await client.end();}catch(err){console.error(err&&err.message?err.message:String(err));process.exit(1);}})();'
  )

  while [ "$attempt" -le "$max_attempts" ]; do
    if output="$(compose_cmd run --rm --no-deps bootstrap "${probe_cmd[@]}" 2>&1)"; then
      print_success "Database credentials validated"
      return
    fi

    if [[ "$output" == *"password authentication failed"* ]]; then
      print_error "Database authentication failed before bootstrap."
      echo "Likely cause: existing Postgres data volume with credentials that do not match $ENV_FILE."
      echo "Recovery options:"
      echo "  1) Restore the original .env.selfhosted and run $SELF_HOSTED_CMD update"
      echo "  2) Or wipe volumes and install fresh: $SELF_HOSTED_CMD reset && $SELF_HOSTED_CMD install"
      exit 1
    fi

    if [ "$attempt" -lt "$max_attempts" ]; then
      print_info "Database not ready yet (attempt ${attempt}/${max_attempts}); retrying in 2s"
      sleep 2
    else
      print_error "Could not validate database connectivity before bootstrap"
      echo "$output"
      exit 1
    fi

    attempt=$((attempt + 1))
  done
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
  build_bootstrap_image
  start_infrastructure
  verify_database_credentials
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

reset_services() {
  print_warning "This will permanently remove self-hosted Docker volumes and all stored data."
  echo "Volumes to remove:"
  echo "  - $POSTGRES_VOLUME"
  echo "  - $REDIS_VOLUME"
  echo "  - $MINIO_VOLUME"
  echo "  - $TRAEFIK_CERTS_VOLUME"
  read -r -p "Type RESET to continue: " confirm

  if [ "$confirm" != "RESET" ]; then
    print_info "Reset cancelled"
    return
  fi

  print_info "Stopping stack and removing Compose resources"
  if [ -f "$ENV_FILE" ]; then
    "${COMPOSE_BIN[@]}" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" --profile minio down --remove-orphans --volumes || true
  else
    "${COMPOSE_BIN[@]}" -f "$COMPOSE_FILE" --profile minio down --remove-orphans --volumes || true
  fi

  # When .env is missing, compose may leave profile-scoped containers behind; clean them explicitly.
  docker rm -f \
    "${COMPOSE_PROJECT_NAME}-minio-1" \
    "${COMPOSE_PROJECT_NAME}-minio-setup-1" \
    >/dev/null 2>&1 || true

  for volume in "$POSTGRES_VOLUME" "$REDIS_VOLUME" "$MINIO_VOLUME" "$TRAEFIK_CERTS_VOLUME"; do
    docker volume rm "$volume" >/dev/null 2>&1 || true
  done

  print_success "Self-hosted containers and volumes removed"
  print_info "Run $SELF_HOSTED_CMD install to create a fresh deployment"
}

update_services() {
  print_info "Updating self-hosted stack"
  deploy_stack
}

main() {
  print_header
  check_prerequisites
  maybe_set_docker_platform

  case "${1:-install}" in
    install)
      preflight_install_state
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
    reset)
      reset_services
      ;;
    *)
      print_error "Unknown command: ${1:-}"
      echo "Usage: $SELF_HOSTED_CMD [install|update|status|logs|stop|reset]"
      exit 1
      ;;
  esac
}

main "$@"
