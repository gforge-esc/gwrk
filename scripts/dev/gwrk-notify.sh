#!/bin/bash
# gwrk-notify.sh — Send Slack notifications via gwrk server

set -euo pipefail

# Usage:
#   ./scripts/dev/gwrk-notify.sh <type> <feature> [phase] [extra_json]

TYPE="${1:-}"
FEATURE="${2:-}"
PHASE="${3:-}"
EXTRA_JSON="${4:-}"
if [[ -z "$EXTRA_JSON" ]]; then EXTRA_JSON='{}'; fi

if [[ -z "$TYPE" ]] || [[ -z "$FEATURE" ]]; then
  echo "Usage: $0 <type> <feature> [phase] [extra_json]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load config to get server host/port
CONFIG_FILE="$REPO_ROOT/.gwrkrc.json"
HOST="localhost"
PORT="18790"

if [[ -f "$CONFIG_FILE" ]]; then
  HOST=$(jq -r '.server.host // "localhost"' "$CONFIG_FILE")
  PORT=$(jq -r '.server.port // "18790"' "$CONFIG_FILE")
fi

# Build payload
PAYLOAD=$(jq -n \
  --arg type "$TYPE" \
  --arg feature "$FEATURE" \
  --arg phase "$PHASE" \
  --arg branch "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')" \
  --arg backend "${AGENT_BACKEND:-gemini}" \
  --argjson extra "$EXTRA_JSON" \
  '$extra + {type: $type, feature: $feature, phase: $phase, branch: $branch, backend: $backend}')

# Send request
URL="http://${HOST}:${PORT}/api/notify"
# Use a short timeout and ignore failures (non-fatal)
curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --max-time 5 > /dev/null || echo "notify skipped: server unreachable"
