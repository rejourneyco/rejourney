<!-- AI_PROMPT_SECTION -->
**Verwenden Sie Cursor, Claude oder ChatGPT?** Kopieren Sie die Integrationsaufforderung und fügen Sie sie in Ihren AI-Assistenten ein, um den Setup-Code automatisch zu generieren.

<!-- /AI_PROMPT_SECTION -->

## Installation

### Swift Package Manager

Fügen Sie das Paket Rejourney in Xcode über **Datei → Paketabhängigkeiten hinzufügen** hinzu und geben Sie Folgendes ein:

```
https://github.com/rejourneyco/rejourney
```

Oder fügen Sie es direkt zu Ihrem `Package.swift` hinzu:

```swift
dependencies: [
    .package(url: "https://github.com/rejourneyco/rejourney", from: "0.3.0")
],
targets: [
    .target(
        name: "YourApp",
        dependencies: [
            .product(name: "Rejourney", package: "rejourney")
        ]
    )
]
```

> [!NOTE]
> Für Rejourney ist iOS 15.1 oder höher erforderlich.

## Swift-Setup

Initialisieren und starten Sie Rejourney in Ihrer `@main`-App-Struktur.

```swift
import SwiftUI
import Rejourney

@main
struct MyApp: App {

    @MainActor
    init() {
        Rejourney.configure(publicKey: "rj_your_public_key")
        Task { await Rejourney.start() }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

Wenn Sie `UIApplicationDelegate` verwenden, rufen Sie `configure` in `application(_:didFinishLaunchingWithOptions:)` auf:

```swift
import UIKit
import Rejourney

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    @MainActor
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        Rejourney.configure(publicKey: "rj_your_public_key")
        Task { await Rejourney.start() }
        return true
    }
}
```

Die Aufzeichnung beginnt, sobald `start()` aufgelöst wird. Sie können das Ergebnis bei Bedarf überprüfen:

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## Remote-Aufnahmeeinstellungen

Mit den Projekteinstellungen können Sie die Aufnahmestandards Swift steuern, ohne einen neuen App-Build auszuliefern. Unterstützte SDK-Versionen lesen diese Einstellungen, wenn `start()` aufgerufen wird:

| Einstellung | Verhalten |
|---|---|
| Abtastrate | Der Standardwert ist `100%`. Eingesampelte Sitzungen werden normal erfasst. Ausgeprobte Sitzungen kehren zurück, bevor die Wiedergabeaufzeichnung, Netzwerküberwachung, Uploads oder andere Paketarbeiten beginnen. |
| Maximale Beobachtbarkeitsdauer | Begrenzt die maximale Länge jeder Observability-Sitzung. |
| Aufnahme von FPS | Der Standardwert ist `1 FPS`. Projektadministratoren können zwischen `1`, `2` oder `3 FPS` wählen. Wenn die Remote-Konfiguration nicht verfügbar ist, greift SDK auf das lokale/Standarderfassungsverhalten zurück. |
| Datenschutz bei Texteingabe | Standardmäßig werden alle Texteingaben maskiert. Im Nur-Sicher-Modus bleiben Kennwort-/sichere Felder maskiert und andere Texteingaben können in Debugging-Wiedergaben angezeigt werden. |

## Bildschirmverfolgung

Rejourney verbindet sich nicht automatisch mit der SwiftUI-Navigation. Rufen Sie daher `trackScreen` auf, wenn der Benutzer zu einem neuen Bildschirm navigiert.

### SwiftUI

Verwenden Sie `.onAppear` oder einen navigationsfähigen Modifikator:

```swift
struct CountriesListView: View {
    var body: some View {
        List { /* ... */ }
            .onAppear {
                Rejourney.trackScreen("Countries List")
            }
    }
}
```

### UIKit

Rufen Sie `trackScreen` innerhalb von `viewDidAppear` auf:

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### NavigationPath / NavigationStack

Beobachten Sie den Navigationspfad und verfolgen Sie Änderungen:

```swift
@State private var path = NavigationPath()

