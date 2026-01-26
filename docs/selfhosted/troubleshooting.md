# Troubleshooting Self-Hosted Rejourney

> Solutions for common issues when running Rejourney on your own infrastructure.

---

## Quick Diagnostics

### Check overall status

**K3s:**
```bash
./scripts/k8s/deploy.sh status
kubectl get pods -n rejourney
kubectl get events -n rejourney --sort-by='.lastTimestamp'
```

**Docker Compose:**
```bash
docker compose ps
docker compose logs --tail=50
```

---

## Common Issues

### 1. Pods/Containers Not Starting

#### Symptoms
- Pods stuck in `Pending`, `CrashLoopBackOff`, or `ImagePullBackOff`
- Containers exit immediately

#### Solutions

**Check logs:**
```bash
# K3s
kubectl logs <pod-name> -n rejourney
kubectl describe pod <pod-name> -n rejourney

# Docker
docker compose logs <service-name>
```

**ImagePullBackOff (K3s):**
```bash
# Verify ghcr-secret exists and is correct
kubectl get secret ghcr-secret -n rejourney

# Recreate the secret
kubectl delete secret ghcr-secret -n rejourney
kubectl create secret docker-registry ghcr-secret \
  --namespace rejourney \
  --docker-server=ghcr.io \
  --docker-username=YOUR_GITHUB_USERNAME \
  --docker-password=YOUR_GITHUB_TOKEN
```

**Missing secrets:**
```bash
# List all secrets
kubectl get secrets -n rejourney

# Check if required secrets exist
kubectl get secret postgres-secret -n rejourney
kubectl get secret redis-secret -n rejourney
kubectl get secret s3-secret -n rejourney
kubectl get secret app-secret -n rejourney
```

---

### 2. Database Connection Errors

#### Symptoms
- API logs show "ECONNREFUSED" or "connection refused"
- "relation does not exist" errors

#### Solutions

**Check PostgreSQL is running:**
```bash
# K3s
kubectl get pods -n rejourney -l app=postgres
kubectl logs postgres-0 -n rejourney

# Docker
docker compose ps postgres
docker compose logs postgres
```

**Verify DATABASE_URL:**
```bash
# K3s - check the secret
kubectl get secret postgres-secret -n rejourney -o jsonpath='{.data.DATABASE_URL}' | base64 -d

# Docker - check .env
grep DATABASE_URL .env
```

**Run migrations:**
```bash
# K3s
kubectl delete job db-migrate -n rejourney --ignore-not-found
kubectl apply -f k8s/api.yaml
kubectl logs job/db-migrate -n rejourney --follow

# Docker
docker compose exec api npm run db:migrate
```

**Connect directly to PostgreSQL:**
```bash
# K3s
kubectl exec -it postgres-0 -n rejourney -- psql -U rejourney rejourney

# Docker
docker compose exec postgres psql -U rejourney rejourney

# Check tables exist
\dt
```

---

### 3. S3/Storage Errors

#### Symptoms
- "NoSuchBucket" errors
- "AccessDenied" when uploading
- Recordings not saving

#### Solutions

**Verify S3 configuration:**
```bash
# K3s
kubectl get secret s3-secret -n rejourney -o yaml

# Docker
grep S3_ .env
```

**Test S3 connectivity:**
```bash
# Install AWS CLI if needed
apt install awscli -y

# Configure with your credentials
aws configure

# Test bucket access
aws s3 ls s3://your-bucket-name --endpoint-url https://your-s3-endpoint
```

**Common S3 issues:**

| Issue | Solution |
|-------|----------|
| Wrong endpoint | Use region-specific endpoint (e.g., `s3.us-east-1.amazonaws.com`) |
| Bucket doesn't exist | Create the bucket first |
| Permission denied | Check IAM policy allows `s3:PutObject`, `s3:GetObject` |
| CORS errors | Configure CORS on the bucket |

**MinIO (local) issues:**
```bash
# Check MinIO is running
docker compose logs minio

# Access MinIO console at http://localhost:9001
# Default: minioadmin / minioadmin
```

---

### 4. SSL/Certificate Errors

#### Symptoms
- "Certificate expired" or "invalid certificate"
- HTTPS not working
- Let's Encrypt challenges failing

#### Solutions

**Check certificate status (K3s):**
```bash
kubectl get certificates -n rejourney
kubectl describe certificate <cert-name> -n rejourney
```

**Check cert-manager logs:**
```bash
kubectl logs -n cert-manager -l app.kubernetes.io/name=cert-manager
```

**Force certificate renewal:**
```bash
kubectl delete certificate <cert-name> -n rejourney
kubectl apply -f k8s/ingress.yaml
```

