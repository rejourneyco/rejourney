# Sauvegarde et restauration auto-hébergées

Si vous exécutez Rejourney avec [auto-hébergement Docker Compose](/docs/selfhosted), traitez-les comme **critique** pour conserver des copies de :

- Postgres
- `.env.selfhosted`
- Données MinIO si vous utilisez le MinIO intégré

---

## Sauvegarde rapide

Utilisez l'assistant fourni :

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Ce qu'il fait :

- Postgres dump à chaque fois
- Instantané Redis lorsqu'il est disponible
- `.env.selfhosted` copie à chaque fois
- Données d'objet MinIO lorsque `--full` est utilisé et que le MinIO intégré est activé

---

## Que sauvegarder

### Sauvegardez toujours

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### Économisez en utilisant le MinIO intégré

- `backups/minio-*.tar.gz`

Si vous utilisez un S3 externe, vos enregistrements vivent dans ce compartiment au lieu du volume local MinIO, de sorte que la base de données plus `.env.selfhosted` constituent les sauvegardes locales minimales.

---

## Restaurer la commande

### 1. Recréez la configuration de la pile

Remettez le `.env.selfhosted` enregistré dans la racine du dépôt.

### 2. Démarrez l'infrastructure et le bootstrap

```bash
./scripts/selfhosted/deploy.sh update
```

Cela ramène les services et recrée la ligne `storage_endpoints` à partir de votre configuration enregistrée.

### 3. Restaurer Postgres

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. Restaurez MinIO, le cas échéant

Si vous utilisez le MinIO intégré et que vous avez effectué une sauvegarde `--full` :

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. Redémarrez les services de l'application

```bash
./scripts/selfhosted/deploy.sh update
```

Cela réexécute le bootstrap et redémarre les services de l'application après la restauration.

---

## Calendrier recommandé

Sauvegarde quotidienne de la base de données :

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

Sauvegarde complète hebdomadaire avec les données MinIO :

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## Remarques sur la reprise après sinistre

Vous avez besoin de tous les éléments suivants pour restaurer entièrement un déploiement MinIO intégré :

- `.env.selfhosted`
- Sauvegarde Postgres
- Sauvegarde MinIO

Sans `.env.selfhosted`, vous risquez de perdre l'accès aux informations d'identification de stockage chiffrées dans Postgres, car `STORAGE_ENCRYPTION_KEY` y réside.

---

## Liste de contrôle de vérification

Après une restauration :

1. exécuter `./scripts/selfhosted/deploy.sh status`
2. connectez-vous au tableau de bord
3. ouvrir un projet existant
4. ouvrir un replay existant
5. enregistrer une nouvelle courte session et vérifier qu'elle apparaît

Si l'ingestion de relecture échoue après la restauration, vérifiez :

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## Requêtes de vérification multi-buckets

Exécutez ces vérifications SQL avant d'activer les points de terminaison multi-primaires pondérés ou après avoir modifié les compartiments à l'échelle du projet.

```sql
-- Sessions whose ready artifacts are split across multiple endpoint_ids.
SELECT
  ra.session_id,
  COUNT(DISTINCT COALESCE(ra.endpoint_id, 'global-default')) AS endpoint_count
FROM recording_artifacts ra
WHERE ra.status = 'ready'
GROUP BY ra.session_id
HAVING COUNT(DISTINCT COALESCE(ra.endpoint_id, 'global-default')) > 1
ORDER BY endpoint_count DESC, ra.session_id
LIMIT 200;
```

```sql
-- Ready artifacts with missing/invalid endpoint mapping.
SELECT
  ra.id,
  ra.session_id,
  ra.kind,
  ra.endpoint_id,
  ra.s3_object_key
FROM recording_artifacts ra
LEFT JOIN storage_endpoints se ON se.id = ra.endpoint_id
WHERE ra.status = 'ready'
  AND ra.endpoint_id IS NOT NULL
  AND se.id IS NULL
ORDER BY ra.session_id, ra.kind
LIMIT 500;
```

```sql
-- Backup success ratio by project (uses session_backup_log rows as successful backups).
SELECT
  s.project_id,
  COUNT(*) FILTER (WHERE bl.session_id IS NOT NULL) AS backed_up_sessions,
  COUNT(*) AS eligible_sessions,
  ROUND(
    (COUNT(*) FILTER (WHERE bl.session_id IS NOT NULL)::numeric / NULLIF(COUNT(*), 0)) * 100,
    2
  ) AS backup_coverage_percent
FROM sessions s
LEFT JOIN session_backup_log bl ON bl.session_id = s.id
WHERE s.status IN ('ready', 'completed')
GROUP BY s.project_id
ORDER BY backup_coverage_percent ASC, eligible_sessions DESC;
```
