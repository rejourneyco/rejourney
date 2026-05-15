# Selbstgehostete Fehlerbehebung

Verwenden Sie diese Seite, wenn Sie [Self-hosted Rejourney](/docs/selfhosted) befolgt haben und etwas fehlschlägt oder sich seltsam verhält. Befehle werden vom **Repository-Stammverzeichnis** ausgeführt (wo sich `docker-compose.selfhosted.yml` befindet).

---

## Schnelle Kontrollen

### Servicestatus

```bash
./scripts/selfhosted/deploy.sh status
```

### API-Protokolle

```bash
./scripts/selfhosted/deploy.sh logs api
```

### Relay-Protokolle hochladen

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### Arbeiterprotokolle

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. Die Installation oder Aktualisierung schlägt vor oder während des Bootstrap fehl

### Symptome

- `bootstrap` wird mit einem Wert ungleich Null beendet
- App-Dienste werden nie gesund
- `status` zeigt API oder Arbeiter an, die auf den Bootstrap warten
- Installations- oder Update-Exits mit `Database authentication failed before bootstrap.`

### Schecks

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

Häufige Ursachen:

- schlecht `DATABASE_URL`
- Nicht übereinstimmende Anmeldeinformationen (z. B. von einer früheren fehlgeschlagenen Bereitstellung)
- fehlt `STORAGE_ENCRYPTION_KEY`
- Ungültige S3-Anmeldeinformationen
- Defekte externe S3-Endpunkt-URL
- auf **ARM64** fehlt die Bildunterstützung (stellen Sie `DOCKER_DEFAULT_PLATFORM=linux/amd64` ein oder verwenden Sie `./scripts/selfhosted/deploy.sh`, wodurch es festgelegt wird, wenn es nicht festgelegt ist).

Erholung:

1. Wenn Sie noch das Original `.env.selfhosted` haben, stellen Sie es wieder her und führen Sie Folgendes aus:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Wenn Sie die alten Daten nicht benötigen, löschen Sie sie und installieren Sie sie neu:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**Schema-/Migrationsmeldungen:** Bei einer normalen Installation startet die Datenbank leer und Bootstrap richtet alles ein. Wenn Sie **Postgres aus einem Backup wiederhergestellt** auf einen neuen Server übertragen, aber Migrationsmetadaten fehlen, oder wenn Sie den Stack auf **falsche Datenbank** verweisen, wird der Bootstrap möglicherweise mit einem Fehler wegen einer inkonsistenten Datenbank beendet, anstatt Ihre Daten zu überschreiben. Sofern Sie keine erweiterte Wiederherstellung durchführen, beheben Sie `DATABASE_URL` und stellen Sie ein konsistentes Backup wieder her oder starten Sie von einem sauberen Volume. Für eine absichtliche Nur-Migration-Wiederherstellung verwenden einige Setups `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` in `.env.selfhosted` (siehe Betreuerdokumentation oder Support, bevor Sie dies verwenden).

### Fix

1. Wenn Sie über das Original `.env.selfhosted` verfügen, stellen Sie es wieder her und führen Sie es erneut aus:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Wenn Sie nicht über das Original `.env.selfhosted` verfügen, löschen Sie es und installieren Sie es erneut:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update` führt Schema, Seed und Speicher-Endpunkt-Synchronisierung erneut aus. `reset` entfernt selbstgehostete Container und Datenvolumes, sodass bei einer Neuinstallation sicher neue Anmeldeinformationen generiert werden können.

---

## 2. Sitzungen werden gezählt, aber Replay bleibt leer

### Was das jetzt normalerweise bedeutet

Bei der aktuellen Architektur ist dies normalerweise eines von zwei Dingen:

- `ingest-upload` konnte die Artefaktbytes nicht speichern
- `ingest-worker` konnte ein hochgeladenes Artefakt nicht verarbeiten

Das Gerät lädt nicht mehr direkt auf MinIO/S3 hoch, sodass die Erreichbarkeit des Buckets vom Telefon aus nicht mehr der Hauptverdächtige ist.

### Schecks

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

Suchen:

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### Häufige Ursachen

- Falsche S3-Anmeldeinformationen in `.env.selfhosted`
- Externer S3-Bucket fehlt
- Externer S3-Endpunkt vom Docker-Netzwerk aus nicht erreichbar
- Upload-Relay fehlerhaft
- Der Arbeiter blieb beim erneuten Versuch fehlgeschlagener Artefakte hängen

### Fix

- Überprüfen Sie die `S3_*`-Werte
- Wenn Sie die Speicherkonfiguration geändert haben, führen Sie Folgendes erneut aus:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. Das Dashboard wird geladen, aber Authentifizierungs- oder API-Aufrufe schlagen fehl

### Schecks

- Der Dashboard-Host DNS verweist auf den Server
- API-Host DNS zeigt auf den Server
- Der Aufnahmehost DNS verweist auf den Server
- Die Ports `80` und `443` sind geöffnet
- Let’s Encrypt hat Zertifikate ausgestellt

Überprüfen:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS oder Zertifikatsprobleme

Traefik verwaltet Zertifikate automatisch.

### Schecks

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

Stellen Sie sicher, dass beide Namen auf den Server aufgelöst werden, auf dem der Stack ausgeführt wird.

Wenn DNS bei der ersten Installation falsch war, korrigieren Sie DNS und führen Sie es erneut aus:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. Das externe S3 funktioniert in der CLI, aber Rejourney kann nicht hochgeladen werden

Denken Sie daran, dass der Upload-Pfad serverseitig ist.

Der wichtige Netzwerkpfad ist:

- `ingest-upload`-Container -> Ihr S3-Endpunkt

Testen Sie vom Server aus, indem Sie Relay-Protokolle überprüfen und den Endpunkt/Bucket/Schlüssel in `.env.selfhosted` bestätigen.

Wenn Sie sie geändert haben, führen Sie Folgendes erneut aus:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. Integrierte MinIO-Installation, aber Artefakte schlagen immer noch fehl

### Schecks

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

Der One-Shot `minio-setup` sollte den Bucket mit dem Namen `S3_BUCKET` erstellen.

Wenn Sie den Bucket-Namen nach der ersten Installation geändert haben, führen Sie Folgendes aus:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. Auf den Abrechnungsseiten wird die deaktivierte Abrechnung angezeigt

Dies wird erwartet, es sei denn, die Schlüssel Stripe sind konfiguriert.

Der Stack deaktiviert die Abrechnung nicht mehr, da er „selbst gehostet“ ist. Die Abrechnung wird deaktiviert, da Stripe nicht konfiguriert ist.

Wenn Sie keine Stripe-Schlüssel festlegen:

- Die Abrechnungs-Benutzeroberfläche bleibt im Status „Selbst gehostet/unbegrenzt“.
- Stripe Checkout und Webhooks bleiben deaktiviert

---

## 8. Der Speicherendpunkt in Postgres ist nach der Änderung von `.env.selfhosted` falsch

Laufen:

```bash
./scripts/selfhosted/deploy.sh update
```

Der Aktualisierungspfad führt Bootstrap erneut aus und synchronisiert die aktive Zeile `storage_endpoints` erneut.

---

## 9. Dienste müssen gestoppt werden, ohne dass Daten verloren gehen

Verwenden:

```bash
./scripts/selfhosted/deploy.sh stop
```

Dadurch werden nur Container gestoppt. Es werden keine Volumes entfernt.

---

## 10. Benötigen Sie tiefere Protokolle für einen Dienst

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
