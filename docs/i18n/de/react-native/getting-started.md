<!-- AI_PROMPT_SECTION -->
**Verwenden Sie Cursor, Claude oder ChatGPT?** Kopieren Sie die Integrationsaufforderung und fügen Sie sie in Ihren AI-Assistenten ein, um den Setup-Code automatisch zu generieren.

<!-- /AI_PROMPT_SECTION -->

## Installation

Fügen Sie das Paket Rejourney zu Ihrem Projekt hinzu, indem Sie npm oder yarn verwenden.

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> Rejourney erfordert nativen Code und ist nicht mit Expo Go kompatibel. Entwicklungs-Builds verwenden:
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## 3-Linien-Setup

Initialisieren und starten Sie Rejourney oben in Ihrer App (z. B. in App.tsx oder index.js).

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

Erfordert keine Anbieterverpackung. Die Aufnahme beginnt sofort.

## Remote-Aufnahmeeinstellungen

Mit den Projekteinstellungen können Sie die Aufnahmestandards React Native steuern, ohne einen neuen App-Build auszuliefern. Unterstützte SDK-Versionen lesen die FPS-Einstellung für die Fernaufzeichnung beim Sitzungsstart; Der Standardwert ist 1 FPS und Projektadministratoren können 1, 2 oder 3 FPS wählen. Wenn die Remote-Konfiguration nicht verfügbar ist, greift SDK auf das lokale/Standarderfassungsverhalten zurück.

## Bildschirmverfolgung

Rejourney verfolgt Bildschirmänderungen automatisch, sodass Sie bei Wiederholungen sehen können, wo sich Benutzer in Ihrer App befinden. Wählen Sie das Setup, das zu Ihrer Navigationsbibliothek passt:

### Expo Router (Automatisch)

Wenn Sie **Expo Router** verwenden, funktioniert die Bildschirmverfolgung sofort. Es ist kein zusätzlicher Code erforderlich.




