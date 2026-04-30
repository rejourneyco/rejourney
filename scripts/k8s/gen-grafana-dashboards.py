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
ACTIVE_PVC_REGEX = 'grafana-data|gatus-data|victoria-metrics-data|redis-data-redis-node-[0-9]+|postgres-local-[0-9]+'
DATABASE_PVC_REGEX = 'redis-data-redis-node-[0-9]+|postgres-local-[0-9]+'

NEXT_ID = [0]
def nid():
    NEXT_ID[0] += 1
    return NEXT_ID[0]

def reset_ids():
    NEXT_ID[0] = 0

def pvc_metric(metric, regex=ACTIVE_PVC_REGEX):
    return f'{metric}{{namespace="rejourney",persistentvolumeclaim=~"{regex}"}}'

def pvc_used_series(regex=ACTIVE_PVC_REGEX):
    return f'sum by (persistentvolumeclaim)(rejourney_local_pvc_used_bytes{{namespace="rejourney",persistentvolumeclaim=~"{regex}"}})'

def pvc_capacity_series(regex=ACTIVE_PVC_REGEX):
    return f'max by (persistentvolumeclaim)(kube_persistentvolumeclaim_resource_requests_storage_bytes{{namespace="rejourney",persistentvolumeclaim=~"{regex}"}})'

def pvc_usage_percent_series(regex=ACTIVE_PVC_REGEX):
    return f'100 * ({pvc_used_series(regex)}) / ({pvc_capacity_series(regex)})'

def pvc_free_series(regex=ACTIVE_PVC_REGEX):
    return f'clamp_min(({pvc_capacity_series(regex)}) - ({pvc_used_series(regex)}), 0)'

def pvc_inodes_used_series(regex=ACTIVE_PVC_REGEX):
    return f'sum by (persistentvolumeclaim)(rejourney_local_pvc_inodes_used{{namespace="rejourney",persistentvolumeclaim=~"{regex}"}})'

def kube_limit_expr(pod_regex, container, resource):
    return (
        'sum('
        f'kube_pod_container_resource_limits{{namespace="rejourney",pod=~"{pod_regex}",container="{container}",resource="{resource}"}}'
        ')'
    )

def kube_request_expr(pod_regex, container, resource):
    return (
        'sum('
        f'kube_pod_container_resource_requests{{namespace="rejourney",pod=~"{pod_regex}",container="{container}",resource="{resource}"}}'
        ')'
    )

def target(expr, legend="", instant=False, ref="A"):
    return {
        "datasource": DATASOURCE,
        "expr": expr,
        "legendFormat": legend,
        "refId": ref,
        "instant": instant,
    }

def zero(expr):
    return f'({expr}) OR vector(0)'

def stat(title, expr, x, y, w=4, h=4, unit="short", legend="", mappings=None,
         thresholds=None, decimals=None, color_mode="value", instant=False):
    p = {
        "id": nid(),
        "type": "stat",
        "title": title,
        "datasource": DATASOURCE,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": [target(expr, legend, instant=instant)],
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
    panels.append(stat("Node Exporter", 'min(up{job="node-exporter"})', 20, y, w=4, h=4,
                       mappings=[{"type": "value", "options": {"1": {"text": "UP", "color": "green"}, "0": {"text": "DOWN", "color": "red"}}}]))
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
    panels.append(stat("Artifacts created (1h)", zero('sum(rejourney_artifacts_created_recent_created_count)'), 0, y, w=4, h=4))
    panels.append(stat("Artifacts completed (1h)", zero('sum(rejourney_artifacts_completed_recent_completed_count)'), 4, y, w=4, h=4))
    panels.append(stat("Artifacts stalled", zero('sum(rejourney_artifacts_stalled_stalled_count)'), 8, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 10}]}))
    panels.append(stat("Backup queue depth", zero('sum(rejourney_session_backup_queue_queued)'), 12, y, w=4, h=4))
    panels.append(stat("Backup queue oldest age", zero('max(rejourney_session_backup_queue_oldest_age_seconds)'), 16, y, w=4, h=4, unit="s"))
    panels.append(stat("Upload p95 (recent)", zero('max(rejourney_artifacts_upload_latency_recent_p95_seconds)'), 20, y, w=4, h=4, unit="s"))
    y += 4

    return dashboard("rejourney-overview", "00 — Overview", ["overview"], panels)

# ============================================================
# 10 — Kubernetes
# ============================================================
def _pod_distribution_table(x, y):
    """Full-width table: pod | node | CPU cores | CPU% limit | Memory | Mem% limit, sorted by CPU."""
    def tgt(expr, ref):
        return {"datasource": DATASOURCE, "expr": expr, "legendFormat": "",
                "refId": ref, "instant": True, "format": "table"}
    return {
        "id": nid(),
        "type": "table",
        "title": "Pod Distribution — placement + compute (sorted by CPU)",
        "datasource": DATASOURCE,
        "gridPos": {"x": x, "y": y, "w": 24, "h": 14},
        "targets": [
            tgt('kube_pod_info{namespace="rejourney",node!=""}', "A"),
            tgt('sum by (pod)(rate(container_cpu_usage_seconds_total{namespace="rejourney",container!="",container!="POD"}[5m]))', "B"),
            tgt('100 * sum by (pod)(rate(container_cpu_usage_seconds_total{namespace="rejourney",container!="",container!="POD"}[5m])) / clamp_min(sum by (pod)(kube_pod_container_resource_limits{namespace="rejourney",resource="cpu"}), 0.001)', "C"),
            tgt('sum by (pod)(container_memory_working_set_bytes{namespace="rejourney",container!="",container!="POD"})', "D"),
            tgt('100 * sum by (pod)(container_memory_working_set_bytes{namespace="rejourney",container!="",container!="POD"}) / clamp_min(sum by (pod)(kube_pod_container_resource_limits{namespace="rejourney",resource="memory"}), 1)', "E"),
        ],
        "transformations": [
            {"id": "merge"},
            {"id": "organize", "options": {
                "renameByName": {
                    "pod": "Pod", "node": "Node",
                    "Value #B": "CPU (cores)", "Value #C": "CPU % limit",
                    "Value #D": "Memory",      "Value #E": "Mem % limit",
                },
                "excludeByName": {
                    "Time": True, "__name__": True, "container": True, "endpoint": True,
                    "host_ip": True, "instance": True, "job": True, "namespace": True,
                    "Value #A": True, "created_by_kind": True, "created_by_name": True,
                    "priority_class": True, "uid": True, "host_network": True,
                },
                "indexByName": {"Pod": 0, "Node": 1, "CPU (cores)": 2, "CPU % limit": 3, "Memory": 4, "Mem % limit": 5},
            }},
            {"id": "sortBy", "options": {"fields": [{"desc": True, "displayName": "CPU (cores)"}]}},
        ],
        "fieldConfig": {
            "defaults": {"custom": {"align": "auto"}},
            "overrides": [
                {"matcher": {"id": "byName", "options": "CPU (cores)"},
                 "properties": [{"id": "unit", "value": "none"}, {"id": "decimals", "value": 3},
                                {"id": "custom.displayMode", "value": "color-background"},
                                {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                                    {"color": "green", "value": None}, {"color": "orange", "value": 0.3}, {"color": "red", "value": 0.8}]}}]},
                {"matcher": {"id": "byName", "options": "CPU % limit"},
                 "properties": [{"id": "unit", "value": "percent"}, {"id": "decimals", "value": 1},
                                {"id": "custom.displayMode", "value": "color-background"},
                                {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                                    {"color": "green", "value": None}, {"color": "orange", "value": 60}, {"color": "red", "value": 85}]}}]},
                {"matcher": {"id": "byName", "options": "Memory"},
                 "properties": [{"id": "unit", "value": "bytes"},
                                {"id": "custom.displayMode", "value": "color-background"},
                                {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                                    {"color": "green", "value": None}, {"color": "orange", "value": 400*1024*1024}, {"color": "red", "value": 900*1024*1024}]}}]},
                {"matcher": {"id": "byName", "options": "Mem % limit"},
                 "properties": [{"id": "unit", "value": "percent"}, {"id": "decimals", "value": 1},
                                {"id": "custom.displayMode", "value": "color-background"},
                                {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                                    {"color": "green", "value": None}, {"color": "orange", "value": 70}, {"color": "red", "value": 90}]}}]},
            ],
        },
        "options": {"showHeader": True, "footer": {"show": False},
                    "sortBy": [{"displayName": "CPU (cores)", "desc": True}]},
    }


