# CI/CD e test automatizzati

Rejourney utilizza GitHub Actions per garantire la qualità del codice nell'intero monorepo. Ogni richiesta pull e push al ramo principale attiva una batteria completa di test.

## Suite di prova

### 1. Test API del backend
Situati nella directory `backend/`, questi test garantiscono che la logica principale e le interazioni del database siano stabili.
* **Linting**: utilizza ESLint per applicare lo stile del codice e rilevare errori comuni.
* **Test unitari**: basato su tecnologia Vitest, test della logica del servizio, delle funzioni di utilità e dei controller API.
* **Verifica della creazione**: garantisce che il sorgente TypeScript venga compilato correttamente nella distribuzione finale.

### 2. Test React Native SDK
Situati in `packages/react-native/`, questi test sono fondamentali per la stabilità multipiattaforma.
* **TypeScript Controllare**: convalida i tipi nell'intero SDK, rilevando potenziali mancate corrispondenze del bridge.
* **Linting**: garantisce una qualità del codice costante.
* **Verifica della creazione**: esegue lo script di preparazione per garantire che il pacchetto possa essere raggruppato per la distribuzione.

### 3. Test del dashboard Web
Situato in `dashboard/web-ui/`, focalizzato sull'interfaccia utente e sull'SSR.
* **TypeScript Controllare**: include la generazione del tipo React Router per garantire la sicurezza del percorso.
* **Costruzione dell'SSR**: verifica che l'intera applicazione Remix/React Router possa essere creata per il rendering lato server.

---

## Test di integrazione nativa
Una delle parti più robuste del nostro CI/CD è la convalida dello SDK su ambienti di piattaforma reali.

### Integrazione iOS (macos-più recente)
* **Nuova installazione**: il CI crea da zero un nuovissimo progetto React Native.
* **Iniezione di pacchetti**: raggruppa lo SDK locale utilizzando `npm pack` e lo installa nell'app di test.
* **CocoaPods Verifica**: esegue `pod install` per garantire che le dipendenze native e i podspec siano collegati correttamente.
* **Verifica della creazione**: esegue `xcodebuild` per garantire che l'app di test venga compilata correttamente con SDK integrato.

### Integrazione Android (ubuntu-più recente)
* **Nuova installazione**: simile a iOS, viene inizializzato un nuovo progetto React Native basato su Android.
* **Verifica della creazione**: esegue `./gradlew assembleDebug` per garantire che non vi siano conflitti manifest o errori di compilazione nel codice nativo Android.

---

## Logica di distribuzione e pubblicazione

### Distribuzione cloud automatizzata (VPS)
La distribuzione nel nostro ambiente di produzione è controllata dal controllo delle versioni.
* **Controllo della versione**: un lavoro dedicato confronta la versione root `package.json` con il commit precedente.
* **Trigger condizionale**: la distribuzione procede solo se la versione è stata incrementata.
* **Implementazione automatizzata**: se attivato, applica i manifest K8 più recenti ed esegue un riavvio in sequenza di tutte le distribuzioni (api, Web e lavoratori).

### Pubblicazione automatizzata SDK (NPM)
Manteniamo un flusso di pubblicazione continuo per il pacchetto `rejourney`.
* **Sensibile al percorso**: si attiva solo quando i file all'interno di `packages/react-native/` vengono modificati.
* **Controllo del registro**: confronta la versione del pacchetto locale con la versione più recente nel registro NPM.
* **Pubblicazione automatica**: se la versione locale è successiva, pubblica automaticamente la nuova versione su NPM dopo aver superato tutti i test.
