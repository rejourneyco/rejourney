<!-- AI_PROMPT_SECTION -->
**Verwenden Sie Cursor, Claude oder ChatGPT?** Kopieren Sie die Integrationsaufforderung und fügen Sie sie in Ihren AI-Assistenten ein, um den Setup-Code automatisch zu generieren.

<!-- /AI_PROMPT_SECTION -->

## Installation

Fügen Sie das Paket Rejourney zu Ihrem Projekt hinzu, indem Sie npm oder yarn verwenden.

```bash
npm install @rejourneyco/browser
```

## Grundeinrichtung

Initialisieren und starten Sie Rejourney am Einstiegspunkt Ihrer App.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init` ruft die Remote-Konfiguration Ihres Projekts ab und bereitet SDK vor. `start` startet die Sitzung, registriert den Besucher und startet (sofern die Wiedergabe aktiviert ist) den rrweb-Recorder. Beide sind asynchron und können ohne Wartezeit aufgerufen werden, wenn Sie nach Abschluss keine Gates benötigen.




> [!NOTE]
> `autoStart` ist standardmäßig `false`. Sie müssen `start()` explizit aufrufen, damit Sie die Aufzeichnung hinter einer Einwilligungsprüfung eingrenzen können. Um nach `init` automatisch zu starten, übergeben Sie `{ autoStart: true }`.

### Framework-Integrationen

Das Paket enthält dedizierte Einstiegspunkte für gängige Frameworks. Verwenden Sie diejenige, die zu Ihrem Stack passt – oder verwenden Sie die obige Variante API aus einem beliebigen Framework.

---

#### Reagieren

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

`startOnMount` ist auf `RejourneyProvider` standardmäßig `false`. Übergeben Sie `startOnMount` (oder `startOnMount={true}`), um mit der Aufzeichnung zu beginnen, sobald die Komponente bereitgestellt wird.

---

#### Next.js

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

`RejourneyNext` ist eine `'use client'`-Komponente, die `null` rendert. `startOnMount` ist standardmäßig `true`. Routenänderungen werden automatisch über den Verlauf API verfolgt.

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

Die Instanz Rejourney ist über `app.config.globalProperties.$rejourney` und über `inject('rejourney')` verfügbar. Der Einfachheit halber wird auch das zusammensetzbare Element `useRejourney()` exportiert.

---

#### Nuxt

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

Das Suffix `.client.ts` stellt sicher, dass dieses Plugin nur im Browser ausgeführt wird. Die Instanz Rejourney wird als `$rejourney` eingefügt und ist über `useNuxtApp().$rejourney` verfügbar.

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

`startRejourneyOnMount` gibt eine Bereinigungsfunktion zurück, die `Rejourney.stop()` aufruft. Der Rückgabewert `onMount` von Svelte wird automatisch als Zerstörungsrückruf verwendet.

---

#### Eckig

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

`createRejourneyAppInitializer` gibt eine Factory zurück, die Rejourney während der Bootstrap-Phase von Angular initialisiert und startet. Sie können auch `RejourneyService` für ein klassenbasiertes API einfügen.

---

#### Remix

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

`startOnMount` ist standardmäßig `true`. Routenänderungen werden automatisch verfolgt.

---

#### Astro

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

`startRejourneyForAstro` No-Ops in SSR-Umgebungen – vor der Ausführung wird geprüft, ob `window` vorliegt.

---

## Remote-Aufnahmeeinstellungen

Mit den Projekteinstellungen können Sie die Standardeinstellungen für die Webaufzeichnung steuern, ohne dass Code bereitgestellt werden muss. Der SDK liest die Remote-Konfiguration bei jedem `start()`-Aufruf. Die Remote-Konfiguration kann die Aufzeichnung vollständig aktivieren oder deaktivieren, die Liste der zulässigen Domänen anpassen und eine maximale Sitzungsdauer festlegen. Wenn die Remote-Konfiguration nicht verfügbar ist, wird `start()` nicht fortfahren – dies ist beabsichtigt, um die Aufzeichnung unter unbekanntem Projektstatus zu verhindern.

## Routenverfolgung

Rejourney verfolgt automatisch Seiten- und Routenänderungen, sodass Sie den Navigationskontext in Wiederholungen sehen können. Dies ist standardmäßig aktiviert (`autoTrackRoutes: true`) und funktioniert durch das Abfangen von Verlaufs-API-Aufrufen (`pushState`, `replaceState`) und das Abhören von `popstate`-Ereignissen.

### Benutzerdefinierte Routennamen

Als Bildschirmname wird standardmäßig der aktuelle `window.location.pathname` verwendet. Um Ihre eigene Benennungslogik bereitzustellen, übergeben Sie eine `routeName`-Funktion:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### Manuelle Bildschirmverfolgung

Um Bildschirme manuell zu verfolgen (z. B. für Tab-Wechsel oder In-Page-View-Übergänge), rufen Sie `trackScreen` direkt auf:

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

So deaktivieren Sie die automatische Routenverfolgung und verlassen sich ausschließlich auf manuelle Anrufe:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## Benutzeridentifikation

Verknüpfen Sie Sitzungen mit Ihren internen Benutzer-IDs, um im Dashboard nach bestimmten Benutzern zu filtern und zu suchen.

```javascript
import { Rejourney } from '@rejourneyco/browser';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Datenschutz:** Verwenden Sie interne IDs oder UUIDs. Wenn Sie PII (E-Mail, Telefon) verwenden müssen, hashen Sie es vor dem Senden.

