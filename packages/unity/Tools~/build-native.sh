#!/usr/bin/env bash
set -euo pipefail
PACKAGE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNITY_ROOT="${REJOURNEY_UNITY_ROOT:-/Applications/Unity/Hub/Editor/6000.6.2f1}"
OUTPUT_ROOT="${REJOURNEY_NATIVE_OUTPUT:-/tmp/rejourney-unity-native}"
mkdir -p "$OUTPUT_ROOT"
case "${1:-all}" in
  ios|all)
    cd "$PACKAGE_ROOT/Native~/iOS"
    for platform in iphoneos iphonesimulator; do
      destination='generic/platform=iOS'
      if [[ "$platform" == iphonesimulator ]]; then destination='generic/platform=iOS Simulator'; fi
      xcodebuild -scheme RejourneyUnity -sdk "$platform" -destination "$destination" \
        -derivedDataPath "$OUTPUT_ROOT/derived-$platform" -archivePath "$OUTPUT_ROOT/$platform.xcarchive" \
        SKIP_INSTALL=NO BUILD_LIBRARY_FOR_DISTRIBUTION=YES CODE_SIGNING_ALLOWED=NO archive \
        > "$OUTPUT_ROOT/$platform.log" 2>&1
      cp Sources/Rejourney/Resources/PrivacyInfo.xcprivacy "$OUTPUT_ROOT/$platform.xcarchive/Products/usr/local/lib/RejourneyUnity.framework/PrivacyInfo.xcprivacy"
    done
    # Create into a fresh temporary output so failed builds retain the previous artifact.
    stage="$(mktemp -d "$OUTPUT_ROOT/framework.XXXXXX")"
    xcodebuild -create-xcframework \
      -framework "$OUTPUT_ROOT/iphoneos.xcarchive/Products/usr/local/lib/RejourneyUnity.framework" \
      -framework "$OUTPUT_ROOT/iphonesimulator.xcarchive/Products/usr/local/lib/RejourneyUnity.framework" \
      -output "$stage/RejourneyUnity.xcframework"
    mkdir -p "$PACKAGE_ROOT/Plugins/iOS"
    if [[ -d "$PACKAGE_ROOT/Plugins/iOS/RejourneyUnity.xcframework" ]]; then
      mv "$PACKAGE_ROOT/Plugins/iOS/RejourneyUnity.xcframework" "$stage/previous.xcframework"
    fi
    mv "$stage/RejourneyUnity.xcframework" "$PACKAGE_ROOT/Plugins/iOS/"
    python3 "$PACKAGE_ROOT/Tools~/native-manifest.py" write ios
    ;;
esac
case "${1:-all}" in
  android|all)
    cd "$PACKAGE_ROOT/Native~/Android"
    export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
    export REJOURNEY_NDK="${REJOURNEY_NDK:-$UNITY_ROOT/PlaybackEngines/AndroidPlayer/NDK}"
    "$UNITY_ROOT/PlaybackEngines/AndroidPlayer/OpenJDK/bin/java" \
      -classpath "$UNITY_ROOT/PlaybackEngines/AndroidPlayer/Tools/gradle/lib/*" org.gradle.launcher.GradleMain \
      --no-daemon assembleRelease > "$OUTPUT_ROOT/android.log" 2>&1
    mkdir -p "$PACKAGE_ROOT/Plugins/Android"
    cp build/outputs/aar/rejourney-unity-release.aar "$PACKAGE_ROOT/Plugins/Android/rejourney-unity.aar"
    python3 "$PACKAGE_ROOT/Tools~/native-manifest.py" write android
    ;;
esac
