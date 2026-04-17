#!/usr/bin/env python3

import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
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
        elif name in {"node", "namespace"}:
            make_all_variable(var)
            changed = True

    return changed


def patch_traefik_dashboard(dashboard: dict) -> bool:
    changed = False
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

    return changed


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

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
