#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# This is a strict migration audit. Keep it separate from required CI until the
# reviewed legacy artifact set has been deleted; once it passes, wire it into CI.

fail() {
  echo "[repository-hygiene] ERROR: $1" >&2
  exit 1
}

cd "${ROOT_DIR}"

ignored_tracked="$(
  while IFS= read -r path; do
    if [ -e "${path}" ] || [ -L "${path}" ]; then
      printf '%s\n' "${path}"
    fi
  done < <(git -c core.fsmonitor=false ls-files -ci --exclude-standard)
)"
if [ -n "${ignored_tracked}" ]; then
  printf '%s\n' "${ignored_tracked}" | sed -n '1,80p' >&2
  ignored_count="$(printf '%s\n' "${ignored_tracked}" | wc -l | tr -d ' ')"
  if [ "${ignored_count}" -gt 80 ]; then
    echo "... and $((ignored_count - 80)) more" >&2
  fi
  fail "tracked files also match .gitignore; remove them or add a narrow exception."
fi

tracked_paths="$(
  while IFS= read -r path; do
    if [ -e "${path}" ] || [ -L "${path}" ]; then
      printf '%s\n' "${path}"
    fi
  done < <(git -c core.fsmonitor=false ls-files)
)"
forbidden_paths="$(
  printf '%s\n' "${tracked_paths}" | rg \
    '(^|/)\.DS_Store$|(^|/)__pycache__/|\.py[cod]$|(^|/)\.(expo|settings|agent)/|(^|/)\.claude/settings\.local\.json$|(^|/)\.app(/|$)|(^|/)storage-state[^/]*\.json$|^\.yarn/|^\.pnp\.(cjs|loader\.mjs)$|^output/|^dashboard/web-ui/output/|^dashboard/web-ui/tmp-|^maunatl run proof/|^packages/react-native/[^/]+\.tgz$' \
    || true
)"
if [ -n "${forbidden_paths}" ]; then
  echo "${forbidden_paths}" >&2
  fail "generated, local-only, or credential-bearing paths are tracked."
fi

if [ -e yarn.lock ] || printf '%s\n' "${tracked_paths}" | rg -q '^yarn\.lock$'; then
  fail "yarn.lock is present even though npm is the canonical package manager."
fi

if ! rg -q '"packageManager"\s*:\s*"npm@' package.json; then
  fail "package.json must declare npm as the canonical package manager."
fi

bad_modes=""
while IFS= read -r path; do
  if [ ! -e "${path}" ] || [ ! -x "${path}" ]; then
    continue
  fi

  case "${path}" in
    .husky/*|*/.husky/*)
      continue
      ;;
  esac

  if [ -f "${path}" ] && [ "$(LC_ALL=C head -c 2 "${path}" 2>/dev/null || true)" != '#!' ]; then
    bad_modes+="${path}"$'\n'
  fi
done < <(git -c core.fsmonitor=false ls-files)

if [ -n "${bad_modes}" ]; then
  printf '%s' "${bad_modes}" >&2
  fail "non-script files are executable; normalize them to mode 100644."
fi

competitor_markers="$(
  rg -n --pcre2 \
    --glob '*.{css,js,jsx,kt,scss,swift,ts,tsx}' \
    --glob '!dashboard/web-ui/app/features/public/**' \
    --glob '!dashboard/web-ui/app/shared/data/engineeringArticles/**' \
    --glob '!dashboard/web-ui/app/shell/components/layout/Footer.tsx' \
    --glob '!packages/browser/src/sdk/appVersion.ts' \
    '(?i)\b(?:sentry|posthog|hotjar|fullstory|datadog|mixpanel|amplitude|logrocket|uxcam|contentsquare|mouseflow|smartlook|glassbox|inspectlet|newrelic|bugsnag|rollbar)[A-Za-z0-9_]*\b' \
    backend/src dashboard/web-ui/app examples packages \
    || true
)"
if [ -n "${competitor_markers}" ]; then
  echo "${competitor_markers}" >&2
  fail "internal identifiers, UI structures, or implementation comments reference competitor products."
fi

echo "[repository-hygiene] OK"
