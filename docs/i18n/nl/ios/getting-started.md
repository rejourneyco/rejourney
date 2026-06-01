<!-- AI_PROMPT_SECTION -->
**Gebruikt u Cursor, Claude of ChatGPT?** Kopieer de integratieprompt en plak deze in uw AI-assistent om de installatiecode automatisch te genereren.

<!-- /AI_PROMPT_SECTION -->

## Installatie

### Swift Package Manager

Voeg het Rejourney-pakket toe in Xcode via **Bestand → Pakketafhankelijkheden toevoegen** en voer in:

```
https://github.com/rejourneyco/rejourney
```

Of voeg het rechtstreeks toe aan uw `Package.swift`:

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
> Voor Rejourney is iOS 15.1 of hoger vereist.

## Swift-instelling

Initialiseer en start Rejourney in uw `@main`-app-structuur.

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

Als u `UIApplicationDelegate` gebruikt, bel dan `configure` in `application(_:didFinishLaunchingWithOptions:)`:

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

De opname begint zodra `start()` is opgelost. U kunt het resultaat indien nodig controleren:

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## Instellingen voor opnemen op afstand

Projectinstellingen kunnen de standaardopnamewaarden van Swift beheren zonder een nieuwe app-build te verzenden. Ondersteunde SDK-versies lezen deze instellingen wanneer `start()` wordt aangeroepen:

| Instelling | Gedrag |
|---|---|
| Bemonsteringsfrequentie | Standaard ingesteld op `100%`. Ingemonsterde sessies worden normaal vastgelegd. Uitgemonsterde sessies keren terug voordat het vastleggen van herhalingen, netwerkonderschepping, uploads of ander pakketwerk begint. |
| Maximale waarneembaarheidsduur | Beperkt de maximale lengte van elke observatiesessie. |
| FPS opnemen | Standaard ingesteld op `1 FPS`. Projectbeheerders kunnen `1`, `2` of `3 FPS` kiezen. Als externe configuratie niet beschikbaar is, valt de SDK terug naar lokaal/standaard vastleggedrag. |
| Privacy van tekstinvoer | Standaard wordt alle tekstinvoer gemaskeerd. De modus Alleen veilig houdt wachtwoord-/beveiligde velden gemaskeerd en zorgt ervoor dat andere tekstinvoer verschijnt in herhalingen van foutopsporing. |

## Scherm volgen

Rejourney sluit niet automatisch aan bij de SwiftUI-navigatie, dus bel `trackScreen` telkens wanneer de gebruiker naar een nieuw scherm navigeert.

### SwiftUI

Gebruik `.onAppear` of een navigatiebewuste modifier:

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

Bel `trackScreen` binnen `viewDidAppear`:

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### NavigatiePad / NavigatieStack

Observeer het navigatiepad en volg veranderingen:

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

## Gebruikersidentificatie

Koppel sessies aan uw eigen gebruikers-ID's, zodat u specifieke gebruikers in het dashboard kunt vinden.

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **Privacy:** Gebruik interne ID's of UUID's. Als u PII (e-mail, telefoon) moet gebruiken, hash deze dan voordat u deze doorgeeft.

De identiteit blijft behouden bij app-lanceringen via `UserDefaults`. U hoeft `identify` slechts één keer aan te roepen per login, niet bij elke geopende app.

## Aangepaste evenementen

Volg betekenisvolle gebruikersacties om gedrag te begrijpen, problemen op te lossen en herhalingen van sessies in het dashboard te filteren.

### Basisgebruik

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

| Parameter | Typ | Vereist | Beschrijving |
|---|---|---|---|
| `name` | `String` | Ja | Gebeurtenisnaam — gebruik `snake_case` voor consistentie |
| `properties` | `[String: RejourneyMetadataValue]` | Nee | Sleutel-waardeparen gekoppeld aan deze gebeurtenis |

`RejourneyMetadataValue` accepteert Swift letterlijke waarden rechtstreeks - geen verpakking nodig:

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### Voorbeelden

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

