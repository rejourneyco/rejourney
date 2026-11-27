#!/usr/bin/env bash
# Shared paths for the Unity capture matrix lab (examples/unity-capture-matrix).
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../.." && pwd)"
project="$repo_root/examples/unity-capture-matrix"
out="${REJOURNEY_MATRIX_OUT:-$repo_root/test-results/sdk-matrix/unity-capture}"
unity="${UNITY:-/Applications/Unity/Hub/Editor/6000.6.10f1/Unity.app/Contents/MacOS/Unity}"
package_id="co.rejourney.arcadelab"
adb="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
mkdir -p "$out/logs" "$out/reports"

# The public project key for cloud runs; loopback runs need none.
load_environment() {
  local env_file="$repo_root/scripts/test-matrix/environments/unity.production.env"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

simulator_udid() {
  if [[ -n "${SIM_UDID:-}" ]]; then echo "$SIM_UDID"; return; fi
  xcrun simctl list devices booted | sed -nE 's/.*\(([0-9A-F-]{36})\) \(Booted\).*/\1/p' | head -n 1
}
