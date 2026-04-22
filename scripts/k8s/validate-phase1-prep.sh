#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

require_file() {
  local path="$1"
  if [ ! -f "${path}" ]; then
    echo "Missing required file: ${path}" >&2
    exit 1
  fi
}

require_match() {
  local pattern="$1"
  local path="$2"
  if ! grep -F -q -- "${pattern}" "${path}"; then
    echo "Missing expected content in ${path}: ${pattern}" >&2
    exit 1
  fi
}

require_file "k8s/postgres-service-aliases.yaml"
require_file "k8s/storage-class-db-local.yaml"
require_file "k8s/cnpg-backups.yaml"
require_file "k8s/manual/postgres-local-cluster.yaml"
require_file "k8s/manual/postgres-manual-backup.yaml"

require_match 'name: postgres-app-rw' "k8s/postgres-service-aliases.yaml"
require_match 'name: postgres-app-ro' "k8s/postgres-service-aliases.yaml"
require_match 'name: postgres-app-r' "k8s/postgres-service-aliases.yaml"
require_match 'kind: ScheduledBackup' "k8s/cnpg-backups.yaml"
require_match 'name: postgres-daily-backup' "k8s/cnpg-backups.yaml"
require_match 'retentionPolicy: "30d"' "k8s/cnpg/postgres-cnpg.yaml"
require_match 'PGBOUNCER_URL=' "scripts/k8s/k8s-sync-secrets.sh"
require_match '@postgres-app-rw:5432/' "scripts/k8s/k8s-sync-secrets.sh"
require_match 'rm -rf "${RENDER_DIR}/manual"' "scripts/k8s/deploy-release.sh"
require_match 'ALLOW_LEGACY_POSTGRES_REMOVAL="${ALLOW_LEGACY_POSTGRES_REMOVAL:-false}"' "scripts/k8s/deploy-release.sh"

ruby <<'RUBY'
require 'yaml'

files = [
  'k8s/postgres-service-aliases.yaml',
  'k8s/storage-class-db-local.yaml',
  'k8s/cnpg-backups.yaml',
  'k8s/manual/postgres-local-cluster.yaml',
  'k8s/manual/postgres-manual-backup.yaml',
]

files.each do |path|
  docs = YAML.load_stream(File.read(path))
  if docs.compact.empty?
    warn "No YAML documents found in #{path}"
    exit 1
  end
end
RUBY

echo "Phase 1 prep manifests and deploy guardrails look valid."
