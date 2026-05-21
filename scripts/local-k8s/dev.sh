#!/bin/bash
# Local hybrid development helper.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.k8s.local}"
STATE_DIR="$ROOT_DIR/.local-k8s"
LOG_DIR="$STATE_DIR/logs"
PID_DIR="$STATE_DIR/pids"
DASHBOARD_HOST_PORT="${DASHBOARD_HOST_PORT:-8080}"
HOST_STARTUP_WAIT_SECONDS="${HOST_STARTUP_WAIT_SECONDS:-30}"
HOST_PORTS=(3000 3001 "$DASHBOARD_HOST_PORT")
CLICKHOUSE_HOST_PORT="${CLICKHOUSE_HOST_PORT:-30123}"
CLICKHOUSE_NATIVE_HOST_PORT="${CLICKHOUSE_NATIVE_HOST_PORT:-30124}"

mkdir -p "$LOG_DIR" "$PID_DIR"

use_node24_if_available() {
    local node_major=""
    node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || true)"
    if [ "$node_major" = "24" ]; then
        return
    fi

    if command -v fnm >/dev/null 2>&1; then
        eval "$(fnm env --shell bash)"
        fnm use 24 --install-if-missing --silent-if-unchanged >/dev/null 2>&1 || true
        hash -r
    fi
}

use_node24_if_available

kill_pid_gracefully() {
    local pid="$1"
    local pgid

    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        return
    fi

    pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"

    if [ -n "$pgid" ]; then
        kill -TERM -- "-$pgid" 2>/dev/null || true
    else
        kill "$pid" 2>/dev/null || true
    fi

    local attempts=$((HOST_STARTUP_WAIT_SECONDS * 2))
    for ((attempt = 1; attempt <= attempts; attempt++)); do
        if ! kill -0 "$pid" 2>/dev/null; then
            return
        fi
        sleep 0.25
    done

    if [ -n "$pgid" ]; then
        kill -KILL -- "-$pgid" 2>/dev/null || true
    else
        kill -9 "$pid" 2>/dev/null || true
    fi
}

kill_if_running() {
    local pid_file="$1"
    if [ -f "$pid_file" ]; then
        local pid
        pid="$(cat "$pid_file" 2>/dev/null || true)"
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill_pid_gracefully "$pid"
            wait "$pid" 2>/dev/null || true
        fi
        rm -f "$pid_file"
    fi
}

