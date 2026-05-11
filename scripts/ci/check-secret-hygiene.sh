#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

fail() {
  echo "[secret-hygiene] ERROR: $1" >&2
  exit 1
}

check_absent() {
  local pattern="$1"
  local description="$2"
  shift 2

  local matches
  matches="$(rg -n --pcre2 "${pattern}" "$@" || true)"
  if [ -n "${matches}" ]; then
    echo "${matches}" >&2
    fail "${description}"
  fi
}

check_repo_absent() {
  local pattern="$1"
  local description="$2"

  local matches
  matches="$(
    rg -n --hidden --pcre2 \
      --glob '!.git/**' \
      --glob '!node_modules/**' \
      --glob '!package-lock.json' \
      --glob '!scripts/ci/check-secret-hygiene.sh' \
      -- "${pattern}" . || true
  )"

  if [ -n "${matches}" ]; then
    echo "${matches}" >&2
    fail "${description}"
  fi
}

cd "${ROOT_DIR}"

check_repo_absent '-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----' \
  "private keys must never be committed to this public repo."

check_repo_absent 'gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}' \
  "GitHub tokens must never be committed to this public repo."

check_repo_absent 'sk-[A-Za-z0-9_-]{32,}|sk-proj-[A-Za-z0-9_-]{32,}' \
  "OpenAI-style API keys must never be committed to this public repo."

check_repo_absent 'sk_live_[A-Za-z0-9._-]{16,}|rk_live_[A-Za-z0-9._-]{16,}|whsec_[A-Za-z0-9._-]{16,}' \
  "Stripe live/restricted/webhook secrets must never be committed to this public repo."

check_repo_absent 'AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16}' \
  "AWS access key IDs must never be committed to this public repo."

check_repo_absent 'npm_[A-Za-z0-9]{30,}' \
  "npm tokens must never be committed to this public repo."

check_repo_absent 'xox[baprs]-[A-Za-z0-9-]{20,}' \
  "Slack tokens must never be committed to this public repo."

check_repo_absent 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}' \
  "JWT-looking bearer tokens must never be committed to this public repo."

check_repo_absent 'rj_live_[A-Za-z0-9._=-]{16,}' \
  "Rejourney live API keys must never be committed to this public repo."

check_absent 'set\s+-[^\\n]*x' \
  "xtrace is forbidden in CI/deploy scripts because it can print expanded secrets." \
  .github scripts/k8s/deploy-release.sh scripts/ci

check_absent 'https://\$\{?GITHUB_TOKEN[^[:space:]]*@github\.com' \
  "do not embed GitHub tokens in git remote URLs; use tokenless public remotes or an askpass helper." \
  .github scripts

check_absent '\bprintenv\b|(^|[;&|[:space:]])env\s*(\||>|$)' \
  "printing the full environment is forbidden in CI/deploy scripts." \
  .github scripts

check_absent 'kubectl\s+(get|describe)\s+secrets?\b' \
  "kubectl get/describe secret is forbidden directly in workflows." \
  .github

check_absent 'kubectl\s+describe\s+secrets?\b|kubectl\s+get\s+secrets?\b[^|;\n]*-o\s+(yaml|json)\b' \
  "secret dumping is forbidden in deploy diagnostics; use narrow jsonpath reads only when needed and never print values." \
  scripts/k8s/deploy-release.sh

check_absent 'kubectl\s+logs\b' \
  "kubectl logs is forbidden directly in workflows; use deploy-release.sh diagnostics with redaction." \
  .github

echo "[secret-hygiene] OK"
