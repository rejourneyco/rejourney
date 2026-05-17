<!-- AI_PROMPT_SECTION -->
**Utilizzi Cursor, Claude o ChatGPT?** Copia la richiesta di integrazione e incollala nel tuo assistente AI per generare automaticamente il codice di configurazione.

<!-- /AI_PROMPT_SECTION -->

## Installazione

Aggiungi il pacchetto Rejourney al tuo progetto utilizzando npm o yarn.

```bash
npm install @rejourneyco/browser
```

## Configurazione di base

Inizializza e avvia Rejourney nel punto di ingresso della tua app.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init` recupera la configurazione remota del tuo progetto e prepara SDK. `start` avvia la sessione, registra il visitatore e (se la riproduzione è abilitata) avvia il registratore rrweb. Entrambi sono asincroni e sicuri da chiamare senza attendere se non è necessario bloccare nulla al completamento.




> [!NOTE]
> `autoStart` è `false` per impostazione predefinita. È necessario chiamare `start()` in modo esplicito, il che consente di vincolare la registrazione dietro un controllo del consenso. Per avviare automaticamente dopo `init`, passare `{ autoStart: true }`.

### Integrazioni quadro

Il pacchetto fornisce punti di ingresso dedicati per i framework più diffusi. Usa quello che corrisponde al tuo stack o usa il API vanilla sopra da qualsiasi framework.

---

#### Reagire

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

Per impostazione predefinita `startOnMount` è `false` su `RejourneyProvider`. Passa `startOnMount` (o `startOnMount={true}`) per avviare la registrazione non appena il componente viene montato.

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

`RejourneyNext` è un componente `'use client'` che esegue il rendering di `null`. Per impostazione predefinita `startOnMount` è `true`. Le modifiche al percorso vengono tracciate automaticamente tramite la Cronologia API.

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

L'istanza Rejourney è disponibile tramite `app.config.globalProperties.$rejourney` e tramite `inject('rejourney')`. Anche il componibile `useRejourney()` viene esportato per comodità.

---

#### Successivo

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

Il suffisso `.client.ts` garantisce che questo plugin venga eseguito solo nel browser. L'istanza Rejourney viene inserita come `$rejourney` e disponibile tramite `useNuxtApp().$rejourney`.

---

#### Svelto / SvelteKit

```javascript
// +layout.svelte
<script>
  import { onMount } from 'svelte';
  import { startRejourneyOnMount } from '@rejourneyco/browser/svelte';

  onMount(() => startRejourneyOnMount({ publicKey: 'pk_live_your_public_key' }));
</script>
```

`startRejourneyOnMount` restituisce una funzione di pulizia che chiama `Rejourney.stop()` — Il valore restituito `onMount` di Svelte viene utilizzato automaticamente come callback di distruzione.

---

#### Angolare

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

`createRejourneyAppInitializer` restituisce una factory che inizializza e avvia Rejourney durante la fase di bootstrap di Angular. Puoi anche inserire `RejourneyService` per uno API basato su classi.

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

Per impostazione predefinita `startOnMount` è `true`. Le modifiche al percorso vengono monitorate automaticamente.

---

#### Astro

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

`startRejourneyForAstro` no-op negli ambienti SSR: verifica la presenza di `window` prima dell'esecuzione.

---

## Impostazioni di registrazione remota

Le Impostazioni progetto possono controllare le impostazioni predefinite della registrazione web senza la distribuzione del codice. SDK legge la configurazione remota su ogni chiamata `start()`. La configurazione remota può abilitare o disabilitare completamente la registrazione, modificare l'elenco dei domini consentiti e impostare una durata massima della sessione. Se la configurazione remota non è disponibile, `start()` non procederà: questo è intenzionale per impedire la registrazione in uno stato di progetto sconosciuto.

## Monitoraggio del percorso

Rejourney tiene traccia automaticamente delle modifiche alla pagina e al percorso in modo da poter visualizzare il contesto di navigazione nei replay. Questo è abilitato per impostazione predefinita (`autoTrackRoutes: true`) e funziona intercettando le chiamate API della cronologia (`pushState`, `replaceState`) e ascoltando gli eventi `popstate`.

### Nomi di percorsi personalizzati

Per impostazione predefinita, come nome della schermata viene utilizzato l'attuale `window.location.pathname`. Per fornire la propria logica di denominazione, passare una funzione `routeName`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### Monitoraggio manuale dello schermo

Per tenere traccia manualmente delle schermate (ad esempio per modifiche alle schede o transizioni di visualizzazione nella pagina), chiamare direttamente `trackScreen`:

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

Per disattivare il tracciamento automatico del percorso e affidarsi esclusivamente alle chiamate manuali:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## Identificazione dell'utente

Associa le sessioni ai tuoi ID utente interni per filtrare e cercare utenti specifici nella dashboard.

```javascript
import { Rejourney } from '@rejourneyco/browser';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Privacy:** Utilizza ID interni o UUID. Se devi utilizzare PII (e-mail, telefono), esegui l'hashing prima dell'invio.

