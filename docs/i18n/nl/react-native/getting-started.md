<!-- AI_PROMPT_SECTION -->
**Gebruikt u Cursor, Claude of ChatGPT?** Kopieer de integratieprompt en plak deze in uw AI-assistent om de installatiecode automatisch te genereren.

<!-- /AI_PROMPT_SECTION -->

## Installatie

Voeg het Rejourney-pakket toe aan uw project met behulp van npm of yarn.

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> Rejourney vereist native code en is niet compatibel met Expo Go. Gebruik ontwikkelingsbuilds:
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## 3-lijns instelling

Initialiseer en start Rejourney bovenaan uw app (bijvoorbeeld in App.tsx of index.js).

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

Vereist geen verpakking door een provider. De opname begint onmiddellijk.

## Instellingen voor opnemen op afstand

Projectinstellingen kunnen de standaardopnamewaarden van React Native beheren zonder een nieuwe app-build te verzenden. Ondersteunde SDK-versies lezen de FPS-instelling voor opnemen op afstand bij het starten van de sessie; de standaardwaarde is 1 FPS en projectbeheerders kunnen 1, 2 of 3 FPS kiezen. Als de externe configuratie niet beschikbaar is, valt de SDK terug naar lokaal/standaard vastleggedrag.

## Scherm volgen

Rejourney houdt automatisch schermwijzigingen bij, zodat u tijdens herhalingen kunt zien waar gebruikers zich in uw app bevinden. Kies de opstelling die bij jouw navigatiebibliotheek past:

### Expo Router (automatisch)

Als u **Expo Router** gebruikt, werkt schermtracking standaard. Er is geen extra code nodig.