> [!TIP]
> **Benutzerdefinierte Bildschirmnamen verwenden?** Wenn Sie Expo Router verwenden, aber Ihre eigenen Bildschirmnamen manuell bereitstellen möchten, lesen Sie den Abschnitt [Benutzerdefinierte Bildschirmnamen](#custom-screen-names) unten.

---

### React Navigation

Wenn Sie **React Navigation** (`@react-navigation/native`) verwenden, verwenden Sie den `useNavigationTracking`-Hook in Ihrem Stammverzeichnis `NavigationContainer`:

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

### Benutzerdefinierte Bildschirmnamen

Wenn Sie Bildschirmnamen manuell angeben möchten (z. B. aus Gründen der Analysekonsistenz oder wenn Sie die oben genannten Bibliotheken nicht verwenden), verwenden Sie die Methode `trackScreen`.

#### Für Expo Router-Benutzer:
Um benutzerdefinierte Namen mit Expo Router zu verwenden, müssen Sie zunächst die automatische Nachverfolgung in Ihrer Konfiguration deaktivieren:

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### Manueller Tracking-Anruf:
Rufen Sie `trackScreen` auf, wenn ein Bildschirmwechsel auftritt:

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## Benutzeridentifikation

Verknüpfen Sie Sitzungen mit Ihren internen Benutzer-IDs, um im Dashboard nach bestimmten Benutzern zu filtern und zu suchen.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

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

Hängen Sie Schlüssel-Wert-Paare auf Sitzungsebene an, die den Benutzer- oder Sitzungskontext beschreiben. Im Gegensatz zu Ereignissen werden Metadaten einmal pro Schlüssel festgelegt und gelten für die gesamte Sitzung.

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

### Wann Metadaten vs. Ereignisse verwendet werden sollten

| Anwendungsfall | Verwenden Sie **Metadaten** | Verwenden Sie **Veranstaltungen** |
|---|---|---|
| Abonnementplan des Benutzers |  `setMetadata('plan', 'pro')` | |
| Der Benutzer hat auf eine Schaltfläche geklickt | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| A/B-Testvariante |  `setMetadata('ab_variant', 'v2')` | |
| Kauf abgeschlossen | |  `logEvent('purchase', { amount: 29 })` |
| Benutzerrolle |  `setMetadata('role', 'admin')` | |
| Onboarding-Schritt erreicht | |  `logEvent('onboarding_step', { step: 3 })` |

**Faustregel:** Wenn es beschreibt, *wer der Benutzer ist* oder *in welchem ​​Status er sich befindet*, verwenden Sie Metadaten. Wenn es *etwas beschreibt, das passiert ist*, verwenden Sie Ereignisse.

## Datenschutzkontrollen

Texteingaben und Kameraansichten werden standardmäßig automatisch maskiert. Projektadministratoren können die Standardstufe der Texteingabemaskierung in den Projekteinstellungen für unterstützte SDK-Versionen ändern; Ältere SDK-Versionen ignorieren diese Remote-Einstellung und behalten ihr bestehendes Maskierungsverhalten bei. Sichere Felder/Passwortfelder, Kameraansichten und explizite Masken bleiben geschützt.

Um zusätzliche sensible Benutzeroberflächen manuell auszublenden, schließen Sie Komponenten in die Komponente `Mask` ein:

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

Maskierter Inhalt erscheint in Wiedergaben als ausgefülltes Rechteck und wird nie an der Quelle erfasst.

### Benutzereinwilligung & GDPR




> [!IMPORTANT]
> **Sie sind der Datenverantwortliche.** Rejourney fungiert in Ihrem Namen als Datenverarbeiter. Sie sind dafür verantwortlich, sicherzustellen, dass Ihre Endbenutzer über die Sitzungsaufzeichnung informiert werden und dass Sie über eine gültige Rechtsgrundlage für die Verarbeitung ihrer Daten verfügen (z. B. Einwilligung oder berechtigte Interessen).

#### Was Sie tun müssen

1. **Geben Sie die Sitzungsaufzeichnung in der Datenschutzrichtlinie Ihrer App an.** Fügen Sie eine Sprache hinzu wie:

   > * „Wir verwenden Rejourney, um anonymisierte UND nicht anonymisierte Sitzungswiederholungen Ihrer In-App-Aktivitäten aufzuzeichnen, um uns dabei zu helfen, das Produkt zu verbessern, Abstürze und Probleme zu verfolgen und Produktreibungen zu reduzieren. Sitzungsdaten können Bildschirminteraktionen, Geräteinformationen und den ungefähren Standort umfassen. Texteingaben und sensible UI-Elemente werden automatisch maskiert und niemals erfasst.“*

2. **Gate-Aufzeichnung hinter Zustimmung** (empfohlen für EWR-Benutzer):

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Respektieren Sie Opt-outs.** Wenn ein Benutzer seine Einwilligung widerruft, beenden Sie die Aufzeichnung und löschen Sie seine Daten:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Konsolenprotokollerfassung

Die Konsolenprotokollerfassung ist standardmäßig aktiviert (`trackConsoleLogs: true`). Konsolenprotokolle können abhängig von den Protokollierungspraktiken Ihrer App PII enthalten. Deaktivieren Sie es, wenn vertrauliche Daten in Protokollen angezeigt werden könnten:

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### Geolokalisierung

Standardmäßig wird die IP-abgeleitete Geolokalisierung (Land, Region, Stadt) erfasst. Wenn `collectGeoLocation` `false` ist, übergibt SDK ein Flag an die native Ebene, das die IP-Geolokalisierungssuche im Backend unterdrückt – für diese Sitzung werden keine Standortdaten gespeichert. Deaktivieren Sie es, wenn Sie keine Standortdaten benötigen oder die Datenerfassung für EWR-Benutzer minimieren möchten:

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Native Blätter

Die native Blatterfassung ist für unterstützte SDK-Versionen standardmäßig aktiviert (`captureNativeSheets: true`). Dadurch können App-eigene native Blätter und Dialoge, wie z. B. Zahlungsautorisierungsmodalitäten, in Debugging-Wiedergaben angezeigt werden, wenn das Betriebssystem die Erfassung zulässt. Tastatur-/Texteingabesystemblätter werden ausgeschlossen, wenn Texteingaben standardmäßig maskiert sind. Wenn die Texteingabemaskierung nur auf sichere Felder eingestellt ist, sind Tastaturen nur Best-Effort-Tastaturen und können nicht zuverlässig erfasst werden, insbesondere wenn das Betriebssystem sie als geschützte oder Remote-Oberflächen darstellt. Betriebssystem-Share-Sheets sind ebenfalls nur Best-Effort-Arbeitsblätter und können nicht zuverlässig erfasst werden, wenn das System sie als geschützte oder Remote-Oberflächen darstellt.

Deaktivieren Sie die native Blatterfassung, wenn die visuelle Wiedergabe auf das Hauptfenster der App beschränkt bleiben soll:

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### Nur-Beobachtungsmodus (keine visuelle Aufzeichnung)

Um Fehler, Abstürze, ANRs und Netzwerkaktivität **ohne** bei der Aufzeichnung visueller Wiedergaben zu erfassen, legen Sie `observeOnly: true` fest:

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Wenn diese Option aktiviert ist, werden alle Telemetriedaten erfasst, es werden jedoch keine Screenshots erstellt. Sitzungen werden NICHT auf Ihrer Wiedergabeseite angezeigt, es werden jedoch vollständige Analyse-/Fehler-/Netzwerk-/Absturzdaten angezeigt. Keine Wiederholung. Dies ist nützlich, wenn Benutzer die Bildschirmaufzeichnung deaktiviert haben, Sie aber dennoch Fehlersichtbarkeit wünschen.

> **Notiz:** Dies kann pro Benutzer bedingt festgelegt werden, beispielsweise basierend auf einer gespeicherten Präferenz oder einem Einwilligungsflag:
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```
