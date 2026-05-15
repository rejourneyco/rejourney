# Gedistribueerde versus cloud met één knooppunt

Rejourney ondersteunt twee officiële, zelf-gehoste implementatievormen:

- **Docker Compose met één knooppunt** voor één server of VPS
- **Gedistribueerd K3s** voor productieclusters en horizontale schaling

Beiden gebruiken nu hetzelfde kern-backend-model:

- opslageindpunten worden ondersteund door een database
- ingest-uploads gaan via de upload-relay van de backend
- werknemers verwerken geverifieerde artefacten
- De zichtbaarheid van herhalingen is artefactgestuurd

---

## Functievergelijking

| Kenmerk | Gedistribueerde cloud | Cloud met één knooppunt |
|---------|--------------------|-------------------|
| Platform | K3s | Docker Compose |
| Schaal | Meerdere knooppunten | Eén knooppunt |
| Openbare toegangspunten | Traefik binnenkomen | Traefik-container |
| Uploadpad | API + ingest-uploadservice | API + ingest-uploadservice |
| Opslagbron van waarheid | `storage_endpoints`-tabel | `storage_endpoints`-tabel |
| Standaard objectopslag | Extern S3 | Ingebouwde MinIO |
| Externe S3-ondersteuning | Ja | Ja |
| Geheime codering | `STORAGE_ENCRYPTION_KEY` | `STORAGE_ENCRYPTION_KEY` |
| Updatestroom | k8s implementeren + taken | `deploy.sh update` |

---

## Gedeeld opslagmodel

In beide implementatiemodellen is de runtime-opslagconfiguratie afkomstig van Postgres, en niet van een terugval in de omgeving.

Dat betekent:

- het actieve objectopslag-eindpunt wordt opgeslagen in `storage_endpoints`
- geheime toegangssleutels worden gecodeerd in `key_ref`
- runtime leest de databaserij
- bootstrap/install-scripts zijn verantwoordelijk voor het synchroniseren van `.env`-invoer in de databaserij

Dit maakt zelf-hostende Docker veel dichter bij prod en local-k8s dan het oude fallback-model.

---

## Wanneer moet u Docker Compose met één knooppunt kiezen?

Kies Docker Compose wanneer:

- u implementeert op één VPS of bare-metal host
- u het snelste installatiepad wilt
- u wilt standaard ingebouwde MinIO
- u hebt geen schaling van meerdere knooppunten of Kubernetes-bewerkingen nodig

Officiële toegangspunten:

- `docker-compose.selfhosted.yml`
- `scripts/selfhosted/deploy.sh`
- `docs/selfhosted/README.md`

---

## Wanneer kiest u voor gedistribueerde K3s

Kies K3s wanneer:

- je hebt meerdere knooppunten nodig
- je wilt Kubernetes-native operaties en geheime afhandeling
- u wilt de API-, upload- en worker-services onafhankelijk schalen
- je wilt rollende inzet en een sterkere infraroodisolatie

Het pad K3s bevindt zich onder `k8s/` en `scripts/k8s/`.

---

## Operationeel verschil

Het belangrijkste verschil is niet meer het datamodel. Het is operationele vorm:

- Compose: één machine, één Docker-netwerk, één operatorscript
- K3s: meerdere pods, naamruimten, clusteringang, Kubernetes-taken en geheimen

---

## Praktische begeleiding

Begin met Compose met één knooppunt als u snel zelf wilt hosten.

Ga naar K3s als u het volgende nodig heeft:

- meer doorvoer
- rollend cluster wordt ingezet
- horizontale schaalverdeling
- veerkrachtigere scheiding van infrastructuur

---

## Documenten over interne architectuur

Voor de nieuwste interne technische beelden en diepere details voor de machinist:

- `dev_docs/ingest-session-recording-lifecycle.md` (sessielevenscyclusdiagram)
- `dev_docs/storage-and-endpoints.md` (topologiediagram met meerdere buckets)
- `dev_docs/allthingscloud.md` (k3s cloud-installatiediagram)

Voor een architectuurpagina met alleen afbeeldingen opent u [`/docs/architecture/diagrams`](/docs/architecture/diagrams).
