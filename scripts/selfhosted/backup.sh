#!/bin/bash
# Rejourney Self-Hosted Backup Script
# Usage: ./scripts/selfhosted/backup.sh [--full]
#
# Creates a backup of your Rejourney data.
# --full: Also backup MinIO data (recordings)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

FULL_BACKUP=false
if [[ "$1" == "--full" ]]; then
    FULL_BACKUP=true
fi

echo "╔════════════════════════════════════════════════════════════╗"
echo "║           REJOURNEY SELF-HOSTED BACKUP                     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

cd "$ROOT_DIR"

# Detect docker compose command
if command -v docker-compose &> /dev/null; then
    COMPOSE="docker-compose"
elif docker compose version &> /dev/null 2>&1; then
    COMPOSE="docker compose"
else
    echo "❌ Docker Compose is not installed."
    exit 1
fi

# Create backup directory
BACKUP_DIR="$ROOT_DIR/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

# Backup PostgreSQL
echo "💾 Backing up PostgreSQL database..."
DB_BACKUP="$BACKUP_DIR/postgres-$TIMESTAMP.sql"

if $COMPOSE ps postgres | grep -q "Up"; then
    $COMPOSE exec -T postgres pg_dump -U rejourney rejourney > "$DB_BACKUP"
    
    # Compress the backup
    gzip "$DB_BACKUP"
    DB_BACKUP="$DB_BACKUP.gz"
    
    echo "✅ Database backup: $DB_BACKUP"
    echo "   Size: $(du -h "$DB_BACKUP" | cut -f1)"
else
    echo "❌ PostgreSQL is not running. Cannot backup database."
    exit 1
fi

# Backup Redis (optional - mostly cache)
echo ""
echo "💾 Backing up Redis data..."
REDIS_BACKUP="$BACKUP_DIR/redis-$TIMESTAMP.rdb"

if $COMPOSE ps redis | grep -q "Up"; then
    # Trigger Redis save
    $COMPOSE exec -T redis redis-cli BGSAVE > /dev/null 2>&1 || true
    sleep 2
    
    # Copy the dump file
    $COMPOSE cp redis:/data/dump.rdb "$REDIS_BACKUP" 2>/dev/null || echo "   (No Redis dump file found - this is OK if cache is empty)"
    
    if [ -f "$REDIS_BACKUP" ]; then
        gzip "$REDIS_BACKUP"
        echo "✅ Redis backup: $REDIS_BACKUP.gz"
    fi
else
    echo "⚠️  Redis not running, skipping"
fi

# Full backup includes MinIO data
if [ "$FULL_BACKUP" = true ]; then
    echo ""
    echo "💾 Backing up recordings from MinIO..."
    MINIO_BACKUP="$BACKUP_DIR/minio-$TIMESTAMP.tar"
    
    # Get the volume name
    MINIO_VOLUME=$($COMPOSE config --volumes 2>/dev/null | grep minio || echo "")
    
    if [ -n "$MINIO_VOLUME" ]; then
        echo "   This may take a while depending on recording count..."
        
        # Use docker to backup the volume
        docker run --rm \
            -v "${PWD##*/}_miniodata:/data:ro" \
            -v "$BACKUP_DIR:/backup" \
            alpine tar cvf "/backup/minio-$TIMESTAMP.tar" -C /data . 2>/dev/null || \
        docker run --rm \
            -v "rejourney_miniodata:/data:ro" \
            -v "$BACKUP_DIR:/backup" \
            alpine tar cvf "/backup/minio-$TIMESTAMP.tar" -C /data . 2>/dev/null || \
        echo "   Could not backup MinIO volume (volume name may differ)"
        
        if [ -f "$MINIO_BACKUP" ]; then
            gzip "$MINIO_BACKUP"
            echo "✅ MinIO backup: $MINIO_BACKUP.gz"
            echo "   Size: $(du -h "$MINIO_BACKUP.gz" | cut -f1)"
        fi
    else
        echo "⚠️  Could not find MinIO volume"
    fi
fi

# Backup .env file
echo ""
echo "💾 Backing up environment configuration..."
ENV_BACKUP="$BACKUP_DIR/env-$TIMESTAMP"
if [ -f ".env" ]; then
    cp .env "$ENV_BACKUP"
    echo "✅ Environment backup: $ENV_BACKUP"
fi

# Summary
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║           BACKUP COMPLETE!                                 ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "   Backup location: $BACKUP_DIR"
echo ""
ls -lh "$BACKUP_DIR"/*$TIMESTAMP* 2>/dev/null | awk '{print "   " $9 " (" $5 ")"}'
echo ""
echo "📖 To restore:"
echo "   gunzip $DB_BACKUP"
echo "   docker-compose exec -T postgres psql -U rejourney rejourney < backup.sql"
echo ""

# Cleanup old backups (keep last 10)
echo "🧹 Cleaning up old backups (keeping last 10)..."
cd "$BACKUP_DIR"
ls -t postgres-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
ls -t redis-*.rdb.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
ls -t minio-*.tar.gz 2>/dev/null | tail -n +5 | xargs -r rm -f
ls -t env-* 2>/dev/null | tail -n +11 | xargs -r rm -f
echo "✅ Cleanup complete"
