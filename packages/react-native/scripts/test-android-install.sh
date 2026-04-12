#!/bin/bash

# Script to test Android installation from a packed npm package
# This simulates what users will experience when installing your package

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# Override in CI (e.g. matrix jobs) to avoid parallel workers clashing on /tmp.
TEST_DIR="${REJOURNEY_INSTALL_TEST_DIR:-/tmp/rejourney-android-test}"
NPM_CACHE_DIR="$TEST_DIR/.npm-cache"
RN_VERSION="${RN_VERSION:-}"

mkdir -p "$NPM_CACHE_DIR"
export npm_config_cache="$NPM_CACHE_DIR"

echo "🧪 Testing Android Installation"
echo "==============================="
echo ""
if [ -n "$RN_VERSION" ]; then
    echo "Using React Native version: $RN_VERSION"
    echo ""
fi

# Step 1: Build the package
echo "📦 Step 1: Building package..."
cd "$PACKAGE_DIR"
npm run prepare

# Step 2: Pack the library
echo ""
echo "📦 Step 2: Packing library..."
PACK_OUTPUT=$(npm pack --json)
if ! PACK_FILE=$(printf '%s' "$PACK_OUTPUT" | node -e "const fs = require('fs'); const text = fs.readFileSync(0, 'utf8'); const match = text.match(/(?:^|\\n)(\\[\\s*\\{[\\s\\S]*\\])\\s*$/); if (!match) process.exit(1); const data = JSON.parse(match[1]); process.stdout.write(data[0]?.filename || '');"); then
    PACK_FILE=""
fi
PACK_PATH="$PACKAGE_DIR/$PACK_FILE"

if [ ! -f "$PACK_PATH" ]; then
    echo "❌ Error: Failed to create package file"
    if [ -n "$PACK_OUTPUT" ]; then
        echo "$PACK_OUTPUT"
    fi
    exit 1
fi

echo "✅ Created package: $PACK_FILE"

# Step 3: Create a fresh test app
echo ""
echo "📱 Step 3: Creating fresh React Native test app..."
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo "Creating React Native app (this may take a few minutes)..."
INIT_ARGS=(--skip-install --skip-git-init)
if [ -n "$RN_VERSION" ]; then
    INIT_ARGS+=(--version "$RN_VERSION")
fi
npx --yes @react-native-community/cli init ValidationApp "${INIT_ARGS[@]}"

cd "$TEST_DIR/ValidationApp"

# Step 4: Install the packed library
echo ""
echo "📥 Step 4: Installing packed library..."
npm install "$PACK_PATH"

# Step 5: Import the package in JS so Metro resolves the published entrypoint
echo ""
echo "🧩 Step 5: Wiring the package into the validation app..."
node "$PACKAGE_DIR/scripts/configure-validation-app.js" "$TEST_DIR/ValidationApp"

# Step 6: Bundle the app without optional peers to verify Metro-safe imports
echo ""
echo "📦 Step 6: Bundling the app to verify JS dependency resolution..."
BUNDLE_DIR="$TEST_DIR/ValidationApp/.rejourney-smoke/android"
mkdir -p "$BUNDLE_DIR/assets"
npx react-native bundle \
    --platform android \
    --dev false \
    --entry-file index.js \
    --bundle-output "$BUNDLE_DIR/index.android.bundle" \
    --assets-dest "$BUNDLE_DIR/assets" \
    --reset-cache

# Step 7: Verify Android integration
echo ""
echo "🤖 Step 7: Verifying Android integration..."
cd android

if [ -z "$ANDROID_HOME" ] && [ -n "$ANDROID_SDK_ROOT" ]; then
    export ANDROID_HOME="$ANDROID_SDK_ROOT"
fi
if [ -z "$ANDROID_HOME" ] && [ -d "$HOME/Library/Android/sdk" ]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
fi
if [ -z "$ANDROID_HOME" ] && [ -d "$HOME/Android/Sdk" ]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
fi

if [ -n "$ANDROID_HOME" ] && [ ! -f "local.properties" ]; then
    printf "sdk.dir=%s\n" "$ANDROID_HOME" > local.properties
fi

if [ ! -f "gradlew" ]; then
    echo "❌ Error: gradlew not found"
    exit 1
fi

chmod +x gradlew

# Step 8: Attempt to build (optional - requires Android SDK)
echo ""
echo "🤖 Step 8: Attempting to build (requires Android SDK)..."

# Check if Android SDK is available
if [ -n "$ANDROID_HOME" ] || [ -d "$HOME/Library/Android/sdk" ] || [ -d "$HOME/Android/Sdk" ]; then
    if [ -z "$ANDROID_HOME" ] && [ -d "$HOME/Android/Sdk" ]; then
        export ANDROID_HOME="$HOME/Android/Sdk"
    fi
    ./gradlew assembleDebug --no-daemon
    
    if [ $? -eq 0 ]; then
        echo "✅ Android build succeeded!"
    else
        echo "❌ Android build failed."
        exit 1
    fi
else
    echo "⚠️  Android SDK not found (ANDROID_HOME not set). Skipping build step."
    echo "   To test building, ensure Android SDK is installed and ANDROID_HOME is set."
fi

echo ""
echo "✅ All checks passed!"
echo ""
echo "Test app location: $TEST_DIR/ValidationApp"
