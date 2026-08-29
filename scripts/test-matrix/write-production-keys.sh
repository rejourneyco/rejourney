#!/usr/bin/env bash
set -euo pipefail

# Accepts tab-separated "fixture<TAB>public-key<TAB>project-id" rows on stdin.
# The project id is optional when refreshing an existing file. Keeping the
# values on stdin prevents production project keys from appearing in shell
# arguments, process listings, or tracked files.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
environment_dir="${MATRIX_ENVIRONMENT_DIR:-$script_dir/environments}"
api_url="${REJOURNEY_API_URL:-https://api.rejourney.co}"

read_existing_value() {
  local file="$1"
  local name="$2"
  if [[ -f "$file" ]]; then
    awk -v prefix="$name=" 'index($0, prefix) == 1 { print substr($0, length(prefix) + 1); exit }' "$file"
  fi
}

if [[ "$api_url" != https://* ]]; then
  echo "Production REJOURNEY_API_URL must use HTTPS." >&2
  exit 78
fi

umask 077
seen_fixtures=" "

while IFS=$'\t' read -r fixture public_key project_id extra; do
  if [[ -z "$fixture" && -z "$public_key" ]]; then
    continue
  fi
  if [[ -n "${extra:-}" ]]; then
    echo "Expected two or three tab-separated fields." >&2
    exit 65
  fi
  case "$fixture" in
    expo|brew|swift|flutter) ;;
    *) echo "Unknown matrix fixture: $fixture" >&2; exit 65 ;;
  esac
  if [[ "$public_key" != rj_* || ${#public_key} -gt 64 ]]; then
    echo "Invalid public project key for $fixture." >&2
    exit 65
  fi
  if [[ -z "${project_id:-}" ]]; then
    project_id="$(read_existing_value "$environment_dir/$fixture.production.env" REJOURNEY_PROJECT_ID)"
  fi
  if [[ -n "$project_id" && ! "$project_id" =~ ^[0-9a-fA-F-]{36}$ ]]; then
    echo "Invalid production project id for $fixture." >&2
    exit 65
  fi
  if [[ "$seen_fixtures" == *" $fixture "* ]]; then
    echo "Duplicate key row for $fixture." >&2
    exit 65
  fi

  mkdir -p "$environment_dir"
  destination="$environment_dir/$fixture.production.env"
  temporary="$(mktemp "$environment_dir/.${fixture}.production.env.XXXXXX")"
  printf 'REJOURNEY_PUBLIC_KEY=%s\nREJOURNEY_API_URL=%s\nREJOURNEY_PROJECT_ID=%s\n' \
    "$public_key" "$api_url" "$project_id" > "$temporary"
  if [[ "$fixture" == "expo" ]]; then
    google_maps_key="${MATRIX_GOOGLE_MAPS_API_KEY:-$(read_existing_value "$destination" GOOGLE_MAPS_API_KEY)}"
    mapbox_token="${MATRIX_MAPBOX_ACCESS_TOKEN:-$(read_existing_value "$destination" MAPBOX_ACCESS_TOKEN)}"
    printf 'GOOGLE_MAPS_API_KEY=%s\nMAPBOX_ACCESS_TOKEN=%s\n' \
      "$google_maps_key" "$mapbox_token" >> "$temporary"
  fi
  chmod 600 "$temporary"
  mv "$temporary" "$destination"
  seen_fixtures+="$fixture "
done

for fixture in expo brew swift flutter; do
  if [[ "$seen_fixtures" != *" $fixture "* ]]; then
    echo "Missing production key row for $fixture." >&2
    exit 65
  fi
done

echo "Updated four ignored production matrix environment files."
