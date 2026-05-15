# Cloud distribuito e cloud a nodo singolo

Rejourney supporta due forme di distribuzione self-hosted ufficiali:

- **Mononodo Docker Compose** per un server o VPS
- **Distribuito K3s** per cluster produttivi e ridimensionamento orizzontale

Entrambi ora utilizzano lo stesso modello di backend principale:

- gli endpoint di archiviazione sono supportati da database
- i caricamenti ingest passano attraverso il relè di caricamento di proprietà del backend
- i lavoratori elaborano gli artefatti verificati
- la visibilità della riproduzione è basata sugli artefatti

---

## Confronto delle funzionalità

| Caratteristica | Cloud distribuito | Cloud a nodo singolo |
|---------|--------------------|-------------------|
| Piattaforma | K3s | Docker Compose |
| Scala | Multinodo | Nodo singolo |
| Punti di accesso pubblici | Traefik ingresso | Traefik contenitore |
| Carica percorso | API + servizio di caricamento e acquisizione | API + servizio di caricamento e acquisizione |
| Fonte di archiviazione della verità | `storage_endpoints` tavolo | `storage_endpoints` tavolo |
| Archiviazione oggetti predefinita | Esterno S3 | MinIO integrato |
| Supporto esterno S3 | Sì | Sì |
| Crittografia segreta | `STORAGE_ENCRYPTION_KEY` | `STORAGE_ENCRYPTION_KEY` |
| Flusso di aggiornamento | k8s distribuzione + lavori | `deploy.sh update` |

---

## Modello di archiviazione condivisa

In entrambi i modelli di distribuzione, la configurazione dell'archiviazione di runtime proviene da Postgres, non da un fallback env.

Ciò significa:

- l'endpoint di archiviazione degli oggetti attivi è archiviato in `storage_endpoints`
- le chiavi di accesso segrete sono crittografate in `key_ref`
- il runtime legge la riga del database
- gli script di bootstrap/installazione sono responsabili della sincronizzazione dell'input `.env` nella riga del database

Ciò rende Docker self-hosted molto più vicino a prod e local-k8s rispetto al vecchio modello di fallback.

---

## Quando scegliere il nodo singolo Docker Compose

Scegli Docker Compose quando:

- stai distribuendo su un VPS o host bare metal
- desideri il percorso di installazione più veloce
- vuoi MinIO integrato per impostazione predefinita
- non è necessario il ridimensionamento multinodo o le operazioni Kubernetes

Punti di ingresso ufficiali:

- `docker-compose.selfhosted.yml`
- `scripts/selfhosted/deploy.sh`
- `docs/selfhosted/README.md`

---

## Quando scegliere K3s distribuito

Scegli K3s quando:

- hai bisogno di più nodi
- vuoi operazioni native Kubernetes e gestione dei segreti
- desideri ridimensionare API, caricamento e servizi di lavoro in modo indipendente
- vuoi implementazioni continue e un più forte isolamento infra

Il percorso K3s si trova sotto `k8s/` e `scripts/k8s/`.

---

## Differenza operativa

La differenza principale non è più il modello di dati. È una forma operativa:

- Compose: una macchina, una rete Docker, uno script operatore
- K3s: pod multipli, spazi dei nomi, ingresso cluster, lavori Kubernetes e segreti

---

## Guida pratica

Inizia con il nodo singolo Compose se desideri eseguire l'hosting autonomo rapidamente.

Passa a K3s quando hai bisogno di:

- maggiore produttività
- distribuzioni di cluster in sequenza
- ridimensionamento orizzontale
- separazione più resiliente delle infrastrutture

---

## Documenti di architettura interna

Per le più recenti immagini tecniche interne e dettagli più approfonditi sull'operatore:

- `dev_docs/ingest-session-recording-lifecycle.md` (diagramma del ciclo di vita della sessione)
- `dev_docs/storage-and-endpoints.md` (diagramma della topologia multi-bucket)
- `dev_docs/allthingscloud.md` (schema di configurazione del cloud k3s)

Per una pagina con architettura solo grafica, apri [`/docs/architecture/diagrams`](/docs/architecture/diagrams).
