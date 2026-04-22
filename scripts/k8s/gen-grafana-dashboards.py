#!/usr/bin/env python3
"""Generate rejourney Grafana dashboards and emit k8s/grafana-dashboards.yaml.

Usage:
    python3 scripts/k8s/gen-grafana-dashboards.py

Writes k8s/grafana-dashboards.yaml (one ConfigMap, one JSON key per dashboard).
Grafana's file-provider auto-imports + hot-reloads on configmap change.
"""
import json, os, copy

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_YAML = os.path.join(REPO_ROOT, "k8s", "grafana-dashboards.yaml")

DATASOURCE = {"type": "prometheus", "uid": "victoria-metrics"}

NEXT_ID = [0]
def nid():
    NEXT_ID[0] += 1
    return NEXT_ID[0]

def reset_ids():
    NEXT_ID[0] = 0

def target(expr, legend="", instant=False, ref="A"):
    return {
        "datasource": DATASOURCE,
        "expr": expr,
        "legendFormat": legend,
        "refId": ref,
        "instant": instant,
    }

def stat(title, expr, x, y, w=4, h=4, unit="short", legend="", mappings=None,
         thresholds=None, decimals=None, color_mode="value"):
    p = {
        "id": nid(),
        "type": "stat",
        "title": title,
        "datasource": DATASOURCE,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": [target(expr, legend)],
        "options": {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "colorMode": color_mode,
            "graphMode": "area",
            "textMode": "auto",
            "justifyMode": "auto",
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "mappings": mappings or [],
                "thresholds": thresholds or {"mode": "absolute", "steps": [{"color": "green", "value": None}]},
            },
            "overrides": [],
        },
    }
    if decimals is not None:
        p["fieldConfig"]["defaults"]["decimals"] = decimals
    return p

def ts(title, targets, x, y, w=12, h=8, unit="short", stack=None, fill=10, decimals=None,
       min_val=None, max_val=None, legend_calcs=("mean", "lastNotNull", "max")):
    tgts = []
    for i, t in enumerate(targets):
        if isinstance(t, dict):
            tgts.append(t)
        else:
            expr, legend = t if isinstance(t, tuple) else (t, "")
            tgts.append(target(expr, legend, ref=chr(ord("A") + i)))
    defaults = {
        "unit": unit,
        "custom": {
            "drawStyle": "line",
            "lineInterpolation": "smooth",
            "lineWidth": 2,
            "fillOpacity": fill,
            "gradientMode": "opacity",
            "showPoints": "never",
            "pointSize": 5,
            "stacking": {"mode": stack or "none", "group": "A"},
            "axisPlacement": "auto",
            "axisLabel": "",
            "scaleDistribution": {"type": "linear"},
            "hideFrom": {"tooltip": False, "viz": False, "legend": False},
            "thresholdsStyle": {"mode": "off"},
        },
    }
    if min_val is not None: defaults["min"] = min_val
    if max_val is not None: defaults["max"] = max_val
    if decimals is not None: defaults["decimals"] = decimals
    return {
        "id": nid(),
        "type": "timeseries",
        "title": title,
        "datasource": DATASOURCE,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": tgts,
        "fieldConfig": {"defaults": defaults, "overrides": []},
        "options": {
            "legend": {"displayMode": "table", "placement": "bottom", "calcs": list(legend_calcs)},
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
    }

def gauge(title, expr, x, y, w=6, h=6, unit="percent", max_val=100, steps=None):
    steps = steps or [
        {"color": "green", "value": None},
        {"color": "orange", "value": 70},
        {"color": "red", "value": 90},
    ]
    return {
        "id": nid(),
        "type": "gauge",
        "title": title,
        "datasource": DATASOURCE,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": [target(expr)],
        "options": {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "showThresholdLabels": False,
            "showThresholdMarkers": True,
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "min": 0,
                "max": max_val,
                "thresholds": {"mode": "absolute", "steps": steps},
            },
            "overrides": [],
        },
    }

def bargauge(title, expr, x, y, w=12, h=8, unit="percent", legend=""):
    return {
        "id": nid(),
        "type": "bargauge",
        "title": title,
        "datasource": DATASOURCE,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": [target(expr, legend)],
        "options": {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "orientation": "horizontal",
            "displayMode": "gradient",
            "showUnfilled": True,
            "valueMode": "color",
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "min": 0,
                "max": 100 if unit == "percent" else None,
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "green", "value": None},
                    {"color": "orange", "value": 70},
                    {"color": "red", "value": 90},
                ]},
            },
            "overrides": [],
        },
    }

def table(title, targets, x, y, w=24, h=10):
    tgts = []
    for i, t in enumerate(targets):
        if isinstance(t, dict): tgts.append(t)
        else:
            expr, legend = t if isinstance(t, tuple) else (t, "")
            t_ = target(expr, legend, instant=True, ref=chr(ord("A") + i))
            t_["format"] = "table"
            tgts.append(t_)
    return {
        "id": nid(),
        "type": "table",
        "title": title,
        "datasource": DATASOURCE,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": tgts,
        "transformations": [{"id": "merge"}],
        "fieldConfig": {"defaults": {"custom": {"align": "auto"}}, "overrides": []},
        "options": {"showHeader": True, "footer": {"show": False}},
    }

def row(title, y, collapsed=False):
    return {
        "id": nid(),
        "type": "row",
        "title": title,
        "collapsed": collapsed,
        "gridPos": {"x": 0, "y": y, "w": 24, "h": 1},
        "panels": [],
    }

def dashboard(uid, title, tags, panels, refresh="30s", time_from="now-3h"):
    return {
        "uid": uid,
        "title": title,
        "tags": tags + ["rejourney"],
        "timezone": "browser",
        "schemaVersion": 39,
        "version": 1,
        "refresh": refresh,
        "time": {"from": time_from, "to": "now"},
        "timepicker": {"refresh_intervals": ["10s", "30s", "1m", "5m", "15m", "1h"]},
        "panels": panels,
        "templating": {"list": []},
        "annotations": {"list": []},
        "editable": True,
        "fiscalYearStartMonth": 0,
        "graphTooltip": 1,
        "liveNow": False,
        "weekStart": "",
    }

