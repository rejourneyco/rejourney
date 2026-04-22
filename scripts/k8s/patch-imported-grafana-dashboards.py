#!/usr/bin/env python3
"""Delete legacy community-imported Grafana dashboards.

History: we used to import community dashboards (kube-state-metrics, Node Exporter,
PostgreSQL Database, Traefik, VictoriaMetrics) and patch their panels. That
approach was brittle — every upgrade reset our patches and the panel layouts
never matched our data model cleanly.

The replacement (k8s/grafana-dashboards.yaml) provisions a custom dashboard
set via ConfigMap. This script runs on every deploy to ensure the old
community dashboards are removed so they don't clutter the sidebar.

Idempotent — safe to run when the dashboards are already gone. Keeps its old
filename so deploy-release.sh doesn't need to change.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from contextlib import contextmanager


NAMESPACE = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("NAMESPACE", "rejourney")
GRAFANA_LOCAL_PORT = os.environ.get("GRAFANA_LOCAL_PORT", "33000")
GRAFANA_URL = f"http://127.0.0.1:{GRAFANA_LOCAL_PORT}"

# UIDs of community-imported dashboards to remove. Safe to extend if we import
# more community dashboards later and then replace them with our own.
LEGACY_UIDS = [
    "garysdevil-kube-state-metrics-v2",
    "rYdddlPWk",           # Node Exporter Full
    "000000039",           # PostgreSQL Database
    "n5bu_kv45",           # Traefik Official Standalone Dashboard
    "wNf0q_kZk",           # VictoriaMetrics - single-node
]


def log(msg: str) -> None:
    print(f"[grafana-cleanup] {msg}")


def run(*args: str) -> str:
    return subprocess.check_output(args, text=True).strip()


def grafana_password() -> str:
    enc = run("kubectl", "get", "secret", "grafana-secret", "-n", NAMESPACE,
              "-o", "jsonpath={.data.admin-password}")
    return base64.b64decode(enc).decode("utf-8")


def auth_headers(password: str) -> dict[str, str]:
    token = base64.b64encode(f"admin:{password}".encode()).decode("ascii")
    return {"Authorization": f"Basic {token}", "Content-Type": "application/json"}


def api(method: str, path: str, password: str) -> int:
    req = urllib.request.Request(
        f"{GRAFANA_URL}{path}", method=method, headers=auth_headers(password)
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status
    except urllib.error.HTTPError as exc:
        return exc.code


@contextmanager
def port_forward():
    proc = subprocess.Popen(
        ["kubectl", "-n", NAMESPACE, "port-forward", "deploy/grafana",
         f"{GRAFANA_LOCAL_PORT}:3000"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        # Wait for the port to be ready
        pw = grafana_password()
        for _ in range(40):
            time.sleep(0.5)
            if api("GET", "/api/health", pw) == 200:
                break
        else:
            raise RuntimeError("Grafana port-forward did not become ready")
        yield pw
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def main() -> int:
    with port_forward() as pw:
        for uid in LEGACY_UIDS:
            status = api("DELETE", f"/api/dashboards/uid/{uid}", pw)
            if status == 200:
                log(f"deleted legacy dashboard uid={uid}")
            elif status == 404:
                pass  # already gone
            else:
                log(f"WARN: delete uid={uid} returned HTTP {status}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
