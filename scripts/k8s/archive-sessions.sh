#!/bin/sh

set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to run session-backup.mjs" >&2
  exit 1
fi

exec node "$SCRIPT_DIR/session-backup.mjs" "$@"
