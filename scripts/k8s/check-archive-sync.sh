#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARCHIVE_YAML="${ROOT_DIR}/k8s/archive.yaml"
SOURCE_SCRIPT="${ROOT_DIR}/scripts/k8s/session-backup.mjs"

tmpfile="$(mktemp)"
trap 'rm -f "${tmpfile}"' EXIT

awk '
  /^  session-backup\.mjs: \|$/ { in_block=1; next }
  /^---$/ && in_block { exit }
  in_block {
    sub(/^    /, "")
    print
  }
' "${ARCHIVE_YAML}" > "${tmpfile}"

if ! diff -u "${SOURCE_SCRIPT}" "${tmpfile}" > /dev/null; then
  echo "archive.yaml is out of sync with scripts/k8s/session-backup.mjs" >&2
  echo "Regenerate k8s/archive.yaml from the standalone script before deploying." >&2
  diff -u "${SOURCE_SCRIPT}" "${tmpfile}" || true
  exit 1
fi

echo "archive.yaml is in sync with scripts/k8s/session-backup.mjs"
