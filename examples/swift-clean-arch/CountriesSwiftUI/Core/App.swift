//
//  CountriesApp.swift
//  CountriesSwiftUI
//
//  Created by Alexey on 7/11/24.
//  Copyright © 2024 Alexey Naumov. All rights reserved.
//

import SwiftUI
import EnvironmentOverrides

extension View {
    @ViewBuilder
    func attachEnvironmentOverridesUnlessMatrix(
        onChange: ((EnvironmentValues.Diff) -> Void)? = nil
    ) -> some View {
        if ProcessInfo.processInfo.environment["ENV"]?.hasPrefix("test-matrix-") == true {
            self
        } else {
            attachEnvironmentOverrides(onChange: onChange)
        }
    }
}

@main
struct MainApp: App {

    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            appDelegate.rootView
        }
    }
}

extension AppEnvironment {
    var rootView: some View {
        VStack {
            if isRunningTests {
                Text("Running unit tests")
            } else {
                TabView {
                    CountriesList()
                        .tabItem {
                            Label("Countries", systemImage: "list.bullet")
                        }

                    MapTestView()
                        .tabItem {
                            Label("Map", systemImage: "map")
                        }

                    MediaMaskingTestView()
                        .tabItem {
                            Label("Media", systemImage: "photo.on.rectangle.angled")
                        }

                    StressTestView()
                        .tabItem {
                            Label("Stress", systemImage: "speedometer")
                        }

                    NestedVideoTestView()
                        .tabItem {
                            Label("Nested Video", systemImage: "play.rectangle.on.rectangle")
                        }
                }
                    .modifier(RootViewAppearance())
                    .modelContainer(modelContainer)
                    // The developer overlay marks itself modal for accessibility,
                    // which intentionally hides the underlying app from automation.
                    // Keep it in normal builds but remove it from matrix launches.
                    .attachEnvironmentOverridesUnlessMatrix(onChange: onChangeHandler)
                    .inject(diContainer)
                if modelContainer.isStub {
                    Text("⚠️ There is an issue with local database")
                        .font(.caption2)
                }
            }
        }
    }

    private var onChangeHandler: (EnvironmentValues.Diff) -> Void {
        return { diff in
            if !diff.isDisjoint(with: [.locale, .sizeCategory]) {
                self.diContainer.appState[\.routing] = AppState.ViewRouting()
            }
        }
    }
}
