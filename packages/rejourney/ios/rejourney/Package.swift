// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "rejourney",
    platforms: [.iOS("15.1")],
    products: [.library(name: "rejourney", targets: ["rejourney"])],
    dependencies: [
        .package(name: "FlutterFramework", path: "../FlutterFramework")
    ],
    targets: [
        .target(
            name: "rejourney",
            dependencies: [
                .product(name: "FlutterFramework", package: "FlutterFramework"),
                "RejourneySignalSupport"
            ],
            resources: [
                .process("Core/Resources/PrivacyInfo.xcprivacy")
            ],
            linkerSettings: [
                .linkedLibrary("z")
            ]
        ),
        // The signal and exception handlers are Objective-C/C. SwiftPM does not
        // support mixed-language targets, so they build as their own target and
        // the Swift side binds the symbols with @_silgen_name at link time.
        .target(
            name: "RejourneySignalSupport"
        )
    ],
    swiftLanguageVersions: [.v5]
)
