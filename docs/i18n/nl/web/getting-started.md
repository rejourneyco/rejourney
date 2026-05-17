<!-- AI_PROMPT_SECTION -->
**Gebruikt u Cursor, Claude of ChatGPT?** Kopieer de integratieprompt en plak deze in uw AI-assistent om de installatiecode automatisch te genereren.

<!-- /AI_PROMPT_SECTION -->

## Installatie

Voeg het Rejourney-pakket toe aan uw project met behulp van npm of yarn.

```bash
npm install @rejourneyco/browser
```

## Basisopstelling

Initialiseer en start Rejourney bij het startpunt van uw app.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init` haalt de externe configuratie van uw project op en bereidt de SDK voor. `start` start de sessie, registreert de bezoeker en start (als afspelen is ingeschakeld) de rrwebrecorder. Beide zijn async en veilig om te bellen zonder te wachten als u na voltooiing niets hoeft af te sluiten.




> [!NOTE]
> `autoStart` is standaard `false`. U moet `start()` expliciet aanroepen, zodat u de opname achter een toestemmingscontrole kunt afsluiten. Om automatisch te starten na `init`, geeft u `{ autoStart: true }` door.

### Framework-integraties

Het pakket bevat speciale toegangspunten voor populaire frameworks. Gebruik degene die overeenkomt met uw stapel - of gebruik de vanille API hierboven vanuit elk raamwerk.

---

#### Reageren

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

`startOnMount` is standaard `false` op `RejourneyProvider`. Geef `startOnMount` (of `startOnMount={true}`) door om te beginnen met opnemen zodra het onderdeel is gemonteerd.

---

#### Volgende.js

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

`RejourneyNext` is een `'use client'`-component die `null` weergeeft. `startOnMount` is standaard `true`. Routewijzigingen worden automatisch bijgehouden via de Geschiedenis API.

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

De Rejourney-instantie is beschikbaar via `app.config.globalProperties.$rejourney` en via `inject('rejourney')`. De composable `useRejourney()` wordt voor het gemak ook geëxporteerd.

---

#### Nuxt

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

Het achtervoegsel `.client.ts` zorgt ervoor dat deze plug-in alleen in de browser werkt. De Rejourney-instantie wordt geïnjecteerd als `$rejourney` en is beschikbaar via `useNuxtApp().$rejourney`.

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

`startRejourneyOnMount` retourneert een opschoonfunctie die `Rejourney.stop()` aanroept: de retourwaarde `onMount` van Svelte wordt automatisch gebruikt als vernietigingscallback.

---

#### Hoekig

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

`createRejourneyAppInitializer` retourneert een fabriek die Rejourney initialiseert en start tijdens de bootstrapfase van Angular. U kunt `RejourneyService` ook injecteren voor een op klassen gebaseerde API.

---

#### Remixen

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

`startOnMount` is standaard `true`. Routewijzigingen worden automatisch bijgehouden.

---

#### Astro

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

`startRejourneyForAstro` no-ops in SSR-omgevingen: het controleert op `window` voordat het wordt uitgevoerd.

---

## Instellingen voor opnemen op afstand

Projectinstellingen kunnen de standaardinstellingen voor webopnamen beheren zonder dat er code hoeft te worden geïmplementeerd. De SDK leest de externe configuratie bij elke `start()`-oproep. De externe configuratie kan de opname volledig in- of uitschakelen, de lijst met toegestane domeinen aanpassen en een maximale sessieduur instellen. Als de externe configuratie niet beschikbaar is, zal `start()` niet doorgaan. Dit is bedoeld om te voorkomen dat er wordt opgenomen onder een onbekende projectstatus.

## Route volgen

Rejourney houdt automatisch pagina- en routewijzigingen bij, zodat u de navigatiecontext in herhalingen kunt zien. Dit is standaard ingeschakeld (`autoTrackRoutes: true`) en werkt door het onderscheppen van geschiedenis API-oproepen (`pushState`, `replaceState`) en het luisteren naar `popstate`-gebeurtenissen.

### Aangepaste routenamen

Standaard wordt de huidige `window.location.pathname` gebruikt als schermnaam. Om uw eigen naamgevingslogica te bieden, geeft u een `routeName`-functie door:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### Handmatige schermtracking

Als u schermen handmatig wilt volgen (bijvoorbeeld voor tabbladwijzigingen of weergaveovergangen op de pagina), belt u rechtstreeks `trackScreen`:

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

Om het automatisch volgen van routes uit te schakelen en uitsluitend te vertrouwen op handmatige oproepen:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## Gebruikersidentificatie

Koppel sessies aan uw interne gebruikers-ID's om specifieke gebruikers in het dashboard te filteren en te zoeken.

```javascript
import { Rejourney } from '@rejourneyco/browser';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Privacy:** Gebruik interne ID's of UUID's. Als u PII (e-mail, telefoon) moet gebruiken, hash deze dan voordat u deze verzendt.

