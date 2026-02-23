#!/bin/bash
# Clean and rebuild ONLY the Web UI Docker container for LOCAL DEVELOPMENT
# Usage: ./scripts/local/rebuild-webui.sh [--no-cache]
# Uses .env.local for environment configuration

set -e

NO_CACHE=""
if [[ "$1" == "--no-cache" ]]; then
    NO_CACHE="--no-cache"
fi

MAX_BUILD_RETRIES="${REBUILD_MAX_RETRIES:-3}"
BUILD_RETRY_DELAY_SECONDS="${REBUILD_RETRY_DELAY_SECONDS:-10}"

echo "🧹 Rebuilding Rejourney Web UI container..."

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

# Stop the web service
echo "📦 Stopping web container..."
$COMPOSE --env-file .env.local stop web

# Remove the web container
echo "🗑️  Removing web container..."
$COMPOSE --env-file .env.local rm -f web

# Rebuild web image
echo "🔨 Rebuilding web image ${NO_CACHE:+(no cache)}..."
retry_build web

# Start web service
echo "🚀 Starting web service..."
$COMPOSE --env-file .env.local up -d web

echo ""
echo "✅ Web UI rebuild complete!"
echo ""
echo "🌐 Web UI available at: http://localhost:8080"
echo "📊 Run 'docker logs rejourney-web-1' to view web UI logs"
