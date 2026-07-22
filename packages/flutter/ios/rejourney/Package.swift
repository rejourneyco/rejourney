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
                .product(name: "FlutterFramework", package: "FlutterFramework")
            ],
            resources: [
                .process("Core/Resources/PrivacyInfo.xcprivacy")
            ],
            linkerSettings: [
                .linkedLibrary("z")
            ]
        )
    ],
    swiftLanguageVersions: [.v5]
)