## Aangepaste evenementen

Volg betekenisvolle gebruikersacties om gedragspatronen te begrijpen, problemen op te lossen en herhalingen van sessies in het dashboard te filteren.

### Basisgebruik

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

| Parameter | Typ | Vereist | Beschrijving |
|---|---|---|---|
| `name` | `string` | Ja | Gebeurtenisnaam — gebruik `snake_case` voor consistentie |
| `properties` | `object` | Nee | Sleutel-waardeparen gekoppeld aan deze specifieke gebeurtenis |

### Voorbeelden

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

### Hoe gebeurtenissen verschijnen in het dashboard

Aangepaste gebeurtenissen worden per sessie opgeslagen en zijn op twee plaatsen zichtbaar:

1. **Tijdlijn voor het opnieuw afspelen van sessies** — Gebeurtenissen verschijnen als markeringen op de herhalingstijdlijn, zodat u naar het exacte moment kunt springen waarop een actie heeft plaatsgevonden.
2. **Sessiearchieffilters** — Filter de sessielijst op:
   - **Naam evenement** — Vind alle sessies die een specifieke gebeurtenis bevatten (bijvoorbeeld `purchase_completed`)
   - **Evenement eigendom** — Verder beperken op eigenschapssleutel en/of waarde (bijv. `plan = pro`)
   - **Aantal evenementen** — Vind sessies met een specifiek aantal aangepaste gebeurtenissen (bijvoorbeeld meer dan 5 gebeurtenissen)

### Beste praktijken




> [!TIP]
> - Gebruik consistente naamgeving (`snake_case`, bijvoorbeeld `button_clicked` en niet `Button Clicked`)
> - Houd eigenschapswaarden eenvoudig (tekenreeksen, getallen, booleans) – vermijd geneste objecten
> - Concentreer u op acties die van belang zijn voor foutopsporing of analyse; leg niet alles vast
> - Eigenschappen zijn voor context per gebeurtenis. Gebruik voor kenmerken op sessieniveau **Metagegevens**

---

## Metagegevens

Voeg sleutel-waardeparen op sessieniveau toe die de gebruikers- of sessiecontext beschrijven. In tegenstelling tot gebeurtenissen worden metadata één keer per sleutel ingesteld en zijn ze van toepassing op de hele sessie.

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

Metagegevenswaarden moeten `string`, `number` of `boolean` zijn. Objecten en arrays worden niet geaccepteerd.

### Wanneer metadata versus gebeurtenissen gebruiken?

| Gebruiksscenario | Gebruik **Metagegevens** | Gebruik **Evenementen** |
|---|---|---|
| Abonnement van de gebruiker | `setMetadata('plan', 'pro')` | |
| Gebruiker heeft op een knop geklikt | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| A/B-testvariant | `setMetadata('ab_variant', 'v2')` | |
| Aankoop voltooid | | `logEvent('purchase', { amount: 29 })` |
| Rol van de gebruiker | `setMetadata('role', 'admin')` | |
| Onboardingstap bereikt | | `logEvent('onboarding_step', { step: 3 })` |

**Vuistregel:** Als het beschrijft *wie de gebruiker is* of *in welke staat deze zich bevindt*, gebruik dan metadata. Als het *iets beschrijft dat is gebeurd*, gebruik dan gebeurtenissen.

## Privacycontroles

Alle tekstinvoer is standaard gemaskeerd (`maskAllInputs: true`). Gemaskeerde velden verschijnen als lege invoer in herhalingen en de waarden worden nooit bij de bron vastgelegd. Wachtwoord, e-mail, telefoon en andere gevoelige invoertypen worden altijd gemaskeerd, ongeacht deze instelling.

### Blokkerende elementen

Om een ​​DOM-element volledig uit te sluiten van herhalingen (het verschijnt als een solide tijdelijke aanduiding), voegt u een van de volgende dingen toe:

- CSS-klasse: `rr-block`
- Gegevensattribuut: `data-rj-block` of `data-rejourney-block`
- Aangepaste CSS-selector via de configuratieoptie `blockSelector`

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### Maskerende tekst

Om de tekstinhoud van een element te maskeren (tekst wordt vervangen maar de vorm van het element blijft zichtbaar), voegt u een van de volgende dingen toe:

- CSS-klasse: `rr-mask`
- Gegevensattribuut: `data-rj-mask`, `data-rejourney-mask`, `data-private` of een `data-testid` die `"password"` bevat
- Aangepaste CSS-selector via de configuratieoptie `maskTextSelector`

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### Elementen negeren

Om de vorm van een element vast te leggen maar alle interactiegebeurtenissen (klikken, invoer) daarop te onderdrukken, voegt u het volgende toe:

- CSS-klasse: `rr-ignore`
- Gegevensattribuut: `data-rj-ignore` of `data-rejourney-ignore`

### Aangepaste maskeerfuncties

Voor programmatische maskeerlogica gebruikt u `maskInputFn` of `maskTextFn`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### Toestemming van gebruiker & GDPR




> [!IMPORTANT]
> **U bent de gegevensbeheerder.** Rejourney treedt namens u op als gegevensverwerker. U bent ervoor verantwoordelijk dat uw eindgebruikers worden geïnformeerd over de opname van sessies en dat u over een geldige wettelijke basis beschikt voor het verwerken van hun gegevens (bijvoorbeeld toestemming of legitieme belangen).

#### Wat je moet doen

1. **Maak sessie-opname openbaar in uw privacybeleid.** Taal opnemen zoals:

   > * "We gebruiken Rejourney om geanonimiseerde en niet-geanonimiseerde sessieherhalingen van uw activiteit op onze website op te nemen om ons te helpen het product te verbeteren en wrijving te verminderen. Sessiegegevens kunnen pagina-interacties, browserinformatie en geschatte locatie omvatten. Tekstinvoer en gevoelige elementen worden automatisch gemaskeerd en nooit vastgelegd."*

2. **Poortopname achter toestemming** (aanbevolen voor EER-gebruikers):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Respecteer opt-outs.** Als een gebruiker zijn toestemming intrekt, stop dan met opnemen en wis zijn identiteit:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Gedetailleerde toestemming via `setConsent`

Voor een fijnere controle kunt u `setConsent` gebruiken om analyses en afspelen onafhankelijk in of uit te schakelen:

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

Als u `analytics: false` en `replay: false` samen instelt, wordt de sessie beëindigd en worden alle gegevens in de wachtrij gewist. Als u alleen `replay: false` instelt, wordt de rrweb-recorder gestopt, maar blijft het volgen van gebeurtenissen actief.

#### Vastlegging van consolelogboek

Het vastleggen van consolelogboeken is standaard uitgeschakeld (`trackConsoleLogs: false`). Schakel het alleen in als u het nodig heeft, omdat consolelogboeken PII kunnen bevatten, afhankelijk van uw logpraktijken:

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### Geolocatie

IP-afgeleide geolocatie (land, regio, stad) wordt standaard verzameld. Wanneer `collectGeoLocation` `false` is, geeft de SDK een vlag door die het zoeken naar IP-geolocatie op de backend onderdrukt - er worden geen locatiegegevens opgeslagen voor die sessie:

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Alleen-observatiemodus (geen visuele opname)

Om fouten, lange taken, netwerkactiviteit en analyses vast te leggen **zonder** die visuele herhalingen opnemen, stelt u `observeOnly: true` in:

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Indien ingeschakeld, wordt alle telemetrie verzameld, maar worden er geen rrweb-opnamen uitgevoerd. Sessies verschijnen niet op uw pagina Herhalingen, maar de volledige analyse-, fout- en netwerkgegevens worden nog steeds vastgelegd. Handig wanneer een gebruiker zich heeft afgemeld voor visuele opname, maar u toch zichtbaarheid wilt.

> **Opmerking:** Dit kunt u per gebruiker voorwaardelijk instellen, bijvoorbeeld op basis van een opgeslagen toestemmingsvoorkeur:
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### Bot-detectie

Bots en geautomatiseerde browsers worden standaard genegeerd (`ignoreBots: true`). Toneelschrijver, Puppeteer, Selenium en andere op webdrivers gebaseerde clients worden onderdrukt. Om automatiseringssessies op te nemen (bijvoorbeeld voor interne tooling):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

Een aangepast botdetectiepatroon opgeven:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### Netwerkverzoek vastleggen

Netwerkverzoeken (fetch en XHR) worden standaard onderschept en geregistreerd (`autoTrackNetwork: true`). De hoofdtekstgrootten van verzoeken en antwoorden zijn standaard **niet** (`networkCaptureSizes: false`). URL's, methoden, statuscodes en duur worden altijd vastgelegd.

Specifieke URL's uitsluiten:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

Verzoeken filteren of redigeren voordat ze worden verzonden:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## Configuratiereferentie

