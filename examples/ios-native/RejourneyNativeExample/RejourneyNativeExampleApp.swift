import Rejourney
import SwiftUI

@main
struct RejourneyNativeExampleApp: App {
    @MainActor
    init() {
        let environment = ProcessInfo.processInfo.environment
        let apiURL = URL(
            string: environment["REJOURNEY_API_URL"] ?? "https://api.rejourney.co"
        )!
        let observeOnly = environment["REJOURNEY_OBSERVE_ONLY"]?.lowercased() != "false"
        let publicKey = environment["REJOURNEY_PUBLIC_KEY"]
            ?? "rj_94f602bb3ff12873008b16fb2f3389cc"

        Rejourney.configure(
            publicKey: publicKey,
            options: RejourneyOptions(
                apiURL: apiURL,
                observeOnly: observeOnly,
                autoTrackNetwork: true,
                debug: true
            )
        )
    }

    var body: some Scene {
        WindowGroup {
            RejourneyNativeExampleView()
        }
    }
}

struct RejourneyNativeExampleView: View {
    @State private var sessionId: String?
    @State private var status = "Idle"
    @State private var username = ""
    @State private var password = ""
    @State private var notes = ""

    var body: some View {
        NavigationView {
            Form {
                Section("Session") {
                    Text(sessionId ?? "No active session")
                    Text(status)
                }

                Section("Actions") {
                    Button("Start") {
                        Task { await startSession() }
                    }
                    Button("Track Screen") {
                        Rejourney.trackScreen("Native Example")
                        status = "Tracked screen"
                    }
                    Button("Log Event") {
                        Rejourney.logEvent(
                            "native_sample_event",
                            properties: [
                                "source": "ios-native-example",
                                "success": true
                            ]
                        )
                        status = "Logged event"
                    }
                    Button("Stop") {
                        Task { await stopSession() }
                    }
                }

#if DEBUG
                Section("Stability validation") {
                    Button("Freeze Main Thread (7s)") {
                        status = "ANR test scheduled"
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                            Thread.sleep(forTimeInterval: 7)
                            status = "ANR test recovered"
                        }
                    }
                    Button("Crash App") {
                        status = "Crash test scheduled"
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                            NSException(
                                name: NSExceptionName("RejourneyNativeExampleCrash"),
                                reason: "Intentional native SDK crash validation"
                            ).raise()
                        }
                    }
                }
#endif

                // These fields verify that all text inputs are masked in session
                // replay by default (no text content captured, black overlay shown).
                Section("Masked Inputs (privacy test)") {
                    TextField("Username", text: $username)
                        .textContentType(.username)
                        .autocapitalization(.none)
                    SecureField("Password", text: $password)
                    TextEditor(text: $notes)
                        .frame(minHeight: 80)
                }
            }
            .navigationTitle("Rejourney")
        }
    }

    @MainActor
    private func startSession() async {
        let result = await Rejourney.start()
        sessionId = result.sessionId
        status = result.success ? "Started" : (result.error ?? "Start failed")
    }

    @MainActor
    private func stopSession() async {
        let result = await Rejourney.stop()
        sessionId = nil
        status = result.success ? "Stopped" : "Stop failed"
    }
}
