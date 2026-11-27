#!/usr/bin/env bash
# Usage: run.sh <mac|ios-sim|android> <name> [app arguments...]
# Launches the lab, waits for its report and copies the report and log to the output folder.
# Performance lab: add --perf (and --perf-native on mobile) with WAIT_FILE=perf-report.json, then perf.py.
# Environment: TIMEOUT (seconds, default 1500), WAIT_FILE (default matrix-report.json),
# EXPECT_EXIT=1 (stop waiting when the app exits), NO_INSTALL=1 (keep the installed app and its data).
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
lane="${1:-}"; name="${2:-}"; shift 2 || { echo "Usage: $0 <mac|ios-sim|android> <name> [arguments...]" >&2; exit 64; }
timeout="${TIMEOUT:-1500}"; wait_file="${WAIT_FILE:-matrix-report.json}"
report="$out/reports/$name.json"; log="$out/logs/run-$name.log"
rm -f "$report"

case "$lane" in
  mac)
    "$project/build/mac/RejourneyMatrix.app/Contents/MacOS/Rejourney Matrix" -screen-fullscreen 0 -screen-width 1280 -screen-height 720 \
      -logFile "$log" --matrix-report "$report" --perf-report "$report" "$@" || true
    ;;
  ios-sim)
    udid="$(simulator_udid)"; [[ -n "$udid" ]] || { echo "Boot a simulator or set SIM_UDID." >&2; exit 69; }
    app="$project/build/ios-sim-derived/Build/Products/Debug-iphonesimulator/RejourneyMatrix.app"
    if [[ -z "${NO_INSTALL:-}" ]]; then xcrun simctl terminate "$udid" "$package_id" >/dev/null 2>&1 || true; xcrun simctl install "$udid" "$app"; fi
    data="$(xcrun simctl get_app_container "$udid" "$package_id" data)/Documents"
    rm -f "$data/matrix-report.json" "$data/perf-report.json" "$data/crashlab-done.json" "$data/lab.log"
    # iOS players see no process arguments; the lab reads LAB_ARGS instead.
    SIMCTL_CHILD_LAB_ARGS="$*" xcrun simctl launch --terminate-running-process "$udid" "$package_id" >/dev/null
    for ((waited = 0; waited < timeout; waited += 2)); do
      [[ -f "$data/$wait_file" ]] && break
      if [[ -n "${EXPECT_EXIT:-}" && $waited -gt 6 ]] && ! xcrun simctl spawn "$udid" launchctl list 2>/dev/null | grep -q "$package_id"; then echo "app exited"; break; fi
      sleep 2
    done
    [[ -f "$data/$wait_file" ]] && cp "$data/$wait_file" "$report"
    cp "$data/lab.log" "$log" 2>/dev/null || true
    [[ -f "$data/lab-reporter.txt" ]] && { echo "stand-in reporter: $(cat "$data/lab-reporter.txt")"; rm -f "$data/lab-reporter.txt"; }
    ;;
  android)
    apk="${APK:-$project/build/android/matrix.apk}"
    "$adb" wait-for-device
    "$adb" root >/dev/null 2>&1 || true; sleep 1; "$adb" wait-for-device
    "$adb" shell am force-stop "$package_id"
    [[ -z "${NO_INSTALL:-}" ]] && "$adb" install -r -g "$apk" | tail -n 1
    data="/sdcard/Android/data/$package_id/files"
    "$adb" shell "rm -f $data/matrix-report.json $data/perf-report.json $data/crashlab-done.json $data/lab.log"
    activity="$("$adb" shell cmd package resolve-activity --brief "$package_id" | tail -n 1 | tr -d '\r')"
    # The lab reads the "args" string extra; quote it for the device shell.
    "$adb" shell "am start -n $activity --es args '$*'" >/dev/null
    for ((waited = 0; waited < timeout; waited += 2)); do
      "$adb" shell "[ -f $data/$wait_file ]" && break
      if [[ -n "${EXPECT_EXIT:-}" && $waited -gt 8 && -z "$("$adb" shell pidof "$package_id" | tr -d '\r')" ]]; then echo "app exited"; break; fi
      sleep 2
    done
    "$adb" shell "cat $data/$wait_file" > "$report" 2>/dev/null || true
    "$adb" shell "cat $data/lab.log" > "$log" 2>/dev/null || true
    ;;
  *) echo "Unknown lane: $lane" >&2; exit 64 ;;
esac
grep -h "\[Matrix\] start\|\[Matrix\] DONE\|\[Matrix\] stop\|\[CrashLab\]" "$log" 2>/dev/null | cut -c1-400 | tail -n "${TAIL:-8}" || true
[[ -s "$report" ]] && echo "report: $report"
