# Admin tools without public URLs (Tailscale + kubectl)

Public Ingress for **pgweb** and all monitoring tools is **removed from Git**. Customer Ingress (`rejourney.co`, `api.`, `ingest.`) is unchanged.

Tailscale is only for **operator access** to the node and cluster. It protects your `ssh`, `kubectl`, and `kubectl port-forward` sessions to the VPS. It does **not** sit in front of normal in-cluster traffic such as `Grafana -> VictoriaMetrics` or `postgres-exporter -> postgres`.

## Cloudflare / DNS

Remove or **grey-cloud** (DNS only) these if they still exist:

- `db.rejourney.co`, `redis.rejourney.co`, `traefik.rejourney.co`, `k3s.rejourney.co`, `status.rejourney.co`

## Prerequisites

- Laptop on **Tailscale**, `kubectl` working (e.g. `server: https://<node-tailscale-ip>:6443`).

## Port-forward table (run on your Mac)

| Tool | Command | Open | Purpose |
| ---- | ------- | ---- | ------- |
| **Grafana** | `kubectl -n rejourney port-forward svc/grafana 3000:3000` | http://127.0.0.1:3000 | Unified dashboards: system, K8s, Postgres, Traefik, workers |
| **Gatus** | `kubectl -n rejourney port-forward svc/gatus 8090:8080` | http://127.0.0.1:8090 | HTTP + TLS endpoint health checks |
| **VictoriaMetrics** | `kubectl -n rejourney port-forward svc/victoria-metrics 8428:8428` | http://127.0.0.1:8428 | Raw PromQL query UI |
| **Pushgateway** | `kubectl -n rejourney port-forward svc/pushgateway 9091:9091` | http://127.0.0.1:9091 | Inspect worker heartbeat metrics |
| pgweb | `kubectl -n rejourney port-forward svc/pgweb 8081:8081` | http://127.0.0.1:8081 | PostgreSQL admin UI |

## Monitoring gotchas

- **Grafana/Gatus red public health checks do not always mean the app is down.** Cloudflare managed challenge can return `403` to automated public HTTP probes even while the service is healthy.
- Prefer **internal service URLs** for Gatus app-health checks:
  - `http://api-ingest.rejourney.svc.cluster.local:3000/health/ready`
  - `http://api-ingest.rejourney.svc.cluster.local:3000/health/live`
  - `http://api-ingest.rejourney.svc.cluster.local:3000/health/ingest`
  - `http://api-dashboard.rejourney.svc.cluster.local:3000/health/ready`
  - `http://web.rejourney.svc.cluster.local`
- Keep **TLS checks** on the public hostnames because those validate the public edge certs served through Cloudflare.
- **Kubernetes dashboards imported from Grafana.com often assume a `cluster` label.** If the dashboard variables are empty or show `N/A`, verify VictoriaMetrics is attaching a static cluster label during scrape.
- **Imported Grafana dashboards also often assume a datasource literally named `Prometheus`.** The cluster now provisions a compatibility datasource alias that points at VictoriaMetrics so those imports keep working.
- **Real pod/container CPU and RAM usage comes from cAdvisor, not kube-state-metrics or postgres-exporter.** If a dashboard shows object state but no live resource usage, verify the `cadvisor` DaemonSet is healthy and VictoriaMetrics is scraping it.
- **PostgreSQL dashboards can show mostly `N/A` if `postgres-exporter` cannot connect.** One common failure mode on this cluster is exporter logs showing `pq: SSL is not enabled on the server`; in that case the exporter needs internal non-SSL mode (`PGSSLMODE=disable`) unless Postgres is explicitly configured for SSL.
- **Best-practice hardening for postgres-exporter:** use a dedicated `postgres-exporter-secret` backed by a read-only `monitoring` DB user with `pg_monitor`, instead of reusing the main app `DATABASE_URL`.
- **Artifact backlog incidents:** open Grafana `55 — Artifact Ingest Diagnosis` first. `rj-ingest-artifacts` waiting should fall after the backend rollup deploy; if it falls while `rj-session-event-rollup` rises, tune rollup concurrency/batch size rather than adding ingest pods.

## Grafana setup (first login)

1. Get the admin password: `kubectl get secret grafana-secret -n rejourney -o jsonpath='{.data.admin-password}' | base64 -d`
2. Login at http://127.0.0.1:3000 with user `admin`
3. Rejourney dashboards are provisioned automatically from `k8s/grafana-dashboards.yaml`; imported community dashboards are temporary and cleaned up on deploy.

## Restart workloads after env change

```bash
kubectl -n rejourney rollout restart deployment api-ingest api-dashboard ingest-upload ingest-worker replay-worker session-lifecycle-worker alert-worker web
```

## Apply manifests

No monitoring Secret manifest is checked in. To enable the protected API debug-health endpoint, set `MONITORING_DEBUG_TOKEN` in the private production env file (generate it with `openssl rand -hex 32`) and run `bash scripts/k8s/k8s-sync-secrets.sh prod .env`. If it is not configured, `/health/debug` returns `403` for every caller.

```bash
kubectl apply -f k8s/victoria-metrics.yaml
kubectl apply -f k8s/exporters.yaml
kubectl apply -f k8s/pushgateway.yaml
kubectl apply -f k8s/grafana.yaml
kubectl apply -f k8s/gatus.yaml
kubectl apply -f k8s/traefik-config.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/workers.yaml
kubectl apply -f k8s/api.yaml
```

## Manual cleanup after first deploy (one-time)

Remove the old NetData and Uptime Kuma resources that `--prune` can't clean up automatically:

```bash
# NetData (cluster-scoped, no part-of label — must delete manually)
kubectl delete clusterrole netdata --ignore-not-found
kubectl delete clusterrolebinding netdata --ignore-not-found
kubectl delete serviceaccount netdata -n rejourney --ignore-not-found

# Uptime Kuma PVC (PVCs are not in the prune allowlist)
kubectl delete pvc uptime-kuma-data -n rejourney --ignore-not-found
```

## GitHub Actions / `deploy-release.sh`

CI auto-cleans the legacy NetData cluster resources and waits for all new monitoring deployments (victoria-metrics, grafana, gatus, pushgateway), `kube-state-metrics`, `postgres-exporter`, and `node-exporter` as part of the normal deploy.

## SSL / cert-manager

Public certs for `rejourney.co`, `api.`, `ingest.` are **unchanged**. Admin certs stop renewing once their Ingresses are deleted — clean up orphaned Certificates if needed:

```bash
kubectl get certificate -n rejourney
kubectl get certificate -n kube-system
```

## Related

- [allthingscloud.md](./allthingscloud.md)
- [rejourney-ci.md](./rejourney-ci.md)