## Benutzerdefinierte Ereignisse

Verfolgen Sie sinnvolle Benutzeraktionen, um Verhaltensmuster zu verstehen, Probleme zu beheben und Sitzungswiederholungen im Dashboard zu filtern.

### Grundlegende Verwendung

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

| Parameter | Geben Sie | ein Erforderlich | Beschreibung |
|---|---|---|---|
| `name` | `string` | Ja | Ereignisname – verwenden Sie `snake_case` für Konsistenz |
| `properties` | `object` | Nein | Schlüssel-Wert-Paare, die diesem bestimmten Ereignisereignis zugeordnet sind |

### Beispiele

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

### Wie Ereignisse im Dashboard angezeigt werden

Benutzerdefinierte Ereignisse werden pro Sitzung gespeichert und sind an zwei Orten sichtbar:

1. **Zeitleiste der Sitzungswiederholung** – Ereignisse werden als Markierungen auf der Wiedergabezeitleiste angezeigt, sodass Sie genau zum Zeitpunkt einer Aktion springen können.
2. **Sitzungsarchivfilter** – Filtern Sie die Sitzungsliste nach:
   - **Veranstaltungsname** – Alle Sitzungen finden, die ein bestimmtes Ereignis enthalten (z. B. `purchase_completed`)
   - **Veranstaltungseigentum** – Weitere Eingrenzung nach Eigenschaftsschlüssel und/oder Wert (z. B. `plan = pro`)
   - **Anzahl der Ereignisse** – Sitzungen mit einer bestimmten Anzahl benutzerdefinierter Ereignisse finden (z. B. mehr als 5 Ereignisse)

### Best Practices




> [!TIP]
> - Verwenden Sie eine konsistente Benennung (`snake_case`, z. B. `button_clicked`, nicht `Button Clicked`).
> - Halten Sie Eigenschaftswerte einfach (Zeichenfolgen, Zahlen, boolesche Werte) – vermeiden Sie verschachtelte Objekte
> - Konzentrieren Sie sich auf Aktionen, die für das Debuggen oder die Analyse von Bedeutung sind – protokollieren Sie nicht alles
> - Eigenschaften gelten für den Kontext pro Ereignis. Verwenden Sie für Attribute auf Sitzungsebene stattdessen **Metadaten**

---

## Metadaten

Fügen Sie Schlüssel-Wert-Paare auf Sitzungsebene hinzu, die den Benutzer- oder Sitzungskontext beschreiben. Im Gegensatz zu Ereignissen werden Metadaten einmal pro Schlüssel festgelegt und gelten für die gesamte Sitzung.

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

Metadatenwerte müssen `string`, `number` oder `boolean` sein. Objekte und Arrays werden nicht akzeptiert.

### Wann Metadaten vs. Ereignisse verwendet werden sollten