def write_configmap(dashes):
    lines = [
        "# Rejourney Grafana dashboards — provisioned as a file-based provider.",
        "#",
        "# One ConfigMap, one JSON key per dashboard. Grafana's file-provider auto-imports",
        "# and hot-reloads on configmap change (updateIntervalSeconds in k8s/grafana.yaml).",
        "#",
        "# DO NOT HAND-EDIT — regenerate via:",
        "#   python3 scripts/k8s/gen-grafana-dashboards.py",
        "",
        "apiVersion: v1",
        "kind: ConfigMap",
        "metadata:",
        "  name: grafana-dashboards",
        "  namespace: rejourney",
        "  # NOTE: intentionally NOT labeled app.kubernetes.io/part-of=rejourney.",
        "  # This CM is ~290KB — too large for client-side apply's last-applied",
        "  # annotation (262144 byte limit). deploy-release.sh applies it with",
        "  # --server-side; keeping it outside the prune label scope prevents the",
        "  # bulk apply --prune pass from deleting it.",
        "  labels:",
        "    grafana_dashboard: \"1\"",
        "data:",
    ]
    for name, dash in dashes:
        lines.append(f"  {name}.json: |")
        for ln in json.dumps(dash, indent=2).split("\n"):
            lines.append(f"    {ln}")
    with open(OUT_YAML, "w") as f:
        f.write("\n".join(lines) + "\n")
    return OUT_YAML

# ============================================================
# 00 — Overview
# ============================================================
def d_overview():
    reset_ids()
    panels = []
    y = 0

    panels.append(row("Cluster Health", y)); y += 1
    panels.append(stat("Node Ready", 'kube_node_status_condition{condition="Ready",status="true"}', 0, y, w=4, h=4,
                       mappings=[{"type": "value", "options": {"1": {"text": "Ready", "color": "green"}, "0": {"text": "NotReady", "color": "red"}}}]))
    panels.append(stat("Pods Running", 'count(kube_pod_status_phase{phase="Running",namespace="rejourney"}==1)', 4, y, w=4, h=4))
    panels.append(stat("Pods NotReady", 'count(kube_pod_status_ready{condition="true",namespace="rejourney"}==0) OR vector(0)', 8, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 1}]}))
    panels.append(stat("Pods Pending", 'count(kube_pod_status_phase{phase="Pending",namespace="rejourney"}==1) OR vector(0)', 12, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}]}))
    panels.append(stat("Restarts (24h)", 'sum(increase(kube_pod_container_status_restarts_total{namespace="rejourney"}[24h]))', 16, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 5}]}))
    panels.append(stat("Scrape Targets Up", 'sum(up)', 20, y, w=4, h=4))
    y += 4

    panels.append(row("Core Services", y)); y += 1
    panels.append(stat("PostgreSQL (CNPG)", 'cnpg_collector_up{namespace="rejourney"}', 0, y, w=4, h=4,
                       mappings=[{"type": "value", "options": {"1": {"text": "UP", "color": "green"}, "0": {"text": "DOWN", "color": "red"}}}]))
    panels.append(stat("Redis Master", 'redis_up', 4, y, w=4, h=4,
                       mappings=[{"type": "value", "options": {"1": {"text": "UP", "color": "green"}, "0": {"text": "DOWN", "color": "red"}}}]))
    panels.append(stat("Traefik", 'traefik_config_last_reload_success', 8, y, w=4, h=4,
                       mappings=[{"type": "value", "options": {"1": {"text": "OK", "color": "green"}, "0": {"text": "ERR", "color": "red"}}}]))
    panels.append(stat("API Replicas Ready", 'kube_deployment_status_replicas_ready{namespace="rejourney",deployment="api"}', 12, y, w=4, h=4))
    panels.append(stat("Workers Ready", 'sum(kube_deployment_status_replicas_ready{namespace="rejourney",deployment=~".*-worker"})', 16, y, w=4, h=4))
    panels.append(stat("Last Backup Age", 'time() - cnpg_collector_last_available_backup_timestamp{namespace="rejourney"}', 20, y, w=4, h=4, unit="s",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 3600 * 26}, {"color": "red", "value": 3600 * 48}]}))
    y += 4

    panels.append(row("Throughput", y)); y += 1
    panels.append(ts("HTTP Requests / sec (Traefik entrypoint)",
                     [('sum by (entrypoint)(rate(traefik_entrypoint_requests_total[2m]))', "{{entrypoint}}")],
                     0, y, w=12, h=8, unit="reqps"))
    panels.append(ts("HTTP p95 latency (router)",
                     [('histogram_quantile(0.95, sum by (router, le)(rate(traefik_router_request_duration_seconds_bucket[5m])))', "{{router}}")],
                     12, y, w=12, h=8, unit="s"))
    y += 8

    panels.append(ts("DB Transactions / sec",
                     [('rate(cnpg_pg_stat_database_xact_commit{datname="rejourney",namespace="rejourney"}[2m])', "commit/s"),
                      ('rate(cnpg_pg_stat_database_xact_rollback{datname="rejourney",namespace="rejourney"}[2m])', "rollback/s")],
                     0, y, w=12, h=8, unit="ops"))
    panels.append(ts("Redis Commands / sec",
                     [('rate(redis_commands_processed_total[2m])', "commands/s"),
                      ('rate(redis_commands_failed_calls_total[2m])', "failed/s")],
                     12, y, w=12, h=8, unit="ops"))
    y += 8

    panels.append(row("Application Pipeline", y)); y += 1
    panels.append(stat("Artifacts created (1h)", 'sum(rejourney_artifacts_created_recent_created_count)', 0, y, w=4, h=4))
    panels.append(stat("Artifacts completed (1h)", 'sum(rejourney_artifacts_completed_recent_completed_count)', 4, y, w=4, h=4))
    panels.append(stat("Artifacts stalled", 'sum(rejourney_artifacts_stalled_stalled_count)', 8, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 10}]}))
    panels.append(stat("Backup queue depth", 'sum(rejourney_session_backup_queue_queued)', 12, y, w=4, h=4))
    panels.append(stat("Backup queue oldest age", 'max(rejourney_session_backup_queue_oldest_age_seconds)', 16, y, w=4, h=4, unit="s"))
    panels.append(stat("Upload p95 (recent)", 'max(rejourney_artifacts_upload_latency_recent_p95_seconds)', 20, y, w=4, h=4, unit="s"))
    y += 4

    return dashboard("rejourney-overview", "00 — Overview", ["overview"], panels)

