# Production S3 and R2 Backup Formats

Last updated: 2026-03-12

This document describes the real artifact formats used by production ingest, retention, and backup.

The most important distinction is:

- Production S3 stores the canonical recording artifacts used by replay and retention.
- Cloudflare R2 stores backup copies under `backups/`.
- As of the current ingest and backup code, one legacy mismatch is repaired automatically in source S3: hierarchy objects stored as raw JSON under a `.json.gz` key.
- Screenshot artifacts in production S3 still keep their existing `.tar.gz` key shape even though most current payloads are not real tar archives.
- The backup job now repacks screenshot artifacts into real `tar.gz` archives in R2 by default, so downloaded backup screenshots are Archive Utility friendly.

## Canonical Key Layout

Current session artifacts live under:

```text
tenant/{teamId}/project/{projectId}/sessions/{sessionId}/
├── events/
│   └── events_{batchIndex}_{timestamp}.json.gz
├── hierarchy/
│   └── {timestamp}.json.gz
└── screenshots/
    └── {timestamp}.tar.gz
```

Older sessions may still use the legacy prefix:

```text
sessions/{sessionId}/
├── hierarchy/
│   └── {timestamp}.json.gz
└── screenshots/
    └── {timestamp}.tar.gz
```

R2 backups mirror the source key under `backups/`, for example:

```text
backups/tenant/{teamId}/project/{projectId}/sessions/{sessionId}/...
backups/sessions/{sessionId}/...
```

## Artifact Format Matrix

| Artifact | Key suffix | Live S3 payload | Fresh R2 backup payload | Archive Utility compatible |
| --- | --- | --- | --- | --- |
| Events | `.json.gz` | Real gzip-compressed JSON | Same as S3 | Yes |
| Hierarchy | `.json.gz` | Real gzip JSON now; some older objects were raw JSON mislabeled as gzip | Real gzip JSON after a fresh backup with the current repair logic | Yes, after repair |
| Screenshots | `.tar.gz` | Usually `gzip(custom binary frame bundle)`; some very old iOS artifacts are real `tar.gz` | Real `tar.gz` archive of JPEG files | Yes, after fresh backup |

## Current Behavior by Artifact

### Events

- SDK uploads real gzip-compressed JSON.
- Ingest stores the object as `application/gzip`.
- Backup copies the object without transformation.
- Downloaded event artifacts should open normally with macOS Archive Utility, `gunzip`, or `gzip -d`.

### Hierarchy

- Current SDKs upload real gzip-compressed JSON.
- Older SDK builds sometimes uploaded raw JSON while still using a `.json.gz` key.
- Ingest now normalizes those legacy hierarchy uploads in S3 before marking the artifact ready.
- The ingest worker applies the same normalization path for recovered or auto-finalized hierarchy artifacts.
- The backup job also repairs this exact legacy case in source S3 before uploading to R2.

Result:

- New sessions should land in the correct gzip format immediately.
- Old sessions can be corrected by rerunning backup with the current job code.
- After that repair, hierarchy files in both source S3 and fresh R2 backups are real gzip files and should unzip normally.

### Screenshots

- The key suffix is still `.tar.gz`.
- For current iOS and Android SDKs, the payload inside gzip is a custom binary frame bundle, not a tar archive.
- Very old iOS sessions may still contain a real tarball of JPEG files.
- Replay, thumbnails, and retention depend on this existing key contract in production S3, so live storage keeps the current naming and payload behavior.

Result:

- Screenshot artifacts are valid for the product.
- Production S3 screenshot artifacts are not guaranteed to open in Archive Utility.
- Fresh R2 backups are repacked to real `tar.gz` archives and should open normally.

## What the Backup Job Repairs

The current backup job intentionally repairs only one legacy issue:

- `hierarchy/*.json.gz` objects whose bytes are raw JSON instead of gzip

When it encounters one of those artifacts, it:

1. Downloads the source object.
2. Confirms the payload is valid JSON.
3. Gzip-compresses it.
4. Writes the repaired object back to source S3.
5. Uploads the repaired bytes to R2.

This keeps source S3 and R2 aligned after repair.

The backup job also repacks screenshot artifacts for R2:

