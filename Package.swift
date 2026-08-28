// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "Rejourney",
    platforms: [
        .iOS("15.1")
    ],
    products: [
        .library(
            name: "Rejourney",
            targets: ["Rejourney"]
        )
    ],
    targets: [
        .target(
            name: "Rejourney",
            path: "packages/ios/Sources/Rejourney",
            resources: [
                .process("Resources/PrivacyInfo.xcprivacy")
            ],
            linkerSettings: [
                .linkedLibrary("z")
            ]
        ),
        .testTarget(
            name: "RejourneyTests",
            dependencies: ["Rejourney"],
            path: "packages/ios/Tests/RejourneyTests"
        )
    ],
    swiftLanguageVersions: [.v5]
)