### Hoe gebeurtenissen verschijnen in het dashboard

Aangepaste gebeurtenissen worden per sessie opgeslagen en zijn op twee plaatsen zichtbaar:

1. **Tijdlijn voor het opnieuw afspelen van sessies** — Gebeurtenissen verschijnen als markeringen op de herhalingstijdlijn, zodat u naar het exacte moment kunt springen waarop een actie heeft plaatsgevonden.
2. **Sessiearchieffilters** — Filter de sessielijst op:
   - **Naam evenement** — Vind alle sessies die een specifieke gebeurtenis bevatten (bijvoorbeeld `purchase_completed`)
   - **Aantal evenementen** — Vind sessies met een specifiek aantal aangepaste gebeurtenissen

### Beste praktijken




> [!TIP]
> - Gebruik consistente naamgeving (`snake_case`, bijvoorbeeld `button_tapped` en niet `Button Tapped`)
> - Houd eigenschapswaarden eenvoudig (tekenreeksen, getallen, booleans) – vermijd diep geneste objecten
> - Concentreer u op acties die van belang zijn voor foutopsporing of analyse; leg niet alles vast

## Privacycontroles

Tekstinvoer en cameraweergaven worden standaard automatisch gemaskeerd. Projectbeheerders kunnen het standaardmaskeringsniveau voor tekstinvoer wijzigen in Projectinstellingen voor ondersteunde SDK-versies. Beveiligde/wachtwoordvelden, cameraweergaven en expliciete maskers blijven beschermd.

Gebruik de API's `mask` en `unmask` om extra gevoelige weergaven te verbergen:

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

Voor SwiftUI haalt u de onderliggende `UIView` op via een `UIViewRepresentable`-wrapper of `introspect`.

#### Inheemse bladen

Het vastleggen van oorspronkelijke werkbladen is standaard ingeschakeld (`captureNativeSheets: true`). Hierdoor kunnen native werkbladen en dialoogvensters van de app, zoals betalingsautorisatiemodaliteiten, verschijnen in herhalingen van foutopsporing wanneer het besturingssysteem vastleggen toestaat. Toetsenbord-/tekstinvoersysteembladen worden uitgesloten wanneer tekstinvoer standaard wordt gemaskeerd. Als de tekstinvoermaskering is ingesteld om alleen velden te beveiligen, zijn toetsenborden alleen geschikt voor de beste inspanning en kunnen ze niet op betrouwbare wijze worden vastgelegd, omdat iOS ze kan weergeven als beschermde of externe systeemoppervlakken. OS-aandeelbladen zijn ook alleen maar de beste inspanningen en kunnen niet op betrouwbare wijze worden vastgelegd wanneer het systeem ze weergeeft als beschermde of afgelegen oppervlakken.

Schakel het vastleggen van native werkbladen uit als u wilt dat de visuele herhaling beperkt blijft tot het hoofdvenster van de app:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### Toestemming van gebruiker & GDPR




> [!IMPORTANT]
> **U bent de gegevensbeheerder.** Rejourney treedt namens u op als gegevensverwerker. U bent ervoor verantwoordelijk dat uw eindgebruikers worden geïnformeerd over de opname van sessies en dat u over een geldige wettelijke basis beschikt voor het verwerken van hun gegevens (bijvoorbeeld toestemming of legitieme belangen).

#### Wat je moet doen

1. **Maak sessie-opname openbaar in het privacybeleid van uw app.** Taal opnemen zoals:

   > * "We gebruiken Rejourney om geanonimiseerde EN niet-geanonimiseerde sessieherhalingen van uw in-app-activiteit op te nemen om ons te helpen het product te verbeteren, crashes en problemen op te sporen en productfrictie te verminderen. Sessiegegevens kunnen scherminteracties, apparaatinformatie en geschatte locatie omvatten. Tekstinvoer en gevoelige UI-elementen worden automatisch gemaskeerd en nooit vastgelegd."*

2. **Poortopname achter toestemming** (aanbevolen voor EER-gebruikers):

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