| Anwendungsfall | Verwenden Sie **Metadaten** | Verwenden Sie **Veranstaltungen** |
|---|---|---|
| Abonnementplan des Benutzers | `setMetadata('plan', 'pro')` | |
| Der Benutzer hat auf eine Schaltfläche geklickt | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| A/B-Testvariante | `setMetadata('ab_variant', 'v2')` | |
| Kauf abgeschlossen | | `logEvent('purchase', { amount: 29 })` |
| Benutzerrolle | `setMetadata('role', 'admin')` | |
| Onboarding-Schritt erreicht | | `logEvent('onboarding_step', { step: 3 })` |

**Faustregel:** Wenn es beschreibt, *wer der Benutzer ist* oder *in welchem ​​Status er sich befindet*, verwenden Sie Metadaten. Wenn es *etwas beschreibt, das passiert ist*, verwenden Sie Ereignisse.

## Datenschutzkontrollen

Alle Texteingaben sind standardmäßig maskiert (`maskAllInputs: true`). Maskierte Felder erscheinen in Wiedergaben als leere Eingaben und die Werte werden nie an der Quelle erfasst. Passwort, E-Mail, Telefon und andere vertrauliche Eingabetypen werden unabhängig von dieser Einstellung immer maskiert.

### Blockierende Elemente

Um ein DOM-Element vollständig von Wiedergaben auszuschließen (es erscheint als solider Platzhalter), fügen Sie eines der folgenden Elemente hinzu:

- CSS-Klasse: `rr-block`
- Datenattribut: `data-rj-block` oder `data-rejourney-block`
- Benutzerdefinierter CSS-Selektor über die Konfigurationsoption `blockSelector`

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### Maskieren von Text

Um den Textinhalt eines Elements zu maskieren (Text wird ersetzt, aber die Form des Elements bleibt sichtbar), fügen Sie eines der folgenden Elemente hinzu:

- CSS-Klasse: `rr-mask`
- Datenattribut: `data-rj-mask`, `data-rejourney-mask`, `data-private` oder ein beliebiges `data-testid`, das `"password"` enthält
- Benutzerdefinierter CSS-Selektor über die Konfigurationsoption `maskTextSelector`

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### Elemente ignorieren

Um die Form eines Elements zu erfassen, aber alle darauf stattfindenden Interaktionsereignisse (Klicks, Eingaben) zu unterdrücken, fügen Sie Folgendes hinzu:

- CSS-Klasse: `rr-ignore`
- Datenattribut: `data-rj-ignore` oder `data-rejourney-ignore`

### Benutzerdefinierte Maskierungsfunktionen

Verwenden Sie für programmgesteuerte Maskierungslogik `maskInputFn` oder `maskTextFn`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### Benutzereinwilligung & GDPR




> [!IMPORTANT]
> **Sie sind der Datenverantwortliche.** Rejourney fungiert in Ihrem Namen als Datenverarbeiter. Sie sind dafür verantwortlich, sicherzustellen, dass Ihre Endbenutzer über die Sitzungsaufzeichnung informiert werden und dass Sie über eine gültige Rechtsgrundlage für die Verarbeitung ihrer Daten verfügen (z. B. Einwilligung oder berechtigte Interessen).

#### Was Sie tun müssen

1. **Geben Sie die Sitzungsaufzeichnung in Ihrer Datenschutzerklärung an.** Fügen Sie eine Sprache hinzu wie:

   > * „Wir verwenden Rejourney, um anonymisierte und nicht anonymisierte Sitzungswiederholungen Ihrer Aktivitäten auf unserer Website aufzuzeichnen, um uns dabei zu helfen, das Produkt zu verbessern und Reibungsverluste zu reduzieren. Sitzungsdaten können Seiteninteraktionen, Browserinformationen und den ungefähren Standort umfassen. Texteingaben und sensible Elemente werden automatisch maskiert und niemals erfasst.“*

2. **Gate-Aufzeichnung hinter Zustimmung** (empfohlen für EWR-Benutzer):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Respektieren Sie Opt-outs.** Wenn ein Benutzer seine Einwilligung widerruft, beenden Sie die Aufzeichnung und löschen Sie seine Identität:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Detaillierte Einwilligung über `setConsent`

