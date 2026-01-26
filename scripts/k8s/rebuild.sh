#!/bin/bash
# Rebuild Docker containers with PRODUCTION settings
# Usage: ./scripts/k8s/rebuild.sh [--no-cache]
# Uses .env (production) for environment configuration
# ⚠️ Only use this for local testing of production builds!

set -e

NO_CACHE=""
if [[ "$1" == "--no-cache" ]]; then
    NO_CACHE="--no-cache"
fi

echo "🔧 Rebuilding Rejourney with PRODUCTION settings..."
echo "⚠️  Using .env (production config) - make sure you know what you're doing!"

# Check for .env
if [ ! -f ".env" ]; then
    echo "❌ .env not found."
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

# Stop and remove containers
echo "📦 Stopping containers..."
$COMPOSE --env-file .env down --remove-orphans

# Rebuild images
echo "🔨 Rebuilding images ${NO_CACHE:+(no cache)}..."
$COMPOSE --env-file .env build $NO_CACHE

# Start services
echo "🚀 Starting services..."
$COMPOSE --env-file .env up -d

echo ""
echo "✅ PRODUCTION build complete!"
echo ""
echo "Run './scripts/k8s/logs.sh' to view logs"
