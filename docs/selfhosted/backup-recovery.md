# Backup & Recovery

> Protect your Rejourney data with automated backups and disaster recovery procedures.

---

## What to Backup

| Component | Data Type | Priority | Method |
|-----------|-----------|----------|--------|
| PostgreSQL | User data, projects, sessions | **Critical** | pg_dump |
| Redis | Cache, queues | Low | Optional |
| S3/Object Storage | Session recordings | High | S3 replication |
| Kubernetes Secrets | Credentials | **Critical** | Manual export |

---

## Automated Backups

### K3s: CronJob Backup

The included backup CronJob runs daily:

```bash
# Check backup job status
kubectl get cronjobs -n rejourney

# View recent backup jobs
kubectl get jobs -n rejourney | grep backup

# Check backup logs
kubectl logs job/db-backup-<id> -n rejourney
```

### Docker Compose: Cron Backup

Set up automated backups with cron:

```bash
# Edit crontab
crontab -e

# Add daily backup at 3 AM
0 3 * * * /path/to/rejourney/scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1

# Add weekly full backup (including recordings)
0 4 * * 0 /path/to/rejourney/scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## Manual Backup

### PostgreSQL Database

**K3s:**
```bash
# Create backup
kubectl exec -it postgres-0 -n rejourney -- pg_dump -U rejourney rejourney > backup-$(date +%Y%m%d).sql

# Compress
gzip backup-$(date +%Y%m%d).sql
```

**Docker Compose:**
```bash
# Create backup
docker compose exec -T postgres pg_dump -U rejourney rejourney > backup-$(date +%Y%m%d).sql

# Compress
gzip backup-$(date +%Y%m%d).sql
```

### Kubernetes Secrets

```bash
# Export all secrets
kubectl get secrets -n rejourney -o yaml > secrets-backup.yaml

# Store securely (encrypt before storing!)
gpg -c secrets-backup.yaml
```

### S3 Object Storage

For external S3 providers, use their replication features:
- **AWS S3**: Cross-region replication
- **Hetzner**: Create backup bucket
- **MinIO**: mc mirror command

```bash
# MinIO mirror example
mc mirror minio/rejourney-recordings backup/rejourney-recordings
```

---

## Recovery Procedures

### Restore PostgreSQL

**K3s:**
```bash
# Stop API and workers
kubectl scale deployment api --replicas=0 -n rejourney
kubectl scale deployment ingest-worker --replicas=0 -n rejourney

# Restore database
gunzip -c backup.sql.gz | kubectl exec -i postgres-0 -n rejourney -- psql -U rejourney rejourney

# Start services
kubectl scale deployment api --replicas=2 -n rejourney
kubectl scale deployment ingest-worker --replicas=1 -n rejourney
```

**Docker Compose:**
```bash
# Stop services
docker compose stop api worker

# Restore database
gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U rejourney rejourney

# Start services
docker compose start api worker
```

### Restore Kubernetes Secrets

```bash
# Decrypt if encrypted
gpg -d secrets-backup.yaml.gpg > secrets-backup.yaml

# Apply secrets
kubectl apply -f secrets-backup.yaml
```

### Complete Disaster Recovery

1. **Provision new server** with same specs
2. **Install K3s or Docker**
3. **Clone repository**
4. **Restore secrets**
5. **Deploy application**
6. **Restore database**
7. **Update DNS**
8. **Verify functionality**

---

## Backup to Cloud Storage

### Upload to S3

```bash
#!/bin/bash
# backup-to-s3.sh

BACKUP_FILE="backup-$(date +%Y%m%d-%H%M%S).sql.gz"
S3_BUCKET="your-backup-bucket"

# Create backup
kubectl exec -it postgres-0 -n rejourney -- pg_dump -U rejourney rejourney | gzip > $BACKUP_FILE

# Upload to S3
aws s3 cp $BACKUP_FILE s3://$S3_BUCKET/postgres/

# Clean up local file
rm $BACKUP_FILE

# Keep only last 30 days
aws s3 ls s3://$S3_BUCKET/postgres/ | while read -r line; do
  createDate=$(echo $line | awk '{print $1}')
  if [[ $(date -d "$createDate" +%s) -lt $(date -d "30 days ago" +%s) ]]; then
    fileName=$(echo $line | awk '{print $4}')
    aws s3 rm s3://$S3_BUCKET/postgres/$fileName
  fi
done
```

### Upload to Cloudflare R2

Use the K8s backup CronJob which automatically uploads to R2 if configured.

---

## Backup Verification

Regularly test your backups:

```bash
# Create test database
kubectl exec -it postgres-0 -n rejourney -- createdb -U rejourney rejourney_test

# Restore to test database
gunzip -c backup.sql.gz | kubectl exec -i postgres-0 -n rejourney -- psql -U rejourney rejourney_test

# Verify data
kubectl exec -it postgres-0 -n rejourney -- psql -U rejourney rejourney_test -c "SELECT COUNT(*) FROM users;"

# Clean up
kubectl exec -it postgres-0 -n rejourney -- dropdb -U rejourney rejourney_test
```

---

## Retention Policy

| Backup Type | Retention |
|-------------|-----------|
| Daily | 7 days |
| Weekly | 4 weeks |
| Monthly | 12 months |

Implement with backup rotation:

```bash
# Keep last 7 daily backups
find /backups/daily -mtime +7 -delete

# Keep last 4 weekly backups
find /backups/weekly -mtime +28 -delete
```
