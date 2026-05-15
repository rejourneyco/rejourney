# Selbsthosting Rejourney

Dieses Handbuch richtet sich an **irgendjemand**, die Rejourney auf ihrem eigenen Server (normalerweise ein einzelner VPS oder eine dedizierte Maschine) unter Verwendung des offiziellen **Docker Compose**-Stacks ausführen. Sie benötigen keinen Zugriff auf die interne Infrastruktur von Rejourney oder Kubernetes.

Nach der Einrichtung erhalten Sie:

- Ein **Web-Dashboard** in Ihrer Domain (HTTPS über Let’s Encrypt)
- Ein **API** auf einer Subdomain (für das Dashboard und mobile SDK)
- Ein **Ingest-(Upload-)Relay** auf einer anderen Subdomain (Sitzungs-Uploads laufen über Ihren Server, nicht direkt von Telefonen zum Objektspeicher)
- **PostgreSQL**, **Redis** und entweder **eingebaut MinIO** oder **Ihr eigener S3-compatible-Speicher**
- Hintergrund **Arbeiter**, der Sitzungen, Aufbewahrung und Warnungen verarbeitet (dieselben Rollen wie in der Cloud-Bereitstellung von Rejourney)

Bei allen folgenden Befehlen wird davon ausgegangen, dass Sie sich nach dem Klonen im **Repository-Stammverzeichnis** befinden (dem Ordner, der `docker-compose.selfhosted.yml` enthält).

---

## Was Sie vorher brauchen

### Server

- **Betriebssystem:** Ubuntu 22.04+, Debian 12+ oder ein anderes Linux, auf dem Docker gut läuft
- **Docker:** 24 ​​oder neuer, mit **Docker Compose-Plugin** (`docker compose version` sollte funktionieren)
- **Ressourcen (empfohlen):** 4 vCPU, 8 GB RAM, 40 GB Festplatte (mehr, wenn Sie viele Aufnahmen behalten)
- **Netzwerk:** Ports **80** und **443** offen für das Internet (erforderlich für Let’s Encrypt HTTP Challenge und HTTPS)

### Domäne und DNS

Sie benötigen **eine Basisdomäne**, das Sie steuern (z. B. `example.com`). Erstellen Sie vor dem Ausführen des Installationsprogramms DNS **A** (oder **AAAA**) Datensätze, die **alle** dieser Hostnamen auf die öffentliche IP Ihres Servers verweisen:

| Hostname | Zweck |
|----------|---------|
| `example.com` | Dashboard |
| `www.example.com` | Leitet zum Dashboard weiter |
| `api.example.com` | API (und WebSocket, sofern verwendet) |
| `ingest.example.com` | Upload-Relay (SDK verwendet dies automatisch, sobald API konfiguriert ist) |

Ersetzen Sie `example.com` durch Ihre echte Domain. Die Ausbreitung kann einige Minuten bis Stunden dauern; TLS-Zertifikate werden erst ausgestellt, wenn DNS korrekt aufgelöst wird.

### Let’s Encrypt

Während der Installation werden Sie nach einem **E-Mail-Adresse** gefragt. Es wird für Zertifikatsablaufbenachrichtigungen von Let’s Encrypt verwendet.

### Werkzeuge an Ihrer Maschine

- `git`, um das Repository zu klonen
- `openssl` (wird vom Installationsskript zum Generieren von Geheimnissen verwendet)
- Eine Shell (bash ist in Ordnung)

---

## Erstmalige Installation

### 1. Klonen Sie das Repository

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

Bleiben Sie im Standardzweig (oder einem Release-Tag, wenn das Projekt einen für Selbsthosting vorsieht).

### 2. Führen Sie das Installationsprogramm aus

```bash
./scripts/selfhosted/deploy.sh install
```

Das Skript wird:

