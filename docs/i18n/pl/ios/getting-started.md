<!-- AI_PROMPT_SECTION -->
**Używasz Cursor, Claude lub ChatGPT?** Skopiuj monit dotyczący integracji i wklej go do asystenta AI, aby automatycznie wygenerować kod instalacyjny.

<!-- /AI_PROMPT_SECTION -->

## Instalacja

### Swift Package Manager

Dodaj pakiet Rejourney w Xcode poprzez **Plik → Dodaj zależności pakietu** i wprowadź:

```
https://github.com/rejourneyco/rejourney
```

Lub dodaj go bezpośrednio do swojego `Package.swift`:

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
> Rejourney wymaga iOS 15.1 lub nowszego.

## Konfiguracja Swift

Zainicjuj i uruchom Rejourney w strukturze aplikacji `@main`.

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

Jeśli używasz `UIApplicationDelegate`, wywołaj `configure` w `application(_:didFinishLaunchingWithOptions:)`:

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

Nagrywanie rozpoczyna się natychmiast po rozwiązaniu problemu `start()`. W razie potrzeby możesz sprawdzić wynik:

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## Ustawienia zdalnego nagrywania

Ustawienia projektu mogą kontrolować domyślne ustawienia nagrywania Swift bez konieczności wysyłania nowej wersji aplikacji. Obsługiwane wersje SDK odczytują te ustawienia po wywołaniu `start()`:

| Ustawienie | Zachowanie |
|---|---|
| Częstotliwość próbkowania | Wartość domyślna to `100%`. Sesje próbkowane przechwytują normalnie. Sesje próbkowane powracają przed przechwyceniem powtórki, przechwyceniem sieci, przesyłaniem lub rozpoczęciem innych prac nad pakietem. |
| Maksymalny czas obserwowalności | Ogranicza maksymalną długość każdej sesji obserwowalności. |
| Nagrywanie FPS | Wartość domyślna to `1 FPS`. Administratorzy projektu mogą wybrać `1`, `2` lub `3 FPS`. Jeśli zdalna konfiguracja jest niedostępna, SDK powraca do lokalnego/domyślnego działania przechwytywania. |
| Prywatność wprowadzania tekstu | Domyślnie maskuje wszystkie wprowadzone teksty. Tryb tylko bezpieczny maskuje pola hasła/bezpieczne i umożliwia wyświetlanie innych wprowadzonych danych tekstowych w powtórkach debugowania. |

## Śledzenie ekranu

Rejourney nie łączy się automatycznie z nawigacją SwiftUI, więc wywołaj `trackScreen` za każdym razem, gdy użytkownik przejdzie do nowego ekranu.

### SwiftUI

Użyj `.onAppear` lub modyfikatora uwzględniającego nawigację:

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

Zadzwoń do `trackScreen` wewnątrz `viewDidAppear`:

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### Ścieżka nawigacji/Stos nawigacji

Obserwuj ścieżkę nawigacji i śledź zmiany:

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

## Identyfikacja użytkownika

Powiąż sesje z własnymi identyfikatorami użytkowników, aby móc znaleźć konkretnych użytkowników w panelu kontrolnym.

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **Prywatność:** Użyj wewnętrznych identyfikatorów lub UUID. Jeśli musisz użyć PII (e-mail, telefon), zahaszuj go przed przekazaniem.

Tożsamość jest zachowywana podczas uruchamiania aplikacji za pośrednictwem `UserDefaults` — wystarczy wywołać `identify` raz przy każdym logowaniu, a nie przy każdym otwarciu aplikacji.

## Niestandardowe wydarzenia

Śledź znaczące działania użytkowników, aby zrozumieć zachowanie, debugować problemy i filtrować powtórki sesji na pulpicie nawigacyjnym.

### Podstawowe użycie

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

| Parametr | Wpisz | Wymagane | Opis |
|---|---|---|---|
| `name` | `String` | Tak | Nazwa zdarzenia — dla zachowania spójności użyj `snake_case` |
| `properties` | `[String: RejourneyMetadataValue]` | Nie | Pary klucz-wartość dołączone do tego zdarzenia |

`RejourneyMetadataValue` akceptuje bezpośrednio literały Swift — bez konieczności owijania:

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### Przykłady

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

