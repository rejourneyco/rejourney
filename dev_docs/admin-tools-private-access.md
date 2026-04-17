# Admin tools without public URLs (Tailscale + kubectl)

Public Ingress for **pgweb**, **Redis Commander**, and all monitoring tools is **removed from Git**. Customer Ingress (`rejourney.co`, `api.`, `ingest.`) is unchanged.

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
| Redis Commander | `kubectl -n rejourney port-forward svc/redis-commander 8082:8081` | http://127.0.0.1:8082 | Redis admin UI |

## Monitoring gotchas

- **Grafana/Gatus red public health checks do not always mean the app is down.** Cloudflare managed challenge can return `403` to automated public HTTP probes even while the service is healthy.
- Prefer **internal service URLs** for Gatus app-health checks:
  - `http://api.rejourney.svc.cluster.local:3000/health/ready`
  - `http://api.rejourney.svc.cluster.local:3000/health/live`
  - `http://api.rejourney.svc.cluster.local:3000/health/ingest`
  - `http://web.rejourney.svc.cluster.local`
- Keep **TLS checks** on the public hostnames because those validate the public edge certs served through Cloudflare.
- **Kubernetes dashboards imported from Grafana.com often assume a `cluster` label.** If the dashboard variables are empty or show `N/A`, verify VictoriaMetrics is attaching a static cluster label during scrape.
- **Imported Grafana dashboards also often assume a datasource literally named `Prometheus`.** The cluster now provisions a compatibility datasource alias that points at VictoriaMetrics so those imports keep working.
- **Real pod/container CPU and RAM usage comes from cAdvisor, not kube-state-metrics or postgres-exporter.** If a dashboard shows object state but no live resource usage, verify the `cadvisor` DaemonSet is healthy and VictoriaMetrics is scraping it.
- **PostgreSQL dashboards can show mostly `N/A` if `postgres-exporter` cannot connect.** One common failure mode on this cluster is exporter logs showing `pq: SSL is not enabled on the server`; in that case the exporter needs internal non-SSL mode (`PGSSLMODE=disable`) unless Postgres is explicitly configured for SSL.
- **Best-practice hardening for postgres-exporter:** use a dedicated `postgres-exporter-secret` backed by a read-only `monitoring` DB user with `pg_monitor`, instead of reusing the main app `DATABASE_URL`.

## Grafana setup (first login)

1. Get the admin password: `kubectl get secret grafana-secret -n rejourney -o jsonpath='{.data.admin-password}' | base64 -d`
2. Login at http://127.0.0.1:3000 with user `admin`
3. Import dashboards via **Dashboards → Import**:

| Dashboard | ID | Covers |
|---|---|---|
| Node Exporter Full | `1860` | CPU, RAM, disk, network |
| Kubernetes Cluster | `13332` | Pod/deployment health, resource usage |
| PostgreSQL | `9628` | Connections, query stats, table sizes |
| Traefik | `17346` | Requests/s, latency, error rate per route |
| VictoriaMetrics | `10229` | VM internal health |

## Restart workloads after env change

```bash
kubectl -n rejourney rollout restart deployment api ingest-worker replay-worker session-lifecycle-worker alert-worker
```

## Apply manifests

```bash
kubectl apply -f k8s/monitoring.yaml
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

- [network-exposure-and-tailscale.md](./network-exposure-and-tailscale.md)
- [rejourney-ci.md](./rejourney-ci.md)
