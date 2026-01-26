#!/bin/bash

# Script to test iOS installation from a packed npm package
# This simulates what users will experience when installing your package

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DIR="/tmp/rejourney-ios-test"

echo "🧪 Testing iOS Installation"
echo "============================"
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

# Check if react-native CLI is available
if ! command -v npx &> /dev/null; then
    echo "❌ Error: npx is not installed"
    exit 1
fi

echo "Creating React Native app (this may take a few minutes)..."
npx --yes react-native@latest init ValidationApp --skip-install --skip-git

cd "$TEST_DIR/ValidationApp"

# Step 4: Install the packed library
echo ""
echo "📥 Step 4: Installing packed library..."
npm install "$PACK_PATH"

# Step 5: Install pods
echo ""
echo "🍎 Step 5: Installing CocoaPods..."
cd ios

if ! command -v pod &> /dev/null; then
    echo "❌ Error: CocoaPods is not installed. Install with: sudo gem install cocoapods"
    exit 1
fi

pod install

# Step 6: Verify podspec was found
echo ""
echo "🔍 Step 6: Verifying podspec integration..."
if grep -q "rejourney" Podfile.lock; then
    echo "✅ rejourney pod found in Podfile.lock"
else
    echo "❌ Error: rejourney pod not found in Podfile.lock"
    exit 1
fi

# Step 7: Try to build (optional - requires Xcode)
echo ""
echo "📱 Step 7: Attempting to build (requires Xcode)..."
if command -v xcodebuild &> /dev/null; then
    xcodebuild -workspace ValidationApp.xcworkspace \
               -scheme ValidationApp \
               -configuration Debug \
               -sdk iphonesimulator \
               -destination 'platform=iOS Simulator,name=iPhone 15' \
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
