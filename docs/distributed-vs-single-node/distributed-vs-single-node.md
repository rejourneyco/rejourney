# Distributed vs Single-Node Cloud

Rejourney is designed for the modern cloud. We offer two distinct deployment models, both of which are self-hosted on your own infrastructure (Cloud VPS or On-Premise).

## Feature Comparison

| Feature | Distributed Cloud | Single-Node Cloud |
|---------|--------------------|----------------|
| **Platform** | K3s (Kubernetes) | Docker Compose |
| **Setup** | k8s/ directory | docker-compose.selfhosted.yml |
| **Scale** | Multi-node, auto-scaling | Single-node / VPS |
| **S3 Source** | Database Schema | Environment Variables |
| **Secrets Management** | K8s Secrets | Direct .env mapping |
| **Encryption** | Always enabled | Optional / Portable |
| **Backups** | Automated R2 CronJobs | User-defined |

---

## Configuration & S3 Logic

### Distributed Cloud (Managed via Schema)
In the Distributed Cloud deployment, the database schema is the absolute source of truth. 

* **Storage Endpoints**: All S3 configurations (endpoint, bucket, access keys) are stored in the storage_endpoints table.
* **Multi-Bucket Suport**: This allows the system to support multiple S3 buckets across different projects or regions without needing to restart services or update environment variables.
* **Redundancy**: Supports "Shadow Endpoints," where the backend automatically pipes recording data to multiple storage providers simultaneously for failover.
* **Security**: The STORAGE_ENCRYPTION_KEY is used to encrypt S3 secret keys before they are saved to the database.
* **Management**: Use the [manage-s3-endpoints.mjs](/scripts/k8s/manage-s3-endpoints.mjs) interactive script to add new storage providers to your live cluster without downtime.

### Single-Node Cloud (Simplified Fallback)
For self-hosted developers, we prioritize simplicity.

* **Frictionless Setup**: If the storage_endpoints table is empty (e.g., a fresh install), the app automatically falls back to the S3 variables in the .env file.
* **No Seed Required**: A "virtual endpoint" is created at runtime, so users don't have to worry about the database records unless they want more complex routing.

---

## Secrets Synchronization
Managing secrets in a distributed environment can be tedious, so we use a dedicated utility script.

1. It reads your local .env file.
2. It distributes secrets into the correct Kubernetes namespaces:
    * **rejourney**: App secrets, Database, S3, SMTP.
    * **kube-system**: Traefik dashboard basic auth and ingress controllers.
3. It ensures that sensitive values like JWT_SECRET and STORAGE_ENCRYPTION_KEY are always present before allowing a deployment.

Command to sync:
```bash
./scripts/k8s/k8s-sync-secrets.sh prod .env
```

---

## Scaling Strategy
* **Distributed workload**: Kubernetes distributes the workload across multiple physical VPS nodes.
* **Isolated Workers**: Unlike the single-node version where everything runs on one machine, the Distributed Cloud breaks out the Ingest, Billing, and Alert workers into their own pods.
* **Dynamic Resource Allocation**: This allows you to scale the Ingest worker up during high traffic while keeping the API pod lean.

Detailed information about automated testing and deployment can be found in the [CI/CD Documentation](/docs/architecture/ci-cd).
