# Hosting autonomo Rejourney

Questa guida riguarda **chiunque** che esegue Rejourney sul proprio server (in genere un singolo VPS o una macchina dedicata) utilizzando lo stack ufficiale **Docker Compose**. Non è necessario accedere all'infrastruttura interna di Rejourney o Kubernetes.

Dopo la configurazione ottieni:

- Uno **dashboard web** nel tuo dominio (HTTPS tramite Let’s Encrypt)
- Uno **API** su un sottodominio (per dashboard e dispositivi mobili SDK)
- Uno **assimilare (caricare) il relè** su un altro sottodominio (i caricamenti delle sessioni passano attraverso il tuo server, non direttamente dai telefoni all'archivio oggetti)
- **PostgreSQL**, **Redis** e **MinIO integrato** o **il tuo spazio di archiviazione S3-compatible**
- **lavoratori** in background che elabora sessioni, conservazione e avvisi (stessi ruoli della distribuzione cloud di Rejourney)

Tutti i comandi seguenti presuppongono che ci si trovi in ​​ **radice del deposito** dopo la clonazione (la cartella che contiene `docker-compose.selfhosted.yml`).

---

## Di cosa hai bisogno in anticipo

### Server

- **Sistema operativo:** Ubuntu 22.04+, Debian 12+ o un altro Linux che esegue bene Docker
- **Docker:** 24 ​​o successivo, con **Plug-in Docker Compose** (`docker compose version` dovrebbe funzionare)
- **Risorse (consigliate):** 4 vCPU, 8 GB RAM, disco 40 GB (di più se conservi molte registrazioni)
- **Rete:** Le porte **80** e **443** aperte a Internet (richieste per la sfida Let’s Encrypt HTTP e HTTPS)

### Dominio e DNS

Hai bisogno di **un dominio di base** che controlli (ad esempio `example.com`). Prima di eseguire il programma di installazione, crea i record DNS **UN** (o **AAAA**) che puntano **Tutto** di questi nomi host all'IP pubblico del tuo server:

| Nome host | Scopo |
|----------|---------|
| `example.com` | Cruscotto |
| `www.example.com` | Reindirizzamenti alla dashboard |
| `api.example.com` | API (e WebSocket dove utilizzato) |
| `ingest.example.com` | Relè di caricamento (SDK lo utilizza automaticamente una volta configurato API) |

Sostituisci `example.com` con il tuo dominio reale. La propagazione può richiedere da pochi minuti a ore; I certificati TLS non verranno emessi finché DNS non verrà risolto correttamente.

### Let’s Encrypt

Durante l'installazione ti verrà richiesto uno **indirizzo e-mail**. Viene utilizzato per gli avvisi di scadenza dei certificati da Let’s Encrypt.

### Strumenti sulla tua macchina

- `git` per clonare il repository
- `openssl` (utilizzato dallo script di installazione per generare segreti)
- Una conchiglia (bash va bene)

---

## Prima installazione

### 1. Clonare il repository

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

Rimani sul ramo predefinito (o su un tag di rilascio se il progetto ne documenta uno per l'hosting autonomo).

### 2. Eseguire il programma di installazione

```bash
./scripts/selfhosted/deploy.sh install
```

La sceneggiatura:

1. Richiedi il tuo **dominio di base** (ad es. `example.com` — non `https://`, nessun percorso).
2. Richiedi il tuo **E-mail Let’s Encrypt**.
3. Richiedi **magazzinaggio**: storage **MinIO** integrato (consigliato) o **esterno S3-compatible** (inserirai endpoint, bucket, regione e chiavi).
4. Crea **`.env.selfhosted`** nella root del repository con password e segreti generati. **Limitare le autorizzazioni** vengono applicati (`chmod 600`).
5. **Tiro** immagini del contenitore pubblicate (API, web, lavoratori, database, Traefik, ecc.).
6. **Costruire** l'immagine **bootstrap/migrazione** **dal tuo clone** (contiene gli script di configurazione del database; non viene scaricato dal registro del contenitore).
7. Avvia i database, Redis, Traefik e (se selezionato) MinIO.
8. Convalidare la connettività del database utilizzando `DATABASE_URL` configurato prima dell'esecuzione del bootstrap.
9. Esegui un contenitore **bootstrap** one-shot: schema del database, seed opzionale per la prima volta e configurazione di archiviazione nel database.
10. Avvia API, carica relè, dashboard e lavoratori.

La prima installazione può richiedere diversi minuti (pull di immagini e bootstrap).

### 3. Proteggi `.env.selfhosted`

Questo file contiene **tutti i segreti** per la tua distribuzione (database, Redis, JWT, crittografia di archiviazione, credenziali MinIO se utilizzate, ecc.). **Esegui il backup** in un luogo sicuro (gestore password, backup crittografato). Se lo perdi, potresti perdere la capacità di decrittografare le credenziali archiviate o di ricostruire la stessa distribuzione.

Non impegnarlo su git (dovrebbe essere ignorato da `.gitignore`).

---

## Dopo l'installazione

### URL

Il programma di installazione stampa gli URL. Generalmente:

- **Pannello di controllo:** `https://<your-base-domain>`
- **API:** `https://api.<your-base-domain>`
- **Ingerire:** `https://ingest.<your-base-domain>`

`www.<your-base-domain>` reindirizza al dashboard.

### Verificare lo stack

```bash
./scripts/selfhosted/deploy.sh status
```

Dovresti vedere i contenitori in esecuzione; `api` e `ingest-upload` dovrebbero diventare **salutare** dopo poco tempo.

### Primo accesso e prova di registrazione

1. Apri la dashboard in un browser.
2. Crea un account e un progetto.
3. Configura Rejourney SDK della tua app con **URL API** (vedi [Configurazione SDK](#configuring-your-mobile-app) di seguito).
4. Registra una breve sessione e verifica che appaia in Replay.

Se le sessioni non vengono mai visualizzate in Replay, consulta [Risoluzione dei problemi](/docs/selfhosted/troubleshooting) (caricamento di inoltro e acquisizione dei log di lavoro).

---

## Operazioni quotidiane

Tutti questi vengono eseguiti dalla radice del repository.

| Azione | Comando |
|--------|---------|
| Stato del servizio | `./scripts/selfhosted/deploy.sh status` |
| Segui tutti i registri | `./scripts/selfhosted/deploy.sh logs` |
| Registri per un servizio | `./scripts/selfhosted/deploy.sh logs api` (sostituisci `api` con `web`, `ingest-upload`, `ingest-worker`, ecc.) |
| Immagini **Aggiornamento** e riesecuzione del bootstrap | `./scripts/selfhosted/deploy.sh update` |
| Interrompi tutto **senza** eliminazione dei dati | `./scripts/selfhosted/deploy.sh stop` |
| Contenitori e volumi **Reset** (distruttivo) | `./scripts/selfhosted/deploy.sh reset` |

**`update`** estrae immagini più recenti (ove applicabile), ricostruisce l'immagine bootstrap dal clone corrente, riavvia lo stack ed esegue nuovamente il bootstrap in modo che lo schema del database e le impostazioni di archiviazione rimangano allineati con il tuo `.env.selfhosted`. **non** cancella Postgres o i volumi di archiviazione degli oggetti.

Prima del bootstrap, sia `install` che `update` convalidano la connettività del database con le credenziali configurate. Se le credenziali non corrispondono ai dati Postgres persistenti, la distribuzione si interrompe anticipatamente con le indicazioni di ripristino invece di fallire successivamente nel bootstrap.

**`stop`** arresta solo i contenitori; Docker **volumi** (dati Postgres, dati MinIO, ecc.) rimangono finché non li rimuovi esplicitamente.

**`reset`** rimuove i contenitori self-hosted e i volumi Docker (`pgdata`, `redisdata`, `miniodata`, `traefik-certs`) dopo una richiesta di conferma. Inoltre, elimina i contenitori del profilo MinIO anche quando manca `.env.selfhosted`, quindi i dati MinIO obsoleti non bloccano l'installazione successiva. Utilizzalo solo quando desideri un'installazione completamente nuova.

---

## Archiviazione: MinIO rispetto a S3 esterno

### MinIO integrato (predefinito)

- La soluzione più semplice per un singolo server: l'archiviazione di oggetti viene eseguita su **all'interno Docker** e non è esposta a Internet pubblica per impostazione predefinita.
- I byte di sessione vengono scritti dal servizio **caricamento ingest**; non è necessario che i dispositivi raggiungano direttamente MinIO.
- La creazione del bucket viene gestita durante l'installazione.

### Memoria esterna S3-compatible

Utilizza AWS S3, Cloudflare R2, Hetzner Object Storage, Wasabi o qualsiasi S3-compatible API. Durante l'installazione fornisci l'URL dell'endpoint, il bucket, la regione e le chiavi di accesso.

Esempi di stili URL endpoint (i documenti del tuo provider sono autorevoli):

- AWS: `https://s3.<region>.amazonaws.com`
- Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`
- Hetzner: `https://<location>.your-objectstorage.com`

Se aggiungi un **URL pubblico separato** per i download, imposta `S3_PUBLIC_ENDPOINT` in `.env.selfhosted` ed esegui `./scripts/selfhosted/deploy.sh update`.

---

## Configurazione importante (`.env.selfhosted`)

Il programma di installazione genera questo file. Le variabili tipiche includono:

- **Domini e URL pubblici:** `BASE_DOMAIN`, `DASHBOARD_DOMAIN`, `API_DOMAIN`, `INGEST_DOMAIN`, `PUBLIC_*_URL`
- **Banca dati:** `DATABASE_URL` (punta al servizio `postgres` all'interno di Compose)
- **Redis:** `REDIS_URL`
- **Magazzinaggio:** `STORAGE_BACKEND`, `S3_*` e opzionalmente `MINIO_*`
- **Sicurezza:** `JWT_SECRET`, `JWT_SIGNING_KEY`, `INGEST_HMAC_SECRET`, `STORAGE_ENCRYPTION_KEY`

Integrazioni opzionali (lasciare vuoto se inutilizzato): Stripe, SMTP, GitHub OAuth, Turnstile, ecc.

**Modifica dei valori relativi allo spazio di archiviazione o al dominio:** modifica `.env.selfhosted`, quindi esegui:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## Come funziona la configurazione del database (primo avvio o aggiornamenti successivi)

Normalmente **non** è necessario eseguire SQL manualmente. Il contenitore **bootstrap** lo gestisce.

- **Nuovo database vuoto:** lo stack applica lo schema corrente dal codice, quindi registra quali versioni di migrazione sono già soddisfatte, quindi gli aggiornamenti futuri applicano solo le migrazioni **nuovo**.
- **Database esistente (già inizializzato):** vengono applicate solo le migrazioni **in attesa di**. I tuoi dati non vengono ricostruiti da zero su ogni `update`.
- Se il database **ha già delle tabelle** ma la tabella della cronologia della migrazione è **mancante o vuoto** (ad esempio un ripristino parziale), eseguire il bootstrap **si ferma con un errore** per evitare danni accidentali. Le opzioni di ripristino avanzate sono documentate in [Risoluzione dei problemi](/docs/selfhosted/troubleshooting).

---

## Server Apple Silicon e ARM

Sui computer **ARM64** (molti Mac, alcune istanze cloud), lo script di distribuzione imposta `DOCKER_DEFAULT_PLATFORM=linux/amd64` per i pull di immagini quando non lo hai impostato tu stesso, quindi le immagini precostruite che pubblicano solo `amd64` vengono comunque eseguite. Se hai bisogno di un comportamento diverso, imposta `DOCKER_DEFAULT_PLATFORM` nel tuo ambiente prima di eseguire lo script.

L'immagine **bootstrap** è sempre **costruito sulla tua macchina** dal repository clonato, quindi corrisponde sempre al tuo pagamento.

---

## Cosa funziona in Docker (panoramica)

- Certificati **Traefik:** HTTPS e instradamento al dashboard, API e acquisizione di nomi host.
- **Postgres / Redis:** Dati e code dell'applicazione.
- **MinIO:** Memorizzazione di oggetti interni opzionale.
- **API:** Principale HTTP API.
- **caricamento ingest:** Servizio dedicato per il traffico di inoltro in upload.
- **web:** Interfaccia utente statica del dashboard.
- **Lavoratori:** Elabora code di acquisizione, elementi di riproduzione, ciclo di vita della sessione, lavoro pianificato in stile conservazione e avvisi.

In questo stack è presente un lavoratore batch di fatturazione separato **NO**; l'integrazione della fatturazione è guidata da Stripe e API quando si configurano le chiavi.

---

## Configurazione dell'app mobile

Puntare SDK verso l'host **tuo** API (deve corrispondere a `API_DOMAIN` / `PUBLIC_API_URL`).

### Esempio React Native

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

Utilizza il tuo vero URL API. Gli URL di caricamento vengono derivati ​​automaticamente per `ingest.<your-domain>` quando il server è configurato correttamente.

---

## Backup

Come minimo, eseguire il backup di **PostgreSQL**, **`.env.selfhosted`** e (se si utilizza MinIO integrato) **dati di archiviazione degli oggetti**.

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Dettagli: [Backup e ripristino](/docs/selfhosted/backup-recovery).

---

## Risoluzione dei problemi e supporto

- [Risoluzione dei problemi](/docs/selfhosted/troubleshooting): errori di bootstrap, TLS, Replay vuoto, problemi esterni S3.
- [Backup e ripristino](/docs/selfhosted/backup-recovery) — ripristina l'ordine e MinIO.

Per bug o miglioramenti a questi documenti, utilizza il tracker dei problemi pubblici del progetto su GitHub.

---

## Documentazione correlata

- [Cloud distribuito e cloud a nodo singolo](/docs/distributed-vs-single-node/distributed-vs-single-node): confronto con un layout cloud multiservizio (concettuale).
