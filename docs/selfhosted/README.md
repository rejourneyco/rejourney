# Self-Hosted Rejourney

> Deploy Rejourney on your own server in minutes. One command, automatic HTTPS, secure defaults.

---

> [!IMPORTANT]
> **Enterprise Scaling:** For production-grade Kubernetes deployment, high-availability clusters, and multi-node scaling, please see our [Distributed vs Single-Node Cloud](/docs/architecture/distributed-vs-single-node) architecture guide. For a easy quick-setup with a single docker file continue below.

---

## Quick Start

```bash
# Install Docker (if not already installed)
curl -fsSL https://get.docker.com | sh

# Clone and deploy
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
./scripts/selfhosted/deploy.sh
```

The script will:
1. Prompt for your domain names (e.g., `yourdomain.com`, `api.yourdomain.com`)
2. Auto-generate all secrets and passwords
3. Configure automatic HTTPS with Let's Encrypt
4. Start all services

---

## Requirements

Minimum specifications for a self-hosted deployment:

- **OS:** Ubuntu 22.04+ or Debian 12+
- **RAM:** 4 GB minimum (8 GB recommended)
- **Storage:** 20 GB SSD
- **Ports:** 80 and 443 open
- **Docker:** 24.0+

You'll also need a domain name with DNS pointing to your server's IP address.

---

## SDK Configuration

**Important:** Before deploying the server, update your mobile app's SDK to point to your self-hosted [API endpoint](/docs/selfhosted). This ensures sessions are sent to your server instead of the cloud.

### React Native

```javascript
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.yourdomain.com'
});

startRejourney();
```

**Important:** Set this before deploying to production. Without it, sessions go to the cloud by default.

Replace `https://api.yourdomain.com` with your actual self-hosted API domain.

---

## Deployment

Clone the repository and run the deploy script. It will prompt for your domains and auto-generate all secrets.

```bash
# Install Docker if needed
curl -fsSL https://get.docker.com | sh

# Deploy
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
./scripts/selfhosted/deploy.sh
```

The script configures PostgreSQL, Redis, MinIO (S3-compatible storage), Traefik (reverse proxy with auto HTTPS), and all application services.

---

## Environment Configuration

The deploy script creates `.env.selfhosted` with auto-generated values. Key variables:

```bash
# Domains
DASHBOARD_DOMAIN=yourdomain.com
API_DOMAIN=api.yourdomain.com
LETSENCRYPT_EMAIL=admin@yourdomain.com

# Database (auto-generated)
DATABASE_URL=postgresql://rejourney:PASSWORD@postgres:5432/rejourney

# Storage - Built-in MinIO (default)
USE_MINIO=true
S3_ENDPOINT=http://minio:9000

# Or external S3
USE_MINIO=false
S3_ENDPOINT=https://s3.us-east-1.amazonaws.com
S3_BUCKET=your-bucket
S3_ACCESS_KEY_ID=xxx
S3_SECRET_ACCESS_KEY=xxx

# Optional: Email for alerts and invites
SMTP_HOST=smtp.provider.com
SMTP_PORT=587
SMTP_USER=your-user
SMTP_PASS=your-password

# Optional: GitHub OAuth
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
```

For complete reference, see [env.selfhosted.example](./env.selfhosted.example) which documents all environment variables.

---

## Operations

Commands for managing your deployment:

```bash
# Check status
./scripts/selfhosted/deploy.sh status

# View logs
./scripts/selfhosted/deploy.sh logs
./scripts/selfhosted/deploy.sh logs api

# Update to latest version
./scripts/selfhosted/deploy.sh update

# Stop all services
./scripts/selfhosted/deploy.sh stop
```

---

## Storage

By default, Rejourney uses built-in MinIO for S3-compatible storage. For larger deployments, configure external storage during setup:

| Provider | Endpoint Example |
|----------|-----------------|
| AWS S3 | `https://s3.us-east-1.amazonaws.com` |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` |
| Hetzner | `https://fsn1.your-objectstorage.com` |

---

## Common Issues

**Containers not starting**

Check logs to identify the issue:

```bash
docker compose logs api
```

**HTTPS not working**

Ensure ports 80/443 are open and DNS points to your server. Let's Encrypt needs 2-3 minutes to issue certificates. Check with `dig yourdomain.com`.

**Database connection errors**

Verify PostgreSQL is running:

```bash
docker compose ps postgres
docker compose exec postgres pg_isready
```

**Sessions not appearing**

Confirm your SDK's `apiUrl` points to your server. Check worker logs: `docker compose logs ingest-worker`.

For additional help, open an issue on [GitHub](https://github.com/rejourneyco/rejourney/issues).

---

## More Documentation

- [Backup & Recovery](/docs/selfhosted/backup-recovery)
- [Troubleshooting](/docs/selfhosted/troubleshooting)
