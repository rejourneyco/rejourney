<!-- AI_PROMPT_SECTION -->
**Używasz Cursor, Claude lub ChatGPT?** Skopiuj monit dotyczący integracji i wklej go do asystenta AI, aby automatycznie wygenerować kod instalacyjny.

<!-- /AI_PROMPT_SECTION -->

## Instalacja

Dodaj pakiet Rejourney do swojego projektu, używając npm lub yarn.

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> Rejourney wymaga kodu natywnego i nie jest kompatybilny z Expo Go. Użyj kompilacji programistycznych:
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## Konfiguracja 3 linii

Zainicjuj i uruchom Rejourney u góry aplikacji (np. w App.tsx lub Index.js).

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

Nie wymaga pakowania dostawcy. Nagrywanie rozpoczyna się natychmiast.

## Ustawienia zdalnego nagrywania

Ustawienia projektu mogą kontrolować domyślne ustawienia nagrywania React Native bez konieczności wysyłania nowej wersji aplikacji. Obsługiwane wersje SDK odczytują ustawienia FPS podczas zdalnego nagrywania po rozpoczęciu sesji; wartość domyślna to 1 FPS, a administratorzy projektu mogą wybrać 1, 2 lub 3 FPS. Jeśli zdalna konfiguracja jest niedostępna, SDK powraca do lokalnego/domyślnego działania przechwytywania.

## Śledzenie ekranu

Rejourney automatycznie śledzi zmiany na ekranie, dzięki czemu podczas powtórek możesz sprawdzić, gdzie w aplikacji znajdują się użytkownicy. Wybierz konfigurację pasującą do Twojej biblioteki nawigacji:

### Expo Router (automatyczny)

Jeśli używasz **Expo Router**, śledzenie ekranu działa od razu po wyjęciu z pudełka. Nie jest potrzebny żaden dodatkowy kod.