NavigationStack(path: $path) {
    ContentView()
}
.onChange(of: path) { _ in
    // derive screen name from path and call trackScreen
    Rejourney.trackScreen(currentScreenName(from: path))
}
```

## Benutzeridentifikation

Verknüpfen Sie Sitzungen mit Ihren eigenen Benutzer-IDs, damit Sie bestimmte Benutzer im Dashboard finden können.

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **Datenschutz:** Verwenden Sie interne IDs oder UUIDs. Wenn Sie PII (E-Mail, Telefon) verwenden müssen, hashen Sie es, bevor Sie es weitergeben.

Die Identität bleibt bei allen App-Starts über `UserDefaults` erhalten – Sie müssen `identify` nur einmal pro Anmeldung aufrufen, nicht bei jeder geöffneten App.

## Benutzerdefinierte Ereignisse

Verfolgen Sie sinnvolle Benutzeraktionen, um Verhalten zu verstehen, Probleme zu beheben und Sitzungswiederholungen im Dashboard zu filtern.

### Grundlegende Verwendung

```swift
import Rejourney

// Simple event (name only)
Rejourney.logEvent("signup_completed")

// Event with properties
Rejourney.logEvent("button_tapped", properties: ["buttonName": "get_started"])
```

### API

```swift
Rejourney.logEvent(_ name: String, properties: [String: RejourneyMetadataValue] = [:])
```

| Parameter | Geben Sie | ein Erforderlich | Beschreibung |
|---|---|---|---|
| `name` | `String` | Ja | Ereignisname – verwenden Sie `snake_case` für Konsistenz |
| `properties` | `[String: RejourneyMetadataValue]` | Nein | Mit diesem Ereignis verknüpfte Schlüssel-Wert-Paare |

`RejourneyMetadataValue` akzeptiert Swift-Literale direkt – kein Umschließen erforderlich:

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### Beispiele

```swift
// E-commerce
Rejourney.logEvent("purchase_completed", properties: [
    "plan": "pro",
    "amount": 29.99,
    "currency": "USD"
])

// Onboarding
Rejourney.logEvent("onboarding_step", properties: [
    "step": 3,
    "stepName": "profile_setup",
    "skipped": false
])

// Feature usage
Rejourney.logEvent("feature_used", properties: [
    "feature": "dark_mode",
    "enabled": true
])

