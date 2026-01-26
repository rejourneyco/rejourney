#!/bin/bash
# Stop all Docker services for LOCAL DEVELOPMENT
# Usage: ./scripts/local/stop.sh
# Uses .env.local for environment configuration

set -e

echo "🛑 Stopping Rejourney LOCAL services..."

if command -v docker-compose &> /dev/null; then
    COMPOSE="docker-compose"
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
    COMPOSE="docker compose"
else
    echo "❌ Docker Compose not found."
    exit 1
fi

$COMPOSE --env-file .env.local down

echo "✅ All local services stopped."