pid_belongs_to_repo() {
    local pid="$1"
    local command cwd

    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)"

    case "$cwd" in
        "$ROOT_DIR"|"$ROOT_DIR"/*)
            return 0
            ;;
    esac

    [[ "$command" == *"$ROOT_DIR"* ]]
}

port_has_repo_listener() {
    local port="$1"
    local pid

    while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        if pid_belongs_to_repo "$pid"; then
            return 0
        fi
    done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)

    return 1
}

port_has_external_listener() {
    local port="$1"
    local pid

    while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        if ! pid_belongs_to_repo "$pid"; then
            return 0
        fi
    done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)

    return 1
}

select_dashboard_port() {
    export DASHBOARD_HOST_PORT
    HOST_PORTS=(3000 3001 "$DASHBOARD_HOST_PORT")

    if port_has_external_listener "$DASHBOARD_HOST_PORT"; then
        echo "[local-k8s] ERROR: Dashboard port :$DASHBOARD_HOST_PORT is occupied by a non-Rejourney process." >&2
        echo "[local-k8s] Free :$DASHBOARD_HOST_PORT and rerun this command; hot-reload dashboard dev must own that port." >&2
        exit 1
    fi
}

update_local_urls() {
    select_dashboard_port
    DASHBOARD_HOST_PORT="$DASHBOARD_HOST_PORT" "$SCRIPT_DIR/update-ips.sh" "$ENV_FILE"
}

cleanup_stale_host_ports() {
    local port pid

    for port in "${HOST_PORTS[@]}"; do
        while IFS= read -r pid; do
            [ -n "$pid" ] || continue
            if pid_belongs_to_repo "$pid"; then
                echo "[local-k8s] Releasing local listener on :$port (pid $pid)"
                kill_pid_gracefully "$pid"
            else
                echo "[local-k8s] Leaving non-Rejourney listener on :$port alone (pid $pid)"
            fi
        done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    done
}

cleanup_stale_host_processes() {
    local pattern pid
    local patterns=(
        "tsx watch src/index.ts"
        "tsx watch src/uploadServer.ts"
        "tsx watch src/worker/ingestArtifactWorker.ts"
        "tsx watch src/worker/replayArtifactWorker.ts"
        "tsx watch src/worker/sessionLifecycleWorker.ts"
        "tsx watch src/worker/retentionWorker.ts"
        "tsx watch src/worker/alertWorker.ts"
        "node --import tsx src/index.ts"
        "node --import tsx src/uploadServer.ts"
        "node --import tsx src/worker/ingestArtifactWorker.ts"
        "node --import tsx src/worker/replayArtifactWorker.ts"
        "node --import tsx src/worker/sessionLifecycleWorker.ts"
        "node --import tsx src/worker/retentionWorker.ts"
        "node --import tsx src/worker/alertWorker.ts"
        "node dist/index.js"
        "node dist/uploadServer.js"
        "kubectl -n rejourney-local port-forward svc/clickhouse"
        "react-router dev --host 0.0.0.0 --port 8080"
        "react-router dev --host 0.0.0.0 --port $DASHBOARD_HOST_PORT"
    )

    for pattern in "${patterns[@]}"; do
        while IFS= read -r pid; do
            [ -n "$pid" ] || continue
            echo "[local-k8s] Releasing stale local process ($pattern) pid $pid"
            kill_pid_gracefully "$pid"
        done < <(pgrep -fal "$pattern" 2>/dev/null | awk '{print $1}' || true)
    done
}

start_process() {
    local name="$1"
    local port="$2"
    local command="$3"
    local log_file="$LOG_DIR/$name.log"
    local pid_file="$PID_DIR/$name.pid"

    kill_if_running "$pid_file"

    nohup perl -MPOSIX -e 'setsid or die $!; exec @ARGV' bash -lc "$command" </dev/null >"$log_file" 2>&1 &
    local pid=$!
    echo "$pid" > "$pid_file"

    local startup_attempts=$((HOST_STARTUP_WAIT_SECONDS * 2))
    for ((attempt = 1; attempt <= startup_attempts; attempt++)); do
        if ! kill -0 "$pid" 2>/dev/null; then
            echo "[local-k8s] ERROR: Failed to start $name (see $log_file)" >&2
            tail -n 40 "$log_file" >&2 || true
            return 1
        fi

        if [ -n "$port" ] && port_has_repo_listener "$port"; then
            echo "[local-k8s] Started $name on :$port (log: $log_file)"
            return 0
        fi

        if [ -z "$port" ]; then
            echo "[local-k8s] Started $name (log: $log_file)"
            return 0
        fi

        sleep 0.5
    done

    echo "[local-k8s] ERROR: $name did not bind to :$port (see $log_file)" >&2
    tail -n 40 "$log_file" >&2 || true
    return 1
}

source_env() {
    [ -f "$ENV_FILE" ] || {
        echo "[local-k8s] Missing env file: $ENV_FILE"
        echo "[local-k8s] Copy local-k8s/env.example to .env.k8s.local first."
        exit 1
    }
    set -a
    source "$ENV_FILE"
    set +a
}

ensure_clickhouse_host_port() {
    local pid

    if [ "${CLICKHOUSE_ENABLED:-false}" != "true" ]; then
        return
    fi

    if curl -fsS "http://127.0.0.1:$CLICKHOUSE_HOST_PORT/ping" >/dev/null 2>&1; then
        return
    fi

    while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        if ! pid_belongs_to_repo "$pid"; then
            echo "[local-k8s] ERROR: ClickHouse host port :$CLICKHOUSE_HOST_PORT is occupied but does not answer /ping." >&2
            echo "[local-k8s] Free :$CLICKHOUSE_HOST_PORT or set CLICKHOUSE_HOST_PORT before starting host services." >&2
            exit 1
        fi
    done < <(lsof -tiTCP:"$CLICKHOUSE_HOST_PORT" -sTCP:LISTEN 2>/dev/null || true)

    start_process \
        "clickhouse-port-forward" \
        "$CLICKHOUSE_HOST_PORT" \
        "kubectl -n rejourney-local port-forward svc/clickhouse $CLICKHOUSE_HOST_PORT:8123 $CLICKHOUSE_NATIVE_HOST_PORT:9000"

    local attempts=$((HOST_STARTUP_WAIT_SECONDS * 2))
    for ((attempt = 1; attempt <= attempts; attempt++)); do
        if curl -fsS "http://127.0.0.1:$CLICKHOUSE_HOST_PORT/ping" >/dev/null 2>&1; then
            echo "[local-k8s] ClickHouse HTTP is reachable on :$CLICKHOUSE_HOST_PORT"
            return
        fi
        sleep 0.5
    done

    echo "[local-k8s] ERROR: ClickHouse did not answer on :$CLICKHOUSE_HOST_PORT" >&2
    tail -n 40 "$LOG_DIR/clickhouse-port-forward.log" >&2 || true
    exit 1
}

setup_db() {
    source_env
    (
        cd "$ROOT_DIR/backend"
        # Local fresh DBs need schema sync because the checked-in migration chain
        # starts from an older existing schema rather than from zero.
        npm run db:push
        npm run db:seed
    )
    sync_storage_endpoint
}

sync_db_schema() {
    source_env
    (
        cd "$ROOT_DIR/backend"
        npm run db:push
    )
    sync_storage_endpoint
}

sync_storage_endpoint() {
    source_env
    (
        cd "$ROOT_DIR/backend"
        set -a
        source "$ENV_FILE"
        set +a
        node --import tsx scripts/syncLocalStorageEndpoint.ts
    )
}

start_host_services() {
    source_env
    select_dashboard_port
    cleanup_stale_host_processes
    cleanup_stale_host_ports
    ensure_clickhouse_host_port

    start_process "api" "3000" "cd '$ROOT_DIR/backend' && set -a && source '$ENV_FILE' && set +a && node --import tsx src/index.ts"
    start_process "upload" "3001" "cd '$ROOT_DIR/backend' && set -a && source '$ENV_FILE' && set +a && PORT=3001 node --import tsx src/uploadServer.ts"
    start_process "worker-ingest" "" "cd '$ROOT_DIR/backend' && set -a && source '$ENV_FILE' && set +a && node --import tsx src/worker/ingestArtifactWorker.ts"
    start_process "worker-replay" "" "cd '$ROOT_DIR/backend' && set -a && source '$ENV_FILE' && set +a && node --import tsx src/worker/replayArtifactWorker.ts"
    start_process "worker-lifecycle" "" "cd '$ROOT_DIR/backend' && set -a && source '$ENV_FILE' && set +a && node --import tsx src/worker/sessionLifecycleWorker.ts"
    start_process "worker-retention" "" "cd '$ROOT_DIR/backend' && set -a && source '$ENV_FILE' && set +a && node --import tsx src/worker/retentionWorker.ts"
    start_process "worker-alerts" "" "cd '$ROOT_DIR/backend' && set -a && source '$ENV_FILE' && set +a && node --import tsx src/worker/alertWorker.ts"
    start_process "web" "$DASHBOARD_HOST_PORT" "cd '$ROOT_DIR/dashboard/web-ui' && set -a && source '$ENV_FILE' && set +a && npm run dev -- --host 0.0.0.0 --port $DASHBOARD_HOST_PORT"
}

stop_host_services() {
    for pid_file in "$PID_DIR"/*.pid; do
        [ -e "$pid_file" ] || continue
        kill_if_running "$pid_file"
    done
}

show_logs() {
    local name="${2:-}"

    if [ -n "$name" ]; then
        tail -n 100 -f "$LOG_DIR/$name.log"
        return
    fi

    echo "[local-k8s] Host logs are in $LOG_DIR"
    ls -1 "$LOG_DIR" 2>/dev/null || true
}

down() {
    stop_host_services
    echo "[local-k8s] Stopped host services. Infra and local data were preserved."
}

destroy() {
    stop_host_services
    "$SCRIPT_DIR/deploy.sh" down "$ENV_FILE"
}

print_status() {
    echo ""
    echo "[local-k8s] Hybrid development is running."
    echo "[local-k8s] API: ${PUBLIC_API_URL:-http://127.0.0.1:3000}"
    echo "[local-k8s] Upload relay: http://127.0.0.1:3001"
    echo "[local-k8s] Dashboard: http://127.0.0.1:$DASHBOARD_HOST_PORT"
    echo "[local-k8s] MinIO: http://127.0.0.1:9000"
    echo "[local-k8s] MinIO Console: http://127.0.0.1:9001"
    echo "[local-k8s] ClickHouse HTTP: http://127.0.0.1:$CLICKHOUSE_HOST_PORT"
    echo "[local-k8s] Logs: $LOG_DIR"
}

case "${1:-up}" in
    down)
        down
        ;;
    destroy)
        destroy
        ;;
    logs)
        show_logs "$@"
        ;;
host-restart)
        update_local_urls
        sync_storage_endpoint
        start_host_services
        print_status
        ;;
    restart)
        update_local_urls
        "$SCRIPT_DIR/deploy.sh" infra "$ENV_FILE"
        sync_db_schema
        start_host_services
        print_status
        ;;
    up)
        update_local_urls
        "$SCRIPT_DIR/deploy.sh" infra "$ENV_FILE"
        setup_db
        start_host_services
        print_status
        ;;
    *)
        echo "Usage: $0 [up|restart|host-restart|down|destroy|logs [name]]"
        exit 1
        ;;
esac
