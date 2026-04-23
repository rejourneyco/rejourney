#!/bin/sh
# Keep this script in sync with the local-pvc-metrics-script ConfigMap in
# k8s/exporters.yaml.
set -eu

STORAGE_ROOT="${STORAGE_ROOT:-/host-storage}"
OUT_FILE="${OUT_FILE:-/textfile/rejourney-local-pvc.prom}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-120}"
NODE_NAME="${NODE_NAME:-unknown}"

collect_once() {
  tmp_file="${OUT_FILE}.tmp"

  {
    echo '# HELP rejourney_local_pvc_used_bytes Local-path PVC disk usage on this node.'
    echo '# TYPE rejourney_local_pvc_used_bytes gauge'
    echo '# HELP rejourney_local_pvc_inodes_used Local-path PVC inode count on this node.'
    echo '# TYPE rejourney_local_pvc_inodes_used gauge'

    if [ -d "$STORAGE_ROOT" ]; then
      find "$STORAGE_ROOT" -mindepth 1 -maxdepth 1 -type d | sort | while IFS= read -r dir; do
        base="$(basename "$dir")"
        case "$base" in
          pvc-*_*_*) ;;
          *) continue ;;
        esac

        rest="${base#pvc-}"
        pvc_uid="${rest%%_*}"
        rest="${rest#*_}"
        namespace="${rest%%_*}"
        claim="${rest#*_}"

        used_kib="$(du -sk "$dir" 2>/dev/null | awk 'NR==1 { print $1 }')"
        inodes_used="$(du -s --inodes "$dir" 2>/dev/null | awk 'NR==1 { print $1 }')"
        if [ -z "$inodes_used" ]; then
          inodes_used="$(find "$dir" -xdev 2>/dev/null | wc -l | awk 'NR==1 { print $1 }')"
        fi

        used_kib="${used_kib:-0}"
        inodes_used="${inodes_used:-0}"
        used_bytes=$((used_kib * 1024))

        printf 'rejourney_local_pvc_used_bytes{node="%s",namespace="%s",persistentvolumeclaim="%s",pvc_uid="%s"} %s\n' \
          "$NODE_NAME" "$namespace" "$claim" "$pvc_uid" "$used_bytes"
        printf 'rejourney_local_pvc_inodes_used{node="%s",namespace="%s",persistentvolumeclaim="%s",pvc_uid="%s"} %s\n' \
          "$NODE_NAME" "$namespace" "$claim" "$pvc_uid" "$inodes_used"
      done
    fi
  } >"$tmp_file"

  mv "$tmp_file" "$OUT_FILE"
}

while true; do
  collect_once
  sleep "$INTERVAL_SECONDS"
done
