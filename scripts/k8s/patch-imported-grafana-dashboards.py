#!/usr/bin/env python3

import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager


NAMESPACE = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("NAMESPACE", "rejourney")
GRAFANA_LOCAL_PORT = os.environ.get("GRAFANA_LOCAL_PORT", "33000")
GRAFANA_URL = f"http://127.0.0.1:{GRAFANA_LOCAL_PORT}"


def log(message: str) -> None:
    print(f"[grafana-dashboards] {message}")


def run(*args: str) -> str:
    return subprocess.check_output(args, text=True).strip()


def grafana_password() -> str:
    encoded = run(
        "kubectl",
        "get",
        "secret",
        "grafana-secret",
        "-n",
        NAMESPACE,
        "-o",
        "jsonpath={.data.admin-password}",
    )
    return base64.b64decode(encoded).decode("utf-8")


def auth_headers(password: str) -> dict[str, str]:
    token = base64.b64encode(f"admin:{password}".encode("utf-8")).decode("ascii")
    return {
        "Authorization": f"Basic {token}",
        "Content-Type": "application/json",
    }


def api_request(method: str, path: str, password: str, payload: dict | None = None) -> dict | list | None:
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(
        f"{GRAFANA_URL}{path}",
        data=data,
        method=method,
        headers=auth_headers(password),
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise

    if not raw:
        return None
    return json.loads(raw.decode("utf-8"))


@contextmanager
def grafana_port_forward():
    process = subprocess.Popen(
        [
            "kubectl",
            "port-forward",
            "-n",
            NAMESPACE,
            "svc/grafana",
            f"{GRAFANA_LOCAL_PORT}:3000",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                urllib.request.urlopen(f"{GRAFANA_URL}/api/health", timeout=2)
                break
            except Exception:
                time.sleep(1)
        else:
            raise RuntimeError("Grafana port-forward did not become ready")

        yield
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def walk_panels(panels: list[dict]) -> list[dict]:
    result: list[dict] = []
    stack = list(panels)
    while stack:
        panel = stack.pop()
        result.append(panel)
        stack.extend(panel.get("panels", []))
    return result


def set_variable_current(var: dict, text: str, value) -> None:
    var["current"] = {
        "selected": False,
        "text": text,
        "value": value,
    }


def make_all_variable(var: dict) -> None:
    var["includeAll"] = True
    var["allValue"] = ".*"
    set_variable_current(var, "All", "$__all")


def set_datasource_variable(var: dict) -> None:
    set_variable_current(var, "Prometheus", "Prometheus")


def cleanup_release_filters(text: str) -> str:
    replacements = [
        ('{release="$release", ', "{"),
        ('{release=~"$release", ', "{"),
        (', release="$release"', ""),
        (', release=~"$release"', ""),
        (',release="$release"', ""),
        (',release=~"$release"', ""),
        ('release="$release", ', ""),
        ('release=~"$release", ', ""),
        ('{release="$release"}', "{}"),
        ('{release=~"$release"}', "{}"),
    ]
    for old, new in replacements:
        text = text.replace(old, new)
    text = text.replace("{,", "{").replace(",}", "}").replace("{ }", "{}")
    text = re.sub(r"\{\s*,", "{", text)
    text = re.sub(r",\s*,", ", ", text)
    return text


def replace_strings(value, replacements: dict[str, str]):
    if isinstance(value, str):
        for old, new in replacements.items():
            value = value.replace(old, new)
        return value
    if isinstance(value, list):
        return [replace_strings(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: replace_strings(item, replacements) for key, item in value.items()}
    return value


def build_stat_panel(pid: int, title: str, expr: str, unit: str, x: int, y: int, w: int = 6, h: int = 4) -> dict:
    return {
        "id": pid,
        "type": "stat",
        "title": title,
        "datasource": {"type": "prometheus", "uid": "prometheus-compat"},
        "targets": [{"expr": expr, "legendFormat": "", "refId": "A"}],
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "thresholds": {
                    "mode": "absolute",
                    "steps": [
                        {"color": "green", "value": None},
                        {"color": "orange", "value": 75},
                        {"color": "red", "value": 90},
                    ],
                },
                "mappings": [],
            }
        },
        "options": {
            "reduceOptions": {"calcs": ["lastNotNull"]},
            "orientation": "auto",
            "textMode": "auto",
            "colorMode": "background",
        },
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
    }


def build_timeseries_panel(pid: int, title: str, targets: list, unit: str, x: int, y: int, w: int = 12, h: int = 8) -> dict:
    return {
        "id": pid,
        "type": "timeseries",
        "title": title,
        "datasource": {"type": "prometheus", "uid": "prometheus-compat"},
        "targets": targets,
        "fieldConfig": {"defaults": {"unit": unit}},
        "options": {"tooltip": {"mode": "multi"}},
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
    }


def set_panel_unit(panel: dict, unit: str) -> None:
    panel.setdefault("fieldConfig", {}).setdefault("defaults", {})["unit"] = unit


def set_single_target_expr(panel: dict, expr: str, legend: str | None = None) -> None:
    panel["targets"] = [
        {
            "expr": expr,
            "legendFormat": legend or "",
            "refId": "A",
        }
    ]


def patch_kube_dashboard(dashboard: dict) -> bool:
    changed = False
    replacements = {
        "kube_pod_container_resource_requests_cpu_cores": 'kube_pod_container_resource_requests{resource="cpu"}',
        "kube_pod_container_resource_requests_memory_bytes": 'kube_pod_container_resource_requests{resource="memory"}',
    }
    patched = replace_strings(dashboard, replacements)
    if patched != dashboard:
        dashboard.clear()
        dashboard.update(patched)
        changed = True

    for var in dashboard.get("templating", {}).get("list", []):
        name = var.get("name")
        if name == "datasource":
            set_datasource_variable(var)
            changed = True
        elif name == "cluster":
            set_variable_current(var, "rejourney-prod", "rejourney-prod")
            changed = True
        elif name in {"node", "namespace", "pod"}:
            make_all_variable(var)
            changed = True

    existing_titles = {p.get("title") for p in walk_panels(dashboard.get("panels", []))}
    if "Pod Resource Usage vs Limits" in existing_titles:
        return changed

    existing = walk_panels(dashboard.get("panels", []))
    max_y = max(
        (p.get("gridPos", {}).get("y", 0) + p.get("gridPos", {}).get("h", 0) for p in dashboard.get("panels", [])),
        default=0,
    )
    next_id = max((p.get("id", 0) for p in existing), default=100) + 1

    base_filter = 'cluster=~"$cluster", namespace=~"$namespace", container!="", container!="POD", image!=""'
    kube_filter = 'cluster=~"$cluster", namespace=~"$namespace"'
    pod_running_expr = f'count(max by (pod) (kube_pod_status_phase{{{kube_filter}, phase="Running"}} == 1))'
    pod_pending_expr = f'count(max by (pod) (kube_pod_status_phase{{{kube_filter}, phase="Pending"}} == 1))'
    pod_failed_expr = f'count(max by (pod) (kube_pod_status_phase{{{kube_filter}, phase=~"Failed|Unknown"}} == 1))'
    pod_not_ready_expr = f'sum(max by (pod) (1 - kube_pod_status_ready{{{kube_filter}, condition="true"}}))'
    waiting_containers_expr = (
        f'sum(kube_pod_container_status_waiting_reason{{{kube_filter}, '
        'reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError|RunContainerError|ContainerCreating"}})'
    )

    cpu_pct_targets = [
        {
            "expr": (
                f'100 * sum by (pod) (rate(container_cpu_usage_seconds_total{{{base_filter}}}[$__rate_interval]))'
                f' / clamp_min(sum by (pod) (container_spec_cpu_quota{{{base_filter}}} / container_spec_cpu_period{{{base_filter}}}), 0.001)'
            ),
            "legendFormat": "{{pod}}",
            "refId": "A",
        }
    ]
    mem_pct_targets = [
        {
            "expr": (
                f'100 * sum by (pod) (container_memory_working_set_bytes{{{base_filter}}})'
                f' / clamp_min(sum by (pod) (container_spec_memory_limit_bytes{{{base_filter}}}), 1)'
            ),
            "legendFormat": "{{pod}}",
            "refId": "A",
        }
    ]
    cpu_cores_targets = [
        {
            "expr": f'sum by (pod) (rate(container_cpu_usage_seconds_total{{{base_filter}}}[$__rate_interval]))',
            "legendFormat": "{{pod}}",
            "refId": "A",
        }
    ]
    mem_bytes_targets = [
        {
            "expr": f'sum by (pod) (container_memory_working_set_bytes{{{base_filter}}})',
            "legendFormat": "{{pod}}",
            "refId": "A",
        }
    ]
    throttled_pct_targets = [
        {
            "expr": (
                f'100 * sum by (pod) (rate(container_cpu_cfs_throttled_periods_total{{{base_filter}}}[$__rate_interval]))'
                f' / clamp_min(sum by (pod) (rate(container_cpu_cfs_periods_total{{{base_filter}}}[$__rate_interval])), 0.001)'
            ),
            "legendFormat": "{{pod}}",
            "refId": "A",
        }
    ]
    restart_targets = [
        {
            "expr": f'sum by (pod) (increase(kube_pod_container_status_restarts_total{{{kube_filter}}}[$__rate_interval]))',
            "legendFormat": "{{pod}}",
            "refId": "A",
        }
    ]
    restart_1h_targets = [
        {
            "expr": f'sum by (pod) (increase(kube_pod_container_status_restarts_total{{{kube_filter}}}[1h]))',
            "legendFormat": "{{pod}}",
            "refId": "A",
        }
    ]
    ready_targets = [
        {
            "expr": f'max by (pod) (kube_pod_status_ready{{{kube_filter}, condition=\"true\"}}) * 100',
            "legendFormat": "{{pod}}",
            "refId": "A",
        }
    ]
    running_pods_targets = [
        {
            "expr": f'count(max by (pod) (kube_pod_status_phase{{{kube_filter}, phase="Running"}} == 1))',
            "legendFormat": "Running",
            "refId": "A",
        },
        {
            "expr": f'count(max by (pod) (kube_pod_status_phase{{{kube_filter}, phase="Pending"}} == 1))',
            "legendFormat": "Pending",
            "refId": "B",
        },
        {
            "expr": f'count(max by (pod) (kube_pod_status_phase{{{kube_filter}, phase=~"Failed|Unknown"}} == 1))',
            "legendFormat": "Failed/Unknown",
            "refId": "C",
        },
    ]
    waiting_reason_targets = [
        {
            "expr": (
                f'sum by (reason) (kube_pod_container_status_waiting_reason{{{kube_filter}, '
                'reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError|RunContainerError|ContainerCreating"}})'
            ),
            "legendFormat": "{{reason}}",
            "refId": "A",
        }
    ]
    not_ready_targets = [
        {
            "expr": f'sum(max by (pod) (1 - kube_pod_status_ready{{{kube_filter}, condition="true"}}))',
            "legendFormat": "Not Ready",
            "refId": "A",
        }
    ]

    dashboard["panels"].append({
        "id": next_id,
        "type": "row",
        "title": "Kubernetes Workload Health",
        "collapsed": False,
        "gridPos": {"x": 0, "y": max_y, "w": 24, "h": 1},
        "panels": [],
    })
    summary_y = max_y + 1
    next_id += 1

    for i, (title, expr, unit, x) in enumerate([
        ("Running Pods", pod_running_expr, "short", 0),
        ("Pending Pods", pod_pending_expr, "short", 6),
        ("Failed or Unknown Pods", pod_failed_expr, "short", 12),
        ("Not Ready Pods", pod_not_ready_expr, "short", 18),
        ("Containers Waiting", waiting_containers_expr, "short", 0),
    ]):
        panel_width = 6 if i < 4 else 24
        panel_x = x if i < 4 else 0
        panel_y = summary_y if i < 4 else summary_y + 4
        dashboard["panels"].append(
            build_stat_panel(next_id + i, title, expr, unit, panel_x, panel_y, panel_width, 4)
        )

    next_id += 5
    row_y = summary_y + 8

    dashboard["panels"].append({
        "id": next_id,
        "type": "row",
        "title": "Pod Resource Usage vs Limits",
        "collapsed": False,
        "gridPos": {"x": 0, "y": row_y, "w": 24, "h": 1},
        "panels": [],
    })
    row_y += 1
    next_id += 1

    for i, (title, targets, unit, x, y) in enumerate([
        ("CPU % of Limit by Pod", cpu_pct_targets, "percent", 0, row_y),
        ("Memory % of Limit by Pod", mem_pct_targets, "percent", 12, row_y),
        ("CPU Cores by Pod", cpu_cores_targets, "cores", 0, row_y + 8),
        ("Memory Working Set by Pod", mem_bytes_targets, "bytes", 12, row_y + 8),
        ("Restart Rate by Pod", restart_targets, "short", 0, row_y + 16),
        ("Pod Ready %", ready_targets, "percent", 12, row_y + 16),
    ]):
        dashboard["panels"].append(build_timeseries_panel(next_id + i, title, targets, unit, x, y))

    next_id += 6
    pressure_y = row_y + 24
    dashboard["panels"].append({
        "id": next_id,
        "type": "row",
        "title": "Pod Pressure and Churn",
        "collapsed": False,
        "gridPos": {"x": 0, "y": pressure_y, "w": 24, "h": 1},
        "panels": [],
    })
    pressure_y += 1
    next_id += 1

    for i, (title, targets, unit, x, y) in enumerate([
        ("CPU Throttling % by Pod", throttled_pct_targets, "percent", 0, pressure_y),
        ("Restarts in Last Hour by Pod", restart_1h_targets, "short", 12, pressure_y),
        ("Pod Phase Counts", running_pods_targets, "short", 0, pressure_y + 8),
        ("Waiting Reasons", waiting_reason_targets, "short", 12, pressure_y + 8),
        ("Pods Not Ready Over Time", not_ready_targets, "short", 0, pressure_y + 16),
    ]):
        width = 12 if i < 4 else 24
        x_pos = x if i < 4 else 0
        dashboard["panels"].append(build_timeseries_panel(next_id + i, title, targets, unit, x_pos, y, width))

    changed = True

    return changed


def patch_traefik_dashboard(dashboard: dict) -> bool:
    changed = False
    patched = replace_strings(dashboard, {"P4169E866C3094E38": "prometheus-compat"})
    if patched != dashboard:
        dashboard.clear()
        dashboard.update(patched)
        changed = True
    for var in dashboard.get("templating", {}).get("list", []):
        name = var.get("name")
        if name in {"DS_PROMETHEUS", "datasource"}:
            set_datasource_variable(var)
            changed = True
        elif name in {"entrypoint", "service"}:
            make_all_variable(var)
            changed = True
    return changed


def patch_postgres_dashboard(dashboard: dict) -> bool:
    changed = False
    patched = replace_strings(dashboard, {"P4169E866C3094E38": "prometheus-compat"})
    if patched != dashboard:
        dashboard.clear()
        dashboard.update(patched)
        changed = True

    for var in dashboard.get("templating", {}).get("list", []):
        name = var.get("name")
        if name in {"DS_PROMETHEUS", "datasource"}:
            set_datasource_variable(var)
            changed = True
        elif name == "namespace":
            var["type"] = "custom"
            var["query"] = "rejourney"
            var["options"] = [{"selected": True, "text": "rejourney", "value": "rejourney"}]
            set_variable_current(var, "rejourney", "rejourney")
            changed = True
        elif name == "release":
            var["hide"] = 2
            var["type"] = "custom"
            var["query"] = "n/a"
            var["options"] = [{"selected": True, "text": "n/a", "value": "n/a"}]
            set_variable_current(var, "n/a", "n/a")
            changed = True
        elif name == "instance":
            var["definition"] = "label_values(pg_up, instance)"
            var["query"] = "label_values(pg_up, instance)"
            var["regex"] = ""
            var["hide"] = 0
            set_variable_current(var, "postgres-exporter.rejourney.svc.cluster.local:9187", "postgres-exporter.rejourney.svc.cluster.local:9187")
            changed = True
        elif name == "datname":
            var["definition"] = 'label_values(pg_database_size_size_bytes{instance=~"$instance"}, datname)'
            var["query"] = 'label_values(pg_database_size_size_bytes{instance=~"$instance"}, datname)'
            var["regex"] = ""
            var["hide"] = 0
            set_variable_current(var, "rejourney", "rejourney")
            changed = True
        elif name == "mode":
            make_all_variable(var)
            changed = True

    for panel in walk_panels(dashboard.get("panels", [])):
        title = panel.get("title", "")

        for target in panel.get("targets", []):
            for key in ("expr", "query"):
                if key in target and isinstance(target[key], str):
                    target[key] = cleanup_release_filters(target[key])

        if title == "Average CPU Usage":
            panel["title"] = "Postgres Container CPU Usage"
            set_single_target_expr(
                panel,
                'sum(rate(container_cpu_usage_seconds_total{cluster="rejourney-prod", namespace="rejourney", pod="postgres-0", container="postgres", cpu="total"}[$__rate_interval]))',
                "CPU cores",
            )
            set_panel_unit(panel, "cores")
            changed = True
        elif title == "Average Memory Usage":
            panel["title"] = "Postgres Container Memory Usage"
            set_single_target_expr(
                panel,
                'sum(container_memory_working_set_bytes{cluster="rejourney-prod", namespace="rejourney", pod="postgres-0", container="postgres"})',
                "Working set",
            )
            set_panel_unit(panel, "bytes")
            changed = True
        elif title == "Start Time":
            panel["title"] = "Database Size"
            set_single_target_expr(
                panel,
                'sum(pg_database_size_size_bytes{instance=~"$instance", datname=~"$datname"})',
                "Database size",
            )
            set_panel_unit(panel, "bytes")
            changed = True
        elif title == "Current fetch data":
            set_single_target_expr(
                panel,
                'sum(increase(pg_stat_database_tup_fetched{datname=~"$datname", instance=~"$instance"}[$__range]))',
                "Fetched rows",
            )
            changed = True
        elif title == "Current insert data":
            set_single_target_expr(
                panel,
                'sum(increase(pg_stat_database_tup_inserted{datname=~"$datname", instance=~"$instance"}[$__range]))',
                "Inserted rows",
            )
            changed = True
        elif title == "Current update data":
            set_single_target_expr(
                panel,
                'sum(increase(pg_stat_database_tup_updated{datname=~"$datname", instance=~"$instance"}[$__range]))',
                "Updated rows",
            )
            changed = True

    # --- Enhanced metrics rows (appended, idempotent via title check) ---
    existing_titles = {p.get("title") for p in walk_panels(dashboard.get("panels", []))}
    if "Container Resource Usage" not in existing_titles:
        existing = walk_panels(dashboard.get("panels", []))
        max_y = max(
            (p.get("gridPos", {}).get("y", 0) + p.get("gridPos", {}).get("h", 0) for p in dashboard.get("panels", [])),
            default=0,
        )
        next_id = max((p.get("id", 0) for p in existing), default=100) + 1

        # Row: Container Resource Usage
        dashboard["panels"].append({
            "id": next_id, "type": "row", "title": "Container Resource Usage",
            "collapsed": False, "gridPos": {"x": 0, "y": max_y, "w": 24, "h": 1}, "panels": [],
        })
        y = max_y + 1

        _PG = 'cluster="rejourney-prod",namespace="rejourney",pod="postgres-0",container="postgres"'
        pg_cpu_expr = (
            f'sum(rate(container_cpu_usage_seconds_total{{{_PG},cpu="total"}}[$__rate_interval]))'
            f' / sum(container_spec_cpu_quota{{{_PG}}} / container_spec_cpu_period{{{_PG}}}) * 100'
        )
        pg_mem_pct_expr = (
            f'sum(container_memory_working_set_bytes{{{_PG}}})'
            f' / sum(container_spec_memory_limit_bytes{{{_PG}}}) * 100'
        )
        pg_cpu_limit_expr = (
            f'sum(container_spec_cpu_quota{{{_PG}}})'
            f' / sum(container_spec_cpu_period{{{_PG}}})'
        )
        pg_mem_limit_expr = f'sum(container_spec_memory_limit_bytes{{{_PG}}})'

        for i, (title, expr, unit, x) in enumerate([
            ("CPU Usage % of Limit",    pg_cpu_expr,       "percent", 0),
            ("Memory Usage % of Limit", pg_mem_pct_expr,   "percent", 6),
            ("CPU Limit (cores)",       pg_cpu_limit_expr, "short",   12),
            ("Memory Limit",            pg_mem_limit_expr, "bytes",   18),
        ]):
            dashboard["panels"].append(build_stat_panel(next_id + 1 + i, title, expr, unit, x, y))
        next_id += 5

        # Row: Database Health
        y += 4
        dashboard["panels"].append({
            "id": next_id, "type": "row", "title": "Database Health",
            "collapsed": False, "gridPos": {"x": 0, "y": y, "w": 24, "h": 1}, "panels": [],
        })
        y += 1

        conn_pct_expr = (
            'sum(pg_stat_activity_count{instance=~"$instance"})'
            ' / pg_settings_max_connections{instance=~"$instance"} * 100'
        )
        cache_hit_expr = (
            'sum(pg_stat_database_blks_hit{instance=~"$instance",datname=~"$datname"})'
            ' / (sum(pg_stat_database_blks_hit{instance=~"$instance",datname=~"$datname"})'
            '  + sum(pg_stat_database_blks_read{instance=~"$instance",datname=~"$datname"})) * 100'
        )

        for i, (title, expr, unit, x) in enumerate([
            ("Connection Utilization %", conn_pct_expr,                                                            "percent", 0),
            ("Cache Hit Rate %",         cache_hit_expr,                                                           "percent", 6),
            ("Active Connections",       'sum(pg_stat_activity_count{instance=~"$instance",state="active"})',      "short",   12),
            ("Idle Connections",         'sum(pg_stat_activity_count{instance=~"$instance",state="idle"})',        "short",   18),
        ]):
            dashboard["panels"].append(build_stat_panel(next_id + 1 + i, title, expr, unit, x, y))
        next_id += 5

        # Row: Query Throughput & Errors
        y += 4
        dashboard["panels"].append({
            "id": next_id, "type": "row", "title": "Query Throughput & Errors",
            "collapsed": False, "gridPos": {"x": 0, "y": y, "w": 24, "h": 1}, "panels": [],
        })
        y += 1

        tps_targets = [
            {"expr": 'sum(rate(pg_stat_database_xact_commit{instance=~"$instance",datname=~"$datname"}[$__rate_interval]))',   "legendFormat": "Commits/s",   "refId": "A"},
            {"expr": 'sum(rate(pg_stat_database_xact_rollback{instance=~"$instance",datname=~"$datname"}[$__rate_interval]))', "legendFormat": "Rollbacks/s", "refId": "B"},
        ]
        rows_targets = [
            {"expr": 'sum(rate(pg_stat_database_tup_inserted{instance=~"$instance",datname=~"$datname"}[$__rate_interval]))', "legendFormat": "Inserts/s",  "refId": "A"},
            {"expr": 'sum(rate(pg_stat_database_tup_updated{instance=~"$instance",datname=~"$datname"}[$__rate_interval]))',  "legendFormat": "Updates/s",  "refId": "B"},
            {"expr": 'sum(rate(pg_stat_database_tup_deleted{instance=~"$instance",datname=~"$datname"}[$__rate_interval]))',  "legendFormat": "Deletes/s",  "refId": "C"},
            {"expr": 'sum(rate(pg_stat_database_tup_fetched{instance=~"$instance",datname=~"$datname"}[$__rate_interval]))',  "legendFormat": "Fetches/s",  "refId": "D"},
        ]
        errors_targets = [
            {"expr": 'sum(rate(pg_stat_database_deadlocks{instance=~"$instance",datname=~"$datname"}[$__rate_interval]))', "legendFormat": "Deadlocks/s",  "refId": "A"},
            {"expr": 'sum(rate(pg_stat_database_temp_files{instance=~"$instance",datname=~"$datname"}[$__rate_interval]))', "legendFormat": "Temp files/s", "refId": "B"},
            {"expr": 'sum(rate(pg_stat_database_conflicts{instance=~"$instance",datname=~"$datname"}[$__rate_interval]))',  "legendFormat": "Conflicts/s",  "refId": "C"},
        ]
        wal_targets = [
            {"expr": 'pg_wal_size_bytes{instance=~"$instance"}', "legendFormat": "WAL size", "refId": "A"},
        ]

        for i, (title, targets, unit, x, row_y) in enumerate([
            ("Transactions Per Second",   tps_targets,    "short", 0,  y),
            ("Row Operations Per Second", rows_targets,   "short", 12, y),
            ("Errors & Conflicts",        errors_targets, "short", 0,  y + 8),
            ("WAL Size",                  wal_targets,    "bytes", 12, y + 8),
        ]):
            dashboard["panels"].append(build_timeseries_panel(next_id + 1 + i, title, targets, unit, x, row_y))

        changed = True

    return changed


def patch_node_dashboard(dashboard: dict) -> bool:
    changed = False

    for var in dashboard.get("templating", {}).get("list", []):
        if var.get("name") in {"DS_PROMETHEUS", "datasource"}:
            set_datasource_variable(var)
            changed = True

    existing_titles = {p.get("title") for p in walk_panels(dashboard.get("panels", []))}
    if "Root Disk Used %" in existing_titles:
        return changed

    existing = walk_panels(dashboard.get("panels", []))
    max_y = max(
        (p.get("gridPos", {}).get("y", 0) + p.get("gridPos", {}).get("h", 0) for p in dashboard.get("panels", [])),
        default=0,
    )
    next_id = max((p.get("id", 0) for p in existing), default=100) + 1

    root_disk_used_pct_expr = (
        'max(100 * (1 - ('
        'node_filesystem_avail_bytes{mountpoint="/",fstype!="",device!~"rootfs"}'
        " / "
        'node_filesystem_size_bytes{mountpoint="/",fstype!="",device!~"rootfs"}'
        ")))"
    )

    dashboard["panels"].append({
        "id": next_id,
        "type": "row",
        "title": "Disk Capacity",
        "collapsed": False,
        "gridPos": {"x": 0, "y": max_y, "w": 24, "h": 1},
        "panels": [],
    })
    dashboard["panels"].append(
        build_stat_panel(
            next_id + 1,
            "Root Disk Used %",
            root_disk_used_pct_expr,
            "percent",
            0,
            max_y + 1,
            6,
            4,
        )
    )
    changed = True

    return changed


def patch_dashboards_by_search(query: str, patch_fn, password: str, title_contains: str | None = None) -> None:
    search = api_request(
        "GET",
        f"/api/search?type=dash-db&query={urllib.parse.quote(query)}",
        password,
    )
    if not search:
        log(f'No dashboards found for search "{query}", skipping')
        return

    matches = []
    for item in search:
        title = item.get("title", "")
        if title_contains and title_contains not in title:
            continue
        uid = item.get("uid")
        if uid:
            matches.append(uid)

    if not matches:
        log(f'No dashboards matched "{query}" after filtering, skipping')
        return

    for uid in matches:
        patch_dashboard(uid, patch_fn, password)


def patch_dashboard(uid: str, patch_fn, password: str) -> None:
    payload = api_request("GET", f"/api/dashboards/uid/{uid}", password)
    if not payload:
        log(f"Dashboard {uid} not found, skipping")
        return

    dashboard = payload["dashboard"]
    meta = payload["meta"]
    original = json.dumps(dashboard, sort_keys=True)

    if not patch_fn(dashboard):
        log(f"Dashboard {uid} already up to date")
        return

    updated = json.dumps(dashboard, sort_keys=True)
    if updated == original:
        log(f"Dashboard {uid} unchanged after patch function")
        return

    api_request(
        "POST",
        "/api/dashboards/db",
        password,
        {
            "dashboard": dashboard,
            "folderId": meta.get("folderId", 0),
            "message": "Patch imported dashboards for VictoriaMetrics + cAdvisor labels",
            "overwrite": True,
        },
    )
    log(f"Patched dashboard {uid}")


def main() -> int:
    password = grafana_password()

    with grafana_port_forward():
        patch_dashboard("garysdevil-kube-state-metrics-v2", patch_kube_dashboard, password)
        patch_dashboard("n5bu_kv45", patch_traefik_dashboard, password)
        patch_dashboard("000000039", patch_postgres_dashboard, password)
        patch_dashboards_by_search("Node Exporter Full", patch_node_dashboard, password, title_contains="Node Exporter Full")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
