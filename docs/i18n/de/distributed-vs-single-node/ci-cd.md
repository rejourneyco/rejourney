# CI/CD & automatisiertes Testen

Rejourney verwendet GitHub Actions, um die Codequalität im gesamten Monorepo sicherzustellen. Jede Pull-Anfrage und jeder Push an den Hauptzweig löst eine umfassende Testbatterie aus.

## Testsuiten

### 1. Backend-API-Tests
Diese Tests befinden sich im Verzeichnis `backend/` und stellen sicher, dass die Kernlogik und die Datenbankinteraktionen stabil sind.
* **Flusen**: Verwendet ESLint, um den Codestil durchzusetzen und häufige Fehler zu erkennen.
* **Unit-Tests**: Unterstützt von Vitest, zum Testen von Servicelogik, Dienstprogrammfunktionen und API-Controllern.
* **Build-Überprüfung**: Stellt sicher, dass die TypeScript-Quelle korrekt in die endgültige Verteilung kompiliert wird.

### 2. React Native SDK Tests
Diese Tests befinden sich in `packages/react-native/` und sind für die plattformübergreifende Stabilität von entscheidender Bedeutung.
* **TypeScript Prüfen**: Validiert Typen im gesamten SDK und erkennt mögliche Brückenkonflikte.
* **Flusen**: Erzwingt eine konsistente Codequalität.
* **Build-Überprüfung**: Führt das Vorbereitungsskript aus, um sicherzustellen, dass das Paket für die Verteilung gebündelt werden kann.

### 3. Web-Dashboard-Tests
Befindet sich in `dashboard/web-ui/` und konzentriert sich auf die Benutzeroberfläche und SSR.
* **TypeScript Prüfen**: Beinhaltet die Generierung des React Router-Typs, um die Routensicherheit zu gewährleisten.
* **SSR-Build**: Überprüft, ob die gesamte Remix/React Router-Anwendung für serverseitiges Rendering erstellt werden kann.

---

## Native Integrationstests
Einer der robustesten Teile unseres CI/CD ist die Validierung des SDK in realen Plattformumgebungen.

### iOS-Integration (macos-latest)
* **Neuinstallation**: Das CI erstellt ein brandneues React Native-Projekt von Grund auf.
* **Paketinjektion**: Es bündelt das lokale SDK mithilfe von `npm pack` und installiert es in der Test-App.
* **CocoaPods-Überprüfung**: Führt `pod install` aus, um sicherzustellen, dass die nativen Abhängigkeiten und Podspecs korrekt verknüpft sind.
* **Build-Überprüfung**: Führt `xcodebuild` aus, um sicherzustellen, dass die Test-App mit integriertem SDK erfolgreich kompiliert wird.

### Android-Integration (Ubuntu-neueste Version)
* **Neuinstallation**: Ähnlich wie bei iOS wird ein neues Android-basiertes React Native-Projekt initialisiert.
* **Build-Überprüfung**: Führt `./gradlew assembleDebug` aus, um sicherzustellen, dass im nativen Code Android keine offensichtlichen Konflikte oder Kompilierungsfehler vorliegen.

---

## Bereitstellungs- und Veröffentlichungslogik

### Automatisierte Cloud-Bereitstellung (VPS)
Die Bereitstellung in unserer Produktionsumgebung wird durch Versionierung gesteuert.
* **Versionsprüfung**: Ein dedizierter Job vergleicht die Root-Version `package.json` mit dem vorherigen Commit.
* **Bedingter Auslöser**: Die Bereitstellung wird nur fortgesetzt, wenn die Version erhöht wurde.
* **Automatisierter Rollout**: Bei Auslösung werden die neuesten K8s-Manifeste angewendet und ein fortlaufender Neustart aller Bereitstellungen (API, Web und Worker) durchgeführt.

### Automatisiertes SDK Publishing (NPM)
Wir sorgen für einen nahtlosen Veröffentlichungsfluss für das `rejourney`-Paket.
* **Pfadempfindlich**: Wird nur ausgelöst, wenn Dateien in `packages/react-native/` geändert werden.
* **Registrierungsprüfung**: Vergleicht die lokale Paketversion mit der neuesten Version in der NPM-Registrierung.
* **Automatisch veröffentlichen**: Wenn die lokale Version höher ist, wird die neue Version automatisch in NPM veröffentlicht, nachdem alle Tests bestanden wurden.