### Jak wydarzenia pojawiają się na pulpicie nawigacyjnym

Zdarzenia niestandardowe są przechowywane dla poszczególnych sesji i widoczne w dwóch miejscach:

1. **Oś czasu powtórki sesji** — Wydarzenia pojawiają się jako znaczniki na osi czasu powtórki, dzięki czemu można przejść do dokładnego momentu, w którym miała miejsce dana czynność.
2. **Filtry archiwum sesji** — Filtruj listę sesji według:
   - **Nazwa wydarzenia** — Znajdź wszystkie sesje zawierające określone zdarzenie (np. `purchase_completed`)
   - **Liczba zdarzeń** — Znajdź sesje z określoną liczbą niestandardowych zdarzeń

### Najlepsze praktyki




> [!TIP]
> - Używaj spójnego nazewnictwa (`snake_case`, np. `button_tapped` nie `Button Tapped`)
> - Zachowaj proste wartości właściwości (łańcuchy, liczby, wartości logiczne) — unikaj głęboko zagnieżdżonych obiektów
> - Skoncentruj się na działaniach istotnych dla debugowania lub analiz — nie rejestruj wszystkiego

## Kontrola prywatności

Wprowadzany tekst i widoki z kamery są domyślnie automatycznie maskowane. Administratorzy projektu mogą zmienić domyślny poziom maskowania wprowadzania tekstu w Ustawieniach projektu dla obsługiwanych wersji SDK. Pola bezpieczne/hasła, widoki z kamer i jawne maski pozostają chronione.

Aby ukryć dodatkowe wrażliwe widoki, użyj interfejsów API `mask` i `unmask`:

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

W przypadku SwiftUI pobierz bazowy `UIView` poprzez opakowanie `UIViewRepresentable` lub `introspect`.

#### Arkusze rodzime

Natywne przechwytywanie arkuszy jest domyślnie włączone (`captureNativeSheets: true`). Dzięki temu natywne arkusze i okna dialogowe należące do aplikacji, takie jak moduły autoryzacji płatności, mogą pojawiać się w powtórkach debugowania, gdy system operacyjny pozwala na przechwytywanie. Arkusze klawiatury/systemu wprowadzania tekstu są wykluczane, gdy wprowadzanie tekstu jest domyślnie maskowane. Gdy maskowanie wprowadzania tekstu jest ustawione tylko na pola zabezpieczone, klawiatury działają wyłącznie w trybie best-efektywnym i nie można ich wiarygodnie przechwycić, ponieważ iOS może renderować je jako chronione lub zdalne powierzchnie systemowe. Arkusze udostępniane systemu operacyjnego są również stosowane wyłącznie w trybie best-efektywnym i nie można ich wiarygodnie przechwycić, gdy system renderuje je jako chronione lub odległe powierzchnie.

Wyłącz natywne przechwytywanie arkuszy, jeśli chcesz, aby powtórka wizualna ograniczała się do głównego okna aplikacji:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### Zgoda użytkownika i GDPR




> [!IMPORTANT]
> **Jesteś Administratorem Danych.** Rejourney działa w Twoim imieniu jako podmiot przetwarzający dane. Ponosisz odpowiedzialność za zapewnienie, że Twoi użytkownicy końcowi są informowani o nagrywaniu sesji oraz że masz ważną podstawę prawną do przetwarzania ich danych (np. zgoda lub uzasadnione interesy).

#### Co musisz zrobić

1. **Ujawnij nagranie sesji w polityce prywatności swojej aplikacji.** Uwzględnij język, taki jak:

   > * „Korzystamy z Rejourney do rejestrowania anonimowych ORAZ niezanonimizowanych powtórek sesji Twojej aktywności w aplikacji, aby pomóc nam ulepszyć produkt, śledzić awarie i problemy oraz zmniejszać problemy z produktem. Dane sesji mogą obejmować interakcje na ekranie, informacje o urządzeniu i przybliżoną lokalizację. Wprowadzane teksty i wrażliwe elementy interfejsu użytkownika są automatycznie maskowane i nigdy nie są przechwytywane.”*

2. **Nagranie bramkowe za zgodą** (zalecane dla użytkowników z EOG):

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