# ============================================================
# 10 — Kubernetes
# ============================================================
def d_kubernetes():
    reset_ids()
    panels = []
    y = 0

    panels.append(row("Node", y)); y += 1
    panels.append(gauge("CPU Usage %",
                        '(1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))) * 100',
                        0, y, w=6, h=6, unit="percent"))
    panels.append(gauge("Memory Usage %",
                        '(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100',
                        6, y, w=6, h=6, unit="percent"))
    panels.append(gauge("Root Disk Usage %",
                        '(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100',
                        12, y, w=6, h=6, unit="percent"))
    panels.append(stat("Load 1 / 5 / 15",
                       'node_load1', 18, y, w=6, h=6, unit="short"))
    y += 6

    panels.append(ts("CPU Usage by mode",
                     [('sum by (mode)(rate(node_cpu_seconds_total{mode!="idle"}[2m])) / scalar(count(node_cpu_seconds_total{mode="idle"}))', "{{mode}}")],
                     0, y, w=12, h=8, unit="percentunit", stack="normal", max_val=1))
    panels.append(ts("Memory breakdown",
                     [('node_memory_MemTotal_bytes - node_memory_MemFree_bytes - node_memory_Buffers_bytes - node_memory_Cached_bytes', "used"),
                      ('node_memory_Buffers_bytes', "buffers"),
                      ('node_memory_Cached_bytes', "cached"),
                      ('node_memory_MemFree_bytes', "free")],
                     12, y, w=12, h=8, unit="bytes", stack="normal"))
    y += 8

    panels.append(ts("Network I/O (bytes/s)",
                     [('sum by (device)(rate(node_network_receive_bytes_total{device!~"lo|cali.*|cni.*|veth.*|docker.*"}[2m]))', "rx — {{device}}"),
                      ('-sum by (device)(rate(node_network_transmit_bytes_total{device!~"lo|cali.*|cni.*|veth.*|docker.*"}[2m]))', "tx — {{device}}")],
                     0, y, w=12, h=8, unit="Bps"))
    panels.append(ts("Disk I/O (bytes/s)",
                     [('sum by (device)(rate(node_disk_read_bytes_total[2m]))', "read — {{device}}"),
                      ('-sum by (device)(rate(node_disk_written_bytes_total[2m]))', "write — {{device}}")],
                     12, y, w=12, h=8, unit="Bps"))
    y += 8

    panels.append(row("Pods (rejourney namespace)", y)); y += 1
    panels.append(ts("Pod CPU usage",
                     [('sum by (pod)(rate(container_cpu_usage_seconds_total{namespace="rejourney",container!="",container!="POD"}[2m]))', "{{pod}}")],
                     0, y, w=12, h=10, unit="none", decimals=3))
    panels.append(ts("Pod Memory (working set)",
                     [('sum by (pod)(container_memory_working_set_bytes{namespace="rejourney",container!="",container!="POD"})', "{{pod}}")],
                     12, y, w=12, h=10, unit="bytes"))
    y += 10

    panels.append(ts("Pod Restarts (15m delta)",
                     [('sum by (pod)(increase(kube_pod_container_status_restarts_total{namespace="rejourney"}[15m]))', "{{pod}}")],
                     0, y, w=12, h=8, unit="short"))
    panels.append(table("Pod Status",
                        [('kube_pod_info{namespace="rejourney"}', ""),
                         ('kube_pod_status_phase{namespace="rejourney"}==1', ""),
                         ('kube_pod_container_status_ready{namespace="rejourney"}', "")],
                        12, y, w=12, h=8))
    y += 8

    panels.append(row("PVCs", y)); y += 1
    panels.append(bargauge("PVC Usage %",
                           '100 * sum by (persistentvolumeclaim)(kubelet_volume_stats_used_bytes{namespace="rejourney"}) / sum by (persistentvolumeclaim)(kubelet_volume_stats_capacity_bytes{namespace="rejourney"})',
                           0, y, w=12, h=8, unit="percent", legend="{{persistentvolumeclaim}}"))
    panels.append(ts("PVC Used (bytes)",
                     [('sum by (persistentvolumeclaim)(kubelet_volume_stats_used_bytes{namespace="rejourney"})', "{{persistentvolumeclaim}}")],
                     12, y, w=12, h=8, unit="bytes"))
    y += 8

    return dashboard("rejourney-k8s", "10 — Kubernetes", ["kubernetes"], panels)

