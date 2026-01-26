#!/bin/bash
# Seed database with test data for LOCAL DEVELOPMENT
# Usage: ./scripts/local/seed.sh
# Uses .env.local for environment configuration

set -e

echo "🌱 Seeding local database..."

cd "$(dirname "$0")/../.."

# Check for .env.local
if [ ! -f ".env.local" ]; then
    echo "❌ .env.local not found. Copy from .env.example and configure for local dev."
    exit 1
fi

# Export .env.local vars
set -a
source .env.local
set +a

# Override variables for local development
export DATABASE_URL="postgresql://rejourney:rejourney@localhost:5432/rejourney"
export NODE_ENV=development

cd backend

# Run Drizzle seed script
npx tsx src/db/seed.ts

echo ""
echo "✅ Local database seeded!"
