#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT

input=$'expo\trj_11111111111111111111111111111111\t11111111-1111-1111-1111-111111111111\n'
input+=$'brew\trj_22222222222222222222222222222222\t22222222-2222-2222-2222-222222222222\n'
input+=$'swift\trj_33333333333333333333333333333333\t33333333-3333-3333-3333-333333333333\n'
input+=$'flutter\trj_44444444444444444444444444444444\t44444444-4444-4444-4444-444444444444\n'

MATRIX_ENVIRONMENT_DIR="$temporary_dir" \
MATRIX_GOOGLE_MAPS_API_KEY="test-google-maps-key" \
MATRIX_MAPBOX_ACCESS_TOKEN="pk.test-mapbox-token" \
  "$script_dir/write-production-keys.sh" <<< "$input" >/dev/null

for fixture in expo brew swift flutter; do
  file="$temporary_dir/$fixture.production.env"
  [[ -f "$file" ]]
  [[ "$(stat -f '%Lp' "$file")" == "600" ]]
  grep -q '^REJOURNEY_PUBLIC_KEY=rj_[0-9]\{32\}$' "$file"
  grep -q '^REJOURNEY_API_URL=https://api.rejourney.co$' "$file"
  grep -q '^REJOURNEY_PROJECT_ID=[0-9a-f-]\{36\}$' "$file"
done

grep -q '^GOOGLE_MAPS_API_KEY=test-google-maps-key$' "$temporary_dir/expo.production.env"
grep -q '^MAPBOX_ACCESS_TOKEN=pk.test-mapbox-token$' "$temporary_dir/expo.production.env"

# A later key refresh must preserve the project ids and optional provider
# credentials when no replacement is supplied.
refresh_input=$'expo\trj_11111111111111111111111111111111\n'
refresh_input+=$'brew\trj_22222222222222222222222222222222\n'
refresh_input+=$'swift\trj_33333333333333333333333333333333\n'
refresh_input+=$'flutter\trj_44444444444444444444444444444444\n'
MATRIX_ENVIRONMENT_DIR="$temporary_dir" \
  "$script_dir/write-production-keys.sh" <<< "$refresh_input" >/dev/null
grep -q '^GOOGLE_MAPS_API_KEY=test-google-maps-key$' "$temporary_dir/expo.production.env"
grep -q '^MAPBOX_ACCESS_TOKEN=pk.test-mapbox-token$' "$temporary_dir/expo.production.env"
grep -q '^REJOURNEY_PROJECT_ID=11111111-1111-1111-1111-111111111111$' "$temporary_dir/expo.production.env"

if MATRIX_ENVIRONMENT_DIR="$temporary_dir/invalid" \
  "$script_dir/write-production-keys.sh" \
  <<< $'expo\tnot-a-key\n' >/dev/null 2>&1; then
  echo "Invalid public key unexpectedly succeeded." >&2
  exit 1
fi

if MATRIX_ENVIRONMENT_DIR="$temporary_dir/incomplete" \
  "$script_dir/write-production-keys.sh" \
  <<< $'expo\trj_11111111111111111111111111111111\n' >/dev/null 2>&1; then
  echo "Incomplete fixture set unexpectedly succeeded." >&2
  exit 1
fi

echo "Production matrix key writer tests passed."
