<!-- AI_PROMPT_SECTION -->
**Używasz Cursor, Claude lub ChatGPT?** Skopiuj monit dotyczący integracji i wklej go do asystenta AI, aby automatycznie wygenerować kod instalacyjny.

<!-- /AI_PROMPT_SECTION -->

## Instalacja

Dodaj pakiet Rejourney do swojego projektu, używając npm lub yarn.

```bash
npm install @rejourneyco/browser
```

## Konfiguracja podstawowa

Zainicjuj i uruchom Rejourney w punkcie wejścia aplikacji.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init` pobiera zdalną konfigurację Twojego projektu i przygotowuje SDK. `start` rozpoczyna sesję, rejestruje gościa i (jeśli włączone jest odtwarzanie) uruchamia rejestrator rrweb. Obydwa są asynchroniczne i można je bezpiecznie wywołać bez czekania, jeśli nie musisz niczego bramkować po zakończeniu.




> [!NOTE]
> Domyślnie `autoStart` to `false`. Musisz jawnie wywołać `start()`, co pozwala na zablokowanie nagrywania po sprawdzeniu zgody. Aby rozpocząć automatycznie po `init`, należy przekazać `{ autoStart: true }`.

### Integracje frameworków

Pakiet zawiera dedykowane punkty wejścia dla popularnych frameworków. Użyj tego, który pasuje do Twojego stosu — lub użyj powyższego standardowego API z dowolnego frameworka.

---

#### Zareagować

```javascript
import { RejourneyProvider, useRejourney } from '@rejourneyco/browser/react';

// Wrap your app root
function App() {
  return (
    <RejourneyProvider publicKey="pk_live_your_public_key" startOnMount>
      <YourApp />
    </RejourneyProvider>
  );
}

// Access the SDK anywhere inside the tree
function MyComponent() {
  const rejourney = useRejourney();

  function handlePurchase() {
    rejourney.logEvent('purchase_completed', { plan: 'pro' });
  }
}
```

`startOnMount` domyślnie ma wartość `false` w `RejourneyProvider`. Przekaż `startOnMount` (lub `startOnMount={true}`), aby rozpocząć nagrywanie zaraz po zamontowaniu komponentu.

---

#### Następny.js

```javascript
// app/layout.tsx (or pages/_app.tsx)
import { RejourneyNext } from '@rejourneyco/browser/next';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <RejourneyNext publicKey="pk_live_your_public_key" />
        {children}
      </body>
    </html>
  );
}
```

`RejourneyNext` to komponent `'use client'`, który renderuje `null`. Wartość domyślna `startOnMount` to `true`. Zmiany trasy są śledzone automatycznie za pomocą Historii API.

---

#### Vue

```javascript
// main.ts
import { createApp } from 'vue';
import { createRejourney } from '@rejourneyco/browser/vue';
import App from './App.vue';
import router from './router';

const app = createApp(App);

app.use(createRejourney({
  publicKey: 'pk_live_your_public_key',
  router, // optional — enables per-route screen tracking via router.afterEach
}));

app.use(router).mount('#app');
```

Instancja Rejourney jest dostępna poprzez `app.config.globalProperties.$rejourney` i `inject('rejourney')`. Dla wygody można również eksportować materiał kompozytowy `useRejourney()`.

---

#### Dalej

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

Sufiks `.client.ts` zapewnia, że ​​ta wtyczka będzie działać tylko w przeglądarce. Instancja Rejourney jest wstrzykiwana jako `$rejourney` i dostępna poprzez `useNuxtApp().$rejourney`.

---

#### Svelte / SvelteKit

```javascript
// +layout.svelte
<script>
  import { onMount } from 'svelte';
  import { startRejourneyOnMount } from '@rejourneyco/browser/svelte';

  onMount(() => startRejourneyOnMount({ publicKey: 'pk_live_your_public_key' }));
</script>
```

`startRejourneyOnMount` zwraca funkcję czyszczącą, która wywołuje `Rejourney.stop()` — wartość zwracana przez Svelte `onMount` jest automatycznie używana jako wywołanie zwrotne niszczenia.

---

#### Kątowy

```javascript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { createRejourneyAppInitializer } from '@rejourneyco/browser/angular';

export const appConfig: ApplicationConfig = {
  providers: [
    {
      provide: APP_INITIALIZER,
      useFactory: () => createRejourneyAppInitializer({ publicKey: 'pk_live_your_public_key' }),
      multi: true,
    },
  ],
};
```

`createRejourneyAppInitializer` zwraca fabrykę, która inicjuje i uruchamia Rejourney podczas fazy ładowania Angulara. Możesz także wstrzyknąć `RejourneyService` dla API opartego na klasach.

---

#### Remiks

```javascript
// app/root.tsx
import { RejourneyRemix } from '@rejourneyco/browser/remix';