Für eine genauere Steuerung verwenden Sie `setConsent`, um Analyse und Wiedergabe unabhängig voneinander umzuschalten:

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

Wenn Sie `analytics: false` und `replay: false` zusammen festlegen, wird die Sitzung beendet und alle in der Warteschlange befindlichen Daten gelöscht. Durch alleiniges Festlegen von `replay: false` wird der rrweb-Recorder gestoppt, die Ereignisverfolgung läuft jedoch weiter.

#### Konsolenprotokollerfassung

Die Protokollerfassung der Konsole ist standardmäßig deaktiviert (`trackConsoleLogs: false`). Aktivieren Sie es nur, wenn Sie es benötigen, da Konsolenprotokolle abhängig von Ihren Protokollierungspraktiken PII enthalten können:

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### Geolokalisierung

Standardmäßig wird die IP-abgeleitete Geolokalisierung (Land, Region, Stadt) erfasst. Wenn `collectGeoLocation` `false` ist, übergibt SDK ein Flag, das die IP-Geolokalisierungssuche im Backend unterdrückt – für diese Sitzung werden keine Standortdaten gespeichert:

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Nur-Beobachtungsmodus (keine visuelle Aufzeichnung)

Um Fehler, lange Aufgaben, Netzwerkaktivitäten und Analysen zu erfassen, legen Sie `observeOnly: true` fest:

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Wenn diese Option aktiviert ist, werden alle Telemetriedaten erfasst, es werden jedoch keine rrweb-Aufzeichnungen ausgeführt. Sitzungen werden nicht auf Ihrer Wiedergabeseite angezeigt, es werden jedoch weiterhin vollständige Analyse-, Fehler- und Netzwerkdaten erfasst. Nützlich, wenn ein Benutzer die visuelle Aufzeichnung deaktiviert hat, Sie aber dennoch Beobachtbarkeit wünschen.

> **Notiz:** Sie können dies bedingt pro Benutzer festlegen, beispielsweise basierend auf einer gespeicherten Einwilligungspräferenz:
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### Bot-Erkennung

Bots und automatisierte Browser werden standardmäßig ignoriert (`ignoreBots: true`). Playwright, Puppeteer, Selenium und andere Webdriver-basierte Clients werden unterdrückt. So zeichnen Sie Automatisierungssitzungen auf (z. B. für interne Tools):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

So stellen Sie ein benutzerdefiniertes Bot-Erkennungsmuster bereit:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### Erfassung von Netzwerkanforderungen

Netzwerkanfragen (Abruf und XHR) werden standardmäßig abgefangen und protokolliert (`autoTrackNetwork: true`). Die Größe der Anforderungs- und Antworttexte wird standardmäßig erfasst (**nicht**). URLs, Methoden, Statuscodes und Dauer werden immer erfasst., `networkCaptureSizes: false`

So schließen Sie bestimmte URLs aus:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

So filtern oder schwärzen Sie Anfragen vor dem Senden:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## Konfigurationsreferenz

