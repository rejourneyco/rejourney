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

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
env_file="$script_dir/environments/$fixture.$environment.env"

if [[ ! -f "$env_file" ]]; then
  echo "Missing ignored matrix environment file: $env_file" >&2
  echo "Copy the matching .env.example and add the intended project key." >&2
  exit 78
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

: "${REJOURNEY_PUBLIC_KEY:?REJOURNEY_PUBLIC_KEY is required in $env_file}"
: "${REJOURNEY_API_URL:?REJOURNEY_API_URL is required in $env_file}"
if [[ "$REJOURNEY_PUBLIC_KEY" != rj_* ]]; then
  echo "REJOURNEY_PUBLIC_KEY in $env_file does not look like a public project key." >&2
  exit 78
fi
if [[ "$REJOURNEY_API_URL" != http://* && "$REJOURNEY_API_URL" != https://* ]]; then
  echo "REJOURNEY_API_URL in $env_file must be an HTTP(S) URL." >&2
  exit 78
fi

if [[ "$environment" == "local" && "$platform" == "android" ]]; then
  REJOURNEY_API_URL="${REJOURNEY_API_URL/127.0.0.1/10.0.2.2}"
  export REJOURNEY_API_URL
fi

run_id="${TEST_MATRIX_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$fixture-$platform}"
artifact_dir="$repo_root/test-results/sdk-matrix/$run_id"
mkdir -p "$artifact_dir"

echo "Matrix target: fixture=$fixture platform=$platform environment=$environment"
echo "Artifacts: $artifact_dir"
echo "Rejourney endpoint: $REJOURNEY_API_URL"

refresh_react_native_ios_pods() {
  if [[ "$platform" != "ios" ]]; then
    return
  fi

  # Local file: SDK dependencies can change their native source set without
  # changing the fixture's package manifest. Refresh the generated Pods project
  # so a stale workspace cannot silently omit a newly added Swift/Obj-C file.
  local sdk_version installed_version pods_project source_file source_name
  local generated_sources_current=true
  sdk_version="$(node -p "require('$repo_root/packages/react-native/package.json').version")"
  installed_version="$(sed -nE 's/^  - rejourney \(([^)]+)\).*/\1/p' ios/Podfile.lock 2>/dev/null | head -n 1)"
  pods_project="ios/Pods/Pods.xcodeproj/project.pbxproj"

  if [[ ! -f "$pods_project" || "$installed_version" != "$sdk_version" ]]; then
    generated_sources_current=false
  else
    while IFS= read -r source_file; do
      source_name="$(basename "$source_file")"
      if ! grep -Fq "/* $source_name" "$pods_project"; then
        generated_sources_current=false
        break
      fi
    done < <(find "$repo_root/packages/react-native/ios" -type f \
      \( -name '*.h' -o -name '*.m' -o -name '*.mm' -o -name '*.swift' \) \
      ! -path '*/build/*' | sort)
  fi

  if [[ "$generated_sources_current" == true ]]; then
    echo "CocoaPods workspace already contains rejourney $sdk_version and its native source set."
    return
  fi

  pod install --project-directory=ios --no-ansi \
    | tee "$artifact_dir/pod-install.log"
}

case "$fixture" in
  expo)
    export ENV="test-matrix-$environment"
    export API_URL="${API_URL:-https://example.com}"
    cd "$repo_root/examples/react-native-boilerplate"
    refresh_react_native_ios_pods
    if [[ -n "${TEST_MATRIX_NODE_BIN:-}" ]]; then
      exec "$TEST_MATRIX_NODE_BIN" node_modules/expo/bin/cli "run:$platform" \
        --port "${TEST_MATRIX_METRO_PORT:-8081}"
    fi
    exec npm run "$platform" -- --port "${TEST_MATRIX_METRO_PORT:-8081}"
    ;;
  brew)
    export ENV="test-matrix-$environment"
    cd "$repo_root/examples/brew-coffee-labs"
    refresh_react_native_ios_pods
    if [[ -n "${TEST_MATRIX_NODE_BIN:-}" ]]; then
      exec "$TEST_MATRIX_NODE_BIN" node_modules/expo/bin/cli "run:$platform" \
        --port "${TEST_MATRIX_METRO_PORT:-8081}"
    fi
    exec npm run "$platform" -- --port "${TEST_MATRIX_METRO_PORT:-8081}"
    ;;
  swift)
    device_id="${TEST_MATRIX_DEVICE:-}"
    if [[ -z "$device_id" ]]; then
      device_id="$(xcrun simctl list devices booted | sed -nE 's/.*\(([0-9A-F-]{36})\) \(Booted\).*/\1/p' | head -n 1)"
    fi
    if [[ -z "$device_id" ]]; then
      echo "Boot one iOS Simulator or set TEST_MATRIX_DEVICE in $env_file." >&2
      exit 69
    fi
    configuration="${TEST_MATRIX_BUILD_MODE:-Debug}"
    derived_data="$artifact_dir/DerivedData"
    xcodebuild \
      -project "$repo_root/examples/swift-clean-arch/CountriesSwiftUI.xcodeproj" \
      -scheme CountriesSwiftUI \
      -configuration "$configuration" \
      -destination "platform=iOS Simulator,id=$device_id" \
      -derivedDataPath "$derived_data" \
      CODE_SIGNING_ALLOWED=NO \
      build | tee "$artifact_dir/xcodebuild.log"
    app_path="$derived_data/Build/Products/$configuration-iphonesimulator/CountriesSwiftUI.app"
    xcrun simctl install "$device_id" "$app_path"
    SIMCTL_CHILD_REJOURNEY_PUBLIC_KEY="$REJOURNEY_PUBLIC_KEY" \
      SIMCTL_CHILD_REJOURNEY_API_URL="$REJOURNEY_API_URL" \
      SIMCTL_CHILD_ENV="test-matrix-$environment" \
      xcrun simctl launch --terminate-running-process \
        "$device_id" com.swiftui.CountriesSwiftUI
    ;;
  flutter)
    device_id="${TEST_MATRIX_DEVICE:-}"
    if [[ -z "$device_id" && "$platform" == "ios" ]]; then
      device_id="$(xcrun simctl list devices booted | sed -nE 's/.*\(([0-9A-F-]{36})\) \(Booted\).*/\1/p' | head -n 1)"
    elif [[ -z "$device_id" ]]; then
      device_id="$(adb devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')"
    fi
    if [[ -z "$device_id" ]]; then
      echo "Boot a $platform target or set TEST_MATRIX_DEVICE in $env_file." >&2
      exit 69
    fi
    build_flag=""
    case "${TEST_MATRIX_BUILD_MODE:-debug}" in
      debug|Debug) ;;
      profile|Profile) build_flag="--profile" ;;
      release|Release) build_flag="--release" ;;
      *) echo "TEST_MATRIX_BUILD_MODE must be debug, profile, or release." >&2; exit 64 ;;
    esac
    cd "$repo_root/packages/rejourney/example"
    flutter_args=(run -d "$device_id")
    if [[ -n "$build_flag" ]]; then
      flutter_args+=("$build_flag")
    fi
    flutter_args+=(
      "--dart-define=REJOURNEY_PUBLIC_KEY=$REJOURNEY_PUBLIC_KEY"
      "--dart-define=REJOURNEY_API_URL=$REJOURNEY_API_URL"
    )
    exec flutter "${flutter_args[@]}"
    ;;
esac
