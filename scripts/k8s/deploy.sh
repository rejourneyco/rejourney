#!/bin/bash
# Rejourney K3s Deployment Script
# Usage: ./scripts/k8s/deploy.sh [init|deploy|update|status]

set -e

NAMESPACE="rejourney"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# K8S dir is two levels up from scripts/k8s/
K8S_DIR="${SCRIPT_DIR}/../../k8s"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

check_kubectl() {
    if ! command -v kubectl &> /dev/null; then
        error "kubectl not found. Install K3s first."
    fi
}

init() {
    log "Initializing Rejourney deployment..."
    
    # Create namespace
    kubectl apply -f "${K8S_DIR}/namespace.yaml"
    
    echo ""
    log "Namespace 'rejourney' created."
    echo ""
    warn "Next steps:"
    echo ""
    echo "1. Configure your .env file:"
    echo "   cp .env.example .env"
    echo "   # Edit .env with your production values"
    echo ""
    echo "2. Sync secrets to Kubernetes (recommended):"
    echo "   ./scripts/k8s/k8s-sync-secrets.sh prod .env"
    echo ""
    echo "   OR manually create secrets:"
    echo "   ./scripts/k8s/deploy.sh secrets  # Generate random values"
    echo "   # Then create secrets manually (see below):"
    echo ""
    echo "3. Manual secret creation (if not using sync script):"
    echo ""
    echo "   # Database"
    echo "   kubectl create secret generic postgres-secret \\"
    echo "     --namespace ${NAMESPACE} \\"
    echo "     --from-literal=POSTGRES_USER=rejourney \\"
    echo "     --from-literal=POSTGRES_PASSWORD=<YOUR_PASSWORD> \\"
    echo "     --from-literal=POSTGRES_DB=rejourney \\"
    echo "     --from-literal=DATABASE_URL=postgresql://rejourney:<YOUR_PASSWORD>@postgres:5432/rejourney"
    echo ""
    echo "   # Redis"
    echo "   kubectl create secret generic redis-secret \\"
    echo "     --namespace ${NAMESPACE} \\"
    echo "     --from-literal=REDIS_URL=redis://redis:6379/0"
    echo ""
    echo "   # S3 Storage"
    echo "   kubectl create secret generic s3-secret \\"
    echo "     --namespace ${NAMESPACE} \\"
    echo "     --from-literal=S3_ENDPOINT=<YOUR_S3_ENDPOINT> \\"
    echo "     --from-literal=S3_PUBLIC_ENDPOINT=<YOUR_S3_ENDPOINT> \\"
    echo "     --from-literal=S3_BUCKET=<YOUR_BUCKET> \\"
    echo "     --from-literal=S3_REGION=<YOUR_REGION> \\"
    echo "     --from-literal=S3_ACCESS_KEY_ID=<YOUR_ACCESS_KEY> \\"
    echo "     --from-literal=S3_SECRET_ACCESS_KEY=<YOUR_SECRET_KEY>"
    echo ""
    echo "   # Application secrets"
    echo "   kubectl create secret generic app-secret \\"
    echo "     --namespace ${NAMESPACE} \\"
    echo "     --from-literal=JWT_SECRET=<YOUR_JWT_SECRET> \\"
    echo "     --from-literal=JWT_SIGNING_KEY=<YOUR_JWT_SIGNING_KEY> \\"
    echo "     --from-literal=INGEST_HMAC_SECRET=<YOUR_INGEST_SECRET> \\"
    echo "     --from-literal=STORAGE_ENCRYPTION_KEY=<YOUR_STORAGE_KEY>"
    echo ""
    echo "   # GitHub Container Registry (to pull images)"
    echo "   kubectl create secret docker-registry ghcr-secret \\"
    echo "     --namespace ${NAMESPACE} \\"
    echo "     --docker-server=ghcr.io \\"
    echo "     --docker-username=<YOUR_GITHUB_USERNAME> \\"
    echo "     --docker-password=<YOUR_GITHUB_TOKEN>"
    echo ""
    echo "4. Create GitHub Container Registry secret:"
    echo "   kubectl create secret docker-registry ghcr-secret \\"
    echo "     --namespace ${NAMESPACE} \\"
    echo "     --docker-server=ghcr.io \\"
    echo "     --docker-username=<YOUR_GITHUB_USERNAME> \\"
    echo "     --docker-password=<YOUR_GITHUB_TOKEN>"
    echo ""
    echo "5. Deploy the application:"
    echo "   ./scripts/k8s/deploy.sh deploy"
    echo ""
    log "Full documentation: docs/selfhosted/k3s-deployment.md"
}

