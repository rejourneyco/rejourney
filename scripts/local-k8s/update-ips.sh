#!/bin/bash
# Update local development URLs with the current LAN IP.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env.k8s.local}"
DASHBOARD_HOST_PORT="${DASHBOARD_HOST_PORT:-8080}"
BOILERPLATE_ENV="$ROOT_DIR/examples/react-native-boilerplate/.env.local"
BREW_ENV="$ROOT_DIR/examples/brew-coffee-labs/.env.local"
SWIFT_EXAMPLE="$ROOT_DIR/examples/swift-clean-arch/CountriesSwiftUI/Core/RejourneyExample.swift"

get_local_ip() {
    local ip=""
    for iface in en0 en1; do
        ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
        if [ -n "$ip" ]; then
            echo "$ip"
            return 0
        fi
    done

    return 1
}

replace_or_append() {
    local file="$1"
    local key="$2"
    local value="$3"

    touch "$file"

    if grep -q "^${key}=" "$file"; then
        perl -0pi -e "s|^${key}=.*\$|${key}=${value}|m" "$file"
    else
        printf "\n%s=%s\n" "$key" "$value" >> "$file"
    fi
}

replace_swift_api_url() {
    local file="$1"
    local value="$2"
    if [ -f "$file" ]; then
        perl -0pi -e "s|private static let fallbackAPIURL = URL\\(string: \".*\"\\)!|private static let fallbackAPIURL = URL(string: \"${value}\")!|m" "$file"
    fi
}

LOCAL_IP="$(get_local_ip || true)"

if [ -z "$LOCAL_IP" ]; then
    echo "Could not determine a LAN IP from en0/en1. Skipping URL updates."
    exit 0
fi

echo "Updating local development URLs with LAN IP: $LOCAL_IP"

replace_or_append "$ENV_FILE" "S3_PUBLIC_ENDPOINT" "http://$LOCAL_IP:9000"
replace_or_append "$ENV_FILE" "S3_ENDPOINT" "http://$LOCAL_IP:9000"
replace_or_append "$ENV_FILE" "PUBLIC_DASHBOARD_URL" "http://$LOCAL_IP:$DASHBOARD_HOST_PORT"
replace_or_append "$ENV_FILE" "PUBLIC_API_URL" "http://$LOCAL_IP:3000"
replace_or_append "$ENV_FILE" "VITE_API_URL" "http://$LOCAL_IP:3000"
replace_or_append "$ENV_FILE" "PUBLIC_INGEST_URL" "http://$LOCAL_IP:3001"
replace_or_append "$ENV_FILE" "DASHBOARD_ORIGIN" "http://$LOCAL_IP:$DASHBOARD_HOST_PORT"
replace_or_append "$ENV_FILE" "ADDITIONAL_DASHBOARD_ORIGINS" "http://localhost:$DASHBOARD_HOST_PORT,http://127.0.0.1:$DASHBOARD_HOST_PORT,http://rejourney.localtest.me,http://rejourney.localtest.me:$DASHBOARD_HOST_PORT,http://$LOCAL_IP:$DASHBOARD_HOST_PORT"
replace_or_append "$ENV_FILE" "OAUTH_REDIRECT_BASE" "http://$LOCAL_IP:3000"

replace_or_append "$BOILERPLATE_ENV" "API_URL" "http://$LOCAL_IP:3000"
replace_or_append "$BREW_ENV" "EXPO_PUBLIC_API_URL" "http://$LOCAL_IP:3000"

replace_swift_api_url "$SWIFT_EXAMPLE" "http://$LOCAL_IP:3000"

echo "Updated:"
echo "  $ENV_FILE"
echo "  $BOILERPLATE_ENV"
echo "  $BREW_ENV"
echo "  $SWIFT_EXAMPLE"
