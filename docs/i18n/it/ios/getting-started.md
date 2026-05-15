<!-- AI_PROMPT_SECTION -->
**Utilizzi Cursor, Claude o ChatGPT?** Copia la richiesta di integrazione e incollala nel tuo assistente AI per generare automaticamente il codice di configurazione.

<!-- /AI_PROMPT_SECTION -->

## Installazione

### Swift Package Manager

Aggiungi il pacchetto Rejourney in Xcode tramite **File → Aggiungi dipendenze del pacchetto** e inserisci:

```
https://github.com/rejourneyco/rejourney
```

Oppure aggiungilo direttamente al tuo `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/rejourneyco/rejourney", from: "0.2.0")
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
> Rejourney richiede iOS 15.1 o successivo.

## Swift Configurazione

Inizializza e avvia Rejourney nella struttura dell'app `@main`.

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

Se utilizzi `UIApplicationDelegate`, chiama `configure` in `application(_:didFinishLaunchingWithOptions:)`:

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

La registrazione inizia non appena `start()` si risolve. Se necessario, puoi controllare il risultato:

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## Impostazioni di registrazione remota

Le impostazioni del progetto possono controllare le impostazioni predefinite di registrazione Swift senza spedire una nuova build dell'app. Le versioni SDK supportate leggono queste impostazioni quando viene chiamato `start()`:

| Impostazione | Comportamento |
|---|---|
| Frequenza di campionamento | Il valore predefinito è `100%`. Le sessioni campionate vengono acquisite normalmente. Le sessioni campionate ritornano prima dell'acquisizione della riproduzione, dell'intercettazione di rete, dei caricamenti o dell'inizio di altre operazioni sui pacchetti. |
| Durata massima di osservabilità | Limita la durata massima di ciascuna sessione di osservabilità. |
| Registrazione FPS | Il valore predefinito è `1 FPS`. Gli amministratori del progetto possono scegliere `1`, `2` o `3 FPS`. Se la configurazione remota non è disponibile, SDK torna al comportamento di acquisizione locale/predefinito. |
| Privacy nell'immissione del testo | L'impostazione predefinita prevede il mascheramento di tutti gli input di testo. La modalità solo protetta mantiene mascherati i campi password/protetti e consente la visualizzazione di altri input di testo nelle riproduzioni di debug. |

## Monitoraggio dello schermo

Rejourney non si collega automaticamente alla navigazione SwiftUI, quindi chiama `trackScreen` ogni volta che l'utente passa a una nuova schermata.

### SwiftUI

Utilizza `.onAppear` o un modificatore compatibile con la navigazione:

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

Chiama `trackScreen` all'interno di `viewDidAppear`:

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### Percorso di navigazione/Stack di navigazione

Osserva il percorso di navigazione e monitora il cambiamento:

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

## Identificazione dell'utente

Associa le sessioni ai tuoi ID utente in modo da poter trovare utenti specifici nella dashboard.

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **Privacy:** Utilizza ID interni o UUID. Se devi utilizzare PII (e-mail, telefono), esegui l'hashing prima di trasmetterlo.

L'identità viene mantenuta durante il lancio delle app tramite `UserDefaults`: devi chiamare `identify` solo una volta per accesso, non per ogni app aperta.

## Eventi personalizzati

Tieni traccia delle azioni significative degli utenti per comprendere il comportamento, eseguire il debug dei problemi e filtrare i replay delle sessioni nella dashboard.

### Utilizzo di base

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

| Parametro | Digitare | Obbligatorio | Descrizione |
|---|---|---|---|
| `name` | `String` | Sì | Nome evento: utilizzare `snake_case` per coerenza |
| `properties` | `[String: RejourneyMetadataValue]` | No | Coppie chiave-valore allegate a questo evento |

`RejourneyMetadataValue` accetta direttamente i valori letterali Swift: non è necessario il wrapper:

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### Esempi

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

### Come vengono visualizzati gli eventi nella dashboard

Gli eventi personalizzati vengono archiviati per sessione e visibili in due posizioni:

1. **Cronologia della riproduzione della sessione**: gli eventi vengono visualizzati come indicatori sulla sequenza temporale del replay in modo da poter passare al momento esatto in cui si è verificata un'azione.
2. **Filtri di archivio di sessione** — Filtra l'elenco delle sessioni per:
   - **Nome dell'evento**: trova tutte le sessioni contenenti un evento specifico (ad esempio `purchase_completed`)
   - **Conteggio eventi**: trova sessioni con un numero specifico di eventi personalizzati

### Migliori pratiche




> [!TIP]
> - Utilizza una denominazione coerente (`snake_case`, ad esempio `button_tapped` non `Button Tapped`)
> - Mantieni semplici i valori delle proprietà (stringhe, numeri, booleani): evita oggetti profondamente annidati
> - Concentrati sulle azioni importanti per il debug o l'analisi: non registrare tutto

## Controlli sulla privacy

Gli input di testo e le visualizzazioni della telecamera vengono automaticamente mascherati per impostazione predefinita. Gli amministratori del progetto possono modificare il livello di mascheramento dell'input di testo predefinito in Impostazioni progetto per le versioni SDK supportate. I campi protetti/password, le visualizzazioni della telecamera e le maschere esplicite rimangono protetti.

Per nascondere ulteriori visualizzazioni sensibili, utilizza le API `mask` e `unmask`:

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

Per SwiftUI, ottieni il sottostante `UIView` tramite un wrapper `UIViewRepresentable` o `introspect`.

#### Fogli nativi

L'acquisizione nativa del foglio è abilitata per impostazione predefinita (`captureNativeSheets: true`). Ciò consente ai fogli e alle finestre di dialogo nativi di proprietà dell'app, come le modalità di autorizzazione del pagamento, di apparire nelle riproduzioni di debug quando il sistema operativo consente l'acquisizione. I fogli del sistema di tastiera/immissione di testo sono esclusi quando gli input di testo sono mascherati per impostazione predefinita. Quando il mascheramento dell'input di testo è impostato solo su campi protetti, le tastiere funzionano solo al meglio e non possono essere acquisite in modo affidabile perché iOS potrebbe renderle come superfici di sistema protette o remote. Anche i fogli di condivisione del sistema operativo vengono eseguiti solo con il massimo sforzo e non possono essere acquisiti in modo affidabile quando il sistema li rende come superfici protette o remote.

Disattiva l'acquisizione nativa del foglio se desideri che la riproduzione visiva rimanga limitata alla finestra principale dell'app:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### Consenso dell'utente e GDPR




> [!IMPORTANT]
> **Tu sei il Titolare del trattamento.** Rejourney agisce in qualità di Responsabile del trattamento dei dati per tuo conto. Sei responsabile di garantire che i tuoi utenti finali siano informati sulla registrazione della sessione e di disporre di una base giuridica valida per il trattamento dei loro dati (ad esempio consenso o interessi legittimi).

#### Cosa devi fare

1. **Divulga la registrazione della sessione nell'informativa sulla privacy della tua app.** Include linguaggio come:

   > * "Utilizziamo Rejourney per registrare replay di sessioni in forma anonima E non anonimizzate della tua attività in-app per aiutarci a migliorare il prodotto, tenere traccia di arresti anomali e problemi e ridurre l'attrito del prodotto. I dati della sessione possono includere interazioni sullo schermo, informazioni sul dispositivo e posizione approssimativa. Gli input di testo e gli elementi sensibili dell'interfaccia utente vengono automaticamente mascherati e mai acquisiti."*

2. **Registrazione del gate dietro consenso** (consigliato per gli utenti SEE):

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

3. **Rispettare le opzioni di rinuncia.** Se un utente revoca il consenso, interrompi la registrazione e cancella la sua identità:

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### Modalità di sola osservazione (nessuna registrazione visiva)

Per acquisire errori, arresti anomali, ANRs e attività di rete **senza** registrando replay visivi, impostare `observeOnly: true`:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

Se abilitato, vengono raccolti tutti i dati di telemetria ma non vengono acquisiti screenshot: le sessioni NON verranno visualizzate nella pagina Replay ma verranno comunque acquisiti dati completi di analisi, errori, rete e arresti anomali. Utile quando gli utenti hanno disattivato la registrazione dello schermo ma desideri comunque la visibilità degli errori.

> **Nota:** Questo può essere impostato in modo condizionale per utente in base a una preferenza memorizzata o a un flag di consenso:
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### Cattura in rete

L'acquisizione delle richieste di rete (`autoTrackNetwork: true` per impostazione predefinita) intercetta il traffico `URLSession` tramite un `URLProtocol` personalizzato. Disabilitalo se non desideri che i dati di rete vengano raccolti:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### Geolocalizzazione

La geolocalizzazione derivata dall'IP (paese, regione, città) viene raccolta per impostazione predefinita. Disabilitalo per sopprimere completamente la ricerca:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## Riferimento alla configurazione

Tutte le opzioni vengono impostate una volta in `configure` e non possono essere modificate dopo aver richiamato `start`.

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

| Opzione | Digitare | Predefinito | Descrizione |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | Sostituisci per distribuzioni self-hosted |
| `userId` | `String?` | `nil` | ID utente interno iniziale facoltativo |
| `enabled` | `Bool` | `true` | Master kill switch: imposta su `false` per disabilitare completamente SDK |
| `observeOnly` | `Bool` | `false` | Raccogli solo dati di telemetria, nessuna registrazione visiva |
| `captureFPS` | `Int?` | `nil` | Fallback FPS di acquisizione locale opzionale. La registrazione FPS delle Impostazioni progetto remoto ha la precedenza quando disponibile |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | Qualità di acquisizione JPEG (`.low`, `.medium`, `.high`) |
| `wifiOnly` | `Bool` | `false` | Carica i dati della sessione solo su Wi-Fi |
| `captureScreen` | `Bool` | `true` | Abilita/disabilita l'acquisizione visiva dello schermo |
| `captureAnalytics` | `Bool` | `true` | Abilita/disabilita la raccolta eventi di analisi |
| `captureCrashes` | `Bool` | `true` | Abilita/disabilita la segnalazione degli arresti anomali |
| `captureANR` | `Bool` | `true` | Abilita/disabilita il rilevamento ANR (l'app non risponde) |
| `trackConsoleLogs` | `Bool` | `true` | Acquisisci i log della console per la sessione |
| `collectGeoLocation` | `Bool` | `true` | Raccogli la geolocalizzazione derivata dall'IP |
| `autoTrackNetwork` | `Bool` | `true` | Intercetta richieste `URLSession` per l'acquisizione di rete |
| `captureNativeSheets` | `Bool` | `true` | Includi finestre di dialogo/fogli nativi di proprietà dell'app nella riproduzione visiva quando iOS consente l'acquisizione. I fogli di condivisione del sistema operativo e le tastiere potrebbero essere protetti o superfici remote e non possono essere acquisiti in modo affidabile |
| `debug` | `Bool` | `false` | Stampa i log SDK dettagliati sulla console |

## Interruzione della registrazione

Interrompe la sessione corrente e cancella i dati in sospeso:

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

La variante callback è disponibile per contesti non asincroni:

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## Identificativo della sessione

Accedi all'ID sessione corrente in qualsiasi momento per correlarlo con i tuoi registri o strumenti di supporto:

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
