# Auto-hébergement Rejourney

Ce guide s'adresse à **n'importe qui** exécutant Rejourney sur son propre serveur (généralement un seul VPS ou une machine dédiée) à l'aide de la pile officielle **Docker Compose**. Vous n'avez pas besoin d'accéder à l'infrastructure interne de Rejourney ou à Kubernetes.

Après configuration, vous obtenez :

- Un **tableau de bord Web** sur votre domaine (HTTPS via Let’s Encrypt)
- Un **API** sur un sous-domaine (pour le tableau de bord et mobile SDK)
- Un **ingérer (télécharger) le relais** sur un autre sous-domaine (les téléchargements de sessions passent par votre serveur, pas directement des téléphones vers le stockage objet)
- **PostgreSQL**, **Redis** et **MinIO intégré** ou **votre propre stockage S3-compatible**
- Contexte **ouvriers** qui traite les sessions, la rétention et les alertes (mêmes rôles que dans le déploiement cloud de Rejourney)

Toutes les commandes ci-dessous supposent que vous vous trouvez dans le **racine du référentiel** après le clonage (le dossier qui contient `docker-compose.selfhosted.yml`).

---

## Ce dont vous avez besoin au préalable

### Serveur

- **Système d'exploitation :** Ubuntu 22.04+, Debian 12+ ou un autre Linux qui exécute bien Docker
- **Docker :** 24 ​​ou plus récent, avec le **Plugin Docker Compose** (`docker compose version` devrait fonctionner)
- **Ressources (recommandées) :** 4 vCPU, 8 Go de RAM, 40 Go de disque (plus si vous conservez de nombreux enregistrements)
- Ports **Réseau:** **80** et **443** ouverts à Internet (requis pour le défi Let’s Encrypt HTTP et HTTPS)

### Domaine et DNS

Vous avez besoin de **un domaine de base** que vous contrôlez (par exemple `example.com`). Avant d'exécuter le programme d'installation, créez des enregistrements DNS **UN** (ou **AAAA**) pointant **tous** de ces noms d'hôte vers l'adresse IP publique de votre serveur :