1. Fragen Sie nach Ihrem **Basisdomäne** (z. B. `example.com` – nicht `https://`, kein Pfad).
2. Fragen Sie nach Ihrem **Let’s Encrypt E-Mail**.
3. Fragen Sie nach **Lagerung**: integrierter **MinIO** (empfohlen) oder **extern S3-compatible**-Speicher (Sie müssen Endpunkt, Bucket, Region und Schlüssel eingeben).
4. Erstellen Sie **`.env.selfhosted`** im Repo-Root mit generierten Passwörtern und Geheimnissen. **Berechtigungen einschränken** werden angewendet (`chmod 600`).
5. **Ziehen** veröffentlichte Containerbilder (API, Web, Worker, Datenbanken, Traefik usw.).
6. **Bauen** das **Bootstrap / Migration**-Image **von Ihrem Klon** (es enthält die Datenbank-Setup-Skripts; es wird nicht aus der Container-Registrierung heruntergeladen).
7. Starten Sie die Datenbanken Redis, Traefik und (falls ausgewählt) MinIO.
8. Überprüfen Sie die Datenbankkonnektivität mit dem konfigurierten `DATABASE_URL`, bevor Bootstrap ausgeführt wird.
9. Führen Sie einen One-Shot-Container **Bootstrap** aus: Datenbankschema, optionaler Erststart und Speicherkonfiguration in der Datenbank.
10. Starten Sie API, laden Sie Relay, Dashboard und Worker hoch.

Die Erstinstallation kann mehrere Minuten dauern (Image-Pulls und Bootstrap).

### 3. Schützen Sie `.env.selfhosted`

Diese Datei enthält **Alles Geheimnisse** für Ihre Bereitstellung (Datenbank, Redis, JWT, Speicherverschlüsselung, MinIO-Anmeldeinformationen, falls verwendet usw.). **Sichern Sie es** an einen sicheren Ort (Passwort-Manager, verschlüsseltes Backup). Wenn Sie es verlieren, verlieren Sie möglicherweise die Möglichkeit, gespeicherte Anmeldeinformationen zu entschlüsseln oder dieselbe Bereitstellung zu rekonstruieren.

Übertragen Sie es nicht auf Git (es sollte von `.gitignore` ignoriert werden).

---

## Nach der Installation

### URLs

Das Installationsprogramm druckt die URLs. Im Allgemeinen:

- **Armaturenbrett:** `https://<your-base-domain>`
- **API:** `https://api.<your-base-domain>`
- **Aufnehmen:** `https://ingest.<your-base-domain>`

`www.<your-base-domain>` leitet zum Dashboard weiter.

### Überprüfen Sie den Stapel

```bash
./scripts/selfhosted/deploy.sh status
```

Sie sollten sehen, dass Container ausgeführt werden. Aus `api` und `ingest-upload` sollte nach kurzer Zeit **gesund** werden.

### Erster Login und Testaufzeichnung