// Errors / edge cases
Rejourney.logEvent("payment_failed", properties: [
    "errorCode": "card_declined",
    "retryCount": 2
])
```

### Wie Ereignisse im Dashboard angezeigt werden

Benutzerdefinierte Ereignisse werden pro Sitzung gespeichert und sind an zwei Orten sichtbar:

1. **Zeitleiste der Sitzungswiederholung** – Ereignisse werden als Markierungen auf der Wiedergabezeitleiste angezeigt, sodass Sie genau zum Zeitpunkt einer Aktion springen können.
2. **Sitzungsarchivfilter** – Filtern Sie die Sitzungsliste nach:
   - **Veranstaltungsname** – Alle Sitzungen finden, die ein bestimmtes Ereignis enthalten (z. B. `purchase_completed`)
   - **Anzahl der Ereignisse** – Suchen Sie nach Sitzungen mit einer bestimmten Anzahl benutzerdefinierter Ereignisse

### Best Practices




> [!TIP]
> - Verwenden Sie eine konsistente Benennung (`snake_case`, z. B. `button_tapped`, nicht `Button Tapped`).
> - Halten Sie Eigenschaftswerte einfach (Zeichenfolgen, Zahlen, boolesche Werte) – vermeiden Sie tief verschachtelte Objekte
> - Konzentrieren Sie sich auf Aktionen, die für das Debuggen oder die Analyse von Bedeutung sind – protokollieren Sie nicht alles

## Datenschutzkontrollen

Texteingaben und Kameraansichten werden standardmäßig automatisch maskiert. Projektadministratoren können die Standardstufe der Texteingabemaskierung in den Projekteinstellungen für unterstützte SDK-Versionen ändern. Sichere Felder/Passwortfelder, Kameraansichten und explizite Masken bleiben geschützt.

Um zusätzliche vertrauliche Ansichten auszublenden, verwenden Sie die APIs `mask` und `unmask`:

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

Rufen Sie für SwiftUI den zugrunde liegenden `UIView` über einen `UIViewRepresentable`-Wrapper oder `introspect` ab.

#### Native Blätter

Die native Blatterfassung ist standardmäßig aktiviert (`captureNativeSheets: true`). Dadurch können App-eigene native Blätter und Dialoge, wie z. B. Zahlungsautorisierungsmodalitäten, in Debugging-Wiedergaben angezeigt werden, wenn das Betriebssystem die Erfassung zulässt. Tastatur-/Texteingabesystemblätter werden ausgeschlossen, wenn Texteingaben standardmäßig maskiert sind. Wenn die Texteingabemaskierung nur auf sichere Felder eingestellt ist, handelt es sich bei Tastaturen nur um Best-Effort-Tastaturen, die nicht zuverlässig erfasst werden können, da iOS sie möglicherweise als geschützte oder Remote-Systemoberflächen darstellt. Betriebssystem-Share-Sheets sind ebenfalls nur Best-Effort-Arbeitsblätter und können nicht zuverlässig erfasst werden, wenn das System sie als geschützte oder Remote-Oberflächen darstellt.

Deaktivieren Sie die native Blatterfassung, wenn die visuelle Wiedergabe auf das Hauptfenster der App beschränkt bleiben soll:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### Benutzereinwilligung & GDPR




> [!IMPORTANT]
> **Sie sind der Datenverantwortliche.** Rejourney fungiert in Ihrem Namen als Datenverarbeiter. Sie sind dafür verantwortlich, sicherzustellen, dass Ihre Endbenutzer über die Sitzungsaufzeichnung informiert werden und dass Sie über eine gültige Rechtsgrundlage für die Verarbeitung ihrer Daten verfügen (z. B. Einwilligung oder berechtigte Interessen).

#### Was Sie tun müssen

1. **Geben Sie die Sitzungsaufzeichnung in der Datenschutzrichtlinie Ihrer App an.** Fügen Sie eine Sprache hinzu wie:

   > * „Wir verwenden Rejourney, um anonymisierte UND nicht anonymisierte Sitzungswiederholungen Ihrer In-App-Aktivitäten aufzuzeichnen, um uns dabei zu helfen, das Produkt zu verbessern, Abstürze und Probleme zu verfolgen und Produktreibungen zu reduzieren. Sitzungsdaten können Bildschirminteraktionen, Geräteinformationen und den ungefähren Standort umfassen. Texteingaben und sensible UI-Elemente werden automatisch maskiert und niemals erfasst.“*

2. **Gate-Aufzeichnung hinter Zustimmung** (empfohlen für EWR-Benutzer):

   ```swift
   // Configure early — before consent is known
   Rejourney.configure(publicKey: "rj_your_public_key")

   // Call start() only after the user accepts your privacy policy
   func onUserConsented() {
       Task { @MainActor in
           await Rejourney.start()
       }
   }
   ```

3. **Respektieren Sie Opt-outs.** Wenn ein Benutzer seine Einwilligung widerruft, beenden Sie die Aufzeichnung und löschen Sie seine Identität:

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### Nur-Beobachtungsmodus (keine visuelle Aufzeichnung)

Um Fehler, Abstürze, ANRs und Netzwerkaktivität **ohne** bei der Aufzeichnung visueller Wiedergaben zu erfassen, legen Sie `observeOnly: true` fest:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

Wenn diese Option aktiviert ist, werden alle Telemetriedaten erfasst, es werden jedoch keine Screenshots erstellt. Sitzungen werden NICHT auf Ihrer Replays-Seite angezeigt, es werden jedoch weiterhin vollständige Analyse-, Fehler-, Netzwerk- und Absturzdaten erfasst. Nützlich, wenn Benutzer die Bildschirmaufzeichnung deaktiviert haben, Sie aber dennoch Fehlersichtbarkeit wünschen.

> **Notiz:** Dies kann pro Benutzer basierend auf einer gespeicherten Präferenz oder einem Zustimmungsflag bedingt festgelegt werden:
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### Netzwerkerfassung

Die Erfassung von Netzwerkanforderungen (standardmäßig `autoTrackNetwork: true`) fängt den `URLSession`-Verkehr über ein benutzerdefiniertes `URLProtocol` ab. Deaktivieren Sie es, wenn Sie nicht möchten, dass Netzwerkdaten erfasst werden:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### Geolokalisierung

Standardmäßig wird die IP-abgeleitete Geolokalisierung (Land, Region, Stadt) erfasst. Deaktivieren Sie es, um die Suche vollständig zu unterdrücken:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## Konfigurationsreferenz

Alle Optionen werden einmal in `configure` festgelegt und können nach dem Aufruf von `start` nicht mehr geändert werden.

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(
        apiURL:             URL(string: "https://api.rejourney.co")!,
        userId:             nil,
        enabled:            true,
        observeOnly:        false,
        captureFPS:         nil,
        captureQuality:     .medium,
        wifiOnly:           false,
        captureScreen:      true,
        captureAnalytics:   true,
        captureCrashes:     true,
        captureANR:         true,
        trackConsoleLogs:   true,
        collectGeoLocation: true,
        autoTrackNetwork:   true,
        captureNativeSheets: true,
        debug:              false
    )
)
```

