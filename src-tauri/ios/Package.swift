// swift-tools-version:5.3
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "norma-ai-iap",
    platforms: [
        .iOS(.v15)
    ],
    products: [
        // Products define the executables and libraries a package produces, and make them visible to other packages.
        .library(
            name: "norma-ai-iap",
            type: .static,
            targets: ["norma-ai-iap"])
    ],
    dependencies: [
        // No external dependencies - uses only Foundation and StoreKit (iOS system frameworks)
    ],
    targets: [
        // Targets are the basic building blocks of a package. A target can define a module or a test suite.
        // Targets can depend on other targets in this package, and on products in packages this package depends on.
        .target(
            name: "norma-ai-iap",
            dependencies: [],
            path: "Sources")
    ]
)
