# swift-clean-arch — Rejourney Swift SDK Example

A full-featured SwiftUI iOS app ([nalexn/clean-architecture-swiftui](https://github.com/nalexn/clean-architecture-swiftui), MIT) instrumented with the Rejourney iOS SDK.

## What this demonstrates

- SDK initialisation at app launch via `Rejourney.configure()`
- Session recording across multiple screens: country list, search, country detail, flag modal, locale settings
- Network request capture (`autoTrackNetwork: true`) via `URLSession`
- SwiftData persistence integration
- Clean Architecture (Interactors → Repositories → AppState) with Rejourney running transparently alongside it

## App screens

| Screen | Description |
|--------|-------------|
| Countries list | Searchable paginated list of all countries |
| Country detail | Flag, region, population, currencies, languages |
| Flag modal | Full-screen flag viewer |
| Locale / environment overrides | Change language and display settings at runtime |

## Open in Xcode

```bash
open examples/swift-clean-arch/CountriesSwiftUI.xcodeproj
```

Or from the repo root:

```bash
npm run example:swift
```

Xcode will resolve the released Rejourney Swift package along with the two remote dependencies (EnvironmentOverrides, ViewInspector). Use the switch script below if you want to point the example at the local in-repo package.

## SDK configuration

`CountriesSwiftUI/Core/AppDelegate.swift` starts Rejourney at launch through `CountriesSwiftUI/Core/RejourneyExample.swift`:

```swift
Rejourney.configure(
    publicKey: ProcessInfo.processInfo.environment["REJOURNEY_PUBLIC_KEY"]!,
    options: RejourneyOptions(
        apiURL: resolvedAPIURL,
        autoTrackNetwork: true,
        debug: true
    )
)
```

The example requires `REJOURNEY_PUBLIC_KEY` at launch and resolves the API URL
from `API_URL`, `PUBLIC_API_URL`, or `REJOURNEY_API_URL`; the endpoint defaults
to Rejourney Cloud. The release matrix launcher loads both values from ignored
environment files so public example source cannot accidentally submit replays.

The example also calls `Rejourney.start()`, identifies a demo user with a non-PII ID, tracks the countries list/detail/flag modal screens, records navigation and search events, and leaves `autoTrackNetwork` enabled so the app's `URLSession` requests appear in replay telemetry.

## How the SDK package is linked

By default, `Package.swift` and `CountriesSwiftUI.xcodeproj` reference the released `https://github.com/rejourneyco/rejourney` SwiftPM package. The switch script can rewrite both files to use the monorepo root package at `../..` for local SDK development. No symlinks or CocoaPods are needed in either mode.

## Switching SDK source

Use the switch script to test the released SwiftPM package and then jump back to the local in-repo SDK:

From the repo root:

```bash
npm run example:swift:sdk:old
npm run example:swift:sdk:new
npm run example:swift:sdk:status
```

Or from `examples/swift-clean-arch`:

```bash
bash ./scripts/switch-rejourney-sdk.sh --old
bash ./scripts/switch-rejourney-sdk.sh --new
bash ./scripts/switch-rejourney-sdk.sh --status
```

`--old` switches both `Package.swift` and `CountriesSwiftUI.xcodeproj` to the latest released `https://github.com/rejourneyco/rejourney` tag. `--new` switches both back to the local package at `../..`. Add `--no-resolve` if you only want to rewrite the dependency files and skip SwiftPM/Xcode dependency resolution.

## License

The base app is MIT © Alexey Naumov. Rejourney SDK additions are covered by the Rejourney license.
