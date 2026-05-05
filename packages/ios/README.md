# Rejourney Native iOS

Native iOS Swift Package for Rejourney. This package is intentionally independent from `packages/react-native`: its Swift sources are copied into `packages/ios/Sources/Rejourney` and may diverge from the React Native SDK.

## Install

Add this repository URL in Xcode:

```text
https://github.com/rejourney/rejourney.git
```

Select the `Rejourney` package product and choose a version tag (e.g. `v0.1.1`).

SwiftPM resolves packages from Git tags — there is no npm publish step or registry account. New versions are tagged automatically by CI when `packages/ios/VERSION` is bumped (see [Releasing a new version](#releasing-a-new-version) below).

## Usage

```swift
import Rejourney

@main
struct AppMain: App {
    init() {
        Rejourney.configure(
            publicKey: "pk_live_...",
            options: RejourneyOptions(
                apiURL: URL(string: "https://api.rejourney.co")!,
                captureFPS: 1,
                captureQuality: .medium
            )
        )
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .task {
                    let result = await Rejourney.start()
                    print(result.sessionId ?? "No session")
                }
        }
    }
}
```

The native SDK fetches `/api/sdk/config` itself, then uses the existing production ingest routes under `https://api.rejourney.co`.

## Releasing a new version

There is no manual tagging step. CI handles it automatically:

1. Bump the version in **both** of these files (they must match or CI fails):
   - `packages/ios/VERSION` — plain semver, e.g. `0.2.0`
   - `packages/ios/Sources/Rejourney/RejourneySDKInfo.swift` — the `version` string in `RejourneySDKInfo`
2. Merge to `main`.
3. CI detects that `packages/ios/VERSION` changed, runs the full build + test suite, then creates and pushes a `v{version}` Git tag and GitHub release automatically.

Pushes that do **not** change `packages/ios/VERSION` are built and tested but never tagged, so consumers on a pinned SPM version are unaffected.

> **Note on version numbering:** The iOS SDK version is independent from the React Native SDK version. iOS uses plain semver tags (e.g. `v0.2.0`) as required by SPM. React Native uses prefixed tags (e.g. `react-native/v1.2.0`). There is no collision risk.

## CI

`.github/workflows/rejourney-ios.yml` runs on every push and PR:
- Validates the package boundary (no React imports, correct Obj-C prefixes)
- Validates `packages/ios/VERSION` matches `RejourneySDKInfo.version`
- Builds for iOS Simulator and generic iOS
- Runs XCTest on an available simulator
- Builds `examples/ios-native`

On pushes to `main` only, a second job (`release-ios-tag`) checks whether `packages/ios/VERSION` changed and, if so, creates the release tag after all checks pass.