def d_kubernetes():
    reset_ids()
    panels = []
    y = 0

    # ── Row 1: Per-node resource usage ──────────────────────────────────────
    panels.append(row("Nodes", y)); y += 1
    panels.append(ts("CPU % — per node",
                     [('100 * (1 - avg by (node)(rate(node_cpu_seconds_total{mode="idle"}[2m])))', "{{node}}")],
                     0, y, w=12, h=8, unit="percent"))
    panels.append(ts("Memory % — per node",
                     [('100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)', "{{node}}")],
                     12, y, w=12, h=8, unit="percent"))
    y += 8
    panels.append(ts("Disk % — per node",
                     [('100 * (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})', "{{node}}")],
                     0, y, w=8, h=8, unit="percent"))
    panels.append(ts("Load 1m — per node",
                     [('node_load1', "{{node}}")],
                     8, y, w=8, h=8, unit="short"))
    panels.append(ts("Network I/O — per node (bytes/s)",
                     [('sum by (node)(rate(node_network_receive_bytes_total{device!~"lo|cali.*|cni.*|veth.*|flannel.*|docker.*"}[2m]))', "rx — {{node}}"),
                      ('-sum by (node)(rate(node_network_transmit_bytes_total{device!~"lo|cali.*|cni.*|veth.*|flannel.*|docker.*"}[2m]))', "tx — {{node}}")],
                     16, y, w=8, h=8, unit="Bps"))
    y += 8
    panels.append(ts("Disk I/O — per node (bytes/s)",
                     [('sum by (node)(rate(node_disk_read_bytes_total[2m]))', "read — {{node}}"),
                      ('-sum by (node)(rate(node_disk_written_bytes_total[2m]))', "write — {{node}}")],
                     0, y, w=12, h=8, unit="Bps"))
    panels.append(bargauge("Pods per Node — right now",
                           'sum by (node)(kube_pod_info{namespace="rejourney",node!=""})',
                           12, y, w=12, h=8, unit="short", legend="{{node}}"))
    y += 8

    # ── Row 2: Pod distribution table ───────────────────────────────────────
    panels.append(row("Pod Distribution", y)); y += 1
    panels.append(_pod_distribution_table(0, y))
    y += 14

    # ── Row 3: Workload averages — avg CPU/mem per deployment, not per pod ──
    panels.append(row("Workload Averages (avg across replicas)", y)); y += 1
    panels.append(ts("Avg CPU per workload (cores)",
                     [('avg by (label_app)('
                       'kube_pod_labels{namespace="rejourney",label_app!=""}'
                       ' * on(pod) group_right(label_app) '
                       'sum by (pod)(rate(container_cpu_usage_seconds_total{namespace="rejourney",container!="",container!="POD"}[2m]))'
                       ')', "{{label_app}}")],
                     0, y, w=12, h=9, unit="none", decimals=3))
    panels.append(ts("Avg Memory per workload",
                     [('avg by (label_app)('
                       'kube_pod_labels{namespace="rejourney",label_app!=""}'
                       ' * on(pod) group_right(label_app) '
                       'sum by (pod)(container_memory_working_set_bytes{namespace="rejourney",container!="",container!="POD"})'
                       ')', "{{label_app}}")],
                     12, y, w=12, h=9, unit="bytes"))
    y += 9

    # ── Row 4: Pod compute rankings — instant bar gauges ────────────────────
    panels.append(row("Pod Compute Rankings", y)); y += 1
    panels.append(bargauge("Top 15 — CPU Cores Used",
                           'topk(15, sum by (pod)(rate(container_cpu_usage_seconds_total{namespace="rejourney",container!="",container!="POD"}[5m])))',
                           0, y, w=12, h=10, unit="none", legend="{{pod}}"))
    panels.append(bargauge("Top 15 — CPU % of Limit",
                           'topk(15, 100 * sum by (pod)(rate(container_cpu_usage_seconds_total{namespace="rejourney",container!="",container!="POD"}[5m])) / clamp_min(sum by (pod)(kube_pod_container_resource_limits{namespace="rejourney",resource="cpu"}), 0.001))',
                           12, y, w=12, h=10, unit="percent", legend="{{pod}}"))
    y += 10
    panels.append(bargauge("Top 15 — Memory Used",
                           'topk(15, sum by (pod)(container_memory_working_set_bytes{namespace="rejourney",container!="",container!="POD"}))',
                           0, y, w=12, h=10, unit="bytes", legend="{{pod}}"))
    panels.append(bargauge("Top 15 — Memory % of Limit",
                           'topk(15, 100 * sum by (pod)(container_memory_working_set_bytes{namespace="rejourney",container!="",container!="POD"}) / clamp_min(sum by (pod)(kube_pod_container_resource_limits{namespace="rejourney",resource="memory"}), 1))',
                           12, y, w=12, h=10, unit="percent", legend="{{pod}}"))
    y += 10

    # ── Row 5: Pod workload share by node + restarts ─────────────────────────
    panels.append(row("Pod Workload by Node", y)); y += 1
    panels.append(ts("Pod CPU — stacked by node",
                     [('sum by (node)(rate(container_cpu_usage_seconds_total{namespace="rejourney",container!="",container!="POD"}[2m]))', "{{node}}")],
                     0, y, w=12, h=8, unit="none", decimals=2, stack="normal"))
    panels.append(ts("Pod Memory — stacked by node",
                     [('sum by (node)(container_memory_working_set_bytes{namespace="rejourney",container!="",container!="POD"})', "{{node}}")],
                     12, y, w=12, h=8, unit="bytes", stack="normal"))
    y += 8
    panels.append(ts("Pod Restarts (15m delta)",
                     [('sum by (pod)(increase(kube_pod_container_status_restarts_total{namespace="rejourney"}[15m]))', "{{pod}}")],
                     0, y, w=24, h=6, unit="short"))
    y += 6

    # ── Row 6: HPA ───────────────────────────────────────────────────────────
    panels.append(row("HPA (Autoscaling)", y)); y += 1
    panels.append(ts("HPA Replicas — current vs desired vs max",
                     [('kube_horizontalpodautoscaler_status_current_replicas{namespace="rejourney"}', "current — {{horizontalpodautoscaler}}"),
                      ('kube_horizontalpodautoscaler_status_desired_replicas{namespace="rejourney"}', "desired — {{horizontalpodautoscaler}}"),
                      ('kube_horizontalpodautoscaler_spec_max_replicas{namespace="rejourney"}', "max — {{horizontalpodautoscaler}}")],
                     0, y, w=24, h=8, unit="short"))
    y += 8

    # ── Row 7: Noisy Neighbor Detection ─────────────────────────────────────
    panels.append(row("Noisy Neighbor Detection", y)); y += 1

    # CPU throttling is the primary signal: a pod hitting its cgroup CPU ceiling
    # gets CFS-throttled. High throttle rates on the API pod = slow responses.
    panels.append(ts("CPU Throttle Rate by Pod (throttled sec/s)",
                     [('topk(10, sum by (pod)(rate(container_cpu_cfs_throttled_seconds_total{namespace="rejourney",container!="",container!="POD"}[2m])))', "{{pod}}")],
                     0, y, w=12, h=8, unit="s", decimals=3))
    # Pods bursting above their CPU request are borrowing from the node's
    # shared pool. When the node is saturated this starves well-behaved pods.
    panels.append(ts("CPU Usage vs Request — burst ratio",
                     [('topk(10, sum by (pod)(rate(container_cpu_usage_seconds_total{namespace="rejourney",container!="",container!="POD"}[2m])) '
                       '/ clamp_min(sum by (pod)(kube_pod_container_resource_requests{namespace="rejourney",resource="cpu"}), 0.001))',
                       "{{pod}}")],
                     12, y, w=12, h=8, unit="percentunit", decimals=0))
    y += 8

    # Per-node saturation: when a node's total pod CPU usage approaches the
    # node's allocatable cores, every pod on that node competes for cycles.
    panels.append(ts("Node CPU Saturation — pod usage / allocatable",
                     [('100 * sum by (node)(rate(container_cpu_usage_seconds_total{namespace="rejourney",container!="",container!="POD"}[2m])) '
                       '/ on(node) kube_node_status_allocatable{resource="cpu"}',
                       "{{node}}")],
                     0, y, w=8, h=8, unit="percent"))
    # Memory pressure: pods near their memory limit risk OOMKill and force
    # the kernel to reclaim pages from neighbors.
    panels.append(ts("Node Memory Saturation — pod usage / allocatable",
                     [('100 * sum by (node)(container_memory_working_set_bytes{namespace="rejourney",container!="",container!="POD"}) '
                       '/ on(node) kube_node_status_allocatable{resource="memory"}',
                       "{{node}}")],
                     8, y, w=8, h=8, unit="percent"))
    # CFS throttle periods: how many scheduling periods were throttled.
    # A high count means the pod is repeatedly hitting its CPU ceiling.
    panels.append(ts("CFS Throttled Periods / sec",
                     [('topk(10, sum by (pod)(rate(container_cpu_cfs_throttled_periods_total{namespace="rejourney",container!="",container!="POD"}[2m])) '
                       '/ clamp_min(sum by (pod)(rate(container_cpu_cfs_periods_total{namespace="rejourney",container!="",container!="POD"}[2m])), 0.001))',
                       "{{pod}}")],
                     16, y, w=8, h=8, unit="percentunit"))
    y += 8

    # The smoking gun: overlay API p99 latency with the API pod's throttle
    # rate and the node CPU saturation. If they spike together, a noisy
    # neighbor (or the API itself) is the cause.
    api_node_expr = (
        'sum by (node)('
        'kube_pod_info{namespace="rejourney",pod=~"api-.*"} '
        '* on(pod) group_right(node) '
        'rate(container_cpu_cfs_throttled_seconds_total{namespace="rejourney",container="api"}[2m])'
        ')'
    )
    panels.append(ts("API Impact — throttle + node CPU overlay",
                     [(api_node_expr, "api throttle on {{node}}"),
                      ('100 * (1 - avg by (node)(rate(node_cpu_seconds_total{mode="idle"}[2m])))', "node CPU % — {{node}}")],
                     0, y, w=12, h=8, unit="short"))
    # Top CPU consumers on the same node as the API — identifies the neighbor.
    panels.append(ts("Top CPU on API Node (cores)",
                     [('topk(8, '
                       'sum by (pod)(rate(container_cpu_usage_seconds_total{namespace="rejourney",container!="",container!="POD"}[2m])) '
                       '* on(pod) group_left(node) kube_pod_info{namespace="rejourney",node=~"rejourney-fsn1-1"}'
                       ')', "{{pod}}")],
                     12, y, w=12, h=8, unit="none", decimals=3))
    y += 8

    # ── Row 8: PVCs ──────────────────────────────────────────────────────────
    panels.append(row("Active PVCs", y)); y += 1
    panels.append(bargauge("PVC Usage %",
                           pvc_usage_percent_series(),
                           0, y, w=12, h=8, unit="percent", legend="{{persistentvolumeclaim}}"))
    panels.append(ts("PVC Used (bytes)",
                     [(pvc_used_series(), "{{persistentvolumeclaim}}")],
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
    panels.append(stat("Streaming Replicas", 'cnpg_pg_replication_streaming_replicas{namespace="rejourney"}', 16, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "red", "value": None}, {"color": "green", "value": 1}]}))
    panels.append(stat("Fencing", 'cnpg_collector_fencing_on{namespace="rejourney"}', 20, y, w=4, h=4,
                       mappings=[{"type": "value", "options": {"0": {"text": "OFF", "color": "green"}, "1": {"text": "FENCED", "color": "red"}}}]))
    y += 4

    panels.append(row("Replication", y)); y += 1
    panels.append(stat("Replication Lag (bytes)",
                       'cnpg_pg_replication_lag{namespace="rejourney"}', 0, y, w=6, h=4, unit="bytes",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 10485760}, {"color": "red", "value": 104857600}]}))
    panels.append(ts("Replication Lag over time",
                     [('cnpg_pg_replication_lag{namespace="rejourney"}', "lag bytes")],
                     6, y, w=18, h=4, unit="bytes"))
    y += 4

    panels.append(row("Connections", y)); y += 1
    connection_util_expr = (
        '100 * clamp_max('
        'sum(cnpg_backends_total{namespace="rejourney",role="primary"}) / '
        'clamp_min('
        'max(cnpg_pg_settings_setting{namespace="rejourney",role="primary",name="max_connections"}) - '
        'max(cnpg_pg_settings_setting{namespace="rejourney",role="primary",name="superuser_reserved_connections"}), '
        '1'
        '), '
        '1'
        ')'
    )
    usable_slots_expr = (
        'clamp_min('
        'max(cnpg_pg_settings_setting{namespace="rejourney",role="primary",name="max_connections"}) - '
        'max(cnpg_pg_settings_setting{namespace="rejourney",role="primary",name="superuser_reserved_connections"}), '
        '1'
        ')'
    )
    panels.append(gauge("Connection Utilization %",
                        connection_util_expr,
                        0, y, w=6, h=6, unit="percent"))
    panels.append(stat("Client backends / usable slots",
                       f'sum(cnpg_backends_total{{namespace="rejourney",role="primary"}}) / {usable_slots_expr}',
                       15, y, w=3, h=6, unit="short",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 0.8}, {"color": "red", "value": 1}]}))
    panels.append(ts("Backends by state",
                     [('cnpg_backends_total{namespace="rejourney"}', "{{state}} — {{datname}}")],
                     6, y, w=9, h=6, unit="short"))
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
                      (zero('cnpg_collector_pg_wal{namespace="rejourney",value="ready"}'), "ready")],
                     16, y, w=8, h=8, unit="short"))
    y += 8

    panels.append(row("Database sizes", y)); y += 1
    panels.append(ts("Database size (bytes)",
                     [('cnpg_pg_database_size_bytes{namespace="rejourney"}', "{{datname}}")],
                     0, y, w=24, h=8, unit="bytes"))
    y += 8

    panels.append(row("Container Resources", y)); y += 1
    pg_lbl = 'namespace="rejourney",pod=~"postgres-local-[0-9]+",container="postgres"'
    # group by (pod) collapses stale duplicate series (different instance IPs after pod restarts)
    # that would otherwise cause a many-to-many join error when multiplying on(pod).
    # role="primary" from CNPG scrape relabeling avoids matching stale no-role series.
    pg_primary_filter = 'group by (pod) (cnpg_pg_replication_in_recovery{namespace="rejourney",role="primary"} == 0)'
    pg_mem_limit = kube_limit_expr('postgres-local-[0-9]+', 'postgres', 'memory')
    pg_mem_request = kube_request_expr('postgres-local-[0-9]+', 'postgres', 'memory')
    pg_cpu_limit = kube_limit_expr('postgres-local-[0-9]+', 'postgres', 'cpu')
    pg_cpu_request = kube_request_expr('postgres-local-[0-9]+', 'postgres', 'cpu')
    pg_primary_cpu_usage = (
        f'sum(rate(container_cpu_usage_seconds_total{{{pg_lbl}}}[2m]) '
        f'* on(pod) group_left() {pg_primary_filter})'
    )
    pg_primary_mem_usage = (
        f'sum(container_memory_working_set_bytes{{{pg_lbl}}} '
        f'* on(pod) group_left() {pg_primary_filter})'
    )
    pg_primary_cpu_limit = (
        f'sum(kube_pod_container_resource_limits{{namespace="rejourney",pod=~"postgres-local-[0-9]+",container="postgres",resource="cpu"}} '
        f'* on(pod) group_left() {pg_primary_filter})'
    )
    pg_primary_mem_limit = (
        f'sum(kube_pod_container_resource_limits{{namespace="rejourney",pod=~"postgres-local-[0-9]+",container="postgres",resource="memory"}} '
        f'* on(pod) group_left() {pg_primary_filter})'
    )
    panels.append(gauge("Primary CPU Usage % of Limit",
                        f'100 * {pg_primary_cpu_usage} / clamp_min({pg_primary_cpu_limit}, 0.001)',
                        0, y, w=6, h=6, unit="percent"))
    panels.append(gauge("Primary Memory Usage % of Limit",
                        f'100 * {pg_primary_mem_usage} / clamp_min({pg_primary_mem_limit}, 1)',
                        6, y, w=6, h=6, unit="percent"))
    panels.append(stat("CPU Limit (declared cores)",
                       pg_cpu_limit,
                       12, y, w=3, h=6, unit="short"))
    panels.append(stat("CPU Request (declared cores)",
                       pg_cpu_request,
                       15, y, w=3, h=6, unit="short"))
    panels.append(stat("Memory Limit (declared)",
                       pg_mem_limit,
                       18, y, w=3, h=6, unit="bytes"))
    panels.append(stat("Memory Request (declared)",
                       pg_mem_request,
                       21, y, w=3, h=6, unit="bytes"))
    y += 6

    panels.append(ts("CPU throttling",
                     [(f'rate(container_cpu_cfs_throttled_seconds_total{{{pg_lbl}}}[5m])', "throttled seconds/s")],
                     0, y, w=12, h=8, unit="s"))
    panels.append(ts("Memory usage",
                     [(f'container_memory_working_set_bytes{{{pg_lbl}}}', "working set"),
                      (f'container_memory_rss{{{pg_lbl}}}', "rss"),
                      (pg_mem_limit, "declared limit"),
                      (pg_mem_request, "declared request")],
                     12, y, w=12, h=8, unit="bytes"))
    y += 8

    panels.append(row("Backups & Local Storage", y)); y += 1
    panels.append(stat("Seconds since last archive", 'max(cnpg_pg_stat_archiver_seconds_since_last_archival{namespace="rejourney"})', 0, y, w=4, h=4, unit="s",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 300}, {"color": "red", "value": 900}]}))
    panels.append(stat("Archive failures", 'max(cnpg_pg_stat_archiver_failed_count{namespace="rejourney"})', 4, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 1}]}))
    panels.append(stat("Last available backup age", 'time() - cnpg_collector_last_available_backup_timestamp{namespace="rejourney"}', 8, y, w=4, h=4, unit="s",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 3600 * 26}, {"color": "red", "value": 3600 * 48}]}))
    panels.append(stat("Last failed backup age", 'time() - cnpg_collector_last_failed_backup_timestamp{namespace="rejourney"}', 12, y, w=4, h=4, unit="s"))
    panels.append(stat("Root disk free %", '100 * node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}', 16, y, w=4, h=4, unit="percent",
                       thresholds={"mode": "absolute", "steps": [{"color": "red", "value": None}, {"color": "orange", "value": 15}, {"color": "green", "value": 30}]}))
    panels.append(stat("Database PVC used", f'sum({pvc_used_series(DATABASE_PVC_REGEX)})', 20, y, w=4, h=4, unit="bytes"))
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
    panels.append(stat("Memory frag ratio", 'redis_mem_fragmentation_ratio', 21, y, w=3, h=6, decimals=2,
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
    rd_mem_limit = kube_limit_expr('redis-node-[0-9]+', 'redis', 'memory')
    rd_mem_request = kube_request_expr('redis-node-[0-9]+', 'redis', 'memory')
    rd_cpu_limit = kube_limit_expr('redis-node-[0-9]+', 'redis', 'cpu')
    panels.append(gauge("CPU Usage % of Limit",
                        f'100 * sum(rate(container_cpu_usage_seconds_total{{{rd_lbl}}}[2m])) / clamp_min({rd_cpu_limit}, 0.001)',
                        0, y, w=6, h=6, unit="percent"))
    panels.append(gauge("Memory Usage % of Limit",
                        f'100 * sum(container_memory_working_set_bytes{{{rd_lbl}}}) / clamp_min({rd_mem_limit}, 1)',
                        6, y, w=6, h=6, unit="percent"))
    panels.append(ts("CPU cores used",
                     [(f'sum(rate(container_cpu_usage_seconds_total{{{rd_lbl}}}[2m]))', "redis cpu")],
                     12, y, w=12, h=6, unit="short", decimals=3))
    y += 6

    panels.append(ts("Declared memory vs usage",
                     [(f'sum(container_memory_working_set_bytes{{{rd_lbl}}})', "working set"),
                      (rd_mem_limit, "declared limit"),
                      (rd_mem_request, "declared request")],
                     0, y, w=24, h=8, unit="bytes"))
    y += 8

    return dashboard("rejourney-redis", "30 — Redis", ["redis"], panels)

# ============================================================
# 40 — Traefik
# ============================================================
def d_traefik():
    reset_ids()
    panels = []
    y = 0
    edge_5xx = 'sum(rate(traefik_service_requests_total{code=~"5.."}[2m]))'
    edge_504 = 'sum(rate(traefik_service_requests_total{code="504"}[2m]))'
    edge_5xx_pct = '100 * sum(rate(traefik_service_requests_total{code=~"5.."}[2m])) / clamp_min(sum(rate(traefik_service_requests_total[2m])), 0.001)'

    panels.append(row("Overview", y)); y += 1
    panels.append(stat("Config reload OK", 'traefik_config_last_reload_success', 0, y, w=4, h=4,
                       mappings=[{"type": "value", "options": {"1": {"text": "OK", "color": "green"}, "0": {"text": "FAIL", "color": "red"}}}]))
    panels.append(stat("Config reloads (1h)", 'increase(traefik_config_reloads_total[1h])', 4, y, w=4, h=4))
    panels.append(stat("Open connections", 'sum(traefik_open_connections)', 8, y, w=4, h=4))
    panels.append(stat("RPS (all entrypoints)", 'sum(rate(traefik_entrypoint_requests_total[2m]))', 12, y, w=4, h=4, unit="reqps"))
    panels.append(stat("5xx rate", edge_5xx, 16, y, w=4, h=4, unit="reqps",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 10}]}))
    panels.append(stat("TLS cert min days to expiry", '(min(traefik_tls_certs_not_after) - time()) / 86400', 20, y, w=4, h=4, unit="d",
                       thresholds={"mode": "absolute", "steps": [{"color": "red", "value": None}, {"color": "orange", "value": 14}, {"color": "green", "value": 30}]}))
    y += 4

    panels.append(row("Edge errors", y)); y += 1
    panels.append(stat("504 rate", edge_504, 0, y, w=6, h=4, unit="reqps",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 0.1}, {"color": "red", "value": 1}]}))
    panels.append(stat("5xx %", edge_5xx_pct, 6, y, w=6, h=4, unit="percent",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 5}]}))
    panels.append(stat("5xx total (15m)", 'sum(increase(traefik_service_requests_total{code=~"5.."}[15m]))', 12, y, w=6, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 10}, {"color": "red", "value": 100}]}))
    panels.append(stat("504 total (15m)", 'sum(increase(traefik_service_requests_total{code="504"}[15m]))', 18, y, w=6, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 20}]}))
    y += 4

    panels.append(ts("5xx by code",
                     [('sum by (code)(rate(traefik_service_requests_total{code=~"5.."}[2m]))', "{{code}}")],
                     0, y, w=12, h=8, unit="reqps", stack="normal"))
    panels.append(ts("Top routers by 504 / sec",
                     [('topk(10, sum by (router)(rate(traefik_router_requests_total{code="504"}[5m])))', "{{router}}")],
                     12, y, w=12, h=8, unit="reqps"))
    y += 8

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
    api_lbl = 'namespace="rejourney",pod=~"api-.*",container="api"'
    api_mem_limit = kube_limit_expr('api-.*', 'api', 'memory')
    api_cpu_limit = kube_limit_expr('api-.*', 'api', 'cpu')

    panels.append(row("API health", y)); y += 1
    panels.append(stat("Edge 504s (15m)", 'sum(increase(traefik_service_requests_total{code="504"}[15m]))', 0, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 20}]}))
    panels.append(stat("API Restarts (15m)", 'sum(increase(kube_pod_container_status_restarts_total{namespace="rejourney",pod=~"api-.*",container="api"}[15m]))', 4, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 4}]}))
    panels.append(stat("API pods last OOMKilled", zero('sum(max by (pod)(kube_pod_container_status_last_terminated_reason{namespace="rejourney",pod=~"api-.*",container="api",reason="OOMKilled"}))'), 8, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 1}]}))
    panels.append(stat("API pods not ready", 'sum(1 - kube_pod_container_status_ready{namespace="rejourney",pod=~"api-.*",container="api"})', 12, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 2}]}))
    panels.append(gauge("API CPU % of Limit",
                        f'100 * sum(rate(container_cpu_usage_seconds_total{{{api_lbl}}}[2m])) / clamp_min({api_cpu_limit}, 0.001)',
                        16, y, w=4, h=4, unit="percent"))
    panels.append(gauge("API Memory % of Limit",
                        f'100 * sum(container_memory_working_set_bytes{{{api_lbl}}}) / clamp_min({api_mem_limit}, 1)',
                        20, y, w=4, h=4, unit="percent"))
    y += 4

    panels.append(ts("API memory by pod",
                     [(f'sum by (pod)(container_memory_working_set_bytes{{{api_lbl}}})', "{{pod}}"),
                      (f'sum by (pod)(container_memory_rss{{{api_lbl}}})', "rss — {{pod}}")],
                     0, y, w=12, h=8, unit="bytes"))
    panels.append(ts("API restarts / readiness",
                     [('sum by (pod)(increase(kube_pod_container_status_restarts_total{namespace="rejourney",pod=~"api-.*",container="api"}[15m]))', "restarts — {{pod}}"),
                      ('sum by (pod)(1 - kube_pod_container_status_ready{namespace="rejourney",pod=~"api-.*",container="api"})', "not ready — {{pod}}")],
                     12, y, w=12, h=8, unit="short"))
    y += 8

    panels.append(row("Replay / event consistency", y)); y += 1
    panels.append(stat("Replay-ready zero-event sessions",
                       zero('max(rejourney_ingest_replay_event_gap_recent_replay_ready_zero_event_sessions)'),
                       0, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 5}]}))
    panels.append(stat("Replay-ready waiting on events",
                       zero('max(rejourney_ingest_replay_event_gap_recent_replay_ready_waiting_event_sessions)'),
                       4, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 5}]}))
    panels.append(stat("Processing replay zero-event",
                       zero('max(rejourney_ingest_replay_event_gap_recent_processing_replay_zero_event_sessions)'),
                       8, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 5}]}))
    panels.append(stat("Waiting event jobs",
                       zero('max(rejourney_ingest_replay_event_gap_recent_waiting_event_jobs)'),
                       12, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 10}, {"color": "red", "value": 100}]}))
    panels.append(stat("Oldest waiting event job age",
                       zero('max(rejourney_ingest_replay_event_gap_recent_oldest_waiting_event_job_age_seconds)'),
                       16, y, w=4, h=4, unit="s",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 120}, {"color": "red", "value": 600}]}))
    panels.append(stat("Events uploaded, not ready",
                       zero('sum(rejourney_recording_artifacts_by_status_artifact_count{kind="events",status="uploaded"})'),
                       20, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 10}, {"color": "red", "value": 100}]}))
    y += 4

    panels.append(ts("Replay/event lag signals",
                     [(zero('max(rejourney_ingest_replay_event_gap_recent_replay_ready_zero_event_sessions)'), "replay-ready zero-event"),
                      (zero('max(rejourney_ingest_replay_event_gap_recent_replay_ready_waiting_event_sessions)'), "replay-ready waiting events"),
                      (zero('max(rejourney_ingest_replay_event_gap_recent_waiting_event_jobs)'), "waiting event jobs"),
                      (zero('sum(rejourney_recording_artifacts_by_status_artifact_count{kind="events",status="uploaded"})'), "events uploaded")],
                     0, y, w=12, h=8, unit="short"))
    panels.append(ts("Pending ingest jobs by kind",
                     [(zero('sum by (kind)(rejourney_ingest_jobs_by_status_job_count{status="pending"})'), "pending — {{kind}}"),
                      (zero('sum by (kind)(rejourney_ingest_jobs_by_status_job_count{status="processing"})'), "processing — {{kind}}")],
                     12, y, w=12, h=8, unit="short"))
    y += 8

    panels.append(ts("Replay availability over time",
                     [(zero('sum(rejourney_sessions_replay_availability_recent_session_count{replay_state="available"})'), "replay available"),
                      (zero('sum(rejourney_sessions_replay_availability_recent_session_count{replay_state="not_available"})'), "replay not available")],
                     0, y, w=12, h=8, unit="short"))
    panels.append(ts("Replay availability by session status",
                     [(zero('sum by (status)(rejourney_sessions_replay_availability_recent_session_count{replay_state="available"})'), "available — {{status}}"),
                      (zero('sum by (status)(rejourney_sessions_replay_availability_recent_session_count{replay_state="not_available"})'), "not available — {{status}}")],
                     12, y, w=12, h=8, unit="short"))
    y += 8

    panels.append(row("Artifacts pipeline", y)); y += 1
    panels.append(stat("Created (1h)", zero('sum(rejourney_artifacts_created_recent_created_count)'), 0, y, w=4, h=4))
    panels.append(stat("Completed (1h)", zero('sum(rejourney_artifacts_completed_recent_completed_count)'), 4, y, w=4, h=4))
    panels.append(stat("Failed artifacts (1h)", zero('sum(rejourney_artifacts_failed_recent_artifact_count)'), 8, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 10}]}))
    panels.append(stat("Stalled (current)", zero('sum(rejourney_artifacts_stalled_stalled_count)'), 12, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 10}]}))
    panels.append(stat("Stalled oldest age", zero('max(rejourney_artifacts_stalled_oldest_age_seconds)'), 16, y, w=4, h=4, unit="s"))
    panels.append(stat("Bytes created (1h)", zero('sum(rejourney_artifacts_created_recent_created_bytes)'), 20, y, w=4, h=4, unit="bytes"))
    y += 4

    panels.append(ts("Upload latency (recent window)",
                     [(zero('max(rejourney_artifacts_upload_latency_recent_p50_seconds)'), "p50"),
                      (zero('max(rejourney_artifacts_upload_latency_recent_p95_seconds)'), "p95"),
                      (zero('max(rejourney_artifacts_upload_latency_recent_p99_seconds)'), "p99"),
                      (zero('max(rejourney_artifacts_upload_latency_recent_max_seconds)'), "max")],
                     0, y, w=12, h=8, unit="s"))
    panels.append(ts("Recording artifacts by status",
                     [(zero('sum by (status)(rejourney_recording_artifacts_by_status_artifact_count)'), "{{status}}")],
                     12, y, w=12, h=8, unit="short"))
    y += 8

    panels.append(row("Ingest jobs", y)); y += 1
    panels.append(ts("Jobs by status",
                     [(zero('sum by (status)(rejourney_ingest_jobs_by_status_job_count)'), "{{status}}")],
                     0, y, w=24, h=8, unit="short"))
    y += 8

    panels.append(row("Session backup", y)); y += 1
    panels.append(stat("Queue depth", zero('sum(rejourney_session_backup_queue_queued)'), 0, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 100}, {"color": "red", "value": 1000}]}))
    panels.append(stat("Oldest queue age", zero('max(rejourney_session_backup_queue_oldest_age_seconds)'), 4, y, w=4, h=4, unit="s"))
    panels.append(stat("Max attempts seen", zero('max(rejourney_session_backup_queue_max_attempts)'), 8, y, w=4, h=4))
    panels.append(stat("Seconds since last backup", zero('max(rejourney_session_backup_recent_seconds_since_last_backup)'), 12, y, w=4, h=4, unit="s",
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 3600}, {"color": "red", "value": 86400}]}))
    panels.append(stat("Sessions backed up (1h)", zero('sum(rejourney_session_backup_recent_sessions_backed_up_1h)'), 16, y, w=4, h=4))
    panels.append(stat("Bytes backed up (1h)", zero('sum(rejourney_session_backup_recent_bytes_backed_up_1h)'), 20, y, w=4, h=4, unit="bytes"))
    y += 4

    panels.append(ts("Integrity (7d rolling)",
                     [(zero('max(rejourney_session_backup_integrity_recent_copied_plan_mismatch_count_7d)'), "plan mismatch"),
                      (zero('max(rejourney_session_backup_integrity_recent_low_quality_count_7d)'), "low quality"),
                      (zero('max(rejourney_session_backup_integrity_recent_manifest_missing_count_7d)'), "manifest missing"),
                      (zero('max(rejourney_session_backup_integrity_recent_r2_parity_mismatch_count_7d)'), "r2 parity mismatch")],
                     0, y, w=24, h=8, unit="short"))
    y += 8

    panels.append(row("Retention", y)); y += 1
    panels.append(stat("Deleted objects (24h)", zero('sum(rejourney_retention_recent_summary_deleted_objects_24h)'), 0, y, w=6, h=4))
    panels.append(stat("Deleted bytes (24h)", zero('sum(rejourney_retention_recent_summary_deleted_bytes_24h)'), 6, y, w=6, h=4, unit="bytes"))
    panels.append(stat("Failed purges (24h)", zero('sum(rejourney_retention_recent_summary_failed_purge_entries_24h)'), 12, y, w=6, h=4,
                       thresholds={"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red", "value": 1}]}))
    panels.append(stat("Seconds since last purge", zero('max(rejourney_retention_recent_summary_seconds_since_last_completed_purge)'), 18, y, w=6, h=4, unit="s"))
    y += 4

    panels.append(ts("Retention per-endpoint (recent)",
                     [(zero('sum by (endpoint_url)(rejourney_retention_endpoint_activity_recent_deleted_objects)'), "{{endpoint_url}}")],
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

    panels.append(row("Active PVC usage", y)); y += 1
    panels.append(bargauge("Active PVC Usage %",
                           pvc_usage_percent_series(),
                           0, y, w=12, h=10, unit="percent", legend="{{persistentvolumeclaim}}"))
    panels.append(ts("Active PVC used bytes",
                     [(pvc_used_series(), "{{persistentvolumeclaim}}")],
                     12, y, w=12, h=10, unit="bytes"))
    y += 10

    panels.append(ts("Active PVC free bytes",
                     [(pvc_free_series(), "{{persistentvolumeclaim}}")],
                     0, y, w=12, h=8, unit="bytes"))
    panels.append(ts("Active PVC inode count",
                     [(pvc_inodes_used_series(), "{{persistentvolumeclaim}}")],
                     12, y, w=12, h=8, unit="short"))
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
                     [(zero('sum by (endpoint_url)(rejourney_retention_endpoint_activity_recent_deleted_objects)'), "{{endpoint_url}}")],
                     0, y, w=12, h=8, unit="short"))
    panels.append(ts("Deleted bytes by endpoint (recent)",
                     [(zero('sum by (endpoint_url)(rejourney_retention_endpoint_activity_recent_deleted_bytes)'), "{{endpoint_url}}")],
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
                        [(zero('pushgateway_last_push_timestamp_seconds'), "")],
                        0, y, w=24, h=10))
    y += 10

    return dashboard("rejourney-self", "70 — VictoriaMetrics & Self", ["self", "monitoring"], panels)