**Verify DNS is pointing correctly:**
```bash
dig yourdomain.com
nslookup api.yourdomain.com
```

**Check HTTP challenge is accessible:**
```bash
curl http://yourdomain.com/.well-known/acme-challenge/test
```

---

### 5. API Health Check Failing

#### Symptoms
- `curl /health` returns error
- Load balancer marks backend unhealthy
- 502/503 errors

#### Solutions

**Test health endpoint:**
```bash
# K3s
kubectl port-forward svc/api 3000:3000 -n rejourney
curl localhost:3000/health

# Docker
curl localhost:3000/health
```

**Check API logs:**
```bash
# K3s
kubectl logs -f deployment/api -n rejourney

# Docker
docker compose logs -f api
```

**Common causes:**

| Cause | Solution |
|-------|----------|
| Database not ready | Wait for PostgreSQL, check DATABASE_URL |
| Missing env vars | Check all required secrets exist |
| Port conflict | Ensure port 3000 is available |
| Memory limit | Increase container memory limits |

---

### 6. Dashboard Not Loading

#### Symptoms
- Blank page or loading forever
- JavaScript errors in console
- 404 errors for assets

#### Solutions

**Check web service:**
```bash
# K3s
kubectl logs -f deployment/web -n rejourney

# Docker
docker compose logs -f web
```

**Verify API_URL is correct:**
```bash
# The web container needs to reach the API
# K3s - check the deployment
kubectl get deployment web -n rejourney -o yaml | grep API_URL

# Docker - check .env
grep API_URL .env
```

**Check ingress/routing:**
```bash
# K3s
kubectl get ingress -n rejourney
kubectl describe ingress rejourney-ingress -n rejourney
```

---

### 7. Workers Not Processing

#### Symptoms
- Recordings uploaded but not appearing
- Queue building up
- Worker logs show errors

#### Solutions

**Check worker status:**
```bash
# K3s
kubectl get pods -n rejourney -l app=ingest-worker
kubectl logs -f deployment/ingest-worker -n rejourney

# Docker
docker compose logs -f worker
```

**Check Redis connection:**
```bash
# K3s
kubectl exec -it deployment/ingest-worker -n rejourney -- redis-cli -u $REDIS_URL ping

# Docker
docker compose exec redis redis-cli ping
```

**Restart workers:**
```bash
# K3s
kubectl rollout restart deployment ingest-worker -n rejourney

# Docker
docker compose restart worker
```

---

### 8. Memory/Resource Issues

#### Symptoms
- OOMKilled pods
- Slow performance
- Container restarts

#### Solutions

**Check resource usage (K3s):**
```bash
kubectl top pods -n rejourney
kubectl top nodes
```

**Check resource usage (Docker):**
```bash
docker stats
```

**Increase resource limits (K3s):**

Edit the deployment yaml:
```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "1Gi"
    cpu: "500m"
```

**Increase Docker memory:**
- Docker Desktop: Settings → Resources → Memory

---

## Debugging Commands Reference

### K3s/Kubernetes

```bash
# Get all resources
kubectl get all -n rejourney

# Describe a resource
kubectl describe pod <pod-name> -n rejourney
kubectl describe deployment api -n rejourney

# Get logs
kubectl logs <pod-name> -n rejourney
kubectl logs -f deployment/api -n rejourney --tail=100

# Execute command in pod
kubectl exec -it <pod-name> -n rejourney -- /bin/sh

# Port forward for local testing
kubectl port-forward svc/api 3000:3000 -n rejourney

# Get events (sorted by time)
kubectl get events -n rejourney --sort-by='.lastTimestamp'

# Check resource usage
kubectl top pods -n rejourney
```

### Docker Compose

```bash
# Status
docker compose ps
docker compose ps -a  # include stopped

# Logs
docker compose logs
docker compose logs -f api
docker compose logs --tail=100

# Execute command
docker compose exec api /bin/sh
docker compose exec postgres psql -U rejourney

# Restart
docker compose restart
docker compose restart api

# Rebuild
docker compose build
docker compose up -d --build

# Stats
docker stats
```

---

## Getting Help

If you're still stuck:

1. **Check logs thoroughly** - The answer is usually in the logs
2. **Search existing issues** - [GitHub Issues](https://github.com/rejourneyco/rejourney/issues)
3. **Ask the community** - [Discord](https://discord.gg/rejourney) or [Discussions](https://github.com/rejourneyco/rejourney/discussions)
4. **Open a new issue** - Include:
   - Deployment method (K3s / Docker Compose)
   - OS and version
   - Relevant logs
   - Steps to reproduce
