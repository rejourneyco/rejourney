# CI/CD en geautomatiseerd testen

Rejourney gebruikt GitHub Actions om de codekwaliteit in de gehele monorepo te garanderen. Elke pull-request en push naar de hoofdtak activeert een uitgebreide reeks tests.

## Testsuites

### 1. Backend API-tests
Deze tests bevinden zich in de map `backend/` en zorgen ervoor dat de kernlogica en database-interacties stabiel zijn.
* **Pluizen**: gebruikt ESLint om de codestijl af te dwingen en veelvoorkomende fouten op te sporen.
* **Eenheidstests**: aangedreven door Vitest, testen van servicelogica, nutsfuncties en API-controllers.
* **Bouwverificatie**: Zorgt ervoor dat de TypeScript-broncode correct wordt gecompileerd in de uiteindelijke distributie.

### 2. React Native SDK-tests
Deze tests bevinden zich in `packages/react-native/` en zijn van cruciaal belang voor platformonafhankelijke stabiliteit.
* **TypeScript Controle**: Valideert typen voor de gehele SDK, waarbij potentiële bridge-mismatches worden onderkend.
* **Pluizen**: Dwingt consistente codekwaliteit af.
* **Bouwverificatie**: Voert het voorbereidingsscript uit om ervoor te zorgen dat het pakket kan worden gebundeld voor distributie.

### 3. Webdashboardtests
Gelegen in `dashboard/web-ui/`, gericht op de gebruikersinterface en SSR.
* **TypeScript Controle**: Inclusief React Router-typegeneratie om routeveiligheid te garanderen.
* **SSR-build**: Controleert of de volledige Remix/React Router-applicatie kan worden gebouwd voor server-side rendering.

---

## Native integratietesten
Een van de meest robuuste onderdelen van onze CI/CD is de validatie van de SDK op echte platformomgevingen.

### iOS-integratie (macos-nieuwste)
* **Nieuwe installatie**: De CI creëert een gloednieuw React Native-project vanaf het begin.
* **Pakketinjectie**: Het bundelt de lokale SDK met behulp van `npm pack` en installeert deze in de test-app.
* **CocoaPods-verificatie**: Voert `pod install` uit om ervoor te zorgen dat de systeemeigen afhankelijkheden en podspecs correct zijn gekoppeld.
* **Bouwverificatie**: voert `xcodebuild` uit om ervoor te zorgen dat de test-app succesvol wordt gecompileerd met de geïntegreerde SDK.

### Android Integratie (ubuntu-nieuwste)
* **Nieuwe installatie**: Net als bij iOS wordt een nieuw Android-gebaseerd React Native-project geïnitialiseerd.
* **Bouwverificatie**: Voert `./gradlew assembleDebug` uit om ervoor te zorgen dat er geen manifeste conflicten of compilatiefouten voorkomen in de native code van Android.

---

## Implementatie- en publicatielogica

### Geautomatiseerde cloudimplementatie (VPS)
De implementatie in onze productieomgeving is beveiligd via versiebeheer.
* **Versiecontrole**: een speciale taak vergelijkt de root-`package.json`-versie met de vorige commit.
* **Voorwaardelijke trigger**: De implementatie gaat alleen door als de versie is verhoogd.
* **Geautomatiseerde uitrol**: Indien geactiveerd, worden de nieuwste K8s-manifesten toegepast en wordt een rollende herstart van alle implementaties (api, web en werkrollen) uitgevoerd.

### Geautomatiseerde SDK-publicatie (NPM)
We onderhouden een naadloze publicatiestroom voor het `rejourney`-pakket.
* **Padgevoelig**: wordt alleen geactiveerd wanneer bestanden in `packages/react-native/` worden gewijzigd.
* **Registercontrole**: Vergelijkt de lokale pakketversie met de nieuwste versie in het NPM-register.
* **Automatisch publiceren**: als de lokale versie hoger is, publiceert deze automatisch de nieuwe versie naar NPM nadat alle tests zijn geslaagd.
