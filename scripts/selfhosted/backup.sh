#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.selfhosted.yml"
ENV_FILE="$ROOT_DIR/.env.selfhosted"
BACKUP_DIR="$ROOT_DIR/backups"
FULL_BACKUP=false

if [ "${1:-}" = "--full" ]; then
  FULL_BACKUP=true
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_BIN=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_BIN=(docker-compose)
else
  echo "Docker Compose is required"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

PROFILE_ARGS=()
if [ "${STORAGE_BACKEND:-minio}" = "minio" ]; then
  PROFILE_ARGS+=(--profile minio)
fi

compose_cmd() {
  "${COMPOSE_BIN[@]}" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "${PROFILE_ARGS[@]}" "$@"
}

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Creating PostgreSQL backup"
DB_BACKUP="$BACKUP_DIR/postgres-$TIMESTAMP.sql"
compose_cmd exec -T postgres pg_dump -U "${POSTGRES_USER:-rejourney}" "${POSTGRES_DB:-rejourney}" > "$DB_BACKUP"
gzip -f "$DB_BACKUP"

echo "Creating Redis backup"
REDIS_BACKUP="$BACKUP_DIR/redis-$TIMESTAMP.rdb"
compose_cmd exec -T redis redis-cli -a "$REDIS_PASSWORD" BGSAVE >/dev/null 2>&1 || true
sleep 2
if compose_cmd cp redis:/data/dump.rdb "$REDIS_BACKUP" >/dev/null 2>&1; then
  gzip -f "$REDIS_BACKUP"
fi

if [ "$FULL_BACKUP" = true ] && [ "${STORAGE_BACKEND:-minio}" = "minio" ]; then
  echo "Creating MinIO object storage backup"
  MINIO_BACKUP="$BACKUP_DIR/minio-$TIMESTAMP.tar"
  docker run --rm \
    -v rejourney_miniodata:/data:ro \
    -v "$BACKUP_DIR:/backup" \
    alpine tar cf "/backup/minio-$TIMESTAMP.tar" -C /data .
  gzip -f "$MINIO_BACKUP"
fi

cp "$ENV_FILE" "$BACKUP_DIR/env-$TIMESTAMP"

echo "Backups created in $BACKUP_DIR"
ls -lh "$BACKUP_DIR"/*"$TIMESTAMP"* 2>/dev/null || true

echo "Cleaning up old backups"
find "$BACKUP_DIR" -name 'postgres-*.sql.gz' -type f | sort | head -n -10 | xargs -r rm -f
find "$BACKUP_DIR" -name 'redis-*.rdb.gz' -type f | sort | head -n -10 | xargs -r rm -f
find "$BACKUP_DIR" -name 'minio-*.tar.gz' -type f | sort | head -n -5 | xargs -r rm -f
find "$BACKUP_DIR" -name 'env-*' -type f | sort | head -n -10 | xargs -r rm -f

echo "Backup complete"
