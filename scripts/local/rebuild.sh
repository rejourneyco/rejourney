#!/bin/bash
# Clean and rebuild all Docker containers for LOCAL DEVELOPMENT
# Usage: ./scripts/local/rebuild.sh [--no-cache]
# Uses .env.local for environment configuration

set -e

NO_CACHE=""
if [[ "$1" == "--no-cache" ]]; then
    NO_CACHE="--no-cache"
fi

MAX_BUILD_RETRIES="${REBUILD_MAX_RETRIES:-3}"
BUILD_RETRY_DELAY_SECONDS="${REBUILD_RETRY_DELAY_SECONDS:-10}"

# Update IP addresses using the helper script
./scripts/local/update-ips.sh

echo "🧹 Cleaning and rebuilding Rejourney LOCAL Docker environment..."

# Check for .env.local
if [ ! -f ".env.local" ]; then
    echo "❌ .env.local not found. Copy from .env.example and configure for local dev."
    exit 1
fi

# Check docker compose
if command -v docker-compose &> /dev/null; then
    COMPOSE="docker-compose"
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
    COMPOSE="docker compose"
else
    echo "❌ Docker Compose not found."
    exit 1
fi

retry_build() {
    local attempt=1
    while true; do
        if $COMPOSE --env-file .env.local build $NO_CACHE "$@"; then
            return 0
        fi
        if [ "$attempt" -ge "$MAX_BUILD_RETRIES" ]; then
            echo "❌ Build failed after ${MAX_BUILD_RETRIES} attempt(s)."
            return 1
        fi
        echo "⚠️  Build failed (attempt ${attempt}/${MAX_BUILD_RETRIES}). Retrying in ${BUILD_RETRY_DELAY_SECONDS}s..."
        attempt=$((attempt + 1))
        sleep "$BUILD_RETRY_DELAY_SECONDS"
    done
}

# Stop and remove containers
echo "📦 Stopping containers..."
$COMPOSE --env-file .env.local down --remove-orphans

# Remove volumes (optional - uncomment to also clear data)
# echo "🗑️  Removing volumes..."
# $COMPOSE --env-file .env.local down -v

# Rebuild images
echo "🔨 Rebuilding images ${NO_CACHE:+(no cache)}..."
retry_build

# Start services
echo "🚀 Starting services..."
$COMPOSE --env-file .env.local up -d

echo ""
echo "✅ LOCAL rebuild complete!"
echo ""
echo "Run './scripts/local/logs.sh' to view logs"