# ============================================================
# 80 — Users & Growth  (teams as the primary unit)
# ============================================================
def d_users():
    reset_ids()
    panels = []
    y = 0

    # Shorthand references to the scalar metrics exposed by rejourney_platform_stats
    def ps(col): return f"rejourney_platform_stats_{col}"

    red1   = {"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "red",    "value": 1}]}
    green1 = {"mode": "absolute", "steps": [{"color": "green", "value": None}]}

    # ── Team overview stats ────────────────────────────────────────────────
    panels.append(row("Teams", y)); y += 1
    panels.append(stat("Total Teams",     ps("total_teams"),               0, y, w=4, h=4, thresholds=green1, instant=True))
    panels.append(stat("Paid Teams",      ps("paid_teams"),                4, y, w=4, h=4, thresholds=green1, instant=True))
    panels.append(stat("Free Teams",
        f'{ps("total_teams")} - {ps("paid_teams")}',                       8, y, w=4, h=4, thresholds=green1, instant=True))
    panels.append(stat("Active Teams (30d)", ps("active_teams_30d"),      12, y, w=4, h=4, thresholds=green1, instant=True))
    panels.append(stat("Active Projects (30d)", ps("active_projects_30d"), 16, y, w=4, h=4, thresholds=green1, instant=True))
    panels.append(stat("Payment Failures", ps("teams_payment_failed"),    20, y, w=4, h=4,
                       thresholds={"mode": "absolute", "steps": [
                           {"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 3}]}, instant=True))
    y += 4

    # ── Platform activity ───────────────────────────────────────────────────
    panels.append(row("Platform — last 30 days", y)); y += 1
    panels.append(stat("Sessions (30d)",     ps("sessions_30d"),           0, y, w=6, h=4, thresholds=green1, instant=True))
    panels.append(stat("Storage (period)",   ps("storage_bytes_period"),   6, y, w=6, h=4, unit="bytes", thresholds=green1, instant=True))
    panels.append(stat("Total Users",        ps("total_users"),           12, y, w=4, h=4, thresholds=green1, instant=True))
    panels.append(stat("New Users (24 h)",   ps("new_users_24h"),         16, y, w=4, h=4, thresholds=green1, instant=True))
    panels.append(stat("New Users (7 d)",    ps("new_users_7d"),          20, y, w=4, h=4, thresholds=green1, instant=True))
    y += 4

    # ── Growth time series (accumulates value over time) ───────────────────
    panels.append(row("Growth over time", y)); y += 1
    panels.append(ts(
        "Teams — total vs paid",
        [(ps("total_teams"), "All teams"), (ps("paid_teams"), "Paid teams")],
        0, y, w=12, h=8, unit="short", fill=5,
        legend_calcs=("lastNotNull", "max"),
    ))
    panels.append(ts(
        "Signup rate — new users in rolling windows",
        [(ps("new_users_24h"), "24 h"), (ps("new_users_7d"), "7 d"), (ps("new_users_30d"), "30 d")],
        12, y, w=12, h=8, unit="short", fill=0,
        legend_calcs=("lastNotNull",),
    ))
    y += 8

    # ── Daily breakdown snapshots ───────────────────────────────────────────
    panels.append(row("Daily breakdown — last 30 days (snapshot, refreshes each scrape)", y)); y += 1

    def _snap_bargauge(title, expr, y_, unit="short"):
        return {
            "id": nid(),
            "type": "bargauge",
            "title": title,
            "datasource": DATASOURCE,
            "gridPos": {"x": 0, "y": y_, "w": 24, "h": 12},
            "targets": [{
                "datasource": DATASOURCE,
                "expr": expr,
                "legendFormat": "{{day}}",
                "refId": "A",
                "instant": True,
            }],
            "options": {
                "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
                "orientation": "horizontal",
                "displayMode": "basic",
                "showUnfilled": True,
                "valueMode": "color",
                "minVizHeight": 10,
                "minVizWidth": 0,
            },
            "fieldConfig": {
                "defaults": {
                    "unit": unit,
                    "min": 0,
                    "color": {"mode": "palette-classic"},
                    "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]},
                },
                "overrides": [],
            },
        }

    panels.append(_snap_bargauge(
        "Sessions per day (platform-wide)",
        "rejourney_platform_sessions_daily_total_sessions",
        y,
    ))
    y += 12

    panels.append(_snap_bargauge(
        "New user signups per day",
        "rejourney_user_signups_daily_signups",
        y,
    ))
    y += 12

    # ── Top teams table ─────────────────────────────────────────────────────
    panels.append(row("Top 25 teams — last 30 days by sessions", y)); y += 1

    top_tbl = {
        "id": nid(),
        "type": "table",
        "title": "Top Teams",
        "datasource": DATASOURCE,
        "gridPos": {"x": 0, "y": y, "w": 24, "h": 16},
        "targets": [
            {**target("rejourney_top_teams_by_sessions_sessions",        "{{team}}", instant=True, ref="A"), "format": "table"},
            {**target("rejourney_top_teams_by_sessions_active_projects", "",         instant=True, ref="B"), "format": "table"},
            {**target("rejourney_top_teams_by_sessions_storage_bytes",   "",         instant=True, ref="C"), "format": "table"},
            {**target("rejourney_top_teams_by_sessions_requests",        "",         instant=True, ref="D"), "format": "table"},
        ],
        "transformations": [
            {"id": "merge"},
            {"id": "organize", "options": {
                "renameByName": {
                    "Value #A": "Sessions (30d)",
                    "Value #B": "Projects",
                    "Value #C": "Storage",
                    "Value #D": "Requests",
                    "team": "Team",
                    "plan": "Plan",
                },
                "excludeByName": {"Time": True},
                "indexByName": {"Team": 0, "Plan": 1, "Sessions (30d)": 2, "Projects": 3, "Storage": 4, "Requests": 5},
            }},
        ],
        "fieldConfig": {
            "defaults": {"custom": {"align": "auto"}},
            "overrides": [
                {
                    "matcher": {"id": "byName", "options": "Sessions (30d)"},
                    "properties": [
                        {"id": "custom.displayMode", "value": "color-background"},
                        {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                            {"color": "green",  "value": None},
                            {"color": "yellow", "value": 10000},
                            {"color": "orange", "value": 50000},
                            {"color": "red",    "value": 200000},
                        ]}},
                    ],
                },
                {
                    "matcher": {"id": "byName", "options": "Storage"},
                    "properties": [
                        {"id": "unit", "value": "bytes"},
                        {"id": "custom.displayMode", "value": "color-background"},
                        {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                            {"color": "green",  "value": None},
                            {"color": "yellow", "value": 1073741824},   # 1 GiB
                            {"color": "orange", "value": 10737418240},  # 10 GiB
                            {"color": "red",    "value": 53687091200},  # 50 GiB
                        ]}},
                    ],
                },
                {
                    "matcher": {"id": "byName", "options": "Plan"},
                    "properties": [
                        {"id": "mappings", "value": [{"type": "value", "options": {
                            "paid": {"text": "Paid", "color": "green", "index": 0},
                            "free": {"text": "Free", "color": "blue",  "index": 1},
                        }}]},
                        {"id": "custom.displayMode", "value": "color-text"},
                    ],
                },
            ],
        },
        "options": {
            "showHeader": True,
            "sortBy": [{"displayName": "Sessions (30d)", "desc": True}],
            "footer": {"show": False},
        },
    }
    panels.append(top_tbl)
    y += 16

    return dashboard(
        "rejourney-users",
        "80 — Users & Growth",
        ["users", "growth", "teams"],
        panels,
        refresh="60s",
        time_from="now-3h",
    )


# ============================================================
# 15 — Node Topology  (treemap: pods placed inside node boxes,
#                      sized by resource usage, grey = idle)
# ============================================================
def d_node_topology():
    reset_ids()
    panels = []
    y = 0

    # All pods in the namespace via kube_pod_info (value=0 baseline).
    # Active containers report real usage from cadvisor (already has a
    # `node` label via VictoriaMetrics relabeling).  The OR union keeps
    # idle/init pods visible as tiny grey boxes; clamp_min gives them a
    # non-zero floor so they occupy a visible sliver of area.
    _all_pods = (
        'sum by (pod, node)('
        '  kube_pod_info{namespace="rejourney"} * 0'
        ')'
    )
    _cpu_active = (
        'sum by (pod, node)('
        '  rate(container_cpu_usage_seconds_total'
        '{namespace="rejourney",container!="POD",container!=""}[5m])'
        ')'
    )
    _mem_active = (
        'sum by (pod, node)('
        '  container_memory_working_set_bytes'
        '{namespace="rejourney",container!="POD",container!=""}'
        ')'
    )

    # Floor: 1 millicpu (0.001) so idle pods still appear as small boxes.
    cpu_expr = f'clamp_min(({_cpu_active}) OR ({_all_pods}), 0.001)'
    # Floor: 4 MiB so idle pods are visible alongside real consumers.
    mem_expr = f'clamp_min(({_mem_active}) OR ({_all_pods}), 4194304)'

    def _treemap(title, expr, y_, unit, steps):
        return {
            "id": nid(),
            "type": "marcusolsson-treemap-panel",
            "title": title,
            "datasource": DATASOURCE,
            "gridPos": {"x": 0, "y": y_, "w": 24, "h": 20},
            "targets": [{
                "datasource": DATASOURCE,
                "expr": expr,
                "legendFormat": "",
                "refId": "A",
                "instant": True,
                "format": "table",
            }],
            "options": {
                "tiling": "treemapSquarify",
                "textField": "pod",
                "sizeField": "Value",
                "groupByField": "node",
                "colorByField": "Value",
            },
            "fieldConfig": {
                "defaults": {
                    "unit": unit,
                    "color": {"mode": "thresholds"},
                    "thresholds": {
                        "mode": "absolute",
                        "steps": steps,
                    },
                    "custom": {},
                },
                "overrides": [],
            },
        }

    panels.append(row("CPU — pods per node (size = CPU cores used, grey = idle)", y)); y += 1
    panels.append(_treemap(
        "Pod CPU by Node",
        cpu_expr,
        y,
        "cores",
        [
            {"color": "gray",   "value": None},    # 0 / idle
            {"color": "green",  "value": 0.01},    # >10m
            {"color": "yellow", "value": 0.25},    # >250m
            {"color": "orange", "value": 0.75},    # >750m
            {"color": "red",    "value": 1.5},     # >1.5 cores
        ],
    ))
    y += 20

    panels.append(row("Memory — pods per node (size = working-set bytes, grey = idle)", y)); y += 1
    panels.append(_treemap(
        "Pod Memory by Node",
        mem_expr,
        y,
        "bytes",
        [
            {"color": "gray",   "value": None},       # floor / idle
            {"color": "green",  "value": 10485760},   # >10 MiB
            {"color": "yellow", "value": 104857600},  # >100 MiB
            {"color": "orange", "value": 314572800},  # >300 MiB
            {"color": "red",    "value": 524288000},  # >500 MiB
        ],
    ))
    y += 20

    return dashboard(
        "rejourney-node-topology",
        "15 — Node Topology",
        ["kubernetes", "topology"],
        panels,
        refresh="30s",
        time_from="now-30m",
    )


# ============================================================
# main
# ============================================================
dashes = [
    ("00-overview", d_overview()),
    ("10-kubernetes", d_kubernetes()),
    ("15-node-topology", d_node_topology()),
    ("20-postgres", d_postgres()),
    ("30-redis", d_redis()),
    ("40-traefik", d_traefik()),
    ("50-application", d_application()),
    ("60-storage", d_storage()),
    ("70-self", d_self()),
    ("80-users", d_users()),
]
import sys
for name, d in dashes:
    print(f"  {name}: {len(d['panels'])} panels", file=sys.stderr)
path = write_configmap(dashes)
print(f"wrote {path}  ({sum(os.path.getsize(path) for _ in [1])} bytes)", file=sys.stderr)