# ============================================================
# 20 — PostgreSQL (CNPG)
# ============================================================
def d_postgres():
    reset_ids()
    panels = []
    y = 0

    panels.append(row("Cluster Status", y)); y += 1
    panels.append(stat("Collector Up", 'cnpg_collector_up{namespace="rejourney"}', 0, y, w=4, h=4,
                       mappings=[{"type": "value", "options": {"1": {"text": "UP", "color": "green"}, "0": {"text": "DOWN", "color": "red"}}}]))
    panels.append(stat("Role", 'cnpg_pg_replication_in_recovery{namespace="rejourney"}', 4, y, w=4, h=4,
                       mappings=[{"type": "value", "options": {"0": {"text": "PRIMARY", "color": "green"}, "1": {"text": "REPLICA", "color": "blue"}}}]))
    panels.append(stat("PostgreSQL Version", 'cnpg_collector_postgres_version{namespace="rejourney"}', 8, y, w=4, h=4, decimals=1))
    panels.append(stat("Uptime", 'time() - cnpg_pg_postmaster_start_time{namespace="rejourney"}', 12, y, w=4, h=4, unit="s"))
    panels.append(stat("Streaming Replicas", 'cnpg_pg_replication_streaming_replicas{namespace="rejourney"}', 16, y, w=4, h=4))
    panels.append(stat("Fencing", 'cnpg_collector_fencing_on{namespace="rejourney"}', 20, y, w=4, h=4,
                       mappings=[{"type": "value", "options": {"0": {"text": "OFF", "color": "green"}, "1": {"text": "FENCED", "color": "red"}}}]))
    y += 4

    panels.append(row("Connections", y)); y += 1
    panels.append(gauge("Connection Utilization %",
                        '100 * pg_connections_count{server="postgres-rw.rejourney.svc.cluster.local:5432"} / pg_settings_max_connections{server="postgres-rw.rejourney.svc.cluster.local:5432"}',
                        0, y, w=6, h=6, unit="percent"))
    panels.append(ts("Backends by state",
                     [('cnpg_backends_total{namespace="rejourney"}', "{{state}} — {{datname}}")],
                     6, y, w=12, h=6, unit="short"))
    panels.append(stat("Waiting backends", 'sum(cnpg_backends_waiting_total{namespace="rejourney"})', 18, y, w=3, h=6, unit="short",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 5}, {"color": "red", "value": 20}]}))
    panels.append(stat("Max tx duration", 'max(cnpg_backends_max_tx_duration_seconds{namespace="rejourney"})', 21, y, w=3, h=6, unit="s"))
    y += 6

    panels.append(row("Throughput & Cache", y)); y += 1
    panels.append(ts("Transactions / sec",
                     [('rate(cnpg_pg_stat_database_xact_commit{datname="rejourney",namespace="rejourney"}[2m])', "commit/s"),
                      ('rate(cnpg_pg_stat_database_xact_rollback{datname="rejourney",namespace="rejourney"}[2m])', "rollback/s")],
                     0, y, w=12, h=8, unit="ops"))
    panels.append(ts("Row operations / sec",
                     [('rate(cnpg_pg_stat_database_tup_inserted{datname="rejourney",namespace="rejourney"}[2m])', "inserted"),
                      ('rate(cnpg_pg_stat_database_tup_updated{datname="rejourney",namespace="rejourney"}[2m])', "updated"),
                      ('rate(cnpg_pg_stat_database_tup_deleted{datname="rejourney",namespace="rejourney"}[2m])', "deleted"),
                      ('rate(cnpg_pg_stat_database_tup_returned{datname="rejourney",namespace="rejourney"}[2m])', "returned"),
                      ('rate(cnpg_pg_stat_database_tup_fetched{datname="rejourney",namespace="rejourney"}[2m])', "fetched")],
                     12, y, w=12, h=8, unit="ops"))
    y += 8

    panels.append(gauge("Cache Hit Rate %",
                        '100 * sum(cnpg_pg_stat_database_blks_hit{datname="rejourney",namespace="rejourney"}) / (sum(cnpg_pg_stat_database_blks_hit{datname="rejourney",namespace="rejourney"}) + sum(cnpg_pg_stat_database_blks_read{datname="rejourney",namespace="rejourney"}))',
                        0, y, w=6, h=6, unit="percent",
                        steps=[{"color": "red", "value": None}, {"color": "orange", "value": 90}, {"color": "green", "value": 98}]))
    panels.append(ts("Blocks read vs hit / sec",
                     [('rate(cnpg_pg_stat_database_blks_hit{datname="rejourney",namespace="rejourney"}[2m])', "hit/s"),
                      ('rate(cnpg_pg_stat_database_blks_read{datname="rejourney",namespace="rejourney"}[2m])', "read/s")],
                     6, y, w=12, h=6, unit="ops"))
    panels.append(stat("Deadlocks (1h)", 'increase(cnpg_pg_stat_database_deadlocks{datname="rejourney",namespace="rejourney"}[1h])', 18, y, w=3, h=6,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 1}]}))
    panels.append(stat("Temp files (1h)", 'increase(cnpg_pg_stat_database_temp_files{datname="rejourney",namespace="rejourney"}[1h])', 21, y, w=3, h=6))
    y += 6

    panels.append(row("Checkpoints & WAL", y)); y += 1
    panels.append(ts("Checkpoints / sec",
                     [('rate(cnpg_pg_stat_checkpointer_checkpoints_timed{namespace="rejourney"}[5m])', "timed"),
                      ('rate(cnpg_pg_stat_checkpointer_checkpoints_req{namespace="rejourney"}[5m])', "requested")],
                     0, y, w=8, h=8, unit="ops"))
    panels.append(ts("WAL stats / sec",
                     [('rate(cnpg_collector_wal_records{namespace="rejourney"}[2m])', "records/s"),
                      ('rate(cnpg_collector_wal_bytes{namespace="rejourney"}[2m])', "bytes/s (right)")],
                     8, y, w=8, h=8, unit="short"))
    panels.append(ts("WAL files present",
                     [('cnpg_collector_pg_wal{namespace="rejourney",value="count"}', "count"),
                      ('cnpg_collector_pg_wal{namespace="rejourney",value="keep"}', "keep"),
                      ('cnpg_collector_pg_wal{namespace="rejourney",value="ready"}', "ready")],
                     16, y, w=8, h=8, unit="short"))
    y += 8

    panels.append(row("Database sizes", y)); y += 1
    panels.append(ts("Database size (bytes)",
                     [('cnpg_pg_database_size_bytes{namespace="rejourney"}', "{{datname}}")],
                     0, y, w=24, h=8, unit="bytes"))
    y += 8

    panels.append(row("Container Resources", y)); y += 1
    pg_lbl = 'namespace="rejourney",pod=~"postgres-[1-9][0-9]*",container="postgres"'
    panels.append(gauge("CPU Usage % of Limit",
                        f'100 * sum(rate(container_cpu_usage_seconds_total{{{pg_lbl},cpu="total"}}[2m])) / sum(container_spec_cpu_quota{{{pg_lbl}}} / container_spec_cpu_period{{{pg_lbl}}})',
                        0, y, w=6, h=6, unit="percent"))
    panels.append(gauge("Memory Usage % of Limit",
                        f'100 * sum(container_memory_working_set_bytes{{{pg_lbl}}}) / sum(container_spec_memory_limit_bytes{{{pg_lbl}}})',
                        6, y, w=6, h=6, unit="percent"))
    panels.append(stat("CPU Limit (cores)",
                       f'sum(container_spec_cpu_quota{{{pg_lbl}}} / container_spec_cpu_period{{{pg_lbl}}})',
                       12, y, w=6, h=6, unit="short"))
    panels.append(stat("Memory Limit",
                       f'sum(container_spec_memory_limit_bytes{{{pg_lbl}}})',
                       18, y, w=6, h=6, unit="bytes"))
    y += 6

    panels.append(ts("CPU throttling",
                     [(f'rate(container_cpu_cfs_throttled_seconds_total{{{pg_lbl}}}[5m])', "throttled seconds/s")],
                     0, y, w=12, h=8, unit="s"))
    panels.append(ts("Memory usage",
                     [(f'container_memory_working_set_bytes{{{pg_lbl}}}', "working set"),
                      (f'container_memory_rss{{{pg_lbl}}}', "rss"),
                      (f'container_spec_memory_limit_bytes{{{pg_lbl}}}', "limit")],
                     12, y, w=12, h=8, unit="bytes"))
    y += 8

    panels.append(row("Backups & Archive", y)); y += 1
    panels.append(stat("Seconds since last archive", 'max(cnpg_pg_stat_archiver_seconds_since_last_archival{namespace="rejourney"})', 0, y, w=6, h=4, unit="s",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 300}, {"color": "red", "value": 900}]}))
    panels.append(stat("Archive failures", 'max(cnpg_pg_stat_archiver_failed_count{namespace="rejourney"})', 6, y, w=6, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 1}]}))
    panels.append(stat("Last available backup age", 'time() - cnpg_collector_last_available_backup_timestamp{namespace="rejourney"}', 12, y, w=6, h=4, unit="s",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 3600 * 26}, {"color": "red", "value": 3600 * 48}]}))
    panels.append(stat("Last failed backup age", 'time() - cnpg_collector_last_failed_backup_timestamp{namespace="rejourney"}', 18, y, w=6, h=4, unit="s"))
    y += 4

    panels.append(ts("Archiver: archived vs failed",
                     [('rate(cnpg_pg_stat_archiver_archived_count{namespace="rejourney"}[5m])', "archived/s"),
                      ('rate(cnpg_pg_stat_archiver_failed_count{namespace="rejourney"}[5m])', "failed/s")],
                     0, y, w=24, h=8, unit="ops"))
    y += 8

    return dashboard("rejourney-postgres", "20 — PostgreSQL (CNPG)", ["postgres", "cnpg"], panels)

