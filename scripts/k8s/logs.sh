#!/bin/bash
# View Docker logs for PRODUCTION build (uses .env)
# Usage: ./scripts/k8s/logs.sh [service_name]
# Uses .env (production) for environment configuration

SERVICE="$1"

if command -v docker-compose &> /dev/null; then
    COMPOSE="docker-compose"
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
    COMPOSE="docker compose"
else
    echo "❌ Docker Compose not found."
    exit 1
fi

if [[ -n "$SERVICE" ]]; then
    $COMPOSE --env-file .env logs -f $SERVICE
else
    $COMPOSE --env-file .env logs -f
fi
