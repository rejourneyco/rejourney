#!/bin/bash

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.selfhosted.yml"
ENV_FILE="$ROOT_DIR/.env.selfhosted"
BACKUP_DIR="$ROOT_DIR/backups"
FULL_BACKUP=false
MINIO_STOPPED_FOR_BACKUP=false

if [ "${1:-}" = "--full" ]; then
  FULL_BACKUP=true
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 (the docker compose plugin) is required"
  exit 1
fi
COMPOSE_BIN=(docker compose)

run_compose() {
  local -a clean_env=(env -i "PATH=$PATH")
  local key value

  for key in \
    HOME DOCKER_API_VERSION DOCKER_CERT_PATH DOCKER_CONFIG DOCKER_CONTEXT \
    DOCKER_DEFAULT_PLATFORM DOCKER_HOST DOCKER_TLS_VERIFY SSH_AUTH_SOCK \
    HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy \
    LANG LC_ALL TMPDIR; do
    if value="$(printenv "$key" 2>/dev/null)"; then
      clean_env+=("$key=$value")
    fi
  done

  "${clean_env[@]}" "${COMPOSE_BIN[@]}" "$@"
}

COMPOSE_ENVIRONMENT="$(run_compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config --environment)"

read_compose_env() {
  local key="$1"
  local line
  while IFS= read -r line; do
    if [[ "$line" == "$key="* ]]; then
      printf '%s' "${line#*=}"
      return 0
    fi
  done <<< "$COMPOSE_ENVIRONMENT"
  return 1
}

STORAGE_BACKEND="$(read_compose_env STORAGE_BACKEND || true)"
STORAGE_BACKEND="${STORAGE_BACKEND:-minio}"
POSTGRES_USER="$(read_compose_env POSTGRES_USER || true)"
POSTGRES_USER="${POSTGRES_USER:-rejourney}"
POSTGRES_DB="$(read_compose_env POSTGRES_DB || true)"
POSTGRES_DB="${POSTGRES_DB:-rejourney}"
REDIS_PASSWORD="$(read_compose_env REDIS_PASSWORD || true)"
if [ -z "$REDIS_PASSWORD" ]; then
  echo "REDIS_PASSWORD is missing from $ENV_FILE"
  exit 1
fi

PROFILE_ARGS=()
if [ "$STORAGE_BACKEND" = "minio" ]; then
  PROFILE_ARGS+=(--profile minio)
fi

compose_cmd() {
  run_compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "${PROFILE_ARGS[@]}" "$@"
}

restart_minio_after_backup() {
  if [ "$MINIO_STOPPED_FOR_BACKUP" = true ]; then
    echo "Restarting MinIO"
    compose_cmd start minio >/dev/null
    MINIO_STOPPED_FOR_BACKUP=false
  fi
}

trap restart_minio_after_backup EXIT

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "Creating PostgreSQL backup"
DB_BACKUP="$BACKUP_DIR/postgres-$TIMESTAMP.sql"
compose_cmd exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "$DB_BACKUP"
gzip -f "$DB_BACKUP"
chmod 600 "$DB_BACKUP.gz"

echo "Creating Redis backup"
REDIS_BACKUP="$BACKUP_DIR/redis-$TIMESTAMP.rdb"
compose_cmd exec -T redis redis-cli -a "$REDIS_PASSWORD" BGSAVE >/dev/null 2>&1 || true
sleep 2
if compose_cmd cp redis:/data/dump.rdb "$REDIS_BACKUP" >/dev/null 2>&1; then
  chmod 600 "$REDIS_BACKUP"
  gzip -f "$REDIS_BACKUP"
  chmod 600 "$REDIS_BACKUP.gz"
fi

if [ "$FULL_BACKUP" = true ] && [ "$STORAGE_BACKEND" = "minio" ]; then
  echo "Creating MinIO object storage backup"
  MINIO_CONTAINER_ID="$(compose_cmd ps -q minio)"
  if [ -n "$MINIO_CONTAINER_ID" ] && [ "$(docker inspect --format '{{.State.Running}}' "$MINIO_CONTAINER_ID")" = "true" ]; then
    echo "Pausing MinIO briefly for a consistent volume snapshot"
    compose_cmd stop minio >/dev/null
    MINIO_STOPPED_FOR_BACKUP=true
  fi
  MINIO_BACKUP="$BACKUP_DIR/minio-$TIMESTAMP.tar"
  docker run --rm \
    -v rejourney_miniodata:/data:ro \
    -v "$BACKUP_DIR:/backup" \
    alpine tar cf "/backup/minio-$TIMESTAMP.tar" -C /data .
  chmod 600 "$MINIO_BACKUP"
  restart_minio_after_backup
  gzip -f "$MINIO_BACKUP"
  chmod 600 "$MINIO_BACKUP.gz"
fi

cp "$ENV_FILE" "$BACKUP_DIR/env-$TIMESTAMP"
chmod 600 "$BACKUP_DIR/env-$TIMESTAMP"

echo "Backups created in $BACKUP_DIR"
ls -lh "$BACKUP_DIR"/*"$TIMESTAMP"* 2>/dev/null || true

echo "Cleaning up old backups"
find "$BACKUP_DIR" -name 'postgres-*.sql.gz' -type f | sort | head -n -10 | xargs -r rm -f
find "$BACKUP_DIR" -name 'redis-*.rdb.gz' -type f | sort | head -n -10 | xargs -r rm -f
find "$BACKUP_DIR" -name 'minio-*.tar.gz' -type f | sort | head -n -5 | xargs -r rm -f
find "$BACKUP_DIR" -name 'env-*' -type f | sort | head -n -10 | xargs -r rm -f

echo "Backup complete"
