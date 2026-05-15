<!-- AI_PROMPT_SECTION -->
**Utilizzi Cursor, Claude o ChatGPT?** Copia la richiesta di integrazione e incollala nel tuo assistente AI per generare automaticamente il codice di configurazione.

<!-- /AI_PROMPT_SECTION -->

## Installazione

Aggiungi il pacchetto Rejourney al tuo progetto utilizzando npm o yarn.

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> Rejourney richiede codice nativo e non è compatibile con Expo Go. Utilizza build di sviluppo:
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## 3 Configurazione della linea

Inizializza e avvia Rejourney nella parte superiore della tua app (ad esempio in App.tsx o index.js).

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

Non richiede il confezionamento del provider. La registrazione inizia immediatamente.

## Impostazioni di registrazione remota

Le impostazioni del progetto possono controllare le impostazioni predefinite di registrazione React Native senza spedire una nuova build dell'app. Le versioni SDK supportate leggono l'impostazione FPS di registrazione remota all'avvio della sessione; il valore predefinito è 1 FPS e gli amministratori del progetto possono scegliere 1, 2 o 3 FPS. Se la configurazione remota non è disponibile, SDK torna al comportamento di acquisizione locale/predefinito.

## Monitoraggio dello schermo

Rejourney tiene traccia automaticamente dei cambiamenti dello schermo in modo da poter vedere dove si trovano gli utenti nella tua app durante i replay. Scegli la configurazione che corrisponde alla tua libreria di navigazione:

### Expo Router (automatico)

Se utilizzi **Expo Router**, il tracciamento dello schermo funziona immediatamente. Non è necessario alcun codice aggiuntivo.