export default function App() {
  return (
    <html>
      <body>
        <RejourneyRemix publicKey="pk_live_your_public_key" />
        <Outlet />
      </body>
    </html>
  );
}
```

Wartość domyślna `startOnMount` to `true`. Zmiany trasy są śledzone automatycznie.

---

#### Astro

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

`startRejourneyForAstro` nie działa w środowiskach SSR — przed uruchomieniem sprawdza `window`.

---

## Ustawienia zdalnego nagrywania

Ustawienia projektu mogą kontrolować domyślne ustawienia nagrywania w Internecie bez konieczności wdrażania kodu. SDK odczytuje zdalną konfigurację przy każdym wywołaniu `start()`. Zdalna konfiguracja może całkowicie włączyć lub wyłączyć nagrywanie, dostosować listę dozwolonych domen i ustawić maksymalny czas trwania sesji. Jeśli zdalna konfiguracja jest niedostępna, `start()` nie będzie kontynuowane — ma to na celu zapobieganie nagrywaniu w nieznanym stanie projektu.

## Śledzenie trasy

Rejourney automatycznie śledzi zmiany stron i tras, dzięki czemu możesz zobaczyć kontekst nawigacji w powtórkach. Jest to domyślnie włączone (`autoTrackRoutes: true`) i działa poprzez przechwytywanie połączeń History API (`pushState`, `replaceState`) i nasłuchiwanie zdarzeń `popstate`.

### Niestandardowe nazwy tras

Domyślnie jako nazwa ekranowa używana jest bieżąca nazwa `window.location.pathname`. Aby zapewnić własną logikę nazewnictwa, przekaż funkcję `routeName`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### Ręczne śledzenie ekranu

Aby ręcznie śledzić ekrany (np. w przypadku zmiany zakładek lub przejść między widokami na stronie), zadzwoń bezpośrednio do `trackScreen`:

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

Aby wyłączyć automatyczne śledzenie trasy i polegać wyłącznie na wywołaniach ręcznych:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## Identyfikacja użytkownika

Powiąż sesje z wewnętrznymi identyfikatorami użytkowników, aby filtrować i wyszukiwać określonych użytkowników w panelu kontrolnym.

```javascript
import { Rejourney } from '@rejourneyco/browser';

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
import { Rejourney } from '@rejourneyco/browser';

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
   - **Właściwość zdarzenia** — Zawęź dalej według klucza właściwości i/lub wartości (np. `plan = pro`)
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
import { Rejourney } from '@rejourneyco/browser';

// Set a single property
Rejourney.setMetadata('plan', 'premium');

