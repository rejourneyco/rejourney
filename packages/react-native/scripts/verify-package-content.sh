#!/bin/bash

# Script to verify the contents of the packed npm package
# This ensures critical folders (ios, android, lib) are included
# and that there is no unnecessary bloat.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🔍 Verifying Package Content"
echo "============================"
echo ""

cd "$PACKAGE_DIR"

# Step 1: Pack the library
echo "📦 Packing library..."
PACK_FILE=$(npm pack 2>&1 | tail -1 | sed 's/.*\///')

if [ ! -f "$PACK_FILE" ]; then
    echo "❌ Error: Failed to create package file"
    exit 1
fi

# Step 2: List contents
echo "📋 Listing package contents..."
CONTENTS=$(tar -tf "$PACK_FILE")

# Step 3: Verify critical folders
CRITICAL_FOLDERS=("package/ios/" "package/android/" "package/lib/commonjs/" "package/lib/module/" "package/lib/typescript/")
MISSING=0

for folder in "${CRITICAL_FOLDERS[@]}"; do
    if echo "$CONTENTS" | grep -q "^$folder"; then
        echo "✅ Found: $folder"
    else
        echo "❌ Missing: $folder"
        MISSING=1
    fi
done

# Step 4: Check for bloat (optional)
BLOAT_FOLDERS=("package/node_modules/" "package/src/__tests__/" "package/ios/build/" "package/android/.gradle/")
FOUND_BLOAT=0

for folder in "${BLOAT_FOLDERS[@]}"; do
    if echo "$CONTENTS" | grep -q "^$folder"; then
        echo "⚠️  Bloat found: $folder"
        FOUND_BLOAT=1
    fi
done

# Step 5: Cleanup
rm "$PACK_FILE"

if [ $MISSING -eq 1 ]; then
    echo ""
    echo "❌ Validation failed: One or more critical folders are missing."
    exit 1
fi

if [ $FOUND_BLOAT -eq 1 ]; then
    echo ""
    echo "⚠️  Validation passed with warnings: Unnecessary files found in package."
else
    echo ""
    echo "✅ All critical folders found and no bloat detected!"
fi