# ============================================================
# 30 — Redis
# ============================================================
def d_redis():
    reset_ids()
    panels = []
    y = 0

    panels.append(row("Status", y)); y += 1
    panels.append(stat("Up", 'redis_up', 0, y, w=4, h=4,
                       mappings=[{"type": "value", "options": {"1": {"text": "UP", "color": "green"}, "0": {"text": "DOWN", "color": "red"}}}]))
    panels.append(stat("Role", 'redis_instance_info', 4, y, w=4, h=4))
    panels.append(stat("Uptime", 'redis_uptime_in_seconds', 8, y, w=4, h=4, unit="s"))
    panels.append(stat("Connected clients", 'redis_connected_clients', 12, y, w=4, h=4))
    panels.append(stat("Blocked clients", 'redis_blocked_clients', 16, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}]}))
    panels.append(stat("Connected slaves", 'redis_connected_slaves', 20, y, w=4, h=4))
    y += 4

    panels.append(row("Memory", y)); y += 1
    panels.append(gauge("Memory % of maxmemory",
                        '100 * redis_memory_used_bytes / (redis_memory_max_bytes > 0) OR vector(0)',
                        0, y, w=6, h=6, unit="percent"))
    panels.append(ts("Memory usage",
                     [('redis_memory_used_bytes', "used"),
                      ('redis_memory_used_rss_bytes', "rss"),
                      ('redis_memory_used_peak_bytes', "peak"),
                      ('redis_memory_max_bytes', "maxmemory")],
                     6, y, w=12, h=6, unit="bytes"))
    panels.append(stat("Evicted keys (1h)", 'increase(redis_evicted_keys_total[1h])', 18, y, w=3, h=6,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}]}))
    panels.append(stat("Memory frag ratio", 'redis_memory_fragmentation_ratio', 21, y, w=3, h=6, decimals=2,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1.5}, {"color": "red", "value": 3}]}))
    y += 6

    panels.append(row("Throughput & Latency", y)); y += 1
    panels.append(ts("Commands / sec",
                     [('rate(redis_commands_processed_total[2m])', "processed"),
                      ('rate(redis_commands_failed_calls_total[2m])', "failed"),
                      ('rate(redis_commands_rejected_calls_total[2m])', "rejected")],
                     0, y, w=12, h=8, unit="ops"))
    panels.append(ts("Ops / sec by command (top 10)",
                     [('topk(10, rate(redis_commands_total[2m]))', "{{cmd}}")],
                     12, y, w=12, h=8, unit="ops"))
    y += 8

    panels.append(ts("Command latency p50 / p95 / p99",
                     [('histogram_quantile(0.50, sum by (le)(rate(redis_commands_latencies_usec_bucket[5m]))) / 1000', "p50"),
                      ('histogram_quantile(0.95, sum by (le)(rate(redis_commands_latencies_usec_bucket[5m]))) / 1000', "p95"),
                      ('histogram_quantile(0.99, sum by (le)(rate(redis_commands_latencies_usec_bucket[5m]))) / 1000', "p99")],
                     0, y, w=12, h=8, unit="ms"))
    panels.append(ts("Hit / miss",
                     [('rate(redis_keyspace_hits_total[2m])', "hits/s"),
                      ('rate(redis_keyspace_misses_total[2m])', "misses/s")],
                     12, y, w=12, h=8, unit="ops"))
    y += 8

    panels.append(row("Keyspace", y)); y += 1
    panels.append(ts("Keys in DB",
                     [('redis_db_keys', "db{{db}} — keys"),
                      ('redis_db_keys_expiring', "db{{db}} — expiring")],
                     0, y, w=12, h=8, unit="short"))
    panels.append(ts("Expired / evicted / second",
                     [('rate(redis_expired_keys_total[2m])', "expired/s"),
                      ('rate(redis_evicted_keys_total[2m])', "evicted/s")],
                     12, y, w=12, h=8, unit="ops"))
    y += 8

    panels.append(row("Replication & Persistence", y)); y += 1
    panels.append(ts("Replication offset",
                     [('redis_master_repl_offset', "master offset")],
                     0, y, w=12, h=8, unit="short"))
    panels.append(ts("AOF / RDB",
                     [('redis_rdb_changes_since_last_save', "rdb changes since save"),
                      ('redis_rdb_last_bgsave_duration_sec', "last bgsave duration (s)"),
                      ('redis_rdb_current_bgsave_duration_sec', "current bgsave (s)")],
                     12, y, w=12, h=8, unit="short"))
    y += 8

    panels.append(row("Container Resources", y)); y += 1
    rd_lbl = 'namespace="rejourney",pod=~"redis-node-[0-9]+",container="redis"'
    panels.append(gauge("CPU Usage % of Limit",
                        f'100 * sum(rate(container_cpu_usage_seconds_total{{{rd_lbl},cpu="total"}}[2m])) / sum(container_spec_cpu_quota{{{rd_lbl}}} / container_spec_cpu_period{{{rd_lbl}}})',
                        0, y, w=6, h=6, unit="percent"))
    panels.append(gauge("Memory Usage % of Limit",
                        f'100 * sum(container_memory_working_set_bytes{{{rd_lbl}}}) / sum(container_spec_memory_limit_bytes{{{rd_lbl}}})',
                        6, y, w=6, h=6, unit="percent"))
    panels.append(ts("CPU cores used",
                     [(f'sum(rate(container_cpu_usage_seconds_total{{{rd_lbl},cpu="total"}}[2m]))', "redis cpu")],
                     12, y, w=12, h=6, unit="short", decimals=3))
    y += 6

    return dashboard("rejourney-redis", "30 — Redis", ["redis"], panels)

