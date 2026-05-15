# Verteilte vs. Single-Node-Cloud

Rejourney unterstützt zwei offizielle selbstgehostete Bereitstellungsformen:

- **Einzelknoten Docker Compose** für einen Server oder VPS
- **Verteilt K3s** für Produktionscluster und horizontale Skalierung

Beide verwenden jetzt dasselbe Kern-Backend-Modell:

- Speicherendpunkte sind datenbankgestützt
- Aufnahme-Uploads durchlaufen das Backend-eigene Upload-Relay
- Arbeiter verarbeiten verifizierte Artefakte
- Die Wiedergabesichtbarkeit ist artefaktgesteuert

---

## Funktionsvergleich

| Funktion | Verteilte Cloud | Single-Node-Cloud |
|---------|--------------------|-------------------|
| Plattform | K3s | Docker Compose |
| Maßstab | Mehrknoten | Einzelknoten |
| Öffentliche Einstiegspunkte | Traefik Eingang | Traefik Behälter |
| Upload-Pfad | API + Aufnahme-Upload-Dienst | API + Aufnahme-Upload-Dienst |
| Speicherquelle der Wahrheit | `storage_endpoints` Tabelle | `storage_endpoints` Tabelle |
| Standardobjektspeicher | Extern S3 | Eingebaut MinIO |
| Externe S3-Unterstützung | Ja | Ja |
| Geheime Verschlüsselung | `STORAGE_ENCRYPTION_KEY` | `STORAGE_ENCRYPTION_KEY` |
| Aktualisierungsablauf | k8s Bereitstellung + Jobs | `deploy.sh update` |

---

## Shared-Storage-Modell

In beiden Bereitstellungsmodellen stammt die Laufzeitspeicherkonfiguration von Postgres und nicht von einem Umgebungs-Fallback.

Das bedeutet:

- Der aktive Objektspeicherendpunkt wird in `storage_endpoints` gespeichert
- Geheime Zugriffsschlüssel werden in `key_ref` verschlüsselt
- Die Laufzeit liest die Datenbankzeile
- Bootstrap-/Installationsskripte sind für die Synchronisierung der `.env`-Eingabe in die Datenbankzeile verantwortlich

Dadurch ist das selbstgehostete Docker viel näher an prod und local-k8s als das alte Fallback-Modell.

---

## Wann sollte man sich für Single-Node Docker Compose entscheiden?

Wählen Sie Docker Compose, wenn:

- Sie stellen es auf einem VPS oder Bare-Metal-Host bereit
- Sie möchten den schnellsten Installationspfad
- Sie möchten standardmäßig MinIO integrieren
- Sie benötigen keine Multi-Node-Skalierung oder Kubernetes-Operationen

Offizielle Einstiegspunkte:

- `docker-compose.selfhosted.yml`
- `scripts/selfhosted/deploy.sh`
- `docs/selfhosted/README.md`

---

## Wann sollte man sich für „Distributed“ entscheiden? K3s

Wählen Sie K3s, wenn:

- Sie benötigen mehrere Knoten
- Sie möchten Kubernetes-native Operationen und den Umgang mit Geheimnissen
- Sie möchten API, Upload- und Worker-Dienste unabhängig voneinander skalieren
- Sie wünschen sich fortlaufende Bereitstellungen und eine stärkere Infrastrukturisolierung

Der Pfad K3s befindet sich unter `k8s/` und `scripts/k8s/`.

---

## Betriebsunterschied

Der Hauptunterschied besteht nicht mehr im Datenmodell. Es handelt sich um eine Betriebsform:

- Compose: eine Maschine, ein Docker Netzwerk, ein Bedienerskript
- K3s: mehrere Pods, Namespaces, Cluster-Ingress, Kubernetes-Jobs und Geheimnisse

---

## Praktische Anleitung

Beginnen Sie mit dem Einzelknoten Compose, wenn Sie schnell selbst hosten möchten.

Wechseln Sie zu K3s, wenn Sie Folgendes benötigen:

- mehr Durchsatz
- Rolling-Cluster-Bereitstellungen
- horizontale Skalierung
- robustere Infrastrukturtrennung

---

## Interne Architekturdokumente

Für die neuesten internen technischen Bilder und detailliertere Bedienerdetails:

- `dev_docs/ingest-session-recording-lifecycle.md` (Sitzungslebenszyklusdiagramm)
- `dev_docs/storage-and-endpoints.md` (Multi-Bucket-Topologiediagramm)
- `dev_docs/allthingscloud.md` (k3s-Cloud-Setup-Diagramm)

Für eine reine Grafikarchitekturseite öffnen Sie [`/docs/architecture/diagrams`](/docs/architecture/diagrams).
