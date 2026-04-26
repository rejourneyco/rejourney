# All Things Cloud

Last updated: 2026-04-26

This is the operator-facing map of production: network path, deploy flow, storage layout, monitoring, backups, HA failover, and the runtime services we actually have today.

## Tailscale, public traffic, and admin access

**Public path:** Internet → **Cloudflare** (DNS / TLS / WAF) → **Hetzner Load Balancer** (FSN1, round-robin, private-IP backend) → **Traefik** (2 replicas: fsn1 + worker-1) → `rejourney.co`, `api.rejourney.co`, `ingest.rejourney.co`

**Admin path:** Operators join the **Tailscale tailnet** and use **SSH**, **kubectl**, and **kubectl port-forward** over `100.x` addresses. Admin UIs (Grafana, Traefik dashboard, Drizzle Studio) are not public.

**Important boundary:** Tailscale protects operator access to the node and cluster. It is not in the normal in-cluster service path. Internal traffic such as `Grafana → VictoriaMetrics` or `postgres-exporter → postgres-app-rw` stays on Kubernetes service networking.

![K3s cloud setup diagram](./assets/diagrams/k3s-cloud-setup.svg)

Related docs:

- [admin-tools-private-access.md](./admin-tools-private-access.md)
- [rejourney-ci.md](./rejourney-ci.md)
- [legacy.md](./legacy.md)
- [postgres-backup-and-restore.md](./postgres-backup-and-restore.md)
- sibling repo `rejourney-internal/dev_docs/`

## Architecture

```mermaid
graph TD
    subgraph Internet
        CF[Cloudflare DNS/TLS/WAF]
    end
    subgraph Hetzner["Hetzner eu-central (FSN1 + HEL1)"]
        LB[Hetzner Load Balancer\nFSN1 · round-robin · private-IP]
        subgraph fsn1["fsn1 — CPX42 · 12 vCPU / 24 GB\nControl plane + primary data"]
            TR0[Traefik replica-0]
            API0[api ×4-6 · HPA]
            UPLOAD0[ingest-upload ×1-2 · HPA]
            WEB0[web ×2]
            PG1[postgres-local-1\nCNPG primary]
            RD0["redis-node-0\nmaster + sentinel-0"]
            PGB0[pgbouncer replica-0]
            SLC[session-lifecycle-worker ×1]
            MON[victoria-metrics\ngrafana · gatus\npushgateway]
        end
        subgraph worker1["worker-1 — CX43 · 8 vCPU / 16 GB\nHEL1 · workload=worker"]
            TR1[Traefik replica-1]
            IW1[ingest-worker ×5-6 · HPA]
            RW1[replay-worker ×1-6 · HPA]
            AW1[alert-worker ×1]
            PG2[postgres-local-2\nCNPG standby]
            PGB1[pgbouncer replica-1]
        end
        subgraph quorum1["quorum-1 — CX43 · 8 vCPU / 16 GB\nHEL1 · workload=worker · overflow"]
            RD1["redis-node-1\nreplica + sentinel-1"]
            PGB2[pgbouncer replica-2]
            OVF[overflow pods\napi · workers]
            ETCD[etcd quorum voter]
        end
        NET[(Hetzner Private Network\n10.0.0.x · enp7s0\nFlannel VXLAN overlay)]
    end
    subgraph Storage["External Storage"]
        S3[Hetzner S3\nlive artifacts]
        R2[Cloudflare R2\nWAL backups\nsession backups]
    end

    CF --> LB
    LB --> TR0
    LB --> TR1
    TR0 --> API0
    TR0 --> WEB0
    TR0 --> UPLOAD0
    TR1 --> IW1
    TR1 --> RW1
    API0 --> PGB0
    IW1 --> PGB1
    RW1 --> PGB1
    AW1 --> PGB1
    OVF --> PGB2
    SLC --> PGB0
    PGB0 --> PG1
    PGB1 --> PG1
    PGB2 --> PG1
    PG1 -- "WAL stream\n(sync replication)" --> PG2
    PG1 -- "WAL archive\n(gzip to R2)" --> R2
    API0 --> RD0
    IW1 --> RD0
    RW1 --> RD0
    RD0 -- "replication + sentinel" --> RD1
    fsn1 --- NET
    worker1 --- NET
    quorum1 --- NET
    API0 --> S3
    UPLOAD0 --> S3
    IW1 --> S3
    RW1 --> S3
```

