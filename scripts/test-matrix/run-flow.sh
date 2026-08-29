#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <expo|brew|swift|flutter> <ios|android> [production|local]" >&2
  exit 64
}

fixture="${1:-}"
platform="${2:-}"
environment="${3:-production}"
case "$fixture" in
  expo|brew|swift|flutter) ;;
  *) usage ;;
esac
case "$platform" in
  ios|android) ;;
  *) usage ;;
esac
if [[ "$fixture" == "swift" && "$platform" != "ios" ]]; then
  echo "The Swift Countries fixture supports iOS only." >&2
  exit 64
fi

case "$fixture/$platform" in
  expo/ios) app_id="com.watarumaeda.react-native-boilerplate" ;;
  expo/android) app_id="com.watarumaeda.react_native_boilerplate" ;;
  brew/ios|brew/android) app_id="com.example.brew" ;;
  swift/ios) app_id="com.swiftui.CountriesSwiftUI" ;;
  flutter/ios) app_id="co.rejourney.rejourneyExample" ;;
  flutter/android) app_id="co.rejourney.rejourney_example" ;;
  *) usage ;;
esac
case "$environment" in
  production|local) ;;
  *) usage ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
default_flow="$script_dir/flows/$fixture-$platform.yaml"
flow="${TEST_MATRIX_FLOW:-$default_flow}"
if [[ "$flow" != /* ]]; then
  flow="$script_dir/flows/$flow"
fi
case "$flow" in
  "$script_dir"/flows/*.yaml) ;;
  *)
    echo "TEST_MATRIX_FLOW must resolve inside $script_dir/flows." >&2
    exit 64
    ;;
esac
if [[ ! -f "$flow" ]]; then
  echo "Matrix flow does not exist: $flow" >&2
  exit 66
fi
maestro_bin="${MAESTRO_BIN:-/Users/mora/.maestro/bin/maestro}"
env_file="$script_dir/environments/$fixture.$environment.env"
run_id="${TEST_MATRIX_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$fixture-$platform}"
artifact_dir="$repo_root/test-results/sdk-matrix/$run_id"
mkdir -p "$artifact_dir"

if [[ ! -f "$env_file" ]]; then
  echo "Missing ignored matrix environment file: $env_file" >&2
  exit 78
fi
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a
: "${REJOURNEY_PUBLIC_KEY:?REJOURNEY_PUBLIC_KEY is required in $env_file}"

if [[ ! -x "$maestro_bin" ]]; then
  echo "Maestro is unavailable at $maestro_bin." >&2
  exit 69
fi

maestro_args=(
  test
  --no-ansi
  --format HTML-DETAILED
  --output "$artifact_dir/report.html"
  --test-output-dir "$artifact_dir/maestro"
  -e "APP_ID=$app_id"
)
if [[ -n "${TEST_MATRIX_DEVICE:-}" ]]; then
  maestro_args+=(--device "$TEST_MATRIX_DEVICE")
fi
maestro_args+=("$flow")

echo "Running $fixture/$platform at human interaction cadence."
echo "Flow: ${flow#"$script_dir/flows/"}"
echo "Artifacts: $artifact_dir"
cd "$artifact_dir"
"$maestro_bin" "${maestro_args[@]}" | tee "$artifact_dir/maestro.log"