// Set multiple properties at once
Rejourney.setMetadata({
  role: 'admin',
  segment: 'enterprise',
  ab_variant: 'checkout_v2'
});
```

Wartości metadanych muszą mieć wartość `string`, `number` lub `boolean`. Obiekty i tablice nie są akceptowane.

### Kiedy używać metadanych a kiedy zdarzeń

| Przypadek użycia | Użyj **Metadane** | Użyj **Wydarzenia** |
|---|---|---|
| Abonament użytkownika | `setMetadata('plan', 'pro')` | |
| Użytkownik kliknął przycisk | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| Wariant testu A/B | `setMetadata('ab_variant', 'v2')` | |
| Zakup zakończony | | `logEvent('purchase', { amount: 29 })` |
| Rola użytkownika | `setMetadata('role', 'admin')` | |
| Osiągnięto etap wdrożenia | | `logEvent('onboarding_step', { step: 3 })` |

**Praktyczna zasada:** Jeśli opisuje *kim jest użytkownik* lub *w jakim jest stanie*, użyj metadanych. Jeśli opisuje *coś, co się wydarzyło*, użyj zdarzeń.

## Kontrola prywatności

Wszystkie wprowadzone teksty są domyślnie maskowane (`maskAllInputs: true`). Zamaskowane pola pojawiają się w powtórkach jako puste dane wejściowe, a wartości nigdy nie są przechwytywane u źródła. Hasło, adres e-mail, telefon i inne wrażliwe typy danych wejściowych są zawsze maskowane niezależnie od tego ustawienia.

### Elementy blokujące

Aby całkowicie wykluczyć element DOM z powtórek (pojawia się jako pełny element zastępczy), dodaj jedną z poniższych opcji:

- Klasa CSS: `rr-block`
- Atrybut danych: `data-rj-block` lub `data-rejourney-block`
- Niestandardowy selektor CSS poprzez opcję konfiguracyjną `blockSelector`

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### Maskowanie tekstu

Aby zamaskować zawartość tekstową elementu (tekst zostanie zastąpiony, ale kształt elementu pozostanie widoczny), dodaj jedną z poniższych opcji:

- Klasa CSS: `rr-mask`
- Atrybut danych: `data-rj-mask`, `data-rejourney-mask`, `data-private` lub dowolny `data-testid` zawierający `"password"`
- Niestandardowy selektor CSS poprzez opcję konfiguracyjną `maskTextSelector`

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### Ignorowanie elementów

Aby uchwycić kształt elementu, ale pominąć wszystkie zdarzenia interakcji (kliknięcia, wejścia) na nim, dodaj:

- Klasa CSS: `rr-ignore`
- Atrybut danych: `data-rj-ignore` lub `data-rejourney-ignore`

### Niestandardowe funkcje maskowania

W przypadku programowej logiki maskowania użyj `maskInputFn` lub `maskTextFn`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### Zgoda użytkownika i GDPR




> [!IMPORTANT]
> **Jesteś Administratorem Danych.** Rejourney działa w Twoim imieniu jako podmiot przetwarzający dane. Ponosisz odpowiedzialność za zapewnienie, że Twoi użytkownicy końcowi są informowani o nagrywaniu sesji oraz że masz ważną podstawę prawną do przetwarzania ich danych (np. zgoda lub uzasadnione interesy).

#### Co musisz zrobić

1. **Udostępnij nagranie sesji w swojej polityce prywatności.** Uwzględnij język, taki jak:

   > * „Używamy Rejourney do rejestrowania anonimowych i nieanonimowych powtórek sesji Twojej aktywności w naszej witrynie, aby pomóc nam ulepszyć produkt i zmniejszyć tarcia. Dane sesji mogą obejmować interakcje na stronach, informacje o przeglądarce i przybliżoną lokalizację. Wprowadzane teksty i wrażliwe elementy są automatycznie maskowane i nigdy nie są przechwytywane.”*

2. **Nagranie bramkowe za zgodą** (zalecane dla użytkowników z EOG):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Szanuj rezygnację.** Jeśli użytkownik wycofa zgodę, zatrzymaj nagrywanie i wyczyść jego tożsamość:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Szczegółowa zgoda poprzez `setConsent`

Aby uzyskać lepszą kontrolę, użyj `setConsent`, aby niezależnie przełączać analizy i powtórki:

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

Wspólne ustawienie `analytics: false` i `replay: false` zatrzymuje sesję i usuwa wszystkie dane w kolejce. Samo ustawienie `replay: false` zatrzymuje rejestrator rrweb, ale utrzymuje śledzenie zdarzeń.

#### Przechwytywanie dziennika konsoli

Przechwytywanie dziennika konsoli jest domyślnie wyłączone (`trackConsoleLogs: false`). Włącz tę opcję tylko wtedy, gdy jest to potrzebne, ponieważ dzienniki konsoli mogą zawierać PII, w zależności od praktyk rejestrowania:

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### Geolokalizacja

Domyślnie zbierana jest geolokalizacja oparta na adresie IP (kraj, region, miasto). Gdy `collectGeoLocation` to `false`, SDK przekazuje flagę, która blokuje wyszukiwanie geolokalizacji IP na backendie — dla tej sesji nie są przechowywane żadne dane o lokalizacji:

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Tryb tylko obserwacji (bez nagrywania wizualnego)

Aby rejestrować błędy, długie zadania, aktywność sieciową i analizować **bez** rejestrując powtórki wizualne, ustaw `observeOnly: true`:

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Po włączeniu zbierane są wszystkie dane telemetryczne, ale nie jest uruchamiane nagrywanie rrweb — sesje nie będą wyświetlane na stronie Powtórki, ale nadal przechwytywane będą pełne dane analityczne, dane o błędach i sieci. Przydatne, gdy użytkownik zrezygnował z nagrywania wizualnego, ale nadal zależy Ci na jego obserwowalności.

> **Notatka:** Możesz ustawić to warunkowo dla każdego użytkownika, na przykład w oparciu o zapisane preferencje dotyczące zgody:
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### Wykrywanie botów

Boty i automatyczne przeglądarki są domyślnie ignorowane (`ignoreBots: true`). Playwright, Puppeteer, Selenium i inni klienci korzystający ze sterowników internetowych są pomijani. Aby nagrać sesje automatyzacji (np. dla narzędzi wewnętrznych):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

Aby zapewnić niestandardowy wzorzec wykrywania botów:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### Przechwytywanie żądań sieciowych

Żądania sieciowe (fetch i XHR) są domyślnie przechwytywane i rejestrowane (`autoTrackNetwork: true`). Domyślnie przechwytywane są rozmiary treści żądań i odpowiedzi **nie** (`networkCaptureSizes: false`). Adresy URL, metody, kody stanu i czasy trwania są zawsze przechwytywane.

Aby wykluczyć określone adresy URL:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

Aby filtrować lub redagować żądania przed ich wysłaniem:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## Informacje o konfiguracji

| Opcja | Wpisz | Domyślne | Opis |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | Wywołaj `start()` automatycznie po zakończeniu `init()` |
| `disableInDev` | `boolean` | `false` | Pomiń nagrywanie na `localhost` i `127.0.0.1` |
| `debug` | `boolean` | `false` | Włącz pełne rejestrowanie SDK w konsoli przeglądarki |
| `enabled` | `boolean` | `true` | Główny wyłącznik awaryjny — ustawiony na `false`, aby zapobiec nagrywaniu |
| `observeOnly` | `boolean` | `false` | Przechwytuj statystyki/błędy/sieć bez odtwarzania wizualnego |
| `captureReplay` | `boolean` | `true` | Włącz przechwytywanie wizualnej powtórki rrweb |
| `allowedDomains` | `string[]` | `[]` | Ogranicz nagrywanie do określonych domen. Puste oznacza, że ​​wszystkie domeny są dozwolone. Obsługuje symbole wieloznaczne `*.example.com` |
| `maxSessionDuration` | `number` | `1800000` | Maksymalna długość sesji w milisekundach (domyślnie: 30 minut) |
| `collectGeoLocation` | `boolean` | `true` | Zbieraj kraj/region/miasto na podstawie adresu IP |
| `captureAttribution` | `boolean` | `true` | Przechwyć parametry UTM, stronę odsyłającą i adres URL wpisu na początku sesji |
| `ignoreBots` | `boolean` | `true` | Pomiń nagrywanie wykrytych botów i sterowników internetowych |
| `recordAutomation` | `boolean` | `false` | Zezwalaj na nagrywanie sesji dramaturga/lalkarza/Selenium |
| `autoTrackRoutes` | `boolean` | `true` | Automatycznie śledź zmiany trasy za pomocą Historii API |
| `routeName` | `(location: Location) => string` | — | Funkcja niestandardowa do wyprowadzania nazwy ekranowej z `window.location` |
| `autoTrackNetwork` | `boolean` | `true` | Przechwytywanie i rejestrowanie żądań pobierania/XHR |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | Adresy URL, które należy wykluczyć ze śledzenia sieci |
| `networkCaptureSizes` | `boolean` | `false` | Uwzględnij rozmiary treści żądania/odpowiedzi w dziennikach sieciowych |
| `trackConsoleLogs` | `boolean` | `false` | Przechwyć dane wyjściowe `console.log/warn/error` |
| `trackLongTasks` | `boolean` | `true` | Wykrywaj i rejestruj długie zadania (bloki wątków JS > 50 ms) |
| `trackResourceErrors` | `boolean` | `true` | Przechwytuj nieudane ładowanie zasobów (obrazy, skrypty, arkusze stylów) |
| `maskAllInputs` | `boolean` | `true` | Maskuj wszystkie wartości wprowadzonego tekstu w powtórkach |
| `blockClass` | `string \| RegExp` | `'rr-block'` | Klasa CSS, aby całkowicie zablokować element przed powtórką |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | Selektor CSS do całkowitego blokowania elementów przed powtórką |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | Klasa CSS do ignorowania zdarzeń interakcji na elemencie |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | Selektor CSS do ignorowania zdarzeń interakcji |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | Klasa CSS do maskowania treści tekstowej w powtórce |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | Selektor CSS do maskowania treści tekstowej |
| `maskInputFn` | `(value, element) => string` | — | Funkcja niestandardowa do przekształcania wartości wejściowych przed przechwyceniem |
| `maskTextFn` | `(text, element) => string` | — | Niestandardowa funkcja przekształcania treści tekstowej przed przechwyceniem |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | Niestandardowa funkcja decydowania o tym, czy nagrać stronę w trybie ładowania |
| `beforeSendEvent` | `(event) => event \| null` | — | Filtruj lub modyfikuj wydarzenia, zanim zostaną umieszczone w kolejce. Zwróć `null`, aby upuścić |
| `beforeSendNetwork` | `(request) => request \| null` | — | Filtruj lub modyfikuj wpisy sieciowe, zanim zostaną umieszczone w kolejce. Zwróć `null`, aby upuścić |
| `onAuthError` | `(error) => void` | — | Wywoływany, gdy SDK nie może uwierzytelnić się z backendem |

## Zatrzymywanie nagrywania

Wywołaj `stop()`, aby zakończyć sesję, opróżnij wszystkie oczekujące zdarzenia i wyczyść wszystkie słuchacze SDK:

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()` można bezpiecznie wywoływać wiele razy. Po zatrzymaniu zadzwoń ponownie do `start()`, aby rozpocząć nową sesję.

## Identyfikator sesji

Uzyskaj dostęp do bieżącego identyfikatora sesji, aby powiązać sesje Rejourney z własnymi dziennikami lub narzędziami wsparcia:

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

Zwraca `null`, jeśli żadna sesja nie jest aktywna.

## Pomocnicy statusu

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```