## Eventi personalizzati

Tieni traccia delle azioni significative degli utenti per comprendere modelli di comportamento, eseguire il debug dei problemi e filtrare i replay delle sessioni nella dashboard.

### Utilizzo di base

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

| Parametro | Digitare | Obbligatorio | Descrizione |
|---|---|---|---|
| `name` | `string` | Sì | Nome evento: utilizzare `snake_case` per coerenza |
| `properties` | `object` | No | Coppie chiave-valore collegate a questo evento specifico |

### Esempi

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

### Come vengono visualizzati gli eventi nella dashboard

Gli eventi personalizzati vengono archiviati per sessione e visibili in due posizioni:

1. **Cronologia della riproduzione della sessione**: gli eventi vengono visualizzati come indicatori sulla sequenza temporale del replay in modo da poter passare al momento esatto in cui si è verificata un'azione.
2. **Filtri di archivio di sessione** — Filtra l'elenco delle sessioni per:
   - **Nome dell'evento**: trova tutte le sessioni contenenti un evento specifico (ad esempio `purchase_completed`)
   - **Proprietà dell'evento**: restringi ulteriormente per chiave e/o valore della proprietà (ad esempio `plan = pro`)
   - **Conteggio eventi**: trova sessioni con un numero specifico di eventi personalizzati (ad esempio più di 5 eventi)

### Migliori pratiche




> [!TIP]
> - Utilizza una denominazione coerente (`snake_case`, ad esempio `button_clicked` non `Button Clicked`)
> - Mantieni semplici i valori delle proprietà (stringhe, numeri, booleani): evita oggetti nidificati
> - Concentrati sulle azioni importanti per il debug o l'analisi: non registrare tutto
> - Le proprietà si riferiscono al contesto per evento. Per gli attributi a livello di sessione, utilizza invece **Metadati**

---

## Metadati

Allega coppie chiave-valore a livello di sessione che descrivono l'utente o il contesto della sessione. A differenza degli eventi, i metadati vengono impostati una volta per chiave e si applicano all'intera sessione.

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

I valori dei metadati devono essere `string`, `number` o `boolean`. Oggetti e array non sono accettati.

### Quando utilizzare i metadati rispetto agli eventi

| Caso d'uso | Utilizzare **Metadati** | Utilizzare **Eventi** |
|---|---|---|
| Piano di abbonamento dell'utente | `setMetadata('plan', 'pro')` | |
| L'utente ha fatto clic su un pulsante | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| Variante del test A/B | `setMetadata('ab_variant', 'v2')` | |
| Acquisto completato | | `logEvent('purchase', { amount: 29 })` |
| Ruolo dell'utente | `setMetadata('role', 'admin')` | |
| Passaggio di onboarding raggiunto | | `logEvent('onboarding_step', { step: 3 })` |

**Regola pratica:** Se descrive *chi è l'utente* o *in che stato si trova*, utilizza i metadati. Se descrive *qualcosa che è successo*, usa eventi.

## Controlli sulla privacy

Tutti gli input di testo sono mascherati per impostazione predefinita (`maskAllInputs: true`). I campi mascherati appaiono come input vuoti nelle riproduzioni e i valori non vengono mai acquisiti alla fonte. Password, e-mail, telefono e altri tipi di input sensibili vengono sempre mascherati indipendentemente da questa impostazione.

### Elementi di blocco

Per escludere completamente un elemento DOM dai replay (appare come un segnaposto solido), aggiungi uno dei seguenti:

- Classe CSS: `rr-block`
- Attributo dei dati: `data-rj-block` o `data-rejourney-block`
- Selettore CSS personalizzato tramite l'opzione di configurazione `blockSelector`

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### Testo mascherato

