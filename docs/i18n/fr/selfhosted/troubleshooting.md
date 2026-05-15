# Dépannage auto-hébergé

Utilisez cette page si vous avez suivi [Rejourney auto-hébergé](/docs/selfhosted) et que quelque chose échoue ou se comporte étrangement. Les commandes sont exécutées à partir du **racine du référentiel** (où réside le `docker-compose.selfhosted.yml`).

---

## Vérifications rapides

### Statut des services

```bash
./scripts/selfhosted/deploy.sh status
```

### Journaux API

```bash
./scripts/selfhosted/deploy.sh logs api
```

### Télécharger les journaux de relais

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### Journaux des travailleurs

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. L'installation ou la mise à jour échoue avant ou pendant le démarrage

### Symptômes

- `bootstrap` quitte une valeur différente de zéro
- les services d'application ne deviennent jamais sains
- `status` affiche API ou des travailleurs en attente de démarrage
- l'installation ou la mise à jour se termine avec `Database authentication failed before bootstrap.`

### Chèques

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

Causes courantes :

- mauvais `DATABASE_URL`
- incompatibilité des informations d'identification (par exemple, lors d'un déploiement antérieur ayant échoué)
- manquant `STORAGE_ENCRYPTION_KEY`
- Informations d'identification S3 non valides
- URL de point de terminaison externe S3 cassée
- sur **ARM64**, prise en charge des images manquantes (définissez `DOCKER_DEFAULT_PLATFORM=linux/amd64` ou utilisez `./scripts/selfhosted/deploy.sh`, qui le définit lorsqu'il n'est pas défini)

Récupération:

1. Si vous disposez toujours du `.env.selfhosted` d'origine, restaurez-le et exécutez :

```bash
./scripts/selfhosted/deploy.sh update
```

2. Si vous n'avez pas besoin des anciennes données, effacez et réinstallez :

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**Messages de schéma/migration :** Lors d'une installation normale, la base de données démarre vide et le bootstrap configure tout. Si vous accédez au **restauré Postgres à partir d'une sauvegarde** sur un nouveau serveur mais que les métadonnées de migration sont manquantes, ou si vous avez pointé la pile vers le **mauvaise base de données**, le bootstrap peut se terminer avec une erreur concernant une base de données incohérente au lieu d'écraser vos données. Sauf si vous effectuez une récupération avancée, corrigez `DATABASE_URL` et restaurez une sauvegarde cohérente, ou démarrez à partir d'un volume propre. Pour une récupération délibérée par migration uniquement, certaines configurations utilisent `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` dans `.env.selfhosted` (voir la documentation du responsable ou l'assistance avant de l'utiliser).

### Réparer

1. Si vous disposez du `.env.selfhosted` d'origine, restaurez-le et réexécutez :

```bash
./scripts/selfhosted/deploy.sh update
```

2. Si vous n'avez pas le `.env.selfhosted` d'origine, essuyez et réinstallez :

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update` réexécute la synchronisation du schéma, de la graine et du point de terminaison de stockage. `reset` supprime les conteneurs et les volumes de données auto-hébergés afin qu'une nouvelle installation puisse générer de nouvelles informations d'identification en toute sécurité.

---

## 2. Les sessions sont comptées mais le Replay reste vide

### Ce que cela signifie habituellement maintenant

Avec l’architecture actuelle, il s’agit généralement de deux choses :

- `ingest-upload` n'a pas pu stocker les octets de l'artefact
- `ingest-worker` n'a pas pu traiter un artefact téléchargé

L'appareil ne télécharge plus directement sur MinIO/S3, donc l'accessibilité du bucket depuis le téléphone n'est plus le principal suspect.

### Chèques

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

Rechercher:

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### Causes courantes

- informations d'identification S3 incorrectes dans `.env.selfhosted`
- godet externe S3 manquant
- point de terminaison externe S3 inaccessible depuis le réseau Docker
- relais de téléchargement défectueux
- un travailleur bloqué en réessayant des artefacts ayant échoué

### Réparer

- vérifier les valeurs `S3_*`
- si vous avez modifié la configuration du stockage, réexécutez :

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. Le tableau de bord se charge, mais les appels d'authentification ou API échouent

### Chèques

- l'hôte du tableau de bord DNS pointe vers le serveur
- L'hôte API DNS pointe vers le serveur
- L'hôte d'ingestion DNS pointe vers le serveur
- les ports `80` et `443` sont ouverts
- Let’s Encrypt a délivré des certificats

Inspecter:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS ou problèmes de certificat

Traefik gère automatiquement les certificats.

### Chèques

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

Assurez-vous que les deux noms correspondent au serveur exécutant la pile.

Si DNS était erroné lors de la première installation, corrigez DNS et réexécutez :

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. S3 externe fonctionne en CLI, mais Rejourney ne peut pas télécharger

N'oubliez pas que le chemin de téléchargement est côté serveur.

Le chemin réseau important est :

- Conteneur `ingest-upload` -> votre point de terminaison S3

Testez à partir du serveur en examinant les journaux de relais et en confirmant le point de terminaison/le compartiment/les clés dans `.env.selfhosted`.

Si vous les avez modifiés, réexécutez :

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. Installation intégrée de MinIO, mais les artefacts échouent toujours

### Chèques

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

Le one-shot `minio-setup` doit créer le bucket nommé `S3_BUCKET`.

Si vous avez modifié le nom du bucket après la première installation, exécutez :

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. Les pages de facturation affichent la facturation désactivée

Cela est attendu à moins que les clés Stripe ne soient configurées.

La pile ne désactive plus la facturation car elle est « auto-hébergée ». Il désactive la facturation car Stripe n'est pas configuré.

Si vous ne définissez pas de clés Stripe :

- L'interface utilisateur de facturation reste dans l'état auto-hébergé/illimité
- La caisse Stripe et les webhooks restent désactivés

---

## 8. Le point de terminaison de stockage dans Postgres est erroné après la modification de `.env.selfhosted`

Courir:

```bash
./scripts/selfhosted/deploy.sh update
```

Le chemin de mise à jour réexécute le bootstrap et resynchronise la ligne `storage_endpoints` active.

---

## 9. Besoin d'arrêter les services sans perdre de données

Utiliser:

```bash
./scripts/selfhosted/deploy.sh stop
```

Cela arrête uniquement les conteneurs. Il ne supprime pas les volumes.

---

## 10. Besoin de journaux plus profonds pour un service

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