> [!TIP]
> **Utilizzi nomi di schermate personalizzati?** Se si utilizza Expo Router ma si desidera fornire manualmente i propri nomi di schermata, vedere la sezione [Nomi di schermata personalizzati](#custom-screen-names) di seguito.

---

### React Navigation

Se usi **React Navigation** (`@react-navigation/native`), usa l'hook `useNavigationTracking` nella root `NavigationContainer`:

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

### Nomi di schermate personalizzati

Se desideri specificare manualmente i nomi delle schermate (ad esempio, per coerenza analitica o se non utilizzi le librerie di cui sopra), utilizza il metodo `trackScreen`.

#### Per gli utenti Expo Router:
Per utilizzare nomi personalizzati con Expo Router, devi prima disattivare il tracciamento automatico nella configurazione:

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### Chiamata con tracciamento manuale:
Chiama `trackScreen` ogni volta che si verifica un cambio di schermata:

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## Identificazione dell'utente

Associa le sessioni ai tuoi ID utente interni per filtrare e cercare utenti specifici nella dashboard.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Privacy:** Utilizza ID interni o UUID. Se devi utilizzare PII (e-mail, telefono), esegui l'hashing prima dell'invio.

## Eventi personalizzati

Tieni traccia delle azioni significative degli utenti per comprendere modelli di comportamento, eseguire il debug dei problemi e filtrare le riproduzioni delle sessioni nella dashboard.

### Utilizzo di base

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

| Parametro | Digitare | Obbligatorio | Descrizione |
|---|---|---|---|
| `name` | `string` | Sì | Nome evento: utilizzare `snake_case` per coerenza |
| `properties` | `object` | No | Coppie chiave-valore allegate alla occorrenza di questo evento specifico |

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

### Quando utilizzare i metadati rispetto agli eventi

| Caso d'uso | Utilizzare **Metadati** | Utilizzare **Eventi** |
|---|---|---|
| Piano di abbonamento dell'utente |  `setMetadata('plan', 'pro')` | |
| L'utente ha fatto clic su un pulsante | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| Variante del test A/B |  `setMetadata('ab_variant', 'v2')` | |
| Acquisto completato | |  `logEvent('purchase', { amount: 29 })` |
| Ruolo dell'utente |  `setMetadata('role', 'admin')` | |
| Passaggio di onboarding raggiunto | |  `logEvent('onboarding_step', { step: 3 })` |

**Regola pratica:** Se descrive *chi è l'utente* o *in che stato si trova*, utilizza i metadati. Se descrive *qualcosa che è successo*, usa eventi.

## Controlli sulla privacy

Gli input di testo e le visualizzazioni della telecamera vengono automaticamente mascherati per impostazione predefinita. Gli amministratori del progetto possono modificare il livello di mascheramento dell'input di testo predefinito in Impostazioni progetto per le versioni SDK supportate; le versioni precedenti di SDK ignorano l'impostazione remota e mantengono il comportamento di mascheramento esistente. I campi protetti/password, le visualizzazioni della telecamera e le maschere esplicite rimangono protetti.

Per nascondere manualmente un'interfaccia utente sensibile aggiuntiva, racchiudi i componenti nel componente `Mask`:

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

Il contenuto mascherato appare come un rettangolo solido nei replay e non viene mai catturato alla fonte.

### Consenso dell'utente e GDPR




> [!IMPORTANT]
> **Tu sei il Titolare del trattamento.** Rejourney agisce in qualità di Responsabile del trattamento dei dati per tuo conto. Sei responsabile di garantire che i tuoi utenti finali siano informati sulla registrazione della sessione e di disporre di una base giuridica valida per il trattamento dei loro dati (ad esempio consenso o interessi legittimi).

#### Cosa devi fare

1. **Divulga la registrazione della sessione nell'informativa sulla privacy della tua app.** Include linguaggio come:

   > * "Utilizziamo Rejourney per registrare replay di sessioni in forma anonima E non anonimizzate della tua attività in-app per aiutarci a migliorare il prodotto, tenere traccia di arresti anomali e problemi e ridurre l'attrito del prodotto. I dati della sessione possono includere interazioni sullo schermo, informazioni sul dispositivo e posizione approssimativa. Gli input di testo e gli elementi sensibili dell'interfaccia utente vengono automaticamente mascherati e mai acquisiti."*

2. **Registrazione del gate dietro consenso** (consigliato per gli utenti SEE):

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Rispettare le opzioni di rinuncia.** Se un utente revoca il consenso, interrompi la registrazione e cancella i suoi dati:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Acquisizione del registro della console

L'acquisizione del registro della console è abilitata per impostazione predefinita (`trackConsoleLogs: true`). I log della console possono contenere PII a seconda delle pratiche di registrazione dell'app. Disabilitalo se nei log possono essere visualizzati dati sensibili:

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### Geolocalizzazione

La geolocalizzazione derivata dall'IP (paese, regione, città) viene raccolta per impostazione predefinita. Quando `collectGeoLocation` è `false`, SDK passa un flag al livello nativo che sopprime la ricerca di geolocalizzazione IP sul backend: per quella sessione non vengono archiviati dati sulla posizione. Disabilitalo se non hai bisogno di dati sulla posizione o desideri ridurre al minimo la raccolta dei dati per gli utenti del SEE:

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Fogli nativi

L'acquisizione nativa dei fogli è abilitata per impostazione predefinita (`captureNativeSheets: true`) per le versioni SDK supportate. Ciò consente ai fogli e alle finestre di dialogo nativi di proprietà dell'app, come le modalità di autorizzazione del pagamento, di apparire nelle riproduzioni di debug quando il sistema operativo consente l'acquisizione. I fogli del sistema di tastiera/immissione di testo sono esclusi quando gli input di testo sono mascherati per impostazione predefinita. Quando il mascheramento dell'input di testo è impostato solo su campi protetti, le tastiere funzionano solo al meglio e non possono essere acquisite in modo affidabile, soprattutto quando il sistema operativo le rende come superfici protette o remote. Anche i fogli di condivisione del sistema operativo vengono eseguiti solo con il massimo sforzo e non possono essere acquisiti in modo affidabile quando il sistema li rende come superfici protette o remote.

Disattiva l'acquisizione nativa del foglio se desideri che la riproduzione visiva rimanga limitata alla finestra principale dell'app:

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### Modalità di sola osservazione (nessuna registrazione visiva)

Per acquisire errori, arresti anomali, ANRs e attività di rete **senza** registrando replay visivi, impostare `observeOnly: true`:

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Se abilitato, vengono raccolti tutti i dati di telemetria ma non vengono acquisiti screenshot: le sessioni NON appariranno nella pagina Replay ma saranno presenti dati completi di analisi/errori/rete/crash. Nessuna riproduzione. Ciò è utile quando gli utenti hanno disattivato la registrazione dello schermo ma desideri comunque la visibilità degli errori.

> **Nota:** Questo può essere impostato in modo condizionale per utente, ad esempio in base a una preferenza memorizzata o a un flag di consenso:
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```
