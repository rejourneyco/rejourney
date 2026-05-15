# Zelf-hosting Rejourney

Deze handleiding is bedoeld voor **iedereen** met Rejourney op hun eigen server (meestal een enkele VPS of een speciale machine) met behulp van de officiële **Docker Compose**-stack. U heeft geen toegang nodig tot de interne infrastructuur van Rejourney of Kubernetes.

Na het instellen krijg je:

- Een **webdashboard** op uw domein (HTTPS via Let’s Encrypt)
- Een **API** op een subdomein (voor het dashboard en mobiele SDK)
- Een **ingest (upload) relais** op een ander subdomein (sessie-uploads gaan via uw server, niet rechtstreeks van telefoons naar objectopslag)
- **PostgreSQL**, **Redis**, en **ingebouwde MinIO** of **uw eigen S3-compatible-opslag**
- Achtergrond **werknemers** die sessies, retentie en waarschuwingen verwerkt (dezelfde rollen als in de cloudimplementatie van Rejourney)

Bij alle onderstaande opdrachten wordt ervan uitgegaan dat u zich na het klonen in de **hoofdmap van de opslagplaats** bevindt (de map die `docker-compose.selfhosted.yml` bevat).

---

## Wat je vooraf nodig hebt

### Server

- **Besturingssysteem:** Ubuntu 22.04+, Debian 12+, of een andere Linux die goed werkt met Docker
- **Docker:** 24 ​​of nieuwer, met de **Docker Compose-plug-in** (`docker compose version` zou moeten werken)
- **Bronnen (aanbevolen):** 4 vCPU, 8 GB RAM, 40 GB schijf (meer als je veel opnames bewaart)
- **Netwerk:** Poorten **80** en **443** open voor internet (vereist voor Let’s Encrypt HTTP challenge en HTTPS)

### Domein en DNS

U hebt de **één basisdomein** nodig die u beheert (bijvoorbeeld `example.com`). Voordat u het installatieprogramma uitvoert, maakt u DNS **A** (of **AAAA**) records die **alle** van deze hostnamen naar het openbare IP-adres van uw server verwijzen:

| Hostnaam | Doel |
|----------|---------|
| `example.com` | Dashboard |
| `www.example.com` | Omleidingen naar het dashboard |
| `api.example.com` | API (en WebSocket indien gebruikt) |
| `ingest.example.com` | Uploadrelais (SDK gebruikt dit automatisch zodra API is geconfigureerd) |

Vervang `example.com` door uw echte domein. Voortplanting kan enkele minuten tot uren duren; TLS-certificaten worden pas uitgegeven als DNS correct is opgelost.

### Let’s Encrypt

Tijdens de installatie wordt u om een ​​ **e-mailadres** gevraagd. Het wordt gebruikt voor kennisgevingen over het verlopen van certificaten van Let’s Encrypt.

### Gereedschap op uw machine

- `git` om de repository te klonen
- `openssl` (gebruikt door het installatiescript om geheimen te genereren)
- Een schaal (bash is prima)

---

## Eerste installatie

### 1. Kloon de repository

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

Blijf op de standaardbranch (of een releasetag als het project er een documenteert voor zelfhosting).

### 2. Voer het installatieprogramma uit

```bash
./scripts/selfhosted/deploy.sh install
```

Het script zal:

1. Vraag naar uw **basisdomein** (bijvoorbeeld `example.com` - niet `https://`, geen pad).
2. Vraag naar uw **Let’s Encrypt e-mail**.
3. Vraag naar **opslag**: ingebouwde **MinIO** (aanbevolen) of **externe S3-compatible**-opslag (u voert het eindpunt, de bucket, de regio en de sleutels in).
4. Maak **`.env.selfhosted`** in de repo-root met gegenereerde wachtwoorden en geheimen. **Beperk rechten** worden toegepast (`chmod 600`).
5. **Trekken** gepubliceerde containerimages (API, web, werknemers, databases, Traefik, enz.).
6. **Bouwen** de **bootstrap/migratie**-image **van je kloon** (deze bevat de scripts voor het instellen van de database; deze wordt niet gedownload uit het containerregister).
7. Start databases, Redis, Traefik en (indien gekozen) MinIO.
8. Valideer de databaseconnectiviteit met behulp van de geconfigureerde `DATABASE_URL` voordat de bootstrap wordt uitgevoerd.
9. Voer een eenmalige **bootstrap**-container uit: databaseschema, optioneel eerste zaad en opslagconfiguratie in de database.
10. Start de API, upload relay, dashboard en werkers.

De eerste installatie kan enkele minuten duren (image pulls en bootstrap).

### 3. Bescherm `.env.selfhosted`

