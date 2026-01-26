#!/bin/bash
# Fix "No such module 'Expo'" error

set -e

cd "$(dirname "$0")"

echo "🔧 Fixing Expo module issue..."

# Clean everything
echo "Cleaning build artifacts..."
rm -rf ios/build
rm -rf ios/Pods
rm -rf ios/Podfile.lock
rm -rf ios/DerivedData

# Clean Xcode derived data
rm -rf ~/Library/Developer/Xcode/DerivedData/*

# Reinstall pods with proper encoding
export LANG=en_US.UTF-8
cd ios
pod install

echo "✅ Done! Now:"
echo "1. Open Xcode"
echo "2. Open ios/ReactNativeBoilerplate.xcworkspace (NOT .xcodeproj)"
echo "3. Product → Clean Build Folder (Shift+Cmd+K)"
echo "4. Product → Build (Cmd+B)"