1. Öffnen Sie das Dashboard in einem Browser.
2. Erstellen Sie ein Konto und ein Projekt.
3. Konfigurieren Sie den Rejourney SDK Ihrer App mit Ihrem **API URL** (siehe [SDK-Konfiguration](#configuring-your-mobile-app) unten).
4. Zeichnen Sie eine kurze Sitzung auf und bestätigen Sie, dass sie in der Wiedergabe angezeigt wird.

Wenn Sitzungen nie in Replay angezeigt werden, lesen Sie [Fehlerbehebung](/docs/selfhosted/troubleshooting) (Relay hochladen und Worker-Protokolle aufnehmen).

---

## Tägliche Abläufe

Alle diese laufen vom Repo-Root aus.

| Aktion | Befehl |
|--------|---------|
| Servicestatus | `./scripts/selfhosted/deploy.sh status` |
| Alle Protokolle verfolgen | `./scripts/selfhosted/deploy.sh logs` |
| Protokolle für einen Dienst | `./scripts/selfhosted/deploy.sh logs api` (ersetzen Sie `api` durch `web`, `ingest-upload`, `ingest-worker` usw.) |
| **Upgrade**-Images und Bootstrap erneut ausführen | `./scripts/selfhosted/deploy.sh update` |
| Stoppen Sie alles **ohne**, indem Sie Daten löschen | `./scripts/selfhosted/deploy.sh stop` |
| **Zurücksetzen** Container und Volumes (destruktiv) | `./scripts/selfhosted/deploy.sh reset` |

**`update`** ruft neuere Images ab (sofern zutreffend), erstellt das Bootstrap-Image von Ihrem aktuellen Klon neu, startet den Stapel neu und führt Bootstrap erneut aus, damit das Datenbankschema und die Speichereinstellungen mit Ihrem `.env.selfhosted` übereinstimmen. Es löscht **nicht** Postgres oder Objektspeichervolumes.

Vor dem Bootstrap validieren sowohl `install` als auch `update` die Datenbankkonnektivität mit den konfigurierten Anmeldeinformationen. Wenn die Anmeldeinformationen nicht mit den persistenten Postgres-Daten übereinstimmen, wird die Bereitstellung frühzeitig mit Anleitung zur Wiederherstellung gestoppt, anstatt später im Bootstrap fehlzuschlagen.

**`stop`** stoppt nur Container; Docker **Bände** (Postgres-Daten, MinIO-Daten usw.) bleiben erhalten, bis Sie sie explizit entfernen.

**`reset`** entfernt die selbstgehosteten Container und Docker-Volumes (`pgdata`, `redisdata`, `miniodata`, `traefik-certs`) nach einer Bestätigungsaufforderung. Außerdem werden MinIO-Profilcontainer gelöscht, selbst wenn `.env.selfhosted` fehlt, sodass veraltete MinIO-Daten die nächste Installation nicht blockieren. Verwenden Sie dies nur, wenn Sie eine völlig neue Installation wünschen.

---

## Speicher: MinIO vs. extern S3

### Eingebaut MinIO (Standard)

- Am einfachsten für einen einzelnen Server: Der Objektspeicher läuft unter **innen Docker** und ist standardmäßig nicht dem öffentlichen Internet zugänglich.
- Sitzungsbytes werden vom **Ingest-Upload**-Dienst geschrieben; Geräte müssen MinIO nicht direkt erreichen.
- Die Bucket-Erstellung erfolgt während der Installation.

### Externer S3-compatible-Speicher

Verwenden Sie AWS S3, Cloudflare R2, Hetzner Object Storage, Wasabi oder ein anderes S3-compatible API. Während der Installation geben Sie Endpunkt-URL, Bucket, Region und Zugriffsschlüssel an.

Beispiele für Endpunkt-URL-Stile (maßgebend sind die Dokumente Ihres Anbieters):

- AWS: `https://s3.<region>.amazonaws.com`
- Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`
- Hetzner: `https://<location>.your-objectstorage.com`

Wenn Sie einen **separate öffentliche URL** für Downloads hinzufügen, legen Sie `S3_PUBLIC_ENDPOINT` in `.env.selfhosted` fest und führen Sie `./scripts/selfhosted/deploy.sh update` aus.

---

## Wichtige Konfiguration (`.env.selfhosted`)

Das Installationsprogramm generiert diese Datei. Typische Variablen sind:

- **Domänen und öffentliche URLs:** `BASE_DOMAIN`, `DASHBOARD_DOMAIN`, `API_DOMAIN`, `INGEST_DOMAIN`, `PUBLIC_*_URL`
- **Datenbank:** `DATABASE_URL` (zeigt auf den `postgres`-Dienst innerhalb von Compose)
- **Redis:** `REDIS_URL`
- **Lagerung:** `STORAGE_BACKEND`, `S3_*` und optional `MINIO_*`
- **Sicherheit:** `JWT_SECRET`, `JWT_SIGNING_KEY`, `INGEST_HMAC_SECRET`, `STORAGE_ENCRYPTION_KEY`

Optionale Integrationen (bei Nichtverwendung leer lassen): Stripe, SMTP, GitHub OAuth, Turnstile usw.

**Speicher- oder domänenbezogene Werte ändern:** `.env.selfhosted` bearbeiten und dann ausführen:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## So funktioniert die Datenbankeinrichtung (erster Start vs. spätere Updates)

Normalerweise müssen Sie SQL manuell ausführen. Der Container **Bootstrap** übernimmt dies.

- **Brandneue leere Datenbank:** Der Stack wendet das aktuelle Schema aus dem Code an und zeichnet dann auf, welche Migrationsversionen bereits erfüllt sind, sodass zukünftige Updates nur **neu**-Migrationen anwenden.
- Es werden nur **Vorhandene Datenbank (bereits initialisiert):**-Migrationen angewendet. Ihre Daten werden nicht bei jedem `update` von Grund auf neu erstellt.
- Wenn die Datenbank **hat bereits Tische**, aber die Migrationsverlaufstabelle **fehlt oder ist leer** ist (z. B. eine teilweise Wiederherstellung), führen Sie einen Bootstrap von **stoppt mit einem Fehler** durch, um versehentliche Schäden zu vermeiden. Erweiterte Wiederherstellungsoptionen sind unter [Fehlerbehebung](/docs/selfhosted/troubleshooting) dokumentiert.

---

## Apple Silicon- und ARM-Server

Auf **ARM64**-Maschinen (viele Macs, einige Cloud-Instanzen) legt das Bereitstellungsskript `DOCKER_DEFAULT_PLATFORM=linux/amd64` für Image-Pulls fest, wenn Sie es nicht selbst festgelegt haben, sodass vorgefertigte Images, die nur `amd64` veröffentlichen, weiterhin ausgeführt werden. Wenn Sie ein anderes Verhalten benötigen, legen Sie `DOCKER_DEFAULT_PLATFORM` in Ihrer Umgebung fest, bevor Sie das Skript ausführen.

Das **Bootstrap**-Image ist immer **auf Ihrer Maschine aufgebaut** aus dem geklonten Repository, sodass es immer mit Ihrem Checkout übereinstimmt.

---

## Was läuft in Docker (Übersicht)

- **Traefik:** HTTPS Zertifikate und Weiterleitung an das Dashboard, API und Aufnahme-Hostnamen.
- **Postgres / Redis:** Anwendungsdaten und Warteschlangen.
- **MinIO:** Optionaler interner Objektspeicher.
- **API:** Haupt-HTTP API.
- **Aufnahme-Upload:** Dedizierter Dienst für Upload-Relay-Verkehr.
- **Internet:** Statische Dashboard-Benutzeroberfläche.
- **Arbeiter:** Verarbeiten Sie Aufnahmewarteschlangen, Wiedergabeartefakte, Sitzungslebenszyklus, geplante Arbeiten im Aufbewahrungsstil und Warnungen.

In diesem Stapel gibt es einen separaten Abrechnungs-Batch-Worker **NEIN**. Die Abrechnungsintegration wird durch Stripe und API gesteuert, wenn Sie Schlüssel konfigurieren.

---

## Konfigurieren Sie Ihre mobile App

Richten Sie den SDK auf den **dein** API-Host (muss mit `API_DOMAIN` / `PUBLIC_API_URL` übereinstimmen).

### Beispiel React Native

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

Verwenden Sie Ihre echte API-URL. Upload-URLs werden für `ingest.<your-domain>` automatisch abgeleitet, wenn der Server korrekt konfiguriert ist.

---

## Backups

Sichern Sie mindestens **PostgreSQL**, **`.env.selfhosted`** und (wenn Sie das integrierte MinIO verwenden) **Objektspeicherdaten**.

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Details: [Sicherung und Wiederherstellung](/docs/selfhosted/backup-recovery).

---

## Fehlerbehebung und Support

- [Fehlerbehebung](/docs/selfhosted/troubleshooting) – Bootstrap-Fehler, TLS, leeres Replay, externe S3-Probleme.
- [Sicherung und Wiederherstellung](/docs/selfhosted/backup-recovery) – Wiederherstellungsreihenfolge und MinIO.

Für Fehler oder Verbesserungen an diesen Dokumenten verwenden Sie den öffentlichen Issue-Tracker des Projekts unter GitHub.

---

## Zugehörige Dokumentation

- [Verteilte vs. Single-Node-Cloud](/docs/distributed-vs-single-node/distributed-vs-single-node) – Vergleich mit einem Multi-Service-Cloud-Layout (konzeptionell).
