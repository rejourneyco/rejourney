# Cloud distribué ou à nœud unique

Rejourney prend en charge deux formes de déploiement auto-hébergées officielles :

- **Nœud unique Docker Compose** pour un serveur ou VPS
- **Distribué K3s** pour les clusters de production et la mise à l'échelle horizontale

Les deux utilisent désormais le même modèle backend principal :

- les points de terminaison de stockage sont sauvegardés sur une base de données
- Les téléchargements d'ingest passent par le relais de téléchargement appartenant au backend
- les travailleurs traitent les artefacts vérifiés
- la visibilité de la relecture est basée sur les artefacts

---

## Comparaison des fonctionnalités

| Fonctionnalité | Cloud distribué | Cloud à nœud unique |
|---------|--------------------|-------------------|
| Plateforme | K3s | Docker Compose |
| Échelle | Multi-nœuds | Nœud unique |
| Points d'entrée publics | Entrée Traefik | Conteneur Traefik |
| Chemin de téléchargement | API + service d'ingestion-téléchargement | API + service d'ingestion-téléchargement |
| Source de stockage de la vérité | Tableau `storage_endpoints` | Tableau `storage_endpoints` |
| Stockage d'objets par défaut | Externe S3 | MinIO intégré |
| Prise en charge externe S3 | Oui | Oui |
| Cryptage secret | `STORAGE_ENCRYPTION_KEY` | `STORAGE_ENCRYPTION_KEY` |
| Flux de mise à jour | k8s déploiement + tâches | `deploy.sh update` |

---

## Modèle de stockage partagé

Dans les deux modèles de déploiement, la configuration du stockage d'exécution provient de Postgres, et non d'une solution de secours d'environnement.

Cela signifie :

- le point de terminaison de stockage d'objets actif est stocké dans `storage_endpoints`
- les clés d'accès secrètes sont cryptées dans `key_ref`
- le runtime lit la ligne de la base de données
- Les scripts d'amorçage/installation sont responsables de la synchronisation de l'entrée `.env` dans la ligne de la base de données.

Cela rend le Docker auto-hébergé beaucoup plus proche de la production et du local-k8s que l'ancien modèle de secours.

---

## Quand choisir un nœud unique Docker Compose

Choisissez Docker Compose lorsque :

- vous déployez sur un hôte VPS ou nu
- vous voulez le chemin d'installation le plus rapide
- vous voulez un MinIO intégré par défaut
- vous n'avez pas besoin de mise à l'échelle multi-nœuds ou d'opérations Kubernetes

Points d'entrée officiels :

- `docker-compose.selfhosted.yml`
- `scripts/selfhosted/deploy.sh`
- `docs/selfhosted/README.md`

---

## Quand choisir le modèle distribué K3s

Choisissez K3s lorsque :

- vous avez besoin de plusieurs nœuds
- vous voulez des opérations natives Kubernetes et une gestion des secrets
- vous souhaitez mettre à l'échelle les services API, de téléchargement et de travail indépendamment
- vous voulez des déploiements continus et une isolation infrarouge plus forte

Le chemin K3s se trouve sous `k8s/` et `scripts/k8s/`.

---

## Différence opérationnelle

La principale différence n'est plus le modèle de données. Sa forme opérationnelle est :

- Compose : une machine, un réseau Docker, un script opérateur
- K3s : plusieurs pods, espaces de noms, entrée de cluster, tâches et secrets Kubernetes

---

## Conseils pratiques

Commencez par Compose à nœud unique si vous souhaitez vous auto-héberger rapidement.

Passez à K3s lorsque vous avez besoin :

- plus de débit
- déploiements de clusters évolutifs
- mise à l'échelle horizontale
- séparation des infrastructures plus résiliente

---

## Documents sur l'architecture interne

Pour les derniers visuels d’ingénierie interne et des détails plus détaillés sur l’opérateur :

- `dev_docs/ingest-session-recording-lifecycle.md` (diagramme du cycle de vie de la session)
- `dev_docs/storage-and-endpoints.md` (schéma de topologie multi-buckets)
- `dev_docs/allthingscloud.md` (schéma de configuration du cloud k3s)

Pour une page d'architecture uniquement graphique, ouvrez [`/docs/architecture/diagrams`](/docs/architecture/diagrams).