# ============================================================
# 40 — Traefik
# ============================================================
def d_traefik():
    reset_ids()
    panels = []
    y = 0

    panels.append(row("Overview", y)); y += 1
    panels.append(stat("Config reload OK", 'traefik_config_last_reload_success', 0, y, w=4, h=4,
                       mappings=[{"type": "value", "options": {"1": {"text": "OK", "color": "green"}, "0": {"text": "FAIL", "color": "red"}}}]))
    panels.append(stat("Config reloads (1h)", 'increase(traefik_config_reloads_total[1h])', 4, y, w=4, h=4))
    panels.append(stat("Open connections", 'sum(traefik_open_connections)', 8, y, w=4, h=4))
    panels.append(stat("RPS (all entrypoints)", 'sum(rate(traefik_entrypoint_requests_total[2m]))', 12, y, w=4, h=4, unit="reqps"))
    panels.append(stat("5xx rate", 'sum(rate(traefik_service_requests_total{code=~"5.."}[2m]))', 16, y, w=4, h=4, unit="reqps",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 10}]}))
    panels.append(stat("TLS cert min days to expiry", '(min(traefik_tls_certs_not_after) - time()) / 86400', 20, y, w=4, h=4, unit="d",
                       thresholds={"mode": "absolute", "steps": [{"color": "red", "value": None}, {"color": "orange", "value": 14}, {"color": "green", "value": 30}]}))
    y += 4

    panels.append(row("Entrypoint traffic", y)); y += 1
    panels.append(ts("Requests / sec by entrypoint",
                     [('sum by (entrypoint)(rate(traefik_entrypoint_requests_total[2m]))', "{{entrypoint}}")],
                     0, y, w=12, h=8, unit="reqps"))
    panels.append(ts("Bytes / sec by entrypoint",
                     [('sum by (entrypoint)(rate(traefik_entrypoint_requests_bytes_total[2m]))', "in — {{entrypoint}}"),
                      ('sum by (entrypoint)(rate(traefik_entrypoint_responses_bytes_total[2m]))', "out — {{entrypoint}}")],
                     12, y, w=12, h=8, unit="Bps"))
    y += 8

    panels.append(row("Latency by router", y)); y += 1
    panels.append(ts("p50",
                     [('histogram_quantile(0.50, sum by (router, le)(rate(traefik_router_request_duration_seconds_bucket[5m])))', "{{router}}")],
                     0, y, w=8, h=8, unit="s"))
    panels.append(ts("p95",
                     [('histogram_quantile(0.95, sum by (router, le)(rate(traefik_router_request_duration_seconds_bucket[5m])))', "{{router}}")],
                     8, y, w=8, h=8, unit="s"))
    panels.append(ts("p99",
                     [('histogram_quantile(0.99, sum by (router, le)(rate(traefik_router_request_duration_seconds_bucket[5m])))', "{{router}}")],
                     16, y, w=8, h=8, unit="s"))
    y += 8

    panels.append(row("Status codes", y)); y += 1
    panels.append(ts("Requests by code (service)",
                     [('sum by (code)(rate(traefik_service_requests_total[2m]))', "{{code}}")],
                     0, y, w=12, h=8, unit="reqps", stack="normal"))
    panels.append(ts("Top routers by 5xx / sec",
                     [('topk(10, sum by (router)(rate(traefik_router_requests_total{code=~"5.."}[5m])))', "{{router}}")],
                     12, y, w=12, h=8, unit="reqps"))
    y += 8

    return dashboard("rejourney-traefik", "40 — Traefik / Ingress", ["traefik"], panels)

