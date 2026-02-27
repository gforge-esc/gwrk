#!/bin/sh
set -eu

# verify-dev-stack.sh — Connectivity gate for agent dev workflows
# STRICT DOCKER MANDATE: Only Docker execution is permitted.
#
# Usage: ./scripts/dev/verify-dev-stack.sh
# Called by /implement, /review-code, and /review-uat workflows.

FAILED=0

echo "[verify-dev-stack] Mode: STRICT DOCKER"

# --------------------------------------------------------------------------
# 1. Check for zombie dev processes (bare pnpm dev or cargo run)
# --------------------------------------------------------------------------
ZOMBIE_PNPM=$(pgrep -f "pnpm.*dev" 2>/dev/null | wc -l | tr -d ' ')
ZOMBIE_CARGO=$(pgrep -f "cargo.*run" 2>/dev/null | wc -l | tr -d ' ')

if [ "$ZOMBIE_PNPM" -gt 0 ] || [ "$ZOMBIE_CARGO" -gt 0 ]; then
  echo "[verify-dev-stack] ⚠️  Found local pnpm/cargo dev process(es)."
  echo "[verify-dev-stack]    These conflict with Docker stack. Kill them first:"
  echo "[verify-dev-stack]    make agent-kill"
  FAILED=1
fi

# --------------------------------------------------------------------------
# 2. Verify containers are running
# --------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "[verify-dev-stack] FATAL: docker not found in PATH"
  exit 1
fi

COMPOSE_PROJECT="codered"

# Check key services
for SERVICE in api web; do
  RUNNING=$(docker compose --project-name ${COMPOSE_PROJECT}-dev ps --format json 2>/dev/null \
    | grep -c "\"$SERVICE\"" || true)
  if [ "$RUNNING" -eq 0 ]; then
    echo "[verify-dev-stack] ❌ Service '$SERVICE' not running"
    FAILED=1
  else
    echo "[verify-dev-stack] ✅ Service '$SERVICE' running"
  fi
done

# --------------------------------------------------------------------------
# 3. Check Web API Reachability
# --------------------------------------------------------------------------
API_URL="http://localhost:3000/api" # Adjust if CodeRed uses Traefik/differing ports

echo "[verify-dev-stack] Checking API at $API_URL ..."
if curl -sf --max-time 5 "$API_URL" >/dev/null 2>&1; then
  echo "[verify-dev-stack] ✅ API reachable"
elif curl -sf --max-time 5 "${API_URL}/health" >/dev/null 2>&1; then
  echo "[verify-dev-stack] ✅ API reachable (via /health)"
else
  # Warning only, as it might take a moment to boot
  echo "[verify-dev-stack] ⚠️ API not immediately reachable at $API_URL"
fi

# --------------------------------------------------------------------------
# Result
# --------------------------------------------------------------------------
if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "[verify-dev-stack] ❌ FAILED — Dev stack not ready."
  echo "[verify-dev-stack] Ensure you run: make up"
  echo "[verify-dev-stack] Local execution (make infra or pnpm dev) is NOT ALLOWED."
  exit 1
fi

echo ""
echo "[verify-dev-stack] ✅ Dev stack verified and ready."
exit 0
