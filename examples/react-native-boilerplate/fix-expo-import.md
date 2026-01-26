# Fix "No such module 'Expo'" Error

The issue is that Xcode can't find the `Expo` module. Here's how to fix it:

## Solution 1: Use Expo CLI (Recommended)

Instead of opening Xcode directly, use Expo CLI which handles all the configuration:

```bash
cd examples/react-native-boilerplate
npx expo run:ios
```

This will:
- Build the project correctly
- Handle all module imports
- Launch the simulator

## Solution 2: Fix Xcode Build Settings

If you must use Xcode directly:

1. **Close Xcode completely**

2. **Open the workspace** (NOT the project):
   ```bash
   open ios/ReactNativeBoilerplate.xcworkspace
   ```

3. **In Xcode, select the project** → Select **ReactNativeBoilerplate target** → **Build Settings**

4. **Search for "Swift Compiler - Search Paths"** and ensure:
   - `$(inherited)` is in the list
   - `"${PODS_CONFIGURATION_BUILD_DIR}/ExpoModulesCore"` is present

5. **Search for "Import Paths"** and ensure:
   - `$(inherited)` is present
   - `"${PODS_CONFIGURATION_BUILD_DIR}/ExpoModulesCore"` is present

6. **Search for "Framework Search Paths"** and ensure:
   - `$(inherited)` is present
   - `"${PODS_CONFIGURATION_BUILD_DIR}/ExpoModulesCore"` is present

7. **Clean Build Folder**: Product → Clean Build Folder (Shift+Cmd+K)

8. **Build**: Product → Build (Cmd+B)

## Solution 3: Verify Pods Installation

If still not working, verify pods are correctly installed:

```bash
cd ios
pod deintegrate
pod install
```

Then reopen the workspace in Xcode.

## Why This Happens

The `Expo` module is actually provided by `ExpoModulesCore` through a module map. Xcode needs the correct build settings to find it. Using `expo run:ios` ensures all settings are correct.