# ============================================================
# 50 — Application (rejourney custom metrics + workers)
# ============================================================
def d_application():
    reset_ids()
    panels = []
    y = 0

    panels.append(row("Artifacts pipeline", y)); y += 1
    panels.append(stat("Created (1h)", 'sum(rejourney_artifacts_created_recent_created_count)', 0, y, w=4, h=4))
    panels.append(stat("Completed (1h)", 'sum(rejourney_artifacts_completed_recent_completed_count)', 4, y, w=4, h=4))
    panels.append(stat("Failed artifacts (1h)", 'sum(rejourney_artifacts_failed_recent_artifact_count)', 8, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 10}]}))
    panels.append(stat("Stalled (current)", 'sum(rejourney_artifacts_stalled_stalled_count)', 12, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 10}]}))
    panels.append(stat("Stalled oldest age", 'max(rejourney_artifacts_stalled_oldest_age_seconds)', 16, y, w=4, h=4, unit="s"))
    panels.append(stat("Bytes created (1h)", 'sum(rejourney_artifacts_created_recent_created_bytes)', 20, y, w=4, h=4, unit="bytes"))
    y += 4

    panels.append(ts("Upload latency (recent window)",
                     [('max(rejourney_artifacts_upload_latency_recent_p50_seconds)', "p50"),
                      ('max(rejourney_artifacts_upload_latency_recent_p95_seconds)', "p95"),
                      ('max(rejourney_artifacts_upload_latency_recent_p99_seconds)', "p99"),
                      ('max(rejourney_artifacts_upload_latency_recent_max_seconds)', "max")],
                     0, y, w=12, h=8, unit="s"))
    panels.append(ts("Recording artifacts by status",
                     [('sum by (status)(rejourney_recording_artifacts_by_status_artifact_count)', "{{status}}")],
                     12, y, w=12, h=8, unit="short"))
    y += 8

    panels.append(row("Ingest jobs", y)); y += 1
    panels.append(ts("Jobs by status",
                     [('sum by (status)(rejourney_ingest_jobs_by_status_job_count)', "{{status}}")],
                     0, y, w=24, h=8, unit="short"))
    y += 8

    panels.append(row("Session backup", y)); y += 1
    panels.append(stat("Queue depth", 'sum(rejourney_session_backup_queue_queued)', 0, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 100}, {"color": "red", "value": 1000}]}))
    panels.append(stat("Oldest queue age", 'max(rejourney_session_backup_queue_oldest_age_seconds)', 4, y, w=4, h=4, unit="s"))
    panels.append(stat("Max attempts seen", 'max(rejourney_session_backup_queue_max_attempts)', 8, y, w=4, h=4))
    panels.append(stat("Seconds since last backup", 'max(rejourney_session_backup_recent_seconds_since_last_backup)', 12, y, w=4, h=4, unit="s",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 3600}, {"color": "red", "value": 86400}]}))
    panels.append(stat("Sessions backed up (1h)", 'sum(rejourney_session_backup_recent_sessions_backed_up_1h)', 16, y, w=4, h=4))
    panels.append(stat("Bytes backed up (1h)", 'sum(rejourney_session_backup_recent_bytes_backed_up_1h)', 20, y, w=4, h=4, unit="bytes"))
    y += 4

    panels.append(ts("Integrity (7d rolling)",
                     [('max(rejourney_session_backup_integrity_recent_copied_plan_mismatch_count_7d)', "plan mismatch"),
                      ('max(rejourney_session_backup_integrity_recent_low_quality_count_7d)', "low quality"),
                      ('max(rejourney_session_backup_integrity_recent_manifest_missing_count_7d)', "manifest missing"),
                      ('max(rejourney_session_backup_integrity_recent_r2_parity_mismatch_count_7d)', "r2 parity mismatch")],
                     0, y, w=24, h=8, unit="short"))
    y += 8

    panels.append(row("Retention", y)); y += 1
    panels.append(stat("Deleted objects (24h)", 'sum(rejourney_retention_recent_summary_deleted_objects_24h)', 0, y, w=6, h=4))
    panels.append(stat("Deleted bytes (24h)", 'sum(rejourney_retention_recent_summary_deleted_bytes_24h)', 6, y, w=6, h=4, unit="bytes"))
    panels.append(stat("Failed purges (24h)", 'sum(rejourney_retention_recent_summary_failed_purge_entries_24h)', 12, y, w=6, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 1}]}))
    panels.append(stat("Seconds since last purge", 'max(rejourney_retention_recent_summary_seconds_since_last_completed_purge)', 18, y, w=6, h=4, unit="s"))
    y += 4

    panels.append(ts("Retention per-endpoint (recent)",
                     [('sum by (endpoint_url)(rejourney_retention_endpoint_activity_recent_deleted_objects)', "{{endpoint_url}}")],
                     0, y, w=24, h=8, unit="short"))
    y += 8

    panels.append(row("Workers — container resources", y)); y += 1
    wk_lbl = 'namespace="rejourney",pod=~".*-worker-.*"'
    panels.append(ts("Worker CPU",
                     [(f'sum by (pod)(rate(container_cpu_usage_seconds_total{{{wk_lbl},container!="",container!="POD"}}[2m]))', "{{pod}}")],
                     0, y, w=12, h=8, unit="short", decimals=3))
    panels.append(ts("Worker Memory",
                     [(f'sum by (pod)(container_memory_working_set_bytes{{{wk_lbl},container!="",container!="POD"}})', "{{pod}}")],
                     12, y, w=12, h=8, unit="bytes"))
    y += 8

    return dashboard("rejourney-application", "50 — Application", ["app"], panels)

