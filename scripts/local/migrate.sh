#!/bin/bash
# Run database schema push/migrations for LOCAL DEVELOPMENT
# Usage: ./scripts/local/migrate.sh
# Uses .env.local for environment configuration

set -e

echo "🗃️  Running database migrations with Drizzle (LOCAL)..."

cd "$(dirname "$0")/../.."

# Export .env.local vars for drizzle
set -a
source .env.local
set +a

# Override DATABASE_URL to use localhost (drizzle-kit runs on host, not in Docker)
export DATABASE_URL="postgresql://rejourney:rejourney@localhost:5432/rejourney"

cd backend

# Push schema to database (creates/updates tables)
npx drizzle-kit push

echo ""
echo "✅ Schema push complete!"