deploy() {
    log "Deploying Rejourney..."
    
    # Deploy in order
    log "Deploying PostgreSQL..."
    kubectl apply -f "${K8S_DIR}/postgres.yaml"
    
    log "Waiting for PostgreSQL to be ready..."
    kubectl wait --for=condition=ready pod -l app=postgres -n ${NAMESPACE} --timeout=120s || true
    
    log "Deploying Redis..."
    kubectl apply -f "${K8S_DIR}/redis.yaml"
    
    log "Waiting for Redis to be ready..."
    kubectl wait --for=condition=ready pod -l app=redis -n ${NAMESPACE} --timeout=60s || true
    
    log "Deploying API..."
    kubectl apply -f "${K8S_DIR}/api.yaml"
    
    log "Deploying Web..."
    kubectl apply -f "${K8S_DIR}/web.yaml"
    
    log "Deploying Workers..."
    kubectl apply -f "${K8S_DIR}/workers.yaml"
    
    log "Deploying Monitoring (Uptime Kuma)..."
    kubectl apply -f "${K8S_DIR}/monitoring.yaml"
    
    log "Deploying Admin Tools..."
    kubectl apply -f "${K8S_DIR}/admin-tools.yaml"
    
    log "Installing cert-manager (for Let's Encrypt SSL)..."
    kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.4/cert-manager.yaml 2>/dev/null || true
    log "Waiting for cert-manager to be ready..."
    sleep 30
    
    log "Deploying Ingress..."
    kubectl apply -f "${K8S_DIR}/ingress.yaml"
    
    log "Deploying Backup CronJob..."
    kubectl apply -f "${K8S_DIR}/backup.yaml"
    
    echo ""
    log "Deployment complete! Run './scripts/k8s/deploy.sh status' to check status."
    log "Run the migration job: kubectl create -f ${K8S_DIR}/api.yaml (db-migrate job)"
}

update() {
    log "Updating deployments (rolling restart)..."
    
    kubectl rollout restart deployment api -n ${NAMESPACE}
    kubectl rollout restart deployment web -n ${NAMESPACE}
    kubectl rollout restart deployment ingest-worker -n ${NAMESPACE}
    kubectl rollout restart deployment retention-worker -n ${NAMESPACE}
    kubectl rollout restart deployment alert-worker -n ${NAMESPACE}
    
    log "Waiting for rollout..."
    kubectl rollout status deployment api -n ${NAMESPACE}
    kubectl rollout status deployment web -n ${NAMESPACE}
    
    log "Update complete!"
}

status() {
    log "Rejourney Status:"
    echo ""
    kubectl get pods -n ${NAMESPACE} -o wide
    echo ""
    log "Services:"
    kubectl get svc -n ${NAMESPACE}
    echo ""
    log "Ingress:"
    kubectl get ingress -n ${NAMESPACE}
}

logs() {
    SERVICE="${2:-api}"
    log "Showing logs for ${SERVICE}..."
    kubectl logs -f deployment/${SERVICE} -n ${NAMESPACE} --tail=100
}

migrate() {
    "${SCRIPT_DIR}/migrate.sh"
}

secrets() {
    log "Generating secure secrets..."
    echo ""
    echo "Save these values securely. You'll need them to create Kubernetes secrets."
    echo ""
    echo "───────────────────────────────────────────────────────────────────"
    echo "JWT_SECRET=$(openssl rand -hex 32)"
    echo "JWT_SIGNING_KEY=$(openssl rand -hex 32)"
    echo "INGEST_HMAC_SECRET=$(openssl rand -hex 32)"
    echo "STORAGE_ENCRYPTION_KEY=$(openssl rand -hex 32)"
    echo "POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
    echo "───────────────────────────────────────────────────────────────────"
    echo ""
    echo "See docs/selfhosted/k3s-deployment.md for how to create secrets."
}

# Main
check_kubectl

case "${1:-help}" in
    init)
        init
        ;;
    deploy)
        deploy
        ;;
    update)
        update
        ;;
    status)
        status
        ;;
    logs)
        logs "$@"
        ;;
    migrate)
        migrate
        ;;
    secrets)
        secrets
        ;;
    *)
        echo "Usage: $0 {init|deploy|update|status|logs|migrate|secrets}"
        echo ""
        echo "Commands:"
        echo "  init     - Create namespace and show secret creation commands"
        echo "  deploy   - Deploy all services"
        echo "  update   - Rolling restart of all deployments"
        echo "  status   - Show pod and service status"
        echo "  logs     - Show logs for a service (default: api)"
        echo "  migrate  - Run database migrations"
        echo "  secrets  - Generate secure random secrets"
        echo "  secrets  - Generate secure random secrets"
        exit 1
        ;;
esac
