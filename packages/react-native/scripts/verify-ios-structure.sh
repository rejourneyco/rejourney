#!/bin/bash

# Script to verify iOS package structure before publishing
# Checks all the key iOS compatibility requirements

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🔍 Verifying iOS Package Structure"
echo "==================================="
echo ""

ERRORS=0

# Check 1: Verify podspec exists
echo "1️⃣  Checking for podspec file..."
if [ -f "$PACKAGE_DIR/rejourney.podspec" ]; then
    echo "   ✅ rejourney.podspec found"
else
    echo "   ❌ rejourney.podspec not found"
    ERRORS=$((ERRORS + 1))
fi

# Check 2: Verify ios/ directory exists
echo ""
echo "2️⃣  Checking for ios/ directory..."
if [ -d "$PACKAGE_DIR/ios" ]; then
    echo "   ✅ ios/ directory found"
    
    # Count native files
    H_FILES=$(find "$PACKAGE_DIR/ios" -name "*.h" | wc -l | tr -d ' ')
    M_FILES=$(find "$PACKAGE_DIR/ios" -name "*.m" | wc -l | tr -d ' ')
    MM_FILES=$(find "$PACKAGE_DIR/ios" -name "*.mm" | wc -l | tr -d ' ')
    SWIFT_FILES=$(find "$PACKAGE_DIR/ios" -name "*.swift" | wc -l | tr -d ' ')
    
    echo "   📊 Native files found:"
    echo "      - .h files: $H_FILES"
    echo "      - .m files: $M_FILES"
    echo "      - .mm files: $MM_FILES"
    echo "      - .swift files: $SWIFT_FILES"
    
    if [ "$SWIFT_FILES" -gt 0 ]; then
        echo "   ⚠️  Swift files detected. Ensure compatibility (dummy.m or use_modular_headers!)"
    fi
else
    echo "   ❌ ios/ directory not found"
    ERRORS=$((ERRORS + 1))
fi

# Check 3: Verify podspec content
echo ""
echo "3️⃣  Checking podspec configuration..."
if [ -f "$PACKAGE_DIR/rejourney.podspec" ]; then
    PODSPEC="$PACKAGE_DIR/rejourney.podspec"
    
    # Check for install_modules_dependencies
    if grep -q "install_modules_dependencies" "$PODSPEC"; then
        echo "   ✅ Uses install_modules_dependencies (standard React Native helper)"
    else
        echo "   ⚠️  Does not use install_modules_dependencies - may have dependency issues"
    fi
    
    # Check for source_files
    if grep -q "source_files" "$PODSPEC"; then
        echo "   ✅ source_files defined"
    else
        echo "   ❌ source_files not defined in podspec"
        ERRORS=$((ERRORS + 1))
    fi
    
    # Check for platform version
    if grep -q "platforms.*ios" "$PODSPEC"; then
        echo "   ✅ iOS platform specified"
    else
        echo "   ⚠️  iOS platform not explicitly specified"
    fi
fi

# Check 4: Verify package.json peer dependencies
echo ""
echo "4️⃣  Checking package.json peer dependencies..."
if [ -f "$PACKAGE_DIR/package.json" ]; then
    if grep -q '"peerDependencies"' "$PACKAGE_DIR/package.json"; then
        if grep -A 2 '"peerDependencies"' "$PACKAGE_DIR/package.json" | grep -q "react"; then
            echo "   ✅ react in peerDependencies"
        else
            echo "   ❌ react not in peerDependencies"
            ERRORS=$((ERRORS + 1))
        fi
        
        if grep -A 2 '"peerDependencies"' "$PACKAGE_DIR/package.json" | grep -q "react-native"; then
            echo "   ✅ react-native in peerDependencies"
        else
            echo "   ❌ react-native not in peerDependencies"
            ERRORS=$((ERRORS + 1))
        fi
    else
        echo "   ❌ peerDependencies not defined"
        ERRORS=$((ERRORS + 1))
    fi
    
    # Check that react/react-native are NOT in dependencies
    if grep -q '"dependencies"' "$PACKAGE_DIR/package.json"; then
        if grep -A 10 '"dependencies"' "$PACKAGE_DIR/package.json" | grep -q '"react"'; then
            echo "   ⚠️  react found in dependencies (should be in peerDependencies only)"
        fi
        if grep -A 10 '"dependencies"' "$PACKAGE_DIR/package.json" | grep -q '"react-native"'; then
            echo "   ⚠️  react-native found in dependencies (should be in peerDependencies only)"
        fi
    fi
fi

# Check 5: Verify files array includes necessary files
echo ""
echo "5️⃣  Checking package.json files array..."
if [ -f "$PACKAGE_DIR/package.json" ]; then
    if grep -q '"files"' "$PACKAGE_DIR/package.json"; then
        if grep -A 10 '"files"' "$PACKAGE_DIR/package.json" | grep -q "ios"; then
            echo "   ✅ ios/ included in files array"
        else
            echo "   ⚠️  ios/ not in files array (may not be published)"
        fi
        
        if grep -A 10 '"files"' "$PACKAGE_DIR/package.json" | grep -q "rejourney.podspec"; then
            echo "   ✅ rejourney.podspec included in files array"
        else
            echo "   ⚠️  rejourney.podspec not in files array (may not be published)"
        fi
    else
        echo "   ⚠️  files array not defined (all files will be published)"
    fi
fi

# Check 6: Verify podspec source path
echo ""
echo "6️⃣  Checking podspec source configuration..."
if [ -f "$PACKAGE_DIR/rejourney.podspec" ]; then
    # Check if source uses git (for published packages)
    if grep -q "s.source.*git" "$PODSPEC"; then
        echo "   ✅ Source uses git (appropriate for published packages)"
    else
        echo "   ⚠️  Source not configured for git (may need for published packages)"
    fi
fi

# Summary
echo ""
echo "==================================="
if [ $ERRORS -eq 0 ]; then
    echo "✅ All critical checks passed!"
    echo ""
    echo "Next steps:"
    echo "  1. Run: npm run prepare (to build the package)"
    echo "  2. Run: ./scripts/test-ios-install.sh (to test installation)"
    exit 0
else
    echo "❌ Found $ERRORS critical issue(s)"
    echo ""
    echo "Please fix the issues above before publishing."
    exit 1
fi