| Optie | Typ | Standaard | Beschrijving |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | `start()` automatisch bellen nadat `init()` is voltooid |
| `disableInDev` | `boolean` | `false` | Opname onderdrukken op `localhost` en `127.0.0.1` |
| `debug` | `boolean` | `false` | Uitgebreide SDK-logboekregistratie naar de browserconsole inschakelen |
| `enabled` | `boolean` | `true` | Master-kill-schakelaar — stel deze in op `false` om elke opname te voorkomen |
| `observeOnly` | `boolean` | `false` | Analyses/fouten/netwerk vastleggen zonder visuele herhaling |
| `captureReplay` | `boolean` | `true` | Schakel visuele herhalingsopname van rrweb in |
| `allowedDomains` | `string[]` | `[]` | Beperk de opname tot specifieke domeinen. Leeg betekent dat alle domeinen zijn toegestaan. Ondersteunt `*.example.com`-jokertekens |
| `maxSessionDuration` | `number` | `1800000` | Maximale sessielengte in milliseconden (standaard: 30 minuten) |
| `collectGeoLocation` | `boolean` | `true` | Verzamel IP-afgeleid land/regio/stad |
| `captureAttribution` | `boolean` | `true` | Leg UTM-parameters, verwijzing en invoer-URL vast bij het starten van de sessie |
| `ignoreBots` | `boolean` | `true` | Onderdruk opname voor gedetecteerde bots en webdrivers |
| `recordAutomation` | `boolean` | `false` | Opname van toneelschrijver/poppenspeler/selenium-sessies toestaan ​​|
| `autoTrackRoutes` | `boolean` | `true` | Volg routewijzigingen automatisch via Geschiedenis API |
| `routeName` | `(location: Location) => string` | — | Aangepaste functie om de schermnaam af te leiden van `window.location` |
| `autoTrackNetwork` | `boolean` | `true` | Ophaal-/XHR-verzoeken onderscheppen en loggen |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | URL's die moeten worden uitgesloten van netwerktracking |
| `networkCaptureSizes` | `boolean` | `false` | Lichaamsgroottes van verzoeken/antwoorden opnemen in netwerklogboeken |
| `trackConsoleLogs` | `boolean` | `false` | `console.log/warn/error`-uitvoer vastleggen |
| `trackLongTasks` | `boolean` | `true` | Detecteer en registreer lange taken (JS-threadblokken > 50 ms) |
| `trackResourceErrors` | `boolean` | `true` | Mislukte bronbelastingen vastleggen (afbeeldingen, scripts, stylesheets) |
| `maskAllInputs` | `boolean` | `true` | Masker alle tekstinvoerwaarden in herhalingen |
| `blockClass` | `string \| RegExp` | `'rr-block'` | CSS-klasse om een ​​element volledig te blokkeren voor herhaling |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | CSS-selector om elementen volledig te blokkeren voor herhaling |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | CSS-klasse om interactiegebeurtenissen op een element te negeren |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | CSS-selector om interactiegebeurtenissen te negeren |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | CSS-klasse om tekstinhoud bij herhaling te maskeren |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | CSS-selector om tekstinhoud te maskeren |
| `maskInputFn` | `(value, element) => string` | — | Aangepaste functie om invoerwaarden te transformeren voordat ze worden vastgelegd |
| `maskTextFn` | `(text, element) => string` | — | Aangepaste functie om tekstinhoud te transformeren voordat deze wordt vastgelegd |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | Aangepaste functie om per geladen pagina te beslissen of er moet worden opgenomen |
| `beforeSendEvent` | `(event) => event \| null` | — | Filter of wijzig gebeurtenissen voordat ze in de wachtrij worden geplaatst. Retourneer `null` om te verwijderen |
| `beforeSendNetwork` | `(request) => request \| null` | — | Filter of wijzig netwerkvermeldingen voordat ze in de wachtrij worden geplaatst. Retourneer `null` om te verwijderen |
| `onAuthError` | `(error) => void` | — | Wordt aangeroepen wanneer de SDK er niet in slaagt te authenticeren met de backend |

## Opname stoppen

Roep `stop()` aan om de sessie te beëindigen, eventuele openstaande gebeurtenissen te wissen en alle SDK-listeners op te schonen:

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()` is veilig om meerdere keren te bellen. Bel na het stoppen opnieuw `start()` om een ​​nieuwe sessie te beginnen.

## Sessie-ID

Krijg toegang tot de huidige sessie-ID om Rejourney-sessies te correleren met uw eigen logboeken of ondersteuningstools:

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

Retourneert `null` als er geen sessie actief is.

## Statushelpers

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```