| Option | Geben Sie | ein Standard | Beschreibung |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | Überschreibung für selbstgehostete Bereitstellungen |
| `userId` | `String?` | `nil` | Optionale anfängliche interne Benutzer-ID |
| `enabled` | `Bool` | `true` | Master-Kill-Schalter – auf `false` einstellen, um den SDK vollständig zu deaktivieren |
| `observeOnly` | `Bool` | `false` | Nur Telemetrie erfassen, keine visuelle Aufzeichnung |
| `captureFPS` | `Int?` | `nil` | Optionaler lokaler FPS-Fallback für die Erfassung. Die Aufzeichnung von FPS in den Remote-Projekteinstellungen hat Vorrang, sofern verfügbar |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | JPEG-Aufnahmequalität (`.low`, `.medium`, `.high`) |
| `wifiOnly` | `Bool` | `false` | Laden Sie Sitzungsdaten nur über WLAN hoch |
| `captureScreen` | `Bool` | `true` | Visuelle Bildschirmaufnahme aktivieren/deaktivieren |
| `captureAnalytics` | `Bool` | `true` | Analyseereignissammlung aktivieren/deaktivieren |
| `captureCrashes` | `Bool` | `true` | Absturzberichte aktivieren/deaktivieren |
| `captureANR` | `Bool` | `true` | Aktivieren/Deaktivieren der ANR-Erkennung (App reagiert nicht) |
| `trackConsoleLogs` | `Bool` | `true` | Erfassen Sie Konsolenprotokolle für die Sitzung |
| `collectGeoLocation` | `Bool` | `true` | IP-abgeleitete Geolokalisierung erfassen |
| `autoTrackNetwork` | `Bool` | `true` | Abfangen von `URLSession`-Anfragen zur Netzwerkerfassung |
| `captureNativeSheets` | `Bool` | `true` | Beziehen Sie native Blatt-/Dialogfenster der App in die visuelle Wiedergabe ein, wenn iOS die Erfassung zulässt. Betriebssystemfreigabeblätter und Tastaturen können geschützte oder entfernte Oberflächen sein und können nicht zuverlässig erfasst werden |
| `debug` | `Bool` | `false` | Ausführliche SDK-Protokolle auf der Konsole drucken |

## Aufnahme stoppen

Stoppen Sie die aktuelle Sitzung und leeren Sie ausstehende Daten:

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

Die Callback-Variante ist für nicht asynchrone Kontexte verfügbar:

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## Sitzungs-ID

Greifen Sie jederzeit auf die aktuelle Sitzungs-ID zu, um sie mit Ihren eigenen Protokollen oder Support-Tools zu korrelieren:

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
