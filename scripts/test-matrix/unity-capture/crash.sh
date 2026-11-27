#!/usr/bin/env bash
# Usage: crash.sh <ios-sim|android> <fault[:state]>
# A probe run that ends in the fault, then a recover run in which native uploads the report.
# Faults: abort, segv, thread, java, none. States: paused, rolled, late, late-paused, reporter-first, reporter-last.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
lane="${1:-}"; mode="${2:-}"
[[ -n "$lane" && -n "$mode" ]] || { echo "Usage: $0 <ios-sim|android> <fault[:state]>" >&2; exit 64; }
tag="${mode//:/-}"
probe_timeout=90; [[ "$mode" == *late* ]] && probe_timeout=900
EXPECT_EXIT=1 WAIT_FILE=crashlab-done.json TIMEOUT="$probe_timeout" TAIL=14 "$script_dir/run.sh" "$lane" "crash-$tag-probe" --crash-probe "$mode"
sleep 2
NO_INSTALL=1 WAIT_FILE=crashlab-done.json TIMEOUT=120 TAIL=4 "$script_dir/run.sh" "$lane" "crash-$tag-recover" --crash-recover
