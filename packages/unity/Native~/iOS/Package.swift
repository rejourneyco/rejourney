// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "RejourneyUnity", platforms: [.iOS("15.1")],
    products: [.library(name: "RejourneyUnity", type: .dynamic, targets: ["RejourneyUnity"])],
    targets: [
        .target(name: "RejourneyUnity", dependencies: ["RejourneySignalSupport"], path: "Sources/Rejourney", resources: [.process("Resources/PrivacyInfo.xcprivacy")], linkerSettings: [.linkedLibrary("z")]),
        .target(name: "RejourneySignalSupport", path: "Sources/RejourneySignalSupport", publicHeadersPath: "include")
    ], swiftLanguageVersions: [.v5])