| Option | Geben Sie | ein Standard | Beschreibung |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | Rufen Sie `start()` automatisch auf, nachdem `init()` abgeschlossen ist |
| `disableInDev` | `boolean` | `false` | Aufnahme auf `localhost` und `127.0.0.1` | unterdrücken
| `debug` | `boolean` | `false` | Aktivieren Sie die ausführliche SDK-Protokollierung in der Browserkonsole |
| `enabled` | `boolean` | `true` | Master-Kill-Schalter – auf `false` eingestellt, um jegliche Aufzeichnung zu verhindern |
| `observeOnly` | `boolean` | `false` | Erfassen Sie Analysen/Fehler/Netzwerk ohne visuelle Wiedergabe |
| `captureReplay` | `boolean` | `true` | Aktivieren Sie die visuelle Wiedergabeaufzeichnung von rrweb |
| `allowedDomains` | `string[]` | `[]` | Beschränken Sie die Aufzeichnung auf bestimmte Domänen. Leer bedeutet, dass alle Domänen zulässig sind. Unterstützt `*.example.com`-Platzhalter |
| `maxSessionDuration` | `number` | `1800000` | Maximale Sitzungslänge in Millisekunden (Standard: 30 Minuten) |
| `collectGeoLocation` | `boolean` | `true` | IP-abgeleitetes Land/Region/Stadt erfassen |
| `captureAttribution` | `boolean` | `true` | Erfassen Sie UTM-Parameter, Referrer und Eintrags-URL beim Sitzungsstart |
| `ignoreBots` | `boolean` | `true` | Aufzeichnung für erkannte Bots und Webdriver unterdrücken |
| `recordAutomation` | `boolean` | `false` | Aufnahme von Dramatiker-/Puppenspieler-/Selenium-Sitzungen zulassen |
| `autoTrackRoutes` | `boolean` | `true` | Verfolgen Sie Routenänderungen automatisch über den Verlauf API |
| `routeName` | `(location: Location) => string` | — | Benutzerdefinierte Funktion zum Ableiten des Bildschirmnamens von `window.location` |
| `autoTrackNetwork` | `boolean` | `true` | Abruf-/XHR-Anfragen abfangen und protokollieren |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | Vom Netzwerk-Tracking auszuschließende URLs |
| `networkCaptureSizes` | `boolean` | `false` | Einbeziehen der Größe von Anforderungs-/Antworttexten in Netzwerkprotokolle |
| `trackConsoleLogs` | `boolean` | `false` | Erfassen Sie die `console.log/warn/error`-Ausgabe |
| `trackLongTasks` | `boolean` | `true` | Erkennen und protokollieren Sie lange Aufgaben (JS-Thread-Blöcke > 50 ms) |
| `trackResourceErrors` | `boolean` | `true` | Erfassen Sie fehlgeschlagene Ressourcenladungen (Bilder, Skripte, Stylesheets) |
| `maskAllInputs` | `boolean` | `true` | Alle Texteingabewerte in Wiederholungen maskieren |
| `blockClass` | `string \| RegExp` | `'rr-block'` | CSS-Klasse, um die Wiedergabe eines Elements vollständig zu blockieren |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | CSS-Selektor zum vollständigen Blockieren von Elementen aus der Wiedergabe |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | CSS-Klasse zum Ignorieren von Interaktionsereignissen für ein Element |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | CSS-Selektor zum Ignorieren von Interaktionsereignissen |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | CSS-Klasse zum Maskieren von Textinhalten bei der Wiedergabe |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | CSS-Selektor zum Maskieren von Textinhalten |
| `maskInputFn` | `(value, element) => string` | — | Benutzerdefinierte Funktion zum Transformieren von Eingabewerten vor der Erfassung |
| `maskTextFn` | `(text, element) => string` | — | Benutzerdefinierte Funktion zum Transformieren von Textinhalten vor der Erfassung |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | Benutzerdefinierte Funktion, um pro Seitenladevorgang zu entscheiden, ob aufgezeichnet werden soll |
| `beforeSendEvent` | `(event) => event \| null` | — | Filtern oder ändern Sie Ereignisse, bevor sie in die Warteschlange gestellt werden. Geben Sie `null` zurück, um | zu löschen
| `beforeSendNetwork` | `(request) => request \| null` | — | Filtern oder ändern Sie Netzwerkeinträge, bevor sie in die Warteschlange gestellt werden. Geben Sie `null` zurück, um | zu löschen
| `onAuthError` | `(error) => void` | — | Wird aufgerufen, wenn die Authentifizierung von SDK beim Backend | fehlschlägt

## Aufnahme stoppen

Rufen Sie `stop()` auf, um die Sitzung zu beenden, alle ausstehenden Ereignisse zu löschen und alle SDK-Listener zu bereinigen:

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()` kann sicher mehrmals aufgerufen werden. Rufen Sie nach dem Stoppen erneut `start()` auf, um eine neue Sitzung zu beginnen.

## Sitzungs-ID

Greifen Sie auf die aktuelle Sitzungs-ID zu, um Rejourney-Sitzungen mit Ihren eigenen Protokollen oder Support-Tools zu korrelieren:

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

Gibt `null` zurück, wenn keine Sitzung aktiv ist.

## Statushelfer

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```
