# Swift Clean Architecture SDK Switch Script

This doc explains how to switch the Rejourney dependency in `examples/swift-clean-arch` between:

- the latest released SwiftPM version (`--old`)
- the local in-repo package (`--new`)

## Script Location

- `examples/swift-clean-arch/scripts/switch-rejourney-sdk.sh`

## Quick Commands

Run from the repo root:

- `npm run example:swift:sdk:old`
- `npm run example:swift:sdk:new`
- `npm run example:swift:sdk:status`

Or run from `examples/swift-clean-arch`:

- `bash ./scripts/switch-rejourney-sdk.sh --old`
- `bash ./scripts/switch-rejourney-sdk.sh --new`
- `bash ./scripts/switch-rejourney-sdk.sh --status`

## What `--old` Does

`--old` switches the app to the latest released Git tag for the SwiftPM package at:

- `https://github.com/rejourneyco/rejourney`

Steps:

1. Finds the newest remote `v*` semver tag, unless `REJOURNEY_IOS_SDK_VERSION` is set.
2. Updates `Package.swift` from `.package(path: "../..")` to the remote package URL.
3. Updates `CountriesSwiftUI.xcodeproj/project.pbxproj` from `XCLocalSwiftPackageReference` to `XCRemoteSwiftPackageReference`.
4. Deletes local SwiftPM resolution/build artifacts:
   - `.build`
   - `Package.resolved`
   - Xcode's SwiftPM `Package.resolved`
5. Runs:
   - `swift package resolve`
   - `xcodebuild -resolvePackageDependencies -project CountriesSwiftUI.xcodeproj -scheme CountriesSwiftUI`

## What `--new` Does

`--new` switches the app back to the local package path:

- `../..`

It then runs the same SwiftPM artifact cleanup and dependency resolution flow.

## Options

- `--no-resolve` rewrites dependency files but skips `swift package resolve` and `xcodebuild -resolvePackageDependencies`.
- `--status` prints whether `Package.swift` and the Xcode project currently point at the local package or the released package.
- `REJOURNEY_IOS_SDK_VERSION=0.3.0` pins `--old` to a specific release.
- `REJOURNEY_IOS_PACKAGE_URL=...` overrides the remote SwiftPM package URL.

## Notes

- The script intentionally edits both `Package.swift` and the `.xcodeproj` because the example can be opened through either SwiftPM or Xcode.
- Root `package.json` includes `example:swift:sdk:old`, `example:swift:sdk:new`, and `example:swift:sdk:status` shortcuts for the script.
- The cleanup is destructive only for generated local install/build artifacts.
- Use `--new` after validating released SwiftPM behavior so development returns to the local SDK source.
