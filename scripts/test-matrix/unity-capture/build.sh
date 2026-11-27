#!/usr/bin/env bash
# Usage: build.sh <mac|ios-sim|android> [log-name]
# Lanes: REJOURNEY_COLORSPACE=gamma, REJOURNEY_GRAPHICS=gles3, REJOURNEY_VULKAN_PRETRANSFORM=1,
# REJOURNEY_ANDROID_BLIT=always|auto|never, REJOURNEY_METAL_WRITE_ONLY=1.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
lane="${1:-}"; name="${2:-build-$lane}"
case "$lane" in
  mac) target=StandaloneOSX; method=Mac ;;
  ios-sim) target=iOS; method=IOSSimulator; load_environment ;;
  android) target=Android; method=Android; load_environment ;;
  *) echo "Usage: $0 <mac|ios-sim|android> [log-name]" >&2; exit 64 ;;
esac
log="$out/logs/$name.log"
if ! "$unity" -batchmode -nographics -quit -projectPath "$project" -buildTarget "$target" -executeMethod "MatrixBuild.$method" -logFile "$log"; then
  grep -E "error CS|BuildFailedException|Build Finished" "$log" | sort -u | head -20 >&2
  exit 1
fi
if [[ "$lane" == ios-sim ]]; then
  xcodebuild -project "$project/build/ios-sim/Unity-iPhone.xcodeproj" -scheme Unity-iPhone -configuration Debug -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$project/build/ios-sim-derived" ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO \
    > "$out/logs/$name-xcodebuild.log" 2>&1 || { tail -n 20 "$out/logs/$name-xcodebuild.log" >&2; exit 1; }
fi
echo "Built $lane ($log)"
