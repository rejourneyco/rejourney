#!/bin/bash
# Clean and rebuild all Docker containers for LOCAL DEVELOPMENT
# Usage: ./scripts/local/rebuild.sh [--no-cache]
# Uses .env.local for environment configuration

set -e

NO_CACHE=""
if [[ "$1" == "--no-cache" ]]; then
    NO_CACHE="--no-cache"
fi


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

# Stop and remove containers
echo "📦 Stopping containers..."
$COMPOSE --env-file .env.local down --remove-orphans

# Remove volumes (optional - uncomment to also clear data)
# echo "🗑️  Removing volumes..."
# $COMPOSE --env-file .env.local down -v

# Rebuild images
echo "🔨 Rebuilding images ${NO_CACHE:+(no cache)}..."
$COMPOSE --env-file .env.local build $NO_CACHE

# Start services
echo "🚀 Starting services..."
$COMPOSE --env-file .env.local up -d

echo ""
echo "✅ LOCAL rebuild complete!"
echo ""
echo "Run './scripts/local/logs.sh' to view logs"