1. If the source screenshot is already a real tar archive inside gzip, it is kept as-is.
2. If the source screenshot is the current binary frame bundle format, the backup job extracts the JPEG frames and writes a real `tar.gz` archive for R2.
3. If the screenshot payload is unrecognized, the job logs a warning and backs it up unchanged.

## What a Full Re-Backup Fixes

If you delete:

- rows in `session_backup_log`
- the R2 prefix `backups/tenant/`

and then rerun the current backup job, the outcome is:

- old and new `events/*.json.gz` remain valid gzip JSON
- old mis-labeled `hierarchy/*.json.gz` objects are repaired and re-backed-up as real gzip JSON
- `screenshots/*.tar.gz` in production S3 stay unchanged
- `screenshots/*.tar.gz` in fresh R2 backups become real `tar.gz` archives when the source format is recognized

So a full re-backup fixes the legacy hierarchy problem and also makes screenshot downloads Archive Utility friendly in R2.

## Headers and Metadata

All three artifact types are stored with:

- `Content-Type: application/gzip`
- no `Content-Encoding`

The gzip encoding is part of the stored object bytes, not HTTP transfer encoding.

Artifact metadata is tracked in `recording_artifacts`, including:

- `kind`
- `s3_object_key`
- `size_bytes`
- `frame_count`
- `status`
- `endpoint_id`

## Reading and Extracting Artifacts

For normal replay and product behavior, use the backend readers and services. They already handle:

- legacy raw hierarchy JSON under `.json.gz`
- screenshot binary bundles
- legacy screenshot tarballs

For offline backup inspection:

- `events/*.json.gz` and repaired `hierarchy/*.json.gz`: use Archive Utility, `gunzip`, or `gzip -d`
- production S3 `screenshots/*.tar.gz`: use the extraction helper instead of Archive Utility
- fresh R2 backup `screenshots/*.tar.gz`: Archive Utility should work, and the extraction helper still works too

```bash
node scripts/extract-session-backup.mjs ./session-dir/ --out ./frames/
```

## Recommended Mental Model

- Treat production S3 as the canonical runtime storage.
- Treat R2 `backups/` as a backup copy optimized for recoverability and human download.
- Expect `events` and `hierarchy` downloads to behave like normal gzip files after the current repair path runs.
- Expect production S3 screenshots to require Rejourney-aware extraction, but fresh R2 screenshot backups to be standard `tar.gz` archives.

## March 2026 Backup Changes

The current ingest, worker, and backup flow now does all of the following:

- New `hierarchy/*.json.gz` uploads are normalized to real gzip before the artifact is marked ready.
- Recovered or auto-finalized hierarchy artifacts go through the same normalization path.
- The backup job repairs old raw-JSON hierarchy objects in source S3 before copying them to R2.
- The backup job repacks screenshot binary bundles into real `tar.gz` archives in R2 by default.
- The backup manifest records both the source object size and the backup object size when they differ.
- GitHub Actions now verifies that `k8s/archive.yaml` embeds the same backup script as `scripts/k8s/session-backup.mjs` before deploy.
- The CronJob manifest explicitly enables `SESSION_BACKUP_REPAIR_LEGACY_HIERARCHY_GZIP=1` and `SESSION_BACKUP_ARCHIVE_FRIENDLY_SCREENSHOTS=1`.

This means a fresh re-backup after cleanup produces:

- archive-friendly `events/*.json.gz`
- archive-friendly `hierarchy/*.json.gz`
- archive-friendly `screenshots/*.tar.gz` in R2

while leaving production S3 behavior compatible with replay, thumbnails, and retention.

## Fresh-Start Reset Procedure

If you want to restart backup from a clean slate:

1. Suspend the live `session-backup` CronJob if you do not want the old deployment to run during reset.
2. Clear `session_backup_log`.
3. Clear the R2 prefix `backups/tenant/`.
4. Push the repo so GitHub Actions deploys the updated `k8s/archive.yaml`.
5. Let the CronJob run on schedule or trigger it manually.

Expected behavior after deploy:

- the deployed CronJob uses the embedded script from `k8s/archive.yaml`
- the workflow blocks deploys if `archive.yaml` is out of sync with `scripts/k8s/session-backup.mjs`
- new backups start from an empty log and empty `backups/tenant/` prefix
- old sessions are reprocessed with hierarchy repair and screenshot repacking
