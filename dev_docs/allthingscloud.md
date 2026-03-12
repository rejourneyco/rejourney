
Deployment:
┌──────────────┐      ┌─────────────────────────────┐      ┌─────────────────┐
│  GitHub Repo │─────▶│      GitHub Actions         │─────▶│      GHCR       │
│ (rejourney)  │      │   (Force Deploy VPS)        │      │ (Docker Images) │
└──────────────┘      └──────────────┬──────────────┘      └────────┬────────┘
                                     │                              │
                                     │ 2) kubectl apply             │ 3) Pull
                                     │    manifests                 │    Images
                                     ▼                              ▼
                      ┌────────────────────────────────────────────────────┐
                      │             Hetzner VPS Cluster (k3s)              │
                      │                namespace: rejourney                │
                      └────────────────────────────────────────────────────┘





K3s Details:

┌──────────────────────────────────────────────────────────────────────────────┐
│                           Kubernetes Cluster (k3s)                           │
│                                                                              │
│  ┌────────────────────────┐          ┌────────────────────────────────────┐  │
│  │      Networking        │          │            Entrypoints             │  │
│  │ ┌──────────────────┐   │          │  ┌──────────┐        ┌──────────┐  │  │
│  │ │ Traefik Ingress  │◀──┼──────────┼──┤  Web UI  │        │   API    │  │  │
│  │ └─────────┬────────┘   │          │  │  (Node)  │        │ Backend  │  │  │
│  └───────────┼────────────┘          │  └──────────┘        └────┬─────┘  │  │
│              │                       └───────────────────────────┼────────┘  │
│              │                                                   │           │
│  ┌───────────▼────────────┐          ┌───────────────────────────▼────────┐  │
│  │      Monitoring        │          │           Storage Layer            │  │
│  │ ┌──────────────────┐   │          │  ┌──────────┐        ┌──────────┐  │  │
│  │ │     Netdata      │   │          │  │ Postgres │        │  Redis   │  │  │
│  │ └──────────────────┘   │          │  │ (PVC 20G)│        │ (In-Mem) │  │  │
│  └────────────────────────┘          │  └──────────┘        └──────────┘  │  │
│                                      └────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                           Async Workers                                │  │
│  │  ┌──────────┐      ┌──────────┐      ┌──────────┐      ┌──────────┐    │  │
│  │  │ Ingest   │      │ Alert    │      │ Retention│      │ Billing  │    │  │
│  │  └──────────┘      └──────────┘      └──────────┘      └──────────┘    │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘



External Beyond:

                        ┌────────────────────────┐
                        │       Cloudflare       │
                        │     (DNS / SSL / Auth)│
                        └────────────┬───────────┘
                                     │
                        ┌────────────▼───────────┐
                        │     Traefik (k8s)      │
                        └────────────┬───────────┘
                                     │
              ┌──────────────────────┴───────────────────────┐
              │                                              │
      ┌───────▼────────┐                             ┌───────▼────────┐
      │     Web UI     │                             │   API Backend  │
      └────────────────┘                             └───────┬────────┘
                                                             │
        ┌─────────────────┬─────────────────┬────────────────┴──────────┐
        │                 │                 │                           │
┌───────▼───────┐ ┌───────▼───────┐ ┌───────▼────────┐        ┌─────────▼────────┐
│   Postgres    │ │     Redis     │ │  Hetzner S3   │        │   External APIs   │
│ (Main Data)   │ │ (Cache/Queue) │ │ (Recordings)  │        │  (Stripe / SMTP)  │
└───────────────┘ └──────────────┘ └────────────────┘        └────────────────────┘


Session Backup Deployment Notes:

- The session backup CronJob is deployed from [archive.yaml](/Users/mora/Desktop/Dev-mac/rejourney/k8s/archive.yaml).
- The source-of-truth script for that job is [session-backup.mjs](/Users/mora/Desktop/Dev-mac/rejourney/scripts/k8s/session-backup.mjs), and GitHub Actions now runs [check-archive-sync.sh](/Users/mora/Desktop/Dev-mac/rejourney/scripts/k8s/check-archive-sync.sh) before `kubectl apply`.
- A deploy from `main` now updates the backup job logic, including legacy hierarchy gzip repair and archive-friendly screenshot repacking for R2.
- The live CronJob can be suspended during reset, but the committed manifest controls whether it resumes after the next deploy.