3. **Szanuj rezygnację.** Jeśli użytkownik wycofa zgodę, zatrzymaj nagrywanie i wyczyść jego tożsamość:

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### Tryb tylko obserwacji (bez nagrywania wizualnego)

Aby przechwytywać błędy, awarie, ANRs i aktywność sieciową **bez** nagrywającą powtórki wizualne, ustaw `observeOnly: true`:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

Po włączeniu zbierane są wszystkie dane telemetryczne, ale nie są robione żadne zrzuty ekranu — sesje NIE będą wyświetlane na stronie Powtórki, ale nadal przechwytywane będą pełne dane analityczne, dane o błędach, sieci i awariach. Przydatne, gdy użytkownicy zrezygnowali z nagrywania ekranu, ale nadal chcesz widzieć błędy.

> **Notatka:** Można to ustawić warunkowo dla każdego użytkownika w oparciu o zapisane preferencje lub flagę zgody:
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### Przechwytywanie sieci

Przechwytywanie żądań sieciowych (domyślnie `autoTrackNetwork: true`) przechwytuje ruch `URLSession` za pośrednictwem niestandardowego `URLProtocol`. Wyłącz tę opcję, jeśli nie chcesz, aby zbierane były dane sieciowe:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### Geolokalizacja

Domyślnie zbierana jest geolokalizacja oparta na adresie IP (kraj, region, miasto). Wyłącz tę opcję, aby całkowicie ukryć wyszukiwanie:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## Informacje o konfiguracji

Wszystkie opcje są ustawione raz w `configure` i nie można ich zmienić po wywołaniu `start`.

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

| Opcja | Wpisz | Domyślne | Opis |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | Zastąpienie w przypadku wdrożeń hostowanych samodzielnie |
| `userId` | `String?` | `nil` | Opcjonalny początkowy wewnętrzny identyfikator użytkownika |
| `enabled` | `Bool` | `true` | Główny wyłącznik awaryjny — ustawiony na `false`, aby całkowicie wyłączyć SDK |
| `observeOnly` | `Bool` | `false` | Zbieraj tylko dane telemetryczne, bez zapisu wizualnego |
| `captureFPS` | `Int?` | `nil` | Opcjonalne przechwytywanie lokalne i rezerwowe FPS. Zdalne nagrywanie ustawień projektu FPS ma pierwszeństwo, jeśli jest dostępne |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | Jakość przechwytywania JPEG (`.low`, `.medium`, `.high`) |
| `wifiOnly` | `Bool` | `false` | Przesyłaj dane sesji tylko przez Wi-Fi |
| `captureScreen` | `Bool` | `true` | Włącz/wyłącz wizualne przechwytywanie ekranu |
| `captureAnalytics` | `Bool` | `true` | Włącz/wyłącz zbieranie zdarzeń analitycznych |
| `captureCrashes` | `Bool` | `true` | Włącz/wyłącz raportowanie awarii |
| `captureANR` | `Bool` | `true` | Włącz/wyłącz wykrywanie ANR (aplikacja nie odpowiada) |
| `trackConsoleLogs` | `Bool` | `true` | Przechwyć logi konsoli dla sesji |
| `collectGeoLocation` | `Bool` | `true` | Zbieraj geolokalizację na podstawie adresu IP |
| `autoTrackNetwork` | `Bool` | `true` | Przechwytywanie żądań `URLSession` w celu przechwytywania sieci |
| `captureNativeSheets` | `Bool` | `true` | Uwzględnij natywny arkusz/okna dialogowe należące do aplikacji w powtórce wizualnej, gdy iOS pozwala na przechwytywanie. Arkusze i klawiatury udostępniane przez system operacyjny mogą być chronionymi lub zdalnymi powierzchniami i nie można ich wiarygodnie przechwycić
| `debug` | `Bool` | `false` | Wydrukuj szczegółowe logi SDK na konsoli |

## Zatrzymywanie nagrywania

Zatrzymaj bieżącą sesję i opróżnij oczekujące dane:

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

Wariant wywołania zwrotnego jest dostępny dla kontekstów nieasynchronicznych:

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## Identyfikator sesji

Uzyskaj dostęp do bieżącego identyfikatora sesji w dowolnym momencie, aby powiązać go z własnymi dziennikami lub narzędziami wsparcia:

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
