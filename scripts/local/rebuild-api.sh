#!/bin/bash
# Rebuild and restart ONLY the API service for LOCAL DEVELOPMENT
# Usage: ./scripts/local/rebuild-api.sh [--no-cache]
# Uses .env.local for environment configuration

set -e

NO_CACHE=""
if [[ "$1" == "--no-cache" ]]; then
    NO_CACHE="--no-cache"
fi

echo "🔨 Rebuilding Rejourney API (local)..."

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

# Stop the api service
echo "📦 Stopping api container..."
$COMPOSE --env-file .env.local stop api

# Remove the api container
echo "🗑️  Removing api container..."
$COMPOSE --env-file .env.local rm -f api

# Rebuild api image
echo "🔨 Rebuilding api image ${NO_CACHE:+(no cache)}..."
$COMPOSE --env-file .env.local build $NO_CACHE api

# Start api service
echo "🚀 Starting api service..."
$COMPOSE --env-file .env.local up -d api

echo ""
echo "✅ API rebuild complete!"
echo "Tip: view logs with '$COMPOSE --env-file .env.local logs -f api'"

