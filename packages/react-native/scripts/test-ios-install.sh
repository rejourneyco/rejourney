#!/bin/bash

# Script to test iOS installation from a packed npm package
# This simulates what users will experience when installing your package

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DIR="/tmp/rejourney-ios-test"
NPM_CACHE_DIR="$TEST_DIR/.npm-cache"
RN_VERSION="${RN_VERSION:-}"

mkdir -p "$NPM_CACHE_DIR"
export npm_config_cache="$NPM_CACHE_DIR"

echo "🧪 Testing iOS Installation"
echo "============================"
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

# Check if react-native CLI is available
if ! command -v npx &> /dev/null; then
    echo "❌ Error: npx is not installed"
    exit 1
fi

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
BUNDLE_DIR="$TEST_DIR/ValidationApp/.rejourney-smoke/ios"
mkdir -p "$BUNDLE_DIR/assets"
npx react-native bundle \
    --platform ios \
    --dev false \
    --entry-file index.js \
    --bundle-output "$BUNDLE_DIR/main.jsbundle" \
    --assets-dest "$BUNDLE_DIR/assets" \
    --reset-cache

# Step 7: Install pods
echo ""
echo "🍎 Step 7: Installing CocoaPods..."
cd ios

if ! command -v pod &> /dev/null; then
    echo "❌ Error: CocoaPods is not installed. Install with: sudo gem install cocoapods"
    exit 1
fi

pod install

# Step 8: Verify podspec was found
echo ""
echo "🔍 Step 8: Verifying podspec integration..."
if grep -q "rejourney" Podfile.lock; then
    echo "✅ rejourney pod found in Podfile.lock"
else
    echo "❌ Error: rejourney pod not found in Podfile.lock"
    exit 1
fi

# Step 9: Try to build (optional - requires Xcode)
echo ""
echo "📱 Step 9: Attempting to build (requires Xcode)..."
if command -v xcodebuild &> /dev/null; then
    DESTINATION="generic/platform=iOS Simulator"
    xcodebuild -workspace ValidationApp.xcworkspace \
               -scheme ValidationApp \
               -configuration Debug \
               -sdk iphonesimulator \
               -destination "$DESTINATION" \
               clean build \
               CODE_SIGNING_ALLOWED=NO \
               2>&1 | tee /tmp/xcodebuild.log
    
    if [ ${PIPESTATUS[0]} -eq 0 ]; then
        echo "✅ Build succeeded!"
    else
        echo "❌ Build failed. Check /tmp/xcodebuild.log for details"
        exit 1
    fi
else
    echo "⚠️  xcodebuild not found. Skipping build step."
    echo "   To test building, install Xcode Command Line Tools:"
    echo "   xcode-select --install"
fi

echo ""
echo "✅ All checks passed!"
echo ""
echo "Test app location: $TEST_DIR/ValidationApp"
echo "You can now manually test the installation by:"
echo "  1. cd $TEST_DIR/ValidationApp"
echo "  2. npx react-native run-ios"