Per mascherare il contenuto testuale di un elemento (il testo viene sostituito ma la forma dell'elemento rimane visibile), aggiungi uno dei seguenti:

- Classe CSS: `rr-mask`
- Attributo dati: `data-rj-mask`, `data-rejourney-mask`, `data-private` o qualsiasi `data-testid` contenente `"password"`
- Selettore CSS personalizzato tramite l'opzione di configurazione `maskTextSelector`

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### Ignorare gli elementi

Per acquisire la forma di un elemento ma sopprimere tutti gli eventi di interazione (clic, input) su di esso, aggiungi:

- Classe CSS: `rr-ignore`
- Attributo dei dati: `data-rj-ignore` o `data-rejourney-ignore`

### Funzioni di mascheramento personalizzate

Per la logica di mascheramento programmatica, utilizzare `maskInputFn` o `maskTextFn`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### Consenso dell'utente e GDPR




> [!IMPORTANT]
> **Tu sei il Titolare del trattamento.** Rejourney agisce in qualità di Responsabile del trattamento dei dati per tuo conto. Sei responsabile di garantire che i tuoi utenti finali siano informati sulla registrazione della sessione e di disporre di una base giuridica valida per il trattamento dei loro dati (ad esempio consenso o interessi legittimi).

#### Cosa devi fare

1. **Divulga la registrazione della sessione nella tua politica sulla privacy.** Include linguaggio come:

   > * "Utilizziamo Rejourney per registrare replay di sessioni in forma anonima e non anonimizzate della tua attività sul nostro sito Web per aiutarci a migliorare il prodotto e ridurre gli attriti. I dati della sessione possono includere interazioni con la pagina, informazioni sul browser e posizione approssimativa. Gli input di testo e gli elementi sensibili vengono automaticamente mascherati e mai acquisiti."*

2. **Registrazione del gate dietro consenso** (consigliato per gli utenti SEE):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Rispettare le opzioni di rinuncia.** Se un utente revoca il consenso, interrompi la registrazione e cancella la sua identità:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Consenso granulare tramite `setConsent`

Per un controllo più preciso, utilizza `setConsent` per attivare/disattivare in modo indipendente l'analisi e la riproduzione:

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

L'impostazione contemporanea di `analytics: false` e `replay: false` interrompe la sessione e cancella tutti i dati in coda. La sola impostazione di `replay: false` arresta il registratore rrweb ma mantiene in esecuzione il monitoraggio degli eventi.

#### Acquisizione del registro della console

L'acquisizione del registro della console è disabilitata per impostazione predefinita (`trackConsoleLogs: false`). Abilitalo solo se ne hai bisogno, poiché i log della console possono contenere PII a seconda delle tue pratiche di registrazione:

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### Geolocalizzazione

La geolocalizzazione derivata dall'IP (paese, regione, città) viene raccolta per impostazione predefinita. Quando `collectGeoLocation` è `false`, SDK passa un flag che sopprime la ricerca di geolocalizzazione IP sul backend: per quella sessione non vengono archiviati dati sulla posizione:

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Modalità di sola osservazione (nessuna registrazione visiva)

Per acquisire errori, attività lunghe, attività di rete e analisi **senza** registrando replay visivi, impostare `observeOnly: true`:

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Se abilitato, vengono raccolti tutti i dati di telemetria ma non viene eseguita alcuna registrazione rrweb: le sessioni non verranno visualizzate nella pagina Replay, ma verranno comunque acquisiti analisi complete, errori e dati di rete. Utile quando un utente ha disattivato la registrazione visiva ma desideri comunque l'osservabilità.

> **Nota:** È possibile impostarlo in modo condizionale per utente, ad esempio in base a una preferenza di consenso memorizzata:
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### Rilevamento bot

Bot e browser automatizzati vengono ignorati per impostazione predefinita (`ignoreBots: true`). Playwright, Puppeteer, Selenium e altri client basati su webdriver vengono soppressi. Per registrare sessioni di automazione (ad esempio per strumenti interni):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

Per fornire un modello di rilevamento bot personalizzato:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### Acquisizione delle richieste di rete

Le richieste di rete (recupero e XHR) vengono intercettate e registrate per impostazione predefinita (`autoTrackNetwork: true`). Le dimensioni del corpo della richiesta e della risposta sono **non** acquisite per impostazione predefinita (`networkCaptureSizes: false`). URL, metodi, codici di stato e durate vengono sempre acquisiti.

Per escludere URL specifici:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

Per filtrare o oscurare le richieste prima che vengano inviate:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## Riferimento alla configurazione

| Opzione | Digitare | Predefinito | Descrizione |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | Chiama `start()` automaticamente dopo il completamento di `init()` |
| `disableInDev` | `boolean` | `false` | Elimina la registrazione su `localhost` e `127.0.0.1` |
| `debug` | `boolean` | `false` | Abilita la registrazione dettagliata SDK nella console del browser |
| `enabled` | `boolean` | `true` | Master kill switch: impostato su `false` per impedire qualsiasi registrazione |
| `observeOnly` | `boolean` | `false` | Cattura analisi/errori/rete senza riproduzione visiva |
| `captureReplay` | `boolean` | `true` | Abilita l'acquisizione della riproduzione visiva rrweb |
| `allowedDomains` | `string[]` | `[]` | Limita la registrazione a domini specifici. Vuoto significa che sono consentiti tutti i domini. Supporta i caratteri jolly `*.example.com` |
| `maxSessionDuration` | `number` | `1800000` | Durata massima della sessione in millisecondi (impostazione predefinita: 30 minuti) |
| `collectGeoLocation` | `boolean` | `true` | Raccogli paese/regione/città derivati ​​dall'IP |
| `captureAttribution` | `boolean` | `true` | Acquisisci parametri UTM, referrer e URL di ingresso all'avvio della sessione |
| `ignoreBots` | `boolean` | `true` | Sopprimi la registrazione per bot e webdriver rilevati |
| `recordAutomation` | `boolean` | `false` | Consenti la registrazione delle sessioni di Drammaturgo/Burattinaio/Selenium |
| `autoTrackRoutes` | `boolean` | `true` | Tieni traccia automaticamente delle modifiche al percorso tramite la Cronologia API |
| `routeName` | `(location: Location) => string` | — | Funzione personalizzata per ricavare il nome visualizzato da `window.location` |
| `autoTrackNetwork` | `boolean` | `true` | Intercettare e registrare richieste di recupero/XHR |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | URL da escludere dal monitoraggio della rete |
| `networkCaptureSizes` | `boolean` | `false` | Includere le dimensioni del corpo della richiesta/risposta nei log di rete |
| `trackConsoleLogs` | `boolean` | `false` | Cattura l'uscita `console.log/warn/error` |
| `trackLongTasks` | `boolean` | `true` | Rileva e registra attività lunghe (blocchi di thread JS > 50 ms) |
| `trackResourceErrors` | `boolean` | `true` | Cattura carichi di risorse non riusciti (immagini, script, fogli di stile) |
| `maskAllInputs` | `boolean` | `true` | Maschera tutti i valori di input di testo nei replay |
| `blockClass` | `string \| RegExp` | `'rr-block'` | Classe CSS per bloccare completamente un elemento dalla riproduzione |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | Selettore CSS per bloccare completamente gli elementi dalla riproduzione |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | Classe CSS per ignorare gli eventi di interazione su un elemento |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | Selettore CSS per ignorare gli eventi di interazione |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | Classe CSS per mascherare il contenuto testuale nel replay |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | Selettore CSS per mascherare il contenuto testuale |
| `maskInputFn` | `(value, element) => string` | — | Funzione personalizzata per trasformare i valori di input prima dell'acquisizione |
| `maskTextFn` | `(text, element) => string` | — | Funzione personalizzata per trasformare il contenuto del testo prima dell'acquisizione |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | Funzione personalizzata per decidere se registrare | per caricamento di pagina
| `beforeSendEvent` | `(event) => event \| null` | — | Filtra o modifica gli eventi prima che vengano messi in coda. Ritorna `null` per rilasciare |
| `beforeSendNetwork` | `(request) => request \| null` | — | Filtra o modifica le voci di rete prima che vengano messe in coda. Ritorna `null` per rilasciare |
| `onAuthError` | `(error) => void` | — | Chiamato quando SDK non riesce ad autenticarsi con il backend |

## Interruzione della registrazione

Chiama `stop()` per terminare la sessione, eliminare eventuali eventi in sospeso e ripulire tutti i listener SDK:

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()` è sicuro chiamare più volte. Dopo l'interruzione, chiamare nuovamente `start()` per iniziare una nuova sessione.

## Identificativo della sessione

Accedi all'ID sessione corrente per correlare le sessioni Rejourney con i tuoi registri o strumenti di supporto:

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

Restituisce `null` se nessuna sessione è attiva.

## Aiutanti di stato

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```