Dit bestand bevat **allemaal geheimen** voor uw implementatie (database, Redis, JWT, opslagversleuteling, MinIO-referenties indien gebruikt, enz.). **Maak een back-up** naar een veilige plaats (wachtwoordbeheerder, gecodeerde back-up). Als u deze verliest, verliest u mogelijk de mogelijkheid om opgeslagen inloggegevens te decoderen of dezelfde implementatie te reconstrueren.

Leg het niet vast in git (het moet worden genegeerd door `.gitignore`).

---

## Na installatie

### URL's

Het installatieprogramma drukt de URL's af. Algemeen:

- **Dashboard:** `https://<your-base-domain>`
- **API:** `https://api.<your-base-domain>`
- **Inslikken:** `https://ingest.<your-base-domain>`

`www.<your-base-domain>` verwijst door naar het dashboard.

### Controleer de stapel

```bash
./scripts/selfhosted/deploy.sh status
```

Je zou containers moeten zien draaien; `api` en `ingest-upload` zouden na korte tijd **gezond** moeten worden.

### Eerste login en testopname

1. Open het dashboard in een browser.
2. Maak een account en een project aan.
3. Configureer de Rejourney SDK van uw app met uw **API-URL** (zie [SDK-configuratie](#configuring-your-mobile-app) hieronder).
4. Neem een ​​korte sessie op en bevestig dat deze in Replay verschijnt.

Als sessies nooit verschijnen in Replay, raadpleegt u [Problemen oplossen](/docs/selfhosted/troubleshooting) (relay uploaden en werkerlogboeken opnemen).

---

## Dagelijkse werkzaamheden

Deze draaien allemaal vanaf de repo-root.

| Actie | Commando |
|--------|---------|
| Servicestatus | `./scripts/selfhosted/deploy.sh status` |
| Volg alle logboeken | `./scripts/selfhosted/deploy.sh logs` |
| Logboeken voor één service | `./scripts/selfhosted/deploy.sh logs api` (vervang `api` door `web`, `ingest-upload`, `ingest-worker`, enz.) |
| **Upgraden**-images en bootstrap opnieuw uitvoeren | `./scripts/selfhosted/deploy.sh update` |
| Stop alles **zonder** gegevens verwijderen | `./scripts/selfhosted/deploy.sh stop` |
| **Opnieuw instellen** containers en volumes (destructief) | `./scripts/selfhosted/deploy.sh reset` |

**`update`** haalt nieuwere images op (waar van toepassing), herbouwt de bootstrap-image van uw huidige kloon, start de stack opnieuw op en voert bootstrap opnieuw uit, zodat het databaseschema en de opslaginstellingen op één lijn blijven met uw `.env.selfhosted`. **niet** wist Postgres of objectopslagvolumes.

Vóór de bootstrap valideren zowel `install` als `update` de databaseconnectiviteit met de geconfigureerde inloggegevens. Als de referenties niet overeenkomen met de persistente Postgres-gegevens, stopt de implementatie vroegtijdig met herstelbegeleiding in plaats van dat deze later in de bootstrap mislukt.

**`stop`** houdt alleen containers tegen; Docker **volumes** (Postgres-gegevens, MinIO-gegevens, enz.) blijven bestaan ​​totdat u ze expliciet verwijdert.

**`reset`** verwijdert de zelf-hostende containers en Docker-volumes (`pgdata`, `redisdata`, `miniodata`, `traefik-certs`) na een bevestigingsvraag. Het verwijdert ook MinIO-profielcontainers, zelfs als `.env.selfhosted` ontbreekt, zodat verouderde MinIO-gegevens de volgende installatie niet blokkeren. Gebruik dit alleen als u een volledig nieuwe installatie wilt.

---

## Opslag: MinIO versus externe S3

### Ingebouwde MinIO (standaard)

- Het gemakkelijkst voor één server: objectopslag draait **binnen Docker** en is standaard niet blootgesteld aan het openbare internet.
- Sessiebytes worden geschreven door de **ingest-upload**-service; apparaten hoeven MinIO niet rechtstreeks te bereiken.
- Het maken van buckets wordt afgehandeld tijdens de installatie.

### Externe S3-compatible-opslag

Gebruik AWS S3, Cloudflare R2, Hetzner Object Storage, Wasabi of een andere S3-compatible API. Tijdens de installatie geeft u de eindpunt-URL, bucket, regio en toegangssleutels op.

Voorbeelden van eindpunt-URL-stijlen (de documenten van uw provider zijn gezaghebbend):

- AWS: `https://s3.<region>.amazonaws.com`
- Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`
- Hetzner: `https://<location>.your-objectstorage.com`

Als u een **aparte openbare URL** toevoegt voor downloads, stelt u `S3_PUBLIC_ENDPOINT` in `.env.selfhosted` in en voert u `./scripts/selfhosted/deploy.sh update` uit.

---

## Belangrijke configuratie (`.env.selfhosted`)

Het installatieprogramma genereert dit bestand. Typische variabelen zijn onder meer:

- **Domeinen en openbare URL's:** `BASE_DOMAIN`, `DASHBOARD_DOMAIN`, `API_DOMAIN`, `INGEST_DOMAIN`, `PUBLIC_*_URL`
- **Database:** `DATABASE_URL` (wijst naar de `postgres`-service in Compose)
- **Redis:** `REDIS_URL`
- **Opslag:** `STORAGE_BACKEND`, `S3_*` en optioneel `MINIO_*`
- **Beveiliging:** `JWT_SECRET`, `JWT_SIGNING_KEY`, `INGEST_HMAC_SECRET`, `STORAGE_ENCRYPTION_KEY`

Optionele integraties (leeg laten indien ongebruikt): Stripe, SMTP, GitHub OAuth, Turnstile, etc.

**Opslag- of domeingerelateerde waarden wijzigen:** bewerk `.env.selfhosted` en voer vervolgens het volgende uit:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## Hoe database-instellingen werken (eerste keer opstarten versus latere updates)

Normaal gesproken moet **niet** SQL met de hand uitvoeren. De **bootstrap**-container regelt het.

- **Gloednieuwe lege database:** De stapel past het huidige schema uit de code toe en registreert vervolgens aan welke migratieversies al wordt voldaan, zodat toekomstige updates alleen **nieuw**-migraties toepassen.
- **Bestaande database (reeds geïnitialiseerd):** alleen **in behandeling**-migraties worden toegepast. Uw gegevens worden niet op elke `update` opnieuw opgebouwd.
- Als de database **heeft al tafels** maar de migratiegeschiedenistabel **ontbreekt of is leeg** is (bijvoorbeeld een gedeeltelijk herstel), start dan **stopt met een fout** op om onbedoelde schade te voorkomen. Geavanceerde herstelopties zijn gedocumenteerd in [Problemen oplossen](/docs/selfhosted/troubleshooting).

---

## Apple Silicon- en ARM-servers

Op **ARM64**-machines (veel Macs, sommige cloudinstanties) stelt het implementatiescript `DOCKER_DEFAULT_PLATFORM=linux/amd64` in voor het ophalen van afbeeldingen wanneer u dit niet zelf hebt ingesteld, zodat vooraf gebouwde afbeeldingen die alleen `amd64` publiceren, nog steeds worden uitgevoerd. Als u ander gedrag nodig heeft, stelt u `DOCKER_DEFAULT_PLATFORM` in uw omgeving in voordat u het script uitvoert.

De **bootstrap**-afbeelding is altijd **gebouwd op uw machine** uit de gekloonde repository, zodat deze altijd overeenkomt met uw betaling.

---

## Wat draait er in Docker (overzicht)

- **Traefik:** HTTPS certificaten en routering naar het dashboard, API, en hostnamen opnemen.
- **Postgres / Redis:** Applicatiegegevens en wachtrijen.
- **MinIO:** Optionele interne objectopslag.
- **API:** Belangrijkste HTTP API.
- **ingest-upload:** Speciale service voor uploadrelayverkeer.
- **web:** Statische gebruikersinterface van dashboard.
- **Werknemers:** Verwerk opnamewachtrijen, herhaalartefacten, sessielevenscyclus, gepland retentiewerk en waarschuwingen.

Er is een **Nee** afzonderlijke factureringsbatchwerker in deze stapel; factureringsintegratie wordt aangestuurd door Stripe en de API wanneer u sleutels configureert.

---

## Uw mobiele app configureren

Richt de SDK op de **jouw** API-host (moet overeenkomen met `API_DOMAIN` / `PUBLIC_API_URL`).

### React Native voorbeeld

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

Gebruik uw echte API-URL. Upload-URL's worden automatisch afgeleid voor `ingest.<your-domain>` wanneer de server correct is geconfigureerd.

---

## Back-ups

Maak minimaal een back-up van **PostgreSQL**, **`.env.selfhosted`** en (als u de ingebouwde MinIO gebruikt) **objectopslaggegevens**.

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Details: [Back-up en herstel](/docs/selfhosted/backup-recovery).

---

## Probleemoplossing en ondersteuning

- [Problemen oplossen](/docs/selfhosted/troubleshooting) — bootstrap-fouten, TLS, lege herhaling, externe S3-problemen.
- [Back-up en herstel](/docs/selfhosted/backup-recovery) — herstel de volgorde en MinIO.

Voor bugs of verbeteringen aan deze documenten gebruikt u de openbare issuetracker van het project op GitHub.

---

## Gerelateerde documentatie

- [Gedistribueerde vs. cloud met één knooppunt](/docs/distributed-vs-single-node/distributed-vs-single-node) – hoe dit zich verhoudt tot een cloudindeling met meerdere services (conceptueel).
