#!/bin/bash
# Backwards-compatible wrapper for the newer local CI parity entrypoint.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec "$SCRIPT_DIR/rejourney-ci.sh" full "$@"