> [!TIP]
> **Aangepaste schermnamen gebruiken?** Als u Expo Router gebruikt maar uw eigen schermnamen handmatig wilt opgeven, raadpleeg dan het gedeelte [Aangepaste schermnamen](#custom-screen-names) hieronder.

---

### React Navigation

Als je **React Navigation** (`@react-navigation/native`) gebruikt, gebruik dan de `useNavigationTracking` hook in je root `NavigationContainer`:

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

### Aangepaste schermnamen

Als u handmatig schermnamen wilt opgeven (bijvoorbeeld voor consistentie van analyses of als u de bovenstaande bibliotheken niet gebruikt), gebruikt u de methode `trackScreen`.

#### Voor Expo Router-gebruikers:
Als u aangepaste namen wilt gebruiken met Expo Router, moet u eerst automatisch volgen uitschakelen in uw configuratie:

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### Handmatige volgoproep:
Bel `trackScreen` wanneer er een schermwijziging plaatsvindt:

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## Gebruikersidentificatie

Koppel sessies aan uw interne gebruikers-ID's om specifieke gebruikers in het dashboard te filteren en te zoeken.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Privacy:** Gebruik interne ID's of UUID's. Als u PII (e-mail, telefoon) moet gebruiken, hash deze dan voordat u deze verzendt.

## Aangepaste evenementen

Houd betekenisvolle gebruikersacties bij om gedragspatronen te begrijpen, problemen op te sporen en herhalingen van sessies in het dashboard te filteren.

### Basisgebruik

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

### Wanneer metadata versus gebeurtenissen gebruiken?

| Gebruiksscenario | Gebruik **Metagegevens** | Gebruik **Evenementen** |
|---|---|---|
| Abonnement van de gebruiker |  `setMetadata('plan', 'pro')` | |
| Gebruiker heeft op een knop geklikt | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| A/B-testvariant |  `setMetadata('ab_variant', 'v2')` | |
| Aankoop voltooid | |  `logEvent('purchase', { amount: 29 })` |
| Rol van de gebruiker |  `setMetadata('role', 'admin')` | |
| Onboardingstap bereikt | |  `logEvent('onboarding_step', { step: 3 })` |

**Vuistregel:** Als het beschrijft *wie de gebruiker is* of *in welke staat deze zich bevindt*, gebruik dan metadata. Als het *iets beschrijft dat is gebeurd*, gebruik dan gebeurtenissen.

## Privacycontroles

Tekstinvoer en cameraweergaven worden standaard automatisch gemaskeerd. Projectbeheerders kunnen het standaardmaskeringsniveau voor tekstinvoer wijzigen in Projectinstellingen voor ondersteunde SDK-versies; oudere SDK-versies negeren die externe instelling en behouden hun bestaande maskeringsgedrag. Beveiligde/wachtwoordvelden, cameraweergaven en expliciete maskers blijven beschermd.

Om extra gevoelige gebruikersinterface handmatig te verbergen, plaatst u componenten in de component `Mask`:

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

Gemaskeerde inhoud wordt bij herhalingen als een effen rechthoek weergegeven en wordt nooit bij de bron vastgelegd.

### Toestemming van gebruiker & GDPR




> [!IMPORTANT]
> **U bent de gegevensbeheerder.** Rejourney treedt namens u op als gegevensverwerker. U bent ervoor verantwoordelijk dat uw eindgebruikers worden geïnformeerd over de opname van sessies en dat u over een geldige wettelijke basis beschikt voor het verwerken van hun gegevens (bijvoorbeeld toestemming of legitieme belangen).

#### Wat je moet doen

1. **Maak sessie-opname openbaar in het privacybeleid van uw app.** Taal opnemen zoals:

   > * "We gebruiken Rejourney om geanonimiseerde EN niet-geanonimiseerde sessieherhalingen van uw in-app-activiteit op te nemen om ons te helpen het product te verbeteren, crashes en problemen op te sporen en productfrictie te verminderen. Sessiegegevens kunnen scherminteracties, apparaatinformatie en geschatte locatie omvatten. Tekstinvoer en gevoelige UI-elementen worden automatisch gemaskeerd en nooit vastgelegd."*

2. **Poortopname achter toestemming** (aanbevolen voor EER-gebruikers):

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Respecteer opt-outs.** Als een gebruiker zijn toestemming intrekt, stop dan met opnemen en wis zijn gegevens:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Vastlegging van consolelogboek

Het vastleggen van consolelogboeken is standaard ingeschakeld (`trackConsoleLogs: true`). Consolelogboeken kunnen PII bevatten, afhankelijk van de logboekregistratieprocedures van uw app. Schakel het uit als er gevoelige gegevens in logboeken kunnen verschijnen:

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### Geolocatie

IP-afgeleide geolocatie (land, regio, stad) wordt standaard verzameld. Wanneer `collectGeoLocation` `false` is, geeft de SDK een vlag door aan de native laag die het zoeken naar IP-geolocatie op de backend onderdrukt; er worden geen locatiegegevens opgeslagen voor die sessie. Schakel dit uit als u geen locatiegegevens nodig heeft of de gegevensverzameling voor EER-gebruikers wilt minimaliseren:

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Inheemse bladen

Native werkbladopname is standaard ingeschakeld (`captureNativeSheets: true`) voor ondersteunde SDK-versies. Hierdoor kunnen native werkbladen en dialoogvensters van de app, zoals betalingsautorisatiemodaliteiten, verschijnen in herhalingen van foutopsporing wanneer het besturingssysteem vastleggen toestaat. Toetsenbord-/tekstinvoersysteembladen worden uitgesloten wanneer tekstinvoer standaard wordt gemaskeerd. Als de tekstinvoermaskering is ingesteld om alleen velden te beveiligen, zijn toetsenborden alleen geschikt voor de beste inspanning en kunnen ze niet op betrouwbare wijze worden vastgelegd, vooral als het besturingssysteem ze als beschermde of afgelegen oppervlakken weergeeft. OS-aandeelbladen zijn ook alleen maar de beste inspanningen en kunnen niet op betrouwbare wijze worden vastgelegd wanneer het systeem ze weergeeft als beschermde of afgelegen oppervlakken.

Schakel het vastleggen van native werkbladen uit als u wilt dat de visuele herhaling beperkt blijft tot het hoofdvenster van de app:

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### Alleen-observatiemodus (geen visuele opname)

Om fouten, crashes, ANRs en netwerkactiviteit **zonder** visuele herhalingen vast te leggen, stelt u `observeOnly: true` in:

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Indien ingeschakeld, wordt alle telemetrie verzameld, maar worden er geen schermafbeeldingen gemaakt. Sessies verschijnen NIET op uw herhalingspagina, maar er zijn volledige analyse-/fout-/netwerk-/crashgegevens. Geen herhaling. Dit is handig wanneer gebruikers zich hebben afgemeld voor schermopname, maar u nog steeds inzicht in fouten wilt.

> **Opmerking:** Dit kan per gebruiker voorwaardelijk worden ingesteld, bijvoorbeeld op basis van een opgeslagen voorkeur of toestemmingsvlag:
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```
