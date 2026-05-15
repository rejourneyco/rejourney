# Risoluzione dei problemi self-hosted

Utilizza questa pagina se hai seguito [Rejourney self-hosted](/docs/selfhosted) e qualcosa non funziona o si comporta in modo strano. I comandi vengono eseguiti da **radice del deposito** (dove risiede `docker-compose.selfhosted.yml`).

---

## Controlli veloci

### Stato del servizio

```bash
./scripts/selfhosted/deploy.sh status
```

### Registri API

```bash
./scripts/selfhosted/deploy.sh logs api
```

### Carica i log di inoltro

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### Registri dei lavoratori

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. L'installazione o l'aggiornamento non riesce prima o durante il bootstrap

### Sintomi

- `bootstrap` esce diverso da zero
- i servizi delle app non diventano mai integri
- `status` mostra API o i lavoratori in attesa del bootstrap
- installare o aggiornare esce con `Database authentication failed before bootstrap.`

### Controlli

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

Cause comuni:

- pessimo `DATABASE_URL`
- mancata corrispondenza delle credenziali (ad esempio da una precedente distribuzione non riuscita)
- manca `STORAGE_ENCRYPTION_KEY`
- credenziali S3 non valide
- URL dell'endpoint esterno S3 danneggiato
- su **ARM64**, supporto immagine mancante (imposta `DOCKER_DEFAULT_PLATFORM=linux/amd64` o usa `./scripts/selfhosted/deploy.sh`, che lo imposta quando non impostato)

Recupero:

1. Se hai ancora lo `.env.selfhosted` originale, ripristinalo ed esegui:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Se non hai bisogno dei vecchi dati, cancella e reinstalla:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**Messaggi di schema/migrazione:** In un'installazione normale, il database inizia vuoto e il bootstrap configura tutto. Se inserisci **ripristinato Postgres da un backup** in un nuovo server ma mancano i metadati di migrazione o hai puntato lo stack su **banca dati sbagliata**, il bootstrap potrebbe terminare con un errore relativo a un database incoerente invece di sovrascrivere i dati. A meno che non si stia eseguendo un ripristino avanzato, correggere `DATABASE_URL` e ripristinare un backup coerente oppure iniziare da un volume pulito. Per il ripristino deliberato della sola migrazione, alcune configurazioni utilizzano `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` in `.env.selfhosted` (vedere la documentazione del manutentore o il supporto prima di utilizzarlo).

### Aggiustare

1. Se hai lo `.env.selfhosted` originale, ripristinalo ed esegui nuovamente:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Se non disponi del `.env.selfhosted` originale, pulisci e reinstalla:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update` esegue nuovamente la sincronizzazione dello schema, del seed e dell'endpoint di archiviazione. `reset` rimuove i contenitori self-hosted e i volumi di dati in modo che una nuova installazione possa generare nuove credenziali in modo sicuro.

---

## 2. Le sessioni vengono conteggiate ma Replay rimane vuoto

### Cosa significa questo di solito adesso

Con l'architettura attuale, questo è solitamente una delle due cose:

- `ingest-upload` non è riuscito a memorizzare i byte dell'artefatto
- `ingest-worker` non è riuscito a elaborare un artefatto caricato

Il dispositivo non si carica più direttamente su MinIO/S3, quindi la raggiungibilità del bucket dal telefono non è più il principale sospettato.

### Controlli

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

Cercare:

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### Cause comuni

- credenziali S3 errate in `.env.selfhosted`
- secchio esterno S3 mancante
- endpoint S3 esterno non raggiungibile dalla rete Docker
- inoltro di caricamento non integro
- il lavoratore è bloccato nel riprovare gli artefatti non riusciti

### Aggiustare

- verificare i valori `S3_*`
- se hai modificato la configurazione di archiviazione, esegui nuovamente:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. Il dashboard viene caricato, ma le chiamate di autenticazione o API non riescono

### Controlli

- l'host del dashboard DNS punta al server
- L'host API DNS punta al server
- l'host di ingest DNS punta al server
- le porte `80` e `443` sono aperte
- Let’s Encrypt ha emesso certificati

Ispezionare:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS o problemi con il certificato

Traefik gestisce i certificati in modo automatico.

### Controlli

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

Assicurati che entrambi i nomi risolvano il server che esegue lo stack.

Se DNS era errato durante la prima installazione, correggi DNS ed esegui nuovamente:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. S3 esterno funziona nella CLI, ma Rejourney non può caricare

Ricorda che il percorso di caricamento è lato server.

Il percorso di rete importante è:

- Contenitore `ingest-upload` -> il tuo endpoint S3

Testare dal server esaminando i log di inoltro e confermando endpoint/bucket/chiavi in ​​`.env.selfhosted`.

Se li hai modificati, esegui nuovamente:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. Installazione MinIO integrata, ma gli artefatti continuano a fallire

### Controlli

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

Il one-shot `minio-setup` dovrebbe creare il bucket denominato `S3_BUCKET`.

Se hai modificato il nome del bucket dopo la prima installazione, esegui:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. Le pagine di fatturazione mostrano la fatturazione disabilitata

Ciò è previsto a meno che non siano configurate le chiavi Stripe.

Lo stack non disabilita più la fatturazione perché è "auto-ospitato". Disabilita la fatturazione perché Stripe non è configurato.

Se non si impostano le chiavi Stripe:

- l'interfaccia utente di fatturazione rimane nello stato self-hosted/illimitato
- Il checkout e i webhook Stripe rimangono disabilitati

---

## 8. L'endpoint di archiviazione in Postgres è errato dopo la modifica di `.env.selfhosted`

Correre:

```bash
./scripts/selfhosted/deploy.sh update
```

Il percorso di aggiornamento esegue nuovamente il bootstrap e risincronizza la riga `storage_endpoints` attiva.

---

## 9. Necessità di interrompere i servizi senza perdere dati

Utilizzo:

```bash
./scripts/selfhosted/deploy.sh stop
```

Ciò arresta solo i contenitori. Non rimuove i volumi.

---

## 10. Sono necessari registri più profondi per un servizio

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
