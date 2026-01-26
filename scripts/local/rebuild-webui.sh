#!/bin/bash
# Clean and rebuild ONLY the Web UI Docker container for LOCAL DEVELOPMENT
# Usage: ./scripts/local/rebuild-webui.sh [--no-cache]
# Uses .env.local for environment configuration

set -e

NO_CACHE=""
if [[ "$1" == "--no-cache" ]]; then
    NO_CACHE="--no-cache"
fi

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

# Stop the web service
echo "📦 Stopping web container..."
$COMPOSE --env-file .env.local stop web

# Remove the web container
echo "🗑️  Removing web container..."
$COMPOSE --env-file .env.local rm -f web

# Rebuild web image
echo "🔨 Rebuilding web image ${NO_CACHE:+(no cache)}..."
$COMPOSE --env-file .env.local build $NO_CACHE web

# Start web service
echo "🚀 Starting web service..."
$COMPOSE --env-file .env.local up -d web

echo ""
echo "✅ Web UI rebuild complete!"
echo ""
echo "🌐 Web UI available at: http://localhost:8080"
echo "📊 Run 'docker logs rejourney-web-1' to view web UI logs"