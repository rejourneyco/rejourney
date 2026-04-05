# Admin tools without public URLs (Tailscale + kubectl)

Public Ingress for **pgweb**, **Redis Commander**, **Traefik dashboard**, **Netdata**, and **Uptime Kuma** is **removed from Git** (`k8s/admin-tools.yaml`, `k8s/ingress.yaml`, `k8s/netdata.yaml`, `k8s/monitoring.yaml`). Customer Ingress (`rejourney.co`, `api.`, `ingest.`) is unchanged.

## Cloudflare / DNS

Remove or **grey-cloud** (DNS only) these if they still exist:

- `db.rejourney.co`, `redis.rejourney.co`, `traefik.rejourney.co`, `k3s.rejourney.co`, `status.rejourney.co`

## Prerequisites

- Laptop on **Tailscale**, `kubectl` working (e.g. `server: https://<node-tailscale-ip>:6443`).

## Port-forward table (run on your Mac)

| Tool | Command | Open |
| ---- | ------- | ---- |
| pgweb | `kubectl -n rejourney port-forward svc/pgweb 8081:8081` | http://127.0.0.1:8081 |
| Redis Commander | `kubectl -n rejourney port-forward svc/redis-commander 8082:8081` | http://127.0.0.1:8082 |
| Uptime Kuma | `kubectl -n rejourney port-forward svc/uptime-kuma 3001:3001` | http://127.0.0.1:3001 |
| Netdata | `kubectl -n rejourney port-forward svc/netdata 19999:19999` | http://127.0.0.1:19999 |
| Traefik dashboard | `kubectl -n kube-system port-forward svc/traefik-dashboard 9000:9000` | http://127.0.0.1:9000/dashboard/ |

Scale Kuma if needed: `kubectl -n rejourney scale deployment uptime-kuma --replicas=1`

## Restart workloads after env URL change

```bash
kubectl -n rejourney rollout restart deployment api ingest-worker replay-worker session-lifecycle-worker alert-worker
```

## Apply + delete stale Ingress

```bash
kubectl apply -f k8s/admin-tools.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/netdata.yaml
kubectl apply -f k8s/monitoring.yaml
kubectl apply -f k8s/workers.yaml
kubectl apply -f k8s/api.yaml
```

```bash
kubectl delete ingress admin-ingress -n rejourney --ignore-not-found
kubectl delete ingress uptime-kuma-ingress -n rejourney --ignore-not-found
kubectl delete ingress netdata-ingress -n rejourney --ignore-not-found
kubectl delete ingress traefik-dashboard-ingress -n kube-system --ignore-not-found
```

## GitHub Actions / `deploy-release.sh` — is that enough?

On **`main`**, when **`package.json` version changes** (or manual `workflow_dispatch`), CI runs [`deploy-release.sh`](../scripts/k8s/deploy-release.sh), which:

1. **`kubectl apply -f k8s/… --prune -l app.kubernetes.io/part-of=rejourney`** — removes Ingresses (and other allowlisted kinds) that **used to** have that label in the cluster but are **no longer** in the rendered manifests. That covers **`admin-ingress`**, **`uptime-kuma-ingress`**, and **`netdata-ingress`** if they were labeled `part-of=rejourney`.
2. **Explicit delete** of **`traefik-dashboard-ingress`** in **`kube-system`** (that Ingress was never labeled `part-of`, so prune could not remove it).

So after you **grey-cloud** admin DNS in Cloudflare, a **successful version-bump deploy** should align the cluster with Git **without** you hand-running `kubectl delete ingress` for the usual admin hosts—except any one-off resources not covered above.

**Worker/API env** (`UPTIME_KUMA_BASE_URL`, etc.): changing Deployment specs in YAML triggers a normal rollout when apply runs; you do not need a separate `rollout restart` if the deploy job completes.

## SSL / cert-manager (Let’s Encrypt)

- Admin Ingresses used **cert-manager** (`cert-manager.io/cluster-issuer`) and TLS Secrets such as `admin-tls`, `status-rejourney-tls`, `k3s-rejourney-tls`, and `traefik-dashboard-tls`.
- When an **Ingress is deleted**, cert-manager usually **removes or stops renewing** the associated **Certificate** (behavior depends on owner references / version). You may briefly see **failed renewals** in cert-manager logs for hostnames that no longer have an Ingress; that is harmless if DNS is gone or grey-clouded.
- **Optional cleanup** after deploy:

  ```bash
  kubectl get certificate -n rejourney
  kubectl get certificate -n kube-system
  ```

  Delete **Certificate** CRs (and orphaned **Secret** TLS secrets) that still reference removed admin hostnames if they linger and annoy you.

**Public** certs for `rejourney.co`, `api.`, `ingest.` are **unchanged**; only admin certs stop being requested once those Ingresses are gone.

## Related

- [network-exposure-and-tailscale.md](./network-exposure-and-tailscale.md)
- [rejourney-ci.md](./rejourney-ci.md)
