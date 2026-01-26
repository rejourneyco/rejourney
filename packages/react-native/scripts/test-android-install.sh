#!/bin/bash

# Script to test Android installation from a packed npm package
# This simulates what users will experience when installing your package

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DIR="/tmp/rejourney-android-test"

echo "🧪 Testing Android Installation"
echo "==============================="
echo ""

# Step 1: Build the package
echo "📦 Step 1: Building package..."
cd "$PACKAGE_DIR"
npm run prepare

# Step 2: Pack the library
echo ""
echo "📦 Step 2: Packing library..."
PACK_FILE=$(npm pack 2>&1 | tail -1 | sed 's/.*\///')
PACK_PATH="$PACKAGE_DIR/$PACK_FILE"

if [ ! -f "$PACK_PATH" ]; then
    echo "❌ Error: Failed to create package file"
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
npx --yes @react-native-community/cli init ValidationApp --skip-install --skip-git

cd "$TEST_DIR/ValidationApp"

# Step 4: Install the packed library
echo ""
echo "📥 Step 4: Installing packed library..."
npm install "$PACK_PATH"

# Step 5: Verify Android integration
echo ""
echo "🤖 Step 5: Verifying Android integration..."
cd android

if [ ! -f "gradlew" ]; then
    echo "❌ Error: gradlew not found"
    exit 1
fi

chmod +x gradlew

# Step 6: Attempt to build (optional - requires Android SDK)
echo ""
echo "🤖 Step 6: Attempting to build (requires Android SDK)..."

# Check if ANDROID_HOME is set
if [ -n "$ANDROID_HOME" ] || [ -d "$HOME/Library/Android/sdk" ]; then
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
