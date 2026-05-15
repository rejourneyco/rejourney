# Zelf-gehoste probleemoplossing

Gebruik deze pagina als u [Self-hosted Rejourney](/docs/selfhosted) hebt gevolgd en er iets mislukt of zich vreemd gedraagt. Commando's worden uitgevoerd vanaf de **hoofdmap van de opslagplaats** (waar `docker-compose.selfhosted.yml` woont).

---

## Snelle controles

### Servicestatus

```bash
./scripts/selfhosted/deploy.sh status
```

### API-logboeken

```bash
./scripts/selfhosted/deploy.sh logs api
```

### Upload relaylogboeken

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### Werknemerslogboeken

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. Installatie of update mislukt voor of tijdens het opstarten

### Symptomen

- `bootstrap` eindigt niet-nul
- app-services worden nooit gezond
- `status` toont API of werknemers die wachten op bootstrap
- installeer of update exits met `Database authentication failed before bootstrap.`

### Cheques

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

Veelvoorkomende oorzaken:

- slechte `DATABASE_URL`
- inloggegevens komen niet overeen (bijvoorbeeld van een eerdere mislukte implementatie)
- ontbrekende `STORAGE_ENCRYPTION_KEY`
- ongeldige S3-inloggegevens
- verbroken externe S3-eindpunt-URL
- op **ARM64**, ontbrekende beeldondersteuning (stel `DOCKER_DEFAULT_PLATFORM=linux/amd64` in of gebruik `./scripts/selfhosted/deploy.sh`, waardoor deze wordt ingeschakeld wanneer deze wordt uitgeschakeld)

Herstel:

1. Als u nog steeds de originele `.env.selfhosted` heeft, herstel deze dan en voer het volgende uit:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Als u geen oude gegevens nodig heeft, veegt u deze af en installeert u deze opnieuw:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**Schema / migratiemeldingen:** Bij een normale installatie begint de database leeg en bootstrap stelt alles in. Als u **Postgres hersteld vanaf een back-up** naar een nieuwe server verplaatst, maar metagegevens voor de migratie ontbreken, of als u de stack op de **verkeerde databank** hebt gericht, kan bootstrap worden afgesloten met een fout over een inconsistente database in plaats van uw gegevens te overschrijven. Tenzij u geavanceerd herstel uitvoert, repareert u `DATABASE_URL` en herstelt u een consistente back-up, of begint u vanaf een schoon volume. Voor doelbewust alleen migreren herstel gebruiken sommige instellingen `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` in `.env.selfhosted` (zie de onderhoudsdocumentatie of ondersteuning voordat u dit gebruikt).

### Repareren

1. Als u de originele `.env.selfhosted` heeft, herstelt u deze en voert u deze opnieuw uit:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Als u niet over de originele `.env.selfhosted` beschikt, veegt u deze af en installeert u deze opnieuw:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update` voert schema-, Seed- en opslag-eindpuntsynchronisatie opnieuw uit. `reset` verwijdert zelf-gehoste containers en datavolumes, zodat een nieuwe installatie veilig nieuwe inloggegevens kan genereren.

---

## 2. Sessies worden geteld, maar Replay blijft leeg

### Wat dit nu meestal betekent

Met de huidige architectuur is dit meestal een van twee dingen:

- `ingest-upload` kan de artefactbytes niet opslaan
- `ingest-worker` kan een geüpload artefact niet verwerken

Het apparaat uploadt niet langer rechtstreeks naar MinIO/S3, dus de bereikbaarheid van de bucket vanaf de telefoon is niet langer de hoofdverdachte.

### Cheques

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

Zoek naar:

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### Veelvoorkomende oorzaken

- verkeerde S3-inloggegevens in `.env.selfhosted`
- externe S3-bak ontbreekt
- extern S3-eindpunt onbereikbaar vanaf Docker-netwerk
- uploadrelais is niet goed
- werknemer bleef hangen bij het opnieuw proberen van mislukte artefacten

### Repareren

- verifieer de `S3_*`-waarden
- als u de opslagconfiguratie hebt gewijzigd, herhaalt u:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. Dashboard wordt geladen, maar auth- of API-aanroepen mislukken

### Cheques

- dashboardhost DNS verwijst naar de server
- API host DNS verwijst naar de server
- ingest host DNS verwijst naar de server
- poorten `80` en `443` zijn open
- Let’s Encrypt heeft certificaten uitgegeven

Inspecteren:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS of certificaatproblemen

Traefik beheert certificaten automatisch.

### Cheques

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

Zorg ervoor dat beide namen verwijzen naar de server waarop de stapel draait.

Als DNS tijdens de eerste installatie verkeerd was, repareer dan DNS en voer het volgende opnieuw uit:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. Externe S3 werkt in CLI, maar Rejourney kan niet uploaden

Houd er rekening mee dat het uploadpad zich op de server bevindt.

Het belangrijke netwerkpad is:

- `ingest-upload` container -> uw S3-eindpunt

Test vanaf de server door relaylogboeken te bekijken en het eindpunt/de bucket/sleutels in `.env.selfhosted` te bevestigen.

Als u ze hebt gewijzigd, voert u het volgende opnieuw uit:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. Ingebouwde MinIO-installatie, maar artefacten mislukken nog steeds

### Cheques

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

De one-shot `minio-setup` zou de bucket met de naam `S3_BUCKET` moeten creëren.

Als u de bucketnaam na de eerste installatie hebt gewijzigd, voert u het volgende uit:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. Factureringspagina's tonen uitgeschakelde facturering

Dat wordt verwacht tenzij Stripe-sleutels zijn geconfigureerd.

De stack schakelt de facturering niet langer uit omdat deze “self-hosted” is. Facturering wordt uitgeschakeld omdat Stripe niet is geconfigureerd.

Als u de Stripe-sleutels niet instelt:

- facturerings-UI blijft in de status zelf-hostend/onbeperkt
- Stripe afrekenen en webhooks blijven uitgeschakeld

---

## 8. Opslageindpunt in Postgres is verkeerd na het wijzigen van `.env.selfhosted`

Loop:

```bash
./scripts/selfhosted/deploy.sh update
```

Het updatepad voert de bootstrap opnieuw uit en synchroniseert de actieve rij `storage_endpoints` opnieuw.

---

## 9. Noodzaak om services te stoppen zonder gegevens te verliezen

Gebruik:

```bash
./scripts/selfhosted/deploy.sh stop
```

Hierdoor worden alleen containers tegengehouden. Er worden geen volumes verwijderd.

---

## 10. Er zijn diepere logboeken nodig voor één service

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