| Nom d'hôte | Objectif |
|----------|---------|
| `example.com` | Tableau de bord |
| `www.example.com` | Redirection vers le tableau de bord |
| `api.example.com` | API (et WebSocket le cas échéant) |
| `ingest.example.com` | Relais de téléchargement (SDK l'utilise automatiquement une fois API configuré) |

Remplacez `example.com` par votre domaine réel. La propagation peut prendre de quelques minutes à quelques heures ; Les certificats TLS ne seront pas émis tant que DNS n'aura pas été résolu correctement.

### Let’s Encrypt

Il vous sera demandé un **adresse email** lors de l'installation. Il est utilisé pour les avis d’expiration de certificat de Let’s Encrypt.

### Outils sur votre machine

- `git` pour cloner le référentiel
- `openssl` (utilisé par le script d'installation pour générer des secrets)
- Un shell (bash c'est bien)

---

## Première installation

### 1. Clonez le référentiel

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

Restez sur la branche par défaut (ou une balise de version si le projet en documente une pour l'auto-hébergement).

### 2. Exécutez le programme d'installation

```bash
./scripts/selfhosted/deploy.sh install
```

Le script va :

1. Demandez votre **domaine de base** (par exemple `example.com` — pas `https://`, pas de chemin).
2. Demandez votre **Courriel Let’s Encrypt**.
3. Demandez **stockage** : stockage **MinIO** intégré (recommandé) ou **externe S3-compatible** (vous entrerez le point de terminaison, le compartiment, la région et les clés).
4. Créez **`.env.selfhosted`** dans la racine du dépôt avec les mots de passe et les secrets générés. **Restreindre les autorisations** sont appliqués (`chmod 600`).
5. Images de conteneurs publiées **Tirer** (API, Web, Workers, bases de données, Traefik, etc.).
6. **Construire** l'image **démarrage/migration** **de ton clone** (elle contient les scripts de configuration de la base de données ; elle n'est pas téléchargée à partir du registre de conteneurs).
7. Démarrez les bases de données, Redis, Traefik et (si choisi) MinIO.
8. Validez la connectivité de la base de données à l’aide du `DATABASE_URL` configuré avant l’exécution du bootstrap.
9. Exécutez un conteneur **bootstrap** unique : schéma de base de données, première graine facultative et configuration de stockage dans la base de données.
10. Démarrez le API, téléchargez le relais, le tableau de bord et les nœuds de calcul.

La première installation peut prendre plusieurs minutes (extractions d’images et bootstrap).

### 3. Protéger `.env.selfhosted`

Ce fichier contient **tous les secrets** pour votre déploiement (base de données, Redis, JWT, cryptage du stockage, informations d'identification MinIO si utilisées, etc.). **Sauvegardez-le** dans un endroit sûr (gestionnaire de mots de passe, sauvegarde cryptée). Si vous le perdez, vous risquez de perdre la possibilité de déchiffrer les informations d'identification stockées ou de reconstruire le même déploiement.

Ne le validez pas dans git (il doit être ignoré par `.gitignore`).

---

## Après l'installation

### URL

Le programme d'installation imprime les URL. En général:

- **Tableau de bord:** `https://<your-base-domain>`
- **API :** `https://api.<your-base-domain>`
- **Ingérer:** `https://ingest.<your-base-domain>`

`www.<your-base-domain>` redirige vers le tableau de bord.

### Vérifier la pile

```bash
./scripts/selfhosted/deploy.sh status
```

Vous devriez voir les conteneurs fonctionner ; `api` et `ingest-upload` devraient devenir **en bonne santé** après un court laps de temps.

### Première connexion et enregistrement de test

1. Ouvrez le tableau de bord dans un navigateur.
2. Créez un compte et un projet.
3. Configurez le Rejourney SDK de votre application avec votre **URL API** (voir [Configuration SDK](#configuring-your-mobile-app) ci-dessous).
4. Enregistrez une courte session et confirmez qu'elle apparaît dans Replay.

Si les sessions n'apparaissent jamais dans Replay, consultez [Dépannage](/docs/selfhosted/troubleshooting) (télécharger les journaux de relais et ingérer les tâches).

---

## Opérations quotidiennes

Tous ces éléments sont exécutés à partir de la racine du dépôt.

| Actions | Commande |
|--------|---------|
| Statut des services | `./scripts/selfhosted/deploy.sh status` |
| Suivre tous les journaux | `./scripts/selfhosted/deploy.sh logs` |
| Journaux pour un service | `./scripts/selfhosted/deploy.sh logs api` (remplacer `api` par `web`, `ingest-upload`, `ingest-worker`, etc.) |
| Images **Mise à niveau** et réexécution du bootstrap | `./scripts/selfhosted/deploy.sh update` |
| Arrêtez tout **sans** en supprimant des données | `./scripts/selfhosted/deploy.sh stop` |
| **Réinitialiser** conteneurs et volumes (destructifs) | `./scripts/selfhosted/deploy.sh reset` |

**`update`** extrait des images plus récentes (le cas échéant), reconstruit l'image d'amorçage à partir de votre clone actuel, redémarre la pile et exécute à nouveau l'amorçage afin que le schéma de base de données et les paramètres de stockage restent alignés sur votre `.env.selfhosted`. Il efface **pas** Postgres ou les volumes de stockage d'objets.

Avant le démarrage, `install` et `update` valident la connectivité de la base de données avec les informations d'identification configurées. Si les informations d'identification ne correspondent pas aux données Postgres persistantes, le déploiement s'arrête plus tôt avec des instructions de récupération au lieu d'échouer plus tard lors du démarrage.

**`stop`** arrête uniquement les conteneurs ; Docker **tomes** (données Postgres, données MinIO, etc.) restent jusqu'à ce que vous les supprimiez explicitement.

**`reset`** supprime les conteneurs auto-hébergés et les volumes Docker (`pgdata`, `redisdata`, `miniodata`, `traefik-certs`) après une invite de confirmation. Il détruit également les conteneurs de profil MinIO même lorsque `.env.selfhosted` est manquant, de sorte que les données MinIO obsolètes ne bloquent pas la prochaine installation. Utilisez-le uniquement lorsque vous souhaitez une nouvelle installation complète.

---

## Stockage : MinIO vs S3 externe

### MinIO intégré (par défaut)

- Le plus simple pour un seul serveur : le stockage d'objets exécute **à l'intérieur Docker** et n'est pas exposé à l'Internet public par défaut.
- Les octets de session sont écrits par le service **ingérer-télécharger** ; les appareils n'ont pas besoin d'atteindre directement MinIO.
- La création du compartiment est gérée lors de l'installation.

### Stockage externe S3-compatible

Utilisez AWS S3, Cloudflare R2, Hetzner Object Storage, Wasabi ou tout autre S3-compatible API. Lors de l'installation, vous fournissez l'URL du point de terminaison, le compartiment, la région et les clés d'accès.

Exemples de styles d'URL de point de terminaison (les documents de votre fournisseur font autorité) :

- AWS : `https://s3.<region>.amazonaws.com`
- Cloudflare R2 : `https://<account-id>.r2.cloudflarestorage.com`
- Hetzner : `https://<location>.your-objectstorage.com`

Si vous ajoutez un **URL publique distincte** pour les téléchargements, définissez `S3_PUBLIC_ENDPOINT` dans `.env.selfhosted` et exécutez `./scripts/selfhosted/deploy.sh update`.

---

## Configuration importante (`.env.selfhosted`)

Le programme d'installation génère ce fichier. Les variables typiques incluent :

- **Domaines et URL publiques :** `BASE_DOMAIN`, `DASHBOARD_DOMAIN`, `API_DOMAIN`, `INGEST_DOMAIN`, `PUBLIC_*_URL`
- **Base de données :** `DATABASE_URL` (pointe vers le service `postgres` à l'intérieur de Compose)
- **Redis :** `REDIS_URL`
- **Stockage:** `STORAGE_BACKEND`, `S3_*` et en option `MINIO_*`
- **Sécurité:** `JWT_SECRET`, `JWT_SIGNING_KEY`, `INGEST_HMAC_SECRET`, `STORAGE_ENCRYPTION_KEY`

Intégrations facultatives (laisser vide si inutilisé) : Stripe, SMTP, GitHub OAuth, Turnstile, etc.

**Modification des valeurs liées au stockage ou au domaine :** modifiez `.env.selfhosted`, puis exécutez :

```bash
./scripts/selfhosted/deploy.sh update
```

---

## Comment fonctionne la configuration de la base de données (premier démarrage ou mises à jour ultérieures)

Normalement, vous devez exécuter SQL à la main. Le conteneur **bootstrap** le gère.

- **Nouvelle base de données vide :**, la pile applique le schéma actuel à partir du code, puis enregistre les versions de migration déjà satisfaites afin que les futures mises à jour n'appliquent que les migrations **nouveau**.
- **Base de données existante (déjà initialisée) :** seules les migrations **en attente** sont appliquées. Vos données ne sont pas reconstruites à partir de zéro sur chaque `update`.
- Si la base de données **a déjà des tables** mais la table d'historique de migration est **manquant ou vide** (par exemple une restauration partielle), amorcez **s'arrête avec une erreur** pour éviter tout dommage accidentel. Les options de récupération avancées sont documentées dans [Dépannage](/docs/selfhosted/troubleshooting).

---

## Serveurs Apple Silicon et ARM

Sur les machines **ARM64** (de nombreux Mac, certaines instances cloud), le script de déploiement définit `DOCKER_DEFAULT_PLATFORM=linux/amd64` pour les extractions d'images lorsque vous ne l'avez pas défini vous-même, de sorte que les images prédéfinies qui publient uniquement `amd64` s'exécutent toujours. Si vous avez besoin d'un comportement différent, définissez `DOCKER_DEFAULT_PLATFORM` dans votre environnement avant d'exécuter le script.

L'image **bootstrap** est toujours **construit sur votre machine** provenant du référentiel cloné, elle correspond donc toujours à votre extraction.

---

## Ce qui s'exécute dans Docker (présentation)

- Certificats **Traefik :** HTTPS et routage vers le tableau de bord, API et noms d'hôtes d'acquisition.
- **Postgres / Redis :** Données d'application et files d'attente.
- **MinIO :** Stockage d'objets interne en option.
- **API :** Principal HTTP API.
- **ingérer-télécharger :** Service dédié au trafic de relais de téléchargement.
- **Internet :** Interface utilisateur statique du tableau de bord.
- **Ouvriers:** Traitez les files d'attente d'ingestion, les artefacts de relecture, le cycle de vie des sessions, les travaux planifiés de style rétention et les alertes.

Il existe un travailleur par lots de facturation distinct **Non** dans cette pile ; l'intégration de la facturation est pilotée par Stripe et API lorsque vous configurez les clés.

---

## Configuration de votre application mobile

Pointez le SDK vers l’hôte **ton** API (doit correspondre à `API_DOMAIN` / `PUBLIC_API_URL`).

### Exemple React Native

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

Utilisez votre véritable URL API. Les URL de téléchargement sont automatiquement dérivées pour `ingest.<your-domain>` lorsque le serveur est correctement configuré.

---

## Sauvegardes

Au minimum, sauvegardez **PostgreSQL**, **`.env.selfhosted`** et (si vous utilisez le MinIO intégré) **données de stockage d'objets**.

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Détails : [Sauvegarde et récupération](/docs/selfhosted/backup-recovery).

---

## Dépannage et assistance

- [Dépannage](/docs/selfhosted/troubleshooting) — échecs d'amorçage, TLS, Replay vide, problèmes externes de S3.
- [Sauvegarde et récupération](/docs/selfhosted/backup-recovery) — restaurez l'ordre et MinIO.

Pour les bogues ou les améliorations de ces documents, utilisez l'outil de suivi des problèmes publics du projet sur GitHub.

---

## Documentation associée

- [Cloud distribué ou cloud à nœud unique](/docs/distributed-vs-single-node/distributed-vs-single-node) : comparaison avec une configuration cloud multiservice (conceptuel).
