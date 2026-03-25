#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA_PATH="backend/src/db/schema.ts"
MIGRATION_DIR="backend/drizzle"
MODE="working-tree"
RANGE=""

if [ "${1:-}" = "--range" ]; then
  RANGE="${2:-}"
  if [ -z "${RANGE}" ]; then
    echo "[schema-migration-check] ERROR: --range requires a git range" >&2
    exit 1
  fi
  MODE="range"
fi

cd "${ROOT_DIR}"

has_schema_change() {
  if [ "${MODE}" = "range" ]; then
    git diff --name-only "${RANGE}" -- "${SCHEMA_PATH}" | grep -q .
  else
    git status --porcelain -- "${SCHEMA_PATH}" | grep -q .
  fi
}

has_migration_change() {
  if [ "${MODE}" = "range" ]; then
    git diff --name-only "${RANGE}" -- "${MIGRATION_DIR}" | grep -q .
  else
    git status --porcelain -- "${MIGRATION_DIR}" | grep -q .
  fi
}

if ! has_schema_change; then
  echo "[schema-migration-check] No schema changes detected."
  exit 0
fi

if has_migration_change; then
  echo "[schema-migration-check] Schema and migration changes detected."
  exit 0
fi

echo "[schema-migration-check] ERROR: ${SCHEMA_PATH} changed without a matching migration change under ${MIGRATION_DIR}." >&2
echo "[schema-migration-check] Run 'cd backend && npm run db:generate -- --name <migration_name>' and commit the generated migration." >&2
exit 1