3. **Respecteer opt-outs.** Als een gebruiker zijn toestemming intrekt, stop dan met opnemen en wis zijn identiteit:

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### Alleen-observatiemodus (geen visuele opname)

Om fouten, crashes, ANRs en netwerkactiviteit **zonder** visuele herhalingen vast te leggen, stelt u `observeOnly: true` in:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

Indien ingeschakeld, wordt alle telemetrie verzameld, maar worden er geen schermafbeeldingen gemaakt. Sessies verschijnen NIET op uw pagina Herhalingen, maar de volledige analyse-, fout-, netwerk- en crashgegevens worden nog steeds vastgelegd. Handig wanneer gebruikers zich hebben afgemeld voor schermopname, maar u nog steeds inzicht in fouten wilt.

> **Opmerking:** Dit kan per gebruiker voorwaardelijk worden ingesteld op basis van een opgeslagen voorkeur of toestemmingsvlag:
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### Netwerk vastleggen

Het vastleggen van netwerkverzoeken (standaard `autoTrackNetwork: true`) onderschept `URLSession`-verkeer via een aangepaste `URLProtocol`. Schakel dit uit als u niet wilt dat er netwerkgegevens worden verzameld:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### Geolocatie

IP-afgeleide geolocatie (land, regio, stad) wordt standaard verzameld. Schakel het uit om de zoekopdracht volledig te onderdrukken:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## Configuratiereferentie

Alle opties worden één keer ingesteld in `configure` en kunnen niet meer worden gewijzigd nadat `start` is aangeroepen.

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

| Optie | Typ | Standaard | Beschrijving |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | Overschrijven voor zelf-hostende implementaties |
| `userId` | `String?` | `nil` | Optionele initiële interne gebruikers-ID |
| `enabled` | `Bool` | `true` | Hoofd-kill-schakelaar — stel deze in op `false` om de SDK volledig uit te schakelen |
| `observeOnly` | `Bool` | `false` | Alleen telemetrie verzamelen, geen visuele opname |
| `captureFPS` | `Int?` | `nil` | Optionele lokale FPS-fallback voor vastleggen. Opnemen van externe projectinstellingen FPS heeft voorrang indien beschikbaar |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | JPEG-opnamekwaliteit (`.low`, `.medium`, `.high`) |
| `wifiOnly` | `Bool` | `false` | Upload sessiegegevens alleen via Wi-Fi |
| `captureScreen` | `Bool` | `true` | Visuele schermopname in-/uitschakelen |
| `captureAnalytics` | `Bool` | `true` | Verzameling van analytische gebeurtenissen in-/uitschakelen |
| `captureCrashes` | `Bool` | `true` | Crashrapportage in-/uitschakelen |
| `captureANR` | `Bool` | `true` | Detectie ANR (app reageert niet) in-/uitschakelen |
| `trackConsoleLogs` | `Bool` | `true` | Consolelogboeken voor de sessie vastleggen |
| `collectGeoLocation` | `Bool` | `true` | Verzamel IP-afgeleide geolocatie |
| `autoTrackNetwork` | `Bool` | `true` | `URLSession`-verzoeken voor netwerkopname onderscheppen |
| `captureNativeSheets` | `Bool` | `true` | Voeg native blad-/dialoogvensters van de app toe aan visuele herhaling wanneer iOS vastleggen toestaat. Deelbladen en toetsenborden van besturingssystemen kunnen worden beschermd of op externe oppervlakken liggen en kunnen niet op betrouwbare wijze worden vastgelegd |
| `debug` | `Bool` | `false` | Uitgebreide SDK-logboeken afdrukken naar de console |

## Opname stoppen

Stop de huidige sessie en wis openstaande gegevens:

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

De callback-variant is beschikbaar voor niet-asynchrone contexten:

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## Sessie-ID

Krijg op elk gewenst moment toegang tot de huidige sessie-ID om deze te correleren met uw eigen logbestanden of ondersteuningstools:

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