> [!TIP]
> **Używasz niestandardowych nazw ekranowych?** Jeśli używasz Expo Router, ale chcesz ręcznie podać własne nazwy ekranowe, zapoznaj się z sekcją [Niestandardowe nazwy ekranowe](#custom-screen-names) poniżej.

---

### React Navigation

Jeśli używasz **React Navigation** (`@react-navigation/native`), użyj haka `useNavigationTracking` w katalogu głównym `NavigationContainer`:

```javascript
import { Rejourney } from '@rejourneyco/react-native';
import { NavigationContainer } from '@react-navigation/native';

function App() {
  const navigationTracking = Rejourney.useNavigationTracking();

  return (
    <NavigationContainer {...navigationTracking}>
      {/* Your screens */}
    </NavigationContainer>
  );
}
```

---

### Niestandardowe nazwy ekranowe

Jeśli chcesz ręcznie określić nazwy ekranów (np. w celu zapewnienia spójności analitycznej lub jeśli nie korzystasz z powyższych bibliotek), użyj metody `trackScreen`.

#### Dla użytkowników Expo Router:
Aby używać niestandardowych nazw z Expo Router, musisz najpierw wyłączyć automatyczne śledzenie w swojej konfiguracji:

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### Ręczne połączenie śledzące:
Wywołaj `trackScreen` za każdym razem, gdy nastąpi zmiana ekranu:

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## Identyfikacja użytkownika

Powiąż sesje z wewnętrznymi identyfikatorami użytkowników, aby filtrować i wyszukiwać określonych użytkowników w panelu kontrolnym.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Prywatność:** Użyj wewnętrznych identyfikatorów lub UUID. Jeśli musisz użyć PII (e-mail, telefon), zahaszuj go przed wysłaniem.

## Niestandardowe wydarzenia

Śledź znaczące działania użytkowników, aby zrozumieć wzorce zachowań, debugować problemy i filtrować powtórki sesji na pulpicie nawigacyjnym.

### Podstawowe użycie

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Simple event (name only)
Rejourney.logEvent('signup_completed');

// Event with properties
Rejourney.logEvent('button_clicked', { buttonName: 'signup' });
```

### API

```typescript
Rejourney.logEvent(name: string, properties?: Record<string, unknown>)
```

| Parametr | Wpisz | Wymagane | Opis |
|---|---|---|---|
| `name` | `string` | Tak | Nazwa zdarzenia — dla zachowania spójności użyj `snake_case` |
| `properties` | `object` | Nie | Pary klucz-wartość dołączone do tego konkretnego wystąpienia zdarzenia |

### Przykłady

```javascript
// E-commerce
Rejourney.logEvent('purchase_completed', {
  plan: 'pro',
  amount: 29.99,
  currency: 'USD'
});

// Onboarding
Rejourney.logEvent('onboarding_step', {
  step: 3,
  stepName: 'profile_setup',
  skipped: false
});

// Feature usage
Rejourney.logEvent('feature_used', {
  feature: 'dark_mode',
  enabled: true
});

// Errors / edge cases
Rejourney.logEvent('payment_failed', {
  errorCode: 'card_declined',
  retryCount: 2
});
```

### Jak wydarzenia pojawiają się na pulpicie nawigacyjnym

Zdarzenia niestandardowe są przechowywane dla poszczególnych sesji i widoczne w dwóch miejscach:

1. **Oś czasu powtórki sesji** — Wydarzenia pojawiają się jako znaczniki na osi czasu powtórki, dzięki czemu można przejść do dokładnego momentu, w którym miała miejsce dana czynność.
2. **Filtry archiwum sesji** — Filtruj listę sesji według:
   - **Nazwa wydarzenia** — Znajdź wszystkie sesje zawierające określone zdarzenie (np. `purchase_completed`)
   - **Właściwość wydarzenia** — Zawęź dalej według klucza właściwości i/lub wartości (np. `plan = pro`)
   - **Liczba zdarzeń** — Znajdź sesje z określoną liczbą niestandardowych zdarzeń (np. więcej niż 5 zdarzeń)

### Najlepsze praktyki




> [!TIP]
> - Używaj spójnego nazewnictwa (`snake_case`, np. `button_clicked` nie `Button Clicked`)
> - Zachowaj proste wartości właściwości (łańcuchy, liczby, wartości logiczne) — unikaj obiektów zagnieżdżonych
> - Skoncentruj się na działaniach istotnych dla debugowania lub analiz — nie rejestruj wszystkiego
> - Właściwości dotyczą kontekstu pojedynczego zdarzenia. W przypadku atrybutów na poziomie sesji użyj zamiast tego **Metadane**

---

## Metadane

Dołącz pary klucz-wartość na poziomie sesji, które opisują kontekst użytkownika lub sesji. W przeciwieństwie do zdarzeń, metadane są ustawiane raz na klucz i mają zastosowanie do całej sesji.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Set a single property
Rejourney.setMetadata('plan', 'premium');

// Set multiple properties at once
Rejourney.setMetadata({
  role: 'admin',
  segment: 'enterprise',
  ab_variant: 'checkout_v2'
});
```

### Kiedy używać metadanych a kiedy zdarzeń

| Przypadek użycia | Użyj **Metadane** | Użyj **Wydarzenia** |
|---|---|---|
| Abonament użytkownika |  `setMetadata('plan', 'pro')` | |
| Użytkownik kliknął przycisk | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| Wariant testu A/B |  `setMetadata('ab_variant', 'v2')` | |
| Zakup zakończony | |  `logEvent('purchase', { amount: 29 })` |
| Rola użytkownika |  `setMetadata('role', 'admin')` | |
| Osiągnięto etap wdrożenia | |  `logEvent('onboarding_step', { step: 3 })` |

**Praktyczna zasada:** Jeśli opisuje *kim jest użytkownik* lub *w jakim jest stanie*, użyj metadanych. Jeśli opisuje *coś, co się wydarzyło*, użyj zdarzeń.

## Kontrola prywatności

Wprowadzany tekst i widoki z kamery są domyślnie automatycznie maskowane. Administratorzy projektu mogą zmienić domyślny poziom maskowania wprowadzania tekstu w Ustawieniach projektu dla obsługiwanych wersji SDK; starsze wersje SDK ignorują to zdalne ustawienie i zachowują dotychczasowe zachowanie maskowania. Pola bezpieczne/hasła, widoki z kamer i jawne maski pozostają chronione.

Aby ręcznie ukryć dodatkowy wrażliwy interfejs użytkownika, zawiń komponenty w komponencie `Mask`:

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

Zamaskowana treść pojawia się w powtórkach w postaci pełnego prostokąta i nigdy nie jest przechwytywana u źródła.

### Zgoda użytkownika i GDPR




> [!IMPORTANT]
> **Jesteś Administratorem Danych.** Rejourney działa w Twoim imieniu jako podmiot przetwarzający dane. Ponosisz odpowiedzialność za zapewnienie, że Twoi użytkownicy końcowi są informowani o nagrywaniu sesji oraz że masz ważną podstawę prawną do przetwarzania ich danych (np. zgoda lub uzasadnione interesy).

#### Co musisz zrobić

1. **Ujawnij nagranie sesji w polityce prywatności swojej aplikacji.** Uwzględnij język, taki jak:

   > * „Korzystamy z Rejourney do rejestrowania anonimowych ORAZ niezanonimizowanych powtórek sesji Twojej aktywności w aplikacji, aby pomóc nam ulepszyć produkt, śledzić awarie i problemy oraz zmniejszać problemy z produktem. Dane sesji mogą obejmować interakcje na ekranie, informacje o urządzeniu i przybliżoną lokalizację. Wprowadzane teksty i wrażliwe elementy interfejsu użytkownika są automatycznie maskowane i nigdy nie są przechwytywane.”*

2. **Nagranie bramkowe za zgodą** (zalecane dla użytkowników z EOG):

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Szanuj rezygnację.** Jeśli użytkownik wycofa zgodę, zatrzymaj nagrywanie i wyczyść jego dane:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Przechwytywanie dziennika konsoli

Przechwytywanie dziennika konsoli jest domyślnie włączone (`trackConsoleLogs: true`). Dzienniki konsoli mogą zawierać PII w zależności od praktyk rejestrowania stosowanych w aplikacji. Wyłącz tę opcję, jeśli w logach mogą pojawić się wrażliwe dane:

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### Geolokalizacja

Domyślnie zbierana jest geolokalizacja oparta na adresie IP (kraj, region, miasto). Gdy `collectGeoLocation` to `false`, SDK przekazuje flagę do warstwy natywnej, która blokuje wyszukiwanie geolokalizacji IP na backendzie — dla tej sesji nie są przechowywane żadne dane o lokalizacji. Wyłącz tę opcję, jeśli nie potrzebujesz danych o lokalizacji lub chcesz zminimalizować gromadzenie danych dla użytkowników z EOG:

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Arkusze rodzime

Natywne przechwytywanie arkuszy jest domyślnie włączone (`captureNativeSheets: true`) dla obsługiwanych wersji SDK. Dzięki temu natywne arkusze i okna dialogowe należące do aplikacji, takie jak moduły autoryzacji płatności, mogą pojawiać się w powtórkach debugowania, gdy system operacyjny pozwala na przechwytywanie. Arkusze klawiatury/systemu wprowadzania tekstu są wykluczane, gdy wprowadzanie tekstu jest domyślnie maskowane. Gdy maskowanie wprowadzania tekstu jest ustawione tylko na pola zabezpieczone, klawiatury działają wyłącznie w trybie best-efektywnym i nie można ich wiarygodnie przechwycić, zwłaszcza gdy system operacyjny renderuje je jako powierzchnie chronione lub zdalne. Arkusze udostępniane systemu operacyjnego są również stosowane wyłącznie w trybie best-efektywnym i nie można ich wiarygodnie przechwycić, gdy system renderuje je jako chronione lub odległe powierzchnie.

Wyłącz natywne przechwytywanie arkuszy, jeśli chcesz, aby powtórka wizualna ograniczała się do głównego okna aplikacji:

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### Tryb tylko obserwacji (bez nagrywania wizualnego)

Aby przechwytywać błędy, awarie, ANRs i aktywność sieciową **bez** nagrywającą powtórki wizualne, ustaw `observeOnly: true`:

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Po włączeniu zbierane są wszystkie dane telemetryczne, ale nie są robione żadne zrzuty ekranu — sesje NIE BĘDĄ wyświetlane na stronie powtórek, ale będą dostępne pełne dane analityczne/błędy/sieć/awarie. Brak powtórki. Jest to przydatne, gdy użytkownicy zrezygnowali z nagrywania ekranu, ale nadal chcesz widzieć błędy.

> **Notatka:** Można to ustawić warunkowo dla każdego użytkownika, na przykład w oparciu o zapisane preferencje lub flagę zgody:
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```
