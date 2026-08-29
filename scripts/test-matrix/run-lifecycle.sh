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
case "$environment" in
  production|local) ;;
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

case "$fixture" in
  swift) active_ready="Countries"; paused_ready="Beta SDK Pause" ;;
  flutter) active_ready="Rejourney Flutter"; paused_ready="Rejourney Flutter" ;;
  *) active_ready="Home.*"; paused_ready="Beta SDK Pause" ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
maestro_bin="${MAESTRO_BIN:-/Users/mora/.maestro/bin/maestro}"
env_file="$script_dir/environments/$fixture.$environment.env"
run_id="${TEST_MATRIX_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$fixture-$platform-lifecycle}"
artifact_root="$repo_root/test-results/sdk-matrix/$run_id"

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

run_phase() {
  local phase="$1"
  local flow="$2"
  local ready_text="${3:-}"
  local phase_dir="$artifact_root/$phase"
  local args=(
    test
    --no-ansi
    --format HTML-DETAILED
    --output "$phase_dir/report.html"
    --test-output-dir "$phase_dir/maestro"
    -e "APP_ID=$app_id"
  )
  mkdir -p "$phase_dir"
  if [[ -n "$ready_text" ]]; then
    args+=(-e "READY_TEXT=$ready_text")
  fi
  if [[ -n "${TEST_MATRIX_DEVICE:-}" ]]; then
    args+=(--device "$TEST_MATRIX_DEVICE")
  fi
  args+=("$flow")
  "$maestro_bin" "${args[@]}" | tee "$phase_dir/maestro.log"
}

last_inspected_session_id=""
inspect_production() {
  local phase="$1"
  local requested_session_id="${2:-}"
  local expectation="${3:-}"
  local phase_dir="$artifact_root/$phase"
  local output
  local args=("$script_dir/inspect-production-session.sh" "$fixture")
  if [[ "$environment" != "production" ]]; then
    return
  fi
  if [[ -n "$requested_session_id" ]]; then
    args+=("$requested_session_id")
  fi
  if [[ -n "$expectation" ]]; then
    args+=("$expectation")
  fi
  mkdir -p "$phase_dir"
  output="$("${args[@]}")"
  printf '%s\n' "$output" | tee "$phase_dir/production-session.txt"
  last_inspected_session_id="$(printf '%s\n' "$output" | sed -nE 's/^session_id=(.+)$/\1/p' | head -n 1)"
  if [[ -z "$last_inspected_session_id" ]]; then
    echo "Production inspector did not return a session id." >&2
    exit 1
  fi
}

background_flow="$script_dir/flows/lifecycle/background.yaml"
foreground_flow="$script_dir/flows/lifecycle/foreground.yaml"
pause_flow="$script_dir/flows/lifecycle/$fixture-pause.yaml"
resume_flow="$script_dir/flows/lifecycle/$fixture-resume.yaml"
paused_interaction_flow="$script_dir/flows/lifecycle/paused-interaction.yaml"

case "$fixture" in
  brew) run_phase prepare "$script_dir/flows/lifecycle/brew-prepare.yaml" ;;
  flutter) run_phase prepare "$script_dir/flows/lifecycle/flutter-prepare.yaml" ;;
esac

echo "L1: active session, 5-second background"
run_phase active-short-background "$background_flow"
sleep 5
run_phase active-short-foreground "$foreground_flow" "$active_ready"

echo "L2: active session, 70-second intentional rollover"
run_phase active-rollover-background "$background_flow"
sleep 70
run_phase active-rollover-foreground "$foreground_flow" "$active_ready"

echo "L6: paused session, duplicate pause, 5-second background"
run_phase paused-prepare-short "$pause_flow"
run_phase paused-human-interaction "$paused_interaction_flow"
sleep 70
inspect_production paused-foreground-assertion "" --expect-paused
foreground_paused_session_id="$last_inspected_session_id"
run_phase paused-short-background "$background_flow"
sleep 5
run_phase paused-short-foreground "$foreground_flow" "$paused_ready"
run_phase paused-resume-short "$resume_flow"
inspect_production resumed-foreground-assertion "$foreground_paused_session_id" --expect-resumed

echo "L6: paused session, duplicate pause, 70-second rollover"
run_phase paused-prepare-rollover "$pause_flow"
inspect_production paused-before-rollover-assertion "" --expect-paused
rollover_source_session_id="$last_inspected_session_id"
run_phase paused-rollover-background "$background_flow"
sleep 70
run_phase paused-rollover-foreground "$foreground_flow" "$paused_ready"
inspect_production paused-after-rollover-assertion "" --expect-paused
rollover_replacement_session_id="$last_inspected_session_id"
if [[ "$rollover_replacement_session_id" == "$rollover_source_session_id" ]]; then
  echo "The 70-second background did not create a replacement session." >&2
  exit 1
fi
inspect_production ended-rollover-source-assertion "$rollover_source_session_id" --expect-ended
run_phase paused-resume-rollover "$resume_flow"
inspect_production resumed-rollover-replacement-assertion "$rollover_replacement_session_id" --expect-resumed

echo "Lifecycle artifacts: $artifact_root"
