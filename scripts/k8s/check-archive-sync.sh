#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARCHIVE_YAML="${ROOT_DIR}/k8s/archive.yaml"
SOURCE_SCRIPT="${ROOT_DIR}/scripts/k8s/session-backup.mjs"
SOURCE_QUALITY_SCRIPT="${ROOT_DIR}/scripts/k8s/backup-quality.mjs"

tmp_script="$(mktemp)"
tmp_quality="$(mktemp)"
trap 'rm -f "${tmp_script}" "${tmp_quality}"' EXIT

extract_block() {
  local key="$1"
  local destination="$2"

  awk -v target="  ${key}: |" '
    $0 == target { in_block=1; next }
    /^---$/ && in_block { exit }
    /^  [^[:space:]].*: \|$/ && in_block { exit }
    in_block {
      sub(/^    /, "")
      print
    }
  ' "${ARCHIVE_YAML}" > "${destination}"
}

extract_block "session-backup.mjs" "${tmp_script}"
extract_block "backup-quality.mjs" "${tmp_quality}"

if ! diff -u "${SOURCE_SCRIPT}" "${tmp_script}" > /dev/null; then
  echo "archive.yaml is out of sync with scripts/k8s/session-backup.mjs" >&2
  echo "Regenerate k8s/archive.yaml from the standalone script before deploying." >&2
  diff -u "${SOURCE_SCRIPT}" "${tmp_script}" || true
  exit 1
fi

if ! diff -u "${SOURCE_QUALITY_SCRIPT}" "${tmp_quality}" > /dev/null; then
  echo "archive.yaml is out of sync with scripts/k8s/backup-quality.mjs" >&2
  echo "Regenerate k8s/archive.yaml from the standalone script before deploying." >&2
  diff -u "${SOURCE_QUALITY_SCRIPT}" "${tmp_quality}" || true
  exit 1
fi

echo "archive.yaml is in sync with scripts/k8s/session-backup.mjs and scripts/k8s/backup-quality.mjs"