# ============================================================
# 60 — Storage & Backups
# ============================================================
def d_storage():
    reset_ids()
    panels = []
    y = 0

    panels.append(row("PVC usage (Hetzner volumes + local-path)", y)); y += 1
    panels.append(bargauge("PVC Usage %",
                           '100 * sum by (persistentvolumeclaim)(kubelet_volume_stats_used_bytes{namespace="rejourney"}) / sum by (persistentvolumeclaim)(kubelet_volume_stats_capacity_bytes{namespace="rejourney"})',
                           0, y, w=12, h=10, unit="percent", legend="{{persistentvolumeclaim}}"))
    panels.append(ts("PVC used bytes",
                     [('sum by (persistentvolumeclaim)(kubelet_volume_stats_used_bytes{namespace="rejourney"})', "{{persistentvolumeclaim}}")],
                     12, y, w=12, h=10, unit="bytes"))
    y += 10

    panels.append(ts("PVC free bytes",
                     [('sum by (persistentvolumeclaim)(kubelet_volume_stats_available_bytes{namespace="rejourney"})', "{{persistentvolumeclaim}}")],
                     0, y, w=12, h=8, unit="bytes"))
    panels.append(ts("Inode usage",
                     [('100 * sum by (persistentvolumeclaim)(kubelet_volume_stats_inodes_used{namespace="rejourney"}) / sum by (persistentvolumeclaim)(kubelet_volume_stats_inodes{namespace="rejourney"})', "{{persistentvolumeclaim}}")],
                     12, y, w=12, h=8, unit="percent"))
    y += 8

    panels.append(row("R2 / S3 backups", y)); y += 1
    panels.append(stat("Last WAL archive age", 'max(cnpg_pg_stat_archiver_seconds_since_last_archival{namespace="rejourney"})', 0, y, w=6, h=4, unit="s",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 300}, {"color": "red", "value": 900}]}))
    panels.append(stat("Archive failures (total)", 'max(cnpg_pg_stat_archiver_failed_count{namespace="rejourney"})', 6, y, w=6, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 1}]}))
    panels.append(stat("Last base backup age", 'time() - cnpg_collector_last_available_backup_timestamp{namespace="rejourney"}', 12, y, w=6, h=4, unit="s",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 3600 * 26}, {"color": "red", "value": 3600 * 48}]}))
    panels.append(stat("Recoverability point age", 'time() - cnpg_collector_first_recoverability_point{namespace="rejourney"}', 18, y, w=6, h=4, unit="s"))
    y += 4

    panels.append(ts("Archiver: archived / failed per sec",
                     [('rate(cnpg_pg_stat_archiver_archived_count{namespace="rejourney"}[5m])', "archived/s"),
                      ('rate(cnpg_pg_stat_archiver_failed_count{namespace="rejourney"}[5m])', "failed/s")],
                     0, y, w=24, h=8, unit="ops"))
    y += 8

    panels.append(row("Per-bucket / endpoint", y)); y += 1
    panels.append(ts("Deleted objects by endpoint (recent)",
                     [('sum by (endpoint_url)(rejourney_retention_endpoint_activity_recent_deleted_objects)', "{{endpoint_url}}")],
                     0, y, w=12, h=8, unit="short"))
    panels.append(ts("Deleted bytes by endpoint (recent)",
                     [('sum by (endpoint_url)(rejourney_retention_endpoint_activity_recent_deleted_bytes)', "{{endpoint_url}}")],
                     12, y, w=12, h=8, unit="bytes"))
    y += 8

    return dashboard("rejourney-storage", "60 — Storage & Backups", ["storage"], panels)

# ============================================================
# 70 — VictoriaMetrics / Self
# ============================================================
def d_self():
    reset_ids()
    panels = []
    y = 0

    panels.append(row("VictoriaMetrics health", y)); y += 1
    panels.append(stat("VM Up", 'up{job="victoria-metrics"}', 0, y, w=4, h=4,
                       mappings=[{"type": "value", "options": {"1": {"text": "UP", "color": "green"}, "0": {"text": "DOWN", "color": "red"}}}]))
    panels.append(stat("Active series", 'vm_cache_entries{type="storage/hour_metric_ids"}', 4, y, w=4, h=4))
    panels.append(stat("Rows ingested/s", 'sum(rate(vm_rows_inserted_total[2m]))', 8, y, w=4, h=4, unit="ops"))
    panels.append(stat("Rows read/s", 'sum(rate(vm_rows_read_per_query_sum[2m]))', 12, y, w=4, h=4, unit="ops"))
    panels.append(stat("Disk bytes", 'sum(vm_data_size_bytes)', 16, y, w=4, h=4, unit="bytes"))
    panels.append(stat("Retention", 'vm_free_disk_space_limit_bytes', 20, y, w=4, h=4, unit="bytes"))
    y += 4

    panels.append(ts("Ingestion rate",
                     [('sum(rate(vm_rows_inserted_total[2m]))', "rows/s")],
                     0, y, w=12, h=8, unit="ops"))
    panels.append(ts("Query rate + errors",
                     [('sum(rate(vm_http_requests_total{path=~"/api/v1/query.*"}[2m]))', "queries/s"),
                      ('sum(rate(vm_http_request_errors_total[2m]))', "errors/s")],
                     12, y, w=12, h=8, unit="ops"))
    y += 8

    panels.append(row("Scrape targets", y)); y += 1
    panels.append(ts("Up by job",
                     [('min by (job)(up)', "{{job}}")],
                     0, y, w=12, h=8, unit="short", min_val=0, max_val=1))
    panels.append(ts("Scrape duration by job",
                     [('max by (job)(scrape_duration_seconds)', "{{job}}")],
                     12, y, w=12, h=8, unit="s"))
    y += 8

    panels.append(row("Pushgateway heartbeats", y)); y += 1
    panels.append(table("Pushgateway metrics",
                        [('pushgateway_last_push_timestamp_seconds', "")],
                        0, y, w=24, h=10))
    y += 10

    return dashboard("rejourney-self", "70 — VictoriaMetrics & Self", ["self", "monitoring"], panels)

# ============================================================
# main
# ============================================================
dashes = [
    ("00-overview", d_overview()),
    ("10-kubernetes", d_kubernetes()),
    ("20-postgres", d_postgres()),
    ("30-redis", d_redis()),
    ("40-traefik", d_traefik()),
    ("50-application", d_application()),
    ("60-storage", d_storage()),
    ("70-self", d_self()),
]
for name, d in dashes:
    print(f"  {name}: {len(d['panels'])} panels")
path = write_configmap(dashes)
print(f"wrote {path}  ({sum(os.path.getsize(path) for _ in [1])} bytes)")
